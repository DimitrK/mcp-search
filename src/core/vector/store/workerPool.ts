import { dbAll, dbRun, closeDb } from './worker/db-client';

type AnyFn = (sql: string, ...args: unknown[]) => void;
interface WorkerConnShape {
  run: AnyFn;
  all: AnyFn;
  close: () => void;
}

type Callback = (err: Error | null, result?: unknown) => void;

function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker operation timeout')), timeoutMs);
    p.then(v => {
      clearTimeout(timer);
      resolve(v);
    }).catch(e => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function makeFakeConnection(timeoutMs: number): WorkerConnShape {
  return {
    run(sql: string, ...args: unknown[]): void {
      const cb = args[args.length - 1] as Callback;
      const params = args.slice(0, -1) as unknown[];
      withTimeout(dbRun(sql, params), timeoutMs)
        .then(() => cb(null))
        .catch((e: Error) => cb(e));
    },
    all(sql: string, ...args: unknown[]) {
      const cb = args[args.length - 1] as Callback;
      const params = args.slice(0, -1) as unknown[];
      withTimeout(dbAll(sql, params), timeoutMs)
        .then(rows => cb(null, rows))
        .catch((e: Error) => cb(e));
    },
    close() {},
  };
}

export class WorkerDuckDbPool {
  private stats = { total: 1, idle: 0, queueLength: 0, closeFailures: 0, max: 1 };
  private readonly conn: WorkerConnShape;
  private readonly acquireTimeoutMs: number;

  constructor(acquireTimeoutMs: number) {
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.conn = makeFakeConnection(this.acquireTimeoutMs);
  }

  async acquire(): Promise<WorkerConnShape> {
    return this.conn;
  }

  release(_conn: WorkerConnShape): void {}

  async withConnection<T>(fn: (conn: WorkerConnShape) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      return await fn(c);
    } finally {
      this.release(c);
    }
  }

  async runInTransaction<T>(fn: (conn: WorkerConnShape) => Promise<T>): Promise<T> {
    return await this.withConnection(fn);
  }

  async close(): Promise<void> {
    await closeDb();
  }

  getStats() {
    return this.stats;
  }
}
