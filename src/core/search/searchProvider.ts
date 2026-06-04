import type pino from 'pino';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { withTiming } from '../../utils/logger';

export type SearchProviderName = 'google' | 'brave' | 'duckduckgo' | 'tavily';
export type SearchTopic = 'general' | 'news' | 'finance';
export type SearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast';
export type SearchTimeRange = 'day' | 'week' | 'month' | 'year';

export interface SearchProviderOptions {
  resultsPerQuery?: number;
  topic?: SearchTopic;
  searchDepth?: SearchDepth;
  timeRange?: SearchTimeRange;
}

export interface SearchResultItem {
  title: string;
  link: string;
  displayLink: string;
  snippet: string;
  formattedUrl: string;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchProviderResult {
  provider: SearchProviderName;
  items?: SearchResultItem[];
  raw?: unknown;
  [key: string]: unknown;
}

export interface SearchQueryResult {
  query: string;
  result: SearchProviderResult;
}

export interface SearchProviderResponse {
  queries: SearchQueryResult[];
}

export interface SearchProvider {
  readonly name: SearchProviderName;
  readonly displayName: string;
  search(
    query: string | string[],
    options?: SearchProviderOptions
  ): Promise<SearchProviderResponse>;
}

export abstract class BatchedSearchProvider implements SearchProvider {
  abstract readonly name: SearchProviderName;
  abstract readonly displayName: string;

  private readonly limiter: RateLimiterMemory;

  protected constructor(
    protected readonly concurrency: number,
    protected readonly logger?: pino.Logger
  ) {
    this.limiter = new RateLimiterMemory({ points: concurrency, duration: 1 });
  }

  async search(
    query: string | string[],
    options?: SearchProviderOptions
  ): Promise<SearchProviderResponse> {
    const queries = Array.isArray(query) ? query : [query];
    this.logger?.debug(
      { provider: this.name, queriesCount: queries.length },
      'Starting batched search provider requests'
    );

    const results: SearchQueryResult[] = [];
    let lastFailure: unknown = null;

    for (let i = 0; i < queries.length; i += this.concurrency) {
      const batch = queries.slice(i, i + this.concurrency);
      const batchNumber = Math.floor(i / this.concurrency) + 1;
      const settled = await withTiming(
        this.logger ?? (console as unknown as pino.Logger),
        `${this.name}.search.batch`,
        async () => Promise.allSettled(batch.map(q => this.searchSingleWithRateLimit(q, options))),
        { batchNumber, batchSize: batch.length, provider: this.name }
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          lastFailure = result.reason;
          this.logger?.error(
            {
              provider: this.name,
              batchNumber,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            },
            'Search provider request failed'
          );
        }
      }
    }

    if (results.length === 0 && lastFailure) {
      throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure));
    }

    return { queries: results };
  }

  protected abstract searchSingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SearchQueryResult>;

  private async searchSingleWithRateLimit(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SearchQueryResult> {
    await this.acquireRateLimit(query);
    return this.searchSingle(query, options);
  }

  private async acquireRateLimit(query: string): Promise<void> {
    for (;;) {
      try {
        await this.limiter.consume(this.name);
        this.logger?.debug({ provider: this.name, query }, 'Rate limit token acquired');
        return;
      } catch (error) {
        const res = error as RateLimiterRes;
        const delayMs = Math.max(50, res.msBeforeNext ?? 100);
        this.logger?.debug(
          { provider: this.name, query, delayMs, remainingPoints: res.remainingPoints },
          'Rate limited; waiting'
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
}

export function displayLinkFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function boundedResultsPerQuery(
  requested: number | undefined,
  maxResults: number,
  defaultResults = 5
): number {
  const normalized = requested ?? defaultResults;
  return Math.min(Math.max(normalized, 1), maxResults);
}
