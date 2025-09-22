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
    const anyDb = db as unknown as {
      connect:
        | ((cb: (err: Error | null, conn: duckdb.Connection) => void) => void)
        | (() => duckdb.Connection);
    };

    // Attempt synchronous connect first (supported by duckdb node bindings)
    try {
      const maybeConn = (anyDb.connect as unknown as () => unknown).call(anyDb) as unknown;
      if (maybeConn && typeof maybeConn === 'object') {
        const conn = maybeConn as duckdb.Connection;
        // Heuristic: connection objects have run/all methods
        if (typeof (conn as unknown as { run?: unknown }).run === 'function') {
          resolve(conn);
          return;
        }
      }
    } catch {
      // ignore and fallback to callback style
    }

    // Fallback to callback-based connect
    try {
      (anyDb.connect as (cb: (err: Error | null, conn: duckdb.Connection) => void) => void).call(
        anyDb,
        (err: Error | null, conn: duckdb.Connection) => (err ? reject(err) : resolve(conn))
      );
    } catch (e) {
      reject(e as Error);
    }
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
    const c = conn as unknown as {
      run: (...args: unknown[]) => void;
    };
    const cb = (err: Error | null) => (err ? reject(err) : resolve());
    (c.run as unknown as (sql: string, ...rest: unknown[]) => void)(sql, ...params, cb);
  });
}

export function promisifyAll<T = unknown>(
  conn: duckdb.Connection,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, rows?: T[]) => (err ? reject(err) : resolve(rows ?? []));
    const c = conn as unknown as { all: (...args: unknown[]) => void };
    (c.all as unknown as (sql: string, ...rest: unknown[]) => void)(
      sql,
      ...(params && params.length > 0 ? [...params, cb] : [cb])
    );
  });
}
