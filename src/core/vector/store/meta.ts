import duckdb from 'duckdb';
import { DatabaseError } from '../../../mcp/errors';
import { promisifyAll, promisifyConnect, promisifyRunParams } from './connection';

export async function ensureEmbeddingConfig(
  db: duckdb.Database,
  modelName: string,
  dimension: number
): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
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
  } finally {
    conn.close();
  }
}
