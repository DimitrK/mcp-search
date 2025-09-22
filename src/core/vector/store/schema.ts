import duckdb from 'duckdb';
import { promisifyConnect, promisifyRun } from './connection';

export async function runSchema(db: duckdb.Database): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
    const skipVss =
      process.env.SKIP_VSS_INSTALL === '1' ||
      process.env.SKIP_VSS_INSTALL?.toLowerCase() === 'true';

    if (!skipVss) {
      try {
        await promisifyRun(conn, `INSTALL vss;`);
      } catch {
        // ignore
      }
      try {
        await promisifyRun(conn, `LOAD vss;`);
      } catch {
        // ignore
      }
    }

    await promisifyRun(conn, `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);
    await promisifyRun(
      conn,
      `CREATE TABLE IF NOT EXISTS documents (
         url TEXT PRIMARY KEY,
         title TEXT,
         etag TEXT,
         last_modified TEXT,
         last_crawled TIMESTAMP,
         content_hash TEXT
       );`
    );
    await promisifyRun(
      conn,
      `CREATE TABLE IF NOT EXISTS chunks (
         id TEXT PRIMARY KEY,
         url TEXT NOT NULL,
         section_path TEXT,
         text TEXT NOT NULL,
         tokens INTEGER NOT NULL,
         embedding FLOAT[1536],
         created_at TIMESTAMP DEFAULT now(),
         updated_at TIMESTAMP DEFAULT now()
       );`
    );
    await promisifyRun(conn, `CREATE INDEX IF NOT EXISTS chunks_url_idx ON chunks(url);`);
    if (!skipVss) {
      try {
        await promisifyRun(
          conn,
          `CREATE INDEX IF NOT EXISTS chunks_vss_idx ON chunks USING vss(embedding) WITH (metric='cosine');`
        );
      } catch {
        // ignore
      }
    }
  } finally {
    conn.close();
  }
}
