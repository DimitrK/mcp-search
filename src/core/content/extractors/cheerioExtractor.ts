import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ExtractionResult, ExtractorOptions } from '../types/extraction';
import {
  CONTENT_SELECTORS,
  HEADING_SELECTORS,
  NOISE_SELECTORS,
  PAGE_HEADER_SELECTORS,
  ALL_NON_TEXTUAL_SELECTORS,
} from './selectors';
import { createChildLogger, withTiming } from '../../../utils/logger';
import { markdownConverter } from './markdownConverter';

export async function extractWithCheerio(
  html: string,
  options: ExtractorOptions
): Promise<ExtractionResult> {
  const logger = createChildLogger(options.correlationId || 'unknown');

  return withTiming(logger, 'cheerio_extraction', async () => {
    logger.debug({ event: 'cheerio_parsing', url: options.url }, 'Parsing HTML with Cheerio');

    const $ = cheerio.load(html);

    // Extract language information
    const lang = $('html').attr('lang') || undefined;

    logger.debug(
      {
        event: 'cheerio_preprocessing',
        language: lang,
        initialElements: $('*').length,
      },
      'Extracted initial metadata'
    );

    // Remove non-textual content INCLUDING CSS
    const beforeMultimedia = $('*').length;
    removeMultimediaContent($);
    const afterMultimedia = $('*').length;

    logger.debug(
      {
        event: 'cheerio_multimedia_cleanup',
        beforeCount: beforeMultimedia,
        afterCount: afterMultimedia,
        removedElements: beforeMultimedia - afterMultimedia,
      },
      'Removed multimedia content including CSS'
    );

    // Remove noise elements
    const beforeNoise = $('*').length;
    removeNoiseElements($);
    const afterNoise = $('*').length;

    logger.debug(
      {
        event: 'cheerio_noise_cleanup',
        beforeCount: beforeNoise,
        afterCount: afterNoise,
        removedElements: beforeNoise - afterNoise,
      },
      'Removed noise elements'
    );

    // Target content in priority order
    let contentElement = findContentElement($);
    let contentSelector = 'semantic';

    // If no semantic content found, use body as fallback
    if (!contentElement || contentElement.length === 0) {
      contentElement = $('body');
      contentSelector = 'body_fallback';
    }

    logger.debug(
      {
        event: 'cheerio_content_targeting',
        contentSelector,
        contentElementsFound: contentElement ? contentElement.length : 0,
      },
      'Targeted content elements'
    );

    // Generate markdown from cleaned HTML (preserves semantic structure)
    const contentHtml = contentElement.html() || '';
    const markdownContent = markdownConverter.convertToMarkdown(contentHtml);
    const semanticInfo = markdownConverter.extractSemanticInfo(markdownContent);

    // Extract plain text for backward compatibility
    const rawText = contentElement.text();
    const textContent = rawText
      .replace(/([α-ωa-z0-9])([Α-ΩA-Z])/g, '$1 $2') // Any lowercase/digit followed by uppercase
      .replace(/\s+/g, ' ')
      .trim();

    // Extract section paths from headings (enhanced with semantic info)
    const sectionPaths = extractSectionPaths($, contentElement);

    const title = $('title').text().trim() || undefined;
    const excerpt = generateExcerpt(textContent);

    const result = {
      title,
      textContent,
      markdownContent,
      excerpt,
      sectionPaths,
      semanticInfo,
      byline: undefined, // Cheerio doesn't have sophisticated byline detection
      lang,
      extractionMethod: 'cheerio' as const,
    };

    logger.debug(
      {
        event: 'cheerio_success',
        hasTitle: !!result.title,
        hasExcerpt: !!result.excerpt,
        contentLength: result.textContent.length,
        markdownLength: result.markdownContent.length,
        sectionCount: result.sectionPaths.length,
        headingsCount: result.semanticInfo?.headings.length || 0,
        codeBlocksCount: result.semanticInfo?.codeBlocks.length || 0,
        listsCount: result.semanticInfo?.lists.length || 0,
        language: result.lang,
        contentSelector,
      },
      'Cheerio extraction completed successfully with markdown conversion'
    );

    return result;
  });
}

function removeMultimediaContent($: cheerio.CheerioAPI): void {
  // Remove all non-textual content including CSS <style> tags and <link> stylesheets
  $(ALL_NON_TEXTUAL_SELECTORS).remove();
}

function removeNoiseElements($: cheerio.CheerioAPI): void {
  $(NOISE_SELECTORS).remove();
  $(PAGE_HEADER_SELECTORS).remove();
}

function findContentElement($: cheerio.CheerioAPI): cheerio.Cheerio<AnyNode> {
  // Priority order for content selection
  const contentSelectors = CONTENT_SELECTORS.split(',').map((selector: string) => selector.trim());

  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      return element.first();
    }
  }

  // No semantic content found, will fallback to body
  return $();
}

function extractSectionPaths(
  $: cheerio.CheerioAPI,
  contentElement: cheerio.Cheerio<AnyNode>
): string[] {
  const sectionPaths: string[] = [];

  // Extract headings from the content area
  const headings = contentElement.find(HEADING_SELECTORS);

  headings.each((_, heading) => {
    const text = $(heading).text().trim();
    if (text && text.length > 0) {
      sectionPaths.push(text);
    }
  });

  // If no headings found in content area, check the entire document
  if (sectionPaths.length === 0) {
    $(HEADING_SELECTORS).each((_, heading) => {
      const text = $(heading).text().trim();
      if (text && text.length > 0) {
        sectionPaths.push(text);
      }
    });
  }

  return sectionPaths;
}

function generateExcerpt(textContent: string): string | undefined {
  if (!textContent || textContent.length === 0) {
    return undefined;
  }

  // Generate a simple excerpt from first 200 characters
  const excerpt = textContent.substring(0, 200).trim();
  return excerpt.length > 0 ? excerpt + (textContent.length > 200 ? '...' : '') : undefined;
}
