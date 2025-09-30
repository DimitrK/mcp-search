import type { DuckDbConnectionLike } from '../core/vector/store/connection';
import { promisifyAll, promisifyRun, promisifyRunParams } from '../core/vector/store/connection';

export interface CleanupResult {
  documentsDeleted: number;
  chunksDeleted: number;
  spaceSavedBytes: number;
}

export interface CleanupOptions {
  daysOld: number;
  shouldVacuum: boolean;
  dryRun: boolean;
}

export class DatabaseCleaner {
  constructor(private connection: DuckDbConnectionLike) {}

  async cleanup(options: CleanupOptions): Promise<CleanupResult> {
    try {
      if (options.daysOld < 0) {
        throw new Error('Invalid days value');
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.daysOld);
      const cutoffIso = cutoffDate.toISOString();

      // First, find what will be deleted (for reporting and dry run)
      const documentsToDeleteResult = await promisifyAll<{ url: string; content_hash: string }>(
        this.connection,
        'SELECT url, content_hash FROM documents WHERE last_crawled < ?',
        [cutoffIso]
      );

      const chunksToDeleteResult = await promisifyAll<{ count: number | bigint }>(
        this.connection,
        'SELECT COUNT(*) as count FROM chunks WHERE url IN (SELECT url FROM documents WHERE last_crawled < ?)',
        [cutoffIso]
      );

      const documentsToDelete = documentsToDeleteResult.length;
      const rawChunksToDelete = chunksToDeleteResult[0]?.count || 0;
      const chunksToDelete =
        typeof rawChunksToDelete === 'bigint' ? Number(rawChunksToDelete) : rawChunksToDelete;

      // Estimate space savings (very rough)
      const estimatedSpaceSavings = documentsToDelete * 1000 + chunksToDelete * 500; // bytes per doc/chunk estimate

      if (options.dryRun) {
        return {
          documentsDeleted: documentsToDelete,
          chunksDeleted: chunksToDelete,
          spaceSavedBytes: estimatedSpaceSavings,
        };
      }

      // Begin transaction for atomic cleanup
      await promisifyRun(this.connection, 'BEGIN TRANSACTION');

      try {
        // Delete chunks first (foreign key constraint)
        await promisifyRunParams(
          this.connection,
          'DELETE FROM chunks WHERE url IN (SELECT url FROM documents WHERE last_crawled < ?)',
          [cutoffIso]
        );

        // Delete documents
        await promisifyRunParams(this.connection, 'DELETE FROM documents WHERE last_crawled < ?', [
          cutoffIso,
        ]);

        // Vacuum if requested
        if (options.shouldVacuum) {
          await promisifyRun(this.connection, 'VACUUM');
        }

        await promisifyRun(this.connection, 'COMMIT');

        return {
          documentsDeleted: documentsToDelete,
          chunksDeleted: chunksToDelete,
          spaceSavedBytes: estimatedSpaceSavings,
        };
      } catch (cleanupError) {
        await promisifyRun(this.connection, 'ROLLBACK');
        throw cleanupError;
      }
    } catch (error) {
      throw new Error(
        `Database cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async vacuum(): Promise<void> {
    try {
      await promisifyRun(this.connection, 'VACUUM');
    } catch (error) {
      throw new Error(
        `Database vacuum failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getDatabaseSize(): Promise<number> {
    try {
      const sizeResult = await promisifyAll<{ database_size: number }>(
        this.connection,
        'PRAGMA database_size'
      );
      return sizeResult[0]?.database_size || 0;
    } catch (error) {
      throw new Error(
        `Failed to get database size: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
