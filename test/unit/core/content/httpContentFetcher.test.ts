import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { fetchUrl } from '../../../../src/core/content/httpContentFetcher';
import { clearEnvironmentCache } from '../../../../src/config/environment';

// Simple mock that works around method chaining issues
const mockRequest = jest.fn() as jest.MockedFunction<any>;
const mockClose = jest.fn();

jest.mock('undici', () => ({
  Client: jest.fn().mockImplementation(() => ({
    request: mockRequest,
    close: mockClose,
    compose: jest.fn().mockReturnThis(),
  })),
  interceptors: {
    redirect: jest.fn().mockReturnValue(() => ({})),
  },
  Dispatcher: {},
}));

type UndiciTextBody = { text: () => Promise<string> };
type UndiciResponse = {
  statusCode: number;
  headers: Record<string, unknown>;
  body: UndiciTextBody;
};

describe('httpContentFetcher', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockClose.mockReset();
    process.env.REQUEST_TIMEOUT_MS = '2000';
    clearEnvironmentCache();
  });

  test('fetches content with 200 and returns headers and body', async () => {
    const bodyText = 'Hello world';
    mockRequest.mockResolvedValue({
      statusCode: 200,
      headers: { etag: 'W/"abc"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' },
      body: {
        text: () => Promise.resolve(bodyText),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(bodyText).buffer),
      } as unknown as UndiciTextBody,
    } as unknown as UndiciResponse);

    const res = await fetchUrl('https://example.com/test');
    expect(res.statusCode).toBe(200);
    expect(res.bodyText).toBe(bodyText);
    expect(res.etag).toBe('W/"abc"');
    expect(res.lastModified).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
  });

  test('sends If-None-Match and handles 304 Not Modified', async () => {
    mockRequest.mockResolvedValue({
      statusCode: 304,
      headers: {},
      body: {
        text: () => Promise.resolve(''),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as UndiciTextBody,
    } as unknown as UndiciResponse);

    const res = await fetchUrl('https://example.com/page', { etag: 'W/"abc"' });
    expect(res.notModified).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.any(String),
        headers: expect.objectContaining({ 'if-none-match': 'W/"abc"' }),
      })
    );
  });

  test('times out according to REQUEST_TIMEOUT_MS', async () => {
    mockRequest.mockImplementation(
      () =>
        new Promise(resolve => {
          const timer = setTimeout(
            () =>
              resolve({
                statusCode: 200,
                headers: {},
                body: {
                  text: () => Promise.resolve('late'),
                  arrayBuffer: () => Promise.resolve(new TextEncoder().encode('late').buffer),
                },
              }),
            5000
          );
          if (
            typeof timer === 'object' &&
            timer !== null &&
            'unref' in timer &&
            typeof (timer as NodeJS.Timeout).unref === 'function'
          ) {
            (timer as NodeJS.Timeout).unref();
          }
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
