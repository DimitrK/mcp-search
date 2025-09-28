import { promisifyConnect, promisifyRun, promisifyAll, DuckDbDatabaseLike } from './connection';

export async function runSchema(db: DuckDbDatabaseLike): Promise<void> {
  const conn = await promisifyConnect(db);
  try {
    const skipVss =
      process.env.SKIP_VSS_INSTALL === '1' ||
      process.env.SKIP_VSS_INSTALL?.toLowerCase() === 'true';

    if (!skipVss) {
      try {
        // Install and load VSS extension (allow_unsigned_extensions set during instance creation)
        await promisifyRun(conn, `INSTALL vss;`);
        await promisifyRun(conn, `LOAD vss;`);
        if (process.env.NODE_ENV !== 'test') {
          console.log('✓ VSS extension loaded successfully');
        }
      } catch (e) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`VSS extension failed to load: ${(e as Error).message}`);
        }
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
    // Get embedding dimension from meta table, default to 1536 for backward compatibility
    let embeddingDim = 1536;
    try {
      const dimRows = await promisifyAll<{ value: string }>(
        conn,
        `SELECT value FROM meta WHERE key='embedding_dim'`
      );
      if (dimRows && dimRows.length > 0) {
        embeddingDim = parseInt(dimRows[0].value, 10);
      }
    } catch (e) {
      // Meta table might not exist yet, use default dimension
      if (process.env.NODE_ENV !== 'test') {
        console.log(`Using default embedding dimension ${embeddingDim}`);
      }
    }

    await promisifyRun(
      conn,
      `CREATE TABLE IF NOT EXISTS chunks (
         id TEXT PRIMARY KEY,
         url TEXT NOT NULL,
         section_path TEXT,
         text TEXT NOT NULL,
         tokens INTEGER NOT NULL,
         embedding FLOAT[${embeddingDim}],
         created_at TIMESTAMP DEFAULT now(),
         updated_at TIMESTAMP DEFAULT now()
       );`
    );
    await promisifyRun(conn, `CREATE INDEX IF NOT EXISTS chunks_url_idx ON chunks(url);`);

    // Note: VSS extension in DuckDB uses table functions (vss_match, array_cosine_similarity)
    // instead of indexes for similarity search. No VSS index creation needed.
  } finally {
    conn.close();
  }
}
