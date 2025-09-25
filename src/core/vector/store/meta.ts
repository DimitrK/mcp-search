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
        if (existingDim !== undefined && existingDim !== dimension) {
          throw new DatabaseError(`Embedding dimension mismatch: ${existingDim} != ${dimension}`);
        }

        if (!existingModel) {
          await promisifyRunParams(
            conn,
            `INSERT INTO meta(key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            ['embedding_model', modelName]
          );
        }
        if (existingDim === undefined) {
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
        await promisifyRun(
          conn,
          `DELETE FROM meta WHERE key IN ('embedding_model','embedding_dim')`
        );
      })
  );
}
