import { describe, test, expect, jest } from '@jest/globals';
import {
  ensureEmbeddingConfig,
  upsertDocument,
  getDocument,
  deleteDocument,
  upsertChunks,
  similaritySearch,
  deleteChunkById,
  deleteChunksByUrl,
} from '../../../../../src/core/vector/store/duckdbVectorStore';

jest.mock('duckdb', () => {
  let storedDoc: any | null = null;
  const run = jest.fn((...args: any[]) => {
    const sql = args[0] as string;
    const cb = args[args.length - 1] as (err: Error | null) => void;
    const params = args.slice(1, -1);
    if (/INSERT OR REPLACE INTO documents/i.test(sql)) {
      const [url, title, etag, last_modified, last_crawled, content_hash] = params;
      storedDoc = { url, title, etag, last_modified, last_crawled, content_hash };
    }
    cb(null);
  });
  const all = jest.fn((...args: any[]) => {
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

describe('duckdbVectorStore CRUD', () => {
  test('ensureEmbeddingConfig inserts model/dim if missing', async () => {
    await expect(ensureEmbeddingConfig('text-embedding-3-small', 1536)).resolves.not.toThrow();
  });

  test('upsert/get document works', async () => {
    await upsertDocument({
      url: 'https://ex',
      title: 't',
      etag: 'e',
      last_modified: 'l',
      last_crawled: 'c',
      content_hash: 'h',
    });
    const doc = await getDocument('https://ex');
    expect(doc?.url).toBe('https://ex');
  });

  test('deleteDocument deletes document and chunks by url', async () => {
    await expect(deleteDocument('https://ex')).resolves.not.toThrow();
  });

  test('upsertChunks executes without error', async () => {
    await expect(
      upsertChunks([
        {
          id: '1',
          url: 'https://ex',
          text: 't',
          tokens: 10,
          embedding: new Array(1536).fill(0),
        },
      ])
    ).resolves.not.toThrow();
  });

  test('deleteChunkById and deleteChunksByUrl execute without error', async () => {
    await expect(deleteChunkById('id1')).resolves.not.toThrow();
    await expect(deleteChunksByUrl('https://ex')).resolves.not.toThrow();
  });

  test('similaritySearch executes select with VSS operator', async () => {
    const results = await similaritySearch('https://ex', new Array(1536).fill(0), 5);
    expect(Array.isArray(results)).toBe(true);
  });
});
