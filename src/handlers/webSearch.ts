import type pino from 'pino';
import {
  SearchInput,
  SearchOutputType,
  SearchResultWithSimilarityType,
  GoogleSearchResultMinimalType,
  GoogleSearchResultFullType,
  GoogleSearchItemMinimalType,
  InPageMatchingReferencesType,
} from '../mcp/schemas';
import { GoogleClient } from '../core/search/googleClient';
import { getEnvironment } from '../config/environment';
import { normalizeUrl } from '../utils/urlValidator';
import { generateCorrelationId } from '../utils/logger';
import { InPageMatchingReferencesMapper } from '../core/similarity/mappers/inPageMatchingReferencesMapper';
import { handleReadFromPage } from './readFromPage';
import type { HandlerContext } from '../mcp/mcpServer';

/**
 * Fetches and indexes a URL using readFromPage, returning similarity search results
 * Reuses the readFromPage handler to avoid code duplication
 * Note: Does not pass context to readFromPage since webSearch manages its own progress
 */
async function fetchAndSearchUrl(
  url: string,
  query: string,
  logger: pino.Logger,
  correlationId: string
): Promise<{
  url: string;
  chunks: Array<{ id: string; text: string; score: number; sectionPath?: string[] }>;
  lastCrawled?: string;
}> {
  const childLogger = logger.child({ correlationId, url });

  try {
    // Reuse readFromPage handler which handles crawling, indexing, and similarity search
    // Don't pass context here - webSearch manages its own progress reporting
    // Use higher maxResults (30) to capture all relevant chunks above threshold
    // These will be consolidated by the similarity search pipeline
    const result = await handleReadFromPage(
      {
        url,
        query, // Use the actual search query for context
        maxResults: 30, // Higher limit to get all relevant chunks above threshold
      },
      logger,
      undefined // No progress context - parent handles it
    );

    // Parse the response to extract relevant chunks
    const parsedResponse = JSON.parse(result.content[0].text);
    const relevantChunks = parsedResponse.queries?.[0]?.results || [];

    childLogger.debug(
      { chunkCount: relevantChunks.length },
      'Successfully fetched and searched URL'
    );

    return {
      url,
      chunks: relevantChunks,
      lastCrawled: parsedResponse.lastCrawled,
    };
  } catch (error) {
    childLogger.warn({ error }, 'Failed to fetch and search URL - returning empty results');
    return { url, chunks: [], lastCrawled: undefined };
  }
}

export async function handleWebSearch(
  args: unknown,
  logger: pino.Logger,
  context?: HandlerContext
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = SearchInput.parse(args);
  const correlationId = generateCorrelationId();
  const childLogger = logger.child({ correlationId });

  childLogger.info({ input }, 'Processing web search request');

  const env = getEnvironment();
  const { GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID } = env;
  const googleClient = new GoogleClient(GOOGLE_API_KEY, GOOGLE_SEARCH_ENGINE_ID, childLogger);

  // Phase 1: Execute Google Search
  await context?.sendProgress(0, 100, 'Starting Google search...');
  const rawResult = await googleClient.search(input.query, {
    resultsPerQuery: input.resultsPerQuery,
  });

  const enhancedResults: SearchResultWithSimilarityType[] = [];

  // Phase 2: Process each query result
  for (const queryResult of rawResult.queries) {
    let enhancedGoogleResult: GoogleSearchResultMinimalType | GoogleSearchResultFullType;

    // Phase 3: Fetch and search URLs if similarity search is enabled
    if (
      input.enableSimilaritySearch !== false &&
      queryResult.result &&
      typeof queryResult.result === 'object'
    ) {
      const googleResult = queryResult.result as Record<string, unknown>;
      const items = googleResult.items as Array<Record<string, unknown>> | undefined;

      if (items && Array.isArray(items)) {
        // Extract URLs from top 3 results for performance
        const urls = items
          .slice(0, 3)
          .map(item => item.link as string)
          .filter((url): url is string => typeof url === 'string')
          .map(url => normalizeUrl(url));

        if (urls.length > 0) {
          // Phase 3: Fetch and search URLs using readFromPage (handles crawling, indexing, and similarity search)
          // Progress calculation: 1 step for Google search + 3 steps per URL
          // Each URL has 3 sub-steps: crawl, embeddings, similarity search
          const totalSteps = 1 + urls.length * 3;
          let currentStep = 1; // Google search completed

          childLogger.debug({ urlCount: urls.length, totalSteps }, 'Fetching and searching URLs');
          await context?.sendProgress(
            Math.round((currentStep / totalSteps) * 100),
            100,
            `Google search completed. Processing ${urls.length} URL${urls.length > 1 ? 's' : ''}...`
          );

          // Process URLs with granular progress updates
          const searchResults: Array<
            PromiseSettledResult<{
              url: string;
              chunks: Array<{ id: string; text: string; score: number; sectionPath?: string[] }>;
              lastCrawled?: string;
            }>
          > = [];

          for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const urlNum = i + 1;

            // Step 1 for this URL: Crawling
            currentStep++;
            await context?.sendProgress(
              Math.round((currentStep / totalSteps) * 100),
              100,
              `[${urlNum}/${urls.length}] Crawling page: ${new URL(url).hostname}...`
            );

            // Small delay to allow progress to be visible
            await new Promise(resolve => setTimeout(resolve, 10));

            // Step 2 for this URL: Creating embeddings (happens during fetchAndSearchUrl)
            currentStep++;
            await context?.sendProgress(
              Math.round((currentStep / totalSteps) * 100),
              100,
              `[${urlNum}/${urls.length}] Creating embeddings...`
            );

            // Execute the actual work
            const result = await fetchAndSearchUrl(
              url,
              queryResult.query,
              childLogger,
              correlationId
            ).catch(_error => ({ url, chunks: [], lastCrawled: undefined }));

            // Step 3 for this URL: Similarity search completed
            currentStep++;
            await context?.sendProgress(
              Math.round((currentStep / totalSteps) * 100),
              100,
              `[${urlNum}/${urls.length}] Similarity search completed`
            );

            searchResults.push({
              status: 'fulfilled' as const,
              value: result,
            });
          }

          // Build a map of URL -> search results
          const resultsMap = new Map<
            string,
            {
              chunks: Array<{ id: string; text: string; score: number; sectionPath?: string[] }>;
              lastCrawled?: string;
            }
          >();
          for (const result of searchResults) {
            if (result.status === 'fulfilled' && result.value.chunks.length > 0) {
              resultsMap.set(result.value.url, {
                chunks: result.value.chunks,
                lastCrawled: result.value.lastCrawled,
              });
            }
          }

          // Integrate search results into Google search items
          if (resultsMap.size > 0) {
            const enhancedItems = items.map(item => {
              const url = item.link as string;
              if (!url || typeof url !== 'string') return item;

              const normalizedUrl = normalizeUrl(url);
              const searchResult = resultsMap.get(normalizedUrl);

              if (searchResult && searchResult.chunks.length > 0) {
                // Map the chunks to the expected format
                const consolidatedChunks = searchResult.chunks.map(chunk => ({
                  id: chunk.id,
                  text: chunk.text,
                  score: chunk.score,
                  section_path: chunk.sectionPath?.join('|'),
                }));

                return {
                  ...item,
                  inPageMatchingReferences:
                    InPageMatchingReferencesMapper.mapChunksToInPageMatching(
                      consolidatedChunks,
                      searchResult.lastCrawled
                    ),
                };
              }

              return item;
            });

            // Update the Google result with enhanced items
            googleResult.items = enhancedItems;
          }
        }
      }

      // Apply minimal filtering
      enhancedGoogleResult = input.minimal
        ? minimizeGoogleResult(googleResult)
        : (googleResult as GoogleSearchResultFullType);
    } else {
      // No embedding service or invalid result, just apply minimal filtering
      enhancedGoogleResult = input.minimal
        ? minimizeGoogleResult(queryResult.result as Record<string, unknown>)
        : (queryResult.result as GoogleSearchResultFullType);
    }

    const enhancedResult: SearchResultWithSimilarityType = {
      query: queryResult.query,
      result: enhancedGoogleResult,
    };

    enhancedResults.push(enhancedResult);
  }

  const searchResult: SearchOutputType = {
    queries: enhancedResults,
  };

  await context?.sendProgress(100, 100, 'All searches completed');

  childLogger.info(
    {
      totalQueries: enhancedResults.length,
      queriesWithSimilarity: enhancedResults.filter(r => {
        const result = r.result as Record<string, unknown>;
        const items = result.items as Array<Record<string, unknown>> | undefined;
        return items?.some(item => item.inPageMatchingReferences) || false;
      }).length,
    },
    'Web search with similarity matching completed successfully'
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(searchResult satisfies SearchOutputType, null, 2),
      },
    ],
  };
}

function minimizeGoogleResult(result: Record<string, unknown>): GoogleSearchResultMinimalType {
  const minimized: GoogleSearchResultMinimalType = {};

  if (Array.isArray(result.items)) {
    minimized.items = (result.items as Array<Record<string, unknown>>).map(item => {
      const minimalItem: GoogleSearchItemMinimalType = {
        title: item.title as string,
        link: item.link as string,
        displayLink: item.displayLink as string,
        snippet: item.snippet as string,
        formattedUrl: item.formattedUrl as string,
      };

      // Include inPageMatchingReferences if present
      if (item.inPageMatchingReferences) {
        minimalItem.inPageMatchingReferences =
          item.inPageMatchingReferences as InPageMatchingReferencesType;
      }

      return minimalItem;
    });
  }

  return minimized;
}
