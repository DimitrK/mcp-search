import pino from 'pino';
import { getEnvironment } from '../config/environment';

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

  return pino({
    name: 'mcp-search',
    level: isDevelopment ? 'debug' : 'info',
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
            destination: 2, // Use stderr
          },
        }
      : undefined,
    redact: {
      paths: SENSITIVE_KEYS,
      censor: '[REDACTED]',
    },
    formatters: {
      log: createRedactor(),
    },
  });
}

export const logger = createLogger();

// Helper function to create child loggers with correlation IDs
export function createChildLogger(correlationId: string): pino.Logger {
  return logger.child({ correlationId });
}

// Helper function to generate correlation IDs
export function generateCorrelationId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
