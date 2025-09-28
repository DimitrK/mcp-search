import { DatabaseError } from '../../../mcp/errors';
import { promisifyAll, promisifyRunParams, promisifyRun } from './connection';
import type pino from 'pino';
import { createChildLogger, withTiming } from '../../../utils/logger';
import { getPool } from './pool';

export async function ensureEmbeddingConfig(
  modelName: string,
  dimension: number,
  opts?: { correlationId?: string }
): Promise<void> {
  const log = opts?.correlationId ? createChildLogger(opts.correlationId) : undefined;
  const pool = await getPool(opts);
  await withTiming(
    log ?? (console as unknown as pino.Logger),
    'db.ensureEmbeddingConfig',
    async () =>
      pool.withConnection(async conn => {
        const modelRows = await promisifyAll<{ value: string }>(
          conn,
          `SELECT value FROM meta WHERE key='embedding_model'`
        );
        const dimRows = await promisifyAll<{ value: string }>(
          conn,
          `SELECT value FROM meta WHERE key='embedding_dim'`
        );

        const existingModel = modelRows[0]?.value;
        const existingDim = dimRows[0]?.value ? Number(dimRows[0].value) : undefined;

        if (existingModel && existingModel !== modelName) {
          throw new DatabaseError(`Embedding model mismatch: ${existingModel} != ${modelName}`);
        }

        // Handle chunks table creation/recreation
        const needsChunksTable = existingDim === undefined || existingDim !== dimension;

        if (needsChunksTable) {
          if (existingDim !== undefined) {
            log?.warn(
              { existingDim, newDim: dimension },
              'Embedding dimension changed - recreating chunks table'
            );
          } else {
            log?.info({ dimension }, 'Creating chunks table with embedding dimension');
          }

          // Drop and recreate chunks table with correct dimension
          await promisifyRun(conn, `DROP TABLE IF EXISTS chunks;`);
          await promisifyRun(
            conn,
            `CREATE TABLE chunks (
               id TEXT PRIMARY KEY,
               url TEXT NOT NULL,
               section_path TEXT,
               text TEXT NOT NULL,
               tokens INTEGER NOT NULL,
               embedding FLOAT[${dimension}],
               created_at TIMESTAMP DEFAULT now(),
               updated_at TIMESTAMP DEFAULT now()
             );`
          );
          await promisifyRun(conn, `CREATE INDEX IF NOT EXISTS chunks_url_idx ON chunks(url);`);

          log?.info({ dimension }, 'Chunks table ready with correct embedding dimension');
        }

        // Update embedding configuration
        if (!existingModel) {
          await promisifyRunParams(
            conn,
            `INSERT INTO meta(key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            ['embedding_model', modelName]
          );
        }
        if (existingDim === undefined || existingDim !== dimension) {
          await promisifyRunParams(
            conn,
            `INSERT INTO meta(key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            ['embedding_dim', String(dimension)]
          );
        }
      })
  );
}

export async function clearEmbeddingConfig(opts?: { correlationId?: string }): Promise<void> {
  const log = opts?.correlationId ? createChildLogger(opts.correlationId) : undefined;
  const pool = await getPool(opts);
  await withTiming(
    log ?? (console as unknown as pino.Logger),
    'db.clearEmbeddingConfig',
    async () =>
      pool.withConnection(async conn => {
        // Clear all embedding-related data for clean slate
        await promisifyRun(conn, `DROP TABLE IF EXISTS chunks;`);
        await promisifyRun(
          conn,
          `DELETE FROM meta WHERE key IN ('embedding_model','embedding_dim')`
        );

        log?.info({}, 'Cleared embedding configuration and chunks table');
      })
  );
}
