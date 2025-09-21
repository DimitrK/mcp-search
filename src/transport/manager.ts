import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../utils/logger';
import { mcpServer } from '../mcp/mcpServer';

export class TransportManager {
  async connectStdio(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      logger.info('Connecting MCP server to STDIO transport');
      await mcpServer.connect(transport);
      logger.info('MCP server connected successfully and ready to accept connections');
    } catch (error) {
      logger.error({ error }, 'Failed to connect MCP server to STDIO transport');
      throw error;
    }
  }

  async connect(transport?: StdioServerTransport): Promise<void> {
    try {
      const serverTransport = transport || new StdioServerTransport();
      logger.info('Connecting MCP server to custom transport');
      await mcpServer.connect(serverTransport);
      logger.info('MCP server connected successfully and ready to accept connections');
    } catch (error) {
      logger.error({ error }, 'Failed to connect MCP server to transport');
      throw error;
    }
  }
}
