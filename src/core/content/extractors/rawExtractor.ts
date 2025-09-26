import type { ExtractionResult, ExtractorOptions } from '../types/extraction';
import { ExtractionError } from '../../../mcp/errors';
import { createChildLogger, withTiming } from '../../../utils/logger';

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

      // Extract title FIRST, before any processing
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : undefined;

      logger.debug(
        {
          event: 'raw_title_extracted',
          hasTitle: !!title,
          title,
        },
        'Extracted title before processing'
      );

      // Create comprehensive regex patterns for all non-textual content removal
      const nonTextualRegexPatterns = [
        // Scripts and styles
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi,
        /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
        /<link[^>]*>/gi,

        // Multimedia elements
        /<img[^>]*>/gi,
        /<video\b[^<]*(?:(?!<\/video>)<[^<]*)*<\/video>/gi,
        /<audio\b[^<]*(?:(?!<\/audio>)<[^<]*)*<\/audio>/gi,
        /<iframe[^>]*(?:\/>|>[^<]*<\/iframe>)/gi,
        /<embed[^>]*>/gi,
        /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
        /<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi,
        /<canvas[^>]*(?:\/>|>[^<]*<\/canvas>)/gi,
        /<picture\b[^<]*(?:(?!<\/picture>)<[^<]*)*<\/picture>/gi,
        /<source[^>]*>/gi,
        /<track[^>]*>/gi,
        /<map\b[^<]*(?:(?!<\/map>)<[^<]*)*<\/map>/gi,
        /<area[^>]*>/gi,

        // Form elements
        /<input[^>]*>/gi,
        /<select\b[^<]*(?:(?!<\/select>)<[^<]*)*<\/select>/gi,
        /<option\b[^<]*(?:(?!<\/option>)<[^<]*)*<\/option>/gi,
        /<optgroup\b[^<]*(?:(?!<\/optgroup>)<[^<]*)*<\/optgroup>/gi,
        /<datalist\b[^<]*(?:(?!<\/datalist>)<[^<]*)*<\/datalist>/gi,
        /<output\b[^<]*(?:(?!<\/output>)<[^<]*)*<\/output>/gi,
        /<progress\b[^<]*(?:(?!<\/progress>)<[^<]*)*<\/progress>/gi,
        /<meter\b[^<]*(?:(?!<\/meter>)<[^<]*)*<\/meter>/gi,

        // Metadata elements (title extracted first)
        /<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi,
        /<meta[^>]*>/gi,
        /<base[^>]*>/gi,

        // Template and component elements
        /<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi,
        /<slot\b[^<]*(?:(?!<\/slot>)<[^<]*)*<\/slot>/gi,

        // Deprecated visual elements
        /<marquee\b[^<]*(?:(?!<\/marquee>)<[^<]*)*<\/marquee>/gi,
        /<frame[^>]*>/gi,
        /<frameset\b[^<]*(?:(?!<\/frameset>)<[^<]*)*<\/frameset>/gi,
        /<noframes\b[^<]*(?:(?!<\/noframes>)<[^<]*)*<\/noframes>/gi,
        /<blink\b[^<]*(?:(?!<\/blink>)<[^<]*)*<\/blink>/gi,
        /<center\b[^<]*(?:(?!<\/center>)<[^<]*)*<\/center>/gi,
        /<font[^>]*color[^>]*>.*?<\/font>/gi,
        /<font[^>]*size[^>]*>.*?<\/font>/gi,
      ];

      logger.debug(
        {
          event: 'raw_regex_cleanup',
          patternCount: nonTextualRegexPatterns.length,
        },
        'Applying comprehensive regex cleanup'
      );

      // Strip all non-textual content
      let cleanHtml = html;
      const initialLength = cleanHtml.length;

      nonTextualRegexPatterns.forEach(pattern => {
        cleanHtml = cleanHtml.replace(pattern, '');
      });

      const afterRegexLength = cleanHtml.length;

      // Strip all remaining HTML tags and normalize whitespace
      const textContent = cleanHtml
        .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      logger.debug(
        {
          event: 'raw_cleanup_complete',
          initialLength,
          afterRegexLength,
          finalLength: textContent.length,
          regexRemoved: initialLength - afterRegexLength,
          tagsRemoved: afterRegexLength - textContent.length,
        },
        'Completed raw text cleanup'
      );

      const result = {
        title,
        textContent,
        sectionPaths: [], // Raw extraction has no structural information
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
