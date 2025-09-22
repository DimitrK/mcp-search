/* global process */
import { parentPort as threadParentPort, workerData, isMainThread } from 'worker_threads';
import duckdb from 'duckdb';
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

const VSS_INDEX = `
CREATE INDEX IF NOT EXISTS chunks_vss_idx ON chunks USING vss(embedding) WITH (metric='cosine');
`;

if (!parentPort && typeof process.send !== 'function') {
  throw new Error('This script must be run as a worker thread or child process.');
}

const dbPath = (workerData && workerData.dbPath) || process.env.DB_PATH;
mkdirSync(dirname(dbPath), { recursive: true });

let db;
try {
  db = new duckdb.Database(dbPath, err => {
    if (err) {
      (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
        type: 'init-error',
        error: err.message,
      });
      return;
    }

    db.exec(SCHEMA, err2 => {
      if (err2) {
        (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
          type: 'init-error',
          error: `Schema creation failed: ${err2.message}`,
        });
        return;
      }

      db.exec('INSTALL vss; LOAD vss;', err3 => {
        if (err3) {
          globalThis.console?.warn?.(
            '[DB-WORKER] VSS extension failed to load. VSS index will not be created.'
          );
        } else {
          db.exec(VSS_INDEX, err4 => {
            if (err4) {
              globalThis.console?.warn?.('[DB-WORKER] Failed to create VSS index.');
            }
          });
        }
        (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
          type: 'init-success',
        });
      });
    });
  });
} catch (e) {
  (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
    type: 'init-error',
    error: e.message,
  });
}

const onMessage = msg => {
  const { id, type, sql, params } = msg;
  if (!db) {
    (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
      id,
      type: 'error',
      error: 'Database not initialized',
    });
    return;
  }

  try {
    if (type === 'close') {
      db.close(err => {
        if (err) {
          (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
            id,
            type: 'close-error',
            error: err.message,
          });
        } else {
          (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
            id,
            type: 'close-success',
          });
        }
      });
      return;
    }

    const conn = db.connect();

    if (type === 'run') {
      conn.run(sql, ...(params || []), err => {
        if (err) {
          (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
            id,
            type: 'error',
            error: err.message,
          });
        } else {
          (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
            id,
            type: 'run-success',
            result: null,
          });
        }
      });
    } else if (type === 'all') {
      conn.all(sql, ...(params || []), (err, result) => {
        if (err) {
          (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
            id,
            type: 'error',
            error: err.message,
          });
        } else {
          (parentPort ? parentPort.postMessage.bind(parentPort) : process.send.bind(process))({
            id,
            type: 'all-success',
            result,
          });
        }
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
