// Jest setup file for global test configuration

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GOOGLE_API_KEY = 'test-google-api-key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'test-search-engine-id';
process.env.EMBEDDING_SERVER_URL = 'https://test.embedding.server';
process.env.EMBEDDING_SERVER_API_KEY = 'test-embedding-api-key';
process.env.EMBEDDING_MODEL_NAME = 'text-embedding-ada-002';
process.env.DATA_DIR = '/tmp/mcp-search-test';

// Global test utilities can be added here

export {};
