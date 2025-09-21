import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { McpSearchServer } from '../../src/server';

// Mock dependencies
jest.mock('../../src/services/initialization');
jest.mock('../../src/transport/manager');

const MockInitializationService =
  require('../../src/services/initialization').InitializationService;
const MockTransportManager = require('../../src/transport/manager').TransportManager;

describe('McpSearchServer', () => {
  let server: McpSearchServer;
  let mockInitService: any;
  let mockTransportManager: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockInitService = {
      initialize: jest.fn(),
    };
    mockTransportManager = {
      connect: jest.fn(),
    };

    MockInitializationService.mockImplementation(() => mockInitService);
    MockTransportManager.mockImplementation(() => mockTransportManager);

    server = new McpSearchServer();
  });

  test('should create McpSearchServer instance', () => {
    expect(server).toBeInstanceOf(McpSearchServer);
  });

  test('should initialize successfully', async () => {
    mockInitService.initialize.mockResolvedValue(undefined);
    await expect(server.initialize()).resolves.not.toThrow();
    expect(mockInitService.initialize).toHaveBeenCalledTimes(1);
  });

  test('should connect successfully', async () => {
    mockTransportManager.connect.mockResolvedValue(undefined);
    await expect(server.connect()).resolves.not.toThrow();
    expect(mockTransportManager.connect).toHaveBeenCalledTimes(1);
  });
});
