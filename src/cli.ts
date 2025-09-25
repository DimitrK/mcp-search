#!/usr/bin/env node

import { parseArgs } from 'util';
import { McpSearchServer } from './server';
import { APP_NAME, APP_VERSION } from './config/constants';
import { logger } from './utils/logger';
import { closeGlobalPool } from './core/vector/store/pool';

const HELP_TEXT = `
${APP_NAME} v${APP_VERSION}

Usage: mcp-search [command] [options]

Commands:
  server      Start the MCP server (default)
  version     Show version information
  help        Show this help message

Options:
  --help, -h  Show help
  --version   Show version

Examples:
  mcp-search server
  mcp-search --version
`;

interface ParsedArgs {
  values: {
    help?: boolean;
    version?: boolean;
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
      },
      allowPositionals: true,
    }) as ParsedArgs;
  } catch (error) {
    logger.error({ error }, 'Invalid command line arguments');
    console.error('Error parsing arguments. Use --help for usage information.');
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
