import duckdb from 'duckdb';
import { promisifyConnect, promisifyRun, promisifyRunParams, promisifyAll } from './connection';

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

export async function upsertChunks(db: duckdb.Database, chunks: ChunkRow[]): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
    await promisifyRun(conn, 'BEGIN');
    for (const c of chunks) {
      await promisifyRunParams(
        conn,
        `INSERT OR REPLACE INTO chunks(id, url, section_path, text, tokens, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [c.id, c.url, c.section_path ?? null, c.text, c.tokens, c.embedding]
      );
    }
    await promisifyRun(conn, 'COMMIT');
  } catch (e) {
    await promisifyRun(conn, 'ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    conn.close();
  }
}

export async function similaritySearch(
  db: duckdb.Database,
  url: string,
  embedding: number[],
  limit: number,
  dimension = 1536
): Promise<SimilarChunkRow[]> {
  const conn = await promisifyConnect(db);
  try {
    const cast = `?::FLOAT[${dimension}]`;
    const sql = `SELECT id, text, section_path,
       1 - (embedding <=> ${cast}) AS score
     FROM chunks
     WHERE url = ?
     ORDER BY embedding <-> ${cast}
     LIMIT ?`;
    const rows = await promisifyAll<SimilarChunkRow>(conn, sql, [embedding, url, embedding, limit]);
    return rows;
  } finally {
    conn.close();
  }
}

export async function deleteChunkById(db: duckdb.Database, id: string): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE id = ?`, [id]);
  } finally {
    conn.close();
  }
}

export async function deleteChunksByUrl(db: duckdb.Database, url: string): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE url = ?`, [url]);
  } finally {
    conn.close();
  }
}
