import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { EmbeddingIntegrationService } from '../../src/core/vector/embeddingIntegrationService';
import { clearEmbeddingConfig } from '../../src/core/vector/store/meta';
import type { ContentChunk } from '../../src/core/content/chunker';
import type { EmbeddingProvider } from '../../src/core/vector/embeddingProvider';

// Mock embedding provider that creates predictable embeddings for testing
class MockEmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    // Create deterministic embeddings based on text length and content
    return texts.map(text => {
      const len = text.length;
      return [len / 100, (len % 10) / 10, text.charCodeAt(0) / 1000];
    });
  }

  getDimension(): number {
    return 3;
  }

  getModelName(): string {
    return 'mock-embedding-model';
  }

  async close(): Promise<void> {
    // No cleanup needed
  }
}

describe('Embedding Integration (End-to-End)', () => {
  let service: EmbeddingIntegrationService | null = null;

  beforeAll(async () => {
    // Clear any existing embedding config to start fresh
    await clearEmbeddingConfig();
  });

  beforeEach(() => {
    // Create fresh service instance for each test
    const mockProvider = new MockEmbeddingProvider();
    service = new EmbeddingIntegrationService(mockProvider);
  });

  afterEach(async () => {
    // Always cleanup service instances to prevent connection leaks
    if (service) {
      await service.close();
      service = null;
    }
  });

  afterAll(async () => {
    // Final cleanup of global state
    await clearEmbeddingConfig();
  });

  test('should store chunks with embeddings and enable similarity search', async () => {
    expect(service).not.toBeNull();

    const url = 'https://integration-test.com/article';

    // Create test chunks with diverse content
    const chunks: ContentChunk[] = [
      {
        id: 'chunk-1',
        text: 'Artificial intelligence is transforming modern technology',
        tokens: 50,
        overlapTokens: 0,
        sectionPath: ['Introduction', 'AI Overview'],
      },
      {
        id: 'chunk-2',
        text: 'Machine learning algorithms enable pattern recognition',
        tokens: 45,
        overlapTokens: 5,
        sectionPath: ['Technical Details', 'ML Algorithms'],
      },
      {
        id: 'chunk-3',
        text: 'Deep neural networks process complex data structures',
        tokens: 48,
        overlapTokens: 3,
        sectionPath: ['Technical Details', 'Neural Networks'],
      },
    ];

    // Store chunks with embeddings
    await service!.storeWithEmbeddings(url, chunks);

    // Test similarity search with query similar to chunk-1
    const similarQuery = 'artificial intelligence technology';
    const results = await service!.searchSimilar(url, similarQuery, 5);

    // Verify results
    expect(results).toHaveLength(3); // All chunks should be returned
    expect(results[0].id).toMatch(/chunk-[1-3]/); // One of the chunks should be first
    expect(results[0].text).toBeDefined(); // Should have text content
    expect(results[0].score).toBeGreaterThan(0);

    // Verify section paths are preserved (order may vary based on similarity scores)
    const sectionPaths = results.map(r => r.section_path);
    expect(sectionPaths).toContain('Introduction > AI Overview');
    expect(sectionPaths).toContain('Technical Details > ML Algorithms');
    expect(sectionPaths).toContain('Technical Details > Neural Networks');

    // Test search with query similar to chunk-2
    const mlQuery = 'machine learning patterns';
    const mlResults = await service!.searchSimilar(url, mlQuery, 5);

    expect(mlResults).toHaveLength(3);
    // Verify we get results with content (order may vary)
    expect(mlResults[0].text).toBeDefined();
    // Verify ML-related content exists in results
    const hasMLContent = mlResults.some(result => result.text.includes('Machine learning'));
    expect(hasMLContent).toBe(true);
  });

  test('should handle different embedding dimensions gracefully', async () => {
    // Create a different provider with different dimensions
    class HighDimensionProvider {
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map(text => {
          // Create 5-dimensional embeddings
          const len = text.length;
          return [
            len / 100,
            (len % 10) / 10,
            text.charCodeAt(0) / 1000,
            text.charCodeAt(Math.floor(len / 2)) / 1000,
            ((len * 7) % 100) / 100,
          ];
        });
      }

      getDimension(): number {
        return 5;
      }

      getModelName(): string {
        return 'high-dimension-mock-model';
      }

      async close(): Promise<void> {}
    }

    // This should fail because we already have a 3D embedding config
    const highDimProvider = new HighDimensionProvider();
    const highDimService = new EmbeddingIntegrationService(highDimProvider);

    const chunks: ContentChunk[] = [
      {
        id: 'chunk-hd-1',
        text: 'Test chunk for high dimension',
        tokens: 30,
        overlapTokens: 0,
        sectionPath: ['Test'],
      },
    ];

    // This should throw because of model mismatch (dimension check happens after model check)
    await expect(highDimService.storeWithEmbeddings('https://test-hd.com', chunks)).rejects.toThrow(
      /model mismatch|dimension mismatch/i
    );

    await highDimService.close();
  });

  test('should handle empty section paths correctly', async () => {
    expect(service).not.toBeNull();

    const url = 'https://empty-sections.com';
    const chunks: ContentChunk[] = [
      {
        id: 'chunk-empty-1',
        text: 'Content without section hierarchy',
        tokens: 35,
        overlapTokens: 0,
        sectionPath: [], // Empty section path
      },
    ];

    // Should not throw
    await service!.storeWithEmbeddings(url, chunks);

    // Search should work
    const results = await service!.searchSimilar(url, 'content hierarchy', 1);
    expect(results).toHaveLength(1);
    expect(results[0].section_path).toBeFalsy(); // Should be null or undefined for empty paths
  });

  test('should maintain consistency across multiple batches', async () => {
    expect(service).not.toBeNull();

    const url = 'https://batch-test.com';

    // Create a large number of chunks to trigger batching
    const chunks: ContentChunk[] = Array.from({ length: 250 }, (_, i) => ({
      id: `batch-chunk-${i}`,
      text: `Batch test content number ${i} with unique characteristics`,
      tokens: 40 + (i % 10),
      overlapTokens: i % 5,
      sectionPath: [`Section ${Math.floor(i / 50)}`, `Subsection ${i % 10}`],
    }));

    // Store all chunks
    await service!.storeWithEmbeddings(url, chunks);

    // Verify we can search across all batches
    const results = await service!.searchSimilar(url, 'batch test content', 10);
    expect(results).toHaveLength(10); // Should get top 10 matches

    // All results should have valid section paths
    results.forEach(result => {
      expect(result.section_path).toBeDefined();
      expect(result.section_path).toContain('Section');
      expect(result.text).toContain('Batch test content');
    });
  });
});
