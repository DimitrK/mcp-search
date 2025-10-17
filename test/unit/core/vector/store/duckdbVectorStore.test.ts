import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { initDuckDb } from '../../../../../src/core/vector/store/duckdbVectorStore';
import { getDatabasePath } from '../../../../../src/config/environment';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('@duckdb/node-api', () => {
  const run = jest.fn(async (sql: string) => {
    // Simulate VSS statements succeeding and other DDL too
  });
  const runAndReadAll = jest.fn(async (sql: string) => {
    return {
      getRowObjects: () => [],
    } as unknown;
  });
  const connect = jest.fn(async () => ({ run, runAndReadAll, closeSync: jest.fn() }));
  const create = jest.fn(async (_path: string) => ({ connect, closeSync: jest.fn() }));
  return { DuckDBInstance: { create } };
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
    // Database path should include model name: mcp-{model-name}.duckdb
    expect(getDatabasePath()).toMatch(/mcp-[a-z0-9-]+\.duckdb$/);
  });
});
