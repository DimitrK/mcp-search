import { describe, test, expect, beforeAll, afterEach, jest } from '@jest/globals';
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
  const { GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID } = getEnvironment();
  let googleClient: GoogleClient;

  beforeAll(() => {
    googleClient = new GoogleClient(GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID);
  });

  afterEach(() => {
    mockedRequest.mockClear();
  });

  test('should return a successful search result for a single query', async () => {
    const query = 'test query';
    const mockResponse = { items: [{ title: 'Test Result' }] };

    mockedRequest.mockResolvedValue({
      statusCode: 200,
      body: {
        json: () => Promise.resolve(mockResponse),
      },
    });

    const result = await googleClient.search(query);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query).toBe(query);
    expect(result.queries[0].result).toEqual(mockResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('test+query'),
      expect.any(Object)
    );
  });

  test('should handle multiple queries in parallel', async () => {
    const queries = ['query1', 'query2'];
    const mockResponse1 = { items: [{ title: 'Result 1' }] };
    const mockResponse2 = { items: [{ title: 'Result 2' }] };

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
    expect(q1?.result).toEqual(mockResponse1);
    expect(q2?.result).toEqual(mockResponse2);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
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
    const mockResponseSuccess = { items: [{ title: 'Recovered' }] };

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
    expect(result.queries[0].result).toEqual(mockResponseSuccess);
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
