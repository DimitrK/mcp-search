## MCP Server Specification: Web Search and Page Reading

### Overview

- **Purpose**: Provide two MCP tools that help agents search the web and retrieve relevant or complete content from webpages with local semantic caching.
- **Tools**:
  - `web.search`: Google Custom Search API, batched queries, raw responses.
  - `web.readFromPage`: Fetch/extract/chunk/embed/store content for a URL with two modes: (1) With query - return semantically matched chunks, (2) Without query - return all content chunks in document order.
- **Key decisions**:
  - Embedded store: DuckDB + VSS extension.
  - Embeddings: HTTP provider (OpenAI-compatible) for MVP.
  - Robots policy: Ignored.
  - No raw HTML in outputs; return extracted plain text.
  - Optional dynamic Playwright fallback for JS-heavy pages.

### Technology Stack

- **Language/Runtime**: TypeScript, Node 20+ (ESM)
- **MCP SDK**: `@modelcontextprotocol/sdk` (latest version, best effort backward compatibility)
- **Validation**: `zod` with schema validation
- **HTTP**: `undici` with connection pooling
- **HTML extraction**: `@mozilla/readability`, `cheerio`, `jsdom`
- **Optional rendering**: `playwright` (dynamic import)
- **Rate limiting**: `rate-limiter-flexible`
- **In-memory cache**: Built-in (environment & logger caching)
- **Persistent store**: DuckDB (`@duckdb/node-api`) with VSS extension
- **Filesystem paths**: `env-paths`
- **Hashing**: Node.js built-in `crypto` (SHA-256)
- **Logging**: `pino` with structured logging
- **Build**: custom `build.mjs` using esbuild for JS plus `tsc` declarations
- **Testing**: Jest + `ts-jest`, `nock` (HTTP mocks), `msw` optional
- **Lint/format**: ESLint (`@typescript-eslint/recommended`, best practices rules), Prettier
- **Package**: NPM distribution with proper exports and optional CLI

### Environment Variables

Required:

```
GOOGLE_API_KEY
GOOGLE_SEARCH_ENGINE_ID
EMBEDDING_SERVER_URL
EMBEDDING_SERVER_API_KEY
EMBEDDING_MODEL_NAME
```

Optional (defaults in parentheses):

```
DATA_DIR                      # default via env-paths (e.g., ~/Library/Application Support/mcp-search)
SIMILARITY_THRESHOLD          # default 0.6
EMBEDDING_TOKENS_SIZE         # default 512
EMBEDDING_BATCH_SIZE          # default 8, max 32
REQUEST_TIMEOUT_MS            # default 20000
CONCURRENCY                   # default 2
ENABLE_SIMILARITY_SEARCH      # default true
VECTOR_DB_MODE                # default inline; one of inline, thread, process
VECTOR_DB_RESTART_ON_CRASH    # default false
```

### Tool Contracts (Zod)

```ts
// web.search
export const SearchInput = z.object({
  query: z.union([z.string(), z.array(z.string())]),
  resultsPerQuery: z.number().int().min(1).max(50).default(5),
  minimal: z.boolean().default(true).optional(),
  enableSimilaritySearch: z.boolean().default(true).optional(),
});

export const SearchOutput = z.object({
  queries: z.array(
    z.object({
      query: z.string(),
      result: z.unknown() // raw Google JSON for that query
    })
  )
});

// web.readFromPage tool schemas
export const ReadFromPageInput = z.object({
  url: z.string().url(),
  query: z.union([z.string(), z.array(z.string())]).optional(),
  forceRefresh: z.boolean().default(false).optional(),
  maxResults: z.number().int().min(1).max(50).default(8).optional(),
  includeMetadata: z.boolean().default(false).optional()
});

export const RelevantChunk = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number().optional(), // Omitted when no query provided (full content retrieval)
  sectionPath: z.array(z.string()).optional()
});

export const ReadFromPageOutput = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  lastCrawled: z.string(),
  queries: z.array(
    z.object({
      query: z.string(),
      results: z.array(RelevantChunk)
    })
  ),
  note: z.string().optional()
});
```

### DuckDB + VSS Schema

- Per-model DB file at `DATA_DIR/db/mcp-{sanitized-model-name}.duckdb`.
- The filename is derived from `EMBEDDING_MODEL_NAME` by lowercasing, replacing non-alphanumeric characters with hyphens, and trimming leading/trailing hyphens.

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  url TEXT PRIMARY KEY,
  title TEXT,
  etag TEXT,
  last_modified TEXT,
  last_crawled TIMESTAMP,
  content_hash TEXT
);

-- embedding dimension fixed at init (example 1536)
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  section_path TEXT,
  text TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  embedding FLOAT[1536],
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_url_idx ON chunks(url);
```

Notes:

- Store both `embedding_model` and `embedding_dim` in `meta` table on first embed. Model mismatches are treated as DB corruption because each model should have its own DB file.
- Dimension changes for the same model drop and recreate the `chunks` table for that model-specific database only.
- All similarity search operations are scoped by `url`.
- Upsert only changed/new chunks using stable content hashes.
- Connection pooling manages concurrent access to file-based DuckDB.

### Content Processing Pipeline

- **Fetch**: `undici` with timeout (`REQUEST_TIMEOUT_MS`), custom user agent, gzip/br compression. Use conditional GET via `If-None-Match` when `etag` stored. `forceRefresh` bypasses cache.
- **Extract**: Primary `@mozilla/readability` on JSDOM-parsed, sanitized DOM. Fallback `cheerio` targeting `article|main|div[role=main]`; remove `nav|aside|footer` and class patterns `(nav|menu|breadcrumb|footer|sidebar|promo|subscribe|cookie|gdpr|container|section)`.
- **Skeleton DOM detection**: Trigger Playwright fallback when: text density < 1%, `<p>` count < 5, or readability output < 500 chars.
- **Optional JS render**: Dynamic `playwright` import only when skeleton DOM detected. Worker pool (max 2 instances) with auto-recycling after 50 requests to prevent memory leaks.
- **Semantic chunking**: Build blocks by headings (`h1–h6`) and semantic HTML elements (`section`, `article`). Check for semantic class names (`container`, `section`). Split by paragraphs/sentences, merge to `EMBEDDING_TOKENS_SIZE` with configurable overlap (default 15%). Structure designed for future content-type awareness (code blocks, tables, lists).
- **Deduplication**: Drop duplicates by content hash and near-duplicates by cosine similarity > 0.98 or min-hash comparison.
- **Token estimation**: Use ~4 chars/token heuristic for chunk sizing.
- **Hashing**: `content_hash = sha256(extracted_main_text)`. Stable chunk `id = sha256(url + '|' + sectionPath + '|' + text)`.

### Similarity Search

- Cosine metric with VSS.
- Per query string: embed → query by `url` scope → order by `<->` operator → filter by `SIMILARITY_THRESHOLD` → return top `maxResults`.

```sql
SELECT id, text, section_path,
       1 - (embedding <=> ?::FLOAT[1536]) AS score
FROM chunks
WHERE url = ?
ORDER BY embedding <-> ?::FLOAT[1536]
LIMIT ?;
```

### Embeddings Provider (HTTP)

- `EMBEDDING_SERVER_URL` is the base URL; the provider calls `POST {EMBEDDING_SERVER_URL}/v1/embeddings` with `model: EMBEDDING_MODEL_NAME`.
- Batch up to 32 texts per request (`EMBEDDING_BATCH_SIZE`, default 8). One retry for 5xx with jitter. No retry for 429.
- On failure, degrade by returning longest content blocks and set `note` in output.

### `web.search` Behavior

- Accepts `string | string[]`; when array, execute in parallel up to `CONCURRENCY`. `resultsPerQuery` applies per item; total results = `x * n`.
- Always returns raw Google JSON per input query.

### `web.readFromPage` Behavior

**Two operational modes:**

1. **With Query** (similarity search mode):
   - Accepts `query` as `string | string[]`
   - Embed queries → search chunks by URL scope → filter by `SIMILARITY_THRESHOLD` → return top `maxResults` per query
   - Returns chunks with similarity scores (0-1 range) ordered by relevance
   - Processes multiple queries in parallel batches up to `CONCURRENCY` limit

2. **Without Query** (full content retrieval mode):
   - Triggered when `query` is: undefined (omitted), empty string `""`, empty array `[]`, or array of whitespace strings
   - Retrieves ALL chunks for the URL ordered by `created_at` (document flow order)
   - Ignores `maxResults` parameter - returns complete page content
   - Returns chunks WITHOUT `score` field (score is omitted, not 0 or null)
   - Single result entry with empty string `query: ""`

**Common behavior:**
- Both modes respect caching; `forceRefresh` bypasses cache
- Output includes `lastCrawled` timestamp
- `includeMetadata` returns additional context (section paths, stats)

### Caching & Invalidation

- Persistent: `documents` row stores `etag`, `last_modified`, `content_hash`, `last_crawled`. `chunks` store stable `id`, `embedding`.
- In-memory: throttle repeated refetches in-session.
- Invalidation: `forceRefresh` triggers re-fetch; if unchanged, reuse cached chunks/embeddings; if changed, re-embed only changed chunks.
- Output includes `lastCrawled` to inform agent decisions.

### Concurrency & Rate Limits

- Global concurrency cap `CONCURRENCY` (default 2) across network-bound ops.
- Google calls rate-limited via `rate-limiter-flexible`; no retry on 429; single retry on 5xx with jitter.
- Embedding requests batched with backpressure under the same cap.

### Error Handling

- **Error Classification**: `TimeoutError`, `NetworkError`, `ExtractionError`, `EmbeddingError` with structured MCP-compliant responses.
- **Timeouts**: Produce classified errors including `REQUEST_TIMEOUT_MS` context.
- **HTTP errors**: 401/403/paywall → respond with `note: 'content protected'` and omit chunks.
- **Extraction fallback chain**: Readability → Cheerio → Playwright → Raw text stripper (last resort: strip HTML tags).
- **Embedding failures**: Degrade gracefully by returning longest content blocks with `note: 'embedding provider unavailable; returning raw'`.
- **Vector search failures**: Fall back to returning full content chunks when similarity search fails.
- **Database lock contention**: Connection pool with timeout and retry for DuckDB file locking issues.
- **Network failures**: Single retry for 5xx with exponential backoff and jitter; no retry for 429 rate limits.
- **Graceful degradation**: Always attempt to return partial results when possible.

### Performance Optimizations

- **Parallel processing**: Multiple queries in `readFromPage` embed concurrently within `CONCURRENCY` limits.
- **Batch operations**: DuckDB inserts/updates performed in transactions for better performance.
- **Connection pooling**: Managed DuckDB connections for concurrent request handling.
- **Pipeline optimization**: Overlap fetching, extraction, and embedding where possible.

### Logging, Security, Observability

- Logging: `pino` debug level in development; redact secrets; log fetches, cache hits, embedding batches, DB init. Correlation IDs for request tracing.
- Security: only `http(s)` URLs; strip scripts/styles; ignore robots as specified; no auth flows.
- Observability: No-op metrics collector interface with hooks for future monitoring integration.

### Development Approach & Code Quality

- **Clean Code Practices**: Small functions with single responsibilities, clear naming conventions, explicit return types.
- **Modular Design**: Isolated modules by logic and domain responsibility; loose coupling, high cohesion.
- **File Organization**: Break code into small files; folders represent domain repositories of similar components.
- **Testability**: Design for easy unit testing; dependency injection where appropriate; mock-friendly interfaces.
- **ESLint Configuration**:
  - `eslint:recommended`, `@typescript-eslint/recommended`
  - `plugin:prettier/recommended`
  - Custom rules: no implicit any, no floating promises, prefer const, explicit return types on public APIs
- **Code Structure**: Domain-driven folder structure with clear separation of concerns.

### Build, Test, Release

- **Build**: `esbuild` to `dist/` ESM output; include TypeScript declarations; tree-shaking enabled.
- **Package.json**: Proper `exports` map, `bin` entry for CLI, peer dependencies for optional packages.
- **Tests**: Jest (`ts-jest`) with comprehensive coverage:
  - **Unit tests**: extractor, chunker, hasher, embedding provider, DB queries, token estimation
  - **Integration tests**: both MCP tools with mocked HTTP (`nock`) and HTML fixtures
  - **Golden tests**: deterministic chunk IDs and content extraction
  - **Error handling tests**: all error scenarios and fallback behaviors
- **CI/CD**: GitHub Actions with lint, typecheck, test matrix on Node 20/22; automated npm publish on git tags.
- **NPM Package**: Public package with MCP server entry point and optional CLI for debugging.
- **Docker support**: For containerized deployments

### MCP Protocol Requirements

- **Tool Registration**: Proper MCP tool metadata with descriptions, input/output schemas.
- **Error Responses**: MCP-compliant structured error responses with appropriate error codes.
- **Protocol Version**: Target latest MCP protocol version with backward compatibility considerations.
- **Tool Descriptions**: Clear, agent-friendly descriptions for both tools explaining their purpose and usage.
- **Schema Validation**: Strict input validation using Zod schemas before processing.
- **Debugging Support**: Compatible with MCP library's debugging tools and inspector for development and troubleshooting.

### Project Structure

```
src/
  cli.ts                           # CLI entry point
  server.ts                        # MCP server orchestration
  config/
    environment.ts                 # Environment variable validation
    constants.ts                   # Application constants
  mcp/
    schemas.ts                     # Zod schemas for tool inputs/outputs
    errors.ts                      # MCP-compliant error classes
    mcpServer.ts                   # Tool registration and MCP protocol setup
  handlers/
    webSearch.ts                   # web.search tool implementation
    readFromPage.ts                # web.readFromPage tool implementation
  core/
    search/
      googleClient.ts              # Google Custom Search API client
    content/
      httpContentFetcher.ts        # HTTP content fetching
      htmlContentExtractor.ts      # HTML content extraction (Readability + Cheerio)
      chunker.ts                   # Semantic content chunking
      extractors/                  # Readability, Cheerio, SPA, raw extraction strategies
    similarity/
      similaritySearchManager.ts   # Store/search orchestration and graceful degradation
      mappers/                     # Output mappers for MCP response shapes
    vector/
      embeddingProvider.ts         # Embedding provider interface
      providers/
        httpEmbeddingProvider.ts   # HTTP embedding provider (OpenAI-compatible)
        # Future: localEmbeddingProvider.ts for node-llama-cpp
      store/
        duckdbVectorStore.ts       # DuckDB + VSS storage implementation
        schema.ts                  # Database schema definitions
        workerPool.ts              # Inline/thread/process DB execution modes
  services/
    initialization.ts              # Environment and data directory initialization
  utils/
    urlValidator.ts                # URL validation and normalization
    logger.ts                      # Structured logging setup
    dataDirectory.ts               # DATA_DIR and DB directory creation
    databaseInspector.ts           # CLI inspection helpers
    databaseCleaner.ts             # CLI cleanup helpers
test/
  unit/
    core/                          # Unit tests for core modules
    handlers/                      # Unit tests for MCP handlers
    utils/                         # Unit tests for utilities
  integration/
    *.test.ts                      # Integration tests for MCP flows
  __mocks__/                       # Jest mocks
```

### Non-Functional Targets (MVP)

- P50 `web.readFromPage` (cached URL, single query, `maxResults=8`): < 300 ms
- First-time crawl+embed (~1.5K tokens page): < 3 s (provider-dependent)
- Storage footprint per chunk: ~2 KB text + ~6 KB embedding (@1536 dims)

### Future Iterations

- **Vector store abstraction**: Interface layer allowing swap from DuckDB VSS to specialized vector DBs (Qdrant, Weaviate) for better scaling beyond ~100k embeddings
- **Advanced chunking**: Content-type detection for code blocks, tables, and lists with specialized processing
- **Local embeddings**: via `node-llama-cpp` (GGUF models)
- **PDF and other file type parsing**
- **Metrics and health checks**
- **Robots handling toggle**
