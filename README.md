# MCP Search

[![CI/CD Pipeline](https://github.com/DimitrK/mcp-search/actions/workflows/ci.yml/badge.svg)](https://github.com/DimitrK/mcp-search/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/DimitrK/mcp-search/branch/master/graph/badge.svg)](https://codecov.io/gh/dimitrK/mcp-search)
[![npm version](https://badge.fury.io/js/%40dimitrk%2Fmcp-search.svg)](https://badge.fury.io/js/%40dimitrk%2Fmcp-search)
[![Docker Pulls](https://img.shields.io/docker/pulls/dimitrisk/mcp-search)](https://hub.docker.com/r/dimitrisk/mcp-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **production-ready** Model Context Protocol (MCP) server for web search and semantic page content retrieval with local vector caching. Built for AI agents that need reliable, fast, and contextually relevant web information.

## ✨ Features

- 🔍 **Search Provider Adapters**: Google Custom Search, Brave Search, DuckDuckGo, or Tavily with normalized results
- 🧠 **Semantic Page Reading**: Extract and chunk content with embedding-based similarity search
- 💾 **Local Vector Caching**: DuckDB + VSS extension for persistent, fast retrieval
- 🛡️ **Production Security**: Input validation, content filtering, graceful degradation
- 📊 **Observability**: Structured logging, correlation IDs, performance metrics
- 🐳 **Container Ready**: Docker support with multi-platform builds
- ⚡ **High Performance**: P50 < 300ms cached, < 3s first-time extraction
- 🔧 **CLI Tools**: Health checks, database inspection, cleanup utilities

## 🚀 Quick Start

### Prerequisites

Follow this guide to create your Google Search API credentials: [Programmable Search Engine](https://developers.google.com/custom-search/v1/introduction).

### Installing MCP through NPM

[![Add MCP Server web-search to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-dark.svg)](https://lmstudio.ai/install-mcp?name=web-search&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBkaW1pdHJrL21jcC1zZWFyY2giXSwiZW52Ijp7IlNFQVJDSF9QUk9WSURFUiI6Imdvb2dsZSIsIlNFQVJDSF9FTkdJTkVfQVBJX0tFWSI6IltFTlRFUiBTRUFSQ0ggRU5HSU5FIEFQSSBLRVldIiwiR09PR0xFX1NFQVJDSF9FTkdJTkVfSUQiOiJbRU5URVIgR09PR0xFIFNFQVJDSCBFTkdJTkUgSURdIiwiRU1CRURESU5HX1NFUlZFUl9VUkwiOiJodHRwczovL2FwaS5vcGVuYWkuY29tIiwiRU1CRURESU5HX1NFUlZFUl9BUElfS0VZIjoiW1lPVVIgT1BFTiBBSSBLRVldIiwiRU1CRURESU5HX01PREVMX05BTUUiOiJ0ZXh0LWVtYmVkZGluZy0zLXNtYWxsIiwiU0lNSUxBUklUWV9USFJFU0hPTEQiOiIwLjcyIn19)

#### Install Playwright (optional - enables crawling SPAs)

The default `npx @dimitrk/mcp-search` setup runs without Playwright. To enable browser-backed SPA extraction in an npm-based MCP config, install the Chromium browser once and include Playwright in the same `npx` execution environment as the MCP package:

```bash
npx playwright@1.60.0 install --with-deps chromium
```

```json
{
  "command": "npx",
  "args": [
    "-y",
    "--package",
    "@dimitrk/mcp-search",
    "--package",
    "playwright@1.60.0",
    "mcp-search"
  ]
}
```

#### Install the MCP

```json
{
  "mcpServers": {
    "web-search": {
      "command": "npx",
      "args": ["-y", "@dimitrk/mcp-search"],
      "env": {
        "SEARCH_PROVIDER": "google",
        "SEARCH_ENGINE_API_KEY": "[ENTER SEARCH ENGINE API KEY]",
        "GOOGLE_SEARCH_ENGINE_ID": "[ENTER GOOGLE SEARCH ID]",
        "EMBEDDING_SERVER_URL": "https://api.openai.com",
        "EMBEDDING_SERVER_API_KEY": "[OPEN AI KEY]",
        "EMBEDDING_MODEL_NAME": "text-embedding-3-small",
        "SIMILARITY_THRESHOLD": "0.72"
      }
    }
  }
}
```

### Installing MCP through Docker

[![Add MCP Server web-search to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-dark.svg)](https://lmstudio.ai/install-mcp?name=web-search&config=eyJjb21tYW5kIjoiZG9ja2VyIiwiYXJncyI6WyJydW4iLCItaSIsIi0tcm0iLCItZSIsIlNFQVJDSF9QUk9WSURFUiIsIi1lIiwiU0VBUkNIX0VOR0lORV9BUElfS0VZIiwiLWUiLCJHT09HTEVfU0VBUkNIX0VOR0lORV9JRCIsIi1lIiwiRU1CRURESU5HX1NFUlZFUl9VUkwiLCItZSIsIkVNQkVERElOR19TRVJWRVJfQVBJX0tFWSIsIi1lIiwiRU1CRURESU5HX01PREVMX05BTUUiLCItZSIsIlNJTUlMQVJJVFlfVEhSRVNIT0xEIiwiLXYiLCJtY3BfZGF0YTovYXBwL2RhdGEiLCJkaW1pdHJpc2svbWNwLXNlYXJjaDpsYXRlc3QiXSwiZW52Ijp7IlNFQVJDSF9QUk9WSURFUiI6Imdvb2dsZSIsIlNFQVJDSF9FTkdJTkVfQVBJX0tFWSI6IltFTlRFUiBTRUFSQ0ggRU5HSU5FIEFQSSBLRVldIiwiR09PR0xFX1NFQVJDSF9FTkdJTkVfSUQiOiJbRU5URVIgR09PR0xFIFNFQVJDSCBFTkdJTkUgSURdIiwiRU1CRURESU5HX1NFUlZFUl9VUkwiOiJodHRwczovL2FwaS5vcGVuYWkuY29tIiwiRU1CRURESU5HX1NFUlZFUl9BUElfS0VZIjoiW1lPVVIgT1BFTiBBSSBLRVldIiwiRU1CRURESU5HX01PREVMX05BTUUiOiJ0ZXh0LWVtYmVkZGluZy0zLXNtYWxsIiwiU0lNSUxBUklUWV9USFJFU0hPTEQiOiIwLjcyIn19)

```json
{
  "mcpServers": {
    "web-search": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "SEARCH_PROVIDER",
        "-e",
        "SEARCH_ENGINE_API_KEY",
        "-e",
        "GOOGLE_SEARCH_ENGINE_ID",
        "-e",
        "EMBEDDING_SERVER_URL",
        "-e",
        "EMBEDDING_SERVER_API_KEY",
        "-e",
        "EMBEDDING_MODEL_NAME",
        "-e",
        "SIMILARITY_THRESHOLD",
        "-v",
        "mcp_data:/app/data",
        "dimitrisk/mcp-search:latest"
      ],
      "env": {
        "SEARCH_PROVIDER": "google",
        "SEARCH_ENGINE_API_KEY": "[ENTER SEARCH ENGINE API KEY]",
        "GOOGLE_SEARCH_ENGINE_ID": "[ENTER GOOGLE SEARCH ENGINE ID]",
        "EMBEDDING_SERVER_URL": "https://api.openai.com",
        "EMBEDDING_SERVER_API_KEY": "[YOUR OPEN AI KEY]",
        "EMBEDDING_MODEL_NAME": "text-embedding-3-small",
        "SIMILARITY_THRESHOLD": "0.72"
      }
    }
  }
}
```

## 🔧 Configuration

### Environment Variables Reference

| Variable                   | Required | Default         | Description                         |
| -------------------------- | -------- | --------------- | ----------------------------------- |
| `SEARCH_PROVIDER`          | ❌       | `google`        | Search provider adapter: `google`, `brave`, `duckduckgo`, or `tavily` |
| `SEARCH_ENGINE_API_KEY`    | ✅*      | -               | Search provider API key; required when `SEARCH_PROVIDER=google`, `SEARCH_PROVIDER=brave`, or `SEARCH_PROVIDER=tavily` |
| `GOOGLE_SEARCH_ENGINE_ID`  | ✅*      | -               | Google Custom Search Engine ID; required when `SEARCH_PROVIDER=google` |
| `EMBEDDING_SERVER_URL`     | ✅       | -               | OpenAI-compatible embedding API base URL; do not include `/v1` because the server appends `/v1/embeddings` |
| `EMBEDDING_SERVER_API_KEY` | ✅       | -               | API key for embedding service       |
| `EMBEDDING_MODEL_NAME`     | ✅       | -               | Model name for embeddings           |
| `DATA_DIR`                 | ❌       | OS app data dir | Data storage directory              |
| `SIMILARITY_THRESHOLD`     | ❌       | 0.6             | Minimum similarity score (0-1)      |
| `EMBEDDING_TOKENS_SIZE`    | ❌       | 512             | Chunk size in tokens                |
| `EMBEDDING_BATCH_SIZE`     | ❌       | 8               | Embedding texts per API request (1-32) |
| `REQUEST_TIMEOUT_MS`       | ❌       | 20000           | HTTP request timeout                |
| `CONCURRENCY`              | ❌       | 2               | Max concurrent requests             |
| `ENABLE_SIMILARITY_SEARCH` | ❌       | `true`          | Enable semantic enrichment for search results |
| `VECTOR_DB_MODE`           | ❌       | `inline`        | `inline`, `thread` or `process`     |
| `VECTOR_DB_RESTART_ON_CRASH` | ❌     | `false`         | Restart vector DB worker after worker crashes |

`duckduckgo` uses DuckDuckGo's instant answer API and does not require a provider API key.
Provider hints are adapter-specific: `timeRange` is sent to Google, Brave, and Tavily; `topic=news` is sent to Brave; Tavily supports `topic`, `searchDepth` (`basic`, `advanced`, `fast`, `ultra-fast`), and `timeRange`.

## Data Persistence & Storage

### How Embeddings Are Stored

MCP Search uses **DuckDB** with the **VSS (Vector Similarity Search)** extension to store embeddings locally. The database file is isolated per embedding model.

**Database File**: `{DATA_DIR}/db/mcp-{sanitized-model-name}.duckdb`

**What's Stored**:
- Document metadata (URL, title, last crawled timestamp, ETag)
- Text chunks with section paths and token counts
- Vector embeddings (dimension varies by model)
- Embedding configuration (model name, dimension)

### Storage Locations by Deployment Method

#### NPX Deployment

When using `npx @dimitrk/mcp-search`, the database is stored in your OS-specific application data directory:

| Operating System | Default Location |
|-----------------|------------------|
| **macOS** | `~/Library/Application Support/mcp-search/db/mcp-{model}.duckdb` |
| **Linux** | `~/.local/share/mcp-search/db/mcp-{model}.duckdb` |
| **Windows** | `%LOCALAPPDATA%\mcp-search\db\mcp-{model}.duckdb` |

**Custom Location**: Override with `DATA_DIR` environment variable:
```json
{
  "mcpServers": {
    "web-search": {
      "env": {
        "DATA_DIR": "/path/to/custom/location"
      }
    }
  }
}
```

**Persistence**: ✅ Data persists across runs and system restarts

#### Docker Deployment

**Container Path**: `/app/data/db/mcp-{model}.duckdb` (set via `ENV DATA_DIR=/app/data` in Dockerfile)

**⚠️ Important**: Without a volume mount, data is **lost when the container stops** (due to `--rm` flag).

**Recommended**: Use a **named volume** for persistence:

```json
{
  "args": [
    "run", "-i", "--rm",
    "-v", "mcp_data:/app/data",  // ← Named volume for persistence
    "mcp-search:latest"
  ]
}
```

**Volume Management**:
```bash
# List volumes
docker volume ls

# Inspect volume location
docker volume inspect mcp_data

# Backup volume
docker run --rm -v mcp_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/mcp-backup.tar.gz -C /data .

# Restore volume
docker run --rm -v mcp_data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/mcp-backup.tar.gz -C /data

# Delete volume (careful!)
docker volume rm mcp_data
```

**Alternative**: Use a **bind mount** for direct access:
```bash
docker run -i --rm \
  -v ./data:/app/data \  # Bind mount to local ./data directory
  mcp-search:latest
```
- ✅ Direct access to database file on host
- ✅ Easy backup (just copy `./data` directory)
- ⚠️ **Permissions**: Container runs as UID 1001, ensure directory is writable

### Database Size & Performance

**Typical Sizes** (varies by usage):
- Empty database: ~100 KB
- 10 pages cached: ~5-10 MB (depends on model dimension)
- 100 pages cached: ~50-100 MB
- 1000 pages cached: ~500 MB - 1 GB

**Performance Characteristics**:
- **Cached queries**: P50 < 300ms (reads from disk)
- **First-time extraction**: 2-5s (depends on page size and network)
- **Embedding generation**: Depends on external service (OpenAI: ~500ms for batch of 8)

### Maintenance & Cleanup

```bash
# Check database health and size
mcp-search health --verbose

# Inspect what's stored
mcp-search inspect --stats

# Clean old cached data (default: >30 days)
mcp-search cleanup --days 30

# Clean and optimize database
mcp-search cleanup --days 7 --vacuum

# Preview what would be deleted (dry run)
mcp-search cleanup --dry-run
```

### Configuration Changes & Migration

**Important**: Changing certain configuration options has significant impacts on your cached data:

#### ✅ Safe Changes (No Data Loss)

**`EMBEDDING_TOKENS_SIZE` (Chunk Size)**
- Changing from 512 → 1024 tokens is **safe**
- Existing chunks remain with original size
- New content uses new chunk size
- All chunks coexist and are searchable together

**`SIMILARITY_THRESHOLD`**
- Safe to change anytime
- Only affects which results are returned
- No impact on stored data

#### ⚠️ Destructive Changes (Data Loss)

**Embedding Provider or Model Change** (e.g., OpenAI -> Cohere)
- **Automatic isolation**: changing `EMBEDDING_MODEL_NAME` selects a different model-specific DB file.
- **Impact**: cached data for the previous model is preserved, but the new model starts with an empty cache.
- **Corruption guard**: if a model-specific DB somehow contains a different `embedding_model` value, startup fails with a model mismatch error rather than mixing embeddings.

**Embedding Dimension Change** (Different model with different dimension)
- **Automatic**: Chunks table is **dropped and recreated**
- **Impact**: All cached embeddings are **deleted** (documents table preserved)
- **What's Lost**: Vector embeddings only (must re-fetch and re-embed pages)
- **What's Kept**: Document metadata (URLs, titles, ETags, timestamps)
- **Log Message**: `Embedding dimension changed - recreating chunks table`

**Example Scenario**:
```bash
# Start with text-embedding-3-small (1536 dimensions)
EMBEDDING_MODEL_NAME=text-embedding-3-small

# Switch to text-embedding-3-large (3072 dimensions)
EMBEDDING_MODEL_NAME=text-embedding-3-large
# → Automatic: Drops chunks table, keeps documents
# → Next page fetch: Re-embeds content with new model
```

#### 📊 Migration Impact Summary

| Change | Model Check | Dimension Check | Data Impact |
|--------|-------------|-----------------|-------------|
| Chunk size (512→1024) | ✅ N/A | ✅ N/A | ✅ None - coexist |
| Same model, same dimension | ✅ Pass | ✅ Pass | ✅ None |
| Different model name | ✅ Uses another DB file | - | ✅ Previous model cache preserved |
| Same model, different dimension | ✅ Pass | ⚠️ **Auto-drop** | ⚠️ Embeddings deleted |
| Different model + dimension | ✅ Uses another DB file | - | ✅ Previous model cache preserved |

**Best Practice**: The server automatically creates separate database files for each embedding model (e.g., `mcp-text-embedding-3-small.duckdb`, `mcp-embed-english-v3-0.duckdb`). You can safely switch between models in the same `DATA_DIR`.

### Data Isolation & Multi-Tenancy

**Per-Model Database Isolation** (v0.1.4+):
- Each embedding model automatically gets its own database file within `DATA_DIR/db/`
- Database filename includes sanitized model name: `mcp-{model-name}.duckdb`
- Safe to switch between models without data loss or conflicts
- Different models can coexist in the same `DATA_DIR`

**Example Database Files**:
```
~/.local/share/mcp-search/db/
├── mcp-text-embedding-3-small.duckdb    # OpenAI model
├── mcp-text-embedding-3-large.duckdb    # OpenAI larger model
└── mcp-embed-english-v3-0.duckdb        # Cohere model
```

Each `DATA_DIR` can contain **multiple model databases**:
- No cross-contamination between models
- Dimension changes only affect that model's database
- Easy A/B testing by switching `EMBEDDING_MODEL_NAME`

**Example - Single Instance, Multiple Models**:
```bash
# Start with OpenAI model
EMBEDDING_MODEL_NAME=text-embedding-3-small npx @dimitrk/mcp-search

# Later switch to Cohere (both DBs coexist)
EMBEDDING_MODEL_NAME=embed-english-v3.0 npx @dimitrk/mcp-search
```

**Legacy Multi-Instance Pattern** (still supported):
If you prefer complete isolation, run separate instances with different `DATA_DIR` values:

```json
{
  "mcpServers": {
    "web-search-openai": {
      "command": "npx",
      "args": ["-y", "@dimitrk/mcp-search"],
      "env": {
        "DATA_DIR": "~/.mcp-search-openai",
        "EMBEDDING_MODEL_NAME": "text-embedding-3-small"
      }
    },
    "web-search-cohere": {
      "command": "npx",
      "args": ["-y", "@dimitrk/mcp-search"],
      "env": {
        "DATA_DIR": "~/.mcp-search-cohere",
        "EMBEDDING_MODEL_NAME": "embed-english-v3.0"
      }
    }
  }
}
```

## Using It As A Library

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
    resultsPerQuery: 5,
  },
});

// Multiple queries in parallel
const results = await client.callTool({
  name: 'web.search',
  arguments: {
    query: ['machine learning', 'neural networks', 'transformers'],
    resultsPerQuery: 3,
  },
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
    forceRefresh: false,
  },
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

### Performance Tuning

```bash
# High-performance setup
CONCURRENCY=8
EMBEDDING_TOKENS_SIZE=1024
SIMILARITY_THRESHOLD=0.7
REQUEST_TIMEOUT_MS=30000
VECTOR_DB_MODE=thread

# Memory-optimized setup
CONCURRENCY=1
EMBEDDING_TOKENS_SIZE=256
VECTOR_DB_MODE=inline

# Accuracy-focused setup
SIMILARITY_THRESHOLD=0.7
EMBEDDING_TOKENS_SIZE=512
```

## 🛠️ Development

### Prerequisites

- Node.js 22+ (CI tests Node 22 and 24)
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

### Environment Setup

Create `.env` file:

```bash
# Required
SEARCH_PROVIDER=google
SEARCH_ENGINE_API_KEY=your_search_engine_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
EMBEDDING_SERVER_URL=https://api.openai.com
EMBEDDING_SERVER_API_KEY=your_openai_api_key_here
EMBEDDING_MODEL_NAME=text-embedding-3-small  # Embedding model of your choice

# Optional (with defaults)
DATA_DIR=~/.mcp-search                   # Data storage location
SIMILARITY_THRESHOLD=0.6                 # Similarity cutoff (0-1)
EMBEDDING_TOKENS_SIZE=512               # Chunk size in tokens
REQUEST_TIMEOUT_MS=20000                # HTTP timeout
CONCURRENCY=2                           # Concurrent requests
```

Search provider examples:

```bash
# Google Custom Search (default)
SEARCH_PROVIDER=google
SEARCH_ENGINE_API_KEY=your_google_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here

# Brave Search
SEARCH_PROVIDER=brave
SEARCH_ENGINE_API_KEY=your_brave_search_api_key_here

# Tavily Search
SEARCH_PROVIDER=tavily
SEARCH_ENGINE_API_KEY=your_tavily_api_key_here

# DuckDuckGo instant answers
SEARCH_PROVIDER=duckduckgo
```

### Development Scripts

```bash
# Development
npm run dev                    # Start in development mode
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
│   MCP Client    │────│   MCP Server     │────│ Search Provider │
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
- **Search Provider Adapters**: Google, Brave, DuckDuckGo, and Tavily providers normalize API-specific payloads into a shared `items` shape; Google maps `timeRange` to `dateRestrict`, Brave maps `timeRange` to `freshness` and can filter `topic=news`, and Tavily maps top-level `results`
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
      test: ['CMD', 'node', 'dist/cli.js', 'health']
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
echo $SEARCH_ENGINE_API_KEY | wc -c  # Should be >30 characters for Google, Brave, or Tavily
```

#### Database Issues

```bash
# Check database status
mcp-search inspect --stats

# Reset database
mcp-search cleanup --days 0 --vacuum

# Manual database reset
rm ~/.mcp-search/db/mcp-*.duckdb
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
# Test configured search provider
# Google Custom Search
curl "https://www.googleapis.com/customsearch/v1?key=$SEARCH_ENGINE_API_KEY&cx=$GOOGLE_SEARCH_ENGINE_ID&q=test"

# Brave Search
curl -H "X-Subscription-Token: $SEARCH_ENGINE_API_KEY" \
  "https://api.search.brave.com/res/v1/web/search?q=test"

# Tavily Search
curl -X POST "https://api.tavily.com/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SEARCH_ENGINE_API_KEY" \
  -d '{"query":"test","topic":"general","search_depth":"basic"}'

# DuckDuckGo instant answers
curl "https://api.duckduckgo.com/?q=test&format=json&no_html=1&skip_disambig=1"

# Test embedding API
curl -X POST "$EMBEDDING_SERVER_URL/v1/embeddings" \
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
  query: string | string[]; // Search queries
  resultsPerQuery?: number; // 1-50, default 5; adapters cap to provider API limits
  minimal?: boolean; // Return compact normalized result fields, default true
  enableSimilaritySearch?: boolean; // Enrich top results with page chunks, default true
  topic?: 'general' | 'news' | 'finance'; // Provider hint; Tavily supports all values, Brave supports news filtering
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'; // Tavily-only provider hint
  timeRange?: 'day' | 'week' | 'month' | 'year'; // Supported by Google, Brave, and Tavily
}

interface SearchOutput {
  queries: Array<{
    query: string;
    result: unknown; // Normalized provider result with raw provider payload when available
  }>;
}
```

#### `web.readFromPage`

```typescript
interface ReadFromPageInput {
  url: string; // Target URL
  query?: string | string[]; // Optional. Omit to return all page chunks in document order
  forceRefresh?: boolean; // Skip cache, default false
  maxResults?: number; // 1-50, default 8. Ignored when query is omitted
  includeMetadata?: boolean; // Extra metadata, default false
}

interface ReadFromPageOutput {
  url: string;
  title?: string;
  lastCrawled: string;
  queries: Array<{
    query: string;
    results: Array<{
      id: string; // Stable chunk ID
      text: string; // Content text
      score?: number; // Similarity score 0-1; omitted when query is omitted
      sectionPath?: string[]; // Document structure
    }>;
  }>;
  note?: string; // Degradation notices
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
- **ESLint**: ESLint recommended, TypeScript recommended, Prettier integration, and local custom rules
- **Prettier**: Consistent formatting
- **Jest**: Coverage thresholds enforced in `jest.config.js`
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
