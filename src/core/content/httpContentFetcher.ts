import { request } from 'undici';
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

  const headers: Record<string, string> = {
    'user-agent': 'mcp-search/0.1 (+https://github.com/your-username/mcp-search)',
    'accept-encoding': 'gzip, br, deflate',
  };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;

  try {
    const correlationId = generateCorrelationId();
    const log = createChildLogger(correlationId);
    const requestPromise = request(url, {
      method: 'GET',
      signal: controller.signal,
      headers,
      maxRedirections: 3,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new TimeoutError('Request timed out', timeoutMs));
      }, timeoutMs);
    });

    const res = await withTiming(log, 'http.fetch', async () =>
      Promise.race([requestPromise, timeoutPromise])
    );
    clearTimeout(timeout);

    const statusCode = res.statusCode;
    const etag = (res.headers?.etag as string | undefined) ?? undefined;
    const lastModified = (res.headers?.['last-modified'] as string | undefined) ?? undefined;

    if (statusCode === 304) {
      return { statusCode, bodyText: '', etag, lastModified, notModified: true };
    }

    const encoding = (
      (res.headers?.['content-encoding'] as string | undefined) || ''
    ).toLowerCase();
    const ab = (await res.body.arrayBuffer()) as ArrayBuffer;
    let buf: Buffer = Buffer.from(ab);
    if (encoding.includes('br')) buf = brotliDecompressSync(buf);
    else if (encoding.includes('gzip')) buf = gunzipSync(buf);
    else if (encoding.includes('deflate')) buf = inflateSync(buf);
    const bodyText = buf.toString('utf8');
    if (statusCode >= 400) {
      throw new NetworkError('HTTP error', statusCode);
    }

    return { statusCode, bodyText, etag, lastModified };
  } catch (err) {
    if (err instanceof TimeoutError) {
      throw err;
    }
    if ((err as Error).name === 'AbortError') {
      throw new TimeoutError('Request timed out', timeoutMs);
    }
    throw err;
  }
}
