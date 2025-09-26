export interface ExtractionResult {
  title?: string;
  textContent: string;
  excerpt?: string;
  sectionPaths: string[];
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
