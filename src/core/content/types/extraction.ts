import type { SemanticInfo } from '../extractors/markdownConverter';

export interface ExtractionResult {
  title?: string;
  textContent: string;
  markdownContent: string; // 🆕 Structured content for semantic chunking
  excerpt?: string;
  sectionPaths: string[];
  semanticInfo?: SemanticInfo; // 🆕 Extracted structure for advanced chunking
  byline?: string;
  lang?: string;
  extractionMethod: 'readability' | 'cheerio' | 'browser' | 'raw';
  note?: string;
}

export interface ReadabilityConfig {
  charThreshold: number;
  classesToPreserve: string[];
}

export interface ExtractorOptions {
  url: string;
  correlationId?: string;
}
