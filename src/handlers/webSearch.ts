import type pino from 'pino';
import { SearchInput, SearchOutputType } from '../mcp/schemas';

export async function handleWebSearch(
  args: unknown,
  logger: pino.Logger
): Promise<{ content: SearchOutputType }> {
  const input = SearchInput.parse(args);
  logger.debug({ input }, 'Processing web search request');

  // TODO: Implement in Milestone 2
  throw new Error('web.search not yet implemented');
}
