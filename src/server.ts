import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './utils/logger';
import { InitializationService } from './services/initialization';
import { TransportManager } from './transport/manager';

/**
 * Main MCP Search Server class
 * Orchestrates initialization and transport connection
 */
export class McpSearchServer {
  private initService: InitializationService;
  private transportManager: TransportManager;

  constructor() {
    this.initService = new InitializationService();
    this.transportManager = new TransportManager();
  }

  /**
   * Initialize the server (environment validation, data directory setup)
   */
  async initialize(): Promise<void> {
    await this.initService.initialize();
  }

  /**
   * Connect to a transport (default: STDIO)
   */
  async connect(transport?: StdioServerTransport): Promise<void> {
    await this.transportManager.connect(transport);
  }

  /**
   * Start the server (initialize + connect)
   */
  async start(): Promise<void> {
    try {
      await this.initialize();
      await this.connect();
    } catch (error) {
      logger.error({ error }, 'Failed to start MCP server');
      process.exit(1);
    }
  }
}

// Start the server if this file is run directly (skip in test environment)
// Commented out for Jest compatibility - import.meta causes issues in test environment

export { mcpServer } from './mcp/mcpServer';
