// Test JavaScript filtering specifically
async function testJsFiltering() {
  console.log('Testing JavaScript filtering on https://apply.officedroid.com/basic/');
  
  try {
    const response = await fetch('https://apply.officedroid.com/basic/');
    const html = await response.text();
    
    console.log(`Fetched HTML: ${html.length} characters`);
    
    // Check for different types of script tags
    const scriptPatterns = [
      /<script[^>]*>/gi,
      /<script\s+[^>]*src=/gi,
      /<script\s*>/gi,
      /window\./g,
      /function\s+\w+/g,
    ];
    
    console.log('\n=== SCRIPT PATTERNS IN RAW HTML ===');
    for (const pattern of scriptPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        console.log(`✅ Found ${matches.length} matches for: ${pattern}`);
        console.log(`   Sample: "${matches[0]}"`);
      } else {
        console.log(`❌ Not found: ${pattern}`);
      }
    }
    
    console.log('\n=== TESTING SCRIPT FILTERING ===');
    
    let filtered = html;
    
    // Test different script removal patterns
    console.log('\n--- Method 1: Simple script tag removal ---');
    let method1 = html;
    const beforeScript1 = method1.length;
    method1 = method1.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, ' ');
    console.log(`Method 1 removed: ${beforeScript1 - method1.length} characters`);
    
    console.log('\n--- Method 2: All script variations ---');
    let method2 = html;
    const beforeScript2 = method2.length;
    // Remove script tags with content
    method2 = method2.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, ' ');
    // Remove self-closing script tags
    method2 = method2.replace(/<script[^>]*\/>/gi, ' ');
    // Remove noscript
    method2 = method2.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gis, ' ');
    console.log(`Method 2 removed: ${beforeScript2 - method2.length} characters`);
    
    console.log('\n--- Checking what remains ---');
    
    // Use method 2 for further processing
    filtered = method2;
    
    // Remove HTML tags
    filtered = filtered.replace(/<[^>]+>/g, ' ');
    filtered = filtered.replace(/\s+/g, ' ').trim();
    
    console.log(`Final content length: ${filtered.length} characters`);
    
    // Check for JS leakage
    const jsLeakPatterns = [
      /window\./,
      /function\s+/,
      /var\s+/,
      /let\s+/,
      /const\s+/,
      /=\s*{/,
      /:\s*true/,
      /:\s*false/,
    ];
    
    console.log('\n=== CHECKING FOR JS LEAKAGE ===');
    for (const pattern of jsLeakPatterns) {
      if (pattern.test(filtered)) {
        console.log(`🚨 JS LEAKED: Pattern ${pattern} found!`);
        const match = filtered.match(pattern);
        if (match) {
          const index = filtered.indexOf(match[0]);
          const context = filtered.substring(Math.max(0, index - 50), index + 100);
          console.log(`   Context: "${context}"`);
        }
      }
    }
    
    console.log('\n=== CONTENT SAMPLE (first 300 chars) ===');
    console.log('"' + filtered.substring(0, 300) + '"');
    
    console.log('\n=== LOOKING FOR SPECIFIC PROBLEM ===');
    if (filtered.includes('window.careers')) {
      console.log('🚨 Found window.careers in filtered content!');
      const index = filtered.indexOf('window.careers');
      console.log('Context around window.careers:');
      console.log('"' + filtered.substring(index - 100, index + 200) + '"');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testJsFiltering();

