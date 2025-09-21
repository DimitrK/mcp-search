import { z } from 'zod';

// web.search tool schemas
export const SearchInput = z.object({
  query: z.union([z.string(), z.array(z.string())]),
  resultsPerQuery: z.number().int().min(1).max(50).default(5),
  minimal: z.boolean().default(true).optional(),
});

export const SearchOutput = z.object({
  queries: z.array(
    z.object({
      query: z.string(),
      result: z.unknown(), // raw Google JSON for that query
    })
  ),
});

// web.readFromPage tool schemas
export const ReadFromPageInput = z.object({
  url: z.string().url(),
  query: z.union([z.string(), z.array(z.string())]),
  forceRefresh: z.boolean().default(false).optional(),
  maxResults: z.number().int().min(1).max(50).default(8).optional(),
  includeMetadata: z.boolean().default(false).optional(),
});

export const RelevantChunk = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number(),
  sectionPath: z.array(z.string()).optional(),
});

export const ReadFromPageOutput = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  lastCrawled: z.string(),
  queries: z.array(
    z.object({
      query: z.string(),
      results: z.array(RelevantChunk),
    })
  ),
  note: z.string().optional(),
});

// debug.echo tool schemas
export const DebugEchoInput = z.object({
  message: z.string().min(1, 'Message is required'),
  metadata: z.record(z.unknown()).optional(),
});

export const DebugEchoOutput = z.object({
  echo: z.unknown(),
  timestamp: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

// Type exports
export type SearchInputType = z.infer<typeof SearchInput>;
export type SearchOutputType = z.infer<typeof SearchOutput>;
export type ReadFromPageInputType = z.infer<typeof ReadFromPageInput>;
export type ReadFromPageOutputType = z.infer<typeof ReadFromPageOutput>;
export type RelevantChunkType = z.infer<typeof RelevantChunk>;
export type DebugEchoInputType = z.infer<typeof DebugEchoInput>;
export type DebugEchoOutputType = z.infer<typeof DebugEchoOutput>;
