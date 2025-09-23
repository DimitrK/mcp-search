import { DatabaseError } from '../../../mcp/errors';
import { promisifyAll, promisifyRunParams, promisifyRun } from './connection';
import { getPool } from './pool';

export async function ensureEmbeddingConfig(modelName: string, dimension: number): Promise<void> {
  const pool = await getPool();
  await pool.withConnection(async conn => {
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
      await promisifyRunParams(conn, `INSERT INTO meta(key, value) VALUES (?, ?)`, [
        'embedding_model',
        modelName,
      ]);
    }
    if (existingDim === undefined) {
      await promisifyRunParams(conn, `INSERT INTO meta(key, value) VALUES (?, ?)`, [
        'embedding_dim',
        String(dimension),
      ]);
    }
  });
}

export async function clearEmbeddingConfig(): Promise<void> {
  const pool = await getPool();
  await pool.withConnection(async conn => {
    await promisifyRun(conn, `DELETE FROM meta WHERE key IN ('embedding_model','embedding_dim')`);
  });
}
