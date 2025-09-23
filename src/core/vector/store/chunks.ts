import { promisifyRunParams, promisifyAll } from './connection';
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

export async function upsertChunks(chunks: ChunkRow[]): Promise<void> {
  const pool = await getPool();
  await pool.runInTransaction(async conn => {
    for (const c of chunks) {
      await promisifyRunParams(
        conn,
        `INSERT OR REPLACE INTO chunks(id, url, section_path, text, tokens, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [c.id, c.url, c.section_path ?? null, c.text, c.tokens, c.embedding]
      );
    }
  });
}

export async function similaritySearch(
  url: string,
  embedding: number[],
  limit: number,
  dimension = 1536
): Promise<SimilarChunkRow[]> {
  const pool = await getPool();
  return await pool.withConnection(async conn => {
    const cast = `?::FLOAT[${dimension}]`;
    const sql = `SELECT id, text, section_path,
       1 - (embedding <=> ${cast}) AS score
     FROM chunks
     WHERE url = ?
     ORDER BY embedding <-> ${cast}
     LIMIT ?`;
    const rows = await promisifyAll<SimilarChunkRow>(conn, sql, [embedding, url, embedding, limit]);
    return rows;
  });
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
