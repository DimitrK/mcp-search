import { z } from 'zod';
import envPaths from 'env-paths';
import { join } from 'path';

const EnvironmentSchema = z.object({
  // Required environment variables
  GOOGLE_API_KEY: z.string().min(1, 'Google API key is required'),
  GOOGLE_SEARCH_ENGINE_ID: z.string().min(1, 'Google Search Engine ID is required'),
  EMBEDDING_SERVER_URL: z.string().url('Valid embedding server URL is required'),
  EMBEDDING_SERVER_API_KEY: z.string().min(1, 'Embedding server API key is required'),
  EMBEDDING_MODEL_NAME: z.string().min(1, 'Embedding model name is required'),

  // Optional environment variables with defaults
  DATA_DIR: z.string().optional(),
  SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  EMBEDDING_TOKENS_SIZE: z.coerce.number().int().positive().default(512),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),

  // Embedding-specific configuration
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(32).default(8),

  // Vector DB execution mode
  VECTOR_DB_MODE: z.enum(['inline', 'thread', 'process']).default('inline').optional(),
  VECTOR_DB_RESTART_ON_CRASH: z.union([z.literal('true'), z.literal('false')]).optional(),

  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

let cachedEnvironment: Environment | null = null;

export function getEnvironment(): Environment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  try {
    const env = EnvironmentSchema.parse(process.env);

    // Set DATA_DIR default using env-paths if not provided
    if (!env.DATA_DIR) {
      const paths = envPaths('mcp-search');
      env.DATA_DIR = paths.data;
    }

    cachedEnvironment = env;
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Environment validation failed:\n${issues.join('\n')}`);
    }
    throw error;
  }
}

export function validateEnvironment(): void {
  getEnvironment(); // This will throw if validation fails
}

export function getDataDirectory(): string {
  return getEnvironment().DATA_DIR!;
}

export function getDatabasePath(): string {
  return join(getDataDirectory(), 'db', 'mcp.duckdb');
}

// For testing purposes
export function clearEnvironmentCache(): void {
  cachedEnvironment = null;
}
