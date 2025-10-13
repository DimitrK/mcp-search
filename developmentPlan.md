# MCP Search Development Plan

## Overview

This development plan breaks down the MCP server implementation into incremental milestones with clear acceptance criteria. Each milestone builds upon the previous one and can be verified independently.

## Milestone 1: Project Foundation & Setup

**Goal**: Establish project structure, tooling, and basic MCP server skeleton.

### Tasks:

1. **Initialize NPM project**

   - Create `package.json` with proper metadata
   - Set up TypeScript configuration (`tsconfig.json`)
   - Configure build tool (`tsup.config.ts`)

2. **Setup development tooling**

   - Configure ESLint with recommended rules
   - Setup Prettier integration
   - Configure Jest for testing
   - Setup GitHub Actions workflow
   - Initialize `DATA_DIR` via env-paths and ensure directories exist

3. **Create project structure**

   - Implement folder structure as per specification
   - Create placeholder files with basic exports
   - Setup environment variable validation

4. **Basic MCP server skeleton**
   - Implement minimal MCP server with `modelcontextprotocol`
   - Register empty tool stubs (`web.search`, `web.readFromPage`)
   - Add basic logging setup with secret redaction
   - Ensure compatibility with MCP debugging/inspector tools

### Acceptance Criteria:

- [x] `npm run build` produces clean output in `dist/`
- [x] `npm run lint` passes without errors
- [x] `npm run test` runs (even with empty tests)
- [x] MCP server starts without errors
- [x] MCP debugging tools can connect to server
- [x] Environment variables are validated on startup

### Verification:

```bash
# Test MCP server connection
npx @modelcontextprotocol/inspector mcp-search

# Should show two registered tools (empty implementations)
```

---

## Milestone 2: Google Search Implementation

**Goal**: Implement complete `web.search` tool with Google Custom Search API.

### Tasks:

1. **Google Search Client** (TDD approach)

   - Write unit tests for `core/search/googleClient.ts` first
   - Implement Google client to pass tests
   - Add API key validation and error handling (test-first)
   - Implement rate limiting with `rate-limiter-flexible` (test-first)

2. **Search Tool Implementation** (TDD approach)
   - Write unit tests for `mcp/tools/webSearch.ts` first
   - Complete tool implementation to pass tests
   - Implement Zod schemas for input/output validation (test-first)
   - Handle single string and array inputs (test-first)
   - Add proper error responses (test-first)

### Acceptance Criteria:

- [x] Single search query returns raw Google JSON
- [x] Array of queries returns results for each query
- [x] Rate limiting prevents API abuse
- [x] Proper error handling for API failures
- [x] All tests pass

### Verification:

```bash
# Test with MCP inspector
web.search({ query: "TypeScript MCP", resultsPerQuery: 5 })

# Should return Google Custom Search JSON response
# Test with array: ["TypeScript", "MCP server"]
```

---

## Milestone 3: Basic Content Fetching & Storage

**Goal**: Implement HTTP content fetching and DuckDB storage foundation.

### Tasks:

1. **HTTP Content Fetcher** (TDD approach)

   - Write unit tests for `core/content/httpContentFetcher.ts` first
   - Implement fetcher to pass tests
   - Add timeout handling and custom user agent (test-first)
   - Implement conditional GET with ETag support (test-first)
   - Add basic error classification (test-first)
   - Enforce `http(s)` URL scheme and normalize URLs (test-first)

2. **DuckDB Vector Store Setup** (TDD approach)

   - Write unit tests for `core/vector/store/duckdbVectorStore.ts` first
   - Implement vector store to pass tests
   - Create database schema and VSS index setup (test-first)
   - Add basic CRUD operations for documents and chunks (test-first)
   - Implement connection management (test-first)
   - Initialize `meta` table; persist and validate `embedding_dim` and model name (test-first)

3. **Content Hashing** (TDD approach)
   - Write unit tests for `core/content/hasher.ts` first
   - Implement hashing utilities to pass tests
   - Add SHA-256 hashing for content and chunks (test-first)
   - Implement stable ID generation (test-first)

### Acceptance Criteria:

- [x] Can fetch HTML content from URLs
- [x] ETag-based caching works correctly
- [x] DuckDB database initializes with proper schema
- [x] Can store and retrieve document metadata
- [x] Content hashing produces consistent results

### Verification:

```bash
# Test content fetching
node -e "
const fetcher = require('./dist/core/content/httpContentFetcher');
fetcher.fetch('https://example.com').then(console.log);
"

# Verify database creation
ls ~/.local/share/mcp-search/db/mpc.duckdb
```

---

## Milestone 4: HTML Content Extraction

**Goal**: Implement robust HTML content extraction with fallback strategies.

### Tasks:

1. **HTML Content Extractor** (TDD approach)

   - Write unit tests for `core/content/htmlContentExtractor.ts` first
   - Implement extractor to pass tests
   - Integrate `@mozilla/readability` with JSDOM (test-first)
   - Add Cheerio fallback with content filtering (test-first)
   - Implement skeleton DOM detection (test-first)

2. **Content Chunking** (TDD approach)

   - Write unit tests for `core/content/chunker.ts` first
   - Implement chunker to pass tests
   - Add semantic HTML-aware chunking (test-first)
   - Implement token estimation and size limits (test-first)
   - Add overlap handling between chunks (test-first)

3. **Playwright Integration** (TDD approach)
   - Write unit tests for `services/playwrightWebScraper.ts` first
   - Implement scraper to pass tests
   - Add dynamic import for optional dependency (test-first)
   - Implement fallback trigger logic (test-first)
   - Ensure Playwright is only invoked when skeleton DOM heuristics are met (test-first)

### Acceptance Criteria:

- [x] Extracts clean text from news articles
- [x] Removes navigation, ads, and boilerplate content
- [x] Chunks content semantically by headings and sections
- [x] Playwright fallback works for JS-heavy sites
- [x] Token estimation is reasonably accurate

### Verification:

```bash
# Test extraction on various sites
node -e "
const extractor = require('./dist/core/content/htmlContentExtractor');
extractor.extract('<html>...test content...</html>').then(console.log);
"

# Test chunking
# Should produce semantically meaningful chunks with stable IDs
```

---

## Milestone 5: Embedding Integration

**Goal**: Implement HTTP embedding provider with batching and error handling.

### Tasks:

1. **HTTP Embedding Provider** (TDD approach)

   - Write unit tests for `core/vector/providers/httpEmbeddingProvider.ts` first
   - Implement provider to pass tests
   - Add OpenAI-compatible API integration (test-first)
   - Implement request batching (~32 texts per request) (test-first)
   - Add retry logic and error handling (test-first)
   - Validate provider returns consistent embedding dimension (test-first)

2. **Embedding Provider Interface** (TDD approach)

   - Write unit tests for `core/vector/embeddingProvider.ts` first
   - Define interface to pass tests
   - Add provider factory and configuration (test-first)
   - Implement graceful degradation on failures (test-first)

3. **Vector Storage Integration** (TDD approach)
   - Write unit tests for embedding integration first
   - Integrate embeddings with DuckDB VSS to pass tests
   - Implement similarity search queries (test-first)
   - Add embedding dimension validation (test-first)
   - Store `last_crawled`, `etag`, and `content_hash` in `documents` (test-first)

### Acceptance Criteria:

- [x] Can generate embeddings for text chunks
- [x] Batching reduces API calls efficiently
- [x] Graceful degradation when embedding service is down
- [x] Vector similarity search returns relevant results
- [x] Embedding dimensions are validated and consistent

### Verification:

```bash
# Test embedding generation
node -e "
const provider = require('./dist/core/vector/providers/httpEmbeddingProvider');
provider.embed(['test text', 'another text']).then(console.log);
"

# Test similarity search in DuckDB
# Should return cosine similarity scores
```

---

## Milestone 6: Complete web.readFromPage Implementation

**Goal**: Integrate all components into a working `web.readFromPage` tool.

### Tasks:

1. **Tool Integration** (TDD approach)

   - Write integration tests for `mcp/tools/readFromPage.ts` first
   - Complete tool implementation to pass tests
   - Integrate fetching, extraction, chunking, and embedding (test-first)
   - Implement caching and invalidation logic (test-first)
   - Add query processing and similarity search (test-first)
   - Apply `SIMILARITY_THRESHOLD` filtering to results (test-first)

2. **Caching Strategy** (TDD approach)

   - Write unit tests for caching logic first
   - Implement caching to pass tests
   - Add in-memory session cache (test-first)
   - Add persistent storage with ETag handling (test-first)
   - Implement `forceRefresh` functionality (test-first)
   - Add cache invalidation based on content changes (test-first)
   - Include `lastCrawled` in responses; honor `includeMetadata` flag (test-first)

3. **Error Handling & Degradation** (TDD approach)

   - Write unit tests for error scenarios first
   - Implement error handling to pass tests
   - Add comprehensive error classification (test-first)
   - Add graceful degradation paths (test-first)
   - Implement proper MCP error responses (test-first)
   - Add `note` field in responses when degrading (test-first)

4. **Concurrency & Backpressure** (TDD approach)
   - Implement global `CONCURRENCY` limiter utility with backpressure
   - Apply to network-bound tasks (fetch, search, embeddings) (test-first)
   - Batch embeddings under the concurrency cap (test-first)

### Acceptance Criteria:

- [x] Can fetch, process, and search content from URLs
- [x] Returns semantically relevant chunks for queries
- [x] Caching prevents unnecessary re-processing
- [x] `forceRefresh` bypasses cache correctly
- [x] Graceful degradation when services are unavailable
- [x] All error scenarios are handled properly

### Verification:

```bash
# Test complete workflow with MCP inspector
web.readFromPage({
  url: "https://example.com/article",
  query: "main topic",
  maxResults: 5
})

# Should return relevant text chunks with similarity scores
# Test caching by calling again - should be faster
# Test forceRefresh flag
```

---

## Milestone 7: Observability & Debugging

**Goal**: Add structured logging, request tracing, and debugging capabilities.

### Tasks:

1. **Structured Logging Enhancement** (TDD approach)
   
   - Write unit tests for correlation ID system first
   - Implement correlation IDs for all log entries to pass tests
   - Add request tracing through the entire pipeline (test-first)
   - Add performance timing logs for key operations (test-first)

2. **Debug Tooling** (TDD approach)

   - Write unit tests for CLI debug commands first  
   - Implement CLI commands for database inspection to pass tests
   - Add health check endpoints/commands (test-first)
   - Implement request replay capabilities (test-first)

3. **Metrics Hooks** (TDD approach)

   - Write unit tests for no-op metrics collector first
   - Implement metrics collector interface to pass tests
   - Add timing collection points throughout pipeline (test-first)
   - Add memory usage monitoring hooks (test-first)

### Acceptance Criteria:

- [ ] All requests can be traced end-to-end via correlation IDs
- [ ] CLI tools provide useful database inspection capabilities
- [ ] Performance metrics are collected at key pipeline points
- [ ] Memory usage can be monitored during operation
- [ ] Request replay works for debugging complex scenarios

### Verification:

```bash
# Test correlation ID tracing
mcp-search debug-server --trace-requests

# Test database inspection
mcp-search inspect-db --url "https://example.com"

# Verify metrics collection
# Should show timing data in structured logs
```

---

## Milestone 8: Comprehensive Testing & Quality

**Goal**: Achieve comprehensive test coverage and code quality standards.

### Tasks:

1. **Integration Testing**

   - End-to-end tests for both MCP tools
   - Mock external services (Google API, embedding API)
   - Test with real HTML fixtures

2. **Golden Tests**

   - Create deterministic test cases
   - Verify chunk ID stability
   - Test content extraction consistency

3. **Performance Testing**
   - Verify response time targets
   - Test with large content pages
   - Validate memory usage patterns

### Acceptance Criteria:

- [ ] All tests pass consistently
- [ ] Code coverage >90%
- [ ] Performance targets met (P50 < 300ms cached, < 3s first-time)
- [ ] No memory leaks in long-running tests
- [ ] Golden tests ensure deterministic behavior

### Verification:

```bash
npm run test:coverage
# Should show >90% coverage

npm run test:integration
# All integration tests pass

npm run test:performance
# Response times within targets
```

---

## Milestone 9: Production Readiness & Documentation

**Goal**: Prepare for production deployment with proper documentation and tooling.

### Tasks:

1. **CLI Tool**

   - Implement optional CLI for debugging
   - Add health check commands
   - Add database inspection utilities
   - Add development scripts to package.json:
     ```json
     {
       "scripts": {
         "test:watch": "jest --watch",
         "test:debug": "node --inspect-brk jest",
         "db:inspect": "mcp-search inspect-db",
         "mcp:debug": "mcp-search debug-server",
         "dev:with-inspector": "concurrently 'npm run build:watch' 'mcp-search server'"
       }
     }
     ```

2. **Docker Support**

   - Create optimized Dockerfile
   - Add docker-compose for development
   - Document container deployment

3. **Documentation**

   - Complete README with setup instructions
   - Add API documentation
   - Create troubleshooting guide
   - Document environment variables

4. **CI/CD Pipeline**
   - Complete GitHub Actions workflow
   - Add automated testing on multiple Node versions
   - Setup automated NPM publishing
   - Add security scanning

### Acceptance Criteria:

- [ ] CLI tool provides useful debugging capabilities
- [ ] Docker container runs successfully
- [ ] Documentation is complete and accurate
- [ ] CI/CD pipeline passes all checks
- [ ] Package can be installed and used from NPM

### Verification:

```bash
# Test NPM package installation
npm install -g mcp-search
mcp-search --help

# Test Docker deployment
docker build -t mcp-search .
docker run -p 3000:3000 mcp-search

# Verify MCP connection works in container
```

---

## Development Guidelines

### Test-Driven Development Workflow:

1. **Red**: Write a failing unit test for new functionality
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Clean up code while keeping tests green
4. **Verify**: Ensure MCP debugging tools still work
5. **Document**: Update documentation as needed

### Daily Development Workflow:

- Every new function/class starts with a unit test
- Refactor for clean code principles
- Manual verification using MCP inspector after each milestone
- Continuous refactoring with test safety net
- Performance testing with realistic data
- Update documentation as needed
- Verify MCP debugging tools still work

### Quality Gates:

- All tests must pass before milestone completion
- ESLint must pass without warnings
- TypeScript must compile without errors
- Manual verification steps must be completed

### Risk Mitigation:

- **External API Dependencies**: Mock all external services in tests
- **Vector Database**: Test with small datasets first, validate performance
- **Memory Usage**: Monitor memory consumption during development
- **MCP Compatibility**: Test with multiple MCP clients regularly

### Success Metrics:

- Response time targets met consistently
- Memory usage remains stable under load
- Error rates < 1% under normal conditions
- MCP debugging tools work seamlessly
- Code coverage maintained >90%

---

## Timeline Estimate

- **Milestone 1**: 3-4 days (MCP setup can be tricky)
- **Milestone 2**: 3-4 days
- **Milestone 3**: 4-5 days
- **Milestone 4**: 5-6 days
- **Milestone 5**: 6-7 days (embedding integration often has surprises)
- **Milestone 6**: 6-7 days
- **Milestone 7**: 3-4 days (new observability milestone)
- **Milestone 8**: 4-5 days
- **Milestone 9**: 3-4 days

_Note: Timeline includes TDD approach with unit tests written alongside implementation_

Each milestone includes buffer time for debugging, refinement, and unexpected issues. The plan prioritizes working software at each step with clear verification criteria. **Additional buffer**: 5-7 days total for integration issues and refactoring across all milestones.


More todo in future iterrations: 
 mcp.readFromPage can accept a chunkId from previous chunk result and do a search on all embeddings containing chunks created for this specific page.