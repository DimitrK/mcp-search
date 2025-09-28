import type { ExtractionResult } from './types/extraction';
import { stableChunkId } from '../../utils/contentHash';

export interface ContentChunk {
  id: string;
  text: string;
  tokens: number;
  sectionPath: string[];
  overlapTokens: number;
}

export interface ChunkingOptions {
  maxTokens?: number;
  overlapPercentage?: number;
}

interface ContentBlock {
  text: string;
  sectionPath: string[];
  type: 'heading' | 'paragraph' | 'code' | 'list' | 'table' | 'blockquote' | 'other';
  position: number;
  canSplit: boolean; // Whether this block can be split across chunks
}

class SemanticChunker {
  private readonly DEFAULT_MAX_TOKENS = 512;
  private readonly DEFAULT_OVERLAP_PERCENTAGE = 15;
  private readonly CHARS_PER_TOKEN = 4;

  /**
   * Chunk extraction result into semantic blocks
   */
  chunk(
    extractionResult: ExtractionResult,
    options: ChunkingOptions = {},
    url = 'unknown'
  ): ContentChunk[] {
    const maxTokens = options.maxTokens ?? this.getMaxTokensFromEnv();
    const overlapPercentage = options.overlapPercentage ?? this.DEFAULT_OVERLAP_PERCENTAGE;

    // Handle empty content
    if (!extractionResult.markdownContent?.trim()) {
      return [];
    }

    // Parse content into structured blocks
    const blocks = this.parseIntoBlocks(extractionResult);

    if (blocks.length === 0) {
      return [];
    }

    // Adjust max tokens for chunking to account for overlap that will be added
    const expectedOverlapTokens = Math.ceil(maxTokens * (overlapPercentage / 100));
    const chunkingMaxTokens = Math.max(
      maxTokens - expectedOverlapTokens,
      Math.ceil(maxTokens * 0.7)
    );

    // Group blocks into chunks respecting token limits and semantic boundaries
    const rawChunks = this.groupBlocksIntoChunks(blocks, chunkingMaxTokens);

    // Add overlap between consecutive chunks
    const chunksWithOverlap = this.addOverlapBetweenChunks(rawChunks, overlapPercentage);

    // Generate stable IDs and final chunk objects
    return chunksWithOverlap.map(chunkData => {
      const tokens = this.estimateTokens(chunkData.text);
      const id = this.generateChunkId(url, chunkData.sectionPath, chunkData.text);

      return {
        id,
        text: chunkData.text.trim(),
        tokens,
        sectionPath: chunkData.sectionPath,
        overlapTokens: chunkData.overlapTokens,
      };
    });
  }

  /**
   * Parse markdown and semantic info into structured content blocks
   */
  private parseIntoBlocks(extractionResult: ExtractionResult): ContentBlock[] {
    const { markdownContent, semanticInfo } = extractionResult;

    if (!semanticInfo) {
      // Fallback: treat entire content as single block
      return [
        {
          text: markdownContent,
          sectionPath: [],
          type: 'other',
          position: 0,
          canSplit: true,
        },
      ];
    }

    const blocks: ContentBlock[] = [];
    const lines = markdownContent.split('\n');
    let currentPosition = 0;
    let currentSectionPath: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const linePosition = currentPosition;
      currentPosition += line.length + 1; // +1 for newline

      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      // Check if this line starts a heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();

        // Update section path based on heading hierarchy
        currentSectionPath = this.updateSectionPath(currentSectionPath, level, text);

        // Don't add heading as separate block - it's part of section context
        continue;
      }

      // Check for code blocks
      const codeBlockStart = line.match(/^```(\w+)?$/);
      if (codeBlockStart) {
        const codeLines = [line];
        i++; // Move to content after opening ```

        // Collect code block content
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          currentPosition += lines[i].length + 1;
          i++;
        }

        if (i < lines.length && lines[i].startsWith('```')) {
          codeLines.push(lines[i]); // Closing ```
          currentPosition += lines[i].length + 1;
        } else {
          // Unclosed code block - treat as regular paragraph to avoid consuming entire document
          blocks.push({
            text: codeLines.join('\n'),
            sectionPath: [...currentSectionPath],
            type: 'paragraph',
            position: linePosition,
            canSplit: true, // Allow splitting since it's malformed
          });
          continue;
        }

        blocks.push({
          text: codeLines.join('\n'),
          sectionPath: [...currentSectionPath],
          type: 'code',
          position: linePosition,
          canSplit: false, // Keep code blocks intact
        });
        continue;
      }

      // Check for list items
      if (line.match(/^[-*]\s+/) || line.match(/^\d+\.\s+/)) {
        const listLines = [line];
        let j = i + 1;

        // Collect consecutive list items
        while (j < lines.length) {
          const nextLine = lines[j];
          if (nextLine.match(/^[-*]\s+/) || nextLine.match(/^\d+\.\s+/)) {
            listLines.push(nextLine);
            currentPosition += nextLine.length + 1;
            j++;
          } else if (!nextLine.trim()) {
            j++; // Skip empty line within list
          } else {
            break;
          }
        }

        i = j - 1; // Update outer loop position

        blocks.push({
          text: listLines.join('\n'),
          sectionPath: [...currentSectionPath],
          type: 'list',
          position: linePosition,
          canSplit: false, // Keep lists intact when possible
        });
        continue;
      }

      // Check for tables (simplified detection: line with | characters)
      if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const tableLines = [line];
        let j = i + 1;

        // Collect consecutive table rows
        while (j < lines.length) {
          const nextLine = lines[j];
          if (
            nextLine.includes('|') &&
            (nextLine.trim().startsWith('|') || nextLine.includes('|'))
          ) {
            tableLines.push(nextLine);
            currentPosition += nextLine.length + 1;
            j++;
          } else if (!nextLine.trim()) {
            j++; // Skip empty line after table
            break;
          } else {
            break;
          }
        }

        i = j - 1; // Update outer loop position

        blocks.push({
          text: tableLines.join('\n'),
          sectionPath: [...currentSectionPath],
          type: 'table',
          position: linePosition,
          canSplit: false, // Keep tables intact
        });
        continue;
      }

      // Check for blockquotes
      if (line.trim().startsWith('>')) {
        const blockquoteLines = [line];
        let j = i + 1;

        // Collect consecutive blockquote lines
        while (j < lines.length) {
          const nextLine = lines[j];
          if (nextLine.trim().startsWith('>')) {
            blockquoteLines.push(nextLine);
            currentPosition += nextLine.length + 1;
            j++;
          } else if (!nextLine.trim()) {
            j++; // Skip empty line within blockquote
          } else {
            break;
          }
        }

        i = j - 1; // Update outer loop position

        blocks.push({
          text: blockquoteLines.join('\n'),
          sectionPath: [...currentSectionPath],
          type: 'blockquote',
          position: linePosition,
          canSplit: false, // Keep blockquotes intact for context
        });
        continue;
      }

      // Regular paragraph or other content
      blocks.push({
        text: line,
        sectionPath: [...currentSectionPath],
        type: 'paragraph',
        position: linePosition,
        canSplit: true,
      });
    }

    return blocks;
  }

  /**
   * Update section path based on heading hierarchy
   */
  private updateSectionPath(currentPath: string[], level: number, headingText: string): string[] {
    // Trim path to match heading level (h1 = level 1, h2 = level 2, etc.)
    const newPath = currentPath.slice(0, level - 1);
    newPath.push(headingText);
    return newPath;
  }

  /**
   * Group content blocks into chunks respecting token limits and semantic boundaries
   */
  private groupBlocksIntoChunks(
    blocks: ContentBlock[],
    maxTokens: number
  ): Array<{
    text: string;
    sectionPath: string[];
    overlapTokens: number;
  }> {
    const chunks: Array<{ text: string; sectionPath: string[]; overlapTokens: number }> = [];
    let currentChunk: { blocks: ContentBlock[]; tokens: number; startingSectionPath: string[] } = {
      blocks: [],
      tokens: 0,
      startingSectionPath: [],
    };

    for (const block of blocks) {
      const blockTokens = this.estimateTokens(block.text);

      // Check if we should start a new chunk due to:
      // 1. Token limit exceeded
      // 2. Heading level change (semantic boundary)
      const shouldStartNewChunk = this.shouldStartNewChunk(
        currentChunk,
        block,
        blockTokens,
        maxTokens
      );

      if (shouldStartNewChunk && currentChunk.blocks.length > 0) {
        // Finalize current chunk
        chunks.push(this.finalizeChunk(currentChunk));
        currentChunk = { blocks: [], tokens: 0, startingSectionPath: [...block.sectionPath] };
      } else if (currentChunk.blocks.length === 0) {
        // First block in chunk - set starting section path
        currentChunk.startingSectionPath = [...block.sectionPath];
      }

      // If single block exceeds maxTokens and can be split, split it
      if (blockTokens > maxTokens && block.canSplit) {
        const splitBlocks = this.splitLargeBlock(block, maxTokens);

        for (const splitBlock of splitBlocks) {
          const splitTokens = this.estimateTokens(splitBlock.text);

          if (currentChunk.tokens + splitTokens > maxTokens && currentChunk.blocks.length > 0) {
            chunks.push(this.finalizeChunk(currentChunk));
            currentChunk = {
              blocks: [],
              tokens: 0,
              startingSectionPath: [...splitBlock.sectionPath],
            };
          }

          currentChunk.blocks.push(splitBlock);
          currentChunk.tokens += splitTokens;
        }
      } else {
        // Add block as-is (even if it exceeds maxTokens for unsplittable blocks)
        currentChunk.blocks.push(block);
        currentChunk.tokens += blockTokens;
      }
    }

    // Don't forget the final chunk
    if (currentChunk.blocks.length > 0) {
      chunks.push(this.finalizeChunk(currentChunk));
    }

    return chunks;
  }

  /**
   * Determine if we should start a new chunk
   */
  private shouldStartNewChunk(
    currentChunk: { blocks: ContentBlock[]; tokens: number; startingSectionPath: string[] },
    block: ContentBlock,
    blockTokens: number,
    maxTokens: number
  ): boolean {
    // No current chunk - don't start new
    if (currentChunk.blocks.length === 0) {
      return false;
    }

    // Token limit would be exceeded
    if (currentChunk.tokens + blockTokens > maxTokens) {
      return true;
    }

    // Prefer semantic boundaries: start new chunk when section path changes
    const currentPath = currentChunk.startingSectionPath;
    const blockPath = block.sectionPath;

    // If we're moving to a completely different top-level section, start new chunk
    if (currentPath.length > 0 && blockPath.length > 0 && currentPath[0] !== blockPath[0]) {
      return true;
    }

    // If we're moving to a different section at any level, consider starting new chunk
    // if current chunk has some content (>= 10% of max tokens)
    if (
      currentPath.length > 0 &&
      blockPath.length > 0 &&
      !this.pathsMatch(currentPath, blockPath) &&
      currentChunk.tokens >= maxTokens * 0.1
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if two section paths represent the same section
   */
  private pathsMatch(path1: string[], path2: string[]): boolean {
    // Paths match only if they are exactly the same length and content
    if (path1.length !== path2.length) {
      return false;
    }

    for (let i = 0; i < path1.length; i++) {
      if (path1[i] !== path2[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Convert chunk data to final text form
   */
  private finalizeChunk(chunkData: {
    blocks: ContentBlock[];
    tokens: number;
    startingSectionPath: string[];
  }): {
    text: string;
    sectionPath: string[];
    overlapTokens: number;
  } {
    const text = chunkData.blocks
      .map(b => b.text)
      .join('\n\n')
      .trim();

    // Use the starting section path (where the chunk begins)
    const sectionPath = [...chunkData.startingSectionPath];

    return {
      text,
      sectionPath,
      overlapTokens: 0, // Will be set later when adding overlap
    };
  }

  /**
   * Split a large block that exceeds token limits
   */
  private splitLargeBlock(block: ContentBlock, maxTokens: number): ContentBlock[] {
    const sentences = this.smartSentenceSplit(block.text);
    const splitBlocks: ContentBlock[] = [];
    let currentText = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);

      if (currentTokens + sentenceTokens > maxTokens && currentText) {
        // Finalize current split
        splitBlocks.push({
          ...block,
          text: currentText.trim(),
        });
        currentText = '';
        currentTokens = 0;
      }

      currentText += sentence;
      currentTokens += sentenceTokens;
    }

    // Add final split
    if (currentText.trim()) {
      splitBlocks.push({
        ...block,
        text: currentText.trim(),
      });
    }

    return splitBlocks.length > 0 ? splitBlocks : [block];
  }

  /**
   * Add overlap between consecutive chunks
   */
  private addOverlapBetweenChunks(
    chunks: Array<{ text: string; sectionPath: string[]; overlapTokens: number }>,
    overlapPercentage: number
  ): Array<{ text: string; sectionPath: string[]; overlapTokens: number }> {
    if (chunks.length <= 1 || overlapPercentage === 0) {
      return chunks;
    }

    const result = [chunks[0]]; // First chunk has no overlap

    for (let i = 1; i < chunks.length; i++) {
      const currentChunk = chunks[i];
      const previousChunk = chunks[i - 1];

      const currentTokens = this.estimateTokens(currentChunk.text);
      const overlapTokensTarget = Math.ceil(currentTokens * (overlapPercentage / 100));

      // Extract overlap content from end of previous chunk
      const overlapText = this.extractOverlapText(previousChunk.text, overlapTokensTarget);
      const actualOverlapTokens = this.estimateTokens(overlapText);

      // Prepend overlap to current chunk
      const textWithOverlap = overlapText
        ? `${overlapText}\n\n${currentChunk.text}`
        : currentChunk.text;

      result.push({
        ...currentChunk,
        text: textWithOverlap,
        overlapTokens: actualOverlapTokens,
      });
    }

    return result;
  }

  /**
   * Extract overlap text from the end of a chunk, preferring sentence boundaries
   */
  private extractOverlapText(text: string, targetTokens: number): string {
    if (targetTokens === 0) {
      return '';
    }

    // Try sentence-based overlap first (cleaner boundaries)
    const sentences = this.smartSentenceSplit(text);
    if (sentences.length > 0) {
      const targetChars = targetTokens * this.CHARS_PER_TOKEN;
      let overlapText = '';
      let currentLength = 0;

      // Work backwards from the end, adding complete sentences
      for (let i = sentences.length - 1; i >= 0; i--) {
        const sentence = sentences[i];
        const sentenceWithSpace = sentence + (overlapText ? '. ' : '');
        const newLength = currentLength + sentenceWithSpace.length;

        // If adding this sentence would exceed target significantly, try word-level
        if (newLength > targetChars * 1.3) {
          break;
        }

        overlapText = sentence + (overlapText ? '. ' + overlapText : '');
        currentLength = newLength;

        const currentTokens = Math.ceil(currentLength / this.CHARS_PER_TOKEN);
        if (currentTokens >= targetTokens) {
          return overlapText.trim();
        }
      }

      // If sentence-based overlap is reasonable, return it
      if (overlapText.trim()) {
        return overlapText.trim();
      }
    }

    // Fallback to word-based overlap for edge cases
    const words = text.split(/\s+/).filter(word => word.trim());
    if (words.length === 0) {
      return '';
    }

    const targetChars = targetTokens * this.CHARS_PER_TOKEN;
    let overlapText = '';
    let currentLength = 0;

    // Work backwards from the end to build overlap, trying to match target tokens exactly
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i];
      const wordWithSpace = word + (overlapText ? ' ' : '');
      const newLength = currentLength + wordWithSpace.length;

      // If adding this word would exceed target significantly, stop here
      if (newLength > targetChars * 1.2) {
        break;
      }

      overlapText = word + (overlapText ? ' ' + overlapText : '');
      currentLength = newLength;

      // If we're close to the target, consider stopping
      const currentTokens = Math.ceil(currentLength / this.CHARS_PER_TOKEN);
      if (currentTokens >= targetTokens) {
        break;
      }
    }

    return overlapText.trim();
  }

  /**
   * Generate stable SHA-256 based chunk ID per specification
   */
  private generateChunkId(url: string, sectionPath: string[], text: string): string {
    return stableChunkId(url, sectionPath, text);
  }

  /**
   * Estimate token count using ~4 chars/token heuristic
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Smart sentence splitting that avoids common abbreviations
   */
  private smartSentenceSplit(text: string): string[] {
    // Common abbreviations that shouldn't trigger sentence breaks
    const abbreviations =
      /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Ph\.D|M\.D|B\.A|M\.A|U\.S|U\.K|etc|vs|i\.e|e\.g|cf|al)\./gi;

    // Replace abbreviations with placeholder to avoid false splits
    const placeholder = '<!ABBREV!>';
    const abbreviationMap: string[] = [];
    const tempText = text.replace(abbreviations, match => {
      abbreviationMap.push(match);
      return placeholder;
    });

    // Split on sentence endings followed by whitespace and capital letter
    const sentences = tempText.split(/[.!?]+(?=\s+[A-Z])/);

    // Restore abbreviations
    return sentences
      .map(sentence => {
        let restored = sentence;
        while (restored.includes(placeholder) && abbreviationMap.length > 0) {
          restored = restored.replace(placeholder, abbreviationMap.shift()!);
        }
        return restored.trim();
      })
      .filter(s => s.length > 0);
  }

  /**
   * Get max tokens from environment variable or use default
   */
  private getMaxTokensFromEnv(): number {
    const envValue = process.env.EMBEDDING_TOKENS_SIZE;
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return this.DEFAULT_MAX_TOKENS;
  }
}

// Export singleton instance
export const semanticChunker = new SemanticChunker();
