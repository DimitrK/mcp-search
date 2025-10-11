import type pino from 'pino';
import { ReadFromPageInput, ReadFromPageOutputType, RelevantChunkType } from '../mcp/schemas';
import { FetchOptions, FetchResult, fetchUrl } from '../core/content/httpContentFetcher';
import { extractContent } from '../core/content/htmlContentExtractor';
import { semanticChunker } from '../core/content/chunker';
import { upsertDocument, getDocument, DocumentRow } from '../core/vector/store/documents';
import { similaritySearch } from '../core/vector/store/chunks';
import { normalizeUrl } from '../utils/urlValidator';
import { generateCorrelationId, withTiming } from '../utils/logger';
import { getEnvironment } from '../config/environment';
import { TimeoutError, NetworkError, ExtractionError, EmbeddingError } from '../mcp/errors';
import { sha256Hex } from '../utils/contentHash';
import { SimilaritySearchManager } from '../core/similarity/similaritySearchManager';
import { RelevantChunkMapper } from '../core/similarity/mappers/relevantChunkMapper';
import type { HandlerContext } from '../mcp/mcpServer';

// Use singleton instance from import

export async function handleReadFromPage(
  args: unknown,
  logger: pino.Logger,
  context?: HandlerContext
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = ReadFromPageInput.parse(args);
  const correlationId = generateCorrelationId();
  const childLogger = logger.child({ correlationId });

  childLogger.debug(
    {
      url: input.url,
      queryCount: Array.isArray(input.query) ? input.query.length : 1,
      maxResults: input.maxResults,
      forceRefresh: input.forceRefresh,
    },
    'Processing read from page request'
  );

  const normalizedUrl = normalizeUrl(input.url);
  const env = getEnvironment();
  let searchManager: SimilaritySearchManager | null = null;
  let note: string | undefined;

  try {
    // Phase 1: Content Fetching & Caching Logic
    await context?.sendProgress(0, 100, 'Checking cache...');
    const { shouldProcess, existingDoc } = await withTiming(
      childLogger,
      'cache.check',
      async () => {
        if (input.forceRefresh) {
          childLogger.debug({}, 'Force refresh requested - bypassing cache');
          return { shouldProcess: true, existingDoc: null };
        }

        const existing = await getDocument(normalizedUrl);
        if (!existing) {
          childLogger.debug({}, 'No cached document found - fetching fresh');
          return { shouldProcess: true, existingDoc: null };
        }

        childLogger.debug(
          {
            lastCrawled: existing.last_crawled,
            etag: existing.etag,
          },
          'Found cached document - making conditional request'
        );

        // Always make conditional requests when we have cached content
        // This allows for 304 responses when content hasn't changed
        return { shouldProcess: true, existingDoc: existing };
      }
    );

    let fetchResult: FetchResult;
    let documentMetadata: DocumentRow | undefined;

    if (shouldProcess) {
      // Fetch content (potentially with conditional GET)
      await context?.sendProgress(10, 100, 'Fetching content...');
      fetchResult = await withTiming(childLogger, 'content.fetch', async () => {
        const fetchOptions: FetchOptions = {};
        if (existingDoc?.etag && !input.forceRefresh) {
          fetchOptions.etag = existingDoc.etag;
        }

        return await fetchUrl(normalizedUrl, fetchOptions);
      });

      if (fetchResult.notModified) {
        childLogger.debug({}, 'Content not modified - using cached chunks');
        if (!existingDoc) {
          throw new Error(
            'Internal error: Expected cached document but none found for 304 response'
          );
        }
        documentMetadata = existingDoc;
      } else {
        // Phase 2: Content Processing Pipeline
        await context?.sendProgress(30, 100, 'Extracting content...');
        const extractionResult = await withTiming(childLogger, 'content.extract', async () => {
          childLogger.debug({ contentLength: fetchResult.bodyText.length }, 'Extracting content');
          return await extractContent(fetchResult.bodyText, normalizedUrl);
        });

        await context?.sendProgress(40, 100, 'Chunking content...');
        const chunks = await withTiming(childLogger, 'content.chunk', async () => {
          const chunkingOptions = {
            maxTokens: env.EMBEDDING_TOKENS_SIZE,
            overlapPercentage: 15, // 15% overlap as per specification
          };

          childLogger.debug(
            {
              contentLength: extractionResult.textContent.length,
              extractionMethod: extractionResult.extractionMethod,
            },
            'Chunking content'
          );

          return semanticChunker.chunk(extractionResult, chunkingOptions, normalizedUrl);
        });

        // Phase 3: Embedding Integration
        await context?.sendProgress(50, 100, 'Generating embeddings...');
        try {
          searchManager = await SimilaritySearchManager.create(childLogger, {
            correlationId,
          });

          if (searchManager) {
            await withTiming(childLogger, 'embedding.store', async () => {
              childLogger.debug({ chunkCount: chunks.length }, 'Storing content with embeddings');
              await searchManager!.storeWithEmbeddings(normalizedUrl, chunks, { correlationId });
            });

            // Store document metadata in success path
            await upsertDocument(
              {
                url: normalizedUrl,
                title: extractionResult.title || undefined,
                etag: fetchResult.etag,
                last_modified: fetchResult.lastModified,
                last_crawled: new Date().toISOString(),
                content_hash: sha256Hex(extractionResult.textContent), // Real content hash per spec
              },
              { correlationId }
            );

            childLogger.debug({}, 'Content processing completed successfully');
          } else {
            // Store content without embeddings as fallback
            note = 'Embedding service unavailable; returning content without semantic search';
            await upsertDocument(
              {
                url: normalizedUrl,
                title: extractionResult.title || undefined,
                etag: fetchResult.etag,
                last_crawled: new Date().toISOString(),
                content_hash: sha256Hex(extractionResult.textContent), // Real content hash per spec
              },
              { correlationId }
            );
            childLogger.debug(
              {},
              'Content stored without embeddings due to manager initialization failure'
            );
          }
        } catch (embeddingError) {
          childLogger.warn(
            { error: embeddingError },
            'Embedding service failed - continuing with degraded functionality'
          );
          note = 'Embedding service unavailable; returning content without semantic search';

          // Store content without embeddings as fallback
          try {
            await upsertDocument(
              {
                url: normalizedUrl,
                title: extractionResult.title || undefined,
                etag: fetchResult.etag,
                last_crawled: new Date().toISOString(),
                content_hash: sha256Hex(extractionResult.textContent), // Real content hash per spec
              },
              { correlationId }
            );
          } catch (upsertError) {
            childLogger.warn(
              { error: upsertError },
              'Failed to store document metadata after embedding failure - continuing'
            );
          }
        }

        // Update document metadata
        const contentHash = sha256Hex(extractionResult.textContent);
        documentMetadata = {
          url: normalizedUrl,
          title: extractionResult.title || undefined,
          etag: fetchResult.etag,
          last_modified: fetchResult.lastModified,
          last_crawled: new Date().toISOString(),
          content_hash: contentHash, // Real content hash per spec
        };
      }
    }

    // Phase 4: Query Processing & Similarity Search
    await context?.sendProgress(70, 100, 'Processing similarity search...');
    const queries = Array.isArray(input.query) ? input.query : [input.query];

    let queryResults: { query: string; results: RelevantChunkType[] }[];
    try {
      queryResults = await withTiming(childLogger, 'query.process', async () => {
        const results: { query: string; results: RelevantChunkType[] }[] = [];

        if (searchManager && !note) {
          // Use manager for parallel query processing
          const similarityResults = await searchManager.searchMultiple(
            queries,
            normalizedUrl,
            input.maxResults,
            { correlationId }
          );

          // Map results to expected format
          for (const query of queries) {
            const chunks = similarityResults.get(query) || [];
            results.push({
              query,
              results: RelevantChunkMapper.mapChunksToRelevant(chunks),
            });
          }
        } else {
          // Fallback: Return raw chunks without semantic scoring
          childLogger.debug({}, 'Using fallback content retrieval without embeddings');

          for (const query of queries) {
            // Simple text matching fallback - get chunks that contain query terms
            const queryTerms = query.toLowerCase().split(/\s+/);

            try {
              // Try to get any existing chunks for basic content return
              const rawResults = await similaritySearch(
                normalizedUrl,
                Array(1024).fill(0), // Dummy embedding
                input.maxResults,
                1024 // dummy dimension
              );

              const matchingChunks = rawResults
                .filter(chunk => {
                  const chunkText = chunk.text.toLowerCase();
                  return queryTerms.some(term => chunkText.includes(term));
                })
                .slice(0, input.maxResults)
                .map(chunk => ({
                  id: chunk.id,
                  text: chunk.text,
                  score: 0.5, // Default score for fallback
                  sectionPath: chunk.section_path ? chunk.section_path.split('|') : undefined,
                }));

              results.push({
                query,
                results: matchingChunks,
              });
            } catch (searchError) {
              childLogger.warn({ error: searchError }, 'Fallback search also failed');
              // Return empty results for this query
              results.push({
                query,
                results: [],
              });
            }
          }
        }

        return results;
      });
    } catch (queryError) {
      // If query processing fails due to embedding issues, set note and use fallback
      if (!note && (queryError as Error).message.includes('Embedding')) {
        childLogger.warn(
          { error: queryError },
          'Embedding service failed during query processing - using fallback'
        );
        note = 'Embedding service unavailable; returning content without semantic search';
      } else if (!note) {
        // Check if it's an embedding-related error by checking the error type or nested error
        const error = queryError as Error & {
          type?: string;
          originalError?: { name?: string };
        };
        if (
          error?.type === 'embedding' ||
          error?.originalError?.name === 'EmbeddingError' ||
          error?.message?.includes('embedding')
        ) {
          childLogger.warn(
            { error: queryError },
            'Embedding service failed during query processing - using fallback'
          );
          note = 'Embedding service unavailable; returning content without semantic search';
        }
      }

      // Use fallback query processing
      queryResults = [];
      for (const query of queries) {
        try {
          const rawResults = await similaritySearch(
            normalizedUrl,
            Array(1024).fill(0), // Dummy embedding
            input.maxResults,
            1024 // dummy dimension
          );

          const matchingChunks = rawResults.slice(0, input.maxResults);
          queryResults.push({
            query,
            results: RelevantChunkMapper.mapChunksToRelevant(matchingChunks),
          });
        } catch (fallbackError) {
          childLogger.warn(
            { error: fallbackError, query },
            'Fallback search also failed - returning empty results'
          );
          queryResults.push({
            query,
            results: [],
          });
        }
      }
    }

    // Phase 5: Response Construction
    await context?.sendProgress(90, 100, 'Building response...');
    if (!documentMetadata) {
      throw new Error('Internal error: documentMetadata was not set during processing');
    }

    const response: ReadFromPageOutputType = {
      url: input.url,
      title: documentMetadata.title,
      lastCrawled: documentMetadata.last_crawled || new Date().toISOString(),
      queries: queryResults,
      note,
    };

    await context?.sendProgress(100, 100, 'Completed');

    childLogger.info(
      {
        totalQueries: queryResults.length,
        totalResults: queryResults.reduce((sum, q) => sum + q.results.length, 0),
        hasEmbeddings: !note,
      },
      'Read from page completed successfully'
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            response,
            (key, value) => (typeof value === 'bigint' ? value.toString() : value),
            2
          ),
        },
      ],
    };
  } catch (error) {
    childLogger.error({ error }, 'Read from page failed');

    // Error classification and MCP-compliant responses
    if (error instanceof TimeoutError) {
      throw new TimeoutError(`Request timed out: ${error.message}`, 30000);
    } else if (error instanceof NetworkError) {
      throw new NetworkError(`Network error: ${error.message}`, 500);
    } else if (error instanceof ExtractionError) {
      throw new ExtractionError(`Content extraction failed: ${error.message}`);
    } else if (error instanceof EmbeddingError) {
      // This should not happen anymore due to graceful degradation, but handle just in case
      childLogger.warn({ error }, 'Unhandled embedding error - this indicates a logic gap');
      throw new EmbeddingError(`Embedding processing failed: ${error.message}`, 'http');
    } else {
      // Unknown error - wrap it appropriately
      throw new Error(
        `Read from page failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } finally {
    // Cleanup resources
    if (searchManager) {
      await searchManager.close();
    }
  }
}
