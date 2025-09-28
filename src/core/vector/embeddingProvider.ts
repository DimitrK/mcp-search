/**
 * Abstract base class for embedding providers
 */
export abstract class EmbeddingProvider {
  /**
   * Generate embeddings for an array of texts
   * @param texts Array of text strings to embed
   * @returns Promise resolving to array of embedding vectors (numbers[][])
   */
  abstract embed(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension of embeddings produced by this provider
   */
  abstract getDimension(): number;

  /**
   * Get the model name/identifier used by this provider
   */
  abstract getModelName(): string;

  /**
   * Optional cleanup method for providers that need resource cleanup
   * Default implementation does nothing
   */
  async close(): Promise<void> {
    // Default implementation - no cleanup needed
  }
}

/**
 * Configuration for embedding providers
 */
export interface EmbeddingProviderConfig {
  type: 'http' | 'local';
  serverUrl?: string;
  apiKey?: string;
  modelName?: string;
  batchSize?: number;
  timeoutMs?: number;
}

/**
 * Factory function to create embedding providers
 * @param config Provider configuration
 * @returns Promise resolving to configured embedding provider instance
 */
export async function createEmbeddingProvider(
  config: EmbeddingProviderConfig
): Promise<EmbeddingProvider> {
  switch (config.type) {
    case 'http': {
      const { HttpEmbeddingProvider } = await import('./providers/httpEmbeddingProvider');
      return new HttpEmbeddingProvider(config);
    }

    case 'local':
      throw new Error('Local embedding provider not yet implemented');

    default:
      throw new Error(`Unknown embedding provider type: ${config.type}`);
  }
}
