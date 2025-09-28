import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { upsertChunks, type ChunkRow } from '../../../../../src/core/vector/store/chunks';
import { promisifyRunParams } from '../../../../../src/core/vector/store/connection';

// Mock the connection module to spy on SQL calls
jest.mock('../../../../../src/core/vector/store/connection', () => ({
  promisifyRunParams: jest.fn(),
}));

jest.mock('../../../../../src/core/vector/store/pool', () => ({
  getPool: jest.fn(() => ({
    runInTransaction: jest.fn((callback: (conn: unknown) => Promise<void>) =>
      callback(mockConnection)
    ),
  })),
}));

const mockConnection = {
  run: jest.fn(),
  all: jest.fn(),
  close: jest.fn(),
};

const mockedPromisifyRunParams = promisifyRunParams as jest.MockedFunction<
  typeof promisifyRunParams
>;

describe('upsertChunks Batch Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPromisifyRunParams.mockResolvedValue();
  });

  test('handles empty chunk array without database calls', async () => {
    await upsertChunks([]);

    expect(mockedPromisifyRunParams).not.toHaveBeenCalled();
  });

  test('single chunk creates simple INSERT', async () => {
    const chunks: ChunkRow[] = [
      {
        id: 'test-1',
        url: 'https://example.com',
        text: 'Test content',
        tokens: 10,
        embedding: new Array(1536).fill(0.1),
      },
    ];

    await upsertChunks(chunks);

    expect(mockedPromisifyRunParams).toHaveBeenCalledTimes(1);

    const [, sql, params] = mockedPromisifyRunParams.mock.calls[0];
    expect(sql).toContain('INSERT OR REPLACE INTO chunks');
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5,');
    expect(sql).toContain('::FLOAT[1536])'); // Should contain embedding literal
    expect(params).toEqual([
      'test-1',
      'https://example.com',
      null, // section_path
      'Test content',
      10,
      // embedding is now embedded as literal in SQL, not in params
    ]);
  });

  test('multiple chunks in single batch create multi-VALUES INSERT', async () => {
    const chunks: ChunkRow[] = [
      {
        id: 'test-1',
        url: 'https://example.com',
        text: 'Content 1',
        tokens: 5,
        embedding: new Array(1536).fill(0.1),
      },
      {
        id: 'test-2',
        url: 'https://example.com',
        section_path: 'section-1',
        text: 'Content 2',
        tokens: 8,
        embedding: new Array(1536).fill(0.2),
      },
    ];

    await upsertChunks(chunks);

    expect(mockedPromisifyRunParams).toHaveBeenCalledTimes(1);

    const [, sql, params] = mockedPromisifyRunParams.mock.calls[0];

    // Verify multi-row VALUES structure
    expect(sql).toContain('INSERT OR REPLACE INTO chunks');
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5,'); // First chunk
    expect(sql).toContain('($6, $7, $8, $9, $10,'); // Second chunk
    expect(sql).toContain('::FLOAT[1536])'); // Should contain embedding literals

    // Verify all parameters are flattened correctly (no embeddings in params now)
    expect(params).toHaveLength(10); // 2 chunks × 5 params each (no embedding)
    expect(params).toEqual([
      'test-1',
      'https://example.com',
      null,
      'Content 1',
      5,
      // chunk[0].embedding is now embedded as literal in SQL
      'test-2',
      'https://example.com',
      'section-1',
      'Content 2',
      8,
      // chunk[1].embedding is now embedded as literal in SQL
    ]);
  });

  test('large number of chunks triggers batching (150 chunks = 2 batch calls)', async () => {
    const chunks: ChunkRow[] = Array.from({ length: 150 }, (_, i) => ({
      id: `chunk-${i}`,
      url: 'https://test.com',
      text: `Test content ${i}`,
      tokens: 10,
      embedding: new Array(1536).fill(i * 0.01),
    }));

    await upsertChunks(chunks);

    // Should create 2 batches: 100 + 50
    expect(mockedPromisifyRunParams).toHaveBeenCalledTimes(2);

    // First batch should have 100 chunks = 500 parameters (no embedding params)
    const firstBatchParams = mockedPromisifyRunParams.mock.calls[0][2];
    expect(firstBatchParams).toHaveLength(100 * 5);

    // Second batch should have 50 chunks = 250 parameters (no embedding params)
    const secondBatchParams = mockedPromisifyRunParams.mock.calls[1][2];
    expect(secondBatchParams).toHaveLength(50 * 5);

    // Verify SQL structure for first batch (100 VALUES clauses)
    const firstBatchSql = mockedPromisifyRunParams.mock.calls[0][1];
    const valuesCount = (firstBatchSql.match(/\$\d+/g) || []).length;
    expect(valuesCount).toBe(100 * 5); // 100 chunks × 5 parameters each (no embedding params)
  });

  test('exactly 100 chunks creates single batch', async () => {
    const chunks: ChunkRow[] = Array.from({ length: 100 }, (_, i) => ({
      id: `chunk-${i}`,
      url: 'https://test.com',
      text: `Test content ${i}`,
      tokens: 10,
      embedding: new Array(1536).fill(0.1),
    }));

    await upsertChunks(chunks);

    expect(mockedPromisifyRunParams).toHaveBeenCalledTimes(1);

    const [, , params] = mockedPromisifyRunParams.mock.calls[0];
    expect(params).toHaveLength(100 * 5); // 5 params per chunk (no embedding)
  });

  test('handles null section_path correctly in batches', async () => {
    const chunks: ChunkRow[] = [
      {
        id: 'test-1',
        url: 'https://example.com',
        text: 'Content with section',
        section_path: 'intro',
        tokens: 5,
        embedding: new Array(1536).fill(0.1),
      },
      {
        id: 'test-2',
        url: 'https://example.com',
        text: 'Content without section',
        tokens: 8,
        embedding: new Array(1536).fill(0.2),
      },
    ];

    await upsertChunks(chunks);

    const [, , params] = mockedPromisifyRunParams.mock.calls[0];

    // Verify section_path handling: first has value, second is null
    expect(params[2]).toBe('intro');
    expect(params[7]).toBe(null); // section_path for second chunk (index changed: 5 params per chunk)
  });
});
