import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { request } from 'undici';
import duckdb from 'duckdb';
import { fetchAndPersistDocument } from '../../src/core/content/httpFetchAndPersist';
import { clearEnvironmentCache } from '../../src/config/environment';

jest.mock('undici', () => ({ request: jest.fn() as unknown }));
type UndiciTextBody = { text: () => Promise<string> };
type UndiciResponse = {
  statusCode: number;
  headers: Record<string, unknown>;
  body: UndiciTextBody;
};
type UndiciRequest = (url: string, opts?: Record<string, unknown>) => Promise<UndiciResponse>;
const mockedRequest = request as unknown as jest.MockedFunction<UndiciRequest>;

jest.mock('duckdb', () => {
  let storedDoc: any | null = null;
  const run = jest.fn((...args: unknown[]) => {
    const sql = args[0] as string;
    const cb = args[args.length - 1] as (err: Error | null) => void;
    const params = args.slice(1, -1);
    if (/INSERT OR REPLACE INTO documents/i.test(sql)) {
      const [url, title, etag, last_modified, last_crawled, content_hash] = params;
      storedDoc = { url, title, etag, last_modified, last_crawled, content_hash };
    }
    if (/DELETE FROM meta|CREATE TABLE|CREATE INDEX|INSTALL vss|LOAD vss/i.test(sql)) {
      // schema ops: succeed silently
    }
    cb(null);
  });
  const all = jest.fn((...args: unknown[]) => {
    const sql = args[0] as string;
    const cb = args[args.length - 1] as (err: Error | null, rows?: any[]) => void;
    const params = args.slice(1, -1);
    if (/SELECT \* FROM documents WHERE url = \?/i.test(sql)) {
      const [url] = params;
      cb(null, storedDoc && storedDoc.url === url ? [storedDoc] : []);
      return;
    }
    cb(null, []);
  });
  const connect = jest.fn((cb: (err: Error | null, conn: any) => void) =>
    cb(null, { run, all, close: jest.fn() })
  );
  const Database = function (this: any) {
    this.connect = connect;
    this.close = jest.fn();
  } as unknown as new (...args: any[]) => any;
  return { __esModule: true, default: { Database } };
});

describe('fetchAndPersistDocument integration (200→304)', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    process.env.REQUEST_TIMEOUT_MS = '2000';
    clearEnvironmentCache();
  });

  test('persists on 200 and updates last_crawled only on 304', async () => {
    const firstBody = 'Hello world';
    let calls = 0;
    mockedRequest.mockImplementation((_url: string, _opts: any) => {
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

    // @ts-expect-error minimal duckdb.Database shape for tests
    const db = new duckdb.Database();

    const r1 = await fetchAndPersistDocument(db, 'https://EXAMPLE.com/a?b=2&a=1#frag');
    expect(r1.statusCode).toBe(200);
    expect(r1.notModified).toBe(false);
    expect(r1.etag).toBe('W/"abc"');
    expect(typeof r1.contentHash).toBe('string');

    const r2 = await fetchAndPersistDocument(db, 'https://example.com/a?a=1&b=2');
    expect(r2.statusCode).toBe(304);
    expect(r2.notModified).toBe(true);
    expect(r2.contentHash).toBe(r1.contentHash);
  });
});
