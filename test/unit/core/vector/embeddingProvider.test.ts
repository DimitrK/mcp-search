import { describe, it, expect, jest } from '@jest/globals';
import {
  createEmbeddingProvider,
  EmbeddingProviderConfig,
} from '../../../../src/core/vector/embeddingProvider';
import { EmbeddingError } from '../../../../src/mcp/errors';

// Mock the HTTP provider module
jest.mock('../../../../src/core/vector/providers/httpEmbeddingProvider', () => ({
  HttpEmbeddingProvider: jest.fn().mockImplementation((config: any) => ({
    embed: jest.fn(),
    getDimension: jest.fn(() => 1536), // Auto-detected dimension
    getModelName: jest.fn(() => config.modelName || 'test-model'),
    close: jest.fn(),
  })),
}));

describe('createEmbeddingProvider', () => {
  describe('HTTP provider creation', () => {
    it('should create HTTP embedding provider with valid config', async () => {
      const config: EmbeddingProviderConfig = {
        type: 'http',
        serverUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        modelName: 'text-embedding-3-small',
      };

      const provider = await createEmbeddingProvider(config);

      expect(provider).toBeDefined();
      expect(provider.getDimension()).toBe(1536);
      expect(provider.getModelName()).toBe('text-embedding-3-small');
      expect(typeof provider.embed).toBe('function');
    });

    it('should create HTTP provider with default dimension', async () => {
      const config: EmbeddingProviderConfig = {
        type: 'http',
        serverUrl: 'https://api.example.com',
        apiKey: 'test-api-key',
        modelName: 'text-embedding-3-small',
        // dimension not specified
      };

      const provider = await createEmbeddingProvider(config);
      expect(provider.getDimension()).toBe(1536); // Default
    });

    it('should pass through all config options to HTTP provider', async () => {
      const { HttpEmbeddingProvider } = await import(
        '../../../../src/core/vector/providers/httpEmbeddingProvider'
      );

      const config: EmbeddingProviderConfig = {
        type: 'http',
        serverUrl: 'https://custom.api.com',
        apiKey: 'custom-key',
        modelName: 'custom-model',
        batchSize: 16,
        // timeoutMs will use default
      };

      await createEmbeddingProvider(config);

      expect(HttpEmbeddingProvider).toHaveBeenCalledWith(config);
    });
  });

  describe('Provider type validation', () => {
    it('should throw error for unknown provider type', async () => {
      const config = {
        type: 'unknown',
        serverUrl: 'https://api.example.com',
        apiKey: 'test-key',
      } as any;

      await expect(createEmbeddingProvider(config)).rejects.toThrow(
        'Unknown embedding provider type: unknown'
      );
    });

    it('should throw error for local provider (not implemented)', async () => {
      const config: EmbeddingProviderConfig = {
        type: 'local',
        modelName: 'local-model',
      };

      await expect(createEmbeddingProvider(config)).rejects.toThrow(
        'Local embedding provider not yet implemented'
      );
    });
  });

  describe('Configuration validation', () => {
    it('should handle provider-specific validation errors', async () => {
      // Mock the HTTP provider to throw a configuration error
      const { HttpEmbeddingProvider } = await import(
        '../../../../src/core/vector/providers/httpEmbeddingProvider'
      );
      (HttpEmbeddingProvider as jest.Mock).mockImplementationOnce(() => {
        throw new EmbeddingError('serverUrl is required for HTTP embedding provider');
      });

      const config: EmbeddingProviderConfig = {
        type: 'http',
        // Missing required fields
      } as any;

      await expect(createEmbeddingProvider(config)).rejects.toThrow(
        'serverUrl is required for HTTP embedding provider'
      );
    });
  });
});
