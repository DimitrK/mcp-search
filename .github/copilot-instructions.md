````instructions
# MCP Search - AI Agent Instructions

## Project Overview
MCP server providing web search and semantic page reading with local vector caching. Built with TypeScript (ESM), DuckDB+VSS for embeddings, and Google Custom Search API. Production-ready with Docker support and comprehensive testing.

**What this does**: Enables AI agents to search the web via Google Custom Search and extract semantically relevant content from webpages with local caching for fast retrieval.

## Architecture & Design Patterns

### Domain-Driven Structure
```
src/
├── mcp/          # MCP protocol layer (schemas, errors, server setup)
├── handlers/     # Tool implementations (webSearch, readFromPage)
├── core/         # Business logic by domain:
│   ├── content/  # Fetching, extraction, chunking
│   ├── search/   # Google Custom Search client
│   ├── similarity/ # Manager pattern (NOT factory/service)
│   └── vector/   # Embeddings + DuckDB with worker pool
├── config/       # Environment validation (Zod schemas)
└── utils/        # Logging, hashing, validation
```

### Critical Patterns

**1. Graceful Degradation**
`SimilaritySearchManager.create()` returns `null` if embedding service unavailable. App continues without semantic search:
```typescript
const manager = await SimilaritySearchManager.create(logger, { correlationId });
if (!manager) {
  // Search-only mode - no semantic caching
}
```

**2. Boolean Trap Prevention** (`.cursor/rules/engineeringrules.mdc`)
❌ NEVER: `myMethod(true, false)`
✅ ALWAYS: `myMethod({ shouldUpdate: true, forceRefresh: false })`
Boolean names MUST start with `is`, `has`, `should`, `can`.

**3. Domain Error Hierarchy** (`src/mcp/errors.ts`)
Use specific error types instead of generic `Error`:
- `TimeoutError`, `NetworkError` - HTTP/fetch failures
- `EmbeddingError` - Embedding service issues
- `DatabaseError` - DuckDB/VSS problems
- `ValidationError` - Zod validation failures

**4. Self-Documenting Code Over Comments**
Extract complex logic to named functions instead of commenting:
```typescript
// ❌ BAD
this.queue.splice(0).forEach(w => { clearTimeout(w.timer); w.reject(...) });

// ✅ GOOD
const rejectWaitingInQueue = (waiter) => {
  clearTimeout(waiter.timer);
  waiter.reject(new Error('Pool closing'));
};
this.queue.splice(0).forEach(rejectWaitingInQueue);
```

**5. DuckDB Worker Pool Architecture**
Vector DB runs in separate workers for stability:
- Modes: `process` (fork), `thread` (worker_threads), `inline` (same process)
- Worker code: `src/core/vector/store/worker/db-worker.js` (manually copied post-build)
- Pool wrapper: `src/core/vector/store/workerPool.ts`
- Auto-restart on crash: `VECTOR_DB_RESTART_ON_CRASH=true`

**6. Rate Limiting with Circuit Breaker**
Custom token bucket implementation (`src/core/similarity/rateLimiter.ts`) provides:
- Token-based rate limiting (configurable requests/window)
- Circuit breaker pattern (opens after N failures, half-opens after timeout)
- Exponential backoff with configurable retry strategies
- Used by Google Search client and embedding operations

## Development Workflow

### Pre-Commit Checklist
```bash
npm test           # All tests must pass
npm run lint       # Zero warnings allowed
npm run typecheck  # TypeScript must compile cleanly
```

### Build & Debug
```bash
npm run build                # Clean, compile JS (esbuild), generate types
npm run dev                  # Hot reload with tsx
npm run debug                # MCP Inspector with full env setup
npm run test:watch           # TDD mode - keep tests running
```

### Docker Workflow
```bash
./test-docker.sh             # Automated Docker testing script
docker-compose up            # Integration testing with real services
```
See `DOCKER_TESTING.md` for details. Note: First build downloads Playwright (~200MB).

### Test-Driven Development (MANDATORY)
1. **Write test first** - Define expected behavior
2. **Run `npm run test:watch`** - Keep tests running
3. **Implement to pass** - Make test green
4. **Refactor** - Clean up with test safety net
5. **Verify coverage** - Check `jest.config.js` thresholds

**Test Organization** (`test/`):
- `unit/` - Isolated modules, mocked dependencies (Jest mocks)
- `integration/` - End-to-end flows (real DuckDB, mocked HTTP via `undici` mocks)
- `performance/` - SLA validation (P50 < 300ms cached, < 3s first fetch)

**Key Test Patterns**:
- Mock setup: `test/__mocks__/env-paths.js` (global mocks)
- HTTP mocking: Mock `undici` module directly (see `test/integration/httpFetchAndPersist.test.ts`)
- Unique URLs: Generate per-test URLs to prevent interference
- Global setup: `test/setup.ts` (Jest config)
- Use `nock` for HTTP mocking. Global setup in `test/setup.ts`. Jest configured for ESM with `ts-jest` preset.

**Resource Cleanup in Tests** (see `test/unit/core/similarity/similaritySearchManager.test.ts`)
Always use `afterEach` hooks to clean up resources that hold connections:
```typescript
describe('ResourceTests', () => {
  let manager: SimilaritySearchManager | null = null;

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
  });

  it('uses resource', async () => {
    manager = await SimilaritySearchManager.create(logger);
    // Automatic cleanup in afterEach
  });
});
```
## Critical Implementation Details

### Environment Variables (`src/config/environment.ts`)
**Required**: `GOOGLE_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `EMBEDDING_SERVER_URL`, `EMBEDDING_SERVER_API_KEY`, `EMBEDDING_MODEL_NAME`

**Singleton Pattern**: `getEnvironment()` validates once via Zod, caches result.
**Docker Auto-Fix**: Rewrites `localhost` → `host.docker.internal` via `isRunningInDocker()`.

### Correlation IDs & Structured Logging (`src/utils/logger.ts`)
Every tool call gets a correlation ID (`mcp-${timestamp}-${random}`):
```typescript
const correlationId = generateCorrelationId();
const logger = createChildLogger(correlationId);
```

**Auto-Redaction**: Removes `GOOGLE_API_KEY`, `EMBEDDING_SERVER_API_KEY`, `password`, `token` from logs.
**Performance Tracking**: Use `withTiming()` wrapper:
```typescript
await withTiming(logger, 'fetchContent', async () => { /* ... */ });
```

### MCP Handler Context Pattern (`src/mcp/mcpServer.ts`)
Handlers receive `HandlerContext` with `sendProgress()` for UI updates:
```typescript
interface HandlerContext {
  correlationId: string;
  sendProgress: (progress: number, total?: number, message?: string) => Promise<void>;
}

// In handler:
await context?.sendProgress(30, 100, 'Extracting content...');
```
**Critical**: Progress ≠ Logging. `sendProgress()` = MCP client UI, `logger.debug()` = server logs.

### Content Processing Pipeline (`src/handlers/readFromPage.ts`)
1. **Normalize URL** → 2. **Check cache** (conditional GET with ETag) → 3. **Fetch** (`undici` with connection pooling) → 4. **Extract** (Readability/Cheerio, Playwright fallback for SPAs) → 5. **Chunk** (semantic chunking by token count) → 6. **Embed** → 7. **Store** (DuckDB+VSS) → 8. **Search**

**Conditional Requests**: Always include `If-None-Match` header. Handle `304 Not Modified` → reuse chunks.
**SPA Extraction**: Optional Playwright for JS-heavy pages (`src/core/content/extractors/spaExtractor.ts`). Excluded from coverage (runs in browser context).

### Vector Store Operations (`src/core/similarity/similaritySearchManager.ts`)
```typescript
// Unified manager replaces old factory/pipeline/service layers
const manager = await SimilaritySearchManager.create(logger, { correlationId });

// Store content with embeddings
await manager.storeWithEmbeddings(url, chunks, { correlationId });

// Search similar chunks
const results = await manager.searchMultiple(
  queries,
  url,
  maxResults,
  { similarityThreshold: 0.72 }
);

// CRITICAL: Always close to release DB connections
await manager.close();
```

### Build System (`build.mjs`)
Custom esbuild script (replaced tsup/tsdown):
- Bundles all `src/**/*.ts` files
- **Critical step**: Manually copies `db-worker.js` to `dist/` post-build
- Generates types separately via `tsc --emitDeclarationOnly`

### Database Storage & Persistence (`src/config/environment.ts`, `src/utils/dataDirectory.ts`)

**Technology**: DuckDB with VSS extension (single-file database)
**File Location**: `{DATA_DIR}/db/mcp.duckdb`

**Data Directory Resolution**:
```typescript
// From src/config/environment.ts
if (!env.DATA_DIR) {
  const paths = envPaths('mcp-search');  // OS-specific app data dir
  env.DATA_DIR = paths.data;
}
```

**Default Locations**:
- **macOS**: `~/Library/Application Support/mcp-search/`
- **Linux**: `~/.local/share/mcp-search/`
- **Windows**: `%LOCALAPPDATA%\mcp-search\`
- **Docker**: `/app/data/` (set via ENV in Dockerfile)

**Key Functions**:
- `getDataDirectory()` - Returns `DATA_DIR` path
- `getDatabasePath()` - Returns `{DATA_DIR}/db/mcp-{model-name}.duckdb` (per-model isolation since v0.1.4)
- `initializeDataDirectory()` - Creates directory structure with `{ recursive: true }`

**Per-Model Database Isolation** (v0.1.4+):
- Each embedding model gets its own database file: `mcp-{sanitized-model-name}.duckdb`
- Model name sanitization: lowercase, replace non-alphanumeric with hyphens, trim edge hyphens
- Example: `text-embedding-3-small` → `mcp-text-embedding-3-small.duckdb`
- Multiple models can coexist in same `DATA_DIR/db/` directory
- Safe to switch models without data loss or conflicts

**Initialization Flow** (from `src/services/initialization.ts`):
1. Validate environment → 2. Create data directories → 3. DuckDB auto-creates model-specific file on first connection → 4. VSS extension loads → 5. Tables initialized

**Storage Contents** (per-model database):
- Documents table: URL, title, timestamp, ETag, content hash
- Chunks table: ID, URL, section_path, text, tokens, embedding vector
- Embedding_config table: Model name, dimension (validates model consistency within DB)

**Docker Volume Patterns**:
```bash
# Named volume (recommended - survives container deletion)
docker run -v mcp_data:/app/data mcp-search:latest

# Bind mount (development - direct host access)
docker run -v ./data:/app/data mcp-search:latest

# No volume (ephemeral - data lost on container stop)
docker run mcp-search:latest  # ⚠️ NOT RECOMMENDED
```

**Configuration Change Behavior**:
- **`EMBEDDING_TOKENS_SIZE` change** (512→1024): Safe - chunks coexist at different sizes
- **Model name change** (e.g., text-embedding-3-small → cohere): **Switches to different DB file** - both models' data preserved
- **Embedding dimension change** (e.g., 1536d → 3072d): **Auto-drops chunks table** (deletes all embeddings for that model, keeps documents)
- **Best practice**: Each model uses its own DB file automatically (v0.1.4+), no manual separation needed

**Code References**:
- Model-specific DB path: `src/config/environment.ts:108-118` (getDatabasePath with sanitization)
- Model mismatch check: `src/core/vector/store/meta.ts:30-33` (validates consistency within DB)
- Dimension change handling: `src/core/vector/store/meta.ts:36-64` (drops/recreates chunks table)
- Chunk size handling: `src/core/content/chunker.ts` (coexist in same DB)

**Size Estimates** (per-model database):
- Empty: ~100 KB
- 10 pages: ~5-10 MB (varies by model dimension)
- 100 pages: ~50-100 MB
- 1000 pages: ~500 MB - 1 GB

## Common Pitfalls

1. **Vestigial Parameters**: Remove unused function params. Don't accumulate dead code.
2. **Import.meta in Tests**: Avoid in files imported by Jest (ESM compatibility issues).
3. **DuckDB Connection Leaks**: Always `await manager.close()` in handlers/tests/finally blocks.
4. **ESLint Disable Abuse**: Fix root cause, don't suppress with `@ts-ignore` or `eslint-disable`.
5. **Progress vs. Logging**: `context.sendProgress()` for client UI, `logger.debug()` for server logs.
6. **Test Isolation**: Generate unique URLs per test to prevent cross-test contamination.
7. **Embedding Model Changes**: Each model automatically gets its own DB file (v0.1.4+). Safe to switch models. Dimension changes auto-drop chunks table for that model only.

## Key Files Reference

**Entry Points**:
- `src/cli.ts` - CLI interface (health, inspect, cleanup, server)
- `src/server.ts` - MCP server orchestration

**Core Architecture**:
- `src/mcp/schemas.ts` - Zod schemas, exported TypeScript types
- `src/mcp/errors.ts` - All MCP error classes
- `src/config/environment.ts` - Environment validation, Docker fixes
- `src/core/similarity/similaritySearchManager.ts` - Unified similarity search API

**Infrastructure**:
- `build.mjs` - Custom esbuild configuration
- `jest.config.js` - Test configuration, coverage thresholds
- `.cursor/rules/engineeringrules.mdc` - Comprehensive coding standards
- `Dockerfile` - Multi-stage production build

## Release & CI/CD

### Release Process (`scripts/release.mjs`)
```bash
npm run release:patch   # Bump version, create branch
npm run release:push    # Push branch, create PR
npm run release:cleanup # Delete local branch after merge
```

### CI/CD Pipeline (`.github/workflows/ci.yml`)
- **Quality Gates**: Formatting, ESLint, TypeScript
- **Security**: npm audit, CodeQL analysis
- **Test Matrix**: Node 20.x/22.x on Ubuntu/macOS
- **Docker Build**: Multi-platform image on tags
- **Coverage**: Codecov integration

## Documentation Standards

Update these when changing architecture:
- `specification.md` - Tool contracts, technology decisions
- `developmentPlan.md` - Milestone tracking
- This file - Keep current with codebase reality

## Quick Reference

**Run MCP Inspector**:
```bash
npm run debug
# Opens browser with MCP debugging UI
```

**Check DB Health**:
```bash
npm run health:verbose
# Shows vector store stats, connection info
```

**Database Inspection**:
```bash
npm run db:inspect
# Lists documents, chunks, embeddings
```

**Clean Old Data**:
```bash
npm run cleanup
# Removes stale cached data
```
````
