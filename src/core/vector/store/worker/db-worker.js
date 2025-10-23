/* global process */
import { parentPort as threadParentPort, workerData, isMainThread } from 'worker_threads';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const parentPort = isMainThread ? null : threadParentPort;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS documents (
  url TEXT PRIMARY KEY,
  title TEXT,
  etag TEXT,
  last_modified TEXT,
  last_crawled TIMESTAMP,
  content_hash TEXT
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  section_path TEXT,
  text TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  embedding FLOAT[1536],
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chunks_url_idx ON chunks(url);
`;

if (!parentPort && typeof process.send !== 'function') {
  throw new Error('This script must be run as a worker thread or child process.');
}

const dbPath = (workerData && workerData.dbPath) || process.env.DB_PATH;
mkdirSync(dirname(dbPath), { recursive: true });

let conn;
(async () => {
  try {
    const instance = await DuckDBInstance.create(dbPath, {
      allow_unsigned_extensions: 'true',
    });
    conn = await instance.connect();
    await conn.run(SCHEMA);

    const skipVss =
      process.env.SKIP_VSS_INSTALL === '1' ||
      (process.env.SKIP_VSS_INSTALL || '').toLowerCase() === 'true';

    const finishInit = () =>
      (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
        type: 'init-success',
      });

    if (skipVss) {
      finishInit();
    } else {
      try {
        // Install and load VSS extension (allow_unsigned_extensions set during instance creation)
        await conn.run('INSTALL vss');
        await conn.run('LOAD vss');
        // VSS extension loaded successfully - no console output to avoid MCP protocol interference

        // Note: VSS extension uses table functions (vss_match, array_cosine_similarity)
        // instead of indexes for similarity search. No index creation needed.
      } catch {
        // VSS extension failed to load - no console output to avoid MCP protocol interference
      }
      finishInit();
    }
  } catch (e) {
    (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
      type: 'init-error',
      error: e.message,
    });
  }
})().catch(e => {
  (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
    type: 'init-error',
    error: e.message,
  });
});

const convertToPositionalParams = sql => {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
};

const onMessage = async msg => {
  const { id, type, sql, params } = msg;
  if (!conn) {
    (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
      id,
      type: 'error',
      error: 'Database not initialized',
    });
    return;
  }

  try {
    if (type === 'close') {
      try {
        conn.closeSync();
      } catch {
        // ignore close errors
      }

      (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
        id,
        type: 'close-success',
      });
      if (parentPort) {
        parentPort.close();
      } else {
        process.exit(0);
      }
      return;
    }

    if (type === 'run') {
      const sqlWithPositionalParams =
        params && params.length > 0 ? convertToPositionalParams(sql) : sql;
      await conn.run(sqlWithPositionalParams, params && params.length > 0 ? params : undefined);
      (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
        id,
        type: 'run-success',
        result: null,
      });
    } else if (type === 'all') {
      const sqlWithPositionalParams =
        params && params.length > 0 ? convertToPositionalParams(sql) : sql;
      const rs = await conn.runAndReadAll(
        sqlWithPositionalParams,
        params && params.length > 0 ? params : undefined
      );
      const arr = rs.getRowObjects();
      const rows = arr.map(row => {
        const o = {};
        for (const [k, v] of Object.entries(row)) {
          o[k.toLowerCase()] = v;
        }
        return o;
      });
      const payload = parentPort
        ? rows
        : JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
        id,
        type: 'all-success',
        result: payload,
      });
    }
  } catch (error) {
    (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
      id,
      type: 'error',
      error: error.message,
    });
  }
};

if (parentPort) parentPort.on('message', onMessage);
else process.on('message', onMessage);
