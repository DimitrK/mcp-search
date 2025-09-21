# MCP Search

A Model Context Protocol (MCP) server for web search and semantic page content retrieval with local caching.

## Features

- **Web Search**: Google Custom Search API integration with batch query support
- **Semantic Page Reading**: Extract and search content from web pages using embeddings
- **Local Caching**: DuckDB + VSS for persistent storage and fast retrieval
- **Debugging Tools**: Built-in debugging and inspection capabilities

## Installation

```bash
npm install mcp-search
```

Or install globally:

```bash
npm install -g mcp-search
```

## Environment Variables

### Required

```bash
GOOGLE_API_KEY=your_google_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
EMBEDDING_SERVER_URL=https://api.openai.com/v1
EMBEDDING_SERVER_API_KEY=your_openai_api_key
EMBEDDING_MODEL_NAME=text-embedding-ada-002
```

### Optional

```bash
DATA_DIR=/custom/data/directory          # Default: OS-specific app data dir
SIMILARITY_THRESHOLD=0.72                # Default: 0.72
EMBEDDING_TOKENS_SIZE=512               # Default: 512
REQUEST_TIMEOUT_MS=20000                # Default: 20000
CONCURRENCY=2                           # Default: 2
GOOGLE_SAFE_SEARCH=off                  # Default: off (off|moderate|strict)
```

## Usage

### As MCP Server

```bash
# Start the server (reads from stdin/writes to stdout)
mcp-search server

# Or using the default command
mcp-search
```

### With MCP Inspector (Development)

```bash
# Install MCP inspector globally
npm install -g @modelcontextprotocol/inspector

# Connect to the server for debugging
npx @modelcontextprotocol/inspector mcp-search
```

## Available Tools

### `web.search`

Search the web using Google Custom Search API.

```typescript
{
  query: string | string[],           // Single query or array of queries
  resultsPerQuery?: number,           // Results per query (1-50, default: 10)
}
```

### `web.readFromPage`

Extract and search content from a web page using semantic similarity.

```typescript
{
  url: string,                        // URL to read from
  query: string | string[],           // Search queries within the content
  forceRefresh?: boolean,            // Bypass cache (default: false)
  maxResults?: number,               // Max results per query (1-50, default: 8)
  includeMetadata?: boolean          // Include additional metadata (default: false)
}
```

### `debug.echo`

Echo back input for testing and debugging.

```typescript
{
  message: any,                      // Message to echo back
  metadata?: Record<string, any>     // Optional metadata
}
```

## Development

### Setup

```bash
git clone https://github.com/your-username/mcp-search.git
cd mcp-search
npm install
```

### Available Scripts

```bash
npm run dev          # Run in development mode
npm run build        # Build for production
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
npm run lint         # Run linting
npm run format       # Format code
```

### Project Structure

```
src/
├── server.ts                 # Main MCP server
├── cli.ts                    # CLI interface
├── config/
│   ├── environment.ts        # Environment validation
│   └── constants.ts          # Application constants
├── mcp/
│   ├── schemas.ts           # Zod validation schemas
│   ├── errors.ts            # MCP error classes
│   └── tools/               # Tool implementations (coming soon)
├── core/                    # Core business logic (coming soon)
└── utils/
    ├── logger.ts            # Structured logging
    └── dataDirectory.ts     # Data directory setup
```

## Current Status

🚧 **Milestone 1 Complete**: Project foundation and MCP server skeleton

- ✅ Project structure and tooling setup
- ✅ Environment validation
- ✅ Basic MCP server with tool registration
- ✅ Debug echo tool for pipeline testing

🔄 **Coming Next**: Google Search implementation (Milestone 2)

## License

MIT
