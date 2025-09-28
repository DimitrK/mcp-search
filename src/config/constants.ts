export const APP_NAME = 'mcp-search';
export const APP_VERSION = '0.1.0';

export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+https://github.com/your-username/mcp-search)`;

export const DEFAULT_EMBEDDING_DIMENSION = 1536;

export const CHUNK_OVERLAP_PERCENTAGE = 0.15;

export const TOKEN_ESTIMATION_RATIO = 4; // ~4 chars per token

export const DEDUPLICATION_SIMILARITY_THRESHOLD = 0.98;

export const SKELETON_DOM_THRESHOLDS = {
  TEXT_DENSITY: 0.01,
  MIN_PARAGRAPHS: 5,
  MIN_READABILITY_LENGTH: 500,
} as const;

export const PLAYWRIGHT_WORKER_POOL = {
  MAX_INSTANCES: 2,
  RECYCLE_AFTER_REQUESTS: 50,
} as const;

export const EMBEDDING_BATCH_SIZE = 32;

export const MCP_TOOL_DESCRIPTIONS = {
  WEB_SEARCH: 'Search the web using Google Custom Search API with support for batch queries',
  READ_FROM_PAGE: 'Extract and search content from web pages with semantic similarity matching',
  DEBUG_ECHO: 'Echo back input for debugging and testing MCP pipeline functionality',
} as const;
