import { DuckDBInstance, DuckDBValue } from '@duckdb/node-api';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { getDatabasePath } from '../../../config/environment';
import { DatabaseError } from '../../../mcp/errors';
import { runSchema } from './schema';

// Minimal adapter types to satisfy existing call sites
export type DuckDbConnectionLike = {
  run: (sql: string, cb: (err: Error | null) => void) => void;
  all: (sql: string, cb: (err: Error | null, rows?: unknown[]) => void) => void;
  close: () => void;
};

export type DuckDbDatabaseLike = {
  connect: (cb: (err: Error | null, conn: DuckDbConnectionLike) => void) => void;
};

export async function initDuckDb(): Promise<DuckDbDatabaseLike> {
  try {
    const basePath = getDatabasePath();
    const dbPath = process.env.JEST_WORKER_ID
      ? basePath.replace(/\.duckdb$/, `.w${process.env.JEST_WORKER_ID}.duckdb`)
      : basePath;
    mkdirSync(dirname(dbPath), { recursive: true });
    const instance = await DuckDBInstance.create(dbPath, {
      allow_unsigned_extensions: 'true',
    });
    // Create an adapter around node-api to look like old duckdb.Database
    const adapterDb: DuckDbDatabaseLike = {
      connect: (cb: (err: Error | null, conn: DuckDbConnectionLike) => void) => {
        // Enforce callback style; DuckDbPool will try a sync path first
        if (typeof cb !== 'function') {
          throw new Error('callback required');
        }
        instance
          .connect()
          .then(conn => {
            const convertToPositionalParams = (sql: string): string => {
              let paramIndex = 1;
              return sql.replace(/\?/g, () => `$${paramIndex++}`);
            };
            const adapted: DuckDbConnectionLike = {
              run: (sql: string, ...rest: unknown[]) => {
                const cb2 = rest[rest.length - 1] as (err: Error | null) => void;
                const params = rest.slice(0, -1) as DuckDBValue[];
                const sqlWithPositionalParams =
                  params.length > 0 ? convertToPositionalParams(sql) : sql;
                conn
                  .run(sqlWithPositionalParams, params.length > 0 ? params : undefined)
                  .then(() => cb2(null))
                  .catch(e => cb2(e));
              },
              all: (sql: string, ...rest: unknown[]) => {
                const cb2 = rest[rest.length - 1] as (err: Error | null, rows?: unknown[]) => void;
                const params = rest.slice(0, -1) as DuckDBValue[];
                const sqlWithPositionalParams =
                  params.length > 0 ? convertToPositionalParams(sql) : sql;
                conn
                  .runAndReadAll(sqlWithPositionalParams, params.length > 0 ? params : undefined)
                  .then(reader => {
                    const rows = reader.getRowObjects().map((row: Record<string, DuckDBValue>) => {
                      const o: Record<string, DuckDBValue> = {};
                      for (const [k, v] of Object.entries(row)) {
                        o[k.toLowerCase()] = v;
                      }
                      return o;
                    });
                    cb2(null, rows);
                  })
                  .catch(e => cb2(e));
              },
              close: () => {
                try {
                  conn.closeSync();
                } catch {
                  /* noop */
                }
              },
            };
            cb(null, adapted);
          })
          .catch(e => cb(e, undefined as unknown as DuckDbConnectionLike));
      },
    };
    await runSchema(adapterDb as unknown as DuckDbDatabaseLike as unknown as never);
    return adapterDb;
  } catch (e) {
    throw new DatabaseError((e as Error).message);
  }
}

export function promisifyConnect(db: DuckDbDatabaseLike): Promise<DuckDbConnectionLike> {
  return new Promise((resolve, reject) => {
    db.connect((err, conn) => (err ? reject(err) : resolve(conn)));
  });
}
export function promisifyRun(conn: DuckDbConnectionLike, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, err => (err ? reject(err) : resolve()));
  });
}

export function promisifyRunParams(
  conn: DuckDbConnectionLike,
  sql: string,
  params: unknown[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = conn;
    const cb = (err: Error | null) => (err ? reject(err) : resolve());
    (c.run as (sql: string, ...rest: unknown[]) => void)(sql, ...params, cb);
  });
}

export function promisifyAll<T = unknown>(
  conn: DuckDbConnectionLike,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, rows?: T[]) => (err ? reject(err) : resolve(rows ?? []));
    const c = conn;
    (c.all as (sql: string, ...rest: unknown[]) => void)(
      sql,
      ...(params && params.length > 0 ? [...params, cb] : [cb])
    );
  });
}
