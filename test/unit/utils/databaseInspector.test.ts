import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DatabaseInspector } from '../../../src/utils/databaseInspector';
import type { DuckDbConnectionLike } from '../../../src/core/vector/store/connection';

// Mock the connection module with proper typing
const mockPromisifyAll = jest.fn() as jest.MockedFunction<() => Promise<unknown[]>>;
const mockPromisifyRun = jest.fn() as jest.MockedFunction<() => Promise<void>>;
const mockPromisifyRunParams = jest.fn() as jest.MockedFunction<() => Promise<void>>;

jest.mock('../../../src/core/vector/store/connection');

describe('DatabaseInspector', () => {
  let mockConnection: jest.Mocked<DuckDbConnectionLike>;
  let inspector: DatabaseInspector;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup connection module mocks
    const connectionModule = jest.requireMock('../../../src/core/vector/store/connection') as {
      promisifyAll: typeof mockPromisifyAll;
      promisifyRun: typeof mockPromisifyRun;
      promisifyRunParams: typeof mockPromisifyRunParams;
    };
    connectionModule.promisifyAll = mockPromisifyAll;
    connectionModule.promisifyRun = mockPromisifyRun;
    connectionModule.promisifyRunParams = mockPromisifyRunParams;

    mockConnection = {
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(),
      connect: jest.fn(),
    } as any;
    inspector = new DatabaseInspector(mockConnection);
  });

  describe('getDatabaseStats', () => {
    it('should return correct database statistics', async () => {
      // Mock the promisifyAll calls
      mockPromisifyAll
        .mockResolvedValueOnce([{ count: 5 }]) // documents count
        .mockResolvedValueOnce([{ count: 15 }]) // chunks count
        .mockResolvedValueOnce([{ last_crawled: '2024-01-01T00:00:00Z' }]) // oldest document
        .mockResolvedValueOnce([{ last_crawled: '2024-01-05T00:00:00Z' }]) // newest document
        .mockResolvedValueOnce([
          { key: 'embedding_model', value: 'text-embedding-ada-002' },
          { key: 'embedding_dim', value: '1536' },
        ]); // meta data

      const stats = await inspector.getDatabaseStats();

      expect(stats).toEqual({
        totalDocuments: 5,
        totalChunks: 15,
        databaseSizeBytes: 12500, // 5 * 1000 + 15 * 500
        oldestDocument: '2024-01-01T00:00:00Z',
        newestDocument: '2024-01-05T00:00:00Z',
        embeddingModel: 'text-embedding-ada-002',
        embeddingDimension: 1536,
      });

      // Verify all promisifyAll calls were made with correct parameters
      expect(mockPromisifyAll).toHaveBeenCalledTimes(5);
      expect(mockPromisifyAll).toHaveBeenNthCalledWith(
        1,
        mockConnection,
        'SELECT COUNT(*) as count FROM documents'
      );
      expect(mockPromisifyAll).toHaveBeenNthCalledWith(
        2,
        mockConnection,
        'SELECT COUNT(*) as count FROM chunks'
      );
    });

    it('should handle BigInt values from COUNT queries', async () => {
      // Reset mock for this test
      mockPromisifyAll.mockClear();

      // Mock BigInt responses for all getDatabaseStats calls
      mockPromisifyAll
        .mockResolvedValueOnce([{ count: BigInt(10) }]) // documents count as BigInt
        .mockResolvedValueOnce([{ count: BigInt(25) }]) // chunks count as BigInt
        .mockResolvedValueOnce([{ last_crawled: '2024-01-01T00:00:00Z' }]) // oldest document
        .mockResolvedValueOnce([{ last_crawled: '2024-01-05T00:00:00Z' }]) // newest document
        .mockResolvedValueOnce([]); // meta data (empty)

      const stats = await inspector.getDatabaseStats();

      expect(stats.totalDocuments).toBe(10);
      expect(stats.totalChunks).toBe(25);
      expect(typeof stats.totalDocuments).toBe('number');
      expect(typeof stats.totalChunks).toBe('number');
    });

    it('should handle missing embedding configuration', async () => {
      mockPromisifyAll
        .mockResolvedValueOnce([{ count: 3 }])
        .mockResolvedValueOnce([{ count: 8 }])
        .mockResolvedValueOnce([{ last_crawled: '2024-01-01T00:00:00Z' }])
        .mockResolvedValueOnce([{ last_crawled: '2024-01-03T00:00:00Z' }])
        .mockResolvedValueOnce([]); // No embedding config

      const stats = await inspector.getDatabaseStats();

      expect(stats.embeddingModel).toBeNull();
      expect(stats.embeddingDimension).toBeNull();
    });

    it('should handle database errors', async () => {
      mockPromisifyAll.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(inspector.getDatabaseStats()).rejects.toThrow(
        'Failed to get database stats: Database connection failed'
      );
    });
  });

  describe('getTableInfo', () => {
    it('should return table information', async () => {
      // Mock table list
      mockPromisifyAll
        .mockResolvedValueOnce([
          { table_name: 'documents' },
          { table_name: 'chunks' },
          { table_name: 'meta' },
        ])
        // Mock counts for each table
        .mockResolvedValueOnce([{ count: 5 }]) // documents count
        .mockResolvedValueOnce([{ count: 8 }]) // documents columns
        .mockResolvedValueOnce([{ count: 15 }]) // chunks count
        .mockResolvedValueOnce([{ count: 9 }]) // chunks columns
        .mockRejectedValueOnce(new Error('Meta table access denied')); // meta count fails

      const tables = await inspector.getTableInfo();

      expect(tables).toHaveLength(2);
      expect(tables[0]).toEqual({
        name: 'documents',
        rowCount: 5,
        columnCount: 8,
        sizeBytes: 2000, // 5 * 8 * 50
      });
      expect(tables[1]).toEqual({
        name: 'chunks',
        rowCount: 15,
        columnCount: 9,
        sizeBytes: 6750, // 15 * 9 * 50
      });
    });

    it('should handle BigInt column counts', async () => {
      mockPromisifyAll
        .mockResolvedValueOnce([{ table_name: 'test_table' }])
        .mockResolvedValueOnce([{ count: BigInt(10) }]) // row count as BigInt
        .mockResolvedValueOnce([{ count: BigInt(5) }]); // column count as BigInt

      const tables = await inspector.getTableInfo();

      expect(tables[0].rowCount).toBe(10);
      expect(tables[0].columnCount).toBe(5);
    });

    it('should skip inaccessible tables', async () => {
      mockPromisifyAll
        .mockResolvedValueOnce([
          { table_name: 'accessible_table' },
          { table_name: 'inaccessible_table' },
        ])
        .mockResolvedValueOnce([{ count: 5 }]) // accessible_table rows
        .mockResolvedValueOnce([{ count: 3 }]) // accessible_table columns
        .mockRejectedValueOnce(new Error('Table access denied')); // inaccessible_table fails

      const tables = await inspector.getTableInfo();

      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe('accessible_table');
    });
  });

  describe('getDocumentInfo', () => {
    it('should return document information', async () => {
      const testUrl = 'https://example.com/test';

      mockPromisifyAll
        .mockResolvedValueOnce([
          {
            url: testUrl,
            title: 'Test Document',
            last_crawled: '2024-01-01T00:00:00Z',
            content_hash: 'abc123',
          },
        ])
        .mockResolvedValueOnce([
          {
            chunk_count: 3,
            total_tokens: 150,
          },
        ]);

      const docInfo = await inspector.getDocumentInfo(testUrl);

      expect(docInfo).toEqual({
        url: testUrl,
        title: 'Test Document',
        lastCrawled: '2024-01-01T00:00:00Z',
        contentHash: 'abc123',
        chunkCount: 3,
        totalTokens: 150,
      });
    });

    it('should handle BigInt values in chunk stats', async () => {
      const testUrl = 'https://example.com/test';

      mockPromisifyAll
        .mockResolvedValueOnce([
          {
            url: testUrl,
            title: null,
            last_crawled: '2024-01-01T00:00:00Z',
            content_hash: 'abc123',
          },
        ])
        .mockResolvedValueOnce([{ chunk_count: BigInt(5), total_tokens: BigInt(250) }]);

      const docInfo = await inspector.getDocumentInfo(testUrl);

      expect(docInfo?.chunkCount).toBe(5);
      expect(docInfo?.totalTokens).toBe(250);
      expect(typeof docInfo?.chunkCount).toBe('number');
      expect(typeof docInfo?.totalTokens).toBe('number');
    });

    it('should return null for non-existent document', async () => {
      mockPromisifyAll.mockResolvedValueOnce([]);

      const docInfo = await inspector.getDocumentInfo('https://example.com/nonexistent');

      expect(docInfo).toBeNull();
    });
  });
});
