import { describe, test, expect } from '@jest/globals';
import { extractWithRaw } from '../../../../../src/core/content/extractors/rawExtractor';

describe('RawExtractor', () => {
  const htmlWithMultimedia = `
    <html>
    <head>
      <title>Test Page</title>
      <meta charset="utf-8">
      <base href="https://example.com">
      <link rel="stylesheet" href="styles.css">
      <link rel="icon" href="favicon.ico">
    </head>
    <body>
      <h1>Main Title</h1>
      <p>This is text content that should be extracted.</p>
      
      <!-- Multimedia elements -->
      <img src="image.jpg" alt="Image">
      <video><source src="video.mp4"></video>
      <audio controls><source src="audio.mp3"></audio>
      <iframe src="embed.html"></iframe>
      <svg><circle cx="50" cy="50" r="40"/></svg>
      <canvas></canvas>
      <picture><source srcset="image.webp"><img src="image.jpg"></picture>
      <map name="map1"><area shape="rect" coords="0,0,50,50" href="link.html"></map>
      
      <!-- Form elements -->
      <form>
        <input type="text" name="name">
        <select name="options">
          <optgroup label="Group 1">
            <option value="1">Option 1</option>
          </optgroup>
        </select>
        <progress value="50" max="100"></progress>
        <meter value="0.7">70%</meter>
        <datalist id="browsers"></datalist>
        <output>Result</output>
      </form>
      
      <!-- Scripts and styles -->
      <script>console.log('script');</script>
      <noscript>No script</noscript>
      <style>.hidden { display: none; }</style>
      
      <!-- Template elements -->
      <template id="template"><p>Template content</p></template>
      <slot name="slot1">Default slot</slot>
      
      <!-- Deprecated elements -->
      <marquee>Scrolling text</marquee>
      <center>Centered text</center>
      <font color="red" size="4">Red text</font>
      
      <p>More text content after multimedia elements.</p>
    </body>
    </html>
  `;

  const malformedHTML = `
    <html><head><title>Broken</title></head>
    <body><p>Unclosed paragraph<div>Mixed content</body>
  `;

  const emptyHTML = '<html></html>';

  test('strips all HTML tags and extracts only text content', async () => {
    const result = await extractWithRaw(htmlWithMultimedia, {
      url: 'https://example.com/test',
    });

    expect(result).toBeDefined();
    expect(result.title).toBe('Test Page');
    expect(result.textContent).toContain('Main Title');
    expect(result.textContent).toContain('This is text content');
    expect(result.textContent).toContain('More text content');
    expect(result.extractionMethod).toBe('raw');
    expect(result.note).toContain('severely degraded');
  });

  test('removes all multimedia elements completely', async () => {
    const result = await extractWithRaw(htmlWithMultimedia, {
      url: 'https://example.com/multimedia',
    });

    expect(result).toBeDefined();
    
    // Should preserve meaningful text content
    expect(result.textContent).toContain('Main Title');
    expect(result.textContent).toContain('This is text content');
    expect(result.textContent).toContain('More text content');
    
    // Multimedia elements should be completely removed
    expect(result.textContent).not.toContain('Image');
    expect(result.textContent).not.toContain('video.mp4');
    expect(result.textContent).not.toContain('audio.mp3');
    expect(result.textContent).not.toContain('embed.html');
    expect(result.textContent).not.toContain('circle');
    expect(result.textContent).not.toContain('srcset');
    
    // Form elements should be removed
    expect(result.textContent).not.toContain('Group 1');
    expect(result.textContent).not.toContain('Option 1');
    expect(result.textContent).not.toContain('Result');
    expect(result.textContent).not.toContain('70%');
    
    // Scripts, styles, metadata should be removed
    expect(result.textContent).not.toContain('script');
    expect(result.textContent).not.toContain('console.log');
    expect(result.textContent).not.toContain('display: none');
    expect(result.textContent).not.toContain('No script');
    expect(result.textContent).not.toContain('charset');
    expect(result.textContent).not.toContain('favicon');
    
    // Template elements should be removed
    expect(result.textContent).not.toContain('Template content');
    expect(result.textContent).not.toContain('Default slot');
    
    // Deprecated elements content should be removed
    expect(result.textContent).not.toContain('Scrolling text');
    expect(result.textContent).not.toContain('Centered text');
    expect(result.textContent).not.toContain('Red text');
  });

  test('handles malformed HTML gracefully', async () => {
    const result = await extractWithRaw(malformedHTML, {
      url: 'https://example.com/malformed',
    });

    expect(result).toBeDefined();
    expect(result.title).toBe('Broken');
    expect(result.textContent).toContain('Unclosed paragraph');
    expect(result.textContent).toContain('Mixed content');
    expect(result.extractionMethod).toBe('raw');
  });

  test('handles completely empty HTML', async () => {
    const result = await extractWithRaw(emptyHTML, { url: 'https://example.com/empty' });

    expect(result).toBeDefined();
    expect(result.title).toBeUndefined();
    expect(result.textContent).toBe('');
    expect(result.sectionPaths).toEqual([]);
    expect(result.extractionMethod).toBe('raw');
  });

  test('normalizes whitespace properly', async () => {
    const messyHTML = `
      <html>
      <body>
        <p>Text   with    lots     of   spaces</p>
        <div>
          
          More    text
          
        </div>
      </body>
      </html>
    `;

    const result = await extractWithRaw(messyHTML, { url: 'https://example.com/messy' });

    expect(result).toBeDefined();
    expect(result.textContent).not.toMatch(/\s{2,}/); // No multiple spaces
    expect(result.textContent).toContain('Text with lots of spaces');
    expect(result.textContent).toContain('More text');
  });

  test('returns empty section paths as raw extraction has no structure', async () => {
    const result = await extractWithRaw(htmlWithMultimedia, {
      url: 'https://example.com/test',
    });

    expect(result).toBeDefined();
    expect(result.sectionPaths).toEqual([]);
  });
});
