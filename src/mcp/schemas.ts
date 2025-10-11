import { z } from 'zod';

// web.search tool schemas
export const SearchInput = z.object({
  query: z
    .union([z.string(), z.array(z.string())])
    .describe(
      'Search query or array of queries to execute. Use specific, domain-relevant terms for better results. Single query as string, multiple queries as array for parallel batch processing to capture different perspectives (e.g., ["ZK rollup advantages", "zero-knowledge scaling benefits", "layer 2 blockchain pros"])'
    ),
  resultsPerQuery: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe('Number of search results to return per query (1-50, default: 5)'),
  minimal: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Return minimal result data structure (default: true). It is recommended to leave this option to true.'
    ),
  enableSimilaritySearch: z
    .boolean()
    .default(true)
    .optional()
    .describe(
      'Enable semantic similarity search on discovered pages to return relevant content chunks (default: true). When disabled, returns only Google search results without content extraction.'
    ),
});

export const RelevantChunk = z.object({
  id: z.string().describe('Unique identifier for this content chunk'),
  text: z.string().describe('The actual text content of the chunk'),
  score: z
    .number()
    .describe(
      'Similarity score between 0-1 indicating relevance to the search query (1.0 = perfect match)'
    ),
  sectionPath: z
    .array(z.string())
    .optional()
    .describe(
      'Hierarchical path showing where this content appears in the page structure (e.g., ["Introduction", "Getting Started"])'
    ),
});

export const InPageMatchingReferences = z.object({
  lastCrawled: z.string().describe('ISO timestamp when the page was last crawled'),
  relevantChunks: z.array(RelevantChunk).describe('Array of relevant content chunks from the page'),
});

// Google Search Result Schemas
export const GoogleSearchItemMinimal = z.object({
  title: z.string().describe('Title of the search result'),
  link: z.string().url().describe('URL of the search result'),
  displayLink: z.string().describe('Display domain of the search result'),
  snippet: z.string().describe('Text snippet from the search result'),
  formattedUrl: z.string().describe('Formatted URL of the search result'),
  inPageMatchingReferences: InPageMatchingReferences.optional().describe(
    'Semantic similarity search results from this page'
  ),
});

export const GoogleSearchItemFull = GoogleSearchItemMinimal.extend({
  kind: z.string().optional(),
  htmlTitle: z.string().optional(),
  htmlSnippet: z.string().optional(),
  pagemap: z.record(z.unknown()).optional(),
});

export const GoogleSearchResultMinimal = z.object({
  items: z.array(GoogleSearchItemMinimal).optional(),
});

export const GoogleSearchResultFull = z.object({
  kind: z.string().optional(),
  url: z
    .object({
      type: z.string().optional(),
      template: z.string().optional(),
    })
    .optional(),
  queries: z
    .object({
      request: z
        .array(
          z.object({
            title: z.string().optional(),
            totalResults: z.string().optional(),
            searchTerms: z.string().optional(),
            count: z.number().optional(),
            startIndex: z.number().optional(),
            inputEncoding: z.string().optional(),
            outputEncoding: z.string().optional(),
            safe: z.string().optional(),
            cx: z.string().optional(),
          })
        )
        .optional(),
      nextPage: z
        .array(
          z.object({
            title: z.string().optional(),
            totalResults: z.string().optional(),
            searchTerms: z.string().optional(),
            count: z.number().optional(),
            startIndex: z.number().optional(),
            inputEncoding: z.string().optional(),
            outputEncoding: z.string().optional(),
            safe: z.string().optional(),
            cx: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
  context: z
    .object({
      title: z.string().optional(),
    })
    .optional(),
  searchInformation: z
    .object({
      searchTime: z.number().optional(),
      formattedSearchTime: z.string().optional(),
      totalResults: z.string().optional(),
      formattedTotalResults: z.string().optional(),
    })
    .optional(),
  items: z.array(GoogleSearchItemFull).optional(),
});

export const SearchResultWithSimilarity = z.object({
  query: z.string(),
  result: z
    .union([GoogleSearchResultMinimal, GoogleSearchResultFull])
    .describe('Google search result with optional inPageMatchingReferences added to items'),
});

export const SearchOutput = z.object({
  queries: z.array(SearchResultWithSimilarity),
});

// web.readFromPage tool schemas
export const ReadFromPageInput = z.object({
  url: z.string().url().describe('The URL of the web page to extract and search content from'),
  query: z
    .union([z.string(), z.array(z.string())])
    .describe(
      'Search query or array of queries to find relevant content. Use specific, domain-relevant terms for best results (e.g., "ZK rollup advantages" instead of just "advantages"). Single query works for precise searches. Multiple queries as array dramatically improves results by combining semantic variations with specificity - use 2-4 related terms that include domain context (e.g., ["starknet pros and cons", "STRK benefits and risks", "ZK rollup advantages and disadvantages", "L2 blockchain challenges and solutions"]). This increases recall while maintaining precision through semantic similarity matching'
    ),
  forceRefresh: z
    .boolean()
    .default(false)
    .describe('Force re-fetch and re-process the page content, bypassing cache (default: false)'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(8)
    .describe('Maximum number of relevant content chunks to return per query (1-50, default: 8)'),
  includeMetadata: z
    .boolean()
    .default(false)
    .describe(
      'Include additional metadata like section paths and content statistics (default: false)'
    ),
});

export const ReadFromPageOutput = z.object({
  url: z.string().url().describe('The URL that was processed'),
  title: z.string().optional().describe('Title of the web page if available'),
  lastCrawled: z
    .string()
    .describe('ISO timestamp when the page was last successfully crawled and processed'),
  queries: z
    .array(
      z.object({
        query: z.string().describe('The search query that was executed'),
        results: z
          .array(RelevantChunk)
          .describe(
            'Array of relevant content chunks matching the query, ordered by relevance score'
          ),
      })
    )
    .describe('Array of query results, one per input query'),
  note: z
    .string()
    .optional()
    .describe('Optional note about any issues or limitations encountered during processing'),
});

// debug.echo tool schemas
export const DebugEchoInput = z.object({
  message: z
    .string()
    .min(1, 'Message is required')
    .describe('The message to echo back for debugging purposes'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Optional metadata object to include in the response'),
});

export const DebugEchoOutput = z.object({
  echo: z.unknown().describe('The input that was echoed back'),
  timestamp: z.string().describe('ISO timestamp when the echo was processed'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Optional metadata that was passed in the input'),
});

// Type exports
export type SearchInputType = z.infer<typeof SearchInput>;
export type SearchOutputType = z.infer<typeof SearchOutput>;
export type SearchResultWithSimilarityType = z.infer<typeof SearchResultWithSimilarity>;
export type GoogleSearchResultMinimalType = z.infer<typeof GoogleSearchResultMinimal>;
export type GoogleSearchResultFullType = z.infer<typeof GoogleSearchResultFull>;
export type GoogleSearchItemMinimalType = z.infer<typeof GoogleSearchItemMinimal>;
export type GoogleSearchItemFullType = z.infer<typeof GoogleSearchItemFull>;
export type InPageMatchingReferencesType = z.infer<typeof InPageMatchingReferences>;
export type ReadFromPageInputType = z.infer<typeof ReadFromPageInput>;
export type ReadFromPageOutputType = z.infer<typeof ReadFromPageOutput>;
export type RelevantChunkType = z.infer<typeof RelevantChunk>;
export type DebugEchoInputType = z.infer<typeof DebugEchoInput>;
export type DebugEchoOutputType = z.infer<typeof DebugEchoOutput>;
