/**
 * Chunk consolidation utility for merging overlapping chunks
 * to provide cleaner, more efficient content to AI agents.
 */

export interface ConsolidatableChunk {
  id: string;
  text: string;
  score: number;
  section_path?: string;
}

export interface ConsolidatedChunk {
  id: string; // Composite ID from merged chunks
  text: string; // Merged text with overlap removed
  score: number; // Weighted average score
  section_path?: string; // Common section path
  sourceChunkIds: string[]; // Original chunk IDs that were merged
}

/**
 * Consolidates overlapping chunks by merging adjacent content
 * and removing redundant overlap regions.
 */
export function consolidateOverlappingChunks(chunks: ConsolidatableChunk[]): ConsolidatedChunk[] {
  if (chunks.length === 0) return [];
  if (chunks.length === 1) {
    return [
      {
        id: chunks[0].id,
        text: chunks[0].text,
        score: chunks[0].score,
        section_path: chunks[0].section_path,
        sourceChunkIds: [chunks[0].id],
      },
    ];
  }

  // Group chunks by section path for potential consolidation
  const groups = groupChunksBySectionPath(chunks);
  const consolidated: ConsolidatedChunk[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      // Single chunk - no consolidation needed
      consolidated.push({
        id: group[0].id,
        text: group[0].text,
        score: group[0].score,
        section_path: group[0].section_path,
        sourceChunkIds: [group[0].id],
      });
    } else {
      // Multiple chunks in same section - attempt iterative consolidation
      const merged = mergeChunksIteratively(group);
      consolidated.push(...merged);
    }
  }

  // Sort by highest score to maintain relevance ordering
  return consolidated.sort((a, b) => b.score - a.score);
}

/**
 * Groups chunks by their section path hierarchy for consolidation analysis
 */
function groupChunksBySectionPath(chunks: ConsolidatableChunk[]): ConsolidatableChunk[][] {
  const groups = new Map<string, ConsolidatableChunk[]>();

  for (const chunk of chunks) {
    const sectionKey = chunk.section_path || 'root';
    if (!groups.has(sectionKey)) {
      groups.set(sectionKey, []);
    }
    groups.get(sectionKey)!.push(chunk);
  }

  return Array.from(groups.values());
}

/**
 * Checks if a chunk contains primarily structural markdown (headings, code, tables, etc.)
 */
function isStructuralChunk(chunk: ConsolidatableChunk): boolean {
  const text = chunk.text.trim();

  // Remove markdown structural elements
  const withoutHeadings = text.replace(/^#{1,6}\s+.*/gm, '').trim();
  const withoutCodeBlocks = withoutHeadings.replace(/```[\s\S]*?```/g, '').trim();
  const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]+`/g, '').trim();
  const withoutLists = withoutInlineCode.replace(/^[-*+]\s+.*/gm, '').trim();
  const withoutBlockquotes = withoutLists.replace(/^>\s+.*/gm, '').trim();
  const withoutTables = withoutBlockquotes.replace(/^\|.*\|$/gm, '').trim();
  const withoutHorizontalRules = withoutTables.replace(/^[-=]{3,}$/gm, '').trim();

  // If very little content remains after removing structure, it's primarily structural
  const remainingContent = withoutHorizontalRules.length;
  const originalContent = text.length;

  // Consider structural if >70% of content is markdown structure
  return remainingContent < originalContent * 0.3;
}

/**
 * Determines if two chunks are complementary (structure + content)
 */
function areComplementary(chunk1: ConsolidatableChunk, chunk2: ConsolidatableChunk): boolean {
  // Must be in same section
  if (chunk1.section_path !== chunk2.section_path) {
    return false;
  }

  // One should be structural, the other substantive
  const chunk1Structural = isStructuralChunk(chunk1);
  const chunk2Structural = isStructuralChunk(chunk2);

  return chunk1Structural !== chunk2Structural;
}

/**
 * Merges chunks within the same section group using iterative consolidation
 */
function mergeChunksIteratively(chunks: ConsolidatableChunk[]): ConsolidatedChunk[] {
  if (chunks.length <= 1) {
    return chunks.map(chunk => ({
      id: chunk.id,
      text: chunk.text,
      score: chunk.score,
      section_path: chunk.section_path,
      sourceChunkIds: [chunk.id],
    }));
  }

  // Start with all chunks as potential consolidated results
  let workingChunks: ConsolidatedChunk[] = chunks.map(chunk => ({
    id: chunk.id,
    text: chunk.text,
    score: chunk.score,
    section_path: chunk.section_path,
    sourceChunkIds: [chunk.id],
  }));

  let changed = true;
  // Keep merging until no more merges are possible
  while (changed && workingChunks.length > 1) {
    changed = false;
    const newWorkingChunks: ConsolidatedChunk[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < workingChunks.length; i++) {
      const currentChunk = workingChunks[i];
      if (processed.has(currentChunk.id)) continue;

      let bestMergeCandidate: ConsolidatedChunk | null = null;
      let bestOverlap = { hasOverlap: false, overlapPercentage: 0 };

      // Find the best merge candidate
      for (let j = i + 1; j < workingChunks.length; j++) {
        const candidateChunk = workingChunks[j];
        if (processed.has(candidateChunk.id)) continue;

        const overlapInfo = detectTextOverlap(currentChunk.text, candidateChunk.text);
        if (
          overlapInfo.hasOverlap &&
          overlapInfo.overlapPercentage > bestOverlap.overlapPercentage
        ) {
          bestOverlap = overlapInfo;
          bestMergeCandidate = candidateChunk;
        }
      }

      // Check for complementary chunks (structure + content) in same section
      let bestComplementaryCandidate: ConsolidatedChunk | null = null;
      if (!bestMergeCandidate || bestOverlap.overlapPercentage <= 0.1) {
        for (let j = i + 1; j < workingChunks.length; j++) {
          const candidateChunk = workingChunks[j];
          if (processed.has(candidateChunk.id)) continue;

          if (
            areComplementary(
              {
                id: currentChunk.id,
                text: currentChunk.text,
                score: currentChunk.score,
                section_path: currentChunk.section_path,
              },
              {
                id: candidateChunk.id,
                text: candidateChunk.text,
                score: candidateChunk.score,
                section_path: candidateChunk.section_path,
              }
            )
          ) {
            bestComplementaryCandidate = candidateChunk;
            break; // Take first complementary match
          }
        }
      }

      if (bestMergeCandidate && bestOverlap.overlapPercentage > 0.1) {
        // Merge current chunk with best overlap candidate
        const mergedChunk = mergeOverlappingChunks([
          // Convert to ConsolidatableChunk for merging
          {
            id: currentChunk.id,
            text: currentChunk.text,
            score: currentChunk.score,
            section_path: currentChunk.section_path,
          },
          {
            id: bestMergeCandidate.id,
            text: bestMergeCandidate.text,
            score: bestMergeCandidate.score,
            section_path: bestMergeCandidate.section_path,
          },
        ]);

        // Update source chunk IDs
        mergedChunk.sourceChunkIds = [
          ...currentChunk.sourceChunkIds,
          ...bestMergeCandidate.sourceChunkIds,
        ];

        newWorkingChunks.push(mergedChunk);
        processed.add(currentChunk.id);
        processed.add(bestMergeCandidate.id);
        changed = true;
      } else if (bestComplementaryCandidate) {
        // Merge complementary chunks (structure + content)
        const mergedChunk = mergeComplementaryChunks([
          {
            id: currentChunk.id,
            text: currentChunk.text,
            score: currentChunk.score,
            section_path: currentChunk.section_path,
          },
          {
            id: bestComplementaryCandidate.id,
            text: bestComplementaryCandidate.text,
            score: bestComplementaryCandidate.score,
            section_path: bestComplementaryCandidate.section_path,
          },
        ]);

        // Update source chunk IDs
        mergedChunk.sourceChunkIds = [
          ...currentChunk.sourceChunkIds,
          ...bestComplementaryCandidate.sourceChunkIds,
        ];

        newWorkingChunks.push(mergedChunk);
        processed.add(currentChunk.id);
        processed.add(bestComplementaryCandidate.id);
        changed = true;
      } else {
        // No good merge found, keep chunk as-is
        newWorkingChunks.push(currentChunk);
        processed.add(currentChunk.id);
      }
    }

    workingChunks = newWorkingChunks;
  }

  return workingChunks;
}

/**
 * Detects text overlap between two chunks
 */
function detectTextOverlap(
  text1: string,
  text2: string
): { hasOverlap: boolean; overlapPercentage: number; overlapText?: string } {
  const minOverlapLength = 30; // Minimum 30 characters for meaningful overlap

  let bestOverlap = { length: 0, text: '', type: '' };

  // Check if one text is a prefix of another (complete containment)
  if (text1.length >= minOverlapLength && text2.startsWith(text1)) {
    bestOverlap = { length: text1.length, text: text1, type: 'complete-prefix' };
  } else if (text2.length >= minOverlapLength && text1.startsWith(text2)) {
    bestOverlap = { length: text2.length, text: text2, type: 'complete-prefix' };
  }

  // Check if text1 ends with something that text2 starts with
  for (let i = minOverlapLength; i <= text1.length && i <= text2.length; i++) {
    const text1Suffix = text1.slice(-i);
    const text2Prefix = text2.slice(0, i);

    if (text1Suffix === text2Prefix) {
      if (i > bestOverlap.length) {
        bestOverlap = { length: i, text: text1Suffix, type: 'suffix-prefix' };
      }
    }
  }

  // Check if text2 ends with something that text1 starts with
  for (let i = minOverlapLength; i <= text1.length && i <= text2.length; i++) {
    const text2Suffix = text2.slice(-i);
    const text1Prefix = text1.slice(0, i);

    if (text2Suffix === text1Prefix) {
      if (i > bestOverlap.length) {
        bestOverlap = { length: i, text: text2Suffix, type: 'prefix-suffix' };
      }
    }
  }

  // Check for substantial substring overlap (one text contains a significant portion of the other)
  const words1 = text1
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);
  const words2 = text2
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);

  const commonWords = words1.filter(word => words2.includes(word));
  const wordOverlapPercentage = commonWords.length / Math.min(words1.length, words2.length);

  // Check for word-level overlap, but be more flexible for common scenarios
  if (commonWords.length >= 2) {
    // Special case: if texts are short and have good word overlap, be more lenient
    const totalWords = Math.max(words1.length, words2.length);
    const minThreshold = totalWords <= 5 ? 0.4 : 0.6; // Lower threshold for short texts

    if (wordOverlapPercentage > minThreshold) {
      const commonText = commonWords.join(' ');
      if (commonText.length > bestOverlap.length) {
        bestOverlap = { length: commonText.length, text: commonText, type: 'word-overlap' };
      }
    }
  }

  // Special handling for sentence-boundary overlaps (common in chunked content)
  const text1Words = text1.trim().split(/\s+/);
  const text2Words = text2.trim().split(/\s+/);

  // Check if last few words of text1 match first few words of text2
  for (
    let wordCount = 1;
    wordCount <= Math.min(3, text1Words.length, text2Words.length);
    wordCount++
  ) {
    const text1Ending = text1Words.slice(-wordCount).join(' ');
    const text2Beginning = text2Words.slice(0, wordCount).join(' ');

    // Remove punctuation for comparison but keep original for overlap text
    const text1Clean = text1Ending.toLowerCase().replace(/[.,!?;:]/g, '');
    const text2Clean = text2Beginning.toLowerCase().replace(/[.,!?;:]/g, '');

    if (text1Clean === text2Clean && text1Clean.length >= 3) {
      // Reduced from 4 to 3
      // Use the longer of the two original texts for better merging
      const overlapText =
        text1Ending.length >= text2Beginning.length ? text1Ending : text2Beginning;
      if (overlapText.length > bestOverlap.length) {
        bestOverlap = { length: overlapText.length, text: overlapText, type: 'sentence-boundary' };
      }
    }
  }

  const overlapPercentage = bestOverlap.length / Math.min(text1.length, text2.length);
  return {
    hasOverlap: bestOverlap.length >= minOverlapLength,
    overlapPercentage,
    overlapText: bestOverlap.text || undefined,
  };
}

/**
 * Merges complementary chunks (structure + content) into a single consolidated chunk
 */
function mergeComplementaryChunks(chunks: ConsolidatableChunk[]): ConsolidatedChunk {
  if (chunks.length === 1) {
    return {
      id: chunks[0].id,
      text: chunks[0].text,
      score: chunks[0].score,
      section_path: chunks[0].section_path,
      sourceChunkIds: [chunks[0].id],
    };
  }

  // Sort by structure first (structural chunks provide context), then by score
  const sortedChunks = [...chunks].sort((a, b) => {
    const aStructural = isStructuralChunk(a);
    const bStructural = isStructuralChunk(b);

    // Structure first to provide context
    if (aStructural && !bStructural) return -1;
    if (!aStructural && bStructural) return 1;

    // Then by score
    return b.score - a.score;
  });

  // Combine texts intelligently: structure first, then content
  const structuralChunks = sortedChunks.filter(isStructuralChunk);
  const contentChunks = sortedChunks.filter(chunk => !isStructuralChunk(chunk));

  let mergedText = '';
  const sourceIds: string[] = [];

  // Add structural content first (headings, code, etc.)
  for (const chunk of structuralChunks) {
    if (mergedText) mergedText += '\n\n';
    mergedText += chunk.text;
    sourceIds.push(chunk.id);
  }

  // Add substantive content
  for (const chunk of contentChunks) {
    if (mergedText) mergedText += '\n\n';
    mergedText += chunk.text;
    sourceIds.push(chunk.id);
  }

  // Calculate weighted average score
  const totalWeight = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const weightedScore =
    chunks.reduce((sum, chunk) => sum + chunk.score * chunk.text.length, 0) / totalWeight;

  // Generate composite ID
  const compositeId = `consolidated-${sourceIds.join('+')}`;

  return {
    id: compositeId,
    text: mergedText.trim(),
    score: weightedScore,
    section_path: sortedChunks[0].section_path,
    sourceChunkIds: sourceIds,
  };
}

/**
 * Merges multiple overlapping chunks into a single consolidated chunk
 */
function mergeOverlappingChunks(chunks: ConsolidatableChunk[]): ConsolidatedChunk {
  if (chunks.length === 1) {
    return {
      id: chunks[0].id,
      text: chunks[0].text,
      score: chunks[0].score,
      section_path: chunks[0].section_path,
      sourceChunkIds: [chunks[0].id],
    };
  }

  // Sort by score descending to use highest scoring as base, then by length
  const sortedChunks = [...chunks].sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    return b.text.length - a.text.length;
  });

  let mergedText = sortedChunks[0].text;
  const sourceIds = [sortedChunks[0].id];

  // Attempt to merge additional content from other chunks
  for (let i = 1; i < sortedChunks.length; i++) {
    const chunk = sortedChunks[i];
    const overlapInfo = detectTextOverlap(mergedText, chunk.text);

    if (overlapInfo.hasOverlap && overlapInfo.overlapText) {
      const overlap = overlapInfo.overlapText;

      // Try different merge strategies
      // Strategy 1: Complete prefix/suffix match (one text completely contained in another)
      if (mergedText === overlap) {
        // mergedText is completely contained in chunk.text
        mergedText = chunk.text;
        sourceIds.push(chunk.id);
      } else if (chunk.text === overlap) {
        // chunk.text is completely contained in mergedText, keep mergedText as-is
        sourceIds.push(chunk.id);
      }

      // Strategy 2: mergedText ends with overlap, chunk starts with overlap
      else if (mergedText.endsWith(overlap) && chunk.text.startsWith(overlap)) {
        const remainingPart = chunk.text.slice(overlap.length);
        if (remainingPart.trim()) {
          mergedText += ' ' + remainingPart.trim();
          sourceIds.push(chunk.id);
        }
      }

      // Strategy 3: mergedText starts with overlap, chunk ends with overlap
      else if (mergedText.startsWith(overlap) && chunk.text.endsWith(overlap)) {
        const leadingPart = chunk.text.slice(0, -overlap.length);
        if (leadingPart.trim()) {
          mergedText = leadingPart.trim() + ' ' + mergedText;
          sourceIds.push(chunk.id);
        }
      }

      // Strategy 4: For word-level overlaps, use intelligent combination
      else {
        mergedText = combineTwoTexts(mergedText, chunk.text);
        sourceIds.push(chunk.id);
      }
    }
  }

  // Calculate weighted average score
  const totalWeight = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const weightedScore =
    chunks.reduce((sum, chunk) => sum + chunk.score * chunk.text.length, 0) / totalWeight;

  // Generate composite ID
  const compositeId = `consolidated-${sourceIds.join('+')}`;

  return {
    id: compositeId,
    text: mergedText.trim(),
    score: weightedScore,
    section_path: sortedChunks[0].section_path,
    sourceChunkIds: sourceIds,
  };
}

/**
 * Intelligently combines two texts by removing redundancy
 */
function combineTwoTexts(text1: string, text2: string): string {
  const words1 = text1.split(/\s+/);
  const words2 = text2.split(/\s+/);

  // Find the best overlap point
  let bestOverlap = 0;
  let bestPosition = -1;

  // Check different overlap positions
  for (let i = Math.max(0, words1.length - 10); i < words1.length; i++) {
    for (let j = 0; j < Math.min(10, words2.length); j++) {
      let overlap = 0;
      while (
        i + overlap < words1.length &&
        j + overlap < words2.length &&
        words1[i + overlap].toLowerCase() === words2[j + overlap].toLowerCase()
      ) {
        overlap++;
      }

      if (overlap > bestOverlap && overlap >= 2) {
        // At least 2 words overlap
        bestOverlap = overlap;
        bestPosition = i;
      }
    }
  }

  if (bestOverlap > 0) {
    // Merge by removing the overlapping part from text2
    const text1Part = words1.slice(0, bestPosition + bestOverlap).join(' ');
    const text2Part = words2.slice(bestOverlap).join(' ');
    return text1Part + (text2Part ? ' ' + text2Part : '');
  }

  // No good overlap found, just concatenate with separator
  return text1 + ' ' + text2;
}
