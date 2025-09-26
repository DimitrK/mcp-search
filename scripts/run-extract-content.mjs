#!/usr/bin/env node
import { extractContent } from '../dist/core/content/htmlContentExtractor.js';
import { fetch } from 'undici';
import dotenv from 'dotenv';

dotenv.config();

async function fetchHTML(url) {
  console.error(`[extract-content] Fetching: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Invalid content type: ${contentType}. Expected text/html.`);
    }

    const html = await response.text();
    console.error(`[extract-content] Fetched ${html.length} characters`);
    
    return html;
  } catch (error) {
    console.error(`[extract-content] Fetch failed: ${error.message}`);
    throw error;
  }
}

function displayExtractionResult(result, url) {
  console.log('\n' + '='.repeat(80));
  console.log(`📄 CONTENT EXTRACTION REPORT`);
  console.log('='.repeat(80));
  
  console.log(`🔗 URL: ${url}`);
  console.log(`⚙️  Method: ${result.extractionMethod.toUpperCase()}`);
  console.log(`📝 Title: ${result.title || 'No title found'}`);
  console.log(`🌍 Language: ${result.lang || 'Not detected'}`);
  console.log(`📖 Excerpt: ${result.excerpt || 'No excerpt'}`);
  console.log(`👤 Byline: ${result.byline || 'No byline'}`);
  
  if (result.note) {
    console.log(`⚠️  Note: ${result.note}`);
  }
  
  console.log(`\n📊 METRICS:`);
  console.log(`   Characters: ${result.textContent.length.toLocaleString()}`);
  console.log(`   Words: ${result.textContent.split(/\s+/).length.toLocaleString()}`);
  console.log(`   Section Paths: ${result.sectionPaths.length}`);
  
  if (result.sectionPaths.length > 0) {
    console.log(`\n🗂️  SECTION STRUCTURE:`);
    result.sectionPaths.forEach((path, index) => {
      const truncated = path.length > 60 ? path.substring(0, 57) + '...' : path;
      console.log(`   ${(index + 1).toString().padStart(2)}. ${truncated}`);
    });
  }
  
  console.log(`\n📰 CONTENT PREVIEW (first 500 characters):`);
  console.log('-'.repeat(50));
  const preview = result.textContent.substring(0, 500).trim();
  console.log(preview + (result.textContent.length > 500 ? '...' : ''));
  console.log('-'.repeat(50));
  
  // Quality indicators
  console.log(`\n🎯 EXTRACTION QUALITY INDICATORS:`);
  const hasTitle = !!result.title;
  const hasSubstantialContent = result.textContent.length > 1000;
  const hasStructure = result.sectionPaths.length > 0;
  const isPrimaryMethod = result.extractionMethod === 'readability';
  
  console.log(`   ✅ Has Title: ${hasTitle ? 'Yes' : 'No'}`);
  console.log(`   ✅ Substantial Content: ${hasSubstantialContent ? 'Yes' : 'No'} (${hasSubstantialContent ? '>1K chars' : '<1K chars'})`);
  console.log(`   ✅ Has Structure: ${hasStructure ? 'Yes' : 'No'} (${result.sectionPaths.length} sections)`);
  console.log(`   ✅ Primary Method: ${isPrimaryMethod ? 'Yes' : 'No'} (${result.extractionMethod})`);
  
  const qualityScore = [hasTitle, hasSubstantialContent, hasStructure, isPrimaryMethod].filter(Boolean).length;
  const qualityLevel = qualityScore >= 3 ? '🟢 Excellent' : qualityScore >= 2 ? '🟡 Good' : '🔴 Poor';
  console.log(`   🎯 Overall Quality: ${qualityLevel} (${qualityScore}/4)`);
  
  console.log('\n' + '='.repeat(80));
}

function displayFullContent(result) {
  console.log('\n' + '='.repeat(80));
  console.log(`📄 FULL EXTRACTED CONTENT`);
  console.log('='.repeat(80));
  console.log(result.textContent);
  console.log('='.repeat(80));
}

function displayJSONOutput(result, url) {
  console.log('\n' + '='.repeat(80));
  console.log(`📋 JSON OUTPUT`);
  console.log('='.repeat(80));
  
  const output = {
    url,
    timestamp: new Date().toISOString(),
    result
  };
  
  console.log(JSON.stringify(output, null, 2));
  console.log('='.repeat(80));
}

async function main() {
  const url = process.argv[2];
  const options = process.argv.slice(3);
  
  if (!url) {
    console.error('\n📋 USAGE:');
    console.error('  node scripts/run-extract-content.mjs <url> [options]');
    console.error('\n🏷️  OPTIONS:');
    console.error('  --full      Show full extracted content');
    console.error('  --json      Output JSON format');
    console.error('  --quiet     Minimal output (just show extraction result)');
    console.error('\n📝 EXAMPLES:');
    console.error('  node scripts/run-extract-content.mjs https://example.com');
    console.error('  node scripts/run-extract-content.mjs https://news.ycombinator.com --full');
    console.error('  node scripts/run-extract-content.mjs https://github.com/microsoft/vscode --json');
    process.exit(1);
  }

  const showFull = options.includes('--full');
  const showJSON = options.includes('--json');
  const quiet = options.includes('--quiet');

  try {
    console.error('[extract-content] Starting content extraction...');
    
    // Fetch HTML content
    const html = await fetchHTML(url);
    
    // Extract content using our pipeline
    console.error('[extract-content] Processing through extraction pipeline...');
    const correlationId = `manual-test-${Date.now()}`;
    const result = await extractContent(html, url, { correlationId });
    
    console.error('[extract-content] Extraction completed successfully');
    
    if (quiet) {
      console.log(JSON.stringify({ 
        method: result.extractionMethod,
        title: result.title,
        contentLength: result.textContent.length,
        sectionCount: result.sectionPaths.length
      }));
    } else if (showJSON) {
      displayJSONOutput(result, url);
    } else {
      displayExtractionResult(result, url);
      
      if (showFull) {
        displayFullContent(result);
      }
    }
    
    console.error('[extract-content] Done');
    
  } catch (error) {
    console.error(`[extract-content] Error: ${error.message}`);
    if (error.stack && !quiet) {
      console.error(`[extract-content] Stack trace:`);
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[extract-content] Unexpected error:', err);
  process.exit(1);
});
