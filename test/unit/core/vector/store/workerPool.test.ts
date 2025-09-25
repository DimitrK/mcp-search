import { describe, test, expect, jest, beforeEach } from '@jest/globals';
jest.mock('../../../../../src/core/vector/store/worker/db-client', () => ({
  __esModule: true,
  dbRun: async () => {},
  dbAll: async () => [],
  closeDb: async () => {},
}));

import { WorkerDuckDbPool } from '../../../../../src/core/vector/store/workerPool';

type RunCallback = (err: Error | null) => void;
type AllCallback = (err: Error | null, rs?: unknown[]) => void;
type _Conn = {
  run: (sql: string, cb: RunCallback) => void;
  all: (sql: string, cb: AllCallback) => void;
};

// static import above ensures ESM-friendly mocking without top-level await

describe('WorkerDuckDbPool', () => {
  const dbRun = jest.fn<(sql: string, params?: unknown[]) => Promise<void>>();
  const dbAll = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
  const closeDb = jest.fn<() => Promise<void>>();

  beforeEach(() => {
    dbRun.mockReset();
    dbAll.mockReset();
    closeDb.mockReset();
  });

  test('withConnection run forwards sql/params and resolves', async () => {
    dbRun.mockResolvedValue(undefined);
    const pool = new WorkerDuckDbPool(1000, { dbRun, dbAll, closeDb });
    await expect(
      pool.withConnection(
        async conn =>
          await new Promise<void>((resolve, reject) =>
            conn.run('CREATE TABLE t(x)', (err: Error | null) => (err ? reject(err) : resolve()))
          )
      )
    ).resolves.toBeUndefined();
    expect(dbRun).toHaveBeenCalledWith('CREATE TABLE t(x)', []);
  });

  test('withConnection all forwards sql/params and returns rows', async () => {
    dbAll.mockResolvedValue([{ n: 1 }]);
    const pool = new WorkerDuckDbPool(1000, { dbRun, dbAll, closeDb });
    const rows = await pool.withConnection(
      async conn =>
        await new Promise<unknown[]>((resolve, reject) =>
          conn.all('SELECT 1 AS n', (err: Error | null, rs?: unknown[]) =>
            err ? reject(err) : resolve(rs ?? [])
          )
        )
    );
    expect(dbAll).toHaveBeenCalledWith('SELECT 1 AS n', []);
    expect(rows).toEqual([{ n: 1 }]);
  });

  test('run respects acquireTimeoutMs', async () => {
    dbRun.mockImplementation(() => new Promise(() => {}));
    const pool = new WorkerDuckDbPool(50, { dbRun, dbAll, closeDb });
    await expect(
      pool.withConnection(
        async conn =>
          await new Promise<void>((resolve, reject) =>
            conn.run('LONG', (err: Error | null) => (err ? reject(err) : resolve()))
          )
      )
    ).rejects.toThrow('Worker operation timeout');
  });

  test('all respects acquireTimeoutMs', async () => {
    dbAll.mockImplementation(() => new Promise(() => {}));
    const pool = new WorkerDuckDbPool(50, { dbRun, dbAll, closeDb });
    await expect(
      pool.withConnection(
        async conn =>
          await new Promise<unknown[]>((resolve, reject) =>
            conn.all('LONG', (err: Error | null, rs?: unknown[]) =>
              err ? reject(err) : resolve(rs ?? [])
            )
          )
      )
    ).rejects.toThrow('Worker operation timeout');
  });

  test('close calls closeDb', async () => {
    const pool = new WorkerDuckDbPool(1000, { dbRun, dbAll, closeDb });
    await pool.close();
    expect(closeDb).toHaveBeenCalled();
  });

  test('getStats returns expected shape', () => {
    const pool = new WorkerDuckDbPool(1000);
    expect(pool.getStats()).toEqual({
      total: 1,
      idle: 1, // Worker is idle when not closed
      queueLength: 0,
      closeFailures: 0,
      max: 1,
    });
  });

  test('runInTransaction executes BEGIN and COMMIT (critical transaction test)', async () => {
    const capturedOperations: Array<{ sql: string; params?: unknown[] }> = [];

    const mockDbRun = jest.fn<(sql: string, params?: unknown[]) => Promise<void>>();
    mockDbRun.mockImplementation(async (sql, params) => {
      capturedOperations.push({ sql, params });
    });

    const mockDbAll = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
    mockDbAll.mockResolvedValue([]);

    const mockCloseDb = jest.fn<() => Promise<void>>();
    mockCloseDb.mockResolvedValue();

    const pool = new WorkerDuckDbPool(1000, {
      dbRun: mockDbRun,
      dbAll: mockDbAll,
      closeDb: mockCloseDb,
    });

    // This is THE critical test - before our fix, this wouldn't create transactions
    await pool.runInTransaction(async () => {
      return 'success';
    });

    // Verify actual transaction commands were executed (the bug was: they weren't!)
    expect(capturedOperations.length).toBe(2);
    expect(capturedOperations[0]).toEqual({ sql: 'BEGIN', params: [] });
    expect(capturedOperations[1]).toEqual({ sql: 'COMMIT', params: [] });

    // Double-check the specific calls
    expect(mockDbRun).toHaveBeenCalledWith('BEGIN', []);
    expect(mockDbRun).toHaveBeenCalledWith('COMMIT', []);
  });

  test('runInTransaction executes ROLLBACK on error', async () => {
    const capturedOperations: Array<{ sql: string; params?: unknown[] }> = [];

    const mockDbRun = jest.fn<(sql: string, params?: unknown[]) => Promise<void>>();
    mockDbRun.mockImplementation(async (sql, params) => {
      capturedOperations.push({ sql, params });
    });

    const mockDbAll = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
    const mockCloseDb = jest.fn<() => Promise<void>>();

    const pool = new WorkerDuckDbPool(1000, {
      dbRun: mockDbRun,
      dbAll: mockDbAll,
      closeDb: mockCloseDb,
    });

    const testError = new Error('Test error');

    await expect(
      pool.runInTransaction(async () => {
        throw testError;
      })
    ).rejects.toThrow('Test error');

    // Verify ROLLBACK was called instead of COMMIT
    expect(capturedOperations.length).toBe(2);
    expect(capturedOperations[0]).toEqual({ sql: 'BEGIN', params: [] });
    expect(capturedOperations[1]).toEqual({ sql: 'ROLLBACK', params: [] });
  });
});
