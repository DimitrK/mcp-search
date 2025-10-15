import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SimilaritySearchManager } from '../../../../src/core/similarity/similaritySearchManager';
import { createEmbeddingProvider } from '../../../../src/core/vector/embeddingProvider';
import { EmbeddingIntegrationService } from '../../../../src/core/vector/embeddingIntegrationService';
import type { ContentChunk } from '../../../../src/core/content/chunker';
import { consolidateOverlappingChunks } from '../../../../src/core/content/chunkConsolidator';
import { getEnvironment } from '../../../../src/config/environment';

// Mock dependencies
jest.mock('../../../../src/core/vector/embeddingProvider');
jest.mock('../../../../src/core/vector/embeddingIntegrationService');
jest.mock('../../../../src/core/content/chunkConsolidator');
jest.mock('../../../../src/config/environment');
jest.mock('../../../../src/utils/logger', () => ({
  createChildLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  })),
  withTiming: jest.fn((_logger: unknown, _event: unknown, fn: () => unknown) => fn()),
}));

const mockCreateEmbeddingProvider = jest.mocked(createEmbeddingProvider);
const mockEmbeddingIntegrationService = jest.mocked(EmbeddingIntegrationService);
const mockConsolidateOverlappingChunks = jest.mocked(consolidateOverlappingChunks);

describe('SimilaritySearchManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLogger: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockEmbeddingProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockEmbeddingService: any;
  // Shared manager instance for cleanup
  let manager: SimilaritySearchManager | null = null;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      child: jest.fn(function (this: any) {
        return this;
      }),
    };

    // Mock getEnvironment
    const mockGetEnvironment = jest.mocked(getEnvironment);
    mockGetEnvironment.mockReturnValue({
      EMBEDDING_SERVER_URL: 'https://test.embedding.server',
      EMBEDDING_SERVER_API_KEY: 'test-embedding-api-key',
      EMBEDDING_MODEL_NAME: 'text-embedding-ada-002',
      EMBEDDING_BATCH_SIZE: 8,
      NODE_ENV: 'test',
      GOOGLE_API_KEY: 'test-google-key',
      GOOGLE_SEARCH_ENGINE_ID: 'test-engine-id',
      SIMILARITY_THRESHOLD: 0.6,
      EMBEDDING_TOKENS_SIZE: 512,
      REQUEST_TIMEOUT_MS: 20000,
      CONCURRENCY: 2,
      DATA_DIR: '/tmp/test-data',
      ENABLE_SIMILARITY_SEARCH: 'true',
      VECTOR_DB_MODE: 'inline' as const,
    });

    // Setup mock instances
    mockEmbeddingProvider = {
      embed: jest.fn(),
      close: jest.fn(),
      getModelName: jest.fn(() => 'text-embedding-ada-002'),
      getDimension: jest.fn(() => 1536),
    };

    mockEmbeddingService = {
      searchSimilar: jest.fn(),
      storeWithEmbeddings: jest.fn(),
      close: jest.fn(),
    };

    mockCreateEmbeddingProvider.mockResolvedValue(mockEmbeddingProvider);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockEmbeddingIntegrationService.mockReturnValue(mockEmbeddingService as any);
  });

  afterEach(async () => {
    // Always cleanup manager instances to prevent connection leaks
    if (manager) {
      await manager.close();
      manager = null;
    }
  });

  describe('create', () => {
    it('should create a manager instance successfully', async () => {
      manager = await SimilaritySearchManager.create(mockLogger, {
        correlationId: 'test-correlation',
      });

      expect(manager).not.toBeNull();
      expect(mockCreateEmbeddingProvider).toHaveBeenCalledWith({
        type: 'http',
        serverUrl: 'https://test.embedding.server',
        apiKey: 'test-embedding-api-key',
        modelName: 'text-embedding-ada-002',
        batchSize: 8,
      });
      expect(mockEmbeddingIntegrationService).toHaveBeenCalledWith(mockEmbeddingProvider);
    });

    it('should return null when embedding provider initialization fails (graceful degradation)', async () => {
      mockCreateEmbeddingProvider.mockRejectedValue(new Error('Embedding service unavailable'));

      manager = await SimilaritySearchManager.create(mockLogger, {
        correlationId: 'test-correlation',
      });

      expect(manager).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('storeWithEmbeddings', () => {
    it('should store content chunks with embeddings', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          text: 'Test content',
          tokens: 10,
          overlapTokens: 0,
          sectionPath: ['Section 1'],
        },
      ];

      await manager!.storeWithEmbeddings('https://example.com', chunks, {
        correlationId: 'test',
      });

      expect(mockEmbeddingService.storeWithEmbeddings).toHaveBeenCalledWith(
        'https://example.com',
        chunks,
        { correlationId: 'test' }
      );
    });
  });

  describe('searchSimilar', () => {
    it('should perform similarity search and return consolidated results', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      const mockSearchResults = [
        { id: 'chunk-1', text: 'Result 1', score: 0.9, section_path: 'Section 1' },
        { id: 'chunk-2', text: 'Result 2', score: 0.8, section_path: 'Section 2' },
        { id: 'chunk-3', text: 'Result 3', score: 0.5, section_path: 'Section 3' }, // Below threshold
      ];

      const mockConsolidatedResults = [
        {
          id: 'chunk-1',
          text: 'Result 1',
          score: 0.9,
          section_path: 'Section 1',
          sourceChunkIds: ['chunk-1'],
        },
        {
          id: 'chunk-2',
          text: 'Result 2',
          score: 0.8,
          section_path: 'Section 2',
          sourceChunkIds: ['chunk-2'],
        },
      ];

      mockEmbeddingService.searchSimilar.mockResolvedValue(mockSearchResults);
      mockConsolidateOverlappingChunks.mockReturnValue(mockConsolidatedResults);

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10, {
        correlationId: 'test',
      });

      expect(mockEmbeddingService.searchSimilar).toHaveBeenCalledWith(
        'https://example.com',
        'test query',
        10,
        { correlationId: 'test' }
      );
      expect(results).toHaveLength(2); // Only results above threshold (0.6)
      expect(results[0].score).toBe(0.9);
      expect(results[1].score).toBe(0.8);
    });

    it('should return empty array on search failure (graceful degradation)', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockRejectedValue(new Error('Search failed'));

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10, {
        correlationId: 'test',
      });

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should classify timeout errors correctly', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockRejectedValue(new Error('Request timeout'));

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'network',
          retryable: true,
        }),
        expect.any(String)
      );
    });

    it('should classify rate limit errors correctly', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockRejectedValue(new Error('Rate limit exceeded: 429'));

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'rate_limit',
          retryable: true,
        }),
        expect.any(String)
      );
    });

    it('should classify database errors correctly', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockRejectedValue(new Error('Database connection failed'));

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'database',
          retryable: true,
        }),
        expect.any(String)
      );
    });
  });

  describe('searchMultiple', () => {
    it('should process multiple queries in parallel with concurrency control', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      const mockSearchResults = [
        {
          id: 'chunk-1',
          text: 'Result 1',
          score: 0.9,
          section_path: 'Section 1',
          sourceChunkIds: ['chunk-1'],
        },
      ];

      mockEmbeddingService.searchSimilar.mockResolvedValue(mockSearchResults);
      mockConsolidateOverlappingChunks.mockReturnValue(mockSearchResults);

      const queries = ['query1', 'query2', 'query3', 'query4'];
      const results = await manager!.searchMultiple(queries, 'https://example.com', 10, {
        correlationId: 'test',
        concurrency: 2,
      });

      expect(results.size).toBe(4);
      expect(results.get('query1')).toBeDefined();
      expect(results.get('query2')).toBeDefined();
      expect(results.get('query3')).toBeDefined();
      expect(results.get('query4')).toBeDefined();

      // Verify all queries were processed
      expect(mockEmbeddingService.searchSimilar).toHaveBeenCalledTimes(4);
    });

    it('should handle individual query failures gracefully', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      let callCount = 0;
      mockEmbeddingService.searchSimilar.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Query failed'));
        }
        return Promise.resolve([
          { id: 'chunk-1', text: 'Result', score: 0.9, section_path: 'Section' },
        ]);
      });

      mockConsolidateOverlappingChunks.mockReturnValue([
        {
          id: 'chunk-1',
          text: 'Result',
          score: 0.9,
          section_path: 'Section',
          sourceChunkIds: ['chunk-1'],
        },
      ]);

      const queries = ['query1', 'query2', 'query3'];
      const results = await manager!.searchMultiple(queries, 'https://example.com', 10);

      expect(results.size).toBe(3);
      expect(results.get('query1')).toHaveLength(1); // Success
      expect(results.get('query2')).toEqual([]); // Failed - empty array
      expect(results.get('query3')).toHaveLength(1); // Success
    });

    it('should use default concurrency from environment', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockResolvedValue([]);
      mockConsolidateOverlappingChunks.mockReturnValue([]);

      const queries = ['query1', 'query2', 'query3', 'query4'];
      await manager!.searchMultiple(queries, 'https://example.com', 10);

      // Default CONCURRENCY is 2 from mock environment
      // Should process in 2 batches
      expect(mockEmbeddingService.searchSimilar).toHaveBeenCalledTimes(4);
    });

    it('should process single query correctly', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      const mockSearchResults = [
        {
          id: 'chunk-1',
          text: 'Result 1',
          score: 0.9,
          section_path: 'Section 1',
          sourceChunkIds: ['chunk-1'],
        },
      ];

      mockEmbeddingService.searchSimilar.mockResolvedValue(mockSearchResults);
      mockConsolidateOverlappingChunks.mockReturnValue(mockSearchResults);

      const results = await manager!.searchMultiple(['single query'], 'https://example.com', 10);

      expect(results.size).toBe(1);
      expect(results.get('single query')).toHaveLength(1);
    });
  });

  describe('close', () => {
    it('should close embedding service successfully', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      await manager!.close();

      expect(mockEmbeddingService.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully without throwing', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.close.mockRejectedValue(new Error('Close failed'));

      // Should not throw
      await expect(manager!.close()).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('error classification', () => {
    it('should handle non-Error objects', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockRejectedValue('String error');

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'embedding',
        }),
        expect.any(String)
      );
    });

    it('should classify HTTP status errors', async () => {
      manager = await SimilaritySearchManager.create(mockLogger);
      expect(manager).not.toBeNull();

      mockEmbeddingService.searchSimilar.mockRejectedValue(
        new Error('Request failed with status 503')
      );

      const results = await manager!.searchSimilar('https://example.com', 'test query', 10);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorType: 'embedding',
        }),
        expect.any(String)
      );
    });
  });
});
