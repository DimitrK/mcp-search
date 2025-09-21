import type pino from 'pino';
import { SearchInput, SearchOutputType } from '../mcp/schemas';
import { GoogleClient } from '../core/search/googleClient';
import { getEnvironment } from '../config/environment';

export async function handleWebSearch(
  args: unknown,
  logger: pino.Logger
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = SearchInput.parse(args);
  logger.info({ input }, 'Processing web search request');

  const { GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID } = getEnvironment();
  const googleClient = new GoogleClient(GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID, logger);

  const rawResult = await googleClient.search(input.query, {
    resultsPerQuery: input.resultsPerQuery,
  });

  const searchResult: SearchOutputType = input.minimal
    ? {
        queries: rawResult.queries.map(q => ({
          query: q.query,
          result: minimizeGoogleResult(q.result),
        })),
      }
    : rawResult;

  logger.info('Web search completed successfully');
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(searchResult satisfies SearchOutputType, null, 2),
      },
    ],
  };
}

function minimizeGoogleResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;

  const minimized: Record<string, unknown> = {
    kind: r.kind,
    searchInformation: r.searchInformation,
  };

  if (Array.isArray(r.items)) {
    minimized.items = (r.items as Array<Record<string, unknown>>).map(item => ({
      title: item.title,
      link: item.link,
      displayLink: item.displayLink,
      snippet: item.snippet,
      formattedUrl: item.formattedUrl,
    }));
  }

  return minimized;
}
