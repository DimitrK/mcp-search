// Simple CSS test script using native fetch
async function testCssFiltering() {
  console.log('Testing CSS filtering on https://apply.officedroid.com/basic/');
  
  try {
    const response = await fetch('https://apply.officedroid.com/basic/');
    const html = await response.text();
    
    console.log(`Fetched HTML: ${html.length} characters`);
    
    // Check if the HTML contains CSS
    const cssPatterns = [
      /<style[^>]*>/i,
      /color\s*:/,
      /background\s*:/,
      /font-family\s*:/,
      /\.[\w-]+\s*{/,
      /@media\s/,
    ];
    
    console.log('\n=== CSS PATTERNS IN RAW HTML ===');
    for (const pattern of cssPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        console.log(`✅ Found: ${pattern} - "${matches[0].substring(0, 50)}..."`);
      } else {
        console.log(`❌ Not found: ${pattern}`);
      }
    }
    
    // Now test basic CSS filtering using simple regex (like rawExtractor should do)
    console.log('\n=== TESTING CSS FILTERING ===');
    
    // Apply the same CSS filtering as rawExtractor
    let filtered = html;
    
    // Remove <style> tags and their content
    const beforeStyle = filtered.length;
    filtered = filtered.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gis, ' ');
    console.log(`Removed <style> tags: ${beforeStyle - filtered.length} characters`);
    
    // Remove <link> stylesheet references
    const beforeLink = filtered.length;
    filtered = filtered.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, ' ');
    filtered = filtered.replace(/<link[^>]*type=["']text\/css["'][^>]*>/gi, ' ');
    console.log(`Removed <link> stylesheets: ${beforeLink - filtered.length} characters`);
    
    // Remove all HTML tags
    const beforeTags = filtered.length;
    filtered = filtered.replace(/<[^>]+>/g, ' ');
    console.log(`Removed HTML tags: ${beforeTags - filtered.length} characters`);
    
    // Normalize whitespace
    filtered = filtered.replace(/\s+/g, ' ').trim();
    
    console.log(`\nFinal text length: ${filtered.length} characters`);
    
    // Check if CSS leaked through
    console.log('\n=== CHECKING FOR CSS LEAKAGE ===');
    for (const pattern of cssPatterns) {
      if (pattern.test(filtered)) {
        console.log(`🚨 CSS LEAKED: Pattern ${pattern} found in filtered text!`);
        
        // Show context where CSS was found
        const match = filtered.match(pattern);
        if (match) {
          const index = filtered.indexOf(match[0]);
          const context = filtered.substring(Math.max(0, index - 100), index + 200);
          console.log(`Context: "${context}"`);
        }
      }
    }
    
    console.log('\n=== CONTENT SAMPLE ===');
    console.log(filtered.substring(0, 500));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCssFiltering();