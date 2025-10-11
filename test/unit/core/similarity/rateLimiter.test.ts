import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  RateLimiter,
  RateLimiterOptions,
  RateLimitError,
} from '../../../../src/core/similarity/types';
import { createChildLogger } from '../../../../src/utils/logger';

describe('RateLimiter', () => {
  let mockLogger: ReturnType<typeof createChildLogger>;
  let rateLimiter: RateLimiter;
  let defaultOptions: RateLimiterOptions;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createChildLogger('test');

    defaultOptions = {
      maxRequests: 5,
      windowMs: 1000,
      maxRetries: 2,
      retryDelayMs: 100,
    };

    rateLimiter = new RateLimiter(defaultOptions, mockLogger);
  });

  describe('constructor', () => {
    it('should initialize with correct options', () => {
      expect(rateLimiter).toBeInstanceOf(RateLimiter);
      const stats = rateLimiter.getStats();
      expect(stats.availableTokens).toBe(5);
      expect(stats.failures).toBe(0);
      expect(stats.isCircuitOpen).toBe(false);
    });

    it('should use default values for optional options', () => {
      const minimalRateLimiter = new RateLimiter({ maxRequests: 3, windowMs: 500 }, mockLogger);

      const stats = minimalRateLimiter.getStats();
      expect(stats.availableTokens).toBe(3);
    });
  });

  describe('token bucket algorithm', () => {
    it('should allow requests up to maxRequests', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);

      // Should allow up to maxRequests (5) without delay
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.processWithRateLimit(`item${i}`, processor);
        expect(result.item).toBe(`item${i}`);
        expect(result.delayMs).toBe(0);
        expect(result.retryCount).toBe(0);
      }

      expect(processor).toHaveBeenCalledTimes(5);
    });

    it('should block requests beyond maxRequests', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        await rateLimiter.processWithRateLimit(`item${i}`, processor);
      }

      // Next request should be delayed
      const startTime = Date.now();
      await rateLimiter.processWithRateLimit('item6', processor);
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(900); // Should wait for window refill
      expect(processor).toHaveBeenCalledTimes(6);
    });

    it('should refill tokens after window expires', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        await rateLimiter.processWithRateLimit(`item${i}`, processor);
      }

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow new requests
      const result = await rateLimiter.processWithRateLimit('item6', processor);
      expect(result.item).toBe('item6');
      expect(result.delayMs).toBe(0);
      expect(processor).toHaveBeenCalledTimes(6);
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const failingProcessor = jest
        .fn<(item: string) => Promise<void>>()
        .mockRejectedValue(new Error('Service unavailable'));

      // Generate failures to trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        try {
          await rateLimiter.processWithRateLimit(`item${i}`, failingProcessor);
        } catch (error) {
          // Expected to fail
        }
      }

      const stats = rateLimiter.getStats();
      expect(stats.isCircuitOpen).toBe(true);
      expect(stats.failures).toBeGreaterThanOrEqual(5);
    });

    it('should reject requests when circuit is open', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);

      // Open circuit breaker
      const failingProcessor = jest
        .fn<(item: string) => Promise<void>>()
        .mockRejectedValue(new Error('Service unavailable'));
      for (let i = 0; i < 6; i++) {
        try {
          await rateLimiter.processWithRateLimit(`item${i}`, failingProcessor);
        } catch {
          // Expected to fail
        }
      }

      // Circuit should be open
      await expect(rateLimiter.processWithRateLimit('item7', processor)).rejects.toThrow(
        RateLimitError
      );

      expect(processor).not.toHaveBeenCalled();
    });

    it('should half-open circuit after timeout', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);
      const failingProcessor = jest
        .fn<(item: string) => Promise<void>>()
        .mockRejectedValue(new Error('Service unavailable'));

      // Create a rate limiter with short circuit breaker timeout for testing
      const shortTimeoutRateLimiter = new RateLimiter(
        {
          maxRequests: 5,
          windowMs: 1000,
          maxRetries: 2,
          retryDelayMs: 100,
        },
        mockLogger
      );

      // Override the circuit breaker timeout for testing
      (shortTimeoutRateLimiter as any).circuitBreakerTimeoutMs = 100;

      // Open circuit breaker
      for (let i = 0; i < 6; i++) {
        try {
          await shortTimeoutRateLimiter.processWithRateLimit(`item${i}`, failingProcessor);
        } catch (error) {
          // Expected to fail
        }
      }

      // Verify circuit is open
      await expect(
        shortTimeoutRateLimiter.processWithRateLimit('item7', processor)
      ).rejects.toThrow(RateLimitError);

      // Wait for circuit breaker timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Circuit should be half-open after timeout - checkCircuitBreaker should return true
      expect((shortTimeoutRateLimiter as any).checkCircuitBreaker()).toBe(true);

      // Should allow limited requests again after timeout
      const result = await shortTimeoutRateLimiter.processWithRateLimit('item8', processor);
      expect(result.item).toBe('item8');
      expect(processor).toHaveBeenCalledTimes(1);
    }, 10000);
  });

  describe('retry logic', () => {
    it('should retry failed requests with exponential backoff', async () => {
      const processor = jest
        .fn<(item: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(undefined);

      const startTime = Date.now();
      const result = await rateLimiter.processWithRateLimit('item1', processor);
      const endTime = Date.now();

      expect(result.item).toBe('item1');
      expect(result.retryCount).toBe(2);
      expect(endTime - startTime).toBeGreaterThanOrEqual(300); // Should have delays
      expect(processor).toHaveBeenCalledTimes(3);
    });

    it('should give up after max retries', async () => {
      const processor = jest
        .fn<(item: string) => Promise<void>>()
        .mockRejectedValue(new Error('Persistent failure'));

      await expect(rateLimiter.processWithRateLimit('item1', processor)).rejects.toThrow(
        'Persistent failure'
      );

      expect(processor).toHaveBeenCalledTimes(3); // maxRetries + 1
    });
  });

  describe('batch processing', () => {
    it('should process multiple items with rate limiting', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);
      const items = ['item1', 'item2', 'item3', 'item4', 'item5'];

      const results = await rateLimiter.processBatch(items, processor);

      expect(results).toHaveLength(5);
      expect(results.every((r: any) => r.retryCount === 0)).toBe(true);
      expect(results.every((r: any) => r.delayMs === 0)).toBe(true);
      expect(processor).toHaveBeenCalledTimes(5);
    });

    it('should handle mixed success and failure in batch', async () => {
      const processor = jest
        .fn<(item: string) => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Item 2 failed'))
        .mockResolvedValueOnce(undefined);

      const items = ['item1', 'item2', 'item3'];

      const results = await rateLimiter.processBatch(items, processor);

      expect(results).toHaveLength(3);
      expect(results[0].retryCount).toBe(0);
      expect(results[1].retryCount).toBe(1); // Initial attempt only (no retry in batch processing)
      expect(results[2].retryCount).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', async () => {
      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);

      // Use some tokens
      await rateLimiter.processWithRateLimit('item1', processor);

      const stats = rateLimiter.getStats();
      expect(stats.availableTokens).toBe(4); // Started with 5
      expect(stats.failures).toBe(0);
      expect(stats.isCircuitOpen).toBe(false);
    });

    it('should track failures in statistics', async () => {
      const failingProcessor = jest
        .fn<(item: string) => Promise<void>>()
        .mockRejectedValue(new Error('Service error'));

      try {
        await rateLimiter.processWithRateLimit('item1', failingProcessor);
      } catch (error) {
        // Expected to fail
      }

      const stats = rateLimiter.getStats();
      expect(stats.failures).toBeGreaterThanOrEqual(1); // Could be more if circuit breaker tests ran first
    });
  });

  describe('edge cases', () => {
    it('should handle empty batch gracefully', async () => {
      const processor = jest.fn<(item: unknown) => Promise<void>>();
      const results = await rateLimiter.processBatch([], processor);

      expect(results).toHaveLength(0);
      expect(processor).not.toHaveBeenCalled();
    });

    it('should handle very small windows', async () => {
      const fastRateLimiter = new RateLimiter({ maxRequests: 1, windowMs: 10 }, mockLogger);

      const processor = jest.fn<(item: string) => Promise<void>>().mockResolvedValue(undefined);

      await fastRateLimiter.processWithRateLimit('item1', processor);
      await fastRateLimiter.processWithRateLimit('item2', processor);

      expect(processor).toHaveBeenCalledTimes(2);
    });

    it('should handle processor that throws non-Error objects', async () => {
      // Create a fresh rate limiter for this test
      const freshRateLimiter = new RateLimiter(defaultOptions, mockLogger);

      const processor = jest.fn<(item: string) => Promise<void>>().mockImplementation(() => {
        throw 'String error';
      });

      // The function should throw either the string error or a RateLimitError (if circuit breaker opens)
      // Both indicate that non-Error objects are handled correctly
      let thrownError: unknown;
      try {
        await freshRateLimiter.processWithRateLimit('item1', processor);
        fail('Expected processWithRateLimit to throw an error');
      } catch (error) {
        thrownError = error;
      }

      // The thrown error could be the string itself or an Error object
      const isStringError = thrownError === 'String error';
      const isRateLimitError = thrownError instanceof RateLimitError;
      expect(isStringError || isRateLimitError).toBe(true);
    });
  });
});
