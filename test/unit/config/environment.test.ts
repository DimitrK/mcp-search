import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  getEnvironment,
  validateEnvironment,
  getDataDirectory,
  getDatabasePath,
  clearEnvironmentCache,
  isRunningInDocker,
  fixDockerUrl,
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

    expect(env.SIMILARITY_THRESHOLD).toBe(0.6);
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
    // Database path should include model name: mcp-{model-name}.duckdb
    expect(dbPath).toMatch(/mcp-[a-z0-9-]+\.duckdb$/);
    // For the test model name 'text-embedding-ada-002', should be sanitized to 'text-embedding-ada-002'
    expect(dbPath).toContain('mcp-text-embedding-ada-002.duckdb');
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

  describe('Docker Detection', () => {
    const originalFs = require('fs');
    const originalProcessEnv = process.env;

    beforeEach(() => {
      // Reset environment and mocks
      process.env = { ...originalProcessEnv };
      clearEnvironmentCache();
      jest.clearAllMocks();
    });

    afterEach(() => {
      process.env = originalProcessEnv;
      jest.restoreAllMocks();
    });

    describe('isRunningInDocker', () => {
      test('should return false when not running in Docker', () => {
        // Mock fs.accessSync to throw for .dockerenv
        jest.spyOn(originalFs, 'accessSync').mockImplementation(path => {
          if (path === '/.dockerenv') {
            throw new Error('File not found');
          }
          return undefined;
        });

        // Mock fs.readFileSync to not contain docker
        jest.spyOn(originalFs, 'readFileSync').mockImplementation(path => {
          if (path === '/proc/1/cgroup') {
            return '/user.slice/user-1000.slice/session-1.scope';
          }
          return '';
        });

        expect(isRunningInDocker()).toBe(false);
      });

      test('should return true when .dockerenv file exists', () => {
        // Mock fs.accessSync to succeed for .dockerenv
        jest.spyOn(originalFs, 'accessSync').mockImplementation(path => {
          if (path === '/.dockerenv') {
            return undefined; // File exists
          }
          throw new Error('File not found');
        });

        expect(isRunningInDocker()).toBe(true);
      });

      test('should return true when DOCKER_CONTAINER env var is set', () => {
        process.env.DOCKER_CONTAINER = 'my-container';

        // Mock fs.accessSync to fail for .dockerenv
        jest.spyOn(originalFs, 'accessSync').mockImplementation(path => {
          if (path === '/.dockerenv') {
            throw new Error('File not found');
          }
          return undefined;
        });

        expect(isRunningInDocker()).toBe(true);
      });

      test('should return true when cgroup contains docker', () => {
        // Mock fs.accessSync to fail for .dockerenv
        jest.spyOn(originalFs, 'accessSync').mockImplementation(path => {
          if (path === '/.dockerenv') {
            throw new Error('File not found');
          }
          return undefined;
        });

        // Mock fs.readFileSync to contain docker
        jest.spyOn(originalFs, 'readFileSync').mockImplementation(path => {
          if (path === '/proc/1/cgroup') {
            return '1:name=systemd:/docker/abc123';
          }
          return '';
        });

        expect(isRunningInDocker()).toBe(true);
      });

      test('should return true when cgroup contains containerd', () => {
        // Mock fs.accessSync to fail for .dockerenv
        jest.spyOn(originalFs, 'accessSync').mockImplementation(path => {
          if (path === '/.dockerenv') {
            throw new Error('File not found');
          }
          return undefined;
        });

        // Mock fs.readFileSync to contain containerd
        jest.spyOn(originalFs, 'readFileSync').mockImplementation(path => {
          if (path === '/proc/1/cgroup') {
            return '1:name=systemd:/containerd/xyz789';
          }
          return '';
        });

        expect(isRunningInDocker()).toBe(true);
      });

      test('should prioritize .dockerenv over other checks', () => {
        process.env.DOCKER_CONTAINER = 'my-container';

        // Mock fs.accessSync to succeed for .dockerenv
        jest.spyOn(originalFs, 'accessSync').mockImplementation(path => {
          if (path === '/.dockerenv') {
            return undefined; // File exists
          }
          return undefined;
        });

        expect(isRunningInDocker()).toBe(true);
      });
    });

    describe('fixDockerUrl', () => {
      test('should replace localhost with host.docker.internal', () => {
        expect(fixDockerUrl('http://localhost:3000')).toBe('http://host.docker.internal:3000');
        expect(fixDockerUrl('https://localhost/api')).toBe('https://host.docker.internal/api');
        expect(fixDockerUrl('localhost:8080')).toBe('host.docker.internal:8080');
      });

      test('should replace 127.0.0.1 with host.docker.internal', () => {
        expect(fixDockerUrl('http://127.0.0.1:3000')).toBe('http://host.docker.internal:3000');
        expect(fixDockerUrl('https://127.0.0.1/api')).toBe('https://host.docker.internal/api');
        expect(fixDockerUrl('127.0.0.1:8080')).toBe('host.docker.internal:8080');
      });

      test('should handle multiple occurrences', () => {
        expect(
          fixDockerUrl('http://localhost:3000/api?redirect=http://localhost:8080/callback')
        ).toBe(
          'http://host.docker.internal:3000/api?redirect=http://host.docker.internal:8080/callback'
        );
      });

      test('should preserve other URL components', () => {
        expect(fixDockerUrl('http://localhost:3000/api/v1/search?query=test&page=1')).toBe(
          'http://host.docker.internal:3000/api/v1/search?query=test&page=1'
        );

        expect(fixDockerUrl('https://127.0.0.1:8080/auth?token=abc123&user=john')).toBe(
          'https://host.docker.internal:8080/auth?token=abc123&user=john'
        );
      });

      test('should not modify URLs without localhost or 127.0.0.1', () => {
        expect(fixDockerUrl('http://example.com:3000')).toBe('http://example.com:3000');
        expect(fixDockerUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
        expect(fixDockerUrl('http://192.168.1.100:3000')).toBe('http://192.168.1.100:3000');
      });

      test('should handle mixed case and variations', () => {
        expect(fixDockerUrl('HTTP://LOCALHOST:3000')).toBe('HTTP://host.docker.internal:3000');
        expect(fixDockerUrl('http://127.0.0.1:3000')).toBe('http://host.docker.internal:3000');
        expect(fixDockerUrl('https://127.0.0.1:8080/API')).toBe(
          'https://host.docker.internal:8080/API'
        );
      });
    });
  });
});
