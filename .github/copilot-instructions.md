# MCP Search - AI Agent Instructions

## Project Overview
MCP server providing web search and semantic page reading with local vector caching. Built with TypeScript (ESM), DuckDB+VSS for embeddings, and Google Custom Search API. Production-ready with Docker support and comprehensive testing.

## Architecture Principles

### Domain-Driven Structure
- **`src/mcp/`** - MCP protocol layer (schemas, error types, server setup)
- **`src/handlers/`** - Tool implementations (`webSearch.ts`, `readFromPage.ts`)  
- **`src/core/`** - Business logic organized by domain:
  - `content/` - Fetching, extraction, chunking
  - `search/` - Google Custom Search client
  - `similarity/` - Unified manager pattern (NOT factory/pipeline/service layers)
  - `vector/` - Embeddings and DuckDB vector store with worker pool
- **`src/config/`** - Environment validation (Zod schemas) and constants
- **`src/utils/`** - Cross-cutting concerns (logging, hashing, validation)

### Critical Design Patterns

**1. Graceful Degradation**  
`SimilaritySearchManager.create()` returns `null` if embedding service unavailable. App continues with search-only mode.
```typescript
const manager = await SimilaritySearchManager.create(logger, { correlationId });
if (!manager) {
  // Fall back to search without semantic caching
}
```

**2. Boolean Parameters in Objects** (`.cursor/rules/engineeringrules.mdc`)  
NEVER: `myMethod(true)` → ALWAYS: `myMethod({ shouldUpdate: true })`  
Prefix booleans with `is`, `has`, `should`, `can`.

**3. Error Hierarchy** (`src/mcp/errors.ts`)  
Define domain errors in `errors.ts`. Use specific types:
- `TimeoutError`, `NetworkError` - HTTP/fetch failures
- `EmbeddingError` - Embedding service issues  
- `DatabaseError` - DuckDB/VSS problems
- `ValidationError` - Input validation (Zod)

**4. Self-Documenting Code**  
Avoid comments. Extract logic to descriptive functions:
```typescript
// BAD: this.queue.splice(0).forEach(w => { clearTimeout(w.timer); w.reject(...) });
// GOOD: this.queue.splice(0).forEach(rejectWaitingInQueue);
```

**5. DuckDB Worker Pool Architecture**  
Vector DB runs in separate workers (`process`/`thread`/`inline` modes) for stability. See `src/core/vector/store/workerPool.ts` and `worker/db-worker.js`. Restart on crash via `VECTOR_DB_RESTART_ON_CRASH=true`.

## Development Workflow

### Before ANY Code Changes
```bash
npm test           # Run full test suite
npm run lint       # Check ESLint (no warnings allowed)
npm run typecheck  # Verify TypeScript compilation
```

### Build & Debug Pipeline
```bash
npm run build                # Clean + compile JS + generate types
npm run dev                  # Run server with tsx (hot reload)
npm run debug                # MCP Inspector with full env config
npx @modelcontextprotocol/inspector node dist/cli.js server
```

**Docker Testing**  
See `DOCKER_TESTING.md` and `docker-compose.yml`. Use `docker-compose up` for integration testing.

### Test-Driven Development (MANDATORY)
1. Write unit tests BEFORE implementation
2. Run `npm run test:watch` during development  
3. Verify tests pass before submitting changes
4. Coverage thresholds enforced (see `jest.config.js`)

**Test Organization** (`test/`)
- `unit/` - Isolated module tests (mocked dependencies)
- `integration/` - End-to-end tool flows (real DuckDB, mocked HTTP)
- `performance/` - P50 < 300ms cached, < 3s first fetch

**Test Patterns**  
Mock setup in `test/__mocks__/` (e.g., `env-paths.js`). Use `nock` for HTTP mocking. Global setup in `test/setup.ts`.

## Critical Implementation Details

### Environment Variables (`src/config/environment.ts`)
Required: `GOOGLE_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `EMBEDDING_SERVER_URL`, `EMBEDDING_SERVER_API_KEY`, `EMBEDDING_MODEL_NAME`  
Cached singleton pattern: `getEnvironment()` validates once, returns cached config.  
Docker networking auto-fixes `localhost` → `host.docker.internal` via `isRunningInDocker()`.

### Correlation IDs & Structured Logging (`src/utils/logger.ts`)
Every tool call generates correlation ID (`mcp-${timestamp}-${random}`).  
Create child loggers: `createChildLogger(correlationId)`.  
Auto-redacts: `GOOGLE_API_KEY`, `EMBEDDING_SERVER_API_KEY`, `password`, `token`, etc.  
Use `withTiming()` for performance metrics: `await withTiming(logger, 'operation', async () => ...)`.

### MCP Handler Context Pattern (`src/mcp/mcpServer.ts`)
Handlers receive `HandlerContext` with `sendProgress(progress, total, message)`.  
Progress ≠ Logging! Use for UI updates in MCP clients:
```typescript
await context?.sendProgress(30, 100, 'Extracting content...');
```

### Content Processing Pipeline (`src/handlers/readFromPage.ts`)
1. Normalize URL → 2. Check cache (conditional GET with ETag) → 3. Fetch (with `undici`) → 4. Extract (Readability/Cheerio, fallback to Playwright for SPAs) → 5. Chunk (semantic chunking by tokens) → 6. Embed → 7. Store (DuckDB+VSS) → 8. Similarity search

**Conditional Requests**  
Always fetch with ETag if cached. Handle 304 Not Modified → reuse existing chunks.

**SPA Handling** (`src/core/content/extractors/spaExtractor.ts`)  
Optional Playwright extraction for JavaScript-heavy pages. Excluded from coverage (browser context).

### Vector Store Operations
**Storing**: `SimilaritySearchManager.storeWithEmbeddings(url, chunks, { correlationId })`  
**Searching**: `manager.searchMultiple(queries, url, maxResults, { similarityThreshold })`  
**Cleanup**: `await manager.close()` - ALWAYS call to release DB connections

### Build System (`build.mjs`)
Uses `esbuild` via custom script (NOT tsup/tsdown anymore). Bundles all `src/**/*.ts` files. **Critical**: Manually copies `db-worker.js` to `dist/` post-build.

## Common Pitfalls

1. **Vestigial Parameters**: Remove unused params from API signatures. Don't leave dead code.
2. **Import.meta in Tests**: Avoid `import.meta.url` in files imported by Jest (causes issues).
3. **DuckDB Connection Leaks**: Always await `manager.close()` in handlers and tests.
4. **ESLint Auto-Fix Temptation**: Fix root cause, don't disable rules. No `@ts-ignore`.
5. **Progress vs. Logging Confusion**: `context.sendProgress()` = client UI, `logger.debug()` = logs.

## Key Files Reference

- **Entry Points**: `src/cli.ts` (CLI), `src/server.ts` (MCP server orchestration)
- **Tool Schemas**: `src/mcp/schemas.ts` (Zod validation, exported types)
- **Error Definitions**: `src/mcp/errors.ts` (all MCP error classes)
- **Environment Config**: `src/config/environment.ts` (validation, defaults, Docker fixes)
- **Similarity Manager**: `src/core/similarity/similaritySearchManager.ts` (replaces factory/pipeline/service)
- **Vector Store**: `src/core/vector/store/duckdbVectorStore.ts` (DuckDB+VSS wrapper)
- **Engineering Rules**: `.cursor/rules/engineeringrules.mdc` (comprehensive coding standards)

## Release Process (`scripts/release.mjs`)
```bash
npm run release:patch   # Bump version, create release branch
npm run release:push    # Push branch + create PR
npm run release:cleanup # Delete local branch after merge
```
Follow semantic versioning. CI/CD runs tests + builds Docker image on PR.

## Documentation Standards

Update these files when making architectural changes:
- `specification.md` - Tool contracts and technology decisions
- `developmentPlan.md` - Milestone progress tracking
- `REFACTORING_PLAN.md` - Architecture evolution rationale
- This file - Keep instructions current with codebase reality
