import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { handleWebSearch } from '../../../src/handlers/webSearch';
import { handleReadFromPage } from '../../../src/handlers/readFromPage';
import { createChildLogger } from '../../../src/utils/logger';
import { GoogleClient } from '../../../src/core/search/googleClient';
import { GoogleSearchResultFullType } from '../../../src/mcp/schemas';

jest.mock('../../../src/core/search/googleClient');
jest.mock('../../../src/handlers/readFromPage');
jest.mock('../../../src/config/environment', () => ({
  getEnvironment: jest.fn(() => ({
    GOOGLE_API_KEY: 'test-key',
    GOOGLE_SEARCH_ENGINE_ID: 'test-engine',
    EMBEDDING_SERVER_URL: 'http://test-server',
    EMBEDDING_SERVER_API_KEY: 'test-api-key',
    EMBEDDING_MODEL_NAME: 'test-model',
    EMBEDDING_BATCH_SIZE: 8,
    SIMILARITY_THRESHOLD: 0.6,
    CONCURRENCY: 2,
    DATA_DIR: '/tmp/test-data',
  })),
  getDatabasePath: jest.fn(() => '/tmp/test-data/db/mcp.duckdb'),
}));

const MockedGoogleClient = GoogleClient as jest.MockedClass<typeof GoogleClient>;
const MockedHandleReadFromPage = handleReadFromPage as jest.MockedFunction<
  typeof handleReadFromPage
>;

describe('Web Search Handler', () => {
  const mockLogger = createChildLogger('test');

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: handleReadFromPage returns empty results (no chunks found)
    MockedHandleReadFromPage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://example.com',
            title: 'Test Page',
            lastCrawled: new Date().toISOString(),
            queries: [
              {
                query: 'test query',
                results: [],
              },
            ],
          }),
        },
      ],
    });
  });

  test('should call GoogleClient and return formatted results for a single query', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      kind: 'customsearch#search',
      items: [
        {
          title: 'Test Result',
          link: 'https://example.com',
          displayLink: 'example.com',
          snippet: 'Test snippet',
          formattedUrl: 'https://example.com',
        },
      ],
    };
    const mockSearchResult = { queries: [{ query: 'test', result: mockGoogleResult }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    const input = { query: 'test', resultsPerQuery: 7, minimal: false };
    const result = await handleWebSearch(input, mockLogger);

    expect(MockedGoogleClient.prototype.search).toHaveBeenCalledWith('test', {
      resultsPerQuery: 7,
    });

    const parsedResult = JSON.parse(result.content[0].text);
    expect(parsedResult.queries).toHaveLength(1);
    expect(parsedResult.queries[0].query).toBe('test');
    expect(parsedResult.queries[0].result.items).toHaveLength(1);
  });

  test('should handle an array of queries', async () => {
    const mockSearchResult = {
      queries: [
        { query: 'q1', result: { items: [{ title: 'R1', link: 'https://r1.com' }] } },
        { query: 'q2', result: { items: [{ title: 'R2', link: 'https://r2.com' }] } },
      ],
    };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    const input = { query: ['q1', 'q2'], resultsPerQuery: 10, minimal: true };
    const result = await handleWebSearch(input, mockLogger);

    const parsedResult = JSON.parse(result.content[0].text);
    expect(parsedResult.queries).toHaveLength(2);
    expect(parsedResult.queries[0].query).toBe('q1');
    expect(parsedResult.queries[1].query).toBe('q2');
  });

  test('should perform similarity search when enabled and Google results contain URLs', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com/page1',
          title: 'Page 1',
          displayLink: 'example.com',
          snippet: 'Snippet 1',
          formattedUrl: 'https://example.com/page1',
        },
      ],
    };
    const mockSearchResult = {
      queries: [
        {
          query: 'test query',
          result: mockGoogleResult,
        },
      ],
    };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    // Mock readFromPage to return chunks
    MockedHandleReadFromPage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://example.com/page1',
            title: 'Page 1',
            lastCrawled: new Date().toISOString(),
            queries: [
              {
                query: 'test query',
                results: [
                  {
                    id: 'chunk1',
                    text: 'Relevant content chunk',
                    score: 0.8,
                    sectionPath: ['Introduction'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: true };
    const result = await handleWebSearch(input, mockLogger);

    // Verify readFromPage was called with correct parameters
    expect(MockedHandleReadFromPage).toHaveBeenCalled();
    const callArgs = MockedHandleReadFromPage.mock.calls[0];
    expect(callArgs[0]).toMatchObject({
      url: 'https://example.com/page1',
      query: 'test query',
      maxResults: 30, // Higher limit to get all relevant chunks above threshold
    });

    // Verify results include similarity matches
    const parsedResult = JSON.parse(result.content[0].text);
    const googleResult = parsedResult.queries[0].result;

    expect(googleResult.items).toHaveLength(1);
    expect(googleResult.items[0].inPageMatchingReferences).toBeDefined();
    expect(googleResult.items[0].inPageMatchingReferences.relevantChunks).toHaveLength(1);
    expect(googleResult.items[0].inPageMatchingReferences.relevantChunks[0].text).toBe(
      'Relevant content chunk'
    );
  });

  test('should skip similarity search when embedding service fails to initialize', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com',
          title: 'Test',
          displayLink: 'example.com',
          snippet: 'Snippet',
          formattedUrl: 'https://example.com',
        },
      ],
    };
    const mockSearchResult = { queries: [{ query: 'test query', result: mockGoogleResult }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    // Mock readFromPage to fail gracefully (returns content without chunks)
    MockedHandleReadFromPage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://example.com',
            title: 'Test',
            lastCrawled: new Date().toISOString(),
            queries: [
              {
                query: 'test query',
                results: [],
              },
            ],
            note: 'Embedding service unavailable; returning content without semantic search',
          }),
        },
      ],
    });

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: true };
    const result = await handleWebSearch(input, mockLogger);

    const parsedResult = JSON.parse(result.content[0].text);
    const googleResult = parsedResult.queries[0].result;

    expect(googleResult.items).toHaveLength(1);
    expect(googleResult.items[0].inPageMatchingReferences).toBeUndefined();
  });

  test('should skip similarity search when explicitly disabled', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com',
          title: 'Test',
          displayLink: 'example.com',
          snippet: 'Snippet',
          formattedUrl: 'https://example.com',
        },
      ],
    };
    const mockSearchResult = { queries: [{ query: 'test query', result: mockGoogleResult }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: false };
    const result = await handleWebSearch(input, mockLogger);

    // Verify readFromPage was NOT called
    expect(MockedHandleReadFromPage).not.toHaveBeenCalled();

    const parsedResult = JSON.parse(result.content[0].text);
    expect(parsedResult.queries).toHaveLength(1);
  });

  test('should handle similarity search failures gracefully', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com',
          title: 'Test',
          displayLink: 'example.com',
          snippet: 'Snippet',
          formattedUrl: 'https://example.com',
        },
      ],
    };
    const mockSearchResult = { queries: [{ query: 'test query', result: mockGoogleResult }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    // Mock readFromPage to throw an error
    MockedHandleReadFromPage.mockRejectedValue(new Error('Network error'));

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: true };
    const result = await handleWebSearch(input, mockLogger);

    const parsedResult = JSON.parse(result.content[0].text);
    const googleResult = parsedResult.queries[0].result;

    expect(googleResult.items).toHaveLength(1);
    expect(googleResult.items[0].inPageMatchingReferences).toBeUndefined();
  });

  test('should filter results by similarity threshold', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com/page1',
          title: 'Page 1',
          displayLink: 'example.com',
          snippet: 'Snippet 1',
          formattedUrl: 'https://example.com/page1',
        },
      ],
    };
    const mockSearchResult = { queries: [{ query: 'test query', result: mockGoogleResult }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    // Mock readFromPage to return high-score chunks
    MockedHandleReadFromPage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://example.com/page1',
            title: 'Page 1',
            lastCrawled: new Date().toISOString(),
            queries: [
              {
                query: 'test query',
                results: [
                  {
                    id: 'chunk1',
                    text: 'Highly relevant chunk',
                    score: 0.95,
                    sectionPath: ['Section 1'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: true };
    const result = await handleWebSearch(input, mockLogger);

    const parsedResult = JSON.parse(result.content[0].text);
    const googleResult = parsedResult.queries[0].result;

    expect(googleResult.items).toHaveLength(1);
    expect(googleResult.items[0].inPageMatchingReferences).toBeDefined();
    expect(googleResult.items[0].inPageMatchingReferences.relevantChunks[0].score).toBe(0.95);
  });

  test('should reject invalid input', async () => {
    const invalidInput = { query: '', resultsPerQuery: -1 };
    await expect(handleWebSearch(invalidInput, mockLogger)).rejects.toThrow();
  });

  test('should propagate errors from the GoogleClient', async () => {
    MockedGoogleClient.prototype.search.mockRejectedValue(new Error('API rate limit exceeded'));

    const input = { query: 'failing query', resultsPerQuery: 5 };
    await expect(handleWebSearch(input, mockLogger)).rejects.toThrow('API rate limit exceeded');
  });

  test('should crawl and index URLs not in database before similarity search', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com/page1',
          title: 'Page 1',
          displayLink: 'example.com',
          snippet: 'Snippet 1',
          formattedUrl: 'https://example.com/page1',
        },
        {
          link: 'https://example.com/page2',
          title: 'Page 2',
          displayLink: 'example.com',
          snippet: 'Snippet 2',
          formattedUrl: 'https://example.com/page2',
        },
      ],
    };
    const mockSearchResult = {
      queries: [
        {
          query: 'test query',
          result: mockGoogleResult,
        },
      ],
    };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    // Mock readFromPage to return chunks for both URLs
    MockedHandleReadFromPage.mockImplementation(async (args: unknown) => {
      const parsedArgs = args as { url: string; query: string };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: parsedArgs.url,
              title: `Page for ${parsedArgs.url}`,
              lastCrawled: new Date().toISOString(),
              queries: [
                {
                  query: parsedArgs.query,
                  results: [
                    {
                      id: 'chunk1',
                      text: 'Relevant content chunk',
                      score: 0.8,
                      sectionPath: ['Introduction'],
                    },
                  ],
                },
              ],
            }),
          },
        ],
      };
    });

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: true };
    const result = await handleWebSearch(input, mockLogger);

    // Verify readFromPage was called for both URLs
    expect(MockedHandleReadFromPage).toHaveBeenCalledTimes(2);

    // Verify results include similarity matches for both URLs
    const parsedResult = JSON.parse(result.content[0].text);
    const googleResult = parsedResult.queries[0].result;

    expect(googleResult.items).toHaveLength(2);
    expect(googleResult.items[0].inPageMatchingReferences).toBeDefined();
    expect(googleResult.items[1].inPageMatchingReferences).toBeDefined();
  });

  test('should return all relevant chunks above threshold (not limited to 3)', async () => {
    const mockGoogleResult: GoogleSearchResultFullType = {
      items: [
        {
          link: 'https://example.com/article',
          title: 'Test Article',
          displayLink: 'example.com',
          snippet: 'A test article',
          formattedUrl: 'https://example.com/article',
        },
      ],
    };
    const mockSearchResult = { queries: [{ query: 'test query', result: mockGoogleResult }] };
    MockedGoogleClient.prototype.search.mockResolvedValue(mockSearchResult);

    // Mock readFromPage to return many relevant chunks (more than 3)
    // This simulates finding multiple relevant sections in a page
    const manyChunks = Array.from({ length: 15 }, (_, i) => ({
      id: `chunk${i + 1}`,
      text: `Relevant content chunk ${i + 1}`,
      score: 0.9 - i * 0.02, // Decreasing scores, all above typical threshold
      sectionPath: [`Section ${i + 1}`],
    }));

    MockedHandleReadFromPage.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://example.com/article',
            title: 'Test Article',
            lastCrawled: new Date().toISOString(),
            queries: [
              {
                query: 'test query',
                results: manyChunks,
              },
            ],
          }),
        },
      ],
    });

    const input = { query: 'test query', resultsPerQuery: 5, enableSimilaritySearch: true };
    const result = await handleWebSearch(input, mockLogger);

    // Verify readFromPage was called with higher maxResults (30 instead of 3)
    expect(MockedHandleReadFromPage).toHaveBeenCalled();
    const callArgs = MockedHandleReadFromPage.mock.calls[0];
    expect(callArgs[0]).toMatchObject({
      url: 'https://example.com/article',
      query: 'test query',
      maxResults: 30, // Should be 30, not 3
    });

    // Verify all 15 chunks are returned (not just 3)
    const parsedResult = JSON.parse(result.content[0].text);
    const googleResult = parsedResult.queries[0].result;

    expect(googleResult.items).toHaveLength(1);
    expect(googleResult.items[0].inPageMatchingReferences).toBeDefined();
    expect(googleResult.items[0].inPageMatchingReferences.relevantChunks).toHaveLength(15);

    // Verify chunks are properly mapped
    const relevantChunks = googleResult.items[0].inPageMatchingReferences.relevantChunks;
    expect(relevantChunks[0].text).toBe('Relevant content chunk 1');
    expect(relevantChunks[0].score).toBe(0.9);
    expect(relevantChunks[14].text).toBe('Relevant content chunk 15');
    expect(relevantChunks[14].score).toBeCloseTo(0.62, 2);
  });
});
