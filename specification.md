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
- **MCP SDK**: `modelcontextprotocol`
- **Validation**: `zod`
- **HTTP**: `undici`
- **HTML extraction**: `@mozilla/readability`, `cheerio`
- **Optional rendering**: `playwright` (dynamic import)
- **Rate limiting**: `rate-limiter-flexible`
- **In-memory cache**: `node-cache`
- **Persistent store**: `duckdb` with VSS extension
- **Filesystem paths**: `env-paths`
- **Logging**: `pino`
- **Build**: `tsup` (esbuild)
- **Testing**: Jest + `ts-jest`, `nock` (HTTP mocks), `msw` optional
- **Lint/format**: ESLint (`@typescript-eslint`), Prettier

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

- **Fetch**: `undici` with timeout (`REQUEST_TIMEOUT_MS`), custom UA, gzip/br. Use conditional GET via `If-None-Match` when `etag` stored. `forceRefresh` bypasses cache.
- **Extract**: Primary `@mozilla/readability` on sanitized DOM. Fallback `cheerio` targeting `article|main|div[role=main]`; remove `nav|aside|footer` and class patterns `(nav|menu|breadcrumb|footer|sidebar|promo|subscribe|cookie|gdpr)`.
- **Optional JS render**: dynamic `playwright` import only when skeleton DOM is detected (low text density, low `<p>` count, very short readability output).
- **Chunk**: Build blocks by headings (`h1–h6`) within the main subtree. Split by paragraphs/sentences, then merge to `EMBEDDING_TOKENS_SIZE` with 10–15% overlap. Drop duplicates by hash or cosine > 0.98.
- **Hashing**: `content_hash = sha256(extracted_main_text)`. Chunk `id = sha256(url + '|' + sectionPath + '|' + text)`.

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

- Timeouts produce classified errors including `REQUEST_TIMEOUT_MS` context.
- 401/403/paywall → respond with `note: 'content protected'` and omit chunks.
- Embeddings down → degrade gracefully as specified.
- Extractor failure → fallback sequence (Readability → Cheerio → optional Playwright) then fail with note if still empty.

### Logging, Security, Observability

- Logging: `pino` debug level in development; redact secrets; log fetches, cache hits, embedding batches, DB init.
- Security: only `http(s)` URLs; strip scripts/styles; ignore robots as specified; no auth flows.
- Observability: no metrics/health checks in MVP.

### Build, Test, Release

- Build: `tsup` to `dist/` ESM; include type declarations.
- Tests: Jest (`ts-jest`). Unit tests for extractor, chunker, hasher, embedding provider, DB queries. Integration tests for both tools with mocked HTTP and HTML fixtures. Golden tests for deterministic chunk IDs.
- CI: lint, typecheck, test on Node 20/22; tag-triggered publish to npm.
- Package: exports MCP server entry; optional `bin` for local debug.

### Project Structure

```
src/
  server.ts
  config/environment.ts
  mcp/schemas.ts
  mcp/tools/webSearch.ts
  mcp/tools/web.readFromPage.ts
  core/search/googleClient.ts
  core/content/fetcher.ts
  core/content/extractor.ts
  core/content/chunker.ts
  core/content/hasher.ts
  core/vector/embeddingProvider.ts
  core/vector/providers/http.ts
  core/vector/store/duckdb.ts
  services/webScraper.ts           # dynamic playwright import
  utils/*
test/
  unit/*
  integration/*
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
