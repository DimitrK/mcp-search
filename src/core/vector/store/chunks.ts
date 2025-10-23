import { promisifyRunParams, promisifyAll } from './connection';
import type pino from 'pino';
import { createChildLogger, withTiming } from '../../../utils/logger';
import { getPool } from './pool';

export interface ChunkRow {
  id: string;
  url: string;
  section_path?: string;
  text: string;
  tokens: number;
  embedding: number[];
}

export interface SimilarChunkRow {
  id: string;
  text: string;
  section_path?: string;
  score: number;
}

export async function upsertChunks(
  chunks: ChunkRow[],
  opts?: { correlationId?: string }
): Promise<void> {
  if (chunks.length === 0) return;

  const log = opts?.correlationId ? createChildLogger(opts.correlationId) : undefined;
  const pool = await getPool(opts);
  await withTiming(log ?? (console as unknown as pino.Logger), 'db.upsertChunks', async () =>
    pool.runInTransaction(async conn => {
      // Use batch insert with multiple VALUES for much better performance
      const batchSize = 100; // Process in batches to avoid parameter limits

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);

        // Detect embedding dimension from first chunk in batch
        const embeddingDim = batch[0]?.embedding?.length || 1536;

        // Build multi-row VALUES clause with array literals instead of parameters
        // DuckDB has issues with array parameters, so we embed them as literals
        const valuesClauses = batch
          .map((chunk, idx) => {
            const base = idx * 5; // Only 5 parameters now (no embedding parameter)
            const embeddingLiteral = `[${chunk.embedding.join(', ')}]::FLOAT[${embeddingDim}]`;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ${embeddingLiteral})`;
          })
          .join(', ');

        const sql = `INSERT OR REPLACE INTO chunks(id, url, section_path, text, tokens, embedding)
                     VALUES ${valuesClauses}`;

        // Flatten all parameters for this batch (no embedding in params now)
        const params = batch.flatMap(c => [
          c.id,
          c.url,
          c.section_path ?? null,
          c.text,
          c.tokens,
          // embedding is now embedded as literal in SQL
        ]);

        await promisifyRunParams(conn, sql, params);
      }
    })
  );
}

export async function similaritySearch(
  url: string,
  embedding: number[],
  limit: number,
  dimension = 1536
): Promise<SimilarChunkRow[]> {
  const pool = await getPool();
  return await pool.withConnection(async conn => {
    // Embed array as literal to avoid DuckDB parameter issues with arrays
    const embeddingLiteral = `[${embedding.join(', ')}]::FLOAT[${dimension}]`;
    const sql = `SELECT id, text, section_path,
       1 - (embedding <=> ${embeddingLiteral}) AS score
     FROM chunks
     WHERE url = $1
     ORDER BY embedding <-> ${embeddingLiteral}
     LIMIT $2`;
    const rows = await promisifyAll<SimilarChunkRow>(conn, sql, [url, limit]);
    return rows;
  });
}

/**
 * Retrieve all chunks for a given URL in document order (by creation timestamp).
 * Returns chunks without similarity scoring - useful for retrieving complete page content.
 *
 * @param url - The URL to retrieve chunks for
 * @param opts - Optional correlation ID for logging
 * @returns Array of chunks ordered by creation time (document flow order)
 */
export async function getAllChunksByUrl(
  url: string,
  opts?: { correlationId?: string }
): Promise<Omit<SimilarChunkRow, 'score'>[]> {
  const log = opts?.correlationId ? createChildLogger(opts.correlationId) : undefined;
  const pool = await getPool(opts);

  return await withTiming(
    log ?? (console as unknown as pino.Logger),
    'db.getAllChunksByUrl',
    async () =>
      pool.withConnection(async conn => {
        const sql = `SELECT id, text, section_path
         FROM chunks
         WHERE url = $1
         ORDER BY created_at ASC`;
        const rows = await promisifyAll<Omit<SimilarChunkRow, 'score'>>(conn, sql, [url]);
        return rows;
      })
  );
}

export async function deleteChunkById(id: string): Promise<void> {
  const pool = await getPool();
  await pool.withConnection(async conn => {
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE id = ?`, [id]);
  });
}

export async function deleteChunksByUrl(url: string): Promise<void> {
  const pool = await getPool();
  await pool.withConnection(async conn => {
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE url = ?`, [url]);
  });
}
