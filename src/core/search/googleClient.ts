import { request } from 'undici';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getEnvironment } from '../../config/environment';

const GOOGLE_API_BASE_URL = 'https://www.googleapis.com';

export interface GoogleSearchResult {
  queries: Array<{
    query: string;
    result: unknown;
  }>;
}

interface GoogleApiResponse {
  items?: Array<{ title: string } & Record<string, unknown>>;
  error?: { message: string };
  [key: string]: unknown;
}

export class GoogleClient {
  private apiKey: string;
  private searchEngineId: string;
  private concurrency: number;
  private limiter: RateLimiterMemory;

  constructor(apiKey: string, searchEngineId: string) {
    if (!apiKey) {
      throw new Error('Google API key is required');
    }
    if (!searchEngineId) {
      throw new Error('Google Search Engine ID is required');
    }
    this.apiKey = apiKey;
    this.searchEngineId = searchEngineId;
    this.concurrency = getEnvironment().CONCURRENCY;
    this.limiter = new RateLimiterMemory({ points: this.concurrency, duration: 1 });
  }

  private async singleSearch(
    query: string,
    resultsPerQuery = 5
  ): Promise<{ query: string; result: unknown }> {
    const searchParams = new URLSearchParams({
      key: this.apiKey,
      cx: this.searchEngineId,
      q: query,
      num: resultsPerQuery.toString(),
    });

    const url = `${GOOGLE_API_BASE_URL}/customsearch/v1?${searchParams}`;

    const acquireRateLimit = async (): Promise<void> => {
      // Wait for available rate limit rather than erroring
      // Ensures no retry on 429 at HTTP level while pacing requests
      for (;;) {
        try {
          await this.limiter.consume('google.customsearch');
          return;
        } catch (e) {
          const res = e as RateLimiterRes;
          const delayMs = Math.max(50, res.msBeforeNext ?? 100);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    };

    await acquireRateLimit();

    const attemptRequest = async (): Promise<{
      statusCode: number;
      responseBody: GoogleApiResponse;
    }> => {
      const { statusCode, body } = await request(url, { method: 'GET' });
      const responseBody = (await body.json()) as GoogleApiResponse;
      return { statusCode, responseBody };
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let statusCode: number | null = null;
      let responseBody: GoogleApiResponse | null = null;

      try {
        const res = await attemptRequest();
        statusCode = res.statusCode;
        responseBody = res.responseBody;
      } catch (networkErr) {
        lastError = networkErr as Error;
        if (attempt === 0) {
          const jitter = 100 + Math.floor(Math.random() * 200) + attempt * 100;
          await new Promise(res => setTimeout(res, jitter));
          continue;
        }
        break;
      }

      if (statusCode === null || responseBody === null) {
        lastError = new Error('Google API request failed');
        break;
      }

      if (statusCode >= 500) {
        const message = responseBody.error?.message || 'An unknown error occurred';
        lastError = new Error(`Google API request failed with status ${statusCode}: ${message}`);
        if (attempt === 0) {
          const jitter = 100 + Math.floor(Math.random() * 200) + attempt * 100;
          await new Promise(res => setTimeout(res, jitter));
          continue;
        }
        break;
      }

      if (statusCode >= 400) {
        const message = responseBody.error?.message || 'An unknown error occurred';
        lastError = new Error(`Google API request failed with status ${statusCode}: ${message}`);
        break; // Do not retry 4xx including 429
      }

      return { query, result: responseBody };
    }

    throw lastError ?? new Error('Google API request failed');
  }

  async search(
    query: string | string[],
    options?: {
      resultsPerQuery?: number;
    }
  ): Promise<GoogleSearchResult> {
    const queries = Array.isArray(query) ? query : [query];

    const searchPromises = queries.map(q => this.singleSearch(q, options?.resultsPerQuery));

    // Simple concurrency limiting for now
    const results = [];
    for (let i = 0; i < searchPromises.length; i += this.concurrency) {
      const batch = searchPromises.slice(i, i + this.concurrency);
      results.push(...(await Promise.all(batch)));
    }

    return { queries: results };
  }
}
