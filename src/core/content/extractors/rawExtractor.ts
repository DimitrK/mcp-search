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

      const result = {
        title: cleaningResult.title,
        textContent: cleaningResult.cleanedText,
        markdownContent: cleaningResult.cleanedText, // Raw has no structure, just plain text
        sectionPaths: [], // Raw extraction has no structural information
        semanticInfo: {
          headings: [],
          codeBlocks: [],
          lists: [],
          wordCount: cleaningResult.cleanedText.split(/\s+/).length,
          characterCount: cleaningResult.cleanedText.length,
        },
        extractionMethod: 'raw' as const,
        note: 'Content extraction severely degraded - raw text only',
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
