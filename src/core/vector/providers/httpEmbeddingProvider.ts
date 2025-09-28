import { EmbeddingProvider, EmbeddingProviderConfig } from '../embeddingProvider';
import { EmbeddingError } from '../../../mcp/errors';
import { withTiming, createChildLogger, generateCorrelationId } from '../../../utils/logger';
import { request } from 'undici';

interface EmbeddingRequest {
  model: string;
  input: string[];
}

interface EmbeddingResponseData {
  embedding: number[];
  index: number;
}

interface EmbeddingResponse {
  data: EmbeddingResponseData[];
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * HTTP-based embedding provider supporting OpenAI-compatible APIs
 */
export class HttpEmbeddingProvider extends EmbeddingProvider {
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly modelName: string;
  private dimension: number | null = null; // Auto-detected on first request
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(config: EmbeddingProviderConfig) {
    super();

    if (!config.serverUrl) {
      throw new EmbeddingError('serverUrl is required for HTTP embedding provider');
    }
    if (!config.apiKey) {
      throw new EmbeddingError('apiKey is required for HTTP embedding provider');
    }
    if (!config.modelName) {
      throw new EmbeddingError('modelName is required for HTTP embedding provider');
    }

    this.serverUrl = config.serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.modelName = config.modelName;
    // dimension will be auto-detected on first request
    this.batchSize = config.batchSize || 8; // Conservative default
    this.timeoutMs = config.timeoutMs || 30000; // 30 second default - sensible for embeddings
  }

  getDimension(): number {
    if (this.dimension === null) {
      throw new EmbeddingError(
        'Dimension not yet determined - call embed() first to auto-detect',
        'http'
      );
    }
    return this.dimension;
  }

  getModelName(): string {
    return this.modelName;
  }

  /**
   * Generate embeddings for an array of texts using batching
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const correlationId = generateCorrelationId();
    const log = createChildLogger(correlationId);

    // Split texts into batches
    const batches = this.createBatches(texts);

    log.debug(
      {
        totalTexts: texts.length,
        batchCount: batches.length,
        batchSize: this.batchSize,
        provider: 'http',
        model: this.modelName,
      },
      'Starting batch embedding processing'
    );

    const results: number[][] = [];

    // Process batches sequentially (no concurrency for now as per requirement)
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      const batchResult = await withTiming(log, 'embedding.batch', () => this.embedBatch(batch), {
        batchIndex: i + 1,
        batchSize: batch.length,
        totalBatches: batches.length,
      });

      results.push(...batchResult);
    }

    log.debug(
      {
        totalTexts: texts.length,
        totalEmbeddings: results.length,
        textsPerSecond: Math.round(
          (texts.length / (Date.now() - parseInt(correlationId.split('-')[1]))) * 1000
        ),
      },
      'Batch embedding processing completed'
    );

    return results;
  }

  /**
   * Create batches from input texts
   */
  private createBatches(texts: string[]): string[][] {
    const batches: string[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize));
    }

    return batches;
  }

  /**
   * Process a single batch of texts
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const requestBody: EmbeddingRequest = {
      model: this.modelName,
      input: texts,
    };

    const response = await this.makeRequest(requestBody);
    return this.processResponse(response, texts.length);
  }

  /**
   * Make HTTP request to embedding API with retry logic
   */
  private async makeRequest(body: EmbeddingRequest, isRetry = false): Promise<EmbeddingResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await request(`${this.serverUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const errorText = await response.body.text();
        let errorMessage = `HTTP ${response.statusCode}`;

        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // Use status code if JSON parsing fails
          errorMessage = `HTTP ${response.statusCode}`;
        }

        // Retry logic for 5xx errors (but not 429 rate limits)
        if (response.statusCode >= 500 && response.statusCode < 600 && !isRetry) {
          // Add jitter delay for retry
          const jitterMs = Math.random() * 1000 + 500; // 500-1500ms
          await new Promise(resolve => setTimeout(resolve, jitterMs));
          return this.makeRequest(body, true);
        }

        throw new EmbeddingError(errorMessage, 'http');
      }

      const responseData = (await response.body.json()) as EmbeddingResponse;
      return responseData;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof EmbeddingError) {
        throw error;
      }

      // Handle network errors, timeouts, etc.
      const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
      throw new EmbeddingError(`Request failed: ${errorMessage}`, 'http');
    }
  }

  /**
   * Process and validate API response
   */
  private processResponse(response: EmbeddingResponse, expectedCount: number): number[][] {
    if (!response.data || !Array.isArray(response.data)) {
      throw new EmbeddingError('Invalid response format: missing data array', 'http');
    }

    if (response.data.length !== expectedCount) {
      throw new EmbeddingError(
        `Response count mismatch: expected ${expectedCount}, got ${response.data.length}`,
        'http'
      );
    }

    // Sort by index to ensure correct order
    const sortedData = response.data.sort((a, b) => a.index - b.index);

    const embeddings: number[][] = [];

    for (const item of sortedData) {
      if (!Array.isArray(item.embedding)) {
        throw new EmbeddingError('Invalid embedding format: expected number array', 'http');
      }

      // Auto-detect dimension from first embedding
      if (this.dimension === null) {
        this.dimension = item.embedding.length;
      } else if (item.embedding.length !== this.dimension) {
        throw new EmbeddingError(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${item.embedding.length}`,
          'http'
        );
      }

      embeddings.push(item.embedding);
    }

    return embeddings;
  }
}
