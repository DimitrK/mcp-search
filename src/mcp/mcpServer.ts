import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { APP_NAME, APP_VERSION, MCP_TOOL_DESCRIPTIONS } from '../config/constants';
import { generateCorrelationId, createChildLogger, withTiming } from '../utils/logger';
import { handleMcpError, ValidationError } from './errors';
import { SearchInput, ReadFromPageInput } from './schemas';
import { handleWebSearch, handleReadFromPage } from '../handlers/index';

/**
 * Context passed to handlers for progress notifications
 */
export interface HandlerContext {
  progressToken?: string | number;
  sendProgress: (progress: number, total?: number, message?: string) => Promise<void>;
}

// Create the MCP server instance
export const mcpServer = new Server(
  {
    name: APP_NAME,
    version: APP_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Set up request handlers
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  const correlationId = generateCorrelationId();
  const childLogger = createChildLogger(correlationId);

  childLogger.debug('Listing available tools');

  return {
    tools: [
      {
        name: 'web.search',
        description: MCP_TOOL_DESCRIPTIONS.WEB_SEARCH,
        inputSchema: zodToJsonSchema(SearchInput),
      },
      {
        name: 'web.readFromPage',
        description: MCP_TOOL_DESCRIPTIONS.READ_FROM_PAGE,
        inputSchema: zodToJsonSchema(ReadFromPageInput),
      },
    ],
  };
});

// Handle tool calls
mcpServer.setRequestHandler(CallToolRequestSchema, async request => {
  const correlationId = generateCorrelationId();
  const childLogger = createChildLogger(correlationId);

  try {
    childLogger.info({ tool: request.params.name }, 'Tool call received');

    // Extract progress token from request metadata
    const progressToken = request.params._meta?.progressToken;

    // Create progress notification sender
    const context: HandlerContext = {
      progressToken,
      sendProgress: async (progress: number, total?: number, message?: string) => {
        if (progressToken) {
          await mcpServer.notification({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress,
              ...(total !== undefined && { total }),
              ...(message && { message }),
            },
          });
          childLogger.debug({ progress, total, message }, 'Progress notification sent');
        }
      },
    };

    switch (request.params.name) {
      case 'web.search':
        return await withTiming(childLogger, 'tool:web.search', async () =>
          handleWebSearch(request.params.arguments, childLogger, context)
        );

      case 'web.readFromPage':
        return await withTiming(childLogger, 'tool:web.readFromPage', async () =>
          handleReadFromPage(request.params.arguments, childLogger, context)
        );

      default:
        throw new ValidationError(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    childLogger.error({ error, tool: request.params.name }, 'Tool call failed');
    throw handleMcpError(error, `Tool call: ${request.params.name}`);
  }
});
