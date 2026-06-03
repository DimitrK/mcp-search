import { request } from 'undici';
import type pino from 'pino';
import { getEnvironment } from '../../config/environment';
import {
  BatchedSearchProvider,
  boundedResultsPerQuery,
  displayLinkFromUrl,
  SearchProviderOptions,
  SearchProviderResponse,
  SearchQueryResult,
  SearchTimeRange,
} from './searchProvider';

const GOOGLE_API_BASE_URL = 'https://www.googleapis.com';

interface GoogleApiResponse {
  items?: Array<{ title: string } & Record<string, unknown>>;
  error?: { message: string };
  [key: string]: unknown;
}

export class GoogleClient extends BatchedSearchProvider {
  readonly name = 'google' as const;
  readonly displayName = 'Google Custom Search';

  private apiKey: string;
  private searchEngineId: string;

  constructor(apiKey: string, searchEngineId: string, logger?: pino.Logger, concurrency?: number) {
    super(concurrency ?? getEnvironment().CONCURRENCY, logger);

    if (!apiKey) {
      throw new Error('Google API key is required');
    }
    if (!searchEngineId) {
      throw new Error('Google Search Engine ID is required');
    }
    this.apiKey = apiKey;
    this.searchEngineId = searchEngineId;
  }

  protected async searchSingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SearchQueryResult> {
    const searchParams = new URLSearchParams({
      key: this.apiKey,
      cx: this.searchEngineId,
      q: query,
      num: String(boundedResultsPerQuery(options?.resultsPerQuery, 10)),
    });
    const dateRestrict = googleDateRestrictFromTimeRange(options?.timeRange);
    if (dateRestrict) {
      searchParams.set('dateRestrict', dateRestrict);
    }

    const url = `${GOOGLE_API_BASE_URL}/customsearch/v1?${searchParams}`;

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
      const items = responseBody.items
        ?.filter(item => typeof item.link === 'string' && typeof item.title === 'string')
        .map(item => ({
          ...item,
          title: item.title,
          link: item.link as string,
          displayLink:
            typeof item.displayLink === 'string'
              ? item.displayLink
              : displayLinkFromUrl(item.link as string),
          snippet: typeof item.snippet === 'string' ? item.snippet : '',
          formattedUrl:
            typeof item.formattedUrl === 'string' ? item.formattedUrl : (item.link as string),
          raw: item,
        }));

      return {
        query,
        result: {
          ...responseBody,
          provider: this.name,
          items,
          raw: responseBody,
        },
      };
    }

    throw lastError ?? new Error('Google API request failed');
  }

  async search(
    query: string | string[],
    options?: SearchProviderOptions
  ): Promise<SearchProviderResponse> {
    return super.search(query, options);
  }
}

function googleDateRestrictFromTimeRange(timeRange?: SearchTimeRange): string | undefined {
  switch (timeRange) {
    case 'day':
      return 'd1';
    case 'week':
      return 'w1';
    case 'month':
      return 'm1';
    case 'year':
      return 'y1';
    default:
      return undefined;
  }
}
