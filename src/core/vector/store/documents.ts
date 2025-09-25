import { promisifyRunParams, promisifyAll } from './connection';
import type pino from 'pino';
import { createChildLogger, withTiming } from '../../../utils/logger';
import { getPool } from './pool';

export interface DocumentRow {
  url: string;
  title?: string;
  etag?: string;
  last_modified?: string;
  last_crawled?: string; // ISO string
  content_hash?: string;
}

export async function upsertDocument(
  doc: DocumentRow,
  opts?: { correlationId?: string }
): Promise<void> {
  const log = opts?.correlationId ? createChildLogger(opts.correlationId) : undefined;
  const pool = await getPool(opts);
  await withTiming(log ?? (console as unknown as pino.Logger), 'db.upsertDocument', async () =>
    pool.withConnection(async conn => {
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
    })
  );
}
export async function getDocument(
  url: string,
  opts?: { correlationId?: string }
): Promise<DocumentRow | null> {
  const pool = await getPool(opts);
  return await pool.withConnection(async conn => {
    const rows = await promisifyAll<unknown>(
      conn,
      `SELECT url, title, etag, last_modified, last_crawled, content_hash FROM documents WHERE url = ?`,
      [url]
    );
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    if (Array.isArray(row)) {
      return {
        url: row[0] as string,
        title: row[1] as string | undefined,
        etag: row[2] as string | undefined,
        last_modified: row[3] as string | undefined,
        last_crawled: row[4] as string | undefined,
        content_hash: row[5] as string | undefined,
      };
    } else {
      const o = row as Record<string, unknown>;
      return {
        url: o.url as string,
        title: o.title as string | undefined,
        etag: o.etag as string | undefined,
        last_modified: o.last_modified as string | undefined,
        last_crawled: o.last_crawled as string | undefined,
        content_hash: o.content_hash as string | undefined,
      };
    }
  });
}

export async function deleteDocument(
  url: string,
  opts?: { correlationId?: string }
): Promise<void> {
  const pool = await getPool(opts);
  await pool.runInTransaction(async conn => {
    await promisifyRunParams(conn, `DELETE FROM documents WHERE url = ?`, [url]);
    await promisifyRunParams(conn, `DELETE FROM chunks WHERE url = ?`, [url]);
  });
}
