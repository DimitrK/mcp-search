import { request } from 'undici';
import type pino from 'pino';
import { z } from 'zod';
import {
  BatchedSearchProvider,
  boundedResultsPerQuery,
  displayLinkFromUrl,
  SearchProviderOptions,
  SearchQueryResult,
  SearchResultItem,
  SearchTimeRange,
  SearchTopic,
} from '../searchProvider';

const BRAVE_API_BASE_URL = 'https://api.search.brave.com';

const BraveResultSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().url().optional(),
    description: z.string().optional(),
    source: z.string().optional(),
    age: z.string().optional(),
    page_age: z.string().optional(),
    profile: z
      .object({
        name: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const BraveSearchResponseSchema = z
  .object({
    web: z
      .object({
        results: z.array(BraveResultSchema).optional(),
      })
      .optional(),
    news: z
      .object({
        results: z.array(BraveResultSchema).optional(),
      })
      .optional(),
    query: z.record(z.unknown()).optional(),
  })
  .passthrough();

type BraveResult = z.infer<typeof BraveResultSchema>;

export class BraveSearchProvider extends BatchedSearchProvider {
  readonly name = 'brave' as const;
  readonly displayName = 'Brave Search';

  constructor(
    private readonly apiKey: string,
    concurrency: number,
    logger?: pino.Logger
  ) {
    super(concurrency, logger);

    if (!apiKey) {
      throw new Error('Brave Search API key is required');
    }
  }

  protected async searchSingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SearchQueryResult> {
    const searchParams = new URLSearchParams({
      q: query,
      count: String(boundedResultsPerQuery(options?.resultsPerQuery, 20)),
    });
    const freshness = braveFreshnessFromTimeRange(options?.timeRange);
    if (freshness) {
      searchParams.set('freshness', freshness);
    }
    const resultFilter = braveResultFilterFromTopic(options?.topic);
    if (resultFilter) {
      searchParams.set('result_filter', resultFilter);
    }
    const url = `${BRAVE_API_BASE_URL}/res/v1/web/search?${searchParams}`;

    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
    });
    const responseBody = await body.json();

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Brave Search API request failed with status ${statusCode}`);
    }

    const parsed = BraveSearchResponseSchema.parse(responseBody);
    const webItems = mapBraveResults(parsed.web?.results ?? [], 'web');
    const newsItems = mapBraveResults(parsed.news?.results ?? [], 'news');

    return {
      query,
      result: {
        provider: this.name,
        items: [...webItems, ...newsItems],
        raw: parsed,
      },
    };
  }
}

function braveFreshnessFromTimeRange(timeRange?: SearchTimeRange): string | undefined {
  switch (timeRange) {
    case 'day':
      return 'pd';
    case 'week':
      return 'pw';
    case 'month':
      return 'pm';
    case 'year':
      return 'py';
    default:
      return undefined;
  }
}

function braveResultFilterFromTopic(topic?: SearchTopic): string | undefined {
  return topic === 'news' ? 'news' : undefined;
}

function mapBraveResults(results: BraveResult[], resultType: 'web' | 'news'): SearchResultItem[] {
  return results
    .filter(result => result.url && result.title)
    .map(result => ({
      title: result.title!,
      link: result.url!,
      displayLink: result.profile?.name || result.source || displayLinkFromUrl(result.url!),
      snippet: result.description || '',
      formattedUrl: result.url!,
      resultType,
      source: result.source,
      age: result.age || result.page_age,
      raw: result,
    }));
}
