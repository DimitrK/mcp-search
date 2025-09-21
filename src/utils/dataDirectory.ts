import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { getDataDirectory, getDatabasePath } from '../config/environment';
import { logger } from './logger';

export async function initializeDataDirectory(): Promise<void> {
  try {
    const dataDir = getDataDirectory();
    const dbPath = getDatabasePath();

    // Create data directory if it doesn't exist
    await mkdir(dataDir, { recursive: true });
    logger.debug({ dataDir }, 'Data directory created/verified');

    // Create database directory if it doesn't exist
    await mkdir(dirname(dbPath), { recursive: true });
    logger.debug({ dbDir: dirname(dbPath) }, 'Database directory created/verified');

    logger.info({ dataDir, dbPath }, 'Data directory structure initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize data directory structure');
    throw new Error(
      `Failed to initialize data directory: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}
