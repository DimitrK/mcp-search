# MCP Search

[![CI/CD Pipeline](https://github.com/DimitrK/mcp-search/actions/workflows/ci.yml/badge.svg)](https://github.com/DimitrK/mcp-search/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/DimitrK/mcp-search/branch/master/graph/badge.svg)](https://codecov.io/gh/dimitrK/mcp-search)
[![npm version](https://badge.fury.io/js/mcp-search.svg)](https://badge.fury.io/js/mcp-search)
[![Docker Pulls](https://img.shields.io/docker/pulls/DimitrK/mcp-search)](https://hub.docker.com/r/dimitrisk/mcp-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **production-ready** Model Context Protocol (MCP) server for web search and semantic page content retrieval with local vector caching. Built for AI agents that need reliable, fast, and contextually relevant web information.

## ✨ Features

- 🔍 **Google Custom Search**: Batch queries with rate limiting and error recovery
- 🧠 **Semantic Page Reading**: Extract and chunk content with embedding-based similarity search  
- 💾 **Local Vector Caching**: DuckDB + VSS extension for persistent, fast retrieval
- 🛡️ **Production Security**: Input validation, content filtering, graceful degradation
- 📊 **Observability**: Structured logging, correlation IDs, performance metrics
- 🐳 **Container Ready**: Docker support with multi-platform builds
- ⚡ **High Performance**: P50 < 300ms cached, < 3s first-time extraction
- 🔧 **CLI Tools**: Health checks, database inspection, cleanup utilities

## 🚀 Quick Start

### NPM Installation

```bash
# Global installation (recommended for CLI usage)
npm install -g mcp-search

# Or local installation
npm install mcp-search

# Additionally install Playwright with chromium browser. This is a peer dependency that allows the mcp to crawl SPAs
npx playwright install --with-deps chromium
```

### Docker Installation

```bash
# Pull and run
docker pull dimitrisk/mcp-search:latest
docker run -d --name mcp-search \
  -e GOOGLE_API_KEY=your_key \
  -e GOOGLE_SEARCH_ENGINE_ID=your_engine_id \
  -e EMBEDDING_SERVER_URL=https://api.openai.com/v1 \
  -e EMBEDDING_SERVER_API_KEY=your_openai_key \
  -e EMBEDDING_MODEL_NAME=text-embedding-3-small \
  -v mcp_data:/app/data \
  dimitrisk/mcp-search:latest

# Or use docker-compose
curl -o docker-compose.yml https://raw.githubusercontent.com/dimitrk/mcp-search/main/docker-compose.yml
docker-compose up -d
```

### Environment Setup

Create `.env` file:

```bash
# Required
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
EMBEDDING_SERVER_URL=https://api.openai.com/v1
EMBEDDING_SERVER_API_KEY=your_openai_api_key_here
EMBEDDING_MODEL_NAME=text-embedding-3-small

# Optional (with defaults)
DATA_DIR=~/.mcp-search                   # Data storage location
SIMILARITY_THRESHOLD=0.6                 # Similarity cutoff (0-1)
EMBEDDING_TOKENS_SIZE=512               # Chunk size in tokens
REQUEST_TIMEOUT_MS=20000                # HTTP timeout
CONCURRENCY=2                           # Concurrent requests
```

## 📖 Usage

### Command Line Interface

```bash
# Start MCP server
mcp-search server

# Health check
mcp-search health --verbose

# Database inspection
mcp-search inspect --stats
mcp-search inspect --url "https://example.com"

# Cleanup old data
mcp-search cleanup --days 30 --vacuum
```

### MCP Client Integration

Connect to the MCP server from any MCP-compatible client:

```bash
# Using MCP Inspector for debugging
npx @modelcontextprotocol/inspector mcp-search

# Programmatic usage (Node.js)
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const client = new Client({
  name: 'mcp-search-client',
  version: '1.0.0'
});
```

### Tool Usage Examples

#### Web Search
```typescript
// Single query
const result = await client.callTool({
  name: 'web.search',
  arguments: {
    query: 'latest AI developments',
    resultsPerQuery: 5
  }
});

// Multiple queries in parallel
const results = await client.callTool({
  name: 'web.search', 
  arguments: {
    query: ['machine learning', 'neural networks', 'transformers'],
    resultsPerQuery: 3
  }
});
```

#### Semantic Page Reading
```typescript
// Extract and search page content
const pageResults = await client.callTool({
  name: 'web.readFromPage',
  arguments: {
    url: 'https://example.com/article',
    query: ['main findings', 'methodology', 'conclusions'],
    maxResults: 8,
    forceRefresh: false
  }
});

// Returns semantically relevant text chunks with similarity scores
console.log(pageResults.queries[0].results[0]);
// {
//   id: 'chunk-abc123',
//   text: 'Relevant content excerpt...',
//   score: 0.87,
//   sectionPath: ['Introduction', 'Key Findings']
// }
```

## 🔧 Configuration

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_API_KEY` | ✅ | - | Google Custom Search API key |
| `GOOGLE_SEARCH_ENGINE_ID` | ✅ | - | Google Custom Search Engine ID |
| `EMBEDDING_SERVER_URL` | ✅ | - | OpenAI-compatible embedding API URL |
| `EMBEDDING_SERVER_API_KEY` | ✅ | - | API key for embedding service |
| `EMBEDDING_MODEL_NAME` | ✅ | - | Model name for embeddings |
| `DATA_DIR` | ❌ | OS app data dir | Data storage directory |
| `SIMILARITY_THRESHOLD` | ❌ | 0.6 | Minimum similarity score (0-1) |
| `EMBEDDING_TOKENS_SIZE` | ❌ | 512 | Chunk size in tokens |
| `REQUEST_TIMEOUT_MS` | ❌ | 20000 | HTTP request timeout |
| `CONCURRENCY` | ❌ | 2 | Max concurrent requests |

### Performance Tuning

```bash
# High-performance setup
CONCURRENCY=8
EMBEDDING_TOKENS_SIZE=1024
SIMILARITY_THRESHOLD=0.7
REQUEST_TIMEOUT_MS=30000

# Memory-optimized setup  
CONCURRENCY=1
EMBEDDING_TOKENS_SIZE=256
VECTOR_DB_MODE=inline

# Accuracy-focused setup
SIMILARITY_THRESHOLD=0.5
EMBEDDING_TOKENS_SIZE=512
```

## 🛠️ Development

### Prerequisites

- Node.js 20+ (22+ recommended)
- npm 9+ 
- Docker (optional, for containerized development)
- Git

### Setup

```bash
# Clone repository
git clone https://github.com/dimitrk/mcp-search.git
cd mcp-search

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Build project
npm run build

# Run health check
npm run health
```

### Development Scripts

```bash
# Development
npm run dev                    # Start in development mode
npm run dev:mock              # Use mock APIs for testing
npm run build:watch          # Watch mode build

# Testing
npm test                      # Run all tests
npm run test:unit            # Unit tests only  
npm run test:integration     # Integration tests only
npm run test:coverage        # Coverage report
npm run test:performance     # Performance benchmarks

# Quality
npm run lint                 # ESLint check
npm run lint:fix             # Auto-fix linting issues
npm run format               # Prettier formatting
npm run typecheck            # TypeScript validation

# Database
npm run db:inspect           # Inspect database contents
npm run cleanup              # Clean old data

# Production
npm start                    # Production server
npm run health:verbose       # Detailed health check
```

### Testing

```bash
# Run specific test suites
npm run test:unit -- --testNamePattern="chunker"
npm run test:integration -- --testNamePattern="readFromPage"

# Debug tests
npm run test:debug

# Performance benchmarks
npm run test:performance -- --verbose
```

## 📊 Architecture

### System Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │────│   MCP Server     │────│  Google Search  │
│   (AI Agent)    │    │                  │    │      API        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                │
                    ┌──────────────────┐    ┌─────────────────┐
                    │  Content         │────│  Embedding      │
                    │  Extraction      │    │     API         │
                    └──────────────────┘    └─────────────────┘
                                │
                                │
                    ┌──────────────────┐    ┌─────────────────┐
                    │    DuckDB        │    │   Vector        │  
                    │   Database       │────│   Search        │
                    └──────────────────┘    └─────────────────┘
```

### Data Flow

1. **Search Request**: Client sends MCP tool call
2. **Content Fetching**: HTTP client retrieves web content  
3. **Content Extraction**: Multi-stage extraction (Readability → Cheerio → SPA)
4. **Semantic Chunking**: Intelligent content segmentation
5. **Embedding Generation**: Vector representations via API
6. **Vector Storage**: DuckDB + VSS for persistence
7. **Similarity Search**: Semantic matching for queries
8. **Response**: Ranked, relevant content chunks

### Key Components

- **MCP Server**: Protocol-compliant tool server
- **HTTP Fetcher**: Robust content retrieval with retries
- **Content Extractors**: Multi-strategy HTML processing
- **Semantic Chunker**: Token-aware content segmentation  
- **Vector Store**: DuckDB with VSS extension
- **Embedding Service**: OpenAI-compatible API integration

## 🐳 Docker Deployment

### Basic Deployment

```bash
# Pull image
docker pull dimitrisk/mcp-search:latest

# Run container
docker run -d \
  --name mcp-search \
  --env-file .env \
  -v mcp_data:/app/data \
  -p 3000:3000 \
  dimitrisk/mcp-search:latest
```

### Docker Compose (Recommended)

```yaml
# docker-compose.yml
version: '3.8'

services:
  mcp-search:
    image: dimitrisk/mcp-search:latest
    container_name: mcp-search
    restart: unless-stopped
    env_file: .env
    volumes:
      - mcp_data:/app/data
    healthcheck:
      test: ["CMD", "node", "dist/cli.js", "health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  mcp_data:
```

### Production Deployment

```bash
# Use production compose file
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Monitor logs
docker-compose logs -f mcp-search

# Health check
docker-compose exec mcp-search node dist/cli.js health --verbose
```

## 🔍 Troubleshooting

### Common Issues

#### Environment Variables Missing
```bash
# Check current environment
mcp-search health --verbose

# Validate specific variables
echo $GOOGLE_API_KEY | wc -c  # Should be >30 characters
```

#### Database Issues
```bash
# Check database status
mcp-search inspect --stats

# Reset database
mcp-search cleanup --days 0 --vacuum

# Manual database reset
rm ~/.mcp-search/db/mpc.duckdb
```

#### Performance Issues
```bash
# Check system resources
mcp-search health --verbose

# Reduce concurrency
export CONCURRENCY=1

# Increase timeouts
export REQUEST_TIMEOUT_MS=30000
```

#### Network/API Issues
```bash
# Test Google API
curl "https://www.googleapis.com/customsearch/v1?key=$GOOGLE_API_KEY&cx=$GOOGLE_SEARCH_ENGINE_ID&q=test"

# Test embedding API  
curl -X POST "$EMBEDDING_SERVER_URL/embeddings" \
  -H "Authorization: Bearer $EMBEDDING_SERVER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "'$EMBEDDING_MODEL_NAME'", "input": "test"}'
```

### Debug Mode

```bash
# Enable verbose logging
DEBUG=mcp-search:* mcp-search server

# Use development configuration
NODE_ENV=development mcp-search server

# Run with MCP inspector
npx @modelcontextprotocol/inspector mcp-search
```

### Getting Help

- 📚 [Documentation](https://github.com/dimitrk/mcp-search/wiki)
- 🐛 [Issue Tracker](https://github.com/dimitrk/mcp-search/issues)
- 💬 [Discussions](https://github.com/dimitrk/mcp-search/discussions)
- 🔗 [MCP Specification](https://github.com/modelcontextprotocol/specification)

## 🔧 API Reference

### Tool Schemas

#### `web.search`
```typescript
interface SearchInput {
  query: string | string[];        // Search queries
  resultsPerQuery?: number;        // 1-50, default 5
}

interface SearchOutput {
  queries: Array<{
    query: string;
    result: unknown;               // Raw Google JSON
  }>;
}
```

#### `web.readFromPage`  
```typescript
interface ReadFromPageInput {
  url: string;                     // Target URL
  query: string | string[];        // Search queries
  forceRefresh?: boolean;         // Skip cache, default false
  maxResults?: number;            // 1-50, default 8  
  includeMetadata?: boolean;      // Extra metadata, default false
}

interface ReadFromPageOutput {
  url: string;
  title?: string;
  lastCrawled: string;
  queries: Array<{
    query: string;
    results: Array<{
      id: string;                  // Stable chunk ID
      text: string;               // Content text  
      score: number;              // Similarity score 0-1
      sectionPath?: string[];     // Document structure
    }>;
  }>;
  note?: string;                  // Degradation notices
}
```

## 🏗️ Contributing

### Development Workflow

1. **Fork & Clone**: Fork the repository and clone locally
2. **Branch**: Create feature branch (`git checkout -b feature/amazing-feature`)
3. **Develop**: Write code following our standards
4. **Test**: Ensure all tests pass (`npm test`)
5. **Commit**: Use conventional commits (`git commit -m 'feat: add amazing feature'`)
6. **Push**: Push to your fork (`git push origin feature/amazing-feature`)
7. **PR**: Open a Pull Request with detailed description

### Code Standards

- **TypeScript**: Strict mode, explicit types
- **ESLint**: Airbnb config with custom rules
- **Prettier**: Consistent formatting
- **Jest**: >90% test coverage requirement
- **Conventional Commits**: For changelog generation

### Release Process

```bash
# Version bump (patch/minor/major)
npm version patch

# Push tags  
git push origin --tags

# GitHub Actions will:
# 1. Run full test suite
# 2. Security scan
# 3. Build Docker images  
# 4. Publish to NPM
# 5. Create GitHub release
```

## 📋 Roadmap

- [ ] **v1.1**: PDF and document parsing support
- [ ] **v1.2**: Local embedding models (node-llama-cpp)
- [ ] **v1.3**: Advanced chunking strategies (code, tables)
- [ ] **v1.4**: Vector database alternatives (Qdrant, Weaviate)
- [ ] **v1.5**: Robots.txt compliance toggle
- [ ] **v2.0**: GraphQL schema introspection tool

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Model Context Protocol](https://github.com/modelcontextprotocol/specification) - Protocol specification
- [DuckDB](https://duckdb.org/) - In-process analytical database  
- [VSS Extension](https://github.com/duckdb/duckdb_vss) - Vector similarity search
- [Mozilla Readability](https://github.com/mozilla/readability) - Content extraction
- [Playwright](https://playwright.dev/) - Browser automation

---

**Built with ❤️ for the AI agent ecosystem**
