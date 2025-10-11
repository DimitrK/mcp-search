import type pino from 'pino';
import { RateLimiterOptions, RateLimitResult, RateLimitError } from './types';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  failures: number;
  lastFailureTime: number;
}

export class RateLimiter {
  private bucket: TokenBucket;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly circuitBreakerThreshold: number = 5;
  private readonly circuitBreakerTimeoutMs: number = 30000; // 30 seconds
  private isCircuitOpen: boolean = false;
  private circuitOpenTime: number = 0;
  private logger: pino.Logger;

  constructor(options: RateLimiterOptions, logger: pino.Logger) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
    this.logger = logger;

    this.bucket = {
      tokens: this.maxRequests,
      lastRefill: Date.now(),
      failures: 0,
      lastFailureTime: 0,
    };
  }

  private refillBucket(): void {
    const now = Date.now();
    const timePassed = now - this.bucket.lastRefill;

    if (timePassed >= this.windowMs) {
      // Reset the bucket if window has passed
      this.bucket.tokens = this.maxRequests;
      this.bucket.lastRefill = now;
    } else {
      // Add tokens proportionally to time passed
      const tokensToAdd = Math.floor((timePassed / this.windowMs) * this.maxRequests);
      this.bucket.tokens = Math.min(this.maxRequests, this.bucket.tokens + tokensToAdd);
      this.bucket.lastRefill = now;
    }
  }

  private checkCircuitBreaker(): boolean {
    const now = Date.now();

    // Check if circuit should be half-open first
    if (this.isCircuitOpen && now - this.circuitOpenTime >= this.circuitBreakerTimeoutMs) {
      this.isCircuitOpen = false;
      this.bucket.failures = 0;
      this.logger.info('Circuit breaker half-open - allowing limited requests');
      return true;
    }

    // Close circuit if too many failures
    if (this.bucket.failures >= this.circuitBreakerThreshold) {
      this.isCircuitOpen = true;
      this.circuitOpenTime = now;
      this.logger.warn(
        {
          failures: this.bucket.failures,
          threshold: this.circuitBreakerThreshold,
          timeoutMs: this.circuitBreakerTimeoutMs,
        },
        'Circuit breaker opened due to excessive failures'
      );
      return false;
    }

    return !this.isCircuitOpen;
  }

  private recordFailure(): void {
    this.bucket.failures++;
    this.bucket.lastFailureTime = Date.now();
  }

  private recordSuccess(): void {
    if (this.bucket.failures > 0) {
      this.bucket.failures = Math.max(0, this.bucket.failures - 1);
    }
  }

  async processWithRateLimit<T>(
    item: T,
    processor: (item: T) => Promise<void>
  ): Promise<RateLimitResult<T>> {
    if (!this.checkCircuitBreaker()) {
      throw new RateLimitError(
        'Circuit breaker is open - too many failures',
        this.circuitBreakerTimeoutMs - (Date.now() - this.circuitOpenTime)
      );
    }

    this.refillBucket();

    let retryCount = 0;
    let delayMs = 0;

    while (retryCount <= this.maxRetries) {
      if (this.bucket.tokens > 0) {
        this.bucket.tokens--;

        try {
          await processor(item);
          this.recordSuccess();
          return { item, delayMs, retryCount };
        } catch (error) {
          this.recordFailure();

          if (retryCount < this.maxRetries) {
            retryCount++;
            delayMs += this.retryDelayMs * Math.pow(2, retryCount - 1); // Exponential backoff
            this.logger.debug(
              { error, item, retryCount, delayMs },
              'Request failed, retrying with backoff'
            );
            await this.delay(delayMs);
          } else {
            this.logger.warn(
              { error, item, totalRetries: retryCount },
              'Request failed after all retries'
            );
            throw error;
          }
        }
      } else {
        // No tokens available, wait for refill
        const waitTime = Math.max(100, this.windowMs - (Date.now() - this.bucket.lastRefill));
        delayMs += waitTime;
        await this.delay(waitTime);
        this.refillBucket();
      }
    }

    throw new RateLimitError(`Max retries exceeded for item`, this.retryDelayMs * this.maxRetries);
  }

  async processBatch<T>(
    items: T[],
    processor: (item: T) => Promise<void>
  ): Promise<RateLimitResult<T>[]> {
    const results: RateLimitResult<T>[] = [];

    for (const item of items) {
      try {
        const result = await this.processWithRateLimit(item, processor);
        results.push(result);
      } catch (error) {
        this.logger.warn({ error, item }, 'Failed to process item with rate limiting');
        results.push({ item, delayMs: 0, retryCount: this.maxRetries + 1 });
      }
    }

    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats(): {
    availableTokens: number;
    failures: number;
    isCircuitOpen: boolean;
    circuitOpenTime: number;
  } {
    return {
      availableTokens: this.bucket.tokens,
      failures: this.bucket.failures,
      isCircuitOpen: this.isCircuitOpen,
      circuitOpenTime: this.circuitOpenTime,
    };
  }
}
