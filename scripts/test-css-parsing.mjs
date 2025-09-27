#!/usr/bin/env node
import { fetch } from 'undici';
import { register } from 'tsx/esm';

// Register TypeScript loader
register();

// Now we can import TypeScript files directly
const { extractContent } = await import('../src/core/content/htmlContentExtractor.ts');

const url = process.argv[2] || 'https://apply.officedroid.com/basic/';

console.log(`Fetching: ${url}`);

try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const html = await response.text();
  console.log(`Fetched ${html.length} characters`);

  console.log('\\nExtracting content...');
  const result = await extractContent(html, url);
  
  console.log(`\\nExtraction Method: ${result.extractionMethod}`);
  console.log(`Content Length: ${result.textContent.length}`);
  console.log(`Title: ${result.title || 'N/A'}`);
  
  // Look for CSS content in the extracted text
  const cssPatterns = [
    /\\bcolor\\s*:/,
    /\\bbackground\\s*:/,
    /\\bfont-family\\s*:/,
    /\\bmargin\\s*:/,
    /\\bpadding\\s*:/,
    /\\bdisplay\\s*:/,
    /\\bposition\\s*:/,
    /\\bwidth\\s*:/,
    /\\bheight\\s*:/,
    /[#.]\\w+\\s*{/,
    /@media\\s/,
    /@import\\s/,
  ];

  let cssFound = false;
  for (const pattern of cssPatterns) {
    if (pattern.test(result.textContent)) {
      cssFound = true;
      console.log(`\\n🚨 CSS DETECTED: Pattern ${pattern} found in extracted content`);
    }
  }

  if (cssFound) {
    console.log('\\n📄 CONTENT SAMPLE (first 1000 chars):');
    console.log('-'.repeat(60));
    console.log(result.textContent.substring(0, 1000));
    console.log('-'.repeat(60));
    
    console.log('\\n📄 CONTENT SAMPLE (middle section):');
    console.log('-'.repeat(60));
    const midpoint = Math.floor(result.textContent.length / 2);
    console.log(result.textContent.substring(midpoint, midpoint + 1000));
    console.log('-'.repeat(60));
  } else {
    console.log('\\n✅ No CSS patterns detected in extracted content');
  }

} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

