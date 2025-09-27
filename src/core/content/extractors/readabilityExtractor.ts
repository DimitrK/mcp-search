import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ExtractionResult, ExtractorOptions } from '../types/extraction';
import { HEADING_SELECTORS, ALL_NON_TEXTUAL_SELECTORS } from './selectors';
import { createChildLogger, withTiming } from '../../../utils/logger';
import { markdownConverter } from './markdownConverter';

export async function extractWithReadability(
  html: string,
  options: ExtractorOptions
): Promise<ExtractionResult | null> {
  const logger = createChildLogger(options.correlationId || 'unknown');

  return withTiming(logger, 'readability_extraction', async () => {
    try {
      logger.debug({ event: 'readability_parsing', url: options.url }, 'Parsing HTML with JSDOM');

      // 1. Parse HTML with JSDOM and minimal preprocessing
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // 2. Extract metadata BEFORE any content removal
      const lang =
        document.documentElement.lang ||
        document.querySelector('html')?.getAttribute('lang') ||
        undefined;

      const originalTitle = document.querySelector('title')?.textContent?.trim();
      const sectionPaths = extractSectionPaths(document);

      logger.debug(
        {
          event: 'readability_preprocessing',
          originalTitle,
          language: lang,
          sectionCount: sectionPaths.length,
        },
        'Extracted metadata before processing'
      );

      // 3. Remove non-textual content including CSS (minimal sanitization)
      const beforeCleanup = document.body?.innerHTML.length || 0;
      removeMultimediaContent(document);
      const afterCleanup = document.body?.innerHTML.length || 0;

      logger.debug(
        {
          event: 'readability_cleanup',
          beforeCleanup,
          afterCleanup,
          removedBytes: beforeCleanup - afterCleanup,
        },
        'Removed non-textual content including CSS'
      );

      // 4. Configure and run Mozilla Readability with charThreshold=500
      logger.debug({ event: 'readability_processing' }, 'Running Mozilla Readability');

      const reader = new Readability(document, {
        charThreshold: 500, // Built-in skeleton detection
        classesToPreserve: ['caption', 'credits'],
      });

      const article = reader.parse();

      // 5. Return null if readability failed or content insufficient
      if (!article || !article.textContent || article.textContent.trim().length < 500) {
        logger.debug(
          {
            event: 'readability_insufficient',
            hasArticle: !!article,
            contentLength: article?.textContent?.trim().length || 0,
            threshold: 500,
          },
          'Readability extraction failed - insufficient content'
        );

        return null;
      }

      // Generate markdown from readability content
      const markdownContent = markdownConverter.convertToMarkdown(article.content || '');
      const semanticInfo = markdownConverter.extractSemanticInfo(markdownContent);

      const result = {
        title: article.title || originalTitle || undefined,
        textContent: article.textContent.trim(),
        markdownContent,
        excerpt: article.excerpt || undefined,
        sectionPaths,
        semanticInfo,
        byline: article.byline || undefined,
        lang,
        extractionMethod: 'readability' as const,
      };

      logger.debug(
        {
          event: 'readability_success',
          hasTitle: !!result.title,
          hasExcerpt: !!result.excerpt,
          hasByline: !!result.byline,
          contentLength: result.textContent.length,
          sectionCount: result.sectionPaths.length,
          charThreshold: 500,
        },
        'Readability extraction completed successfully'
      );

      return result;
    } catch (error) {
      logger.debug(
        {
          event: 'readability_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Readability extraction failed with error'
      );

      // If any error occurs during readability extraction, return null
      // This will trigger fallback to cheerio extraction
      return null;
    }
  });
}

function extractSectionPaths(document: Document): string[] {
  const sectionPaths: string[] = [];

  // Extract heading structure (h1-h6) from the original document
  // Note: After readability processing, headings might be modified
  const headings = document.querySelectorAll(HEADING_SELECTORS);

  headings.forEach(heading => {
    const text = heading.textContent?.trim();
    if (text && text.length > 0) {
      sectionPaths.push(text);
    }
  });

  // If no headings found, try to extract from article title as well
  if (sectionPaths.length === 0) {
    const title = document.querySelector('title')?.textContent?.trim();
    if (title) {
      sectionPaths.push(title);
    }
  }

  return sectionPaths;
}

function removeMultimediaContent(document: Document): void {
  // Remove all non-textual elements including CSS <style> tags and <link> stylesheets
  const nonTextualElements = document.querySelectorAll(ALL_NON_TEXTUAL_SELECTORS);
  nonTextualElements.forEach(element => element.remove());
}
