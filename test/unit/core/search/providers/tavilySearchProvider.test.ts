import { describe, expect, jest, test, afterEach } from '@jest/globals';
import { request } from 'undici';
import { TavilySearchProvider } from '../../../../../src/core/search/providers/tavilySearchProvider';

jest.mock('undici', () => ({
  request: jest.fn(),
}));

type JsonBody = { json: () => Promise<unknown> };
type UndiciResponse = { statusCode: number; body: JsonBody };
type UndiciRequest = (url: string, opts?: Record<string, unknown>) => Promise<UndiciResponse>;
const mockedRequest = request as unknown as jest.MockedFunction<UndiciRequest>;

describe('TavilySearchProvider', () => {
  afterEach(() => {
    mockedRequest.mockReset();
  });

  test('requires an API key', () => {
    expect(() => new TavilySearchProvider('', 2)).toThrow('Tavily Search API key is required');
  });

  test('maps Tavily results into canonical search items', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () =>
          Promise.resolve({
            query: 'starknet',
            answer: null,
            follow_up_questions: null,
            results: [
              {
                title: 'STRK - Starknet Documentation',
                url: 'https://docs.starknet.io/learn/protocol/strk',
                content: 'Starknet is a developing decentralized protocol.',
                score: 0.9998902,
                raw_content: null,
                favicon: 'https://docs.starknet.io/favicon.png',
              },
              {
                title: 'News Result',
                url: 'https://example.com/news',
                content: 'News snippet.',
                published_date: 'Thu, 28 May 2026 19:49:35 GMT',
              },
            ],
            response_time: '1.67',
            request_id: 'request-id',
          }),
      },
    });

    const provider = new TavilySearchProvider('tavily-key', 2);
    const result = await provider.search('starknet', {
      resultsPerQuery: 5,
      topic: 'news',
      searchDepth: 'advanced',
      timeRange: 'week',
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tavily-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          query: 'starknet',
          topic: 'news',
          search_depth: 'advanced',
          max_results: 5,
          time_range: 'week',
        }),
      })
    );
    expect(result.queries[0].result).toMatchObject({
      provider: 'tavily',
      responseTime: 1.67,
      requestId: 'request-id',
      items: [
        {
          title: 'STRK - Starknet Documentation',
          link: 'https://docs.starknet.io/learn/protocol/strk',
          displayLink: 'docs.starknet.io',
          snippet: 'Starknet is a developing decentralized protocol.',
          formattedUrl: 'https://docs.starknet.io/learn/protocol/strk',
          score: 0.9998902,
          favicon: 'https://docs.starknet.io/favicon.png',
          rawContent: null,
        },
        {
          title: 'News Result',
          link: 'https://example.com/news',
          displayLink: 'example.com',
          snippet: 'News snippet.',
          formattedUrl: 'https://example.com/news',
          publishedDate: 'Thu, 28 May 2026 19:49:35 GMT',
        },
      ],
    });
  });

  test('filters incomplete Tavily results and uses safe fallback fields', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () =>
          Promise.resolve({
            results: [
              {
                title: 'Complete Result',
                url: 'https://fallback.example.com/result',
              },
              {
                title: 'Missing URL',
                content: 'Ignored because URL is required',
              },
              {
                url: 'https://example.com/missing-title',
                content: 'Ignored because title is required',
              },
            ],
          }),
      },
    });

    const provider = new TavilySearchProvider('tavily-key', 2);
    const result = await provider.search('fallbacks');

    expect(result.queries[0].result.items).toEqual([
      expect.objectContaining({
        title: 'Complete Result',
        link: 'https://fallback.example.com/result',
        displayLink: 'fallback.example.com',
        snippet: '',
        formattedUrl: 'https://fallback.example.com/result',
      }),
    ]);
  });

  test('passes expanded Tavily search depth values through to the API', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve({ results: [] }),
      },
    });

    const provider = new TavilySearchProvider('tavily-key', 2);
    await provider.search('fast query', {
      resultsPerQuery: 50,
      searchDepth: 'ultra-fast',
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        body: JSON.stringify({
          query: 'fast query',
          topic: 'general',
          search_depth: 'ultra-fast',
          max_results: 20,
        }),
      })
    );
  });

  test('throws for non-success responses', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 401,
      body: { json: () => Promise.resolve({ error: 'Unauthorized' }) },
    });

    const provider = new TavilySearchProvider('tavily-key', 2);
    await expect(provider.search('test query')).rejects.toThrow(
      'Tavily Search API request failed with status 401'
    );
  });
});
