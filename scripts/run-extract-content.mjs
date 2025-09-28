#!/usr/bin/env node
import { extractContent } from '../dist/core/content/htmlContentExtractor.js';
import { semanticChunker } from '../dist/core/content/chunker.js';
import { fetchUrl } from '../dist/core/content/httpContentFetcher.js';
import { generateCorrelationId } from '../dist/utils/logger.js';
import { createEmbeddingProvider } from '../dist/core/vector/embeddingProvider.js';
import { EmbeddingIntegrationService } from '../dist/core/vector/embeddingIntegrationService.js';
import { deleteChunksByUrl } from '../dist/core/vector/store/chunks.js';
import { closeGlobalPool } from '../dist/core/vector/store/pool.js';
import { normalizeUrl } from '../dist/utils/urlValidator.js';
import { getEnvironment } from '../dist/config/environment.js';
import dotenv from 'dotenv';

dotenv.config();

function parseArgs(args) {
  const options = {
    full: false,
    json: false,
    quiet: false,
    chunk: false,
    embed: false,
    maxTokens: undefined,
    overlapPercentage: undefined,
    batchSize: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full') options.full = true;
    if (arg === '--json') options.json = true;
    if (arg === '--quiet') options.quiet = true;
    if (arg === '--chunk') options.chunk = true;
    if (arg === '--embed') options.embed = true;
    if (arg === '--max-tokens') {
      options.maxTokens = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
    if (arg === '--overlap') {
      options.overlapPercentage = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
    if (arg === '--batch-size') {
      options.batchSize = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
  }

  return options;
}

function printUsage() {
  console.error(`
Usage: node scripts/run-extract-content.mjs <URL> [OPTIONS]

Extract and display text content from a web page using the MCP content extraction pipeline.
Optionally chunk the content for semantic analysis and generate embeddings.

Arguments:
  URL                    The URL to extract content from

Options:
  --full                 Show full extracted content (default: truncated preview)
  --json                 Output results as JSON
  --quiet                Show only basic extraction metrics
  --chunk                Enable content chunking analysis
  --embed                Generate embeddings, store in vector DB, verify, and cleanup (requires --chunk)
  --max-tokens NUM       Maximum tokens per chunk (default: from environment)
  --overlap NUM          Overlap percentage between chunks (default: 15)
  --batch-size NUM       Embedding batch size (default: from environment)
  --help                 Show this help message

Examples:
  node scripts/run-extract-content.mjs https://example.com
  node scripts/run-extract-content.mjs https://example.com --chunk
  node scripts/run-extract-content.mjs https://example.com --chunk --embed       # Complete E2E test
  node scripts/run-extract-content.mjs https://example.com --chunk --embed --batch-size 16
  node scripts/run-extract-content.mjs https://example.com --json --chunk --embed
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

function printEmbeddingReport(url, embeddings, chunks, options) {
  console.log('');
  console.log('='.repeat(80));
  console.log('🧠 EMBEDDING GENERATION & VECTOR STORAGE REPORT');
  console.log('='.repeat(80));
  console.log('');
  console.log(`📊 Generated ${embeddings.length} embeddings`);

  if (embeddings.length > 0) {
    const dimension = embeddings[0].length;
    console.log(`📐 Embedding dimension: ${dimension}`);

    if (options.batchSize) {
      console.log(`⚙️  Batch size: ${options.batchSize}`);
    }

    console.log(`\n✅ END-TO-END PIPELINE COMPLETED:`);
    console.log(`   • Generated embeddings for ${chunks.length} chunks`);
    console.log(`   • Stored chunks with embeddings in vector database`);
    console.log(`   • Verified storage with similarity search`);
    console.log(`   • Cleaned up test data from database`);

    // Show sample embeddings (first few values from first few embeddings)
    console.log(`\n📝 SAMPLE EMBEDDINGS:`);
    const samplesToShow = Math.min(3, embeddings.length);

    for (let i = 0; i < samplesToShow; i++) {
      const chunkPreview = chunks ? chunks[i].text.substring(0, 50) + '...' : `Embedding ${i + 1}`;
      const embeddingPreview = embeddings[i]
        .slice(0, 5)
        .map(v => v.toFixed(4))
        .join(', ');

      console.log(`   ${i + 1}. "${chunkPreview}"`);
      console.log(`      → [${embeddingPreview}, ...] (${dimension}D)`);
    }

    if (embeddings.length > samplesToShow) {
      console.log(`   ... and ${embeddings.length - samplesToShow} more embeddings`);
    }

    // Statistical analysis
    console.log(`\n📈 EMBEDDING STATISTICS:`);
    const allValues = embeddings.flat();
    const mean = allValues.reduce((sum, val) => sum + val, 0) / allValues.length;
    const sortedValues = [...allValues].sort((a, b) => a - b);
    const median = sortedValues[Math.floor(sortedValues.length / 2)];
    const min = sortedValues[0];
    const max = sortedValues[sortedValues.length - 1];

    console.log(`   • Value range: ${min.toFixed(4)} to ${max.toFixed(4)}`);
    console.log(`   • Mean: ${mean.toFixed(4)}`);
    console.log(`   • Median: ${median.toFixed(4)}`);
    console.log(`   • Total values: ${allValues.length.toLocaleString()}`);

    console.log(`\n🎯 VECTOR STORAGE VERIFICATION:`);
    console.log(`   • Database storage: ✅ Verified`);
    console.log(`   • Similarity search: ✅ Functional`);
    console.log(`   • Data cleanup: ✅ Completed`);
    console.log(`   • Pipeline status: 🟢 FULLY OPERATIONAL`);
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
    let embeddings = null;
    if (options.chunk) {
      console.error(`[extract-content] Chunking content...`);
      const chunkingOptions = {};
      if (options.maxTokens) chunkingOptions.maxTokens = options.maxTokens;
      if (options.overlapPercentage) chunkingOptions.overlapPercentage = options.overlapPercentage;

      chunks = semanticChunker.chunk(extractionResult, chunkingOptions, url);
      console.error(`[extract-content] Generated ${chunks.length} chunks`);

      // Generate embeddings and store in vector database if requested
      if (options.embed) {
        console.error(`[extract-content] Starting embedding pipeline...`);
        let integrationService;
        const normalizedUrl = normalizeUrl(url);

        try {
          const env = getEnvironment();
          const embeddingProvider = await createEmbeddingProvider({
            type: 'http',
            serverUrl: env.EMBEDDING_SERVER_URL,
            apiKey: env.EMBEDDING_SERVER_API_KEY,
            modelName: env.EMBEDDING_MODEL_NAME,
            batchSize: options.batchSize || env.EMBEDDING_BATCH_SIZE,
            // timeoutMs will use provider default (30s)
          });

          // Create integration service for end-to-end testing
          integrationService = new EmbeddingIntegrationService(embeddingProvider);

          // Step 1: Generate embeddings and store in vector database
          console.error(
            `[extract-content] Generating embeddings and storing in vector database...`
          );
          const storeStartTime = Date.now();
          await integrationService.storeWithEmbeddings(normalizedUrl, chunks, { correlationId });
          const storeDuration = Date.now() - storeStartTime;

          console.error(
            `[extract-content] ✅ Stored ${chunks.length} chunks with embeddings in ${storeDuration}ms`
          );
          console.error(
            `[extract-content] Model: ${embeddingProvider.getModelName()}, Dimension: ${embeddingProvider.getDimension()}`
          );

          // Step 2: Verify storage by performing similarity search
          console.error(`[extract-content] Verifying storage with similarity search...`);
          const verifyStartTime = Date.now();

          // Use first chunk text as query to test similarity search
          const testQuery = chunks[0].text.substring(0, 100); // First 100 chars as query
          const searchResults = await integrationService.searchSimilar(
            normalizedUrl,
            testQuery,
            3,
            { correlationId }
          );
          const verifyDuration = Date.now() - verifyStartTime;

          console.error(
            `[extract-content] ✅ Similarity search returned ${searchResults.length} results in ${verifyDuration}ms`
          );

          if (searchResults.length > 0) {
            const avgScore =
              searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length;
            console.error(
              `[extract-content] Average similarity score: ${avgScore.toFixed(4)} (${avgScore > 0.7 ? 'excellent' : avgScore > 0.5 ? 'good' : 'fair'})`
            );
          }

          // For visualization, generate embeddings array for the report
          const chunkTexts = chunks.map(chunk => chunk.text);
          const embeddingStartTime = Date.now();
          embeddings = await embeddingProvider.embed(chunkTexts);
          const embeddingDuration = Date.now() - embeddingStartTime;

          console.error(
            `[extract-content] Generated ${embeddings.length} embeddings for reporting in ${embeddingDuration}ms`
          );
          console.error(
            `[extract-content] Throughput: ${Math.round((chunkTexts.length / embeddingDuration) * 1000)} texts/second`
          );

          // Step 3: Cleanup test data (this is a development script)
          console.error(`[extract-content] Cleaning up test data...`);
          const cleanupStartTime = Date.now();
          await deleteChunksByUrl(normalizedUrl);
          const cleanupDuration = Date.now() - cleanupStartTime;

          console.error(`[extract-content] ✅ Cleanup completed in ${cleanupDuration}ms`);
        } catch (error) {
          console.error(`[extract-content] Embedding pipeline failed: ${error.message}`);

          // Attempt cleanup even on failure
          try {
            if (normalizedUrl) {
              console.error(`[extract-content] Attempting cleanup after failure...`);
              await deleteChunksByUrl(normalizedUrl);
              console.error(`[extract-content] ✅ Cleanup completed after failure`);
            }
          } catch (cleanupError) {
            console.error(`[extract-content] ⚠️  Cleanup failed: ${cleanupError.message}`);
          }

          process.exit(1);
        } finally {
          // Proper resource cleanup sequence
          console.error(`[extract-content] Cleaning up resources...`);

          // 1. Close embedding provider
          if (integrationService) {
            await integrationService.close();
            console.error(`[extract-content] ✅ Embedding provider closed`);
          }

          // 2. Close global database pool (this will properly terminate worker threads)
          await closeGlobalPool();
          console.error(`[extract-content] ✅ Database pool closed`);
        }
      }
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

      if (embeddings) {
        jsonOutput.embeddings = embeddings;
        jsonOutput.embeddingOptions = {
          batchSize: options.batchSize,
        };
        jsonOutput.vectorStorageValidation = {
          tested: true,
          status: 'verified',
          pipelineComplete: true,
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

      if (embeddings) {
        quietOutput.embeddingsGenerated = embeddings.length;
        quietOutput.embeddingDimension = embeddings[0]?.length || 0;
        quietOutput.vectorStorageTested = true;
        quietOutput.pipelineStatus = 'fully_operational';
      }

      console.log(JSON.stringify(quietOutput, null, 2));
    } else {
      printReport(url, extractionResult, options.full);

      // Print chunking report if chunks were generated
      if (chunks) {
        printChunkingReport(url, chunks, options);
      }

      // Print embedding report if embeddings were generated
      if (embeddings) {
        printEmbeddingReport(url, embeddings, chunks, options);
      }
    }
  } catch (error) {
    console.error(`[extract-content] Error: ${error.message}`);

    // Clean up resources even on error
    try {
      console.error(`[extract-content] Cleaning up resources after error...`);
      await closeGlobalPool();
      console.error(`[extract-content] ✅ Database pool closed after error`);
    } catch (cleanupError) {
      console.error(`[extract-content] ⚠️  Resource cleanup failed: ${cleanupError.message}`);
    }

    process.exit(1);
  }

  console.error(`[extract-content] Done`);

  // Final cleanup - close global database pool to terminate worker threads
  try {
    console.error(`[extract-content] Final cleanup - closing database pool...`);
    await closeGlobalPool();
    console.error(`[extract-content] ✅ All resources cleaned up successfully`);
  } catch (cleanupError) {
    console.error(`[extract-content] ⚠️  Final cleanup failed: ${cleanupError.message}`);
  }
}

main()
  .then(() => {
    console.error(`[extract-content] Process completed successfully`);
    // Resources should be properly closed by now - no force exit needed
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
