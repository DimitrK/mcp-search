import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { request } from 'undici';
import { fetchUrl } from '../../../../src/core/content/httpContentFetcher';
import { clearEnvironmentCache } from '../../../../src/config/environment';

jest.mock('undici', () => ({ request: jest.fn() as unknown }));
const mockedRequest = request as unknown as jest.Mock<
  Promise<{
    statusCode: number;
    headers: Record<string, unknown>;
    body: { text: () => Promise<string> };
  }>,
  [string, Record<string, unknown>]
>;

describe('httpContentFetcher', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    process.env.REQUEST_TIMEOUT_MS = '2000';
    clearEnvironmentCache();
  });

  test('fetches content with 200 and returns headers and body', async () => {
    const bodyText = 'Hello world';
    mockedRequest.mockResolvedValue({
      statusCode: 200,
      headers: { etag: 'W/"abc"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' },
      body: { text: () => Promise.resolve(bodyText) },
    });

    const res = await fetchUrl('https://example.com/test');
    expect(res.statusCode).toBe(200);
    expect(res.bodyText).toBe(bodyText);
    expect(res.etag).toBe('W/"abc"');
    expect(res.lastModified).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
  });

  test('sends If-None-Match and handles 304 Not Modified', async () => {
    mockedRequest.mockResolvedValue({
      statusCode: 304,
      headers: {},
      body: { text: () => Promise.resolve('') },
    });

    const res = await fetchUrl('https://example.com/page', { etag: 'W/"abc"' });
    expect(res.notModified).toBe(true);
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ 'if-none-match': 'W/"abc"' }) })
    );
  });

  test('times out according to REQUEST_TIMEOUT_MS', async () => {
    mockedRequest.mockImplementation(
      () =>
        new Promise(resolve => {
          const timer = setTimeout(
            () =>
              resolve({
                statusCode: 200,
                headers: {},
                body: { text: () => Promise.resolve('late') },
              }),
            5000
          );
          // @ts-expect-error Node timer has unref in Jest env
          if (typeof (timer as any).unref === 'function') (timer as any).unref();
        })
    );

    await expect(fetchUrl('https://example.com/slow', { timeoutMs: 50 })).rejects.toThrow(
      'timeout'
    );
  });

  test('rejects non-http(s) URLs', async () => {
    await expect(fetchUrl('file:///etc/passwd')).rejects.toThrow();
  });
});
