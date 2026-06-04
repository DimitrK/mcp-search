import { request } from 'undici';
import type pino from 'pino';
import { z } from 'zod';
import {
  BatchedSearchProvider,
  boundedResultsPerQuery,
  displayLinkFromUrl,
  SearchProviderOptions,
  SearchQueryResult,
} from '../searchProvider';

const TAVILY_API_URL = 'https://api.tavily.com/search';
const TavilyResponseTimeSchema = z.preprocess(
  value => (typeof value === 'string' ? Number(value) : value),
  z.number()
);

const TavilyResultSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().url().optional(),
    content: z.string().optional(),
    score: z.number().optional(),
    raw_content: z.string().nullable().optional(),
    favicon: z.string().url().optional(),
    published_date: z.string().optional(),
  })
  .passthrough();

const TavilySearchResponseSchema = z
  .object({
    query: z.string().optional(),
    answer: z.string().nullable().optional(),
    follow_up_questions: z.array(z.string()).nullable().optional(),
    images: z.array(z.unknown()).optional(),
    results: z.array(TavilyResultSchema).optional(),
    response_time: TavilyResponseTimeSchema.optional(),
    request_id: z.string().optional(),
  })
  .passthrough();

export class TavilySearchProvider extends BatchedSearchProvider {
  readonly name = 'tavily' as const;
  readonly displayName = 'Tavily Search';

  constructor(
    private readonly apiKey: string,
    concurrency: number,
    logger?: pino.Logger
  ) {
    super(concurrency, logger);

    if (!apiKey) {
      throw new Error('Tavily Search API key is required');
    }
  }

  protected async searchSingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SearchQueryResult> {
    const requestBody = {
      query,
      topic: options?.topic ?? 'general',
      search_depth: options?.searchDepth ?? 'basic',
      max_results: boundedResultsPerQuery(options?.resultsPerQuery, 20),
      ...(options?.timeRange ? { time_range: options.timeRange } : {}),
    };

    const { statusCode, body } = await request(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await body.json();

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Tavily Search API request failed with status ${statusCode}`);
    }

    const parsed = TavilySearchResponseSchema.parse(responseBody);
    const items = (parsed.results ?? [])
      .filter(result => result.url && result.title)
      .map(result => ({
        title: result.title!,
        link: result.url!,
        displayLink: displayLinkFromUrl(result.url!),
        snippet: result.content || '',
        formattedUrl: result.url!,
        score: result.score,
        publishedDate: result.published_date,
        favicon: result.favicon,
        rawContent: result.raw_content,
        raw: result,
      }));

    return {
      query,
      result: {
        provider: this.name,
        items,
        answer: parsed.answer,
        followUpQuestions: parsed.follow_up_questions,
        responseTime: parsed.response_time,
        requestId: parsed.request_id,
        raw: parsed,
      },
    };
  }
}
