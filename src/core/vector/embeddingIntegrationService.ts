import { EmbeddingProvider } from './embeddingProvider';
import { ensureEmbeddingConfig, upsertChunks, similaritySearch } from './store';
import type { ContentChunk } from '../content/chunker';
import type { ChunkRow, SimilarChunkRow } from './store/chunks';
import { createChildLogger, withTiming, generateCorrelationId } from '../../utils/logger';
import { EmbeddingError } from '../../mcp/errors';

/**
 * Integration service that connects the embedding provider with vector storage.
 * Handles the end-to-end flow of generating embeddings and storing them in DuckDB VSS.
 */
export class EmbeddingIntegrationService {
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly log = createChildLogger('embedding-integration');

  constructor(embeddingProvider: EmbeddingProvider) {
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Generate embeddings for content chunks and store them in the vector database.
   * This method handles the complete pipeline from text to stored embeddings.
   */
  async storeWithEmbeddings(
    url: string,
    chunks: ContentChunk[],
    opts?: { correlationId?: string }
  ): Promise<void> {
    if (chunks.length === 0) {
      this.log.debug({ url }, 'No chunks to process, skipping embedding generation');
      return;
    }

    const correlationId = opts?.correlationId || generateCorrelationId();
    const log = createChildLogger(correlationId);

    await withTiming(log, 'embedding-integration.storeWithEmbeddings', async () => {
      log.info(
        {
          url,
          chunkCount: chunks.length,
          totalTokens: chunks.reduce((sum, chunk) => sum + chunk.tokens, 0),
        },
        'Starting embedding generation and storage'
      );

      // Step 1: Generate embeddings for all chunk texts
      const chunkTexts = chunks.map(chunk => chunk.text);
      let embeddings: number[][];

      try {
        embeddings = await withTiming(
          log,
          'embedding-integration.embed',
          () => this.embeddingProvider.embed(chunkTexts),
          {
            chunkCount: chunkTexts.length,
            provider: this.embeddingProvider.getModelName(),
          }
        );
      } catch (error) {
        log.error(
          { error: (error as Error).message, url, chunkCount: chunks.length },
          'Failed to generate embeddings'
        );
        throw error;
      }

      // Step 2: Ensure embedding configuration is consistent in database
      const modelName = this.embeddingProvider.getModelName();
      const dimension = embeddings[0]?.length || this.embeddingProvider.getDimension();

      try {
        await ensureEmbeddingConfig(modelName, dimension, { correlationId });
        log.debug({ modelName, dimension }, 'Embedding configuration validated in database');
      } catch (error) {
        log.error(
          { error: (error as Error).message, modelName, dimension },
          'Failed to validate embedding configuration'
        );
        throw error;
      }

      // Step 3: Transform chunks to storage format with embeddings
      const chunkRows: ChunkRow[] = chunks.map((chunk, index) => ({
        id: chunk.id,
        url,
        section_path: chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : undefined,
        text: chunk.text,
        tokens: chunk.tokens,
        embedding: embeddings[index],
      }));

      // Step 4: Store chunks with embeddings in database
      try {
        await upsertChunks(chunkRows, { correlationId });
        log.info(
          {
            url,
            storedChunks: chunkRows.length,
            dimension,
            modelName,
          },
          'Successfully stored chunks with embeddings'
        );
      } catch (error) {
        log.error(
          { error: (error as Error).message, url, chunkCount: chunkRows.length },
          'Failed to store chunks in database'
        );
        throw error;
      }
    });
  }

  /**
   * Search for similar chunks using semantic similarity.
   * Generates an embedding for the query text and finds the most similar stored chunks.
   */
  async searchSimilar(
    url: string,
    queryText: string,
    limit: number,
    opts?: { correlationId?: string }
  ): Promise<SimilarChunkRow[]> {
    const correlationId = opts?.correlationId || generateCorrelationId();
    const log = createChildLogger(correlationId);

    return await withTiming(log, 'embedding-integration.searchSimilar', async () => {
      log.debug({ url, queryLength: queryText.length, limit }, 'Starting similarity search');

      // Step 1: Generate embedding for query text
      let queryEmbedding: number[];
      try {
        const queryEmbeddings = await this.embeddingProvider.embed([queryText]);
        queryEmbedding = queryEmbeddings[0];

        log.debug(
          {
            dimension: queryEmbedding.length,
            model: this.embeddingProvider.getModelName(),
          },
          'Generated query embedding'
        );
      } catch (error) {
        log.error(
          { error: (error as Error).message, queryText },
          'Failed to generate query embedding'
        );
        throw error;
      }

      // Step 2: Perform similarity search in vector database
      try {
        const results = await similaritySearch(url, queryEmbedding, limit, queryEmbedding.length);

        log.info(
          {
            url,
            resultsCount: results.length,
            limit,
            averageScore:
              results.length > 0
                ? results.reduce((sum, r) => sum + r.score, 0) / results.length
                : 0,
          },
          'Similarity search completed'
        );

        return results;
      } catch (error) {
        log.error(
          { error: (error as Error).message, url, limit },
          'Failed to perform similarity search'
        );
        throw error;
      }
    });
  }

  /**
   * Close the embedding provider and clean up resources.
   */
  async close(): Promise<void> {
    try {
      await this.embeddingProvider.close();
      this.log.debug({}, 'Embedding integration service closed');
    } catch (error) {
      this.log.warn(
        { error: (error as Error).message },
        'Error closing embedding provider - continuing anyway'
      );
      // Don't throw - cleanup failures shouldn't crash the application
    }
  }
}
