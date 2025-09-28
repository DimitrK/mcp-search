import type pino from 'pino';
import { ReadFromPageInput, ReadFromPageOutputType, RelevantChunkType } from '../mcp/schemas';
import { FetchOptions, FetchResult, fetchUrl } from '../core/content/httpContentFetcher';
import { extractContent } from '../core/content/htmlContentExtractor';
import { semanticChunker } from '../core/content/chunker';
import { EmbeddingIntegrationService } from '../core/vector/embeddingIntegrationService';
import { createEmbeddingProvider } from '../core/vector/embeddingProvider';
import { upsertDocument, getDocument, DocumentRow } from '../core/vector/store/documents';
import { similaritySearch } from '../core/vector/store/chunks';
import { normalizeUrl } from '../utils/urlValidator';
import { generateCorrelationId, withTiming } from '../utils/logger';
import { getEnvironment } from '../config/environment';
import { TimeoutError, NetworkError, ExtractionError, EmbeddingError } from '../mcp/errors';
import { sha256Hex } from '../utils/contentHash';
import { consolidateOverlappingChunks } from '../core/content/chunkConsolidator';

// Use singleton instance from import

export async function handleReadFromPage(
  args: unknown,
  logger: pino.Logger
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
  let embeddingService: EmbeddingIntegrationService | null = null;
  let note: string | undefined;

  try {
    // Phase 1: Content Fetching & Caching Logic
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
        const extractionResult = await withTiming(childLogger, 'content.extract', async () => {
          childLogger.debug({ contentLength: fetchResult.bodyText.length }, 'Extracting content');
          return await extractContent(fetchResult.bodyText, normalizedUrl);
        });

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
        try {
          const embeddingProvider = await createEmbeddingProvider({
            type: 'http',
            serverUrl: env.EMBEDDING_SERVER_URL,
            apiKey: env.EMBEDDING_SERVER_API_KEY,
            modelName: env.EMBEDDING_MODEL_NAME,
            batchSize: env.EMBEDDING_BATCH_SIZE,
          });

          embeddingService = new EmbeddingIntegrationService(embeddingProvider);

          await withTiming(childLogger, 'embedding.store', async () => {
            childLogger.debug({ chunkCount: chunks.length }, 'Storing content with embeddings');
            await embeddingService!.storeWithEmbeddings(normalizedUrl, chunks, { correlationId });
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
        } catch (embeddingError) {
          childLogger.warn(
            { error: embeddingError },
            'Embedding service failed - continuing with degraded functionality'
          );
          note = 'Embedding service unavailable; returning content without semantic search';

          // Store content without embeddings as fallback
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
    const queries = Array.isArray(input.query) ? input.query : [input.query];
    const queryResults = await withTiming(childLogger, 'query.process', async () => {
      const results: { query: string; results: RelevantChunkType[] }[] = [];

      if (embeddingService && !note) {
        // Use semantic search with embeddings
        for (const query of queries) {
          childLogger.debug({ query }, 'Processing query with semantic search');

          try {
            const searchResults = await embeddingService.searchSimilar(
              normalizedUrl,
              query,
              input.maxResults || 8,
              { correlationId }
            );

            // Apply similarity threshold filtering
            const filteredResults = searchResults.filter(
              result => result.score >= env.SIMILARITY_THRESHOLD
            );

            // Consolidate overlapping chunks for cleaner AI agent consumption
            const consolidatedResults = consolidateOverlappingChunks(filteredResults);

            childLogger.debug(
              {
                query,
                totalResults: searchResults.length,
                filteredResults: filteredResults.length,
                consolidatedResults: consolidatedResults.length,
                threshold: env.SIMILARITY_THRESHOLD,
              },
              'Query processing completed with chunk consolidation'
            );

            results.push({
              query,
              results: consolidatedResults.map(result => ({
                id: result.id,
                text: result.text,
                score: result.score,
                sectionPath: result.section_path ? result.section_path.split('|') : undefined,
              })),
            });
          } catch (queryError) {
            childLogger.warn(
              { error: queryError, query },
              'Query embedding failed - using fallback'
            );

            // Graceful degradation: set note and fall back to text search
            note =
              note || 'Embedding service unavailable; returning content without semantic search';

            // Add empty results for this query due to embedding failure
            results.push({
              query,
              results: [],
            });
          }
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
              input.maxResults || 8,
              1024 // dummy dimension
            );

            const matchingChunks = rawResults
              .filter(chunk => {
                const chunkText = chunk.text.toLowerCase();
                return queryTerms.some(term => chunkText.includes(term));
              })
              .slice(0, input.maxResults || 8)
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

    // Phase 5: Response Construction
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
    if (embeddingService) {
      try {
        await embeddingService.close();
      } catch (closeError) {
        childLogger.warn({ error: closeError }, 'Failed to close embedding service');
      }
    }
  }
}
