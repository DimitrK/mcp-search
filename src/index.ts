#!/usr/bin/env node

import { McpSearchServer } from './server';
import { logger } from './utils/logger';

if (
  process.env.NODE_ENV !== 'test' &&
  typeof import.meta !== 'undefined' &&
  import.meta.url === `file://${process.argv[1]}`
) {
  const server = new McpSearchServer();
  server.start().catch(error => {
    logger.error({ error }, 'Fatal error during server startup');
    process.exit(1);
  });
}
