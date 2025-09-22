import duckdb from 'duckdb';
import { promisifyConnect, promisifyRunParams, promisifyAll } from './connection';

export interface DocumentRow {
  url: string;
  title?: string;
  etag?: string;
  last_modified?: string;
  last_crawled?: string; // ISO string
  content_hash?: string;
}

export async function upsertDocument(db: duckdb.Database, doc: DocumentRow): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
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
  } finally {
    conn.close();
  }
}
export async function getDocument(db: duckdb.Database, url: string): Promise<DocumentRow | null> {
  const conn = await promisifyConnect(db);
  try {
    const rows = await promisifyAll<DocumentRow>(conn, `SELECT * FROM documents WHERE url = ?`, [
      url,
    ]);
    return rows[0] ?? null;
  } finally {
    conn.close();
  }
}

export async function deleteDocument(db: duckdb.Database, url: string): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
    await promisifyRunParams(conn, `DELETE FROM documents WHERE url = ?`, [url]);
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE url = ?`, [url]);
  } finally {
    conn.close();
  }
}
