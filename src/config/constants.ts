import { PACKAGE_VERSION } from '../utils/version';

export const APP_NAME = 'mcp-search';
export const APP_VERSION = PACKAGE_VERSION;

export const USER_AGENT = `${APP_NAME}/${APP_VERSION}`;

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
  WEB_SEARCH:
    'Search the web using Google Custom Search API with integrated semantic similarity matching. Supports single or multiple queries with configurable results per query. For better results, use specific, domain-relevant terms and combine multiple related queries to capture different perspectives on the same topic. Returns Google search results enhanced with semantically relevant content chunks from discovered pages when available. Each result includes the original Google data plus similarity-matched content snippets that directly answer your query. If no similarity matches exist for a page, only the original snippet is returned. This eliminates the need for sequential web.search + web.readFromPage operations by providing both discovery and content extraction in a single response.',
  READ_FROM_PAGE:
    'Extract and retrieve web page content. Two modes: (1) With query - semantic search returns relevant chunks with similarity scores. Use specific terms (e.g., "ZK rollup advantages"), combine 2-4 related queries for best results. Avoid single words. (2) Without query (omit/empty) - returns ALL chunks in document order, no scoring. Supports caching and forceRefresh.',
} as const;
