#!/usr/bin/env node
import { fetch } from 'undici';
import { extractContent } from '../dist/core/content/htmlContentExtractor.js';
import { generateCorrelationId } from '../dist/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

function parseArgs(args) {
  const options = {
    full: false,
    json: false,
    quiet: false,
  };

  for (const arg of args) {
    if (arg === '--full') options.full = true;
    if (arg === '--json') options.json = true;
    if (arg === '--quiet') options.quiet = true;
  }

  return options;
}

function printUsage() {
  console.error(`
Usage: node scripts/run-extract-content.mjs <URL> [OPTIONS]

Extract and display text content from a web page using the MCP content extraction pipeline.

Arguments:
  URL                    The URL to extract content from

Options:
  --full                 Show full extracted content (default: truncated preview)
  --json                 Output results as JSON
  --quiet                Show only basic extraction metrics
  --help                 Show this help message

Examples:
  node scripts/run-extract-content.mjs https://example.com
  node scripts/run-extract-content.mjs https://example.com --json
  node scripts/run-extract-content.mjs https://example.com --full
  node scripts/run-extract-content.mjs https://example.com --quiet
`);
}

function truncateText(text, maxLength = 500) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function printReport(url, result, showFull) {
  console.log('');
  console.log('='.repeat(80));
  console.log('CONTENT EXTRACTION REPORT');
  console.log('='.repeat(80));
  console.log('');
  console.log(`📍 URL: ${url}`);
  console.log(`⚡ Method: ${result.extractionMethod.toUpperCase()}`);
  console.log(`📰 Title: ${result.title || 'N/A'}`);
  console.log(`🌍 Language: ${result.lang || 'Not detected'}`);
  console.log(`📝 Excerpt: ${result.excerpt || 'N/A'}`);
  console.log(`👤 Byline: ${result.byline || 'N/A'}`);

  if (result.note) {
    console.log(`⚠️  Note: ${result.note}`);
  }

  console.log('');
  console.log('📊 METRICS:');
  console.log(`   Characters: ${result.textContent.length.toLocaleString()}`);
  console.log(
    `   Words: ${result.textContent
      .split(/\\s+/)
      .filter(w => w.length > 0)
      .length.toLocaleString()}`
  );
  console.log(`   Sections: ${result.sectionPaths.length}`);

  if (result.sectionPaths.length > 0) {
    console.log('');
    console.log('🗂️  SECTION PATHS:');
    result.sectionPaths.forEach((section, i) => {
      console.log(`   ${i + 1}. ${section}`);
    });
  }

  console.log('');
  console.log('📄 CONTENT:');
  console.log('-'.repeat(60));

  if (showFull) {
    console.log(result.textContent);
  } else {
    console.log(truncateText(result.textContent, 10000));
    if (result.textContent.length > 500) {
      console.log('');
      console.log(`[Content truncated - ${result.textContent.length - 500} more characters]`);
      console.log('Use --full flag to see complete content');
    }
  }

  console.log('-'.repeat(60));

  // Quality indicators
  console.log('');
  console.log('🎯 QUALITY INDICATORS:');
  console.log(
    `   Content Length: ${result.textContent.length >= 500 ? '✅ Good' : '⚠️  Short'} (${result.textContent.length} chars)`
  );
  console.log(`   Has Title: ${result.title ? '✅ Yes' : '❌ No'}`);
  console.log(
    `   Has Structure: ${result.sectionPaths.length > 0 ? '✅ Yes' : '❌ No'} (${result.sectionPaths.length} sections)`
  );
  console.log(`   Language Detected: ${result.lang ? '✅ Yes' : '❌ No'}`);
  console.log(`   Extraction Quality: ${getQualityRating(result)}`);

  console.log('');
}

function getQualityRating(result) {
  if (result.extractionMethod === 'readability') return '🟢 Excellent';
  if (result.extractionMethod === 'cheerio' && result.textContent.length > 200) return '🟡 Good';
  if (result.extractionMethod === 'browser') return '🔵 SPA Processed';
  if (result.extractionMethod === 'raw') return '🔴 Degraded';
  return '❓ Unknown';
}

async function main() {
  const url = process.argv[2];
  const options = parseArgs(process.argv.slice(3));

  if (!url || url === '--help') {
    printUsage();
    process.exit(url === '--help' ? 0 : 1);
  }

  const correlationId = generateCorrelationId();
  console.error(`[extract-content] Starting content extraction...`);
  console.error(`[extract-content] Fetching: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();
    console.error(`[extract-content] Fetched ${html.length} characters`);

    console.error(`[extract-content] Processing through extraction pipeline...`);
    const extractionResult = await extractContent(html, url, { correlationId });
    console.error(`[extract-content] Extraction completed successfully`);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            url,
            timestamp: new Date().toISOString(),
            result: extractionResult,
          },
          null,
          2
        )
      );
    } else if (options.quiet) {
      console.log(
        JSON.stringify(
          {
            method: extractionResult.extractionMethod,
            contentLength: extractionResult.textContent.length,
            sectionCount: extractionResult.sectionPaths.length,
            hasTitle: !!extractionResult.title,
            language: extractionResult.lang,
          },
          null,
          2
        )
      );
    } else {
      printReport(url, extractionResult, options.full);
    }
  } catch (error) {
    console.error(`[extract-content] Error: ${error.message}`);
    process.exit(1);
  }
  console.error(`[extract-content] Done`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});