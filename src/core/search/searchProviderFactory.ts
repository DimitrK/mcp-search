import type pino from 'pino';
import type { Environment } from '../../config/environment';
import { GoogleClient } from './googleClient';
import { BraveSearchProvider } from './providers/braveSearchProvider';
import { DuckDuckGoSearchProvider } from './providers/duckDuckGoSearchProvider';
import { TavilySearchProvider } from './providers/tavilySearchProvider';
import type { SearchProvider } from './searchProvider';

export function createSearchProviderFromEnvironment(
  env: Environment,
  logger?: pino.Logger
): SearchProvider {
  switch (env.SEARCH_PROVIDER) {
    case 'google':
      return new GoogleClient(
        env.SEARCH_ENGINE_API_KEY!,
        env.GOOGLE_SEARCH_ENGINE_ID!,
        logger,
        env.CONCURRENCY
      );
    case 'brave':
      return new BraveSearchProvider(env.SEARCH_ENGINE_API_KEY!, env.CONCURRENCY, logger);

    case 'duckduckgo':
      return new DuckDuckGoSearchProvider(env.CONCURRENCY, logger);

    case 'tavily':
      return new TavilySearchProvider(env.SEARCH_ENGINE_API_KEY!, env.CONCURRENCY, logger);

    default:
      throw new Error(`Unsupported search provider: ${env.SEARCH_PROVIDER satisfies never}`);
  }
}
