#!/usr/bin/env node

import { parseArgs } from 'util';
import { McpSearchServer } from './server';
import { APP_NAME, APP_VERSION } from './config/constants';
import { logger } from './utils/logger';
import { closeGlobalPool, getPool } from './core/vector/store/pool';
import { DatabaseInspector } from './utils/databaseInspector';
import { DatabaseCleaner } from './utils/databaseCleaner';
import { getEnvironment, getDataDirectory } from './config/environment';
import { existsSync } from 'fs';
import { join } from 'path';

const HELP_TEXT = `
${APP_NAME} v${APP_VERSION}

A Model Context Protocol server for web search and semantic content retrieval.

Usage: mcp-search [command] [options]

Commands:
  server         Start the MCP server (default)
  health         Check system health and dependencies
  inspect        Inspect database contents
  cleanup        Clean up old data and optimize database
  version        Show version information
  help           Show this help message

Health Check:
  mcp-search health             # Check all system components
  mcp-search health --verbose   # Detailed health information

Database Inspection:
  mcp-search inspect                    # Show database overview
  mcp-search inspect --url <url>       # Show data for specific URL
  mcp-search inspect --stats           # Show database statistics
  mcp-search inspect --tables          # List all tables and counts

Database Maintenance:
  mcp-search cleanup                    # Clean old data (>30 days)
  mcp-search cleanup --days 7          # Clean data older than 7 days
  mcp-search cleanup --dry-run          # Preview what would be deleted
  mcp-search cleanup --vacuum           # Optimize database

Options:
  --help, -h     Show help
  --version      Show version
  --verbose, -v  Verbose output

Examples:
  mcp-search server
  mcp-search health --verbose
  mcp-search inspect --url "https://example.com"
  mcp-search cleanup --days 14
`;

interface ParsedArgs {
  values: {
    help?: boolean;
    version?: boolean;
    verbose?: boolean;
    url?: string;
    stats?: boolean;
    tables?: boolean;
    days?: string;
    vacuum?: boolean;
    'dry-run'?: boolean;
  };
  positionals: string[];
}

function parseCliArgs(): ParsedArgs {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
        verbose: { type: 'boolean', short: 'v' },
        url: { type: 'string' },
        stats: { type: 'boolean' },
        tables: { type: 'boolean' },
        days: { type: 'string' },
        vacuum: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
      },
      allowPositionals: true,
    }) as ParsedArgs;
  } catch (error) {
    logger.error({ error }, 'Invalid command line arguments');
    console.error('Error parsing arguments. Use --help for usage information.');
    process.exit(1);
  }
}

async function formatBytes(bytes: number): Promise<string> {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}

async function inspectDatabase(options: ParsedArgs['values']): Promise<void> {
  try {
    console.log('🔍 Database Inspection');
    console.log('===================');

    const pool = await getPool();
    const connection = await pool.acquire();
    const inspector = new DatabaseInspector(connection);

    try {
      if (options.url) {
        // Inspect specific URL
        console.log(`\n📄 Document: ${options.url}`);
        console.log('-'.repeat(50));

        const docInfo = await inspector.getDocumentInfo(options.url);
        if (!docInfo) {
          console.log('❌ Document not found in database');
          return;
        }

        console.log(`Title: ${docInfo.title || 'N/A'}`);
        console.log(`Last Crawled: ${docInfo.lastCrawled}`);
        console.log(`Content Hash: ${docInfo.contentHash}`);
        console.log(`Chunk Count: ${docInfo.chunkCount}`);
        console.log(`Total Tokens: ${docInfo.totalTokens}`);
      } else if (options.stats) {
        // Show database statistics
        console.log('\n📊 Database Statistics');
        console.log('-'.repeat(30));

        const stats = await inspector.getDatabaseStats();
        console.log(`Total Documents: ${stats.totalDocuments}`);
        console.log(`Total Chunks: ${stats.totalChunks}`);
        console.log(`Database Size: ${await formatBytes(stats.databaseSizeBytes)}`);
        console.log(
          `Oldest Document: ${stats.oldestDocument ? new Date(stats.oldestDocument).toLocaleString() : 'N/A'}`
        );
        console.log(
          `Newest Document: ${stats.newestDocument ? new Date(stats.newestDocument).toLocaleString() : 'N/A'}`
        );
        console.log(`Embedding Model: ${stats.embeddingModel || 'N/A'}`);
        console.log(`Embedding Dimension: ${stats.embeddingDimension || 'N/A'}`);
      } else if (options.tables) {
        // Show table information
        console.log('\n📋 Table Information');
        console.log('-'.repeat(30));

        const tables = await inspector.getTableInfo();
        console.log(
          `${'Table Name'.padEnd(20)} ${'Rows'.padEnd(10)} ${'Columns'.padEnd(10)} ${'Size'.padEnd(10)}`
        );
        console.log('-'.repeat(60));

        for (const table of tables) {
          const sizeFormatted = await formatBytes(table.sizeBytes);
          console.log(
            `${table.name.padEnd(20)} ${table.rowCount.toString().padEnd(10)} ${table.columnCount.toString().padEnd(10)} ${sizeFormatted.padEnd(10)}`
          );
        }
      } else {
        // Default overview
        console.log('\n📊 Database Overview');
        console.log('-'.repeat(30));

        const stats = await inspector.getDatabaseStats();
        console.log(`📄 Documents: ${stats.totalDocuments}`);
        console.log(`🧩 Chunks: ${stats.totalChunks}`);
        console.log(`💾 Size: ${await formatBytes(stats.databaseSizeBytes)}`);

        if (stats.embeddingModel) {
          console.log(`🧠 Model: ${stats.embeddingModel} (${stats.embeddingDimension}d)`);
        }

        console.log('\n💡 Use --stats, --tables, or --url for detailed information');
      }
    } finally {
      await pool.release(connection);
      await closeGlobalPool();
    }
  } catch (error) {
    console.error(
      '❌ Database inspection failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}

async function cleanupDatabase(options: ParsedArgs['values']): Promise<void> {
  try {
    console.log('🧹 Database Cleanup');
    console.log('==================');

    const pool = await getPool();
    const connection = await pool.acquire();
    const cleaner = new DatabaseCleaner(connection);

    try {
      const daysOld = options.days ? parseInt(options.days, 10) : 30;
      const shouldVacuum = Boolean(options.vacuum);

      if (isNaN(daysOld) || daysOld < 0) {
        console.error('❌ Invalid days value. Must be a positive number.');
        process.exit(1);
      }

      console.log(`\n🗓️  Cleaning data older than ${daysOld} days`);

      // First do a dry run to show what would be deleted
      console.log('\n🔍 Dry Run Results:');
      console.log('-'.repeat(20));

      const dryRunResult = await cleaner.cleanup({
        daysOld,
        shouldVacuum: false,
        dryRun: true,
      });

      console.log(`Would delete: ${dryRunResult.documentsDeleted} documents`);
      console.log(`Would delete: ${dryRunResult.chunksDeleted} chunks`);
      console.log(`Estimated space savings: ${await formatBytes(dryRunResult.spaceSavedBytes)}`);

      if (dryRunResult.documentsDeleted === 0) {
        console.log('\n✨ No old data to clean up!');
        if (shouldVacuum && !options['dry-run']) {
          console.log('\n🗜️  Running vacuum to optimize database...');
          await cleaner.vacuum();
          console.log('✅ Database optimized');
        }
        return;
      }

      // If this is a dry run, stop here
      if (options['dry-run']) {
        console.log(
          '\n💡 This was a dry run. Use the command without --dry-run to perform the actual cleanup.'
        );
        return;
      }

      // Ask for confirmation (in a real CLI, you'd want proper prompting)
      console.log('\n⚠️  This operation cannot be undone!');
      console.log('💡 Use --dry-run to preview changes before running.');

      // Proceed with actual cleanup
      console.log('\n🗑️  Performing cleanup...');

      const result = await cleaner.cleanup({
        daysOld,
        shouldVacuum,
        dryRun: false,
      });

      console.log(`✅ Deleted: ${result.documentsDeleted} documents`);
      console.log(`✅ Deleted: ${result.chunksDeleted} chunks`);
      console.log(`✅ Space saved: ${await formatBytes(result.spaceSavedBytes)}`);

      if (shouldVacuum) {
        console.log('✅ Database optimized');
      }
    } finally {
      await pool.release(connection);
      await closeGlobalPool();
    }
  } catch (error) {
    console.error(
      '❌ Database cleanup failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseCliArgs();

  // Handle help flag without requiring env
  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Handle version flag
  if (values.version) {
    console.log(`${APP_NAME} v${APP_VERSION}`);
    process.exit(0);
  }

  const command = positionals[0] || 'server';

  switch (command) {
    case 'server': {
      const server = new McpSearchServer();

      // Graceful shutdown handling
      const shutdown = async (signal: string) => {
        logger.info({ signal }, 'Received shutdown signal, closing gracefully...');
        try {
          await closeGlobalPool();
          logger.info('Database pool closed successfully');
          process.exit(0);
        } catch (error) {
          logger.error({ error }, 'Error during graceful shutdown');
          process.exit(1);
        }
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));

      await server.start();
      break;
    }

    case 'version': {
      console.log(`${APP_NAME} v${APP_VERSION}`);
      break;
    }

    case 'help': {
      console.log(HELP_TEXT);
      break;
    }

    case 'health': {
      console.log('🔍 Health Check (Basic):');
      try {
        getEnvironment(); // Validate environment variables
        console.log('  ✅ Environment variables validated');
        const dataDir = getDataDirectory();
        console.log(`  📂 Data directory: ${dataDir}`);
        const dbPath = join(dataDir, 'db', 'mpc.duckdb');
        if (existsSync(dbPath)) {
          console.log('  ✅ Database file exists');
        } else {
          console.log('  ⚠️  Database file not found (will be created on first use)');
        }
        console.log('🚀 System ready');
      } catch (error) {
        console.error(
          '❌ Health check failed:',
          error instanceof Error ? error.message : 'Unknown error'
        );
        process.exit(1);
      }
      break;
    }

    case 'inspect': {
      await inspectDatabase(values);
      break;
    }

    case 'cleanup': {
      await cleanupDatabase(values);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Use --help for usage information.');
      process.exit(1);
    }
  }
}

// Run the CLI
main().catch(error => {
  logger.error({ error }, 'CLI execution failed');
  console.error(`Fatal error: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
