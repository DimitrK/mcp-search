import type pino from 'pino';
import { getEnvironment } from '../../config/environment';
import { EmbeddingIntegrationService } from '../vector/embeddingIntegrationService';
import { createEmbeddingProvider } from '../vector/embeddingProvider';
import { consolidateOverlappingChunks } from '../content/chunkConsolidator';
import { withTiming } from '../../utils/logger';
import type { ContentChunk } from '../content/chunker';
import {
  ConsolidatedChunk,
  SimilaritySearchOptions,
  SimilaritySearchError,
  NetworkTimeoutError,
  EmbeddingServiceError,
  DatabaseConnectionError,
  RateLimitError,
} from './types';

/**
 * Unified manager for similarity search operations.
 *
 * Provides a simple, intuitive API for:
 * - Storing content with embeddings
 * - Searching similar content (single query)
 * - Batch/parallel query processing (multiple queries)
 * - Resource lifecycle management
 * - Graceful degradation
 *
 * This class replaces the previous SimilaritySearchFactory, SimilaritySearchPipeline,
 * and SimilaritySearchService to provide a simpler, more maintainable API.
 *
 * @example
 * ```typescript
 * const manager = await SimilaritySearchManager.create(logger, { correlationId });
 *
 * if (manager) {
 *   await manager.storeWithEmbeddings(url, chunks);
 *   const results = await manager.searchMultiple(queries, url, maxResults);
 *   await manager.close();
 * }
 * ```
 */
export class SimilaritySearchManager {
  private embeddingService: EmbeddingIntegrationService;
  private logger: pino.Logger;

  private constructor(embeddingService: EmbeddingIntegrationService, logger: pino.Logger) {
    this.embeddingService = embeddingService;
    this.logger = logger;
  }

  /**
   * Create a new SimilaritySearchManager instance.
   *
   * Returns null if embedding service is unavailable (graceful degradation).
   * This allows the application to continue without semantic search functionality.
   *
   * @param logger - Logger instance
   * @param options - Optional configuration including correlationId
   * @returns Manager instance or null if embedding service unavailable
   */
  static async create(
    logger: pino.Logger,
    options: { correlationId?: string } = {}
  ): Promise<SimilaritySearchManager | null> {
    const childLogger = logger.child({
      correlationId: options.correlationId,
      component: 'SimilaritySearchManager',
    });

    try {
      const env = getEnvironment();
      childLogger.debug('Initializing similarity search manager');

      // Initialize embedding provider
      const embeddingProvider = await createEmbeddingProvider({
        type: 'http',
        serverUrl: env.EMBEDDING_SERVER_URL,
        apiKey: env.EMBEDDING_SERVER_API_KEY,
        modelName: env.EMBEDDING_MODEL_NAME,
        batchSize: env.EMBEDDING_BATCH_SIZE,
      });

      const embeddingService = new EmbeddingIntegrationService(embeddingProvider);

      childLogger.debug('Similarity search manager initialized successfully');
      return new SimilaritySearchManager(embeddingService, childLogger);
    } catch (error) {
      childLogger.warn(
        { error, correlationId: options.correlationId },
        'Failed to initialize similarity search manager - graceful degradation'
      );
      return null;
    }
  }

  /**
   * Store content chunks with embeddings in vector database.
   *
   * @param url - Document URL
   * @param chunks - Content chunks to store
   * @param options - Optional correlation ID for logging
   */
  async storeWithEmbeddings(
    url: string,
    chunks: ContentChunk[],
    options: { correlationId?: string } = {}
  ): Promise<void> {
    const childLogger = this.logger.child({
      correlationId: options.correlationId,
      url,
      chunkCount: chunks.length,
    });

    await withTiming(childLogger, 'manager.storeWithEmbeddings', async () => {
      childLogger.debug('Storing content with embeddings');
      await this.embeddingService.storeWithEmbeddings(url, chunks, options);
    });
  }

  /**
   * Search for similar content using a single query.
   *
   * Includes:
   * - Embedding generation for query
   * - Vector similarity search
   * - Result consolidation (merge overlapping chunks)
   * - Score filtering (above threshold)
   * - Error classification for graceful degradation
   *
   * @param url - Document URL to search within
   * @param query - Search query text
   * @param maxResults - Maximum number of results to return
   * @param options - Optional settings (correlationId, rate limiting, etc.)
   * @returns Array of consolidated, relevant chunks
   */
  async searchSimilar(
    url: string,
    query: string,
    maxResults: number,
    options: SimilaritySearchOptions = {}
  ): Promise<ConsolidatedChunk[]> {
    const env = getEnvironment();
    const childLogger = this.logger.child({
      correlationId: options.correlationId,
      url,
      query,
      maxResults,
    });

    try {
      childLogger.debug('Performing similarity search');

      // Generate embeddings and search
      const searchResults = await this.embeddingService.searchSimilar(
        url,
        query,
        maxResults,
        options
      );

      // Filter by similarity threshold
      const filteredResults = searchResults.filter(
        result => result.score >= env.SIMILARITY_THRESHOLD
      );

      // Consolidate overlapping chunks
      const consolidatedResults = consolidateOverlappingChunks(filteredResults);

      childLogger.debug(
        {
          totalResults: searchResults.length,
          filteredResults: filteredResults.length,
          consolidatedResults: consolidatedResults.length,
          threshold: env.SIMILARITY_THRESHOLD,
        },
        'Similarity search completed with consolidation'
      );

      return consolidatedResults.map(result => ({
        id: result.id,
        text: result.text,
        score: result.score,
        section_path: result.section_path,
      }));
    } catch (error) {
      // Classify error for better handling upstream
      const classifiedError = this.classifyError(error, url);

      childLogger.warn(
        {
          error: classifiedError,
          errorType: classifiedError.type,
          retryable: classifiedError.retryable,
        },
        'Similarity search failed - returning empty results'
      );

      // Return empty results for graceful degradation
      // Upstream can detect this and use fallback logic
      return [];
    }
  }

  /**
   * Search multiple queries in parallel with concurrency control.
   *
   * This implements TRUE parallel processing using Promise.allSettled with batching.
   * Queries within each batch are processed in parallel, with batch size controlled
   * by the concurrency parameter.
   *
   * @param queries - Array of search queries
   * @param url - Document URL to search within
   * @param maxResults - Maximum results per query
   * @param options - Optional settings including concurrency control
   * @returns Map of query -> results
   */
  async searchMultiple(
    queries: string[],
    url: string,
    maxResults: number,
    options: SimilaritySearchOptions & { concurrency?: number } = {}
  ): Promise<Map<string, ConsolidatedChunk[]>> {
    const env = getEnvironment();
    const concurrency = options.concurrency || env.CONCURRENCY;
    const childLogger = this.logger.child({
      correlationId: options.correlationId,
      url,
      queryCount: queries.length,
      concurrency,
    });

    childLogger.debug('Starting parallel similarity searches');

    const results = new Map<string, ConsolidatedChunk[]>();

    // Process queries in batches for controlled concurrency
    await withTiming(childLogger, 'manager.searchMultiple', async () => {
      for (let i = 0; i < queries.length; i += concurrency) {
        const batch = queries.slice(i, i + concurrency);
        const batchNumber = Math.floor(i / concurrency) + 1;

        childLogger.debug({ batchNumber, batchSize: batch.length }, 'Processing query batch');

        // TRUE parallel processing within batch
        const batchResults = await Promise.allSettled(
          batch.map(query => this.searchSimilar(url, query, maxResults, options))
        );

        // Collect results
        batch.forEach((query, index) => {
          const result = batchResults[index];
          if (result.status === 'fulfilled') {
            results.set(query, result.value);
          } else {
            childLogger.warn({ error: result.reason, query }, 'Query search failed in batch');
            results.set(query, []); // Empty results for failed queries
          }
        });
      }
    });

    childLogger.info(
      {
        totalQueries: queries.length,
        successfulQueries: Array.from(results.values()).filter(r => r.length > 0).length,
        successRate: `${((results.size / queries.length) * 100).toFixed(1)}%`,
      },
      'Parallel similarity searches completed'
    );

    return results;
  }

  /**
   * Clean up resources and close embedding service.
   * Should be called when done with similarity search operations.
   */
  async close(): Promise<void> {
    try {
      await this.embeddingService.close();
      this.logger.debug('Similarity search manager closed');
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Error closing embedding service - continuing anyway'
      );
      // Don't throw - cleanup failures shouldn't crash the application
    }
  }

  /**
   * Classify errors for better handling and graceful degradation.
   *
   * @private
   */
  private classifyError(error: unknown, url: string): SimilaritySearchError {
    if (!(error instanceof Error)) {
      return new SimilaritySearchError(
        `Unknown error during similarity search for ${url}`,
        'embedding',
        false,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    // Network/timeout errors
    if (error.message.includes('timeout') || error.message.includes('ECONNRESET')) {
      return new NetworkTimeoutError(
        `Network timeout during similarity search for ${url}`,
        30000,
        error
      );
    }

    // HTTP status errors from embedding service
    if (error.message.includes('status') && error.message.match(/\d{3}/)) {
      const statusMatch = error.message.match(/status (\d+)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : undefined;
      return new EmbeddingServiceError(
        `Embedding service error for ${url}: ${error.message}`,
        statusCode,
        error
      );
    }

    // Database connection issues
    if (error.message.includes('database') || error.message.includes('connection')) {
      return new DatabaseConnectionError(
        `Database error during similarity search for ${url}`,
        error
      );
    }

    // Rate limiting
    if (error.message.includes('rate') || error.message.includes('429')) {
      return new RateLimitError(
        `Rate limit exceeded during similarity search for ${url}`,
        60000,
        error
      );
    }

    // Generic similarity search error
    return new SimilaritySearchError(
      `Similarity search failed for ${url}: ${error.message}`,
      'embedding',
      false,
      error
    );
  }
}
