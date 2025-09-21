import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { APP_NAME, APP_VERSION, MCP_TOOL_DESCRIPTIONS } from '../config/constants';
import { generateCorrelationId, createChildLogger } from '../utils/logger';
import { handleMcpError, ValidationError } from './errors';
import { SearchInput, ReadFromPageInput, DebugEchoInput } from './schemas';
import { handleWebSearch, handleReadFromPage, handleDebugEcho } from '../handlers/index';

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
      {
        name: 'debug.echo',
        description: MCP_TOOL_DESCRIPTIONS.DEBUG_ECHO,
        inputSchema: zodToJsonSchema(DebugEchoInput),
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

    switch (request.params.name) {
      case 'web.search':
        return await handleWebSearch(request.params.arguments, childLogger);

      case 'web.readFromPage':
        return await handleReadFromPage(request.params.arguments, childLogger);

      case 'debug.echo':
        return await handleDebugEcho(request.params.arguments, childLogger);

      default:
        throw new ValidationError(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    childLogger.error({ error, tool: request.params.name }, 'Tool call failed');
    throw handleMcpError(error, `Tool call: ${request.params.name}`);
  }
});
