import { request } from 'undici';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import type pino from 'pino';
import { getEnvironment } from '../../config/environment';
import { withTiming } from '../../utils/logger';

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
  private logger?: pino.Logger;

  constructor(apiKey: string, searchEngineId: string, logger?: pino.Logger) {
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
    this.logger = logger;
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
          this.logger?.debug({ query, url }, 'Rate limit token acquired');
          return;
        } catch (e) {
          const res = e as RateLimiterRes;
          const delayMs = Math.max(50, res.msBeforeNext ?? 100);
          this.logger?.debug(
            { query, delayMs, remainingPoints: res.remainingPoints },
            'Rate limited; waiting'
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    };

    await acquireRateLimit();

    const attemptRequest = async (): Promise<{
      statusCode: number;
      responseBody: GoogleApiResponse;
    }> => {
      this.logger?.debug({ query, url }, 'Issuing Google Custom Search request');
      const { statusCode, body } = await request(url, { method: 'GET' });
      const responseBody = (await body.json()) as GoogleApiResponse;
      this.logger?.debug({ query, statusCode }, 'Google Custom Search response received');
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
        this.logger?.warn(
          { query, error: lastError?.message },
          'Google Custom Search network error'
        );
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
        this.logger?.warn({ query, statusCode, message }, 'Google Custom Search server error');
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
        this.logger?.info({ query, statusCode, message }, 'Google Custom Search client error');
        break; // Do not retry 4xx including 429
      }

      this.logger?.info({ query, statusCode }, 'Google Custom Search succeeded');
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
    this.logger?.debug({ queriesCount: queries.length }, 'Starting batched Google searches');

    const searchPromises = queries.map(q => this.singleSearch(q, options?.resultsPerQuery));

    // Simple concurrency limiting for now
    const results: Array<{ query: string; result: unknown }> = [];
    let lastFailure: unknown = null;
    for (let i = 0; i < searchPromises.length; i += this.concurrency) {
      const batch = searchPromises.slice(i, i + this.concurrency);
      const batchNumber = Math.floor(i / this.concurrency) + 1;
      const settled = await withTiming(
        this.logger ?? (console as unknown as pino.Logger),
        'google.search.batch',
        async () => Promise.allSettled(batch),
        { batchNumber, batchSize: batch.length }
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          lastFailure = r.reason;
          this.logger?.error(
            { batchNumber, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
            'Google search request failed'
          );
        }
      }
    }

    if (results.length === 0 && lastFailure) {
      throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure));
    }

    const aggregated = { queries: results };
    this.logger?.debug(
      { queriesCount: aggregated.queries.length },
      'Completed batched Google searches'
    );
    return aggregated;
  }
}
