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

3. **Create project structure**

   - Implement folder structure as per specification
   - Create placeholder files with basic exports
   - Setup environment variable validation

4. **Basic MCP server skeleton**
   - Implement minimal MCP server with `modelcontextprotocol`
   - Register empty tool stubs (`web.search`, `web.readFromPage`)
   - Add basic logging setup

### Acceptance Criteria:

- [ ] `npm run build` produces clean output in `dist/`
- [ ] `npm run lint` passes without errors
- [ ] `npm run test` runs (even with empty tests)
- [ ] MCP server starts without errors
- [ ] MCP debugging tools can connect to server
- [ ] Environment variables are validated on startup

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

- [ ] Single search query returns raw Google JSON
- [ ] Array of queries returns results for each query
- [ ] Rate limiting prevents API abuse
- [ ] Proper error handling for API failures
- [ ] All tests pass

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

2. **DuckDB Vector Store Setup** (TDD approach)
   - Write unit tests for `core/vector/store/duckdbVectorStore.ts` first
   - Implement vector store to pass tests
   - Create database schema and VSS index setup (test-first)
   - Add basic CRUD operations for documents and chunks (test-first)
   - Implement connection management (test-first)

3. **Content Hashing** (TDD approach)
   - Write unit tests for `core/content/hasher.ts` first
   - Implement hashing utilities to pass tests
   - Add SHA-256 hashing for content and chunks (test-first)
   - Implement stable ID generation (test-first)

### Acceptance Criteria:

- [ ] Can fetch HTML content from URLs
- [ ] ETag-based caching works correctly
- [ ] DuckDB database initializes with proper schema
- [ ] Can store and retrieve document metadata
- [ ] Content hashing produces consistent results

### Verification:

```bash
# Test content fetching
node -e "
const fetcher = require('./dist/core/content/httpContentFetcher');
fetcher.fetch('https://example.com').then(console.log);
"

# Verify database creation
ls ~/.local/share/mpc-search/db/mpc.duckdb
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

### Acceptance Criteria:

- [ ] Extracts clean text from news articles
- [ ] Removes navigation, ads, and boilerplate content
- [ ] Chunks content semantically by headings and sections
- [ ] Playwright fallback works for JS-heavy sites
- [ ] Token estimation is reasonably accurate

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

### Acceptance Criteria:

- [ ] Can generate embeddings for text chunks
- [ ] Batching reduces API calls efficiently
- [ ] Graceful degradation when embedding service is down
- [ ] Vector similarity search returns relevant results
- [ ] Embedding dimensions are validated and consistent

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

2. **Caching Strategy** (TDD approach)
   - Write unit tests for caching logic first
   - Implement caching to pass tests
   - Add in-memory session cache (test-first)
   - Add persistent storage with ETag handling (test-first)
   - Implement `forceRefresh` functionality (test-first)
   - Add cache invalidation based on content changes (test-first)

3. **Error Handling & Degradation** (TDD approach)
   - Write unit tests for error scenarios first
   - Implement error handling to pass tests
   - Add comprehensive error classification (test-first)
   - Add graceful degradation paths (test-first)
   - Implement proper MCP error responses (test-first)

### Acceptance Criteria:

- [ ] Can fetch, process, and search content from URLs
- [ ] Returns semantically relevant chunks for queries
- [ ] Caching prevents unnecessary re-processing
- [ ] `forceRefresh` bypasses cache correctly
- [ ] Graceful degradation when services are unavailable
- [ ] All error scenarios are handled properly

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

## Milestone 7: Comprehensive Testing & Quality

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

## Milestone 8: Production Readiness & Documentation

**Goal**: Prepare for production deployment with proper documentation and tooling.

### Tasks:

1. **CLI Tool**

   - Implement optional CLI for debugging
   - Add health check commands
   - Add database inspection utilities

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
npm install -g mpc-search
mpc-search --help

# Test Docker deployment
docker build -t mpc-search .
docker run -p 3000:3000 mpc-search

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

- **Milestone 1**: 2-3 days
- **Milestone 2**: 3-4 days
- **Milestone 3**: 4-5 days
- **Milestone 4**: 5-6 days
- **Milestone 5**: 4-5 days
- **Milestone 6**: 6-7 days
- **Milestone 7**: 4-5 days
- **Milestone 8**: 3-4 days

*Note: Timeline includes TDD approach with unit tests written alongside implementation*

Each milestone includes buffer time for debugging, refinement, and unexpected issues. The plan prioritizes working software at each step with clear verification criteria.
