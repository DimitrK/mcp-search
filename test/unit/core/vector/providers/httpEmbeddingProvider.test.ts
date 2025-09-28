import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { request } from 'undici';
import { HttpEmbeddingProvider } from '../../../../../src/core/vector/providers/httpEmbeddingProvider';
import { EmbeddingError } from '../../../../../src/mcp/errors';

jest.mock('undici', () => ({
  request: jest.fn(),
}));

type JsonBody = { json: () => Promise<unknown>; text: () => Promise<string> };
type UndiciResponse = { statusCode: number; body: JsonBody };
type UndiciRequest = (url: string, opts?: Record<string, unknown>) => Promise<UndiciResponse>;
const mockedRequest = request as unknown as jest.MockedFunction<UndiciRequest>;

describe('HttpEmbeddingProvider', () => {
  const mockConfig = {
    type: 'http' as const,
    serverUrl: 'https://api.example.com',
    apiKey: 'test-api-key',
    modelName: 'text-embedding-3-small',
    batchSize: 8,
    // timeoutMs will use default
  };

  let provider: HttpEmbeddingProvider;

  beforeEach(() => {
    provider = new HttpEmbeddingProvider(mockConfig);
    mockedRequest.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and basic properties', () => {
    it('should initialize with correct configuration', () => {
      expect(provider.getModelName()).toBe('text-embedding-3-small');
      // Dimension should not be available until first embed() call
      expect(() => provider.getDimension()).toThrow('Dimension not yet determined');
    });

    it('should use default batch size if not provided', () => {
      const providerWithDefaults = new HttpEmbeddingProvider({
        type: 'http',
        serverUrl: 'https://api.example.com',
        apiKey: 'test-key',
        modelName: 'test-model',
      });

      expect(providerWithDefaults['batchSize']).toBe(8); // Default batch size
    });

    it('should throw when required config is missing', () => {
      expect(
        () =>
          new HttpEmbeddingProvider({
            type: 'http',
            // Missing serverUrl, apiKey, modelName
          } as any)
      ).toThrow(EmbeddingError);
    });
  });

  describe('embed method - successful cases', () => {
    it('should successfully embed a single text', async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      mockedRequest.mockResolvedValue({
        statusCode: 200,
        body: {
          json: () =>
            Promise.resolve({
              data: [
                {
                  embedding: mockEmbedding,
                  index: 0,
                },
              ],
              model: 'text-embedding-3-small',
              usage: { total_tokens: 10 },
            }),
          text: () => Promise.resolve(''),
        },
      });

      const result = await provider.embed(['test text']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockEmbedding);

      // Dimension should be auto-detected after first embed() call
      expect(provider.getDimension()).toBe(1536);

      expect(mockedRequest).toHaveBeenCalledWith(
        'https://api.example.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: ['test text'],
          }),
        })
      );
    });

    it('should successfully embed multiple texts in single batch', async () => {
      const mockEmbedding1 = new Array(1536).fill(0.3);
      const mockEmbedding2 = new Array(1536).fill(0.7);

      mockedRequest.mockResolvedValue({
        statusCode: 200,
        body: {
          json: () =>
            Promise.resolve({
              data: [
                { embedding: mockEmbedding1, index: 0 },
                { embedding: mockEmbedding2, index: 1 },
              ],
              model: 'text-embedding-3-small',
              usage: { total_tokens: 20 },
            }),
          text: () => Promise.resolve(''),
        },
      });

      const result = await provider.embed(['text1', 'text2']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockEmbedding1);
      expect(result[1]).toEqual(mockEmbedding2);
    });

    it('should handle batch processing for large input arrays', async () => {
      const texts = Array.from({ length: 12 }, (_, i) => `text ${i}`);
      const mockEmbedding = new Array(1536).fill(0.1);

      // Mock responses for two batches: 8 + 4 texts
      mockedRequest
        .mockResolvedValueOnce({
          statusCode: 200,
          body: {
            json: () =>
              Promise.resolve({
                data: Array.from({ length: 8 }, (_, index) => ({
                  embedding: mockEmbedding,
                  index,
                })),
                model: 'text-embedding-3-small',
                usage: { total_tokens: 40 },
              }),
            text: () => Promise.resolve(''),
          },
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          body: {
            json: () =>
              Promise.resolve({
                data: Array.from({ length: 4 }, (_, index) => ({
                  embedding: mockEmbedding,
                  index,
                })),
                model: 'text-embedding-3-small',
                usage: { total_tokens: 20 },
              }),
            text: () => Promise.resolve(''),
          },
        });

      const result = await provider.embed(texts);

      expect(result).toHaveLength(12);
      expect(result.every(emb => emb.length === 1536)).toBe(true);
      expect(mockedRequest).toHaveBeenCalledTimes(2); // Two batches
    });
  });

  describe('embed method - error handling', () => {
    it('should throw EmbeddingError for 4xx client errors', async () => {
      mockedRequest.mockResolvedValue({
        statusCode: 400,
        body: {
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(JSON.stringify({ error: { message: 'Invalid input' } })),
        },
      });

      await expect(provider.embed(['test'])).rejects.toThrow(EmbeddingError);
      await expect(provider.embed(['test'])).rejects.toThrow('Invalid input');
    });

    it('should retry once for 5xx server errors and succeed', async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      mockedRequest
        .mockResolvedValueOnce({
          statusCode: 500,
          body: {
            json: () => Promise.resolve({}),
            text: () =>
              Promise.resolve(JSON.stringify({ error: { message: 'Internal server error' } })),
          },
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          body: {
            json: () =>
              Promise.resolve({
                data: [{ embedding: mockEmbedding, index: 0 }],
                model: 'text-embedding-3-small',
                usage: { total_tokens: 5 },
              }),
            text: () => Promise.resolve(''),
          },
        });

      const result = await provider.embed(['test text']);
      expect(result[0]).toEqual(mockEmbedding);
      expect(mockedRequest).toHaveBeenCalledTimes(2); // Initial call + retry
    });

    it('should fail after single retry for persistent 5xx errors', async () => {
      mockedRequest.mockResolvedValue({
        statusCode: 500,
        body: {
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(JSON.stringify({ error: { message: 'Server error' } })),
        },
      });

      await expect(provider.embed(['test'])).rejects.toThrow('Server error');
      expect(mockedRequest).toHaveBeenCalledTimes(2); // Initial call + retry
    });

    it('should not retry for 429 rate limit errors', async () => {
      mockedRequest.mockResolvedValue({
        statusCode: 429,
        body: {
          json: () => Promise.resolve({}),
          text: () =>
            Promise.resolve(JSON.stringify({ error: { message: 'Rate limit exceeded' } })),
        },
      });

      await expect(provider.embed(['test'])).rejects.toThrow('Rate limit exceeded');
      expect(mockedRequest).toHaveBeenCalledTimes(1); // No retry
    });

    it('should handle network errors', async () => {
      mockedRequest.mockRejectedValue(new Error('Network error'));

      await expect(provider.embed(['test'])).rejects.toThrow(EmbeddingError);
      await expect(provider.embed(['test'])).rejects.toThrow('Request failed: Network error');
    });

    it('should handle malformed response data', async () => {
      mockedRequest.mockResolvedValue({
        statusCode: 200,
        body: {
          json: () => Promise.resolve({ invalid: 'response' }),
          text: () => Promise.resolve(''),
        },
      });

      await expect(provider.embed(['test'])).rejects.toThrow(EmbeddingError);
      await expect(provider.embed(['test'])).rejects.toThrow('Invalid response format');
    });
  });

  describe('dimension and model validation', () => {
    it('should validate response embedding dimensions after auto-detection', async () => {
      // First, establish dimension with 1536-dimensional embedding
      const correctEmbedding = new Array(1536).fill(0.5);
      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: () =>
            Promise.resolve({
              data: [{ embedding: correctEmbedding, index: 0 }],
              model: 'text-embedding-3-small',
              usage: { total_tokens: 5 },
            }),
          text: () => Promise.resolve(''),
        },
      });

      await provider.embed(['first text']); // This establishes dimension as 1536

      // Now test with wrong dimension
      const wrongDimensionEmbedding = new Array(512).fill(0.5);
      mockedRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: () =>
            Promise.resolve({
              data: [{ embedding: wrongDimensionEmbedding, index: 0 }],
              model: 'text-embedding-3-small',
              usage: { total_tokens: 5 },
            }),
          text: () => Promise.resolve(''),
        },
      });

      await expect(provider.embed(['test'])).rejects.toThrow('dimension mismatch');
    });

    it('should handle empty input array', async () => {
      const result = await provider.embed([]);
      expect(result).toEqual([]);
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('request formatting', () => {
    it('should send correct request headers and body', async () => {
      const mockEmbedding = new Array(1536).fill(0.5);

      mockedRequest.mockResolvedValue({
        statusCode: 200,
        body: {
          json: () =>
            Promise.resolve({
              data: [{ embedding: mockEmbedding, index: 0 }],
              model: 'text-embedding-3-small',
              usage: { total_tokens: 5 },
            }),
          text: () => Promise.resolve(''),
        },
      });

      await provider.embed(['test text']);

      expect(mockedRequest).toHaveBeenCalledWith(
        'https://api.example.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: ['test text'],
          }),
          signal: expect.any(AbortSignal),
        })
      );
    });
  });
});
