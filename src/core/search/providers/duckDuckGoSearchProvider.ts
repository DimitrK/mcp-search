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

const DUCKDUCKGO_API_BASE_URL = 'https://api.duckduckgo.com/';

const DuckDuckGoTopicSchema: z.ZodType<{
  FirstURL?: string;
  Text?: string;
  Result?: string;
  Topics?: Array<{ FirstURL?: string; Text?: string; Result?: string }>;
}> = z.lazy(() =>
  z
    .object({
      FirstURL: z.string().url().optional(),
      Text: z.string().optional(),
      Result: z.string().optional(),
      Topics: z.array(DuckDuckGoTopicSchema).optional(),
    })
    .passthrough()
);

const DuckDuckGoResponseSchema = z
  .object({
    AbstractURL: z.string().url().optional(),
    AbstractText: z.string().optional(),
    Heading: z.string().optional(),
    Results: z.array(DuckDuckGoTopicSchema).optional(),
    RelatedTopics: z.array(DuckDuckGoTopicSchema).optional(),
  })
  .passthrough();

type DuckDuckGoTopic = z.infer<typeof DuckDuckGoTopicSchema>;

export class DuckDuckGoSearchProvider extends BatchedSearchProvider {
  readonly name = 'duckduckgo' as const;
  readonly displayName = 'DuckDuckGo';

  constructor(concurrency: number, logger?: pino.Logger) {
    super(concurrency, logger);
  }

  protected async searchSingle(
    query: string,
    options?: SearchProviderOptions
  ): Promise<SearchQueryResult> {
    const searchParams = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });
    const url = `${DUCKDUCKGO_API_BASE_URL}?${searchParams}`;

    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const responseBody = await body.json();

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`DuckDuckGo API request failed with status ${statusCode}`);
    }

    const parsed = DuckDuckGoResponseSchema.parse(responseBody);
    const resultLimit = boundedResultsPerQuery(options?.resultsPerQuery, 50);
    const topics = flattenTopics([...(parsed.Results ?? []), ...(parsed.RelatedTopics ?? [])]);
    const topicItems = topics
      .filter(topic => topic.FirstURL && topic.Text)
      .slice(0, resultLimit)
      .map(topic => ({
        title: firstSentence(topic.Text!),
        link: topic.FirstURL!,
        displayLink: displayLinkFromUrl(topic.FirstURL!),
        snippet: topic.Text!,
        formattedUrl: topic.FirstURL!,
        raw: topic,
      }));

    const abstractItem =
      parsed.AbstractURL && parsed.AbstractText
        ? [
            {
              title: parsed.Heading || firstSentence(parsed.AbstractText),
              link: parsed.AbstractURL,
              displayLink: displayLinkFromUrl(parsed.AbstractURL),
              snippet: parsed.AbstractText,
              formattedUrl: parsed.AbstractURL,
              raw: {
                AbstractURL: parsed.AbstractURL,
                AbstractText: parsed.AbstractText,
                Heading: parsed.Heading,
              },
            },
          ]
        : [];

    return {
      query,
      result: {
        provider: this.name,
        items: [...abstractItem, ...topicItems].slice(0, resultLimit),
        raw: parsed,
      },
    };
  }
}

function flattenTopics(topics: DuckDuckGoTopic[]): DuckDuckGoTopic[] {
  return topics.flatMap(topic => (topic.Topics ? flattenTopics(topic.Topics) : [topic]));
}

function firstSentence(text: string): string {
  const [first] = text.split(/(?<=[.!?])\s+/);
  return first || text;
}
