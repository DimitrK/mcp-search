import { describe, expect, test } from '@jest/globals';
import { createSearchProviderFromEnvironment } from '../../../../src/core/search/searchProviderFactory';
import { GoogleClient } from '../../../../src/core/search/googleClient';
import { BraveSearchProvider } from '../../../../src/core/search/providers/braveSearchProvider';
import { DuckDuckGoSearchProvider } from '../../../../src/core/search/providers/duckDuckGoSearchProvider';
import { TavilySearchProvider } from '../../../../src/core/search/providers/tavilySearchProvider';
import type { Environment } from '../../../../src/config/environment';

const baseEnv: Environment = {
  SEARCH_PROVIDER: 'google',
  SEARCH_ENGINE_API_KEY: 'google-key',
  GOOGLE_SEARCH_ENGINE_ID: 'engine-id',
  EMBEDDING_SERVER_URL: 'http://embedding.test',
  EMBEDDING_SERVER_API_KEY: 'embedding-key',
  EMBEDDING_MODEL_NAME: 'embedding-model',
  DATA_DIR: '/tmp/mcp-search-test',
  SIMILARITY_THRESHOLD: 0.6,
  EMBEDDING_TOKENS_SIZE: 512,
  REQUEST_TIMEOUT_MS: 20000,
  CONCURRENCY: 2,
  EMBEDDING_BATCH_SIZE: 8,
  ENABLE_SIMILARITY_SEARCH: 'true',
  VECTOR_DB_MODE: 'inline',
  VECTOR_DB_RESTART_ON_CRASH: undefined,
  NODE_ENV: 'test',
};

describe('createSearchProviderFromEnvironment', () => {
  test('creates Google provider by default', () => {
    const provider = createSearchProviderFromEnvironment(baseEnv);
    expect(provider).toBeInstanceOf(GoogleClient);
    expect(provider.name).toBe('google');
  });

  test('creates Brave provider', () => {
    const provider = createSearchProviderFromEnvironment({
      ...baseEnv,
      SEARCH_PROVIDER: 'brave',
      SEARCH_ENGINE_API_KEY: 'brave-key',
    });
    expect(provider).toBeInstanceOf(BraveSearchProvider);
    expect(provider.name).toBe('brave');
  });

  test('creates DuckDuckGo provider', () => {
    const provider = createSearchProviderFromEnvironment({
      ...baseEnv,
      SEARCH_PROVIDER: 'duckduckgo',
      SEARCH_ENGINE_API_KEY: undefined,
      GOOGLE_SEARCH_ENGINE_ID: undefined,
    });
    expect(provider).toBeInstanceOf(DuckDuckGoSearchProvider);
    expect(provider.name).toBe('duckduckgo');
  });

  test('creates Tavily provider', () => {
    const provider = createSearchProviderFromEnvironment({
      ...baseEnv,
      SEARCH_PROVIDER: 'tavily',
      SEARCH_ENGINE_API_KEY: 'tavily-key',
      GOOGLE_SEARCH_ENGINE_ID: undefined,
    });
    expect(provider).toBeInstanceOf(TavilySearchProvider);
    expect(provider.name).toBe('tavily');
  });

  test('throws for unsupported provider if configuration is bypassed', () => {
    expect(() =>
      createSearchProviderFromEnvironment({
        ...baseEnv,
        SEARCH_PROVIDER: 'unknown' as Environment['SEARCH_PROVIDER'],
      })
    ).toThrow('Unsupported search provider');
  });
});
