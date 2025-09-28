import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EmbeddingIntegrationService } from '../../../../src/core/vector/embeddingIntegrationService';
import { EmbeddingProvider } from '../../../../src/core/vector/embeddingProvider';
import { EmbeddingError } from '../../../../src/mcp/errors';
import type { ContentChunk } from '../../../../src/core/content/chunker';

// Mock the vector store functions
jest.mock('../../../../src/core/vector/store', () => ({
  ensureEmbeddingConfig: jest.fn(),
  upsertChunks: jest.fn(),
  similaritySearch: jest.fn(),
}));

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
  createChildLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  withTiming: jest.fn(async (logger: any, name: string, fn: () => Promise<any>) => await fn()),
  generateCorrelationId: jest.fn(() => 'test-correlation-id'),
}));

import * as vectorStore from '../../../../src/core/vector/store';

const mockedEnsureEmbeddingConfig = vectorStore.ensureEmbeddingConfig as jest.MockedFunction<
  typeof vectorStore.ensureEmbeddingConfig
>;
const mockedUpsertChunks = vectorStore.upsertChunks as jest.MockedFunction<
  typeof vectorStore.upsertChunks
>;
const mockedSimilaritySearch = vectorStore.similaritySearch as jest.MockedFunction<
  typeof vectorStore.similaritySearch
>;

describe('EmbeddingIntegrationService', () => {
  let mockEmbeddingProvider: jest.Mocked<EmbeddingProvider>;
  let service: EmbeddingIntegrationService;

  beforeEach(() => {
    // Create a mock embedding provider
    mockEmbeddingProvider = {
      embed: jest.fn(),
      getDimension: jest.fn(),
      getModelName: jest.fn(),
      close: jest.fn(),
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with embedding provider', () => {
      mockEmbeddingProvider.getModelName.mockReturnValue('text-embedding-3-small');
      mockEmbeddingProvider.getDimension.mockReturnValue(1536);

      service = new EmbeddingIntegrationService(mockEmbeddingProvider);

      expect(service).toBeInstanceOf(EmbeddingIntegrationService);
    });
  });

  describe('storeWithEmbeddings', () => {
    beforeEach(() => {
      mockEmbeddingProvider.getModelName.mockReturnValue('text-embedding-3-small');
      mockEmbeddingProvider.getDimension.mockReturnValue(1536);
      service = new EmbeddingIntegrationService(mockEmbeddingProvider);
    });

    test('should generate embeddings and store chunks successfully', async () => {
      // Arrange
      const url = 'https://example.com';
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          text: 'First chunk content',
          tokens: 50,
          overlapTokens: 0,
          sectionPath: ['heading1'],
        },
        {
          id: 'chunk-2',
          text: 'Second chunk content',
          tokens: 60,
          overlapTokens: 5,
          sectionPath: ['heading2'],
        },
      ];

      const mockEmbeddings = [
        [0.1, 0.2, 0.3], // Embedding for chunk-1
        [0.4, 0.5, 0.6], // Embedding for chunk-2
      ];

      mockEmbeddingProvider.embed.mockResolvedValue(mockEmbeddings);
      mockedEnsureEmbeddingConfig.mockResolvedValue();
      mockedUpsertChunks.mockResolvedValue();

      // Act
      await service.storeWithEmbeddings(url, chunks);

      // Assert
      expect(mockedEnsureEmbeddingConfig).toHaveBeenCalledWith(
        'text-embedding-3-small',
        3, // dimension from mock embeddings
        expect.any(Object)
      );

      expect(mockEmbeddingProvider.embed).toHaveBeenCalledWith([
        'First chunk content',
        'Second chunk content',
      ]);

      expect(mockedUpsertChunks).toHaveBeenCalledWith(
        [
          {
            id: 'chunk-1',
            url,
            section_path: 'heading1',
            text: 'First chunk content',
            tokens: 50,
            embedding: [0.1, 0.2, 0.3],
          },
          {
            id: 'chunk-2',
            url,
            section_path: 'heading2',
            text: 'Second chunk content',
            tokens: 60,
            embedding: [0.4, 0.5, 0.6],
          },
        ],
        expect.any(Object)
      );
    });

    test('should handle chunks with no section path', async () => {
      const url = 'https://example.com';
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          text: 'Content without section path',
          tokens: 40,
          overlapTokens: 0,
          sectionPath: [],
        },
      ];

      const mockEmbeddings = [[0.1, 0.2, 0.3]];
      mockEmbeddingProvider.embed.mockResolvedValue(mockEmbeddings);
      mockedEnsureEmbeddingConfig.mockResolvedValue();
      mockedUpsertChunks.mockResolvedValue();

      await service.storeWithEmbeddings(url, chunks);

      expect(mockedUpsertChunks).toHaveBeenCalledWith(
        [
          {
            id: 'chunk-1',
            url,
            section_path: undefined, // Should be undefined for empty section path
            text: 'Content without section path',
            tokens: 40,
            embedding: [0.1, 0.2, 0.3],
          },
        ],
        expect.any(Object)
      );
    });

    test('should handle embedding provider failures', async () => {
      const url = 'https://example.com';
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          text: 'Some content',
          tokens: 30,
          overlapTokens: 0,
          sectionPath: [],
        },
      ];

      mockEmbeddingProvider.embed.mockRejectedValue(
        new EmbeddingError('API rate limit exceeded', 'http')
      );

      await expect(service.storeWithEmbeddings(url, chunks)).rejects.toThrow(
        'API rate limit exceeded'
      );

      // Ensure we didn't try to store anything
      expect(mockedEnsureEmbeddingConfig).not.toHaveBeenCalled();
      expect(mockedUpsertChunks).not.toHaveBeenCalled();
    });

    test('should handle database configuration failures', async () => {
      const url = 'https://example.com';
      const chunks: ContentChunk[] = [
        {
          id: 'chunk-1',
          text: 'Some content',
          tokens: 30,
          overlapTokens: 0,
          sectionPath: [],
        },
      ];

      const mockEmbeddings = [[0.1, 0.2, 0.3]];
      mockEmbeddingProvider.embed.mockResolvedValue(mockEmbeddings);
      mockedEnsureEmbeddingConfig.mockRejectedValue(new Error('Dimension mismatch'));

      await expect(service.storeWithEmbeddings(url, chunks)).rejects.toThrow('Dimension mismatch');

      // Ensure we didn't try to store chunks after config failure
      expect(mockedUpsertChunks).not.toHaveBeenCalled();
    });

    test('should handle empty chunks array', async () => {
      const url = 'https://example.com';
      const chunks: ContentChunk[] = [];

      await service.storeWithEmbeddings(url, chunks);

      // Should not call any provider or storage functions
      expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
      expect(mockedEnsureEmbeddingConfig).not.toHaveBeenCalled();
      expect(mockedUpsertChunks).not.toHaveBeenCalled();
    });
  });

  describe('searchSimilar', () => {
    beforeEach(() => {
      mockEmbeddingProvider.getModelName.mockReturnValue('text-embedding-3-small');
      mockEmbeddingProvider.getDimension.mockReturnValue(1536);
      service = new EmbeddingIntegrationService(mockEmbeddingProvider);
    });

    test('should search similar chunks successfully', async () => {
      // Arrange
      const url = 'https://example.com';
      const queryText = 'search query';
      const limit = 5;
      const queryEmbedding = [0.7, 0.8, 0.9];

      mockEmbeddingProvider.embed.mockResolvedValue([queryEmbedding]);

      const mockResults = [
        { id: 'chunk-1', text: 'Similar content', section_path: 'heading1', score: 0.95 },
        { id: 'chunk-2', text: 'Another match', section_path: 'heading2', score: 0.87 },
      ];
      mockedSimilaritySearch.mockResolvedValue(mockResults);

      // Act
      const results = await service.searchSimilar(url, queryText, limit);

      // Assert
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledWith([queryText]);
      expect(mockedSimilaritySearch).toHaveBeenCalledWith(url, queryEmbedding, limit, 3);
      expect(results).toEqual(mockResults);
    });

    test('should handle query embedding failures', async () => {
      const url = 'https://example.com';
      const queryText = 'search query';
      const limit = 5;

      mockEmbeddingProvider.embed.mockRejectedValue(
        new EmbeddingError('Embedding service unavailable', 'http')
      );

      await expect(service.searchSimilar(url, queryText, limit)).rejects.toThrow(
        'Embedding service unavailable'
      );

      expect(mockedSimilaritySearch).not.toHaveBeenCalled();
    });

    test('should handle similarity search failures', async () => {
      const url = 'https://example.com';
      const queryText = 'search query';
      const limit = 5;
      const queryEmbedding = [0.7, 0.8, 0.9];

      mockEmbeddingProvider.embed.mockResolvedValue([queryEmbedding]);
      mockedSimilaritySearch.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.searchSimilar(url, queryText, limit)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('close', () => {
    beforeEach(() => {
      mockEmbeddingProvider.getModelName.mockReturnValue('text-embedding-3-small');
      mockEmbeddingProvider.getDimension.mockReturnValue(1536);
      service = new EmbeddingIntegrationService(mockEmbeddingProvider);
    });

    test('should close embedding provider', async () => {
      await service.close();
      expect(mockEmbeddingProvider.close).toHaveBeenCalledTimes(1);
    });

    test('should handle provider close failures gracefully', async () => {
      mockEmbeddingProvider.close.mockRejectedValue(new Error('Close failed'));

      // Should not throw
      await expect(service.close()).resolves.not.toThrow();
    });
  });
});
