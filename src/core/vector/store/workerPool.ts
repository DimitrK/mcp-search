import {
  dbAll as defaultDbAll,
  dbRun as defaultDbRun,
  closeDb as defaultCloseDb,
} from './worker/db-client';
import { logger, createChildLogger } from '../../../utils/logger';

type AnyFn = (sql: string, ...args: unknown[]) => void;
interface WorkerConnShape {
  run: AnyFn;
  all: AnyFn;
  close: () => void;
}

type Callback = (err: Error | null, result?: unknown) => void;

function withTimeout<T>(p: Promise<T>, timeoutMs: number, log: typeof logger = logger): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      log.warn({ timeoutMs }, 'Worker operation timeout');
      reject(new Error('Worker operation timeout'));
    }, timeoutMs);
    p.then(v => {
      clearTimeout(timer);
      resolve(v);
    }).catch(e => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

type DbOps = {
  dbRun: (sql: string, params?: unknown[]) => Promise<void>;
  dbAll: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  closeDb: () => Promise<void>;
};

function makeFakeConnection(timeoutMs: number, ops: DbOps, log: typeof logger): WorkerConnShape {
  return {
    run(sql: string, ...args: unknown[]): void {
      const cb = args[args.length - 1] as Callback;
      const params = args.slice(0, -1) as unknown[];
      log.debug({ op: 'run', sql, paramsLength: params.length, timeoutMs }, 'Worker DB run');
      withTimeout(ops.dbRun(sql, params), timeoutMs, log)
        .then(() => cb(null))
        .catch((e: Error) => cb(e));
    },
    all(sql: string, ...args: unknown[]) {
      const cb = args[args.length - 1] as Callback;
      const params = args.slice(0, -1) as unknown[];
      log.debug({ op: 'all', sql, paramsLength: params.length, timeoutMs }, 'Worker DB all');
      withTimeout(ops.dbAll(sql, params), timeoutMs, log)
        .then(rows => cb(null, rows))
        .catch((e: Error) => cb(e));
    },
    close() {},
  };
}

export class WorkerDuckDbPool {
  private readonly conn: WorkerConnShape;
  private readonly acquireTimeoutMs: number;
  private readonly ops: DbOps;
  private log = logger;
  private closeFailures = 0;
  private isClosed = false;

  constructor(
    acquireTimeoutMs: number,
    overrides?: Partial<DbOps>,
    opts?: { correlationId?: string }
  ) {
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.ops = {
      dbRun: defaultDbRun,
      dbAll: defaultDbAll,
      closeDb: defaultCloseDb,
      ...overrides,
    };
    if (opts?.correlationId) this.log = createChildLogger(opts.correlationId);
    this.log.info({ acquireTimeoutMs: this.acquireTimeoutMs }, 'WorkerDuckDbPool created');
    this.conn = makeFakeConnection(this.acquireTimeoutMs, this.ops, this.log);
  }

  async acquire(): Promise<WorkerConnShape> {
    this.log.debug('WorkerDuckDbPool acquire');
    return this.conn;
  }

  release(_conn: WorkerConnShape): void {}

  async withConnection<T>(fn: (conn: WorkerConnShape) => Promise<T>): Promise<T> {
    this.log.debug('WorkerDuckDbPool withConnection start');
    const c = await this.acquire();
    try {
      const result = await fn(c);
      this.log.debug('WorkerDuckDbPool withConnection success');
      return result;
    } finally {
      this.release(c);
    }
  }

  async runInTransaction<T>(fn: (conn: WorkerConnShape) => Promise<T>): Promise<T> {
    return await this.withConnection(async conn => {
      await this.runSql(conn, 'BEGIN');
      try {
        const result = await fn(conn);
        await this.runSql(conn, 'COMMIT');
        return result;
      } catch (e) {
        await this.runSql(conn, 'ROLLBACK').catch(() => undefined);
        throw e as Error;
      }
    });
  }

  private async runSql(conn: WorkerConnShape, sql: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      conn.run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    this.log.info('WorkerDuckDbPool closing');
    try {
      await this.ops.closeDb();
      this.isClosed = true;
      this.log.info('WorkerDuckDbPool closed');
    } catch (error) {
      this.closeFailures++;
      this.log.error({ error }, 'WorkerDuckDbPool close failed');
      throw error;
    }
  }

  setCorrelationId(correlationId?: string): void {
    this.log = correlationId ? createChildLogger(correlationId) : logger;
  }

  getStats() {
    return {
      total: this.isClosed ? 0 : 1, // Worker connection exists if not closed
      idle: this.isClosed ? 0 : 1, // Worker is always "idle" from pool perspective
      queueLength: 0, // No queuing at this level (handled by worker internally)
      closeFailures: this.closeFailures,
      max: 1, // Single worker connection
    };
  }
}
