import { getEnvironment } from '../../../config/environment';
import { initDuckDb, DuckDbDatabaseLike, DuckDbConnectionLike } from './connection';

const GLOBAL_KEY = '__MPC_SEARCH__DUCKDB_POOL__';
const getGlobalPool = (): DuckDbPool | null =>
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] as DuckDbPool | null;
const setGlobalPool = (pool: DuckDbPool | null): void => {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = pool as unknown as object;
};

type Connection = DuckDbConnectionLike;

interface Waiter<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface PoolOptions {
  max?: number;
  acquireTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export class DuckDbPool {
  private db: DuckDbDatabaseLike;
  private max: number;
  private acquireTimeoutMs: number;
  private idleTimeoutMs: number;
  private total: number;
  private idle: Array<{ conn: Connection; lastUsed: number; idleTimer?: NodeJS.Timeout }>;
  private queue: Waiter<Connection>[];
  private isClosing: boolean;
  private closeFailures: number;

  constructor(db: DuckDbDatabaseLike, opts?: PoolOptions) {
    const env = getEnvironment();
    this.db = db;
    this.max = opts?.max ?? env.CONCURRENCY;
    this.acquireTimeoutMs = opts?.acquireTimeoutMs ?? env.REQUEST_TIMEOUT_MS;
    this.idleTimeoutMs = opts?.idleTimeoutMs ?? 30000;
    this.total = 0;
    this.idle = [];
    this.queue = [];
    this.isClosing = false;
    this.closeFailures = 0;
  }

  async acquire(): Promise<Connection> {
    if (this.isClosing) throw new Error('Pool is closing');

    const now = Date.now();
    while (this.idle.length > 0) {
      const item = this.idle.pop()!;
      if (item.idleTimer) item.idleTimer.unref();
      if (now - item.lastUsed > this.idleTimeoutMs) {
        this.discardConnection(item.conn);
        continue;
      }
      return item.conn;
    }

    if (this.total < this.max) {
      this.total += 1;
      return await this.createConnection();
    }

    return await new Promise<Connection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(w => w.timer === timer);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error('Pool acquire timeout'));
      }, this.acquireTimeoutMs);
      timer.unref();
      this.queue.push({ resolve, reject, timer });
    });
  }

  release(conn: Connection): void {
    if (this.isClosing) {
      this.shutdownDiscard(conn);
      return;
    }
    if (this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(conn);
    } else {
      const lastUsed = Date.now();
      const idleTimer = setTimeout(() => this.pruneIdle(conn), this.idleTimeoutMs);
      idleTimer.unref();
      this.idle.push({ conn, lastUsed, idleTimer });
    }
  }

  async withConnection<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  async runInTransaction<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    return await this.withConnection(async conn => {
      await this.run(conn, 'BEGIN');
      try {
        const result = await fn(conn);
        await this.run(conn, 'COMMIT');
        return result;
      } catch (e) {
        await this.run(conn, 'ROLLBACK').catch(() => undefined);
        throw e as Error;
      }
    });
  }

  private async run(conn: Connection, sql: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      conn.run(sql, err => (err ? reject(err) : resolve()));
    });
  }

  private async createConnection(): Promise<Connection> {
    return new Promise<Connection>((resolve, reject) => {
      this.db.connect((err: Error | null, conn: DuckDbConnectionLike) => {
        if (err) {
          reject(err);
        } else {
          resolve(conn);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.isClosing = true;
    this.queue.splice(0).forEach(w => {
      clearTimeout(w.timer);
      w.reject(new Error('Pool closing'));
    });
    this.idle.splice(0).forEach(i => {
      if (i.idleTimer) i.idleTimer.unref();
      this.shutdownDiscard(i.conn);
      this.total = Math.max(0, this.total - 1);
    });
  }

  private pruneIdle(conn: Connection): void {
    const idx = this.idle.findIndex(i => i.conn === conn);
    if (idx >= 0) {
      const c = this.idle[idx].conn;
      this.idle.splice(idx, 1);
      this.discardConnection(c);
    }
  }

  private finalizeClose(conn: Connection): void {
    try {
      conn.close();
    } catch {
      this.closeFailures += 1;
    }
    this.total = Math.max(0, this.total - 1);
  }

  private async maybeReplace(): Promise<void> {
    if (this.isClosing) return;
    if (this.total >= this.max) return;
    this.total += 1;
    const conn = await this.createConnection();
    if (this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(conn);
      return;
    }
    const idleTimer = setTimeout(() => this.pruneIdle(conn), this.idleTimeoutMs);
    idleTimer.unref();
    this.idle.push({ conn, lastUsed: Date.now(), idleTimer });
  }

  private discardConnection(conn: Connection): void {
    this.finalizeClose(conn);
    if (!this.isClosing) void this.maybeReplace();
  }

  private shutdownDiscard(conn: Connection): void {
    this.finalizeClose(conn);
  }

  getStats(): {
    total: number;
    idle: number;
    queueLength: number;
    closeFailures: number;
    max: number;
  } {
    return {
      total: this.total,
      idle: this.idle.length,
      queueLength: this.queue.length,
      closeFailures: this.closeFailures,
      max: this.max,
    };
  }
}

export async function getPool(opts?: { correlationId?: string }): Promise<DuckDbPool> {
  const existing = getGlobalPool();
  if (existing) return existing;
  const env = getEnvironment();
  const mode = env.VECTOR_DB_MODE ?? 'inline';
  if (mode === 'inline') {
    const db = await initDuckDb();
    const pool = new DuckDbPool(db);
    setGlobalPool(pool);
    return pool;
  }
  const { WorkerDuckDbPool } = await import('./workerPool');
  const worker = new WorkerDuckDbPool(env.REQUEST_TIMEOUT_MS, undefined, {
    correlationId: opts?.correlationId,
  }) as unknown as DuckDbPool;
  setGlobalPool(worker);
  return worker;
}

export async function closeGlobalPool(): Promise<void> {
  const p = getGlobalPool();
  if (!p) return;
  try {
    await p.close();
  } finally {
    setGlobalPool(null);
  }
}
