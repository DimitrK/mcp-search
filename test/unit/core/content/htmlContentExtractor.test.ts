import { describe, test, expect } from '@jest/globals';
import { extractContent } from '../../../../src/core/content/htmlContentExtractor';

describe('HTMLContentExtractor Integration', () => {
  const goodArticleHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Complete Test Article</title>
    </head>
    <body>
      <nav>Navigation</nav>
      <article>
        <h1>Complete Test Article</h1>
        <p class="byline">By Test Author</p>
        <p>This is a comprehensive article with enough content to pass Mozilla Readability's character threshold of 500 characters. It contains multiple paragraphs and semantic structure that should be properly extracted.</p>
        <h2>First Section</h2>
        <p>This section contains additional content that ensures we meet the character requirements while providing a realistic example of article structure.</p>
        <h2>Second Section</h2>
        <p>Even more content to ensure comprehensive testing of the extraction pipeline and to verify that all components work together properly.</p>
      </article>
      <aside>Sidebar content</aside>
      <footer>Footer content</footer>
    </body>
    </html>
  `;

  const skeletonPageHTML = `
    <!DOCTYPE html>
    <html>
    <head><title>Loading Page</title></head>
    <body>
      <div class="loader">Loading...</div>
      <div class="skeleton">
        <div class="placeholder"></div>
        <div class="placeholder"></div>
      </div>
      <script>
        // This would normally load content dynamically
        loadDynamicContent();
      </script>
    </body>
    </html>
  `;

  const noisyButGoodHTML = `
    <html lang="de">
    <head><title>Noisy Article</title></head>
    <body>
      <nav class="main-nav">Skip to content</nav>
      <div class="cookie-banner">Accept cookies</div>
      <div class="promo">Subscribe to newsletter!</div>
      
      <main>
        <article>
          <h1>Important Article Title</h1>
          <div class="meta">Published on 2024</div>
          <p>This article has enough content to pass readability extraction despite having noise elements around it. The content is substantial and meaningful, providing comprehensive information that readers will find valuable and informative.</p>
          <h2>Article Section</h2>
          <p>Additional content that makes this article long enough and valuable enough to be properly extracted by Mozilla Readability engine. This paragraph contains detailed information that contributes to the overall value of the article.</p>
          <p>Yet another paragraph to ensure we have comprehensive content for testing the complete extraction pipeline. This content demonstrates how the system handles articles with substantial text that should be extracted successfully.</p>
          <p>Even more detailed content to ensure we exceed the character threshold requirements for Mozilla Readability to successfully identify this as a valid article worth extracting, despite the presence of navigation and promotional noise elements.</p>
        </article>
      </main>
      
      <aside class="ads">Advertisement</aside>
      <dialog class="modal">Modal content</dialog>
      <footer class="site-footer">Footer links</footer>
    </body>
    </html>
  `;

  const cheerioFallbackHTML = `
    <html lang="fr">
    <body>
      <nav>Navigation noise</nav>
      <div class="container">
        <main>
          <h1>Fallback Article</h1>
          <p>Short article that might not pass readability threshold.</p>
        </main>
      </div>
      <footer>Footer noise</footer>
    </body>
    </html>
  `;

  test('successfully extracts content using readability for good articles', async () => {
    const result = await extractContent(goodArticleHTML, 'https://example.com/good-article');

    expect(result).toBeDefined();
    expect(result.title).toBe('Complete Test Article');
    expect(result.textContent).toContain('comprehensive article');
    expect(result.textContent).toContain('First Section');
    expect(result.textContent).toContain('Second Section');
    expect(result.byline).toContain('Test Author');
    expect(result.lang).toBe('en');
    expect(result.extractionMethod).toBe('readability');
    expect(result.sectionPaths.length).toBeGreaterThan(0);
    expect(result.sectionPaths).toContain('Complete Test Article');
    expect(result.sectionPaths).toContain('First Section');
    expect(result.sectionPaths).toContain('Second Section');
  });

  test('falls back through extraction chain for skeleton pages', async () => {
    const result = await extractContent(skeletonPageHTML, 'https://example.com/skeleton');

    expect(result).toBeDefined();
    // SPA extraction should fail due to insufficient content and fall back to raw
    expect(result.extractionMethod).toBe('raw');
    expect(result.textContent).toContain('Loading');
    expect(result.textContent).not.toContain('loadDynamicContent');
    expect(result.note).toContain('severely degraded');
  }, 35000);

  test('uses readability despite noise when content is substantial', async () => {
    const result = await extractContent(noisyButGoodHTML, 'https://example.com/noisy');

    expect(result).toBeDefined();
    expect(result.title).toBe('Noisy Article');
    expect(result.textContent).toContain('Important Article Title');
    expect(result.textContent).toContain('substantial and meaningful');
    expect(result.textContent).not.toContain('Accept cookies');
    expect(result.textContent).not.toContain('Subscribe to newsletter');
    expect(result.textContent).not.toContain('Advertisement');
    expect(result.lang).toBe('de');
    expect(result.extractionMethod).toBe('readability');
  });

  test('falls back through extraction chain for short content', async () => {
    const result = await extractContent(cheerioFallbackHTML, 'https://example.com/short');

    expect(result).toBeDefined();
    // SPA extraction should fail due to insufficient content and fall back to raw
    expect(result.extractionMethod).toBe('raw');
    expect(result.textContent).toContain('Fallback Article');
    expect(result.textContent).toContain('Short article that might not pass readability threshold');
    expect(result.lang).toBeUndefined(); // Raw extraction doesn't detect language
    expect(result.note).toContain('severely degraded');
  }, 35000);

  test('removes script tags during preprocessing', async () => {
    const scriptHTML = `
      <html>
      <body>
        <article>
          <h1>Script Test Article</h1>
          <p>Content before script with enough text to pass the readability threshold for extraction testing purposes.</p>
          <script>alert('This should be removed');</script>
          <p>Content after script with additional text to ensure we have sufficient content for proper extraction testing.</p>
          <p>Even more content to ensure we meet the character threshold requirements for Mozilla Readability to successfully parse this article and return meaningful results without any script content included.</p>
        </article>
      </body>
      </html>
    `;

    const result = await extractContent(scriptHTML, 'https://example.com/script-test');

    expect(result).toBeDefined();
    expect(result.textContent).toContain('Content before script');
    expect(result.textContent).toContain('Content after script');
    expect(result.textContent).not.toContain('alert');
    expect(result.textContent).not.toContain('This should be removed');
  });

  test('handles completely empty or invalid HTML gracefully', async () => {
    const emptyHTML = '<html></html>';

    const result = await extractContent(emptyHTML, 'https://example.com/empty');

    expect(result).toBeDefined();
    // SPA extraction should fail due to insufficient content and fall back to raw
    expect(result.extractionMethod).toBe('raw');
    expect(typeof result.textContent).toBe('string');
    expect(result.note).toContain('severely degraded');
  }, 35000);

  test('preserves section paths across extraction methods', async () => {
    const structuredHTML = `
      <html>
      <body>
        <article>
          <h1>Main Title</h1>
          <section>
            <h2>Section One</h2>
            <p>Content here.</p>
          </section>
          <section>
            <h2>Section Two</h2>
            <p>More content.</p>
          </section>
        </article>
      </body>
      </html>
    `;

    const result = await extractContent(structuredHTML, 'https://example.com/structured');

    expect(result).toBeDefined();
    expect(result.sectionPaths).toContain('Main Title');
    expect(result.sectionPaths).toContain('Section One');
    expect(result.sectionPaths).toContain('Section Two');
  });

  test('includes correlationId in options when provided', async () => {
    const result = await extractContent(goodArticleHTML, 'https://example.com/correlation', {
      correlationId: 'test-correlation-123',
    });

    expect(result).toBeDefined();
    expect(result.extractionMethod).toBe('readability');
  });
});
