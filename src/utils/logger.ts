import pino from 'pino';
import { getEnvironment } from '../config/environment';
import { getTransport } from './getTransport';

// Sensitive keys to redact from logs
const SENSITIVE_KEYS = [
  'GOOGLE_API_KEY',
  'EMBEDDING_SERVER_API_KEY',
  'password',
  'token',
  'secret',
  'key',
  'api_key',
  'apikey',
  'authorization',
];

function createRedactor(): (obj: Record<string, unknown>) => Record<string, unknown> {
  return (obj: Record<string, unknown>) => {
    const redacted = { ...obj };

    Object.keys(redacted).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some(sensitive => lowerKey.includes(sensitive))) {
        redacted[key] = '[REDACTED]';
      }
    });

    return redacted;
  };
}

function createLogger(): pino.Logger {
  const env = getEnvironment();
  const isDevelopment = env.NODE_ENV === 'development';

  return (pino as unknown as (opts: unknown) => pino.Logger)({
    name: 'mcp-search',
    level: isDevelopment ? 'debug' : 'info',
    transport: getTransport(),
    redact: {
      paths: SENSITIVE_KEYS,
      censor: '[REDACTED]',
    },
    formatters: {
      log: createRedactor(),
    },
  });
}

let cachedLogger: pino.Logger | null = null;
export function getLogger(): pino.Logger {
  if (!cachedLogger) cachedLogger = createLogger();
  return cachedLogger;
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get: (_target, prop: string | symbol) => {
    const real = getLogger();

    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(real);
    }
    return value as unknown;
  },
});

// Helper function to create child loggers with correlation IDs
export function createChildLogger(correlationId: string): pino.Logger {
  return getLogger().child({ correlationId });
}

// Helper function to generate correlation IDs
export function generateCorrelationId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

export async function withTiming<T>(
  log: pino.Logger,
  event: string,
  fn: () => Promise<T>,
  fields?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log.info({ event, durationMs: Date.now() - start, status: 'ok', ...(fields ?? {}) });
    return result;
  } catch (error) {
    log.error({ event, durationMs: Date.now() - start, error, ...(fields ?? {}) }, 'failed');
    throw error as Error;
  }
}
