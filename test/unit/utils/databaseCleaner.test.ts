import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DatabaseCleaner } from '../../../src/utils/databaseCleaner';
import type { DuckDbConnectionLike } from '../../../src/core/vector/store/connection';

// Mock the connection module with proper typing
jest.mock('../../../src/core/vector/store/connection');

const mockPromisifyAll = jest.fn() as jest.MockedFunction<() => Promise<unknown[]>>;
const mockPromisifyRun = jest.fn() as jest.MockedFunction<() => Promise<void>>;
const mockPromisifyRunParams = jest.fn() as jest.MockedFunction<() => Promise<void>>;

describe('DatabaseCleaner', () => {
  let mockConnection: jest.Mocked<DuckDbConnectionLike>;
  let cleaner: DatabaseCleaner;

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
    cleaner = new DatabaseCleaner(mockConnection);
  });

  describe('cleanup', () => {
    it('should perform dry run correctly', async () => {
      // Mock the count queries
      mockPromisifyAll
        .mockResolvedValueOnce([
          { url: 'url1', content_hash: 'hash1' },
          { url: 'url2', content_hash: 'hash2' },
        ]) // 2 documents to delete
        .mockResolvedValueOnce([{ count: 5 }]); // 5 chunks to delete

      const result = await cleaner.cleanup({
        daysOld: 30,
        shouldVacuum: false,
        dryRun: true,
      });

      expect(result).toEqual({
        documentsDeleted: 2,
        chunksDeleted: 5,
        spaceSavedBytes: 4500, // 2 * 1000 + 5 * 500
      });

      // Verify no actual deletion SQL was executed
      expect(mockPromisifyRun).not.toHaveBeenCalled();
      expect(mockPromisifyRunParams).not.toHaveBeenCalled();
    });

    it('should perform actual cleanup when not dry run', async () => {
      // Mock the count queries
      mockPromisifyAll
        .mockResolvedValueOnce([{ url: 'url1', content_hash: 'hash1' }]) // 1 document to delete
        .mockResolvedValueOnce([{ count: 3 }]); // 3 chunks to delete

      // Mock the transaction operations
      mockPromisifyRun
        .mockResolvedValueOnce(undefined) // BEGIN TRANSACTION
        .mockResolvedValueOnce(undefined) // DELETE chunks
        .mockResolvedValueOnce(undefined) // DELETE documents
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await cleaner.cleanup({
        daysOld: 30,
        shouldVacuum: false,
        dryRun: false,
      });

      expect(result).toEqual({
        documentsDeleted: 1,
        chunksDeleted: 3,
        spaceSavedBytes: 2500, // 1 * 1000 + 3 * 500
      });

      // Verify transaction was used
      expect(mockPromisifyRun).toHaveBeenCalledWith(mockConnection, 'BEGIN TRANSACTION');
      expect(mockPromisifyRun).toHaveBeenCalledWith(mockConnection, 'COMMIT');
    });

    it('should perform vacuum when requested', async () => {
      // Mock empty results (no old data)
      mockPromisifyAll
        .mockResolvedValueOnce([]) // No documents to delete
        .mockResolvedValueOnce([{ count: 0 }]); // No chunks to delete

      // Mock vacuum operation
      mockPromisifyRun.mockResolvedValueOnce(undefined); // VACUUM

      const result = await cleaner.cleanup({
        daysOld: 30,
        shouldVacuum: true,
        dryRun: false,
      });

      expect(result.documentsDeleted).toBe(0);
      expect(result.chunksDeleted).toBe(0);
      expect(mockPromisifyRun).toHaveBeenCalledWith(mockConnection, 'VACUUM');
    });

    it('should rollback on error during cleanup', async () => {
      // Mock the count queries
      mockPromisifyAll
        .mockResolvedValueOnce([{ url: 'url1', content_hash: 'hash1' }])
        .mockResolvedValueOnce([{ count: 3 }]);

      // Mock transaction start but fail on chunk deletion
      mockPromisifyRun
        .mockResolvedValueOnce(undefined) // BEGIN TRANSACTION
        .mockRejectedValueOnce(new Error('Deletion failed')); // DELETE chunks fails

      await expect(
        cleaner.cleanup({
          daysOld: 30,
          shouldVacuum: false,
          dryRun: false,
        })
      ).rejects.toThrow('Deletion failed');

      // Verify rollback was called
      expect(mockPromisifyRun).toHaveBeenCalledWith(mockConnection, 'ROLLBACK');
    });

    it('should handle BigInt values in count queries', async () => {
      // Mock BigInt responses
      mockPromisifyAll
        .mockResolvedValueOnce([]) // No documents
        .mockResolvedValueOnce([{ count: BigInt(0) }]); // 0 chunks as BigInt

      const result = await cleaner.cleanup({
        daysOld: 30,
        shouldVacuum: false,
        dryRun: true,
      });

      expect(result.documentsDeleted).toBe(0);
      expect(result.chunksDeleted).toBe(0);
    });

    it('should validate days parameter', async () => {
      await expect(
        cleaner.cleanup({
          daysOld: -1,
          shouldVacuum: false,
          dryRun: true,
        })
      ).rejects.toThrow('Invalid days value');
    });
  });

  describe('vacuum', () => {
    it('should perform vacuum operation', async () => {
      mockPromisifyRun.mockResolvedValueOnce(undefined);

      await cleaner.vacuum();

      expect(mockPromisifyRun).toHaveBeenCalledWith(mockConnection, 'VACUUM');
    });

    it('should handle vacuum errors', async () => {
      mockPromisifyRun.mockRejectedValueOnce(new Error('Vacuum failed'));

      await expect(cleaner.vacuum()).rejects.toThrow('Database vacuum failed: Vacuum failed');
    });
  });

  describe('getDatabaseSize', () => {
    it('should return database size', async () => {
      mockPromisifyAll.mockResolvedValueOnce([{ database_size: 1024000 }]);

      const size = await cleaner.getDatabaseSize();

      expect(size).toBe(1024000);
      expect(mockPromisifyAll).toHaveBeenCalledWith(mockConnection, 'PRAGMA database_size');
    });

    it('should handle database size errors', async () => {
      mockPromisifyAll.mockRejectedValueOnce(new Error('Size query failed'));

      await expect(cleaner.getDatabaseSize()).rejects.toThrow(
        'Failed to get database size: Size query failed'
      );
    });
  });
});
