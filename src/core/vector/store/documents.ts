import { promisifyRunParams, promisifyAll } from './connection';
import { getPool } from './pool';

export interface DocumentRow {
  url: string;
  title?: string;
  etag?: string;
  last_modified?: string;
  last_crawled?: string; // ISO string
  content_hash?: string;
}

export async function upsertDocument(doc: DocumentRow): Promise<void> {
  const pool = await getPool();
  await pool.withConnection(async conn => {
    await promisifyRunParams(
      conn,
      `INSERT OR REPLACE INTO documents(url, title, etag, last_modified, last_crawled, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        doc.url,
        doc.title ?? null,
        doc.etag ?? null,
        doc.last_modified ?? null,
        doc.last_crawled ?? null,
        doc.content_hash ?? null,
      ]
    );
  });
}
export async function getDocument(url: string): Promise<DocumentRow | null> {
  const pool = await getPool();
  return await pool.withConnection(async conn => {
    const rows = await promisifyAll<DocumentRow>(conn, `SELECT * FROM documents WHERE url = ?`, [
      url,
    ]);
    return rows[0] ?? null;
  });
}

export async function deleteDocument(url: string): Promise<void> {
  const pool = await getPool();
  await pool.runInTransaction(async conn => {
    await promisifyRunParams(conn, `DELETE FROM documents WHERE url = ?`, [url]);
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE url = ?`, [url]);
  });
}
