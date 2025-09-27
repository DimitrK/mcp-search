#!/usr/bin/env node
import { extractContent } from '../dist/core/content/htmlContentExtractor.js';
import { semanticChunker } from '../dist/core/content/chunker.js';
import { fetchUrl } from '../dist/core/content/httpContentFetcher.js';
import { generateCorrelationId } from '../dist/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

function parseArgs(args) {
  const options = {
    full: false,
    json: false,
    quiet: false,
    chunk: false,
    maxTokens: undefined,
    overlapPercentage: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full') options.full = true;
    if (arg === '--json') options.json = true;
    if (arg === '--quiet') options.quiet = true;
    if (arg === '--chunk') options.chunk = true;
    if (arg === '--max-tokens') {
      options.maxTokens = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
    if (arg === '--overlap') {
      options.overlapPercentage = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
  }

  return options;
}

function printUsage() {
  console.error(`
Usage: node scripts/run-extract-content.mjs <URL> [OPTIONS]

Extract and display text content from a web page using the MCP content extraction pipeline.
Optionally chunk the content for semantic analysis.

Arguments:
  URL                    The URL to extract content from

Options:
  --full                 Show full extracted content (default: truncated preview)
  --json                 Output results as JSON
  --quiet                Show only basic extraction metrics
  --chunk                Enable content chunking analysis
  --max-tokens NUM       Maximum tokens per chunk (default: from environment)
  --overlap NUM          Overlap percentage between chunks (default: 15)
  --help                 Show this help message

Examples:
  node scripts/run-extract-content.mjs https://example.com
  node scripts/run-extract-content.mjs https://example.com --chunk
  node scripts/run-extract-content.mjs https://example.com --chunk --max-tokens 100 --overlap 20
  node scripts/run-extract-content.mjs https://example.com --json --chunk
  node scripts/run-extract-content.mjs https://example.com --full --chunk
`);
}

function truncateText(text, maxLength = 500) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function printReport(url, result, showFull) {
  console.log('');
  console.log('='.repeat(80));
  console.log('📄 CONTENT EXTRACTION REPORT');
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
  console.log(`   Text Length: ${result.textContent.length.toLocaleString()} chars`);
  console.log(
    `   Markdown Length: ${(result.markdownContent || '').length.toLocaleString()} chars`
  );
  console.log(
    `   Words: ${result.textContent
      .split(/\\s+/)
      .filter(w => w.length > 0)
      .length.toLocaleString()}`
  );
  console.log(`   Sections: ${result.sectionPaths.length}`);

  if (result.semanticInfo) {
    console.log('');
    console.log('🔍 SEMANTIC ANALYSIS:');
    console.log(`   Headings: ${result.semanticInfo.headings?.length || 0}`);
    console.log(`   Code Blocks: ${result.semanticInfo.codeBlocks?.length || 0}`);
    console.log(`   Lists: ${result.semanticInfo.lists?.length || 0}`);
    console.log(`   Word Count: ${result.semanticInfo.wordCount || 0}`);
  }

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
  console.log(`   Markdown Generated: ${result.markdownContent ? '✅ Yes' : '❌ No'}`);
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

function printChunkingReport(url, chunks, options) {
  console.log('');
  console.log('='.repeat(80));
  console.log('🧩 CONTENT CHUNKING REPORT');
  console.log('='.repeat(80));
  console.log('');
  console.log(`📊 Generated ${chunks.length} chunks`);

  if (options.maxTokens || options.overlapPercentage) {
    console.log(
      `⚙️  Options: maxTokens=${options.maxTokens || 'default'}, overlap=${options.overlapPercentage || 'default'}%`
    );
  }

  let totalTokens = 0;
  let totalOverlapTokens = 0;

  chunks.forEach((chunk, index) => {
    console.log(`\n📦 CHUNK ${index + 1}/${chunks.length}`);
    console.log(`   🔗 ID: ${chunk.id.substring(0, 16)}...`);
    console.log(
      `   📏 Tokens: ${chunk.tokens} ${chunk.overlapTokens ? `(+${chunk.overlapTokens} overlap)` : ''}`
    );
    console.log(
      `   📂 Section: ${chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : 'Root'}`
    );

    // Show first few lines of content
    const lines = chunk.text.split('\n').slice(0, 5);
    const preview = lines.join('\n');
    const truncated = chunk.text.length > preview.length;
    console.log(`   📝 Content: ${preview}${truncated ? '\n      ...(truncated)...' : ''}`);

    totalTokens += chunk.tokens;
    totalOverlapTokens += chunk.overlapTokens;
  });

  console.log(`\n📈 CHUNKING SUMMARY:`);
  console.log(`   • Total chunks: ${chunks.length}`);
  console.log(`   • Total tokens: ${totalTokens}`);
  console.log(`   • Total overlap tokens: ${totalOverlapTokens}`);
  console.log(`   • Average tokens per chunk: ${Math.round(totalTokens / chunks.length)}`);

  if (chunks.length > 1) {
    const avgOverlap = Math.round((totalOverlapTokens / (chunks.length - 1)) * 100) / 100;
    console.log(`   • Average overlap per chunk: ${avgOverlap} tokens`);
  }

  console.log('');
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
    // Use production HTTP fetcher (includes realistic browser headers, compression, timeouts, etc.)
    const fetchResult = await fetchUrl(url);
    console.error(`[extract-content] Fetched ${fetchResult.bodyText.length} characters`);

    console.error(`[extract-content] Processing through extraction pipeline...`);
    const extractionResult = await extractContent(fetchResult.bodyText, url, { correlationId });
    console.error(`[extract-content] Extraction completed successfully`);

    // Perform chunking if requested
    let chunks = null;
    if (options.chunk) {
      console.error(`[extract-content] Chunking content...`);
      const chunkingOptions = {};
      if (options.maxTokens) chunkingOptions.maxTokens = options.maxTokens;
      if (options.overlapPercentage) chunkingOptions.overlapPercentage = options.overlapPercentage;

      chunks = semanticChunker.chunk(extractionResult, chunkingOptions, url);
      console.error(`[extract-content] Generated ${chunks.length} chunks`);
    }

    if (options.json) {
      const jsonOutput = {
        url,
        timestamp: new Date().toISOString(),
        result: extractionResult,
      };

      if (chunks) {
        jsonOutput.chunks = chunks;
        jsonOutput.chunkingOptions = {
          maxTokens: options.maxTokens,
          overlapPercentage: options.overlapPercentage,
        };
      }

      console.log(JSON.stringify(jsonOutput, null, 2));
    } else if (options.quiet) {
      const quietOutput = {
        method: extractionResult.extractionMethod,
        contentLength: extractionResult.textContent.length,
        sectionCount: extractionResult.sectionPaths.length,
        hasTitle: !!extractionResult.title,
        language: extractionResult.lang,
      };

      if (chunks) {
        quietOutput.chunksGenerated = chunks.length;
        quietOutput.totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
      }

      console.log(JSON.stringify(quietOutput, null, 2));
    } else {
      printReport(url, extractionResult, options.full);

      // Print chunking report if chunks were generated
      if (chunks) {
        printChunkingReport(url, chunks, options);
      }
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
