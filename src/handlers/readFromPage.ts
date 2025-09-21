import type pino from 'pino';
import { ReadFromPageInput, ReadFromPageOutputType } from '../mcp/schemas';

export async function handleReadFromPage(
  args: unknown,
  logger: pino.Logger
): Promise<{ content: ReadFromPageOutputType }> {
  const input = ReadFromPageInput.parse(args);
  logger.debug({ input: { ...input, query: '[REDACTED]' } }, 'Processing read from page request');

  // TODO: Implement in Milestone 6
  throw new Error('web.readFromPage not yet implemented');
}
