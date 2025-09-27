import type pino from 'pino';

export interface TextCleaningResult {
  cleanedText: string;
  title?: string;
  removedByRegex: number;
  removedByTagStripping: number;
}

/**
 * Comprehensive text cleaning utility that removes CSS, scripts, and other non-textual content
 * This consolidates all the regex patterns from rawExtractor to avoid duplication
 */
export function cleanHtmlToText(html: string, logger?: pino.Logger): TextCleaningResult {
  // Extract title FIRST, before any processing
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  // CRITICAL: CSS filtering patterns - consolidated from rawExtractor
  const nonTextualRegexPatterns = [
    // CSS and style elements - MOST IMPORTANT for filtering CSS
    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gis,
    /<link[^>]*rel=["']stylesheet["'][^>]*>/gi,
    /<link[^>]*type=["']text\/css["'][^>]*>/gi,

    // Script and interactive elements
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis,
    /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gis,

    // Navigation and UI elements
    /<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gis,
    /<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gis,
    /<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gis,
    /<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gis,

    // Interactive and multimedia elements
    /<button\b[^<]*(?:(?!<\/button>)<[^<]*)*<\/button>/gis,
    /<input[^>]*>/gi,
    /<textarea\b[^<]*(?:(?!<\/textarea>)<[^<]*)*<\/textarea>/gis,
    /<select\b[^<]*(?:(?!<\/select>)<[^<]*)*<\/select>/gis,
    /<option\b[^<]*(?:(?!<\/option>)<[^<]*)*<\/option>/gis,
    /<video\b[^<]*(?:(?!<\/video>)<[^<]*)*<\/video>/gis,
    /<audio\b[^<]*(?:(?!<\/audio>)<[^<]*)*<\/audio>/gis,
    /<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gis,
    /<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gis,
    /<img[^>]*>/gi,
    /<picture\b[^<]*(?:(?!<\/picture>)<[^<]*)*<\/picture>/gis,
    /<source[^>]*>/gi,
    /<track[^>]*>/gi,
    /<embed[^>]*>/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gis,
    /<param[^>]*>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gis,

    // Form elements
    /<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gis,

    // Metadata elements (title extracted first)
    /<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gis,
    /<meta[^>]*>/gi,
    /<base[^>]*>/gi,

    // Template and component elements
    /<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gis,
    /<slot\b[^<]*(?:(?!<\/slot>)<[^<]*)*<\/slot>/gis,

    // Deprecated visual elements
    /<marquee\b[^<]*(?:(?!<\/marquee>)<[^<]*)*<\/marquee>/gis,
    /<frame[^>]*>/gi,
    /<frameset\b[^<]*(?:(?!<\/frameset>)<[^<]*)*<\/frameset>/gis,
    /<noframes\b[^<]*(?:(?!<\/noframes>)<[^<]*)*<\/noframes>/gis,
    /<blink\b[^<]*(?:(?!<\/blink>)<[^<]*)*<\/blink>/gis,
    /<center\b[^<]*(?:(?!<\/center>)<[^<]*)*<\/center>/gis,
    /<font[^>]*color[^>]*>.*?<\/font>/gis,
    /<font[^>]*size[^>]*>.*?<\/font>/gis,
  ];

  logger?.debug(
    {
      event: 'text_cleaning_start',
      patternCount: nonTextualRegexPatterns.length,
      initialLength: html.length,
    },
    'Starting comprehensive text cleaning'
  );

  // Strip all non-textual content
  let cleanHtml = html;
  const initialLength = cleanHtml.length;

  nonTextualRegexPatterns.forEach(pattern => {
    cleanHtml = cleanHtml.replace(pattern, ' '); // Replace with space to preserve word boundaries
  });

  const afterRegexLength = cleanHtml.length;
  const removedByRegex = initialLength - afterRegexLength;

  // Strip all remaining HTML tags and normalize whitespace
  const cleanedText = cleanHtml
    .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  const removedByTagStripping = afterRegexLength - cleanedText.length;

  logger?.debug(
    {
      event: 'text_cleaning_complete',
      initialLength,
      afterRegexLength,
      finalLength: cleanedText.length,
      removedByRegex,
      removedByTagStripping,
    },
    'Completed comprehensive text cleaning'
  );

  return {
    cleanedText,
    title,
    removedByRegex,
    removedByTagStripping,
  };
}

/**
 * Clean already extracted text content from CSS patterns that might have leaked through browser rendering
 * This handles cases where CSS was rendered as text content by the browser
 */
export function cleanRenderedCssFromText(text: string): string {
  return (
    text
      // Remove CSS rules that might have been rendered as text
      .replace(/:root\s*\{[^}]*\}/g, ' ') // CSS custom properties
      .replace(/\.[a-zA-Z][\w-]*\s*\{[^}]*\}/g, ' ') // CSS class selectors
      .replace(/#[a-zA-Z][\w-]*\s*\{[^}]*\}/g, ' ') // CSS ID selectors
      .replace(/[a-zA-Z][\w-]*\s*\{[^}]*\}/g, ' ') // CSS element selectors
      .replace(/@[a-zA-Z][\w-]*[^;]*;/g, ' ') // CSS at-rules
      .replace(/--[\w-]+\s*:\s*[^;}]+[;}]/g, ' ') // CSS custom properties
      .replace(/[\w-]+\s*:\s*[^;}]+[;}]/g, ' ') // CSS property declarations
      .replace(/display\s*:\s*[-\w]+/g, ' ') // Common CSS properties
      .replace(/margin\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/padding\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/width\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/height\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/color\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/background\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/font-[\w-]+\s*:\s*[^;}]+[;}]/g, ' ')
      .replace(/flex[^;}]*[;}]/g, ' ')
      .replace(/-ms-[\w-]+\s*:\s*[^;}]+[;}]/g, ' ') // Microsoft prefixes
      .replace(/-webkit-[\w-]+\s*:\s*[^;}]+[;}]/g, ' ') // Webkit prefixes
      .replace(/\s+/g, ' ')
      .trim()
  );
}
