import duckdb from 'duckdb';
import { getEnvironment } from '../../../config/environment';
import { initDuckDb } from './connection';

type Connection = duckdb.Connection;

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
  private db: duckdb.Database;
  private max: number;
  private acquireTimeoutMs: number;
  private idleTimeoutMs: number;
  private total: number;
  private idle: Array<{ conn: Connection; lastUsed: number; idleTimer?: NodeJS.Timeout }>;
  private queue: Waiter<Connection>[];
  private isClosing: boolean;
  private closeFailures: number;

  constructor(db: duckdb.Database, opts?: PoolOptions) {
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
        this.evict(item.conn, true);
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

  async runInTransaction<T>(
    fn: (conn: Connection) => Promise<T>,
    mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE' = 'DEFERRED'
  ): Promise<T> {
    return await this.withConnection(async conn => {
      await this.run(conn, `BEGIN ${mode}`);
      try {
        const result = await fn(conn);
        await this.run(conn, 'COMMIT');
        return result;
      } catch (e) {
        await this.run(conn, 'ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  }

  private async run(conn: Connection, sql: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      conn.run(sql, err => (err ? reject(err) : resolve()));
    });
  }

  private async createConnection(): Promise<Connection> {
    return await new Promise((resolve, reject) => {
      this.db.connect((err, conn) => (err ? reject(err) : resolve(conn)));
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
      this.safeClose(i.conn);
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

let globalPool: DuckDbPool | null = null;
export async function getPool(): Promise<DuckDbPool> {
  if (globalPool) return globalPool;
  const db = await initDuckDb();
  globalPool = new DuckDbPool(db);
  return globalPool;
}
