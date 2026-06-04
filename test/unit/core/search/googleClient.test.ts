import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { request } from 'undici';
import { GoogleClient } from '../../../../src/core/search/googleClient';
import { getEnvironment } from '../../../../src/config/environment';

jest.mock('undici', () => ({
  request: jest.fn(),
}));

type JsonBody = { json: () => Promise<unknown> };
type UndiciResponse = { statusCode: number; body: JsonBody };
type UndiciRequest = (url: string, opts?: Record<string, unknown>) => Promise<UndiciResponse>;
const mockedRequest = request as unknown as jest.MockedFunction<UndiciRequest>;

describe('GoogleClient', () => {
  const { SEARCH_ENGINE_API_KEY, GOOGLE_SEARCH_ENGINE_ID } = getEnvironment();
  let googleClient: GoogleClient;

  beforeEach(() => {
    googleClient = new GoogleClient(SEARCH_ENGINE_API_KEY!, GOOGLE_SEARCH_ENGINE_ID!);
  });

  afterEach(() => {
    mockedRequest.mockClear();
  });

  test('requires API credentials', () => {
    expect(() => new GoogleClient('', GOOGLE_SEARCH_ENGINE_ID!)).toThrow(
      'Google API key is required'
    );
    expect(() => new GoogleClient(SEARCH_ENGINE_API_KEY!, '')).toThrow(
      'Google Search Engine ID is required'
    );
  });

  test('should return a successful search result for a single query', async () => {
    const query = 'test query';
    const mockResponse = {
      items: [
        {
          title: 'Test Result',
          link: 'https://example.com/result',
          displayLink: 'example.com',
          snippet: 'Test snippet',
          formattedUrl: 'https://example.com/result',
        },
      ],
    };

    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve(mockResponse),
      },
    });

    const result = await googleClient.search(query);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query).toBe(query);
    expect(result.queries[0].result).toMatchObject({
      ...mockResponse,
      provider: 'google',
      raw: mockResponse,
    });
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('test+query'),
      expect.any(Object)
    );
  });

  test('should normalize incomplete Google items safely', async () => {
    const mockResponse = {
      items: [
        {
          title: 'Fallback Result',
          link: 'https://fallback.example.com/result',
        },
        {
          title: 'Missing Link',
        },
        {
          link: 'https://example.com/missing-title',
        },
      ],
    };

    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve(mockResponse),
      },
    });

    const result = await googleClient.search('fallback query');

    expect(result.queries[0].result.items).toEqual([
      expect.objectContaining({
        title: 'Fallback Result',
        link: 'https://fallback.example.com/result',
        displayLink: 'fallback.example.com',
        snippet: '',
        formattedUrl: 'https://fallback.example.com/result',
      }),
    ]);
  });

  test('should map timeRange to Google dateRestrict and cap result count', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve({ items: [] }),
      },
    });

    await googleClient.search('recent query', { resultsPerQuery: 50, timeRange: 'week' });

    const requestUrl = new URL(mockedRequest.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get('dateRestrict')).toBe('w1');
    expect(requestUrl.searchParams.get('num')).toBe('10');
  });

  test.each<['day' | 'month' | 'year', 'd1' | 'm1' | 'y1']>([
    ['day', 'd1'],
    ['month', 'm1'],
    ['year', 'y1'],
  ])('should map %s timeRange to Google dateRestrict', async (timeRange, expected) => {
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve({ items: [] }),
      },
    });

    await googleClient.search('recent query', { timeRange });

    const requestUrl = new URL(mockedRequest.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get('dateRestrict')).toBe(expected);
  });

  test('should retry once after a network error and succeed', async () => {
    const query = 'network retry';
    const mockResponseSuccess = {
      items: [
        {
          title: 'Recovered',
          link: 'https://example.com/recovered',
          displayLink: 'example.com',
          snippet: 'Recovered snippet',
          formattedUrl: 'https://example.com/recovered',
        },
      ],
    };

    mockedRequest.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce({
      statusCode: 200,
      body: { json: () => Promise.resolve(mockResponseSuccess) },
    });

    const result = await googleClient.search(query);

    expect(result.queries[0].result).toMatchObject({
      provider: 'google',
      items: [expect.objectContaining({ title: 'Recovered' })],
    });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  test('should throw when all network attempts fail', async () => {
    mockedRequest.mockRejectedValue(new Error('socket hang up'));

    await expect(googleClient.search('network failure')).rejects.toThrow('socket hang up');
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  test('should handle multiple queries in parallel', async () => {
    const queries = ['query1', 'query2'];
    const mockResponse1 = {
      items: [
        {
          title: 'Result 1',
          link: 'https://example.com/one',
          displayLink: 'example.com',
          snippet: 'Snippet 1',
          formattedUrl: 'https://example.com/one',
        },
      ],
    };
    const mockResponse2 = {
      items: [
        {
          title: 'Result 2',
          link: 'https://example.com/two',
          displayLink: 'example.com',
          snippet: 'Snippet 2',
          formattedUrl: 'https://example.com/two',
        },
      ],
    };

    mockedRequest.mockImplementation((url: string) => {
      let body: unknown;
      if (url.includes('q=query1')) {
        body = mockResponse1;
      } else if (url.includes('q=query2')) {
        body = mockResponse2;
      }
      return Promise.resolve({
        statusCode: 200,
        body: { json: () => Promise.resolve(body) },
      });
    });

    const result = await googleClient.search(queries);
    expect(result.queries).toHaveLength(2);
    const q1 = result.queries.find(r => r.query === 'query1');
    const q2 = result.queries.find(r => r.query === 'query2');
    expect(q1?.result).toMatchObject({ ...mockResponse1, provider: 'google' });
    expect(q2?.result).toMatchObject({ ...mockResponse2, provider: 'google' });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  test('should return partial results when some queries fail', async () => {
    const queries = ['ok', 'fail'];
    const okResponse = {
      items: [
        {
          title: 'OK',
          link: 'https://example.com/ok',
          displayLink: 'example.com',
          snippet: 'OK snippet',
          formattedUrl: 'https://example.com/ok',
        },
      ],
    };

    mockedRequest.mockImplementation((url: string) => {
      if (url.includes('q=ok')) {
        return Promise.resolve({
          statusCode: 200,
          body: { json: () => Promise.resolve(okResponse) },
        });
      }
      if (url.includes('q=fail')) {
        return Promise.resolve({
          statusCode: 500,
          body: { json: () => Promise.resolve({ error: { message: 'Internal Server Error' } }) },
        });
      }
      return Promise.resolve({ statusCode: 200, body: { json: () => Promise.resolve({}) } });
    });

    const result = await googleClient.search(queries);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query).toBe('ok');
    expect(result.queries[0].result).toMatchObject({ ...okResponse, provider: 'google' });
  });

  test('should throw when all queries fail', async () => {
    const queries = ['f1', 'f2'];

    mockedRequest.mockResolvedValue({
      statusCode: 500,
      body: { json: () => Promise.resolve({ error: { message: 'Internal Server Error' } }) },
    });

    await expect(googleClient.search(queries)).rejects.toThrow(
      'Google API request failed with status 500: Internal Server Error'
    );
  });

  test('should throw an error for API failures', async () => {
    const query = 'failing query';
    const errorResponse = { error: { message: 'Internal Server Error' } };

    mockedRequest.mockResolvedValue({
      statusCode: 500,
      body: {
        json: () => Promise.resolve(errorResponse),
      },
    });

    await expect(googleClient.search(query)).rejects.toThrow(
      'Google API request failed with status 500: Internal Server Error'
    );
  });

  test('should handle invalid API key or credentials', async () => {
    const query = 'invalid key query';
    const errorResponse = { error: { message: 'Permission denied' } };

    mockedRequest.mockResolvedValue({
      statusCode: 403,
      body: {
        json: () => Promise.resolve(errorResponse),
      },
    });

    await expect(googleClient.search(query)).rejects.toThrow(
      'Google API request failed with status 403: Permission denied'
    );
  });

  test('should retry once on 5xx and succeed on second attempt', async () => {
    const query = 'retry success';
    const mockResponseSuccess = {
      items: [
        {
          title: 'Recovered',
          link: 'https://example.com/recovered',
          displayLink: 'example.com',
          snippet: 'Recovered snippet',
          formattedUrl: 'https://example.com/recovered',
        },
      ],
    };

    const first = {
      statusCode: 500,
      body: { json: () => Promise.resolve({ error: { message: 'Internal Server Error' } }) },
    };
    const second = {
      statusCode: 200,
      body: { json: () => Promise.resolve(mockResponseSuccess) },
    };

    mockedRequest.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const result = await googleClient.search(query);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query).toBe(query);
    expect(result.queries[0].result).toMatchObject({
      ...mockResponseSuccess,
      provider: 'google',
    });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  test('should not retry and throw on 429 Too Many Requests', async () => {
    const query = 'rate limited';
    const errorResponse = { error: { message: 'Too Many Requests' } };

    mockedRequest.mockResolvedValue({
      statusCode: 429,
      body: { json: () => Promise.resolve(errorResponse) },
    });

    await expect(googleClient.search(query)).rejects.toThrow(
      'Google API request failed with status 429: Too Many Requests'
    );
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});
