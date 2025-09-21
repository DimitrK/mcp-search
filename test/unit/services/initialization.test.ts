import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { InitializationService } from "../../../src/services/initialization";
import { clearEnvironmentCache } from "../../../src/config/environment";

describe("Initialization Service", () => {
  let initService: InitializationService;
  const originalEnv = process.env;

  beforeEach(() => {
    initService = new InitializationService();
    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_SEARCH_ENGINE_ID;
    delete process.env.EMBEDDING_SERVER_URL;
    delete process.env.EMBEDDING_SERVER_API_KEY;  
    delete process.env.EMBEDDING_MODEL_NAME;
    clearEnvironmentCache(); // Clear the cache
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should initialize successfully with valid environment", async () => {
    // Set required environment variables
    process.env.GOOGLE_API_KEY = "test-api-key";
    process.env.GOOGLE_SEARCH_ENGINE_ID = "test-search-id";
    process.env.EMBEDDING_SERVER_URL = "https://example.com";
    process.env.EMBEDDING_SERVER_API_KEY = "test-embedding-key";
    process.env.EMBEDDING_MODEL_NAME = "test-model";

    await expect(initService.initialize()).resolves.not.toThrow();
  });

  test("should fail initialization with missing environment variables", async () => {
    await expect(initService.initialize())
      .rejects
      .toThrow("Environment validation failed");
  });

  test("should create InitializationService instance", () => {
    expect(initService).toBeInstanceOf(InitializationService);
  });
});
