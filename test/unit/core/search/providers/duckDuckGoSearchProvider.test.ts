import { describe, expect, jest, test, afterEach } from '@jest/globals';
import { request } from 'undici';
import { DuckDuckGoSearchProvider } from '../../../../../src/core/search/providers/duckDuckGoSearchProvider';

jest.mock('undici', () => ({
  request: jest.fn(),
}));

type JsonBody = { json: () => Promise<unknown> };
type UndiciResponse = { statusCode: number; body: JsonBody };
type UndiciRequest = (url: string, opts?: Record<string, unknown>) => Promise<UndiciResponse>;
const mockedRequest = request as unknown as jest.MockedFunction<UndiciRequest>;

describe('DuckDuckGoSearchProvider', () => {
  afterEach(() => {
    mockedRequest.mockReset();
  });

  test('maps DuckDuckGo instant answer topics into canonical search items', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () =>
          Promise.resolve({
            Heading: 'Duck Result',
            AbstractURL: 'https://example.com/abstract',
            AbstractText: 'Abstract summary.',
            RelatedTopics: [
              {
                Topics: [
                  {
                    FirstURL: 'https://example.com/topic',
                    Text: 'Topic summary. More detail.',
                  },
                ],
              },
            ],
          }),
      },
    });

    const provider = new DuckDuckGoSearchProvider(2);
    const result = await provider.search('test query', { resultsPerQuery: 5 });

    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('api.duckduckgo.com'),
      expect.any(Object)
    );
    expect(result.queries[0].result).toMatchObject({
      provider: 'duckduckgo',
      items: [
        {
          title: 'Duck Result',
          link: 'https://example.com/abstract',
          displayLink: 'example.com',
          snippet: 'Abstract summary.',
          formattedUrl: 'https://example.com/abstract',
        },
        {
          title: 'Topic summary.',
          link: 'https://example.com/topic',
          displayLink: 'example.com',
          snippet: 'Topic summary. More detail.',
          formattedUrl: 'https://example.com/topic',
        },
      ],
    });
  });

  test('ignores provider hints that DuckDuckGo instant answers do not support', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve({ RelatedTopics: [] }),
      },
    });

    const provider = new DuckDuckGoSearchProvider(2);
    await provider.search('test query', {
      topic: 'news',
      searchDepth: 'advanced',
      timeRange: 'day',
    });

    const requestUrl = new URL(mockedRequest.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.has('topic')).toBe(false);
    expect(requestUrl.searchParams.has('search_depth')).toBe(false);
    expect(requestUrl.searchParams.has('time_range')).toBe(false);
    expect(requestUrl.searchParams.has('freshness')).toBe(false);
  });

  test('throws for non-success responses', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 500,
      body: { json: () => Promise.resolve({}) },
    });

    const provider = new DuckDuckGoSearchProvider(2);
    await expect(provider.search('test query')).rejects.toThrow(
      'DuckDuckGo API request failed with status 500'
    );
  });
});
