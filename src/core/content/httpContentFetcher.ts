import { Client, interceptors, Dispatcher } from 'undici';
const { redirect } = interceptors;
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';
import { getEnvironment } from '../../config/environment';
import { withTiming, createChildLogger, generateCorrelationId } from '../../utils/logger';
import { TimeoutError, NetworkError } from '../../mcp/errors';

export interface FetchOptions {
  etag?: string;
  timeoutMs?: number;
  lastModified?: string;
}

export interface FetchResult {
  statusCode: number;
  bodyText: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const { REQUEST_TIMEOUT_MS } = getEnvironment();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  if (!/^https?:\/\//i.test(url)) {
    throw new NetworkError('Only http(s) schemes are allowed');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let client: Dispatcher | null = null;

  const headers: Record<string, string> = {
    'accept-ranges': 'none',
    'accept-language': 'en-US,en;q=0.9,el;q=0.8,de;q=0.7,ru;q=0.6,ja;q=0.5,zh-CN;q=0.4,zh;q=0.3',
    'accept-encoding': 'gzip, br, deflate',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    date: new Date().toISOString(),
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    dnt: '1',
    connection: 'keep-alive',
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'cache-control': 'max-age=0',
    'sec-ch-ua-platform': 'macOS',
    'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-fetch-user': '?1',
  };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;

  try {
    const correlationId = generateCorrelationId();
    const log = createChildLogger(correlationId);

    // Parse URL to extract origin for Client
    const urlObj = new URL(url);
    const origin = urlObj.origin;
    const path = urlObj.pathname + urlObj.search + urlObj.hash;

    // Create client with redirect interceptor (maxRedirections: 3)
    client = new Client(origin).compose(redirect({ maxRedirections: 3 }));

    const requestPromise = client.request({
      path,
      method: 'GET',
      signal: controller.signal,
      headers,
    });

    let promiseTimeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      promiseTimeoutId = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError('Request timed out', timeoutMs));
      }, timeoutMs);
    });

    log.debug({}, 'About to start HTTP request race with timeout...');
    const res = await withTiming(log, 'http.fetch', async () =>
      Promise.race([requestPromise, timeoutPromise])
    );

    log.debug({ statusCode: res.statusCode }, 'HTTP request completed successfully');

    // Clear BOTH timeouts after successful network request
    // This allows body processing to continue without being aborted
    clearTimeout(timeout);
    if (promiseTimeoutId) {
      clearTimeout(promiseTimeoutId);
    }

    log.debug({}, 'Both timeouts cleared - body processing can proceed without abort');

    // Close client to avoid resource leaks (with timeout to prevent hanging)
    log.debug({}, 'About to close undici client...');
    if (client && 'close' in client && typeof client.close === 'function') {
      try {
        // Timeout the client.close() operation to prevent indefinite hanging
        await Promise.race([
          client.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Client close timeout')), 2000)
          ),
        ]);
        log.debug({}, 'Undici client closed successfully');
      } catch (err) {
        log.warn(
          { error: (err as Error).message },
          'Client close failed or timed out - continuing anyway'
        );
        // Don't throw - we have our response, client cleanup is not critical
      }
    } else {
      log.debug({}, 'No client to close or client has no close method');
    }

    const statusCode = res.statusCode;
    const etag = (res.headers?.etag as string | undefined) ?? undefined;
    const lastModified = (res.headers?.['last-modified'] as string | undefined) ?? undefined;

    if (statusCode === 304) {
      return { statusCode, bodyText: '', etag, lastModified, notModified: true };
    }

    const encoding = (
      (res.headers?.['content-encoding'] as string | undefined) || ''
    ).toLowerCase();

    log.debug({ encoding }, 'Body processing started');

    log.debug({}, 'About to read response body arrayBuffer...');
    const ab = (await res.body.arrayBuffer()) as ArrayBuffer;
    log.debug({ arrayBufferSize: ab.byteLength }, 'Response body arrayBuffer read successfully');

    log.debug({}, 'Converting arrayBuffer to Buffer...');
    let buf: Buffer = Buffer.from(ab);
    log.debug({ bufferSize: buf.length }, 'Buffer conversion completed');

    if (encoding.includes('br')) {
      log.debug({}, 'Decompressing with brotli...');
      buf = brotliDecompressSync(buf);
      log.debug({ decompressedSize: buf.length }, 'Brotli decompression completed');
    } else if (encoding.includes('gzip')) {
      log.debug({}, 'Decompressing with gzip...');
      buf = gunzipSync(buf);
      log.debug({ decompressedSize: buf.length }, 'Gzip decompression completed');
    } else if (encoding.includes('deflate')) {
      log.debug({}, 'Decompressing with deflate...');
      buf = inflateSync(buf);
      log.debug({ decompressedSize: buf.length }, 'Deflate decompression completed');
    } else {
      log.debug({}, 'No decompression needed');
    }

    log.debug({ bufferSize: buf.length }, 'About to convert buffer to UTF-8 string...');
    const bodyText = buf.toString('utf8');
    log.debug({ textLength: bodyText.length }, 'UTF-8 string conversion completed');
    if (statusCode >= 400) {
      throw new NetworkError('HTTP error', statusCode);
    }

    return { statusCode, bodyText, etag, lastModified };
  } catch (err) {
    // Make sure to close client even on error
    if (client && 'close' in client && typeof client.close === 'function') {
      try {
        await client.close();
      } catch {
        // Ignore close errors, focus on original error
      }
    }

    if (err instanceof TimeoutError) {
      throw err;
    }
    if ((err as Error).name === 'AbortError') {
      throw new TimeoutError('Request timed out', timeoutMs);
    }
    throw err;
  }
}
