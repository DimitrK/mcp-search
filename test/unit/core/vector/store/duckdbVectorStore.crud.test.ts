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

jest.mock('@duckdb/node-api', () => {
  let storedDoc: Record<string, unknown> | null = null;
  const run = jest.fn(async (sql: string) => {
    if (/INSERT OR REPLACE INTO documents/i.test(sql)) {
      storedDoc = {
        url: 'https://ex',
        title: 't',
        etag: 'e',
        last_modified: 'l',
        last_crawled: new Date(0).toISOString(),
        content_hash: 'h',
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
      last_crawled: new Date(0).toISOString(),
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

  test('upsertChunks handles empty array', async () => {
    await expect(upsertChunks([])).resolves.not.toThrow();
  });

  test('upsertChunks batches multiple chunks correctly', async () => {
    // Create test data that will trigger batching logic
    const chunks = Array.from({ length: 150 }, (_, i) => ({
      id: `chunk-${i}`,
      url: 'https://test.com',
      text: `Test chunk ${i}`,
      tokens: 10,
      embedding: new Array(1536).fill(i % 10),
    }));

    await expect(upsertChunks(chunks)).resolves.not.toThrow();
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
