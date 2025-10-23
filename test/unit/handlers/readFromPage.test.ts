import { describe, test, expect, beforeAll } from '@jest/globals';
import { handleReadFromPage } from '../../../src/handlers/readFromPage';
import { createChildLogger } from '../../../src/utils/logger';

// Mock all external dependencies for unit testing
jest.mock('../../../src/core/content/httpContentFetcher', () => ({
  fetchUrl: jest.fn().mockResolvedValue({
    statusCode: 200,
    bodyText: '<html><body><h1>Test</h1><p>Content</p></body></html>',
    etag: '"test-etag"',
    lastModified: '2024-01-01',
    notModified: false,
  }),
}));

jest.mock('../../../src/core/content/htmlContentExtractor', () => ({
  extractContent: jest.fn().mockResolvedValue({
    title: 'Test Page',
    textContent: 'Test content for embedding',
    markdownContent: '# Test\n\nContent',
    wordCount: 4,
    excerpt: 'Test content...',
    extractionMethod: 'mocked',
    semanticInfo: { headings: [], codeBlocks: [], lists: [], tables: [], blockquotes: [] },
    sectionPaths: [],
  }),
}));

jest.mock('../../../src/core/content/chunker', () => ({
  semanticChunker: {
    chunk: jest.fn().mockReturnValue([
      {
        id: 'test-chunk-1',
        text: 'Test content for embedding',
        tokens: 4,
        sectionPath: 'Test',
        overlapTokens: 0,
      },
    ]),
  },
}));

jest.mock('../../../src/core/vector/embeddingProvider', () => ({
  createEmbeddingProvider: jest.fn().mockResolvedValue({
    embed: jest.fn().mockResolvedValue([Array(1024).fill(0.1)]),
    getDimension: jest.fn().mockReturnValue(1024),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../../../src/core/vector/store/documents', () => ({
  getDocument: jest.fn().mockResolvedValue(null),
  upsertDocument: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/core/vector/store/chunks', () => ({
  similaritySearch: jest.fn().mockResolvedValue([]),
  getAllChunksByUrl: jest.fn().mockResolvedValue([
    {
      id: 'chunk-1',
      text: 'First chunk of content',
      section_path: 'Introduction',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'chunk-2',
      text: 'Second chunk of content',
      section_path: 'Body',
      created_at: '2024-01-01T00:01:00Z',
    },
  ]),
}));

jest.mock('../../../src/core/vector/embeddingIntegrationService', () => ({
  EmbeddingIntegrationService: jest.fn().mockImplementation(() => ({
    storeWithEmbeddings: jest.fn().mockResolvedValue(undefined),
    searchSimilar: jest.fn().mockResolvedValue([
      {
        id: 'test-chunk-1',
        text: 'Test content for embedding',
        score: 0.95,
        section_path: 'Test',
      },
    ]),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('Read From Page Handler', () => {
  const mockLogger = createChildLogger('test');

  beforeAll(() => {
    // Set required environment variables
    process.env.EMBEDDING_SERVER_URL = 'http://localhost:8080';
    process.env.EMBEDDING_SERVER_API_KEY = 'test-key';
    process.env.EMBEDDING_MODEL_NAME = 'test-model';
    process.env.SIMILARITY_THRESHOLD = '0.7';
  });

  test('should parse valid readFromPage input and return structured response', async () => {
    const validInput = {
      url: 'https://example.com',
      query: 'search content',
    };

    const result = await handleReadFromPage(validInput, mockLogger);

    // Should return proper MCP response structure
    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');

    // Parse the JSON content to verify structure
    const parsedResponse = JSON.parse(result.content[0].text);
    expect(parsedResponse).toMatchObject({
      url: validInput.url,
      lastCrawled: expect.any(String),
      queries: expect.arrayContaining([
        expect.objectContaining({
          query: validInput.query,
          results: expect.any(Array),
        }),
      ]),
    });
  });

  test('should reject invalid URL', async () => {
    const invalidInput = {
      url: 'not-a-url',
      query: 'search content',
    };

    await expect(handleReadFromPage(invalidInput, mockLogger)).rejects.toThrow(); // Should fail URL validation
  });

  test('should handle missing required fields', async () => {
    const missingUrl = {
      query: 'search content',
    };

    await expect(handleReadFromPage(missingUrl, mockLogger)).rejects.toThrow(); // Should fail validation

    // Query is now optional - missing query should succeed and return all chunks
    const missingQuery = {
      url: 'https://example.com',
    };

    const result = await handleReadFromPage(missingQuery, mockLogger);
    expect(result).toHaveProperty('content');

    // Parse response to verify it returns all chunks mode
    const parsedResponse = JSON.parse(result.content[0].text);
    expect(parsedResponse.queries).toHaveLength(1);
    expect(parsedResponse.queries[0].query).toBe(''); // Empty query string indicates full content retrieval
    expect(parsedResponse.queries[0].results).toHaveLength(2); // Should return all chunks from mock
    // Verify chunks don't have score field (since no similarity search)
    parsedResponse.queries[0].results.forEach((chunk: { score?: number }) => {
      expect(chunk.score).toBeUndefined();
    });
  });

  test('should handle undefined input', async () => {
    await expect(handleReadFromPage(undefined, mockLogger)).rejects.toThrow(); // Should fail validation
  });

  test('should handle empty string query', async () => {
    const emptyStringQuery = {
      url: 'https://example.com',
      query: '',
    };

    const result = await handleReadFromPage(emptyStringQuery, mockLogger);
    const parsedResponse = JSON.parse(result.content[0].text);

    // Empty string should trigger "return all chunks" mode
    expect(parsedResponse.queries).toHaveLength(1);
    expect(parsedResponse.queries[0].query).toBe('');
    expect(parsedResponse.queries[0].results).toHaveLength(2); // All chunks from mock
    // Verify no score field
    parsedResponse.queries[0].results.forEach((chunk: { score?: number }) => {
      expect(chunk.score).toBeUndefined();
    });
  });

  test('should handle whitespace-only query', async () => {
    const whitespaceQuery = {
      url: 'https://example.com',
      query: '   ',
    };

    const result = await handleReadFromPage(whitespaceQuery, mockLogger);
    const parsedResponse = JSON.parse(result.content[0].text);

    // Whitespace-only should trigger "return all chunks" mode
    expect(parsedResponse.queries).toHaveLength(1);
    expect(parsedResponse.queries[0].query).toBe('');
    expect(parsedResponse.queries[0].results).toHaveLength(2); // All chunks from mock
  });

  test('should handle empty array query', async () => {
    const emptyArrayQuery = {
      url: 'https://example.com',
      query: [],
    };

    const result = await handleReadFromPage(emptyArrayQuery, mockLogger);
    const parsedResponse = JSON.parse(result.content[0].text);

    // Empty array should trigger "return all chunks" mode
    expect(parsedResponse.queries).toHaveLength(1);
    expect(parsedResponse.queries[0].query).toBe('');
    expect(parsedResponse.queries[0].results).toHaveLength(2); // All chunks from mock
  });

  test('should handle array with empty strings', async () => {
    const emptyStringsArray = {
      url: 'https://example.com',
      query: ['', '  ', ''],
    };

    const result = await handleReadFromPage(emptyStringsArray, mockLogger);
    const parsedResponse = JSON.parse(result.content[0].text);

    // Array with only empty/whitespace strings should trigger "return all chunks" mode
    expect(parsedResponse.queries).toHaveLength(1);
    expect(parsedResponse.queries[0].query).toBe('');
    expect(parsedResponse.queries[0].results).toHaveLength(2); // All chunks from mock
  });

  test('should handle array with mixed empty and valid queries', async () => {
    const mixedArray = {
      url: 'https://example.com',
      query: ['valid query', '', '  '],
    };

    const result = await handleReadFromPage(mixedArray, mockLogger);
    const parsedResponse = JSON.parse(result.content[0].text);

    // Should only process valid queries, filtering out empty ones
    expect(parsedResponse.queries.length).toBeGreaterThan(0);
    // All returned queries should be non-empty
    parsedResponse.queries.forEach((q: { query: string }) => {
      expect(q.query.trim()).not.toBe('');
    });
  });

  test('should handle multiple valid queries', async () => {
    const multipleQueries = {
      url: 'https://example.com',
      query: ['query one', 'query two', 'query three'],
    };

    const result = await handleReadFromPage(multipleQueries, mockLogger);
    const parsedResponse = JSON.parse(result.content[0].text);

    // Should return results for all queries
    expect(parsedResponse.queries).toHaveLength(3);
    expect(parsedResponse.queries[0].query).toBe('query one');
    expect(parsedResponse.queries[1].query).toBe('query two');
    expect(parsedResponse.queries[2].query).toBe('query three');
  });

  test('should handle forceRefresh parameter', async () => {
    const forceRefreshInput = {
      url: 'https://example.com',
      query: 'test',
      forceRefresh: true,
    };

    const result = await handleReadFromPage(forceRefreshInput, mockLogger);
    expect(result).toHaveProperty('content');

    const parsedResponse = JSON.parse(result.content[0].text);
    expect(parsedResponse).toHaveProperty('url', forceRefreshInput.url);
  });

  test('should handle maxResults parameter', async () => {
    const maxResultsInput = {
      url: 'https://example.com',
      query: 'test',
      maxResults: 3,
    };

    const result = await handleReadFromPage(maxResultsInput, mockLogger);
    expect(result).toHaveProperty('content');

    const parsedResponse = JSON.parse(result.content[0].text);
    expect(parsedResponse.queries).toHaveLength(1);
    // Results should respect maxResults (though actual enforcement is in backend)
  });

  test('should handle includeMetadata parameter', async () => {
    const includeMetadataInput = {
      url: 'https://example.com',
      query: 'test',
      includeMetadata: true,
    };

    const result = await handleReadFromPage(includeMetadataInput, mockLogger);
    expect(result).toHaveProperty('content');

    const parsedResponse = JSON.parse(result.content[0].text);
    expect(parsedResponse).toHaveProperty('url');
    expect(parsedResponse).toHaveProperty('lastCrawled');
  });
});
