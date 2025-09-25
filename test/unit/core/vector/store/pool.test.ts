import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { DuckDbPool } from '../../../../../src/core/vector/store/pool';
import type {
  DuckDbDatabaseLike,
  DuckDbConnectionLike,
} from '../../../../../src/core/vector/store/connection';

const mockConn = (): DuckDbConnectionLike => ({
  run: (sql: string, cb: (err: Error | null) => void) => cb(null),
  all: (sql: string, cb: (err: Error | null, rows?: unknown[]) => void) => cb(null, []),
  close: jest.fn(),
});

const mockDb = (): DuckDbDatabaseLike => ({
  connect: (cb: (err: Error | null, conn: DuckDbConnectionLike) => void) => cb(null, mockConn()),
});

describe('DuckDbPool', () => {
  let pool: DuckDbPool;

  beforeEach(async () => {
    pool = new DuckDbPool(mockDb());
  });

  test('acquire/release cycles reuse connections', async () => {
    const c1 = await pool.acquire();
    pool.release(c1);
    const c2 = await pool.acquire();
    expect(c1).toBe(c2);
    pool.release(c2);
  });

  test('withConnection wraps acquire/release', async () => {
    const result = await pool.withConnection(async conn => {
      await new Promise<void>(r => conn.run('SELECT 1', () => r()));
      return 42;
    });
    expect(result).toBe(42);
  });

  test('acquire times out when max reached and no release', async () => {
    const smallPool = new DuckDbPool(mockDb(), {
      max: 1,
      acquireTimeoutMs: 20,
    });
    const c = await smallPool.acquire();
    await expect(smallPool.acquire()).rejects.toThrow('Pool acquire timeout');
    smallPool.release(c);
  });

  test('close failure increments counter and replacement keeps capacity', async () => {
    const badConn = (): DuckDbConnectionLike => ({
      run: (sql: string, cb: (err: Error | null) => void) => cb(null),
      all: (sql: string, cb: (err: Error | null, rows?: unknown[]) => void) => cb(null, []),
      close: () => {
        throw new Error('bad close');
      },
    });
    const badDb = (): DuckDbDatabaseLike => ({
      connect: (cb: (err: Error | null, conn: DuckDbConnectionLike) => void) => cb(null, badConn()),
    });
    const pool2 = new DuckDbPool(badDb(), {
      max: 1,
      idleTimeoutMs: 1,
    });
    const c2 = await pool2.acquire();
    // Simulate broken by discarding directly
    (pool2 as unknown as { discardConnection: (c: unknown) => void }).discardConnection(c2);
    await new Promise(r => setTimeout(r, 10));
    const stats = pool2.getStats();
    expect(stats.closeFailures).toBeGreaterThan(0);
    expect(stats.total).toBeLessThanOrEqual(stats.max);
  });
});
