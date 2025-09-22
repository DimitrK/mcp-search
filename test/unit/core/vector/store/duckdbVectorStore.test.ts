import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { initDuckDb } from '../../../../../src/core/vector/store/duckdbVectorStore';
import { getDatabasePath } from '../../../../../src/config/environment';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('duckdb', () => {
  const run = jest.fn((sql: string, cb: (err?: Error | null) => void) => {
    // Simulate VSS statements succeeding and other DDL too
    cb(null);
  });
  const connect = jest.fn((cb: (err: Error | null, conn: any) => void) =>
    cb(null, { run, close: jest.fn() })
  );
  const Database = function (this: any) {
    this.connect = connect;
    this.close = jest.fn();
  } as unknown as new (...args: any[]) => any;
  return { __esModule: true, default: { Database } };
});

describe('duckdbVectorStore init', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-db-'));
  const oldDataDir = process.env.DATA_DIR;
  beforeAll(() => {
    process.env.DATA_DIR = tmp;
  });
  afterAll(() => {
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('initializes schema and returns connection', async () => {
    const db = await initDuckDb();
    expect(db).toBeTruthy();
    expect(getDatabasePath()).toContain('mcp.duckdb');
    await db.close();
  });
});
