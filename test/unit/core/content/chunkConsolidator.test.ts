import { describe, test, expect } from '@jest/globals';
import {
  consolidateOverlappingChunks,
  type ConsolidatableChunk,
} from '../../../../src/core/content/chunkConsolidator';

describe('ChunkConsolidator', () => {
  describe('consolidateOverlappingChunks', () => {
    test('should return empty array for empty input', () => {
      const result = consolidateOverlappingChunks([]);
      expect(result).toEqual([]);
    });

    test('should return single chunk unchanged', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'This is a standalone chunk with no overlaps.',
          score: 0.95,
          section_path: 'h1|Introduction',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'chunk-1',
        text: 'This is a standalone chunk with no overlaps.',
        score: 0.95,
        section_path: 'h1|Introduction',
        sourceChunkIds: ['chunk-1'],
      });
    });

    test('should keep non-overlapping chunks separate', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'This is the first chunk about artificial intelligence.',
          score: 0.9,
          section_path: 'h1|AI',
        },
        {
          id: 'chunk-2',
          text: 'This is the second chunk about machine learning.',
          score: 0.85,
          section_path: 'h1|ML',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(2);
      expect(result[0].score).toBeGreaterThan(result[1].score); // Should be sorted by score
      expect(result[0].sourceChunkIds).toEqual(['chunk-1']);
      expect(result[1].sourceChunkIds).toEqual(['chunk-2']);
    });

    test('should consolidate chunks with significant text overlap', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'Machine learning is a subset of artificial intelligence that enables computers to learn and improve from experience without being explicitly programmed.',
          score: 0.92,
          section_path: 'h1|Introduction',
        },
        {
          id: 'chunk-2',
          text: 'that enables computers to learn and improve from experience without being explicitly programmed. It focuses on the development of algorithms and statistical models.',
          score: 0.88,
          section_path: 'h1|Introduction',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('Machine learning is a subset');
      expect(result[0].text).toContain('statistical models');
      expect(result[0].sourceChunkIds).toHaveLength(2);
      expect(result[0].score).toBeCloseTo(0.9, 1); // Weighted average
    });

    test('should group chunks by section path before consolidation', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'Introduction to AI starts here. Artificial intelligence is fascinating.',
          score: 0.9,
          section_path: 'h1|Introduction',
        },
        {
          id: 'chunk-2',
          text: 'Methods include supervised learning. Machine learning algorithms are powerful.',
          score: 0.85,
          section_path: 'h1|Methods',
        },
        {
          id: 'chunk-3',
          text: 'Artificial intelligence is fascinating. It has many applications in modern technology.',
          score: 0.88,
          section_path: 'h1|Introduction',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      // Should have 2 results: one for Introduction section (merged) and one for Methods
      expect(result).toHaveLength(2);

      const introResult = result.find(r => r.section_path === 'h1|Introduction');
      const methodsResult = result.find(r => r.section_path === 'h1|Methods');

      expect(introResult).toBeDefined();
      expect(methodsResult).toBeDefined();
      expect(introResult!.sourceChunkIds).toHaveLength(2); // Merged from chunk-1 and chunk-3
      expect(methodsResult!.sourceChunkIds).toHaveLength(1); // Single chunk
    });

    test('should handle chunks without section paths', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'Content without section path. This is some generic text content.',
          score: 0.8,
        },
        {
          id: 'chunk-2',
          text: 'Another chunk without section path. Different content here.',
          score: 0.75,
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(2); // No overlap, should stay separate
      expect(result[0].section_path).toBeUndefined();
      expect(result[1].section_path).toBeUndefined();
    });

    test('should calculate weighted average scores correctly', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'This is a substantial piece of content that provides meaningful context.',
          score: 1.0,
          section_path: 'h1|Test',
        },
        {
          id: 'chunk-2',
          text: 'This is a substantial piece of content that provides meaningful context. Additional content with more detailed information and extended explanations.',
          score: 0.8,
          section_path: 'h1|Test',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      // Weighted average should be closer to 0.8 due to longer chunk having more weight
      expect(result[0].score).toBeLessThan(0.9);
      expect(result[0].score).toBeGreaterThan(0.8);
    });

    test('should preserve highest scoring chunks in final ordering', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'Low scoring content about topic A.',
          score: 0.6,
          section_path: 'h1|TopicA',
        },
        {
          id: 'chunk-2',
          text: 'High scoring content about topic B.',
          score: 0.95,
          section_path: 'h1|TopicB',
        },
        {
          id: 'chunk-3',
          text: 'Medium scoring content about topic C.',
          score: 0.8,
          section_path: 'h1|TopicC',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(3);
      expect(result[0].score).toBe(0.95); // Highest first
      expect(result[1].score).toBe(0.8); // Medium second
      expect(result[2].score).toBe(0.6); // Lowest last
    });

    test('should handle complex multi-chunk overlap scenario', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'Neural networks are a fundamental component of machine learning and artificial intelligence systems.',
          score: 0.9,
          section_path: 'h1|Networks',
        },
        {
          id: 'chunk-2',
          text: 'machine learning and artificial intelligence systems. They consist of interconnected nodes called neurons that process information.',
          score: 0.85,
          section_path: 'h1|Networks',
        },
        {
          id: 'chunk-3',
          text: 'interconnected nodes called neurons that process information. Deep learning uses multiple layers of these complex neural networks.',
          score: 0.88,
          section_path: 'h1|Networks',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('Neural networks');
      expect(result[0].text).toContain('interconnected nodes');
      expect(result[0].text).toContain('Deep learning');
      expect(result[0].sourceChunkIds).toHaveLength(3);
    });

    test('should not consolidate chunks with minimal overlap', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-1',
          text: 'This is a longer piece of text about artificial intelligence and its applications.',
          score: 0.9,
          section_path: 'h1|AI',
        },
        {
          id: 'chunk-2',
          text: 'This is completely different content about blockchain technology and cryptocurrencies.',
          score: 0.85,
          section_path: 'h1|AI', // Same section but no meaningful overlap
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      // Should remain separate due to insufficient overlap
      expect(result).toHaveLength(2);
      expect(result[0].sourceChunkIds).toHaveLength(1);
      expect(result[1].sourceChunkIds).toHaveLength(1);
    });

    test('should generate appropriate composite IDs for merged chunks', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'chunk-alpha',
          text: 'Beginning of the content that will be merged with subsequent chunks.',
          score: 0.9,
          section_path: 'h1|Merged',
        },
        {
          id: 'chunk-beta',
          text: 'merged with subsequent chunks. This continues the narrative flow.',
          score: 0.85,
          section_path: 'h1|Merged',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0].id).toMatch(/^consolidated-/);
      expect(result[0].id).toContain('chunk-alpha');
      expect(result[0].id).toContain('chunk-beta');
    });
  });

  describe('Markdown-Aware Consolidation', () => {
    test('should prioritize chunks with substantive text over pure markdown structure', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'structure-chunk',
          text: '# Introduction\n## Overview\n### Details\n```javascript\nconsole.log("example");\n```',
          score: 0.95,
          section_path: 'h1|Introduction',
        },
        {
          id: 'content-chunk',
          text: 'This is substantive explanatory content that provides meaningful context and detailed information for AI agents to understand the concepts being discussed.',
          score: 0.85,
          section_path: 'h1|Introduction',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      // Should include both structure and content
      expect(result[0].text).toContain('Introduction');
      expect(result[0].text).toContain('substantive explanatory content');
      expect(result[0].sourceChunkIds).toHaveLength(2);
    });

    test('should consolidate when both chunks have substantive text content', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'content-1',
          text: 'Machine learning algorithms require substantial training data to achieve good performance. The quality and quantity of data directly impacts model accuracy.',
          score: 0.9,
          section_path: 'h1|ML',
        },
        {
          id: 'content-2',
          text: 'The quality and quantity of data directly impacts model accuracy. Data preprocessing steps include cleaning, normalization, and feature engineering.',
          score: 0.85,
          section_path: 'h1|ML',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('Machine learning algorithms');
      expect(result[0].text).toContain('feature engineering');
      expect(result[0].sourceChunkIds).toHaveLength(2);
    });

    test('should not consolidate purely structural chunks without meaningful overlap', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'structure-1',
          text: '# Section A\n## Subsection 1\n### Detail Level',
          score: 0.9,
          section_path: 'h1|StructureA',
        },
        {
          id: 'structure-2',
          text: '# Section B\n```python\ndef example():\n    return "hello"\n```\n| Col 1 | Col 2 |\n|-------|-------|',
          score: 0.85,
          section_path: 'h1|StructureB',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      // Should remain separate since they're different sections with no content overlap
      expect(result).toHaveLength(2);
      expect(result[0].sourceChunkIds).toHaveLength(1);
      expect(result[1].sourceChunkIds).toHaveLength(1);
    });

    test('should handle mixed markdown with overlapping substantive content', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'mixed-1',
          text: '# API Documentation\n\nThe REST API provides comprehensive access to user data and system functionality. Authentication is required for all endpoints.',
          score: 0.9,
          section_path: 'h1|API',
        },
        {
          id: 'mixed-2',
          text: 'Authentication is required for all endpoints. Use Bearer tokens in the Authorization header.\n\n## Endpoints\n\n- GET /users\n- POST /users',
          score: 0.88,
          section_path: 'h1|API',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('API Documentation');
      expect(result[0].text).toContain('comprehensive access');
      expect(result[0].text).toContain('Bearer tokens');
      expect(result[0].text).toContain('GET /users');
      expect(result[0].sourceChunkIds).toHaveLength(2);
    });

    test('should preserve structural chunks when they contain valuable information', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'code-example',
          text: '```typescript\ninterface User {\n  id: string;\n  name: string;\n  email: string;\n}\n```',
          score: 0.9,
          section_path: 'h1|Types',
        },
        {
          id: 'explanation',
          text: 'The User interface defines the core data structure for user management. Each user must have a unique identifier and contact information.',
          score: 0.85,
          section_path: 'h1|Types',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('interface User');
      expect(result[0].text).toContain('core data structure');
      expect(result[0].sourceChunkIds).toHaveLength(2);
    });

    test('should maintain separate chunks when no meaningful relationship exists', () => {
      const chunks: ConsolidatableChunk[] = [
        {
          id: 'heading-only',
          text: '# Completely Different Topic\n## Another Heading',
          score: 0.7,
          section_path: 'h1|TopicA',
        },
        {
          id: 'content-only',
          text: 'This discusses an entirely different subject with no relationship to the headings above. The content is about database optimization techniques.',
          score: 0.8,
          section_path: 'h1|TopicB',
        },
      ];

      const result = consolidateOverlappingChunks(chunks);

      // Should remain separate - different sections, no overlap
      expect(result).toHaveLength(2);
      expect(result[0].score).toBeGreaterThan(result[1].score); // Sorted by score
    });
  });
});
