import type { DuckDbConnectionLike } from '../core/vector/store/connection';
import { promisifyAll } from '../core/vector/store/connection';

export interface DatabaseStats {
  totalDocuments: number;
  totalChunks: number;
  databaseSizeBytes: number;
  oldestDocument: string | null;
  newestDocument: string | null;
  embeddingModel: string | null;
  embeddingDimension: number | null;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columnCount: number;
  sizeBytes: number;
}

export interface DocumentInfo {
  url: string;
  title: string | null;
  lastCrawled: string;
  contentHash: string;
  chunkCount: number;
  totalTokens: number;
}

export class DatabaseInspector {
  constructor(private connection: DuckDbConnectionLike) {}

  async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      // Get document count
      const docCountResult = await promisifyAll<{ count: number | bigint }>(
        this.connection,
        'SELECT COUNT(*) as count FROM documents'
      );
      const rawDocCount = docCountResult[0]?.count || 0;
      const totalDocuments = typeof rawDocCount === 'bigint' ? Number(rawDocCount) : rawDocCount;

      // Get chunk count
      const chunkCountResult = await promisifyAll<{ count: number | bigint }>(
        this.connection,
        'SELECT COUNT(*) as count FROM chunks'
      );
      const rawChunkCount = chunkCountResult[0]?.count || 0;
      const totalChunks = typeof rawChunkCount === 'bigint' ? Number(rawChunkCount) : rawChunkCount;

      // Get oldest and newest documents
      const oldestResult = await promisifyAll<{ last_crawled: string }>(
        this.connection,
        'SELECT last_crawled FROM documents ORDER BY last_crawled ASC LIMIT 1'
      );
      const newestResult = await promisifyAll<{ last_crawled: string }>(
        this.connection,
        'SELECT last_crawled FROM documents ORDER BY last_crawled DESC LIMIT 1'
      );

      const oldestDocument = oldestResult[0]?.last_crawled || null;
      const newestDocument = newestResult[0]?.last_crawled || null;

      // Get embedding configuration
      const metaResult = await promisifyAll<{ key: string; value: string }>(
        this.connection,
        "SELECT key, value FROM meta WHERE key IN ('embedding_model', 'embedding_dim')"
      );

      const metaMap = new Map(metaResult.map(row => [row.key, row.value]));
      const embeddingModel = metaMap.get('embedding_model') || null;
      const embeddingDimStr = metaMap.get('embedding_dim');
      const embeddingDimension = embeddingDimStr ? parseInt(embeddingDimStr, 10) : null;

      // Get database size (rough estimate based on content)
      const databaseSizeBytes = totalDocuments * 1000 + totalChunks * 500;

      return {
        totalDocuments,
        totalChunks,
        databaseSizeBytes,
        oldestDocument,
        newestDocument,
        embeddingModel,
        embeddingDimension,
      };
    } catch (error) {
      throw new Error(
        `Failed to get database stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getTableInfo(): Promise<TableInfo[]> {
    try {
      // Get all table names
      const tablesResult = await promisifyAll<{ table_name: string }>(
        this.connection,
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
      );

      const tableInfos: TableInfo[] = [];

      for (const table of tablesResult) {
        const tableName = table.table_name;

        try {
          // Get row count
          const countResult = await promisifyAll<{ count: number | bigint }>(
            this.connection,
            `SELECT COUNT(*) as count FROM "${tableName}"`
          );
          const rawRowCount = countResult[0]?.count || 0;
          const rowCount = typeof rawRowCount === 'bigint' ? Number(rawRowCount) : rawRowCount;

          // Get column count
          const columnsResult = await promisifyAll<{ count: number | bigint }>(
            this.connection,
            `SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = '${tableName}'`
          );
          const rawColumnCount = columnsResult[0]?.count || 0;
          const columnCount =
            typeof rawColumnCount === 'bigint' ? Number(rawColumnCount) : rawColumnCount;

          // Approximate size (this is a rough estimate)
          const sizeBytes = rowCount * columnCount * 50; // Very rough estimate

          tableInfos.push({
            name: tableName,
            rowCount,
            columnCount,
            sizeBytes,
          });
        } catch (tableError) {
          // Skip tables we can't access
          console.warn(`Could not inspect table ${tableName}:`, tableError);
        }
      }

      return tableInfos;
    } catch (error) {
      throw new Error(
        `Failed to get table info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getDocumentInfo(url: string): Promise<DocumentInfo | null> {
    try {
      // Get document details
      const docResult = await promisifyAll<{
        url: string;
        title: string | null;
        last_crawled: string;
        content_hash: string;
      }>(
        this.connection,
        'SELECT url, title, last_crawled, content_hash FROM documents WHERE url = ?',
        [url]
      );

      if (docResult.length === 0) {
        return null;
      }

      const doc = docResult[0];

      // Get chunk count and total tokens for this document
      const chunkStatsResult = await promisifyAll<{
        chunk_count: number | bigint;
        total_tokens: number | bigint | null;
      }>(
        this.connection,
        'SELECT COUNT(*) as chunk_count, SUM(tokens) as total_tokens FROM chunks WHERE url = ?',
        [url]
      );

      const chunkStats = chunkStatsResult[0];
      const rawChunkCount = chunkStats?.chunk_count || 0;
      const rawTotalTokens = chunkStats?.total_tokens || 0;

      const chunkCount = typeof rawChunkCount === 'bigint' ? Number(rawChunkCount) : rawChunkCount;
      const totalTokens =
        typeof rawTotalTokens === 'bigint' ? Number(rawTotalTokens) : rawTotalTokens;

      return {
        url: doc.url,
        title: doc.title,
        lastCrawled: doc.last_crawled,
        contentHash: doc.content_hash,
        chunkCount,
        totalTokens,
      };
    } catch (error) {
      throw new Error(
        `Failed to get document info for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
