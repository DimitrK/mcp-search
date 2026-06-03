import { describe, expect, jest, test, afterEach } from '@jest/globals';
import { request } from 'undici';
import { BraveSearchProvider } from '../../../../../src/core/search/providers/braveSearchProvider';

jest.mock('undici', () => ({
  request: jest.fn(),
}));

type JsonBody = { json: () => Promise<unknown> };
type UndiciResponse = { statusCode: number; body: JsonBody };
type UndiciRequest = (url: string, opts?: Record<string, unknown>) => Promise<UndiciResponse>;
const mockedRequest = request as unknown as jest.MockedFunction<UndiciRequest>;

describe('BraveSearchProvider', () => {
  afterEach(() => {
    mockedRequest.mockReset();
  });

  test('maps Brave web and news results into canonical search items', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () =>
          Promise.resolve({
            web: {
              results: [
                {
                  title: 'Brave Result',
                  url: 'https://example.com/page',
                  description: 'Result description',
                  profile: { name: 'Example' },
                  extra: 'provider specific',
                },
              ],
            },
            news: {
              results: [
                {
                  title: 'Brave News Result',
                  url: 'https://news.example.com/story',
                  description: 'News result description',
                  source: 'Example News',
                  age: '2 hours ago',
                  extra_snippets: ['Provider-specific news snippet'],
                },
              ],
            },
          }),
      },
    });

    const provider = new BraveSearchProvider('brave-key', 2);
    const result = await provider.search('test query', { resultsPerQuery: 3 });

    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('api.search.brave.com/res/v1/web/search'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Subscription-Token': 'brave-key' }),
      })
    );
    expect(result.queries[0].result).toMatchObject({
      provider: 'brave',
      items: [
        {
          title: 'Brave Result',
          link: 'https://example.com/page',
          displayLink: 'Example',
          snippet: 'Result description',
          formattedUrl: 'https://example.com/page',
          resultType: 'web',
        },
        {
          title: 'Brave News Result',
          link: 'https://news.example.com/story',
          displayLink: 'Example News',
          snippet: 'News result description',
          formattedUrl: 'https://news.example.com/story',
          resultType: 'news',
          source: 'Example News',
          age: '2 hours ago',
        },
      ],
    });
  });

  test('maps supported provider hints to Brave query parameters', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve({ news: { results: [] } }),
      },
    });

    const provider = new BraveSearchProvider('brave-key', 2);
    await provider.search('latest ai news', {
      resultsPerQuery: 50,
      topic: 'news',
      timeRange: 'month',
      searchDepth: 'advanced',
    });

    const requestUrl = new URL(mockedRequest.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get('count')).toBe('20');
    expect(requestUrl.searchParams.get('freshness')).toBe('pm');
    expect(requestUrl.searchParams.get('result_filter')).toBe('news');
    expect(requestUrl.searchParams.has('search_depth')).toBe(false);
  });

  test('throws for non-success responses', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 401,
      body: { json: () => Promise.resolve({ message: 'Unauthorized' }) },
    });

    const provider = new BraveSearchProvider('brave-key', 2);
    await expect(provider.search('test query')).rejects.toThrow(
      'Brave Search API request failed with status 401'
    );
  });
});
