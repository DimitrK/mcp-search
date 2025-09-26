import { extractWithReadability } from './extractors/readabilityExtractor';
import { extractWithCheerio } from './extractors/cheerioExtractor';
import { extractWithSpa } from './extractors/spaExtractor';
import { extractWithRaw } from './extractors/rawExtractor';
import type { ExtractionResult, ExtractorOptions } from './types/extraction';
import { createChildLogger, generateCorrelationId, withTiming } from '../../utils/logger';

export async function extractContent(
  html: string,
  url: string,
  options?: { correlationId?: string }
): Promise<ExtractionResult> {
  const correlationId = options?.correlationId || generateCorrelationId();
  const logger = createChildLogger(correlationId);

  const extractorOptions: ExtractorOptions = { url, correlationId };

  const htmlLength = html.length;
  logger.info(
    {
      event: 'extraction_start',
      url,
      htmlLength,
      correlationId,
    },
    'Starting content extraction pipeline'
  );

  return withTiming(logger, 'content_extraction', async () => {
    try {
      // 1. Primary extraction: Try Mozilla Readability first
      logger.debug({ event: 'readability_attempt' }, 'Attempting readability extraction');
      const readabilityResult = await extractWithReadability(html, extractorOptions);

      if (readabilityResult) {
        logger.info(
          {
            event: 'extraction_success',
            method: 'readability',
            contentLength: readabilityResult.textContent.length,
            sectionCount: readabilityResult.sectionPaths.length,
            hasTitle: !!readabilityResult.title,
            hasExcerpt: !!readabilityResult.excerpt,
            language: readabilityResult.lang,
          },
          'Content extracted successfully with readability'
        );

        return readabilityResult;
      }

      logger.info(
        { event: 'readability_failed' },
        'Readability extraction failed, falling back to cheerio'
      );

      // 2. Fallback extraction: Use Cheerio when readability fails
      const cheerioResult = await extractWithCheerio(html, extractorOptions);

      // Check if Cheerio extracted meaningful content
      if (cheerioResult.textContent && cheerioResult.textContent.trim().length > 100) {
        logger.info(
          {
            event: 'extraction_success',
            method: 'cheerio',
            contentLength: cheerioResult.textContent.length,
            sectionCount: cheerioResult.sectionPaths.length,
            hasTitle: !!cheerioResult.title,
            language: cheerioResult.lang,
          },
          'Content extracted with cheerio fallback'
        );

        // Add note to indicate degraded extraction
        return {
          ...cheerioResult,
          note: 'Content extracted using fallback method due to insufficient structured content',
        };
      }

      logger.info(
        { event: 'cheerio_insufficient' },
        'Cheerio extracted minimal content, trying SPA extraction'
      );

      // 3. SPA fallback: Use Playwright for JavaScript-heavy pages
      try {
        const spaResult = await extractWithSpa(html, extractorOptions);

        logger.info(
          {
            event: 'extraction_success',
            method: 'browser',
            contentLength: spaResult.textContent.length,
            sectionCount: spaResult.sectionPaths.length,
            hasTitle: !!spaResult.title,
            language: spaResult.lang,
          },
          'Content extracted with SPA/browser method'
        );

        return {
          ...spaResult,
          note: 'Content extracted using browser rendering for JavaScript-heavy page',
        };
      } catch (spaError) {
        logger.warn(
          {
            event: 'spa_failed',
            error: spaError instanceof Error ? spaError.message : 'Unknown error',
          },
          'SPA extraction failed, using raw text extraction'
        );

        // 4. Last resort: Basic text extraction
        const rawResult = await extractWithRaw(html, extractorOptions);

        logger.info(
          {
            event: 'extraction_success',
            method: 'raw',
            contentLength: rawResult.textContent.length,
            hasTitle: !!rawResult.title,
          },
          'Content extracted with raw text method (severely degraded)'
        );

        return rawResult;
      }
    } catch (cheerioError) {
      logger.warn(
        {
          event: 'cheerio_failed',
          error: cheerioError instanceof Error ? cheerioError.message : 'Unknown error',
        },
        'Cheerio extraction failed, trying SPA extraction'
      );

      // 3. SPA fallback: Use Playwright for JavaScript-heavy pages
      try {
        const spaResult = await extractWithSpa(html, extractorOptions);

        logger.info(
          {
            event: 'extraction_success',
            method: 'browser',
            contentLength: spaResult.textContent.length,
            sectionCount: spaResult.sectionPaths.length,
            hasTitle: !!spaResult.title,
            language: spaResult.lang,
          },
          'Content extracted with SPA/browser method'
        );

        return {
          ...spaResult,
          note: 'Content extracted using browser rendering due to extraction failures',
        };
      } catch (spaError) {
        logger.warn(
          {
            event: 'spa_failed',
            error: spaError instanceof Error ? spaError.message : 'Unknown error',
          },
          'SPA extraction failed, using raw text extraction'
        );

        // 4. Last resort: Basic text extraction
        const rawResult = await extractWithRaw(html, extractorOptions);

        logger.info(
          {
            event: 'extraction_success',
            method: 'raw',
            contentLength: rawResult.textContent.length,
            hasTitle: !!rawResult.title,
          },
          'Content extracted with raw text method (severely degraded)'
        );

        return rawResult;
      }
    }
  });
}
