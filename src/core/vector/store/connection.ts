import duckdb from 'duckdb';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { getDatabasePath } from '../../../config/environment';
import { DatabaseError } from '../../../mcp/errors';
import { runSchema } from './schema';

export async function initDuckDb(): Promise<duckdb.Database> {
  try {
    const dbPath = getDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new duckdb.Database(dbPath);
    await runSchema(db);
    return db;
  } catch (e) {
    throw new DatabaseError((e as Error).message);
  }
}

export function promisifyConnect(db: duckdb.Database): Promise<duckdb.Connection> {
  return new Promise((resolve, reject) => {
    db.connect((err, conn) => (err ? reject(err) : resolve(conn)));
  });
}
export function promisifyRun(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, err => (err ? reject(err) : resolve()));
  });
}

export function promisifyRunParams(
  conn: duckdb.Connection,
  sql: string,
  params: unknown[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    (
      conn as unknown as {
        run: (sql: string, params: unknown[], cb: (err: Error | null) => void) => void;
      }
    ).run(sql, params, (err: Error | null) => (err ? reject(err) : resolve()));
  });
}

export function promisifyAll<T = unknown>(
  conn: duckdb.Connection,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, rows?: T[]) => (err ? reject(err) : resolve(rows ?? []));
    const c = conn as unknown as {
      all: (
        sql: string,
        paramsOrCb: unknown[] | ((err: Error | null, rows?: T[]) => void),
        cb?: (err: Error | null, rows?: T[]) => void
      ) => void;
    };
    if (params) c.all(sql, params, cb);
    else c.all(sql, cb);
  });
}
