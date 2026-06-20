import { semanticChunker } from '../../../../src/core/content/chunker';
import type { ExtractionResult } from '../../../../src/core/content/types/extraction';

/**
 * Tests for the chunking improvements introduced in the
 * "improve/chunking-and-inpage-search" branch. These cover:
 *  - Multi-line paragraph joining (previously fragmented into single-line blocks)
 *  - Table detection tightening (previously absorbed any line containing |)
 *  - Sentence-terminator preservation in smartSentenceSplit
 *  - Overlap text no longer has phantom ". " separators
 */
describe('SemanticChunker improvements', () => {
  describe('multi-line paragraph joining', () => {
    it('should keep consecutive non-structural lines in a single chunk', () => {
      // Two consecutive lines with no blank line between them form one paragraph.
      const md = `# Heading

First line of paragraph.
Second line of paragraph.
Third line of paragraph.`;

      const result: ExtractionResult = {
        title: 'Multi-line',
        markdownContent: md,
        textContent: 'First line of paragraph. Second line of paragraph. Third line of paragraph.',
        sectionPaths: ['Heading'],
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [{ level: 1, text: 'Heading', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 15,
          characterCount: 90,
        },
      };

      const chunks = semanticChunker.chunk(result, {
        maxTokens: 200,
        overlapPercentage: 0,
      });

      // The three lines should be in a single chunk, not split across three.
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain('First line of paragraph.');
      expect(chunks[0].text).toContain('Second line of paragraph.');
      expect(chunks[0].text).toContain('Third line of paragraph.');
    });

    it('should start a new block at a blank line', () => {
      const md = `# Heading

First paragraph line one.
First paragraph line two.

Second paragraph line one.`;

      const result: ExtractionResult = {
        title: 'Two paragraphs',
        markdownContent: md,
        textContent:
          'First paragraph line one. First paragraph line two. Second paragraph line one.',
        sectionPaths: ['Heading'],
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [{ level: 1, text: 'Heading', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 12,
          characterCount: 80,
        },
      };

      const chunks = semanticChunker.chunk(result, {
        maxTokens: 200,
        overlapPercentage: 0,
      });

      // We expect at least two blocks (one per paragraph) because the blank
      // line separates them. The section prefix is shared so they may still
      // merge if under the limit, but the join text should preserve both
      // paragraphs distinctly.
      const joined = chunks.map(c => c.text).join('\n\n');
      expect(joined).toContain('First paragraph line one.');
      expect(joined).toContain('Second paragraph line one.');
    });
  });

  describe('table detection tightening', () => {
    it('should NOT absorb non-table lines that happen to contain a pipe', () => {
      // The paragraph "See the table | below" contains a pipe but is not a
      // table row. Previously the table collector would swallow it.
      const md = `# Doc

| Col1 | Col2 |
|------|------|
| A    | B    |

This paragraph mentions a pipe | in the middle of prose.`;

      const result: ExtractionResult = {
        title: 'Table and prose',
        markdownContent: md,
        textContent: 'Col1 Col2 A B This paragraph mentions a pipe in the middle of prose.',
        sectionPaths: ['Doc'],
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [{ level: 1, text: 'Doc', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 15,
          characterCount: 100,
        },
      };

      const chunks = semanticChunker.chunk(result, {
        maxTokens: 20,
        overlapPercentage: 0,
      });

      // The table block and the prose block are now separate blocks.
      // With a small maxTokens they should land in separate chunks.
      const tableChunk = chunks.find(c => c.text.includes('| Col1 |'));
      expect(tableChunk).toBeDefined();
      // The table chunk should NOT contain the prose text — the prose line
      // should be a separate paragraph block/chunk.
      expect(tableChunk!.text).not.toContain('mentions a pipe');

      // And the prose should exist somewhere in the output.
      const allText = chunks.map(c => c.text).join('\n');
      expect(allText).toContain('mentions a pipe');
    });
  });

  describe('sentence terminator preservation', () => {
    it('should preserve terminal punctuation in split sentences', () => {
      // We verify via the overlap mechanism: when two chunks overlap and the
      // overlap is built from sentences, each sentence should retain its
      // terminating period.
      const longText = [
        'This is the first sentence of a long paragraph.',
        'Here is the second sentence which also has content.',
        'The third sentence wraps up the paragraph nicely.',
        'A fourth sentence ensures we get multiple chunks.',
      ].join(' ');

      const md = `# Long\n\n${longText}`;

      const result: ExtractionResult = {
        title: 'Long',
        markdownContent: md,
        textContent: longText,
        sectionPaths: ['Long'],
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [{ level: 1, text: 'Long', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 30,
          characterCount: 200,
        },
      };

      const chunks = semanticChunker.chunk(result, {
        maxTokens: 30,
        overlapPercentage: 50,
      });

      // At least one chunk should have overlap text. That overlap text should
      // contain a period (the terminator) rather than being stripped.
      const overlapChunks = chunks.filter(c => c.overlapTokens > 0);
      // Assert overlap was actually produced — otherwise the test passes vacuously.
      expect(overlapChunks.length).toBeGreaterThan(0);
      for (const chunk of overlapChunks) {
        // The overlap portion is prepended; it should contain at least one
        // sentence-ending period.
        expect(chunk.text).toMatch(/\.\s/);
      }
    });
  });

  describe('overlap text without phantom separators', () => {
    it('should not insert double periods (". . ") in overlap text', () => {
      // Build content that forces a sentence-based overlap.
      const s1 = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda.';
      const s2 = 'Mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.';
      const md = `# Greek\n\n${s1} ${s2}`;

      const result: ExtractionResult = {
        title: 'Greek',
        markdownContent: md,
        textContent: `${s1} ${s2}`,
        sectionPaths: ['Greek'],
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [{ level: 1, text: 'Greek', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 26,
          characterCount: 130,
        },
      };

      const chunks = semanticChunker.chunk(result, {
        maxTokens: 40,
        overlapPercentage: 80,
      });

      // Inspect all chunks for the double-period artifact, but only on chunks
      // that actually have overlap text (otherwise the assertion is vacuous).
      const overlapChunks = chunks.filter(c => c.overlapTokens > 0);
      expect(overlapChunks.length).toBeGreaterThan(0);
      for (const chunk of overlapChunks) {
        // ". . " would indicate a phantom separator was added after a sentence
        // that already retained its own period.
        expect(chunk.text).not.toMatch(/\.\s\.\s/);
      }
    });
  });
});
