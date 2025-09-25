#!/usr/bin/env node

import { McpSearchServer } from './server';
import { logger } from './utils/logger';
import { closeGlobalPool } from './core/vector/store/pool';

if (
  process.env.NODE_ENV !== 'test' &&
  typeof import.meta !== 'undefined' &&
  import.meta.url === `file://${process.argv[1]}`
) {
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

  server.start().catch(error => {
    logger.error({ error }, 'Fatal error during server startup');
    process.exit(1);
  });
}
