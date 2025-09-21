import { validateEnvironment } from '../config/environment';
import { initializeDataDirectory } from '../utils/dataDirectory';
import { logger } from '../utils/logger';

export class InitializationService {
  async initialize(): Promise<void> {
    try {
      // Validate environment variables
      logger.info('Validating environment configuration');
      validateEnvironment();

      // Initialize data directory structure
      logger.info('Initializing data directory structure');
      await initializeDataDirectory();

      logger.info('Application initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize application');
      throw error;
    }
  }
}
