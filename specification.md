## MCP Server Specification: Web Search and Page Reading

### Overview

- **Purpose**: Provide two MCP tools that help agents search the web and retrieve only relevant content from a specific page with local semantic caching.
- **Tools**:
  - `web.search`: Google Custom Search API, batched queries, raw responses.
  - `web.readFromPage`: Fetch/extract/chunk/embed/store content for a URL and return semantically matched chunks to user queries, scoped to that URL.
- **Key decisions**:
  - Embedded store: DuckDB + VSS extension.
  - Embeddings: HTTP provider (OpenAI-compatible) for MVP.
  - Robots policy: Ignored.
  - No raw HTML in outputs; return extracted plain text.
  - Optional dynamic Playwright fallback for JS-heavy pages.

### Technology Stack

- **Language/Runtime**: TypeScript, Node 20+ (ESM)
- **MCP SDK**: `modelcontextprotocol` (latest version, best effort backward compatibility)
- **Validation**: `zod` with schema validation
- **HTTP**: `undici` with connection pooling
- **HTML extraction**: `@mozilla/readability`, `cheerio`, `jsdom`
- **Optional rendering**: `playwright` (dynamic import)
- **Rate limiting**: `rate-limiter-flexible`
- **In-memory cache**: `node-cache`
- **Persistent store**: `duckdb` with VSS extension
- **Filesystem paths**: `env-paths`
- **Hashing**: Node.js built-in `crypto` (SHA-256)
- **Logging**: `pino` with structured logging
- **Build**: `tsup` (esbuild)
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
DATA_DIR                      # default via env-paths (e.g., ~/Library/Application Support/mpc-search)
SIMILARITY_THRESHOLD          # default 0.72
EMBEDDING_TOKENS_SIZE         # default 512
REQUEST_TIMEOUT_MS            # default 20000
CONCURRENCY                   # default 2
GOOGLE_SAFE_SEARCH            # off|moderate|strict (maps to GCS off|active), default off
```

### Tool Contracts (Zod)

```ts
// web.search
export const SearchInput = z.object({
  query: z.union([z.string(), z.array(z.string())]),
  resultsPerQuery: z.number().int().min(1).max(50).default(10),
  region: z.string().optional(),
  language: z.string().optional(),
  safeSearch: z.enum(['off', 'moderate', 'strict']).optional()
});

export const SearchOutput = z.object({
  queries: z.array(
    z.object({
      query: z.string(),
      result: z.unknown() // raw Google JSON for that query
    })
  )
});

// web.readFromPage
export const ReadFromPageInput = z.object({
  url: z.string().url(),
  query: z.union([z.string(), z.array(z.string())]),
  forceRefresh: z.boolean().default(false).optional(),
  maxResults: z.number().int().min(1).max(50).default(8).optional(),
  includeMetadata: z.boolean().default(false).optional()
});

export const RelevantChunk = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number(),
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

- Single DB file at `DATA_DIR/db/mpc.duckdb`

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
CREATE INDEX IF NOT EXISTS chunks_vss_idx ON chunks USING vss(embedding) WITH (metric='cosine');
```

Notes:

- Determine and persist `embedding_dim` on first embed; fail fast if mismatched later.
- All similarity search operations are scoped by `url`.
- Upsert only changed/new chunks using stable content hashes.

### Content Processing Pipeline

- **Fetch**: `undici` with timeout (`REQUEST_TIMEOUT_MS`), custom user agent, gzip/br compression. Use conditional GET via `If-None-Match` when `etag` stored. `forceRefresh` bypasses cache.
- **Extract**: Primary `@mozilla/readability` on JSDOM-parsed, sanitized DOM. Fallback `cheerio` targeting `article|main|div[role=main]`; remove `nav|aside|footer` and class patterns `(nav|menu|breadcrumb|footer|sidebar|promo|subscribe|cookie|gdpr|container|section)`.
- **Skeleton DOM detection**: Trigger Playwright fallback when: text density < 1%, `<p>` count < 5, or readability output < 500 chars.
- **Optional JS render**: Dynamic `playwright` import only when skeleton DOM detected.
- **Semantic chunking**: Build blocks by headings (`h1–h6`) and semantic HTML elements (`section`, `article`). Check for semantic class names (`container`, `section`). Split by paragraphs/sentences, merge to `EMBEDDING_TOKENS_SIZE` with 10–15% overlap.
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

- OpenAI-compatible `POST /v1/embeddings` with `model: EMBEDDING_MODEL_NAME`.
- Batch up to ~32 texts per request. One retry for 5xx with jitter. No retry for 429.
- On failure, degrade by returning longest content blocks and set `note` in output.

### `web.search` Behavior

- Accepts `string | string[]`; when array, execute in parallel up to `CONCURRENCY`. `resultsPerQuery` applies per item; total results = `x * n`.
- Google SafeSearch mapping: `off` → `safe=off`, `moderate|strict` → `safe=active`.
- Always returns raw Google JSON per input query.

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
- **Embedding failures**: Degrade gracefully by returning longest content blocks with `note: 'embedding provider unavailable; returning raw'`.
- **Extraction failures**: Fallback sequence (Readability → Cheerio → optional Playwright) then fail with descriptive note if still empty.
- **Network failures**: Single retry for 5xx with exponential backoff and jitter; no retry for 429 rate limits.
- **Graceful degradation**: Always attempt to return partial results when possible.

### Logging, Security, Observability

- Logging: `pino` debug level in development; redact secrets; log fetches, cache hits, embedding batches, DB init.
- Security: only `http(s)` URLs; strip scripts/styles; ignore robots as specified; no auth flows.
- Observability: no metrics/health checks in MVP.

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

- **Build**: `tsup` to `dist/` ESM output; include TypeScript declarations; tree-shaking enabled.
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

### Project Structure

```
src/
  server.ts                        # MCP server entry point
  config/
    environment.ts                 # Environment variable validation
    constants.ts                   # Application constants
  mcp/
    schemas.ts                     # Zod schemas for tool inputs/outputs
    tools/
      webSearch.ts                 # web.search tool implementation
      readFromPage.ts              # web.readFromPage tool implementation
    errors.ts                      # MCP-compliant error classes
  core/
    search/
      googleClient.ts              # Google Custom Search API client
      rateLimiter.ts               # Rate limiting logic
    content/
      httpContentFetcher.ts        # HTTP content fetching
      htmlContentExtractor.ts      # HTML content extraction (Readability + Cheerio)
      chunker.ts            # Semantic content chunking
      hasher.ts             # Content hashing utilities
    vector/
      embeddingProvider.ts         # Embedding provider interface
      providers/
        httpEmbeddingProvider.ts   # HTTP embedding provider (OpenAI-compatible)
        # Future: localEmbeddingProvider.ts for node-llama-cpp
      store/
        duckdbVectorStore.ts       # DuckDB + VSS storage implementation
        vectorStoreSchema.ts       # Database schema definitions
  services/
    playwrightWebScraper.ts        # Optional Playwright integration (dynamic import)
  utils/
    tokenEstimator.ts              # Token counting utilities (~4 chars/token)
    urlValidator.ts                # URL validation and normalization
    logger.ts                      # Structured logging setup
    cache.ts                       # In-memory caching utilities
test/
  unit/
    core/                          # Unit tests for core modules
    utils/                         # Unit tests for utilities
  integration/
    tools/                         # Integration tests for MCP tools
  fixtures/
    htmlSamples/                   # Test HTML fixtures
    apiResponses/                  # Mock API response fixtures
  __mocks__/                       # Jest mocks
```

### Non-Functional Targets (MVP)

- P50 `web.readFromPage` (cached URL, single query, `maxResults=8`): < 300 ms
- First-time crawl+embed (~1.5K tokens page): < 3 s (provider-dependent)
- Storage footprint per chunk: ~2 KB text + ~6 KB embedding (@1536 dims)

### Future Iterations

- Local embeddings via `node-llama-cpp` (GGUF models)
- PDF and other file type parsing
- Metrics and health checks
- Regional settings for Google
- Robots handling toggle
