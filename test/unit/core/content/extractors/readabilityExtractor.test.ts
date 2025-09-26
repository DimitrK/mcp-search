import { describe, test, expect } from '@jest/globals';
import { extractWithReadability } from '../../../../../src/core/content/extractors/readabilityExtractor';

describe('ReadabilityExtractor', () => {
  const wellStructuredHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Test Article</title>
    </head>
    <body>
      <article>
        <h1>Main Title</h1>
        <p class="byline">By John Doe</p>
        <p>This is the first paragraph of a well-structured article with enough content to pass the character threshold test. The article needs to have substantial content to ensure that Mozilla Readability can properly extract it and recognize it as a valid article worth reading.</p>
        <h2>Section Header</h2>
        <p>This is another paragraph with substantial content that should make the total character count exceed 500 characters which is the Mozilla Readability threshold. We need to ensure that our test content mimics real-world articles that would be found on news websites and blogs.</p>
        <p>Adding more content to ensure we have a realistic article length that would typically be found on the web. This additional paragraph provides even more context and content to make sure we meet all the requirements for successful content extraction using Mozilla Readability engine.</p>
        <h2>Another Section</h2>
        <p>This final section contains additional content that ensures our test article is comprehensive and representative of real-world content that the extraction system would encounter in production environments.</p>
      </article>
    </body>
    </html>
  `;

  const skeletonHTML = `
    <!DOCTYPE html>
    <html>
    <head><title>Skeleton Page</title></head>
    <body>
      <div class="loading">Loading...</div>
      <script>loadContent();</script>
    </body>
    </html>
  `;

  const malformedHTML = `
    <html><body><p>Unclosed paragraph<div>Mixed content</body>
  `;

  test('extracts content from well-structured HTML using readability', async () => {
    const result = await extractWithReadability(wellStructuredHTML, {
      url: 'https://example.com/article',
    });

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Test Article');
    expect(result!.textContent).toContain('This is the first paragraph');
    expect(result!.textContent).toContain('Section Header');
    expect(result!.byline).toContain('John Doe');
    expect(result!.extractionMethod).toBe('readability');
    expect(result!.lang).toBe('en');
    expect(result!.sectionPaths).toContain('Main Title');
    expect(result!.sectionPaths).toContain('Section Header');
  });

  test('returns null for skeleton DOM (insufficient content)', async () => {
    const result = await extractWithReadability(skeletonHTML, {
      url: 'https://example.com/skeleton',
    });

    expect(result).toBeNull();
  });

  test('handles malformed HTML gracefully', async () => {
    const result = await extractWithReadability(malformedHTML, {
      url: 'https://example.com/malformed',
    });

    if (result) {
      expect(result.extractionMethod).toBe('readability');
      expect(result.textContent).toContain('Mixed content');
    }
    // Note: Could be null if too little content
  });

  test('removes script tags during preprocessing', async () => {
    const htmlWithScript = `
      <html>
      <body>
        <article>
          <h1>Article Title</h1>
          <p>Good content here that should be extracted properly without any security issues. This paragraph contains enough content to ensure the readability threshold is met during testing.</p>
          <script>alert('malicious');</script>
          <p>More good content after the script tag that should also be extracted safely. This additional paragraph provides more context and content to ensure comprehensive testing of the script removal functionality.</p>
          <p>Even more content to ensure we meet the character threshold requirements for Mozilla Readability to successfully parse this article and return meaningful results.</p>
        </article>
      </body>
      </html>
    `;

    const result = await extractWithReadability(htmlWithScript, {
      url: 'https://example.com/script',
    });

    expect(result).toBeDefined();
    expect(result!.textContent).toContain('Good content here');
    expect(result!.textContent).toContain('More good content');
    expect(result!.textContent).not.toContain('alert');
    expect(result!.textContent).not.toContain('malicious');
  });

  test('preserves language information when available', async () => {
    const htmlWithLang = `
      <html lang="fr">
      <body>
        <article>
          <h1>Article en Français</h1>
          <p>Ceci est un article en français avec suffisamment de contenu pour passer le seuil de caractères requis par Mozilla Readability. Il contient plusieurs phrases pour s'assurer que le contenu est substantiel et représentatif des articles réels qui seraient traités par le système d'extraction.</p>
          <p>Ce paragraphe supplémentaire fournit encore plus de contenu en français pour garantir que l'extraction linguistique fonctionne correctement et que l'article répond aux exigences de longueur minimale pour être traité avec succès.</p>
          <p>Un dernier paragraphe pour compléter l'article et s'assurer que tous les tests de détection de langue et d'extraction de contenu fonctionnent parfaitement avec du contenu en français.</p>
        </article>
      </body>
      </html>
    `;

    const result = await extractWithReadability(htmlWithLang, {
      url: 'https://example.com/french',
    });

    expect(result).toBeDefined();
    expect(result!.lang).toBe('fr');
    expect(result!.textContent).toContain('français');
  });

  test('uses charThreshold=500 as specified', async () => {
    const shortHTML = `
      <html>
      <body>
        <article>
          <h1>Short</h1>
          <p>Too short.</p>
        </article>
      </body>
      </html>
    `;

    const result = await extractWithReadability(shortHTML, { url: 'https://example.com/short' });

    // Should return null due to charThreshold=500
    expect(result).toBeNull();
  });
});
