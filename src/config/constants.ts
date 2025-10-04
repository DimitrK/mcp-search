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
    'Search the web using Google Custom Search API. Supports single or multiple queries with configurable results per query. For better results, use specific, domain-relevant terms and combine multiple related queries to capture different perspectives on the same topic. Returns raw Google search results including titles, URLs, and snippets. Useful for finding relevant web pages, news, or general information across the internet.',
  READ_FROM_PAGE:
    'Extract, process, and search content from any web page using semantic similarity matching. Fetches page content, splits it into semantic chunks, embeds them, and returns the most relevant chunks for your query. You  must use specific, domain-relevant terms (e.g., "ZK rollup advantages" instead of just "advantages") and combine multiple queries with 2-4 semantically related terms that include domain context. This approach dramatically improves recall while maintaining precision. Supports caching for performance and forceRefresh to bypass cache. Perfect for extracting specific information from documentation, articles, or any web content. This is not a text search so do not use a single word to match as a query.',
  DEBUG_ECHO:
    'Echo back any input message and metadata for debugging and testing the MCP pipeline. Useful for verifying that tools are accessible, testing parameter passing, and understanding the request/response flow in your MCP setup.',
} as const;
