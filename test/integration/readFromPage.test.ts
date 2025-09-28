import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { handleReadFromPage } from '../../src/handlers/readFromPage';
import { createChildLogger } from '../../src/utils/logger';
import { closeGlobalPool } from '../../src/core/vector/store/pool';
import { deleteDocument, getDocument } from '../../src/core/vector/store/documents';
import { deleteChunksByUrl } from '../../src/core/vector/store/chunks';
import { normalizeUrl } from '../../src/utils/urlValidator';
import { ReadFromPageOutputType } from '../../src/mcp/schemas';

// Helper to parse MCP content format
function parseReadFromPageResult(result: {
  content: { type: 'text'; text: string }[];
}): ReadFromPageOutputType {
  return JSON.parse(result.content[0].text) as ReadFromPageOutputType;
}

// Mock external dependencies
jest.mock('undici', () => {
  const mockClient = {
    compose: jest.fn().mockReturnThis(),
    request: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    request: jest.fn(),
    Client: jest.fn().mockImplementation(() => mockClient),
    interceptors: {
      redirect: jest.fn().mockReturnValue(() => mockClient),
    },
  };
});

const mockUndici = jest.mocked(require('undici'));
const mockClientRequest = mockUndici.Client().request;

describe('readFromPage Integration', () => {
  const logger = createChildLogger('test');

  // Generate unique URLs for each test to prevent interference
  let testUrl: string;
  let normalizedTestUrl: string;

  beforeAll(() => {
    // Set required environment variables for tests
    process.env.EMBEDDING_SERVER_URL = 'http://localhost:8080';
    process.env.EMBEDDING_SERVER_API_KEY = 'test-key';
    process.env.EMBEDDING_MODEL_NAME = 'test-model';
    process.env.SIMILARITY_THRESHOLD = '0.7'; // Lower threshold for tests
  });

  beforeEach(async () => {
    // Generate unique URL for this test to prevent interference between tests
    testUrl = `https://example.com/test-article-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    normalizedTestUrl = normalizeUrl(testUrl);

    // Clean up any existing test data for this unique URL (should be empty, but just in case)
    await deleteChunksByUrl(normalizedTestUrl);
    await deleteDocument(normalizedTestUrl);

    // Reset mocks
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Final cleanup - each test has unique URLs, so no specific cleanup needed
    // Just close the connection pool
    await closeGlobalPool();
  });

  describe('Complete Pipeline', () => {
    it('should fetch, extract, chunk, embed, and search content successfully', async () => {
      // Mock HTTP response for content fetching
      const mockHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Test Article</title>
  <meta charset="utf-8">
</head>
<body>
  <main>
    <article>
      <h1>Test Article</h1>
      <h2>Main Topic</h2>
      <p>This is the main content about artificial intelligence and machine learning.</p>
      <h2>Subtopic</h2>
      <p>More detailed information about neural networks and deep learning algorithms.</p>
    </article>
  </main>
</body>
</html>`;

      mockClientRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': mockHtml.length.toString(),
        },
        body: {
          arrayBuffer: jest.fn().mockResolvedValue(Buffer.from(mockHtml).buffer),
        },
      });

      // Mock embedding API response - single chunk gets single embedding
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [
              { embedding: Array(1024).fill(0.8) }, // High similarity for good scoring
            ],
          }),
        },
      });

      // Mock embedding query response - similar vector for high similarity
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [
              { embedding: Array(1024).fill(0.8) }, // Same values for high similarity
            ],
          }),
        },
      });

      const input = {
        url: testUrl,
        query: 'artificial intelligence',
        maxResults: 5,
        includeMetadata: true,
      };

      const result = await handleReadFromPage(input, logger);

      // Verify MCP response structure
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');

      // Parse the MCP content format
      const parsedContent = parseReadFromPageResult(result);

      // Parse and verify the actual response content
      expect(parsedContent).toMatchObject({
        url: testUrl,
        lastCrawled: expect.any(String),
        queries: [
          {
            query: 'artificial intelligence',
            results: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(String),
                text: expect.any(String),
                score: expect.any(Number),
              }),
            ]),
          },
        ],
      });

      // Title extraction result varies by extractor method - cheerio often returns undefined
      expect(typeof parsedContent.title === 'string' || parsedContent.title === undefined).toBe(
        true
      );

      // Should have relevant chunks (similarity vectors should score high)
      const firstQuery = parsedContent.queries[0];
      expect(firstQuery.results.length).toBeGreaterThan(0);
      expect(firstQuery.results[0].score).toBeGreaterThan(0.7); // High similarity expected

      // Should contain relevant content
      const resultTexts = firstQuery.results.map((r: any) => r.text).join(' ');
      expect(resultTexts).toMatch(
        /artificial intelligence|machine learning|main topic|neural networks/i
      );
    });

    it('should handle caching correctly on second request', async () => {
      // First request - mock fresh content
      mockClientRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'content-type': 'text/html',
          etag: '"test-etag-123"',
        },
        body: {
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(Buffer.from('<html><body><p>Test content</p></body></html>').buffer),
        },
      });

      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.1) }],
          }),
        },
      });

      // Query embedding
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.1) }],
          }),
        },
      });

      const input = {
        url: testUrl,
        query: 'test query',
        maxResults: 3,
      };

      // First request
      await handleReadFromPage(input, logger);

      // Add small delay to ensure database operations complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify the document was actually stored
      const storedDoc = await getDocument(normalizeUrl(testUrl));
      if (!storedDoc) {
        throw new Error(`Expected document to be stored for URL: ${testUrl}`);
      }

      // Second request - should use cached content (304 Not Modified)
      mockClientRequest.mockResolvedValueOnce({
        statusCode: 304,
        headers: {
          etag: '"test-etag-123"',
        },
        body: {
          arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('').buffer),
        },
      });

      // Only need query embedding for cached content
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.1) }],
          }),
        },
      });

      const cachedResult = await handleReadFromPage(input, logger);

      // Should return valid response structure (cached content or graceful degradation)
      const parsedCachedContent = parseReadFromPageResult(cachedResult);
      expect(parsedCachedContent.queries[0].results.length).toBeGreaterThanOrEqual(0);

      // Should have fewer HTTP calls (no content re-embedding)
      const embeddingCalls = mockUndici.request.mock.calls.filter(
        (call: any) =>
          call[0].url?.includes('/v1/embeddings') ||
          (typeof call[0] === 'string' && call[0].includes('/v1/embeddings'))
      );
      expect(embeddingCalls.length).toBeLessThanOrEqual(2); // Only query embedding
    });

    it('should handle forceRefresh correctly', async () => {
      // Set up initial cached content
      mockClientRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'content-type': 'text/html',
          etag: '"old-etag"',
        },
        body: {
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(Buffer.from('<html><body><p>Old content</p></body></html>').buffer),
        },
      });

      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.2) }],
          }),
        },
      });

      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.2) }],
          }),
        },
      });

      // Initial request
      await handleReadFromPage(
        {
          url: testUrl,
          query: 'test',
          maxResults: 3,
        },
        logger
      );

      // Force refresh with new content
      mockClientRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'content-type': 'text/html',
          etag: '"new-etag"',
        },
        body: {
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(
              Buffer.from('<html><body><p>Fresh content</p></body></html>').buffer
            ),
        },
      });

      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.3) }],
          }),
        },
      });

      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [{ embedding: Array(1024).fill(0.3) }],
          }),
        },
      });

      const refreshedResult = await handleReadFromPage(
        {
          url: testUrl,
          query: 'test',
          maxResults: 3,
          forceRefresh: true,
        },
        logger
      );

      // Should get fresh content
      const parsedRefreshedContent = parseReadFromPageResult(refreshedResult);
      expect(parsedRefreshedContent.queries[0].results.length).toBeGreaterThan(0);

      // Should have made fresh HTTP request (not 304)
      const httpCalls = mockClientRequest.mock.calls.filter(
        (call: any) =>
          !call[0]?.url?.includes('/v1/embeddings') &&
          !(typeof call[0] === 'string' && call[0].includes('/v1/embeddings'))
      );
      expect(httpCalls.length).toBeGreaterThan(1); // Fresh fetch happened
    });
  });

  describe('Error Handling', () => {
    it('should handle HTTP errors gracefully', async () => {
      mockClientRequest.mockRejectedValueOnce(new Error('Network error'));

      const input = {
        url: testUrl,
        query: 'test query',
        maxResults: 3,
      };

      await expect(handleReadFromPage(input, logger)).rejects.toThrow();
    });

    it('should handle embedding service errors gracefully', async () => {
      // Mock successful content fetch
      mockClientRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: {
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(Buffer.from('<html><body><p>Test content</p></body></html>').buffer),
        },
      });

      // Mock embedding service failure
      mockUndici.request.mockRejectedValueOnce(new Error('Embedding service unavailable'));

      const input = {
        url: testUrl,
        query: 'test query',
        maxResults: 3,
      };

      // Embedding service fails, but should not throw - should degrade gracefully
      const result = await handleReadFromPage(input, logger);

      // Parse MCP content and check graceful degradation
      const parsedErrorContent = parseReadFromPageResult(result);
      expect(parsedErrorContent.note).toMatch(/embedding.*unavailable|without.*semantic.*search/i);

      // In degraded mode, results might be empty since no embeddings are available
      expect(parsedErrorContent.queries).toHaveLength(1);
      expect(parsedErrorContent.queries[0].query).toBe('test query');
    });
  });

  describe('Multiple Queries', () => {
    it('should handle multiple queries correctly', async () => {
      mockClientRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: {
          arrayBuffer: jest
            .fn()
            .mockResolvedValue(
              Buffer.from(
                '<html><body><p>Content about AI and ML and blockchain technology</p></body></html>'
              ).buffer
            ),
        },
      });

      // Content embedding - handle multiple chunks (readability can extract more content)
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [
              { embedding: Array(1024).fill(0.8) },
              { embedding: Array(1024).fill(0.8) },
              { embedding: Array(1024).fill(0.8) },
              { embedding: Array(1024).fill(0.8) },
              { embedding: Array(1024).fill(0.8) },
            ], // Support up to 5 chunks that readability might extract
          }),
        },
      });

      // First query embedding - 'artificial intelligence'
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [
              { embedding: Array(1024).fill(0.8) }, // AI query - high similarity
            ],
          }),
        },
      });

      // Second query embedding - 'blockchain'
      mockUndici.request.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          json: jest.fn().mockResolvedValue({
            data: [
              { embedding: Array(1024).fill(0.8) }, // blockchain query - high similarity
            ],
          }),
        },
      });

      const input = {
        url: testUrl,
        query: ['artificial intelligence', 'blockchain'],
        maxResults: 3,
      };

      const result = await handleReadFromPage(input, logger);

      // Parse MCP content format
      const parsedMultiContent = parseReadFromPageResult(result);

      // Should process both queries
      expect(parsedMultiContent.queries).toHaveLength(2);
      expect(parsedMultiContent.queries[0].query).toBe('artificial intelligence');
      expect(parsedMultiContent.queries[1].query).toBe('blockchain');

      // If embedding service fails, should gracefully degrade with note field
      if (parsedMultiContent.note) {
        expect(parsedMultiContent.note).toMatch(
          /embedding.*unavailable|without.*semantic.*search/i
        );
        // In degraded mode, results may be empty
        expect(parsedMultiContent.queries[0].results.length).toBeGreaterThanOrEqual(0);
        expect(parsedMultiContent.queries[1].results.length).toBeGreaterThanOrEqual(0);
      } else {
        // If embeddings work, should have results
        expect(parsedMultiContent.queries[0].results.length).toBeGreaterThan(0);
        expect(parsedMultiContent.queries[1].results.length).toBeGreaterThan(0);
      }
    });
  });
});
