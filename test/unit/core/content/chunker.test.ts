import {
  semanticChunker,
  type ChunkingOptions,
  type ContentChunk,
} from '../../../../src/core/content/chunker';
import type { ExtractionResult } from '../../../../src/core/content/types/extraction';

describe('SemanticChunker', () => {
  const mockExtractionResult: ExtractionResult = {
    title: 'Test Article',
    textContent: 'This is plain text content for testing.',
    markdownContent: `# Main Title

This is the introduction paragraph with some content.

## Section One

This section has multiple paragraphs. This is the first paragraph of section one.

This is the second paragraph of section one with more content.

### Subsection A

This is a subsection with its own content.

## Section Two  

This section contains different content types.

\`\`\`javascript
function example() {
  return 'code block content';
}
\`\`\`

- List item one
- List item two
- List item three

## Conclusion

This is the final section with concluding remarks.`,
    excerpt: 'Test article excerpt',
    sectionPaths: ['Main Title', 'Section One', 'Subsection A', 'Section Two', 'Conclusion'],
    semanticInfo: {
      headings: [
        { level: 1, text: 'Main Title', position: 0 },
        { level: 2, text: 'Section One', position: 100 },
        { level: 3, text: 'Subsection A', position: 200 },
        { level: 2, text: 'Section Two', position: 300 },
        { level: 2, text: 'Conclusion', position: 400 },
      ],
      codeBlocks: [
        {
          language: 'javascript',
          content: "function example() {\n  return 'code block content';\n}",
          position: 320,
          length: 50,
        },
      ],
      lists: [
        {
          content: '- List item one\n- List item two\n- List item three',
          position: 380,
          itemCount: 3,
        },
      ],
      wordCount: 45,
      characterCount: 500,
    },
    extractionMethod: 'cheerio',
  };

  describe('basic chunking functionality', () => {
    it('should chunk content by headings', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, {
        maxTokens: 100,
        overlapPercentage: 0,
      });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].sectionPath).toEqual(['Main Title']);
      expect(chunks[1].sectionPath).toEqual(['Main Title', 'Section One']);
    });

    it('should generate stable chunk IDs', () => {
      const chunks1 = semanticChunker.chunk(mockExtractionResult, { maxTokens: 100 });
      const chunks2 = semanticChunker.chunk(mockExtractionResult, { maxTokens: 100 });

      expect(chunks1).toHaveLength(chunks2.length);
      chunks1.forEach((chunk, i) => {
        expect(chunk.id).toBe(chunks2[i].id);
      });
    });

    it('should estimate tokens correctly using ~4 chars/token heuristic', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 50 });

      chunks.forEach(chunk => {
        const estimatedTokens = Math.ceil(chunk.text.length / 4);
        expect(chunk.tokens).toBe(estimatedTokens);
        expect(chunk.tokens).toBeLessThanOrEqual(50 * 1.1); // Allow 10% buffer
      });
    });

    it('should respect maxTokens limit', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 30 });

      chunks.forEach(chunk => {
        expect(chunk.tokens).toBeLessThanOrEqual(30 * 1.1); // Allow 10% buffer for semantic boundaries
      });
    });
  });

  describe('semantic boundary handling', () => {
    it('should prefer heading boundaries over arbitrary splits', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 40 });

      // Should have chunks that align with heading structure
      const mainTitleChunk = chunks.find(
        c => c.sectionPath.includes('Main Title') && c.sectionPath.length === 1
      );
      const sectionOneChunk = chunks.find(c => c.sectionPath.includes('Section One'));

      expect(mainTitleChunk).toBeDefined();
      expect(sectionOneChunk).toBeDefined();
    });

    it('should preserve code blocks as complete units', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 30 });

      const codeChunk = chunks.find(c => c.text.includes('function example()'));
      expect(codeChunk).toBeDefined();
      expect(codeChunk?.text).toContain('function example()');
      expect(codeChunk?.text).toContain("return 'code block content';");
    });

    it('should preserve lists as complete units when possible', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 50 });

      const listChunk = chunks.find(c => c.text.includes('List item one'));
      expect(listChunk).toBeDefined();
      expect(listChunk?.text).toContain('List item one');
      expect(listChunk?.text).toContain('List item two');
      expect(listChunk?.text).toContain('List item three');
    });

    it('should maintain hierarchical context in section paths', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 25 });

      const subsectionChunk = chunks.find(c => c.text.includes('subsection with its own'));
      expect(subsectionChunk?.sectionPath).toEqual(['Main Title', 'Section One', 'Subsection A']);
    });
  });

  describe('overlap handling', () => {
    it('should add overlap between consecutive chunks', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, {
        maxTokens: 30,
        overlapPercentage: 20,
      });

      if (chunks.length > 1) {
        // Check that consecutive chunks have some overlapping content
        for (let i = 0; i < chunks.length - 1; i++) {
          const currentChunk = chunks[i];
          const nextChunk = chunks[i + 1];

          // Extract last few words from current and first few words from next
          const currentWords = currentChunk.text.trim().split(/\s+/).slice(-5);
          const nextWords = nextChunk.text.trim().split(/\s+/).slice(0, 10);

          // Should have some word overlap
          const hasOverlap = currentWords.some(word => nextWords.includes(word));
          expect(hasOverlap).toBe(true);
        }
      }
    });

    it('should respect overlapPercentage setting', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, {
        maxTokens: 40,
        overlapPercentage: 25,
      });

      if (chunks.length > 1) {
        chunks.forEach(chunk => {
          expect(chunk.overlapTokens).toBeLessThanOrEqual(Math.ceil(40 * 0.25));
        });
      }
    });

    it('should handle zero overlap correctly', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, {
        maxTokens: 30,
        overlapPercentage: 0,
      });

      chunks.forEach(chunk => {
        expect(chunk.overlapTokens).toBe(0);
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty content gracefully', () => {
      const emptyResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: '',
        semanticInfo: {
          headings: [],
          codeBlocks: [],
          lists: [],
          wordCount: 0,
          characterCount: 0,
        },
      };

      const chunks = semanticChunker.chunk(emptyResult);
      expect(chunks).toHaveLength(0);
    });

    it('should handle content with no headings', () => {
      const noHeadingsResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: 'Just plain paragraph text without any headings or structure.',
        semanticInfo: {
          headings: [],
          codeBlocks: [],
          lists: [],
          wordCount: 10,
          characterCount: 60,
        },
      };

      const chunks = semanticChunker.chunk(noHeadingsResult, { maxTokens: 20 });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].sectionPath).toEqual([]);
    });

    it('should handle very large single sections', () => {
      const largeContent = 'This is a very long paragraph. '.repeat(50); // ~1600 chars
      const largeResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Large Section\n\n${largeContent}`,
        semanticInfo: {
          headings: [{ level: 1, text: 'Large Section', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 200,
          characterCount: 1600,
        },
      };

      const chunks = semanticChunker.chunk(largeResult, { maxTokens: 50 });
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.sectionPath).toEqual(['Large Section']);
        expect(chunk.tokens).toBeLessThanOrEqual(50 * 1.2); // Allow buffer for semantic splits
      });
    });

    it('should handle mixed content with different element types', () => {
      const mixedResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Mixed Content

Paragraph before code.

\`\`\`python
def function():
    return "test"
\`\`\`

- Item 1
- Item 2

Another paragraph.

> Blockquote content here.

Final paragraph.`,
        semanticInfo: {
          headings: [{ level: 1, text: 'Mixed Content', position: 0 }],
          codeBlocks: [
            {
              language: 'python',
              content: 'def function():\n    return "test"',
              position: 50,
              length: 30,
            },
          ],
          lists: [{ content: '- Item 1\n- Item 2', position: 90, itemCount: 2 }],
          wordCount: 25,
          characterCount: 200,
        },
      };

      const chunks = semanticChunker.chunk(mixedResult, { maxTokens: 30 });
      expect(chunks.length).toBeGreaterThan(0);

      // Should preserve code block integrity
      const codeChunk = chunks.find(c => c.text.includes('def function()'));
      expect(codeChunk?.text).toContain('return "test"');
    });
  });

  describe('default configuration', () => {
    it('should use EMBEDDING_TOKENS_SIZE from environment by default', () => {
      // Mock environment variable
      const originalEnv = process.env.EMBEDDING_TOKENS_SIZE;
      process.env.EMBEDDING_TOKENS_SIZE = '256';

      const chunks = semanticChunker.chunk(mockExtractionResult);

      chunks.forEach(chunk => {
        expect(chunk.tokens).toBeLessThanOrEqual(256 * 1.1); // Allow buffer
      });

      // Restore
      if (originalEnv !== undefined) {
        process.env.EMBEDDING_TOKENS_SIZE = originalEnv;
      } else {
        delete process.env.EMBEDDING_TOKENS_SIZE;
      }
    });

    it('should use default 512 tokens when environment variable not set', () => {
      const originalEnv = process.env.EMBEDDING_TOKENS_SIZE;
      delete process.env.EMBEDDING_TOKENS_SIZE;

      const chunks = semanticChunker.chunk(mockExtractionResult);

      chunks.forEach(chunk => {
        expect(chunk.tokens).toBeLessThanOrEqual(512 * 1.1); // Allow buffer
      });

      // Restore
      if (originalEnv !== undefined) {
        process.env.EMBEDDING_TOKENS_SIZE = originalEnv;
      }
    });

    it('should use 15% overlap by default', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 40 });

      if (chunks.length > 1) {
        const hasExpectedOverlap = chunks.some(chunk => {
          const expectedOverlap = Math.ceil(40 * 0.15);
          return chunk.overlapTokens === expectedOverlap;
        });
        expect(hasExpectedOverlap).toBe(true);
      }
    });
  });

  describe('chunk ID generation', () => {
    it('should generate deterministic SHA-256 based IDs', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult);

      chunks.forEach(chunk => {
        expect(chunk.id).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
      });
    });

    it('should generate different IDs for different content', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult);
      const uniqueIds = new Set(chunks.map(c => c.id));

      expect(uniqueIds.size).toBe(chunks.length); // All IDs should be unique
    });

    it('should include URL, section path, and text in ID generation', () => {
      const url = 'https://example.com/test';
      const chunks1 = semanticChunker.chunk(mockExtractionResult, { maxTokens: 100 }, url);
      const chunks2 = semanticChunker.chunk(
        mockExtractionResult,
        { maxTokens: 100 },
        'https://example.com/different'
      );

      // Same content but different URLs should produce different IDs
      expect(chunks1[0].id).not.toBe(chunks2[0].id);
    });
  });

  describe('markdown content type handling', () => {
    it('should handle tables as atomic units when possible', () => {
      const tableResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Data Analysis

## Results Table

| Metric | Q1 | Q2 | Q3 | Q4 |
|--------|----|----|----|----|
| Revenue | $100K | $120K | $110K | $130K |
| Users | 1000 | 1200 | 1100 | 1300 |
| Conversion | 2.5% | 3.1% | 2.8% | 3.4% |

## Summary

The table above shows quarterly performance metrics.`,
        semanticInfo: {
          headings: [
            { level: 1, text: 'Data Analysis', position: 0 },
            { level: 2, text: 'Results Table', position: 20 },
            { level: 2, text: 'Summary', position: 200 },
          ],
          codeBlocks: [],
          lists: [],
          wordCount: 50,
          characterCount: 300,
        },
      };

      const chunks = semanticChunker.chunk(tableResult, { maxTokens: 50 });

      // Should keep table content together when possible
      const tableChunk = chunks.find(c => c.text.includes('| Metric |'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk?.text).toContain('| Revenue |');
      expect(tableChunk?.text).toContain('| Users |');
      expect(tableChunk?.sectionPath).toContain('Results Table');
    });

    it('should handle blockquotes within content flow', () => {
      const blockquoteResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Article

This is a regular paragraph before the quote.

> This is an important quote that spans
> multiple lines and should be preserved
> as a coherent unit.

This is content after the quote.

## Next Section

More content here.`,
        semanticInfo: {
          headings: [
            { level: 1, text: 'Article', position: 0 },
            { level: 2, text: 'Next Section', position: 150 },
          ],
          codeBlocks: [],
          lists: [],
          wordCount: 40,
          characterCount: 250,
        },
      };

      const chunks = semanticChunker.chunk(blockquoteResult, { maxTokens: 40 });

      // Should preserve blockquote content (may span chunks due to token limits)
      const quoteStartChunk = chunks.find(c => c.text.includes('> This is an important quote'));
      const quoteEndChunk = chunks.find(c => c.text.includes('coherent unit'));

      expect(quoteStartChunk).toBeDefined();
      expect(quoteStartChunk?.text).toContain('multiple lines');
      expect(quoteEndChunk).toBeDefined();
      expect(quoteEndChunk?.text).toContain('> as a coherent unit');

      // Both quote parts should be in Article section
      expect(quoteStartChunk?.sectionPath).toContain('Article');
      expect(quoteEndChunk?.sectionPath).toContain('Article');
    });

    it('should handle mixed markdown formatting (links, bold, italic)', () => {
      const formattedResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Getting Started

This is a paragraph with **bold text**, *italic text*, and [a link](https://example.com).

## Code Example

Here's some \`inline code\` and a longer example:

\`\`\`javascript
const formatted = "with **markdown** inside";
console.log(formatted);
\`\`\`

## Lists with Formatting

- **Important**: This is a bold list item
- *Note*: This is an italic list item  
- Regular item with [link](https://test.com)

That's all for now!`,
        semanticInfo: {
          headings: [
            { level: 1, text: 'Getting Started', position: 0 },
            { level: 2, text: 'Code Example', position: 80 },
            { level: 2, text: 'Lists with Formatting', position: 200 },
          ],
          codeBlocks: [
            {
              language: 'javascript',
              content: 'const formatted = "with **markdown** inside";\nconsole.log(formatted);',
              position: 150,
              length: 60,
            },
          ],
          lists: [
            {
              content:
                '- **Important**: This is a bold list item\n- *Note*: This is an italic list item\n- Regular item with [link](https://test.com)',
              position: 240,
              itemCount: 3,
            },
          ],
          wordCount: 60,
          characterCount: 400,
        },
      };

      const chunks = semanticChunker.chunk(formattedResult, { maxTokens: 60 });

      // Should preserve markdown formatting
      expect(chunks.some(c => c.text.includes('**bold text**'))).toBe(true);
      expect(chunks.some(c => c.text.includes('*italic text*'))).toBe(true);
      expect(chunks.some(c => c.text.includes('[a link](https://example.com)'))).toBe(true);
      expect(chunks.some(c => c.text.includes('`inline code`'))).toBe(true);

      // Should preserve code block with markdown inside
      const codeChunk = chunks.find(c => c.text.includes('```javascript'));
      expect(codeChunk?.text).toContain('**markdown**');
      expect(codeChunk?.sectionPath).toContain('Code Example');

      // Should preserve formatted list items
      const listChunk = chunks.find(c => c.text.includes('**Important**'));
      expect(listChunk?.text).toContain('*Note*');
      expect(listChunk?.text).toContain('[link](https://test.com)');
    });

    it('should handle nested content structures', () => {
      const nestedResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Main Topic

## Overview

Basic introduction content.

### Technical Details

#### Implementation Notes

Detailed implementation information here.

##### Edge Cases

- Case 1: When data is null
- Case 2: When timeout occurs
- Case 3: When network fails

#### Performance Considerations

> **Note**: Always benchmark your implementation
> before deploying to production.

\`\`\`bash
# Run performance tests
npm run test:performance
\`\`\`

### Next Steps

Summary and next actions.`,
        semanticInfo: {
          headings: [
            { level: 1, text: 'Main Topic', position: 0 },
            { level: 2, text: 'Overview', position: 20 },
            { level: 3, text: 'Technical Details', position: 60 },
            { level: 4, text: 'Implementation Notes', position: 100 },
            { level: 5, text: 'Edge Cases', position: 150 },
            { level: 4, text: 'Performance Considerations', position: 250 },
            { level: 3, text: 'Next Steps', position: 400 },
          ],
          codeBlocks: [
            {
              language: 'bash',
              content: '# Run performance tests\nnpm run test:performance',
              position: 350,
              length: 40,
            },
          ],
          lists: [
            {
              content:
                '- Case 1: When data is null\n- Case 2: When timeout occurs\n- Case 3: When network fails',
              position: 180,
              itemCount: 3,
            },
          ],
          wordCount: 70,
          characterCount: 500,
        },
      };

      const chunks = semanticChunker.chunk(nestedResult, { maxTokens: 50 });

      // Should maintain hierarchical context
      const edgeCasesChunk = chunks.find(c => c.sectionPath.includes('Edge Cases'));
      expect(edgeCasesChunk?.sectionPath).toEqual([
        'Main Topic',
        'Overview',
        'Technical Details',
        'Implementation Notes',
        'Edge Cases',
      ]);

      const performanceChunk = chunks.find(c =>
        c.sectionPath.includes('Performance Considerations')
      );
      expect(performanceChunk?.sectionPath).toEqual([
        'Main Topic',
        'Overview',
        'Technical Details',
        'Performance Considerations',
      ]);

      // Should preserve deep nesting relationships
      expect(chunks.some(c => c.sectionPath.length >= 4)).toBe(true); // At least 4 levels deep
    });

    it('should handle tables that exceed token limits', () => {
      const largeTableResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Database Schema

## User Table

| Column | Type | Description | Constraints | Default | Index |
|--------|------|-------------|-------------|---------|-------|
| id | INTEGER | Primary key identifier | NOT NULL, PRIMARY KEY | AUTO_INCREMENT | CLUSTERED |
| email | VARCHAR(255) | User email address | NOT NULL, UNIQUE | NULL | INDEX |
| password_hash | VARCHAR(255) | Encrypted password | NOT NULL | NULL | NONE |
| first_name | VARCHAR(100) | User first name | NULL | NULL | NONE |
| last_name | VARCHAR(100) | User last name | NULL | NULL | NONE |
| created_at | TIMESTAMP | Record creation time | NOT NULL | CURRENT_TIMESTAMP | INDEX |
| updated_at | TIMESTAMP | Last update time | NOT NULL | CURRENT_TIMESTAMP ON UPDATE | INDEX |
| is_active | BOOLEAN | Account status | NOT NULL | TRUE | INDEX |
| role | ENUM | User role type | NOT NULL | 'user' | INDEX |

This table contains all user information for the application.`,
        semanticInfo: {
          headings: [
            { level: 1, text: 'Database Schema', position: 0 },
            { level: 2, text: 'User Table', position: 30 },
          ],
          codeBlocks: [],
          lists: [],
          wordCount: 120,
          characterCount: 800,
        },
      };

      const chunks = semanticChunker.chunk(largeTableResult, { maxTokens: 50 });

      // Should split large table when necessary but maintain context
      expect(chunks.length).toBeGreaterThan(1);
      const tableChunks = chunks.filter(c => c.text.includes('|'));
      expect(tableChunks.length).toBeGreaterThan(0);

      // All table chunks should have same section path
      tableChunks.forEach(chunk => {
        expect(chunk.sectionPath).toContain('User Table');
      });
    });

    it('should preserve horizontal rules and separators', () => {
      const separatorResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Document

First section content.

---

Second section after horizontal rule.

***

Third section after different separator.

___

Final section content.`,
        semanticInfo: {
          headings: [{ level: 1, text: 'Document', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 20,
          characterCount: 150,
        },
      };

      const chunks = semanticChunker.chunk(separatorResult, { maxTokens: 30 });

      // Should preserve horizontal rules in content
      expect(chunks.some(c => c.text.includes('---'))).toBe(true);
      expect(chunks.some(c => c.text.includes('***'))).toBe(true);
      expect(chunks.some(c => c.text.includes('___'))).toBe(true);
    });

    it('should handle mixed content with all markdown types', () => {
      const comprehensiveResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Complete Guide

This guide covers **everything** you need to know.

## Quick Start

1. First step
2. Second step
3. Third step

### Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | LTS recommended |
| npm | 8+ | Package manager |

### Installation

\`\`\`bash
npm install my-package
cd my-package
npm start
\`\`\`

> **Warning**: Make sure to read the documentation
> before proceeding with installation.

## Advanced Usage

- **Option A**: For beginners
- **Option B**: For advanced users
  - Sub-option 1
  - Sub-option 2

### Code Examples

Here's some \`inline code\` and a full example:

\`\`\`javascript
// Example usage
const result = await myPackage.process({
  input: "test data",
  options: {
    format: "json",
    validate: true
  }
});
\`\`\`

---

## Conclusion

That's it! You're ready to go.`,
        semanticInfo: {
          headings: [
            { level: 1, text: 'Complete Guide', position: 0 },
            { level: 2, text: 'Quick Start', position: 50 },
            { level: 3, text: 'Requirements', position: 100 },
            { level: 3, text: 'Installation', position: 200 },
            { level: 2, text: 'Advanced Usage', position: 350 },
            { level: 3, text: 'Code Examples', position: 450 },
            { level: 2, text: 'Conclusion', position: 600 },
          ],
          codeBlocks: [
            {
              language: 'bash',
              content: 'npm install my-package\ncd my-package\nnpm start',
              position: 220,
              length: 40,
            },
            {
              language: 'javascript',
              content:
                '// Example usage\nconst result = await myPackage.process({\n  input: "test data",\n  options: {\n    format: "json",\n    validate: true\n  }\n});',
              position: 500,
              length: 120,
            },
          ],
          lists: [
            { content: '1. First step\n2. Second step\n3. Third step', position: 70, itemCount: 3 },
            {
              content:
                '- **Option A**: For beginners\n- **Option B**: For advanced users\n  - Sub-option 1\n  - Sub-option 2',
              position: 380,
              itemCount: 4,
            },
          ],
          wordCount: 150,
          characterCount: 1000,
        },
      };

      const chunks = semanticChunker.chunk(comprehensiveResult, { maxTokens: 80 });

      expect(chunks.length).toBeGreaterThan(3); // Should produce multiple chunks

      // Verify all content types are preserved
      const allText = chunks.map(c => c.text).join(' ');
      expect(allText).toContain('**everything**'); // Bold
      expect(allText).toContain('`inline code`'); // Inline code
      expect(allText).toContain('| Requirement |'); // Table
      expect(allText).toContain('```bash'); // Code block
      expect(allText).toContain('> **Warning**'); // Blockquote
      expect(allText).toContain('1. First step'); // Ordered list
      expect(allText).toContain('- **Option A**'); // Unordered list
      expect(allText).toContain('---'); // Horizontal rule

      // Verify section paths are maintained correctly
      const installationChunk = chunks.find(c => c.sectionPath.includes('Installation'));
      expect(installationChunk?.sectionPath).toEqual([
        'Complete Guide',
        'Quick Start',
        'Installation',
      ]);

      const codeChunk = chunks.find(c => c.sectionPath.includes('Code Examples'));
      expect(codeChunk?.sectionPath).toEqual(['Complete Guide', 'Advanced Usage', 'Code Examples']);
    });
  });

  describe('performance and scalability', () => {
    it('should handle large content efficiently', () => {
      const largeContent = 'This is a sentence with multiple words. '.repeat(1000); // ~40KB
      const largeResult: ExtractionResult = {
        ...mockExtractionResult,
        markdownContent: `# Large Document\n\n${largeContent}`,
        semanticInfo: {
          headings: [{ level: 1, text: 'Large Document', position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 8000,
          characterCount: 40000,
        },
      };

      const startTime = Date.now();
      const chunks = semanticChunker.chunk(largeResult);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      expect(chunks.length).toBeGreaterThan(10); // Should produce multiple chunks
    });

    it('should produce reasonable chunk counts for typical content', () => {
      const chunks = semanticChunker.chunk(mockExtractionResult);

      // For the mock content (~500 chars, ~125 tokens), should produce 1-3 chunks with default 512 token limit
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('code blocks', () => {
    describe('when malformed', () => {
      test('should handle unclosed code blocks without consuming entire document', () => {
        const mockExtractionResult: ExtractionResult = {
          title: 'Malformed Code',
          textContent: 'Before code block. Here is some code that lacks closing. After code block content that should not be consumed.',
          markdownContent: `# Test Document

Before code block with quite a lot of content to ensure multiple chunks are created when we have proper token limits.

\`\`\`javascript
function broken() {
  return "this code block has no closing and contains substantial content";
  // This comment adds more content to make sure we exceed token limits
  const data = "more content here to ensure chunking happens properly";

After code block content that should not be consumed by the unclosed code block parsing bug.
This is additional content that proves the parser recovered correctly.

## Next Section
This should still be processed normally and appear in a separate chunk.
More content to ensure we have enough tokens to create multiple chunks in this test case.`,
          excerpt: '',
          sectionPaths: ['Test Document'],
          lang: 'en',
          extractionMethod: 'cheerio',
          semanticInfo: {
            headings: [
              { text: 'Test Document', level: 1, position: 0 },
              { text: 'Next Section', level: 2, position: 100 }
            ],
            codeBlocks: [],
            lists: [],
            wordCount: 25,
            characterCount: 200,
          },
        };

        const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 50 });

        // Should produce multiple chunks, not one massive chunk
        expect(chunks.length).toBeGreaterThan(1);
        
        // Verify the unclosed code block didn't consume everything after it
        const combinedText = chunks.map(c => c.text).join(' ');
        expect(combinedText).toContain('Next Section');
        expect(combinedText).toContain('processed normally');
      });
    });
  });

  describe('tables', () => {
    test('should preserve tables as atomic units', () => {
      const mockExtractionResult: ExtractionResult = {
        title: 'Table Test',
        textContent: 'Content with tables',
        markdownContent: `# Document with Table

Before table content.

| Name | Age | City |
|------|-----|------|
| John | 25  | NYC  |
| Jane | 30  | LA   |
| Bob  | 35  | Chicago |

After table content that should be in next chunk.

## Next Section
More content here.`,
        excerpt: '',
        sectionPaths: ['Document with Table'],
        lang: 'en',
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [
            { text: 'Document with Table', level: 1, position: 0 },
            { text: 'Next Section', level: 2, position: 120 }
          ],
          codeBlocks: [],
          lists: [],
          wordCount: 30,
          characterCount: 250,
        },
      };

      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 50 });

      // Should create multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Find the chunk containing the table
      const tableChunk = chunks.find(chunk => chunk.text.includes('| Name | Age | City |'));
      expect(tableChunk).toBeDefined();

      // Table should be complete in one chunk (not split)
      expect(tableChunk!.text).toContain('| John | 25  | NYC  |');
      expect(tableChunk!.text).toContain('| Jane | 30  | LA   |');
      expect(tableChunk!.text).toContain('| Bob  | 35  | Chicago |');
    });
  });

  describe('blockquotes', () => {
    test('should preserve blockquotes as atomic units', () => {
      const mockExtractionResult: ExtractionResult = {
        title: 'Blockquote Test',
        textContent: 'Content with blockquotes',
        markdownContent: `# Document with Blockquote

Before blockquote.

> This is a famous quote that spans multiple lines
> and contains important context that should not
> be split across chunks for semantic coherence.
> - Famous Author

After blockquote content.`,
        excerpt: '',
        sectionPaths: ['Document with Blockquote'],
        lang: 'en',
        extractionMethod: 'cheerio',
        semanticInfo: {
          headings: [{ text: 'Document with Blockquote', level: 1, position: 0 }],
          codeBlocks: [],
          lists: [],
          wordCount: 25,
          characterCount: 180,
        },
      };

      const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 30 });

      // Find chunk containing blockquote
      const quoteChunk = chunks.find(chunk => chunk.text.includes('> This is a famous quote'));
      expect(quoteChunk).toBeDefined();

      // Entire blockquote should be preserved together
      expect(quoteChunk!.text).toContain('spans multiple lines');
      expect(quoteChunk!.text).toContain('semantic coherence');
      expect(quoteChunk!.text).toContain('- Famous Author');
    });
  });

  describe('sentence splitting', () => {
    describe('when text contains abbreviations', () => {
      test('should not split on common abbreviations', () => {
        const mockExtractionResult: ExtractionResult = {
          title: 'Abbreviation Test',
          textContent: 'Content with abbreviations',
          markdownContent: `# Abbreviation Test

Dr. Smith went to the U.S. capital. Mr. Johnson met Prof. Brown at the university. 
The Ph.D. student studied B.A. requirements. They discussed e.g. various topics vs. traditional methods.

This should be a separate sentence after proper abbreviation handling.`,
          excerpt: '',
          sectionPaths: ['Abbreviation Test'],
          lang: 'en',
          extractionMethod: 'cheerio',
          semanticInfo: {
            headings: [{ text: 'Abbreviation Test', level: 1, position: 0 }],
            codeBlocks: [],
            lists: [],
            wordCount: 30,
            characterCount: 200,
          },
        };

        const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 40 });

        // Should split properly at real sentence boundaries, not abbreviations
        expect(chunks.length).toBeGreaterThan(1);
        
        // Check that abbreviations don't cause improper splits
        const combinedText = chunks.map(c => c.text).join(' ');
        expect(combinedText).toContain('Dr. Smith');
        expect(combinedText).toContain('U.S. capital');
        expect(combinedText).toContain('Mr. Johnson');
        expect(combinedText).toContain('Prof. Brown');
        expect(combinedText).toContain('Ph.D. student');
        expect(combinedText).toContain('separate sentence after proper');
      });
    });
  });

  describe('overlap boundaries', () => {
    describe('when creating overlaps', () => {
      test('should prefer sentence boundaries over word boundaries', () => {
        const mockExtractionResult: ExtractionResult = {
          title: 'Overlap Test',
          textContent: 'Content for overlap testing',
          markdownContent: `# Overlap Boundary Test

First sentence with important context. Second sentence that provides continuity. 
Third sentence that should appear in overlap.

Fourth sentence starts new chunk. Fifth sentence continues the narrative. 
Sixth sentence concludes the section.`,
          excerpt: '',
          sectionPaths: ['Overlap Boundary Test'],
          lang: 'en',
          extractionMethod: 'cheerio',
          semanticInfo: {
            headings: [{ text: 'Overlap Boundary Test', level: 1, position: 0 }],
            codeBlocks: [],
            lists: [],
            wordCount: 30,
            characterCount: 250,
          },
        };

        const chunks = semanticChunker.chunk(mockExtractionResult, { 
          maxTokens: 40, 
          overlapPercentage: 20 
        });

        expect(chunks.length).toBeGreaterThan(1);

        // Check that overlaps contain complete sentences, not partial words
        for (let i = 1; i < chunks.length; i++) {
          if (chunks[i].overlapTokens > 0) {
            const chunkLines = chunks[i].text.split('\n');
            const firstLine = chunkLines[0];
            
            // Overlap should not start with a partial word or broken sentence
            expect(firstLine).not.toMatch(/^\w+$/); // Should not be just a single word
            
            // If there's overlap, it should contain complete sentences
            if (chunks[i].overlapTokens > 5) {
              expect(firstLine).toMatch(/[.!?]|\w+\s+\w+/); // Should have sentence structure
            }
          }
        }
      });
    });
  });

  describe('complex scenarios', () => {
    describe('when content has mixed malformed elements', () => {
      test('should handle all types of malformed content gracefully', () => {
        const mockExtractionResult: ExtractionResult = {
          title: 'Stress Test',
          textContent: 'Mixed malformed content',
          markdownContent: `# Stress Test Document

Normal content before issues.

\`\`\`javascript
// Unclosed code block
function incomplete() {
  return "missing closing";

## Header After Unclosed Code

> Blockquote with important context
> that spans multiple lines

| Malformed | Table |
|-----------|
| Missing | Cell |
| Another | Row

More content with Mr. Smith and Dr. Johnson vs. Prof. Brown.

\`\`\`python
# Properly closed code block  
print("this one is correct")
\`\`\`

Final content.`,
          excerpt: '',
          sectionPaths: ['Stress Test Document'],
          lang: 'en',
          extractionMethod: 'cheerio',
          semanticInfo: {
            headings: [
              { text: 'Stress Test Document', level: 1, position: 0 },
              { text: 'Header After Unclosed Code', level: 2, position: 150 }
            ],
            codeBlocks: [
              { language: 'python', content: 'print("this one is correct")', position: 300, length: 35 }
            ],
            lists: [],
            wordCount: 50,
            characterCount: 400,
          },
        };

        const chunks = semanticChunker.chunk(mockExtractionResult, { maxTokens: 80 });

        // Should handle all malformed content gracefully
        expect(chunks.length).toBeGreaterThan(1);
        
        const combinedText = chunks.map(c => c.text).join(' ');
        
        // All content should be preserved
        expect(combinedText).toContain('Normal content before');
        expect(combinedText).toContain('Header After Unclosed Code');
        expect(combinedText).toContain('Blockquote with important');
        expect(combinedText).toContain('Malformed | Table');
        expect(combinedText).toContain('Mr. Smith and Dr. Johnson');
        expect(combinedText).toContain('print("this one is correct")');
        expect(combinedText).toContain('Final content');
        
        // Should not have any chunk that's unreasonably large due to parsing bugs
        chunks.forEach(chunk => {
          expect(chunk.tokens).toBeLessThan(200); // No chunk should be massive
        });
      });
    });
  });
});
