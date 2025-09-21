import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { TransportManager } from '../../../src/transport/manager';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Mock the MCP server
jest.mock('../../../src/mcp/mcpServer', () => ({
  mcpServer: {
    connect: jest.fn()
  }
}));

describe('Transport Manager', () => {
  let transportManager: TransportManager;
  const mockConnect = require('../../../src/mcp/mcpServer').mcpServer.connect;

  beforeEach(() => {
    transportManager = new TransportManager();
    jest.clearAllMocks();
  });

  test('should create TransportManager instance', () => {
    expect(transportManager).toBeInstanceOf(TransportManager);
  });

  test('should connect to STDIO transport by default', async () => {
    mockConnect.mockResolvedValue(undefined);

    await expect(transportManager.connectStdio()).resolves.not.toThrow();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(expect.any(StdioServerTransport));
  });

  test('should connect with custom transport', async () => {
    mockConnect.mockResolvedValue(undefined);
    const customTransport = new StdioServerTransport();

    await expect(transportManager.connect(customTransport)).resolves.not.toThrow();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(customTransport);
  });

  test('should use default transport when none provided', async () => {
    mockConnect.mockResolvedValue(undefined);

    await expect(transportManager.connect()).resolves.not.toThrow();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith(expect.any(StdioServerTransport));
  });

  test('should handle connection errors', async () => {
    const error = new Error('Connection failed');
    mockConnect.mockRejectedValue(error);

    await expect(transportManager.connectStdio()).rejects.toThrow('Connection failed');
  });
});
