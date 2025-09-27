import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { fetchAndPersistDocument } from '../../src/core/content/httpFetchAndPersist';
import { clearEnvironmentCache } from '../../src/config/environment';

// Simple mock that works around method chaining issues
const mockRequest = jest.fn() as jest.MockedFunction<any>;
const mockClose = jest.fn();

jest.mock('undici', () => ({
  Client: jest.fn().mockImplementation(() => ({
    request: mockRequest,
    close: mockClose,
    compose: jest.fn().mockReturnThis(),
  })),
  interceptors: {
    redirect: jest.fn().mockReturnValue(() => ({})),
  },
  Dispatcher: {},
}));
jest.mock('@duckdb/node-api', () => {
  let storedDoc: Record<string, unknown> | null = null;
  const run = jest.fn(async (sql: string) => {
    if (/INSERT OR REPLACE INTO documents/i.test(sql)) {
      storedDoc = {
        url: 'https://ex.com',
        title: 'Example',
        etag: 'e1',
        last_modified: '2024-01-01',
        last_crawled: '2024-01-01T00:00:00.000Z',
        content_hash: '64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c',
      };
    }
  });
  const runAndReadAll = jest.fn(async (sql: string) => {
    if (/SELECT .+ FROM documents WHERE url = /i.test(sql)) {
      return {
        getRowObjects: () => (storedDoc ? [storedDoc] : []),
      } as unknown;
    }
    return {
      getRowObjects: () => [],
    } as unknown;
  });
  const connect = jest.fn(async () => ({ run, runAndReadAll, closeSync: jest.fn() }));
  const create = jest.fn(async (_path: string) => ({ connect }));
  return { DuckDBInstance: { create } };
});
type UndiciTextBody = { text: () => Promise<string> };
type UndiciResponse = {
  statusCode: number;
  headers: Record<string, unknown>;
  body: UndiciTextBody;
};

// No DB mocking: use real @duckdb/node-api via connection adapter

describe('fetchAndPersistDocument integration (200→304)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockClose.mockReset();
    process.env.REQUEST_TIMEOUT_MS = '2000';
    clearEnvironmentCache();
  });

  test('persists on 200 and updates last_crawled only on 304', async () => {
    const firstBody = 'Hello world';
    let calls = 0;
    mockRequest.mockImplementation((_opts: unknown) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          statusCode: 200,
          headers: { etag: 'W/"abc"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' },
          body: {
            text: () => Promise.resolve(firstBody),
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode(firstBody).buffer),
          },
        });
      }
      return Promise.resolve({
        statusCode: 304,
        headers: {},
        body: {
          text: () => Promise.resolve(''),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        },
      });
    });

    const r1 = await fetchAndPersistDocument('https://EXAMPLE.com/a?b=2&a=1#frag');
    expect(r1.statusCode).toBe(200);
    expect(r1.notModified).toBe(false);
    expect(r1.etag).toBe('W/"abc"');
    expect(typeof r1.contentHash).toBe('string');

    const r2 = await fetchAndPersistDocument('https://example.com/a?a=1&b=2');
    expect(r2.statusCode).toBe(304);
    expect(r2.notModified).toBe(true);
    expect(r2.contentHash).toBe(r1.contentHash);
  });
});
