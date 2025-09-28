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
      query: 'search content'
    };

    const result = await handleReadFromPage(validInput, mockLogger);
    
    // Should return proper MCP response structure
    expect(result).toHaveProperty('content');
    expect(result.content).toMatchObject({
      url: validInput.url,
      lastCrawled: expect.any(String),
      queries: expect.arrayContaining([
        expect.objectContaining({
          query: validInput.query,
          results: expect.any(Array)
        })
      ])
    });
  });

  test('should reject invalid URL', async () => {
    const invalidInput = {
      url: 'not-a-url',
      query: 'search content'
    };

    await expect(handleReadFromPage(invalidInput, mockLogger))
      .rejects
      .toThrow(); // Should fail URL validation
  });

  test('should handle missing required fields', async () => {
    const missingUrl = {
      query: 'search content'
    };

    await expect(handleReadFromPage(missingUrl, mockLogger))
      .rejects
      .toThrow(); // Should fail validation

    const missingQuery = {
      url: 'https://example.com'
    };

    await expect(handleReadFromPage(missingQuery, mockLogger))
      .rejects
      .toThrow(); // Should fail validation
  });

  test('should handle undefined input', async () => {
    await expect(handleReadFromPage(undefined, mockLogger))
      .rejects
      .toThrow(); // Should fail validation
  });
});
