import type pino from 'pino';
import { DebugEchoInput, DebugEchoOutputType } from '../mcp/schemas';
import { APP_NAME, APP_VERSION } from '../config/constants';

export async function handleDebugEcho(
  args: unknown,
  logger: pino.Logger
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const input = DebugEchoInput.parse(args);
  logger.debug({ input }, 'Processing debug echo request');

  const output: DebugEchoOutputType = {
    echo: input.message,
    timestamp: new Date().toISOString(),
    metadata: {
      ...input.metadata,
      server: APP_NAME,
      version: APP_VERSION,
      correlationId: logger.bindings().correlationId,
    },
  };

  logger.info('Debug echo completed successfully');
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2),
      },
    ],
  };
}
