export interface ConsolidatedChunk {
  id: string;
  text: string;
  score: number;
  section_path?: string;
}

export interface SimilaritySearchOptions {
  correlationId?: string;
  rateLimiting?: {
    enabled?: boolean;
    maxRequests?: number;
    windowMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  };
}

export interface SimilaritySearchResult<T> {
  item: T;
  chunks: ConsolidatedChunk[];
  error?: Error;
}

// Enhanced error types for granular error handling
export class SimilaritySearchError extends Error {
  constructor(
    message: string,
    public type: 'network' | 'embedding' | 'database' | 'rate_limit' | 'validation',
    public retryable: boolean = false,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'SimilaritySearchError';
  }
}

export class NetworkTimeoutError extends SimilaritySearchError {
  constructor(
    message: string,
    public timeoutMs: number,
    originalError?: Error
  ) {
    super(message, 'network', true, originalError);
    this.name = 'NetworkTimeoutError';
  }
}

export class EmbeddingServiceError extends SimilaritySearchError {
  constructor(
    message: string,
    public statusCode?: number,
    originalError?: Error
  ) {
    super(message, 'embedding', statusCode === 429, originalError);
    this.name = 'EmbeddingServiceError';
  }
}

export class DatabaseConnectionError extends SimilaritySearchError {
  constructor(message: string, originalError?: Error) {
    super(message, 'database', true, originalError);
    this.name = 'DatabaseConnectionError';
  }
}

export class RateLimitError extends SimilaritySearchError {
  constructor(
    message: string,
    public retryAfterMs?: number,
    originalError?: Error
  ) {
    super(message, 'rate_limit', true, originalError);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends SimilaritySearchError {
  constructor(
    message: string,
    public field?: string,
    originalError?: Error
  ) {
    super(message, 'validation', false, originalError);
    this.name = 'ValidationError';
  }
}
// Rate limiting types
export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface RateLimitResult<T> {
  item: T;
  delayMs: number;
  retryCount: number;
}

// Re-export RateLimiter for convenience
export { RateLimiter } from './rateLimiter';
