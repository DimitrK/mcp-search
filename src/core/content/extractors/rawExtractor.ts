import type { ExtractionResult, ExtractorOptions } from '../types/extraction';
import { ExtractionError } from '../../../mcp/errors';
import { createChildLogger, withTiming } from '../../../utils/logger';
import { cleanHtmlToText } from './textCleaner';

export async function extractWithRaw(
  html: string,
  options: ExtractorOptions
): Promise<ExtractionResult> {
  const logger = createChildLogger(options.correlationId || 'unknown');

  return withTiming(logger, 'raw_extraction', async () => {
    try {
      logger.debug(
        {
          event: 'raw_processing',
          url: options.url,
          htmlLength: html.length,
        },
        'Starting raw text extraction (last resort)'
      );

      // Use shared text cleaning utility
      const cleaningResult = cleanHtmlToText(html, logger);

      // Text cleaning is now handled by the shared utility

      // Calculate word count safely (handle empty strings)
      const words = cleaningResult.cleanedText
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0);

      const result = {
        title: cleaningResult.title,
        textContent: cleaningResult.cleanedText,
        markdownContent: cleaningResult.cleanedText, // No HTML structure available, plain text only
        excerpt:
          cleaningResult.cleanedText.length > 300
            ? cleaningResult.cleanedText.substring(0, 300).trim() + '...'
            : cleaningResult.cleanedText || undefined,
        sectionPaths: [], // Raw extraction has no structural information
        semanticInfo: {
          headings: [],
          codeBlocks: [],
          lists: [],
          wordCount: words.length,
          characterCount: cleaningResult.cleanedText.length,
        },
        byline: undefined, // No byline detection in raw extraction
        lang: undefined, // No language detection in raw extraction
        extractionMethod: 'raw' as const,
        note: 'Content extraction severely degraded - raw text only, no HTML structure preserved',
      };

      logger.debug(
        {
          event: 'raw_success',
          hasTitle: !!result.title,
          contentLength: result.textContent.length,
          extractionQuality: 'severely_degraded',
        },
        'Raw text extraction completed (last resort)'
      );

      return result;
    } catch (error) {
      logger.error(
        {
          event: 'raw_error',
          error: error instanceof Error ? error.message : 'Unknown error',
          url: options.url,
        },
        'Raw text extraction failed - all methods exhausted'
      );

      throw new ExtractionError('All extraction methods failed', options.url);
    }
  });
}
