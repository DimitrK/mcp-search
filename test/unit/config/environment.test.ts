import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  getEnvironment,
  validateEnvironment,
  getDataDirectory,
  getDatabasePath,
  clearEnvironmentCache,
} from '../../../src/config/environment';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    clearEnvironmentCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('should validate required environment variables', () => {
    expect(() => validateEnvironment()).not.toThrow();
  });

  test('should use default values for optional variables', () => {
    const env = getEnvironment();

    expect(env.SIMILARITY_THRESHOLD).toBe(0.72);
    expect(env.EMBEDDING_TOKENS_SIZE).toBe(512);
    expect(env.REQUEST_TIMEOUT_MS).toBe(20000);
    expect(env.CONCURRENCY).toBe(2);
  });

  test('should throw error for missing required variables', () => {
    delete process.env.GOOGLE_API_KEY;

    expect(() => getEnvironment()).toThrow('Environment validation failed');
  });

  test('should provide data directory path', () => {
    const dataDir = getDataDirectory();
    expect(dataDir).toBeTruthy();
    expect(typeof dataDir).toBe('string');
  });

  test('should provide database path', () => {
    const dbPath = getDatabasePath();
    expect(dbPath).toBeTruthy();
    expect(dbPath).toContain('mcp.duckdb');
  });

  test('should parse custom similarity threshold', () => {
    process.env.SIMILARITY_THRESHOLD = '0.85';
    const env = getEnvironment();
    expect(env.SIMILARITY_THRESHOLD).toBe(0.85);
  });

  test('should validate similarity threshold range', () => {
    process.env.SIMILARITY_THRESHOLD = '1.5';
    expect(() => getEnvironment()).toThrow();
  });
});
