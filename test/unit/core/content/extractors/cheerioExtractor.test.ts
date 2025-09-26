import { describe, test, expect } from '@jest/globals';
import { extractWithCheerio } from '../../../../../src/core/content/extractors/cheerioExtractor';

describe('CheerioExtractor', () => {
  const semanticHTML = `
    <html lang="es">
    <head><title>Test Page</title></head>
    <body>
      <nav class="main-nav">Navigation content</nav>
      <header>Header content</header>
      
      <main>
        <article>
          <h1>Main Article Title</h1>
          <div class="byline">By Jane Smith</div>
          <p>This is the main content that should be extracted by Cheerio fallback.</p>
          <h2>Subsection</h2>
          <p>More content in the subsection that should be preserved.</p>
        </article>
      </main>
      
      <aside class="sidebar">Sidebar content to remove</aside>
      <footer>Footer content</footer>
    </body>
    </html>
  `;

  const noisyHTML = `
    <html>
    <body>
      <nav class="breadcrumb">Home > Article</nav>
      <div class="promo">Subscribe now!</div>
      <div class="cookie">Cookie notice</div>
      <dialog class="modal">Modal content</dialog>
      
      <article>
        <h1>Clean Content</h1>
        <p>This content should be extracted while noise is removed.</p>
      </article>
      
      <div class="advertisement">Ad content</div>
      <div class="footer">Footer links</div>
    </body>
    </html>
  `;

  const nestedSemanticHTML = `
    <html>
    <body>
      <div class="container">
        <div class="section main-content">
          <article>
            <header>
              <h1>Nested Article</h1>
              <div class="meta">Article metadata</div>
            </header>
            <section>
              <h2>First Section</h2>
              <p>Content in first section.</p>
            </section>
            <section>
              <h2>Second Section</h2>
              <p>Content in second section.</p>
            </section>
          </article>
        </div>
        <div class="sidebar">Sidebar to remove</div>
      </div>
    </body>
    </html>
  `;

  const roleBasedHTML = `
    <html>
    <body>
      <div role="banner">Banner content</div>
      <div role="navigation">Nav content</div>
      
      <div role="main">
        <h1>Main Content Area</h1>
        <p>This content should be extracted from the role=main element.</p>
        <h2>Subsection in Main</h2>
        <p>Additional content that should be included.</p>
      </div>
      
      <div role="complementary">Complementary content</div>
    </body>
    </html>
  `;

  test('extracts content from semantic HTML elements', async () => {
    const result = await extractWithCheerio(semanticHTML, { url: 'https://example.com/semantic' });

    expect(result).toBeDefined();
    expect(result.textContent).toContain('Main Article Title');
    expect(result.textContent).toContain('main content that should be extracted');
    expect(result.textContent).toContain('Subsection');
    expect(result.textContent).not.toContain('Navigation content');
    expect(result.textContent).not.toContain('Header content');
    expect(result.textContent).not.toContain('Sidebar content');
    expect(result.textContent).not.toContain('Footer content');
    expect(result.extractionMethod).toBe('cheerio');
    expect(result.lang).toBe('es');
  });

  test('removes noise elements including dialog and modal', async () => {
    const result = await extractWithCheerio(noisyHTML, { url: 'https://example.com/noisy' });

    expect(result).toBeDefined();
    expect(result.textContent).toContain('Clean Content');
    expect(result.textContent).toContain('This content should be extracted');
    expect(result.textContent).not.toContain('Home > Article');
    expect(result.textContent).not.toContain('Subscribe now!');
    expect(result.textContent).not.toContain('Cookie notice');
    expect(result.textContent).not.toContain('Modal content');
    expect(result.textContent).not.toContain('Ad content');
    expect(result.textContent).not.toContain('Footer links');
  });

  test('handles nested semantic structures', async () => {
    const result = await extractWithCheerio(nestedSemanticHTML, {
      url: 'https://example.com/nested',
    });

    expect(result).toBeDefined();
    expect(result.textContent).toContain('Nested Article');
    expect(result.textContent).toContain('First Section');
    expect(result.textContent).toContain('Second Section');
    expect(result.textContent).toContain('Content in first section');
    expect(result.textContent).toContain('Content in second section');
    expect(result.textContent).not.toContain('Sidebar to remove');
  });

  test('targets role-based content areas', async () => {
    const result = await extractWithCheerio(roleBasedHTML, { url: 'https://example.com/role' });

    expect(result).toBeDefined();
    expect(result.textContent).toContain('Main Content Area');
    expect(result.textContent).toContain('This content should be extracted from the role=main');
    expect(result.textContent).toContain('Subsection in Main');
    expect(result.textContent).not.toContain('Banner content');
    expect(result.textContent).not.toContain('Nav content');
    expect(result.textContent).not.toContain('Complementary content');
  });

  test('extracts section paths from heading structure', async () => {
    const result = await extractWithCheerio(semanticHTML, { url: 'https://example.com/semantic' });

    expect(result).toBeDefined();
    expect(result.sectionPaths).toContain('Main Article Title');
    expect(result.sectionPaths).toContain('Subsection');
  });

  test('handles content with no semantic structure gracefully', async () => {
    const nonSemanticHTML = `
      <html>
      <body>
        <div>
          <div>Some content in divs</div>
          <div>More content without semantic markup</div>
        </div>
      </body>
      </html>
    `;

    const result = await extractWithCheerio(nonSemanticHTML, { url: 'https://example.com/divs' });

    expect(result).toBeDefined();
    expect(result.textContent).toContain('Some content in divs');
    expect(result.textContent).toContain('More content without semantic markup');
    expect(result.extractionMethod).toBe('cheerio');
  });

  test('prioritizes content selectors in correct order', async () => {
    const multipleContainersHTML = `
      <html>
      <body>
        <div class="content">Generic content div</div>
        <main>Main element content</main>
        <article>Article element content</article>
        <div id="content">ID content div</div>
      </body>
      </html>
    `;

    const result = await extractWithCheerio(multipleContainersHTML, {
      url: 'https://example.com/priority',
    });

    expect(result).toBeDefined();
    // Should prioritize article > main > other semantic elements
    expect(result.textContent).toContain('Article element content');
  });
});
