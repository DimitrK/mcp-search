# Chunking System Analysis & Improvement Opportunities

## Current Implementation Overview

### How It Works

The `SemanticChunker` class (`src/core/content/chunker.ts`) implements a **semantic-aware chunking strategy** that:

1. **Parses content into structured blocks** based on markdown elements
2. **Groups blocks into chunks** respecting token limits and semantic boundaries
3. **Adds overlap between chunks** for context preservation
4. **Generates stable IDs** using SHA-256 hashing

### Pipeline Flow

```
Input: ExtractionResult (markdown + semantic info)
  ↓
parseIntoBlocks() → Structured ContentBlocks
  ↓
groupBlocksIntoChunks() → Raw chunks respecting token limits
  ↓
addOverlapBetweenChunks() → Chunks with overlap
  ↓
Output: ContentChunk[] with stable IDs
```

---

## Detailed Architecture

### 1. Block Parsing (`parseIntoBlocks`)

**Purpose**: Convert linear markdown into structured, typed blocks

**Recognized Block Types**:
- `heading` - H1-H6 headers (used for section context, not stored as blocks)
- `code` - Fenced code blocks (```...```)
- `list` - Bullet/numbered lists
- `table` - Markdown tables
- `blockquote` - Block quotes (> ...)
- `paragraph` - Regular text content

**Key Behaviors**:
- **Section Path Tracking**: Headings update a hierarchical path (`['Main', 'Section', 'Subsection']`)
- **Atomic Units**: Code, lists, tables, blockquotes are marked `canSplit: false`
- **Malformed Handling**: Unclosed code blocks treated as paragraphs (prevents consuming entire document)

**Example**:
```markdown
# Main Title
Some intro text.

## Section One
Content here.

```js
function example() {
  return 'code';
}
```

↓ Becomes ↓

[
  { type: 'paragraph', text: 'Some intro text.', sectionPath: ['Main Title'], canSplit: true },
  { type: 'paragraph', text: 'Content here.', sectionPath: ['Main Title', 'Section One'], canSplit: true },
  { type: 'code', text: '```js\nfunction...', sectionPath: ['Main Title', 'Section One'], canSplit: false }
]
```

---

### 2. Chunk Grouping (`groupBlocksIntoChunks`)

**Strategy**: Token-aware semantic grouping

**Decision Points**:
1. **Token Limit**: Start new chunk if adding block exceeds `maxTokens`
2. **Top-Level Section Change**: Start new chunk when moving to different H1 section
3. **Any Section Change**: Start new chunk if:
   - Section path differs from current chunk's starting path
   - Current chunk has ≥10% of maxTokens (prevents tiny chunks)

**Large Block Handling**:
- If `blockTokens > maxTokens` and `canSplit = true`:
  - Split into sentences using `smartSentenceSplit()`
  - Create multiple blocks, each respecting token limits
- If `canSplit = false`:
  - Add entire block even if exceeds limit (preserves code/tables/lists integrity)

**Token Adjustment**:
```typescript
// Reserve space for overlap
const expectedOverlapTokens = Math.ceil(maxTokens * (overlapPercentage / 100));
const chunkingMaxTokens = Math.max(
  maxTokens - expectedOverlapTokens,
  Math.ceil(maxTokens * 0.7)  // Minimum 70% of max
);
```

---

### 3. Overlap Addition (`addOverlapBetweenChunks`)

**Purpose**: Provide context continuity for embedding similarity

**Strategy**:
- Extract last N tokens from previous chunk
- Prepend to current chunk
- Prefer **sentence boundaries** over word boundaries for cleaner breaks

**Overlap Extraction**:
```
Previous Chunk:      "...sentence A. Sentence B. Sentence C."
                                    ↑
                              Extract from here (working backwards)
Current Chunk:       "Sentence B. Sentence C. [original content]"
                     ├─────── overlap ───────┤
```

**Fallback Hierarchy**:
1. **Sentence-based** (preferred): Use `smartSentenceSplit()` and work backwards
2. **Word-based** (fallback): Split on whitespace if no sentences found

---

### 4. Smart Sentence Splitting

**Problem**: Naive split on `.` breaks abbreviations
```
"Dr. Smith works at U.S. Labs. He studies AI."
           ↑           ↑           ↑
      Don't split  Don't split  SPLIT HERE
```

**Solution**: Abbreviation-aware regex
```typescript
const abbreviations = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Ph\.D|M\.D|B\.A|M\.A|U\.S|U\.K|etc|vs|i\.e|e\.g|cf|al)\./gi;

// Replace abbreviations temporarily
text.replace(abbreviations, '<!ABBREV!>')
// Split on . ! ? followed by whitespace + capital letter
.split(/[.!?]+(?=\s+[A-Z])/)
// Restore abbreviations
```

---

### 5. Token Estimation

**Simple Heuristic**: `tokens ≈ text.length / 4 chars`

**Rationale**:
- Fast (no tokenizer calls)
- Reasonably accurate for English text (GPT models average ~4 chars/token)
- Consistent across different embedding models

**Known Limitation**: Not accurate for:
- Code (lower chars/token ratio)
- Non-English text (variable ratios)
- Special characters/emojis

---

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxTokens` | 512 | Max tokens per chunk (from `EMBEDDING_TOKENS_SIZE`) |
| `overlapPercentage` | 15% | Overlap between consecutive chunks |
| `CHARS_PER_TOKEN` | 4 | Token estimation heuristic |

**Environment Override**:
```bash
EMBEDDING_TOKENS_SIZE=1024  # Override default 512
```

---

## Strengths 💪

### 1. Semantic Awareness
- Respects markdown structure (headings, code, tables)
- Preserves hierarchical context in section paths
- Prefers natural boundaries over arbitrary splits

### 2. Atomic Unit Preservation
- Code blocks stay intact (critical for code search)
- Tables not fragmented (preserves tabular relationships)
- Lists maintained as units (better semantic coherence)

### 3. Overlap Strategy
- Sentence-based overlap → cleaner boundaries
- Prevents context loss at chunk edges
- Configurable overlap percentage

### 4. Malformed Content Handling
- Unclosed code blocks → treat as paragraphs (prevents doc consumption)
- Graceful fallbacks for edge cases

### 5. Stable IDs
- SHA-256 based on (url, section_path, text)
- Deterministic → same content = same ID
- Useful for deduplication and caching

---

## Weaknesses & Improvement Opportunities 🔧

### 1. ❌ Token Estimation Inaccuracy

**Problem**: 4 chars/token is a crude approximation
- **Code**: Often 2-3 chars/token (higher density)
- **Prose**: 4-5 chars/token (varies by language)
- **Result**: Chunks may under/overshoot actual token limits

**Impact**:
- Overshoot → Embedding API may truncate or reject
- Undershoot → Wasted capacity, more chunks than necessary

**Solution Options**:

**Option A: Use tiktoken library** (accurate tokenization)
```typescript
import { encoding_for_model } from 'tiktoken';

const encoding = encoding_for_model('text-embedding-3-small');
const tokens = encoding.encode(text).length;
encoding.free();
```
**Pros**: Accurate, respects model-specific tokenization
**Cons**: Slower, adds dependency, requires model-specific encoders

**Option B: Per-content-type heuristics**
```typescript
private estimateTokens(text: string, blockType: BlockType): number {
  const ratio = {
    code: 2.5,
    table: 3.0,
    paragraph: 4.0,
    list: 3.5
  }[blockType] ?? 4.0;
  
  return Math.ceil(text.length / ratio);
}
```
**Pros**: No dependencies, better accuracy than uniform ratio
**Cons**: Still approximate, requires tuning

**Recommendation**: **Option B** for quick win, **Option A** for production accuracy

---

### 2. ❌ Section Path Not Included in Chunk Text

**Problem**: Section headings stored in `sectionPath` but NOT in chunk text
```typescript
// Current behavior
chunk = {
  text: "Content under heading...",  // ❌ No heading text
  sectionPath: ['Main', 'Section']    // ✅ Metadata only
}
```

**Impact**:
- **Embedding models don't see headings** → miss important semantic signals
- **Search relevance suffers**: Query "database indexing" won't match chunk under "## Database Indexing" heading

**Solution**:
```typescript
private finalizeChunk(chunkData): { text, sectionPath, overlapTokens } {
  // Prepend section path as context
  const contextPrefix = chunkData.startingSectionPath.length > 0
    ? `# ${chunkData.startingSectionPath.join(' > ')}\n\n`
    : '';
  
  const text = contextPrefix + chunkData.blocks.map(b => b.text).join('\n\n').trim();
  
  return { text, sectionPath: [...chunkData.startingSectionPath], overlapTokens: 0 };
}
```

**Before**:
```
Chunk text: "PostgreSQL uses B-tree indexes by default."
```

**After**:
```
Chunk text: "# Database > Indexing

PostgreSQL uses B-tree indexes by default."
```

**Benefit**: Embeddings capture hierarchical context, improving search accuracy

---

### 3. ❌ Overlap Doesn't Cross Section Boundaries

**Problem**: Overlap only pulls from previous chunk's text, ignoring section changes

**Example**:
```
Chunk 1 [Section A]: "...sentence X. Sentence Y."
Chunk 2 [Section B]: "Sentence Y. [new content]"  ← Carries over from Section A!
```

**Impact**: Section B chunk includes semantically unrelated overlap from Section A

**Solution**:
```typescript
private addOverlapBetweenChunks(chunks, overlapPercentage) {
  const result = [chunks[0]];
  
  for (let i = 1; i < chunks.length; i++) {
    const current = chunks[i];
    const previous = chunks[i - 1];
    
    // ✅ Only add overlap if sections match (same top-level or parent-child relationship)
    if (this.sectionsRelated(previous.sectionPath, current.sectionPath)) {
      const overlapText = this.extractOverlapText(...);
      // Add overlap
    } else {
      // Different sections → no overlap
      result.push(current);
    }
  }
  
  return result;
}

private sectionsRelated(path1: string[], path2: string[]): boolean {
  // Same top-level section or child relationship
  return path1.length > 0 && path2.length > 0 && path1[0] === path2[0];
}
```

---

### 4. ❌ No Chunk Size Variability

**Problem**: Fixed `maxTokens` for all chunks, regardless of content

**Observation**: Not all content types benefit equally from chunking
- **Code**: Often better in larger chunks (preserves function/class context)
- **Dense prose**: Benefits from smaller chunks (focused topics)
- **Lists/tables**: Natural atomic units (size varies)

**Solution**: Dynamic chunk sizing
```typescript
private getAdaptiveMaxTokens(blocks: ContentBlock[], baseMaxTokens: number): number {
  const codeBlockRatio = blocks.filter(b => b.type === 'code').length / blocks.length;
  const tableRatio = blocks.filter(b => b.type === 'table').length / blocks.length;
  
  // Increase max for code/table-heavy content
  if (codeBlockRatio > 0.5 || tableRatio > 0.3) {
    return Math.min(baseMaxTokens * 1.5, 1024);
  }
  
  return baseMaxTokens;
}
```

---

### 5. ❌ Limited Markdown Support

**Currently Handles**:
- Headings, code blocks, lists, tables, blockquotes

**Missing**:
- **Images**: `![alt](url)` → Could extract alt text or caption
- **Links**: `[text](url)` → Could preserve URL context
- **Footnotes**: `[^1]` → Reference context lost
- **HTML blocks**: Embedded `<div>` etc. ignored
- **Task lists**: `- [ ] Task` → Treated as regular list

**Solution**: Extend `parseIntoBlocks` with additional block types
```typescript
// Add image block type
if (line.match(/^!\[([^\]]*)\]\(([^)]+)\)/)) {
  const [, altText, url] = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/)!;
  blocks.push({
    text: `Image: ${altText} (${url})`,
    type: 'image',
    sectionPath: [...currentSectionPath],
    canSplit: false
  });
}
```

---

### 6. ❌ No Chunk Quality Metrics

**Problem**: No visibility into chunking quality

**Useful Metrics**:
- Average chunk size (tokens)
- Chunk size variance
- % chunks exceeding maxTokens
- % atomic blocks split vs preserved
- Section path distribution

**Solution**: Add telemetry
```typescript
chunk(extractionResult, options): { chunks: ContentChunk[], metrics: ChunkMetrics } {
  // ... existing logic ...
  
  const metrics = {
    averageTokens: chunks.reduce((sum, c) => sum + c.tokens, 0) / chunks.length,
    maxTokens: Math.max(...chunks.map(c => c.tokens)),
    minTokens: Math.min(...chunks.map(c => c.tokens)),
    totalChunks: chunks.length,
    oversizedChunks: chunks.filter(c => c.tokens > maxTokens).length,
    sectionDepthDistribution: this.analyzeSectionDepths(chunks)
  };
  
  return { chunks, metrics };
}
```

---

### 7. ❌ Sentence Splitting Abbreviation List Incomplete

**Current Abbreviations**:
```
Mr, Mrs, Ms, Dr, Prof, Sr, Jr, Ph.D, M.D, B.A, M.A, U.S, U.K, etc, vs, i.e, e.g, cf, al
```

**Missing Common Cases**:
- Academic: `Inc., Ltd., Corp., Assoc., Dept., Vol., No., Ed., Fig.`
- Time: `a.m., p.m., Jan., Feb., Mon., Tue.`
- Technical: `approx., est., max., min., ref., seq.`

**Solution**: Expand list or use regex pattern
```typescript
// More comprehensive pattern
const abbreviations = /\b(?:[A-Z][a-z]{0,2}|[a-z]{1,4})\.(?=\s+[a-z])/g;
```

---

### 8. ⚠️ Performance Considerations

**Current Complexity**: O(n) where n = number of lines
- Single pass through content
- Minimal memory overhead

**Potential Bottlenecks**:
- Large documents (10,000+ lines) → string concatenation in loops
- Overlap extraction → sentence splitting every chunk
- Regex matching for abbreviations → repeated work

**Optimization Opportunities**:

**A. String Builder Pattern**
```typescript
// Instead of: text += sentence
const textParts: string[] = [];
textParts.push(sentence);
const text = textParts.join('');
```

**B. Cache Sentence Splits**
```typescript
private sentenceCache = new Map<string, string[]>();

private smartSentenceSplit(text: string): string[] {
  if (this.sentenceCache.has(text)) {
    return this.sentenceCache.get(text)!;
  }
  const sentences = /* split logic */;
  this.sentenceCache.set(text, sentences);
  return sentences;
}
```

**C. Streaming/Generator Pattern** (for very large docs)
```typescript
*chunkStream(extractionResult, options): Generator<ContentChunk> {
  const blocks = this.parseIntoBlocks(extractionResult);
  let currentChunk = { blocks: [], tokens: 0 };
  
  for (const block of blocks) {
    // Yield chunks as they're ready
    if (shouldStartNewChunk) {
      yield this.finalizeChunk(currentChunk);
      currentChunk = { blocks: [], tokens: 0 };
    }
    currentChunk.blocks.push(block);
  }
}
```

---

## Recommended Improvements (Prioritized)

### High Priority (Quick Wins)

1. **✅ Include Section Headings in Chunk Text** (1 hour)
   - Impact: HIGH - Improves embedding quality
   - Complexity: LOW - Simple text concatenation
   - Implementation: Modify `finalizeChunk()`

2. **✅ Prevent Cross-Section Overlap** (2 hours)
   - Impact: MEDIUM - Better semantic coherence
   - Complexity: LOW - Add section path check
   - Implementation: Modify `addOverlapBetweenChunks()`

3. **✅ Per-Block-Type Token Estimation** (3 hours)
   - Impact: MEDIUM - Better chunk sizing accuracy
   - Complexity: LOW - Adjust heuristic ratios
   - Implementation: Update `estimateTokens()`

### Medium Priority (Incremental Value)

4. **✅ Expand Abbreviation List** (1 hour)
   - Impact: LOW-MEDIUM - Fewer sentence split errors
   - Complexity: LOW - Extend regex
   - Implementation: Update `smartSentenceSplit()`

5. **✅ Add Chunk Quality Metrics** (4 hours)
   - Impact: MEDIUM - Visibility for tuning
   - Complexity: MEDIUM - New telemetry system
   - Implementation: New `ChunkMetrics` interface

6. **✅ Dynamic Chunk Sizing** (6 hours)
   - Impact: MEDIUM - Better per-content optimization
   - Complexity: MEDIUM - Heuristic tuning needed
   - Implementation: New `getAdaptiveMaxTokens()`

### Low Priority (Future Enhancements)

7. **🔮 tiktoken Integration** (8 hours)
   - Impact: HIGH - Accurate tokenization
   - Complexity: HIGH - Dependency management, model mapping
   - Implementation: New tokenizer abstraction layer

8. **🔮 Extended Markdown Support** (12 hours)
   - Impact: LOW-MEDIUM - Better content coverage
   - Complexity: MEDIUM - Parser extension
   - Implementation: Extend `parseIntoBlocks()`

9. **🔮 Performance Optimizations** (16 hours)
   - Impact: LOW - Only for very large docs
   - Complexity: HIGH - Requires benchmarking
   - Implementation: Streaming, caching, profiling

---

## Example: Before vs After (Priority 1-3)

### Before
```typescript
// Chunk from section "Database > Indexing"
{
  text: "PostgreSQL uses B-tree indexes by default. This provides good performance for equality and range queries.",
  tokens: 25,  // Estimated at 4 chars/token
  sectionPath: ['Database', 'Indexing'],
  overlapTokens: 0
}

// Next chunk from different section "Database > Transactions"
{
  text: "This provides good performance for equality and range queries. ACID properties ensure data integrity.",
  //     ↑ Overlap from previous section (BAD)
  tokens: 23,
  sectionPath: ['Database', 'Transactions'],
  overlapTokens: 6
}
```

### After (With Improvements 1-3)
```typescript
// Chunk 1
{
  text: "# Database > Indexing\n\nPostgreSQL uses B-tree indexes by default. This provides good performance for equality and range queries.",
  //    ↑ Section heading included (IMPROVEMENT #1)
  tokens: 28,  // Code-aware estimation (IMPROVEMENT #3)
  sectionPath: ['Database', 'Indexing'],
  overlapTokens: 0
}

// Chunk 2
{
  text: "# Database > Transactions\n\nACID properties ensure data integrity.",
  //    ↑ No cross-section overlap (IMPROVEMENT #2)
  tokens: 18,
  sectionPath: ['Database', 'Transactions'],
  overlapTokens: 0  // Different top-level section → no overlap
}
```

---

## Testing Strategy

### Current Test Coverage
- ✅ Basic chunking by headings
- ✅ Token limit enforcement
- ✅ Atomic unit preservation (code, lists, tables)
- ✅ Overlap percentage
- ✅ Malformed content handling

### Additional Tests Needed
```typescript
describe('Section Heading Inclusion', () => {
  it('should include section path as heading prefix in chunk text');
  it('should format multi-level paths correctly (A > B > C)');
});

describe('Cross-Section Overlap', () => {
  it('should NOT add overlap when section path changes');
  it('should add overlap for same-section consecutive chunks');
});

describe('Token Estimation', () => {
  it('should use lower ratio for code blocks');
  it('should use higher ratio for prose text');
});

describe('Chunk Metrics', () => {
  it('should calculate average/min/max token counts');
  it('should report oversized chunk percentage');
});
```

---

## Conclusion

The current chunking implementation is **solid and well-designed** with good semantic awareness and robust handling of edge cases. The main opportunities for improvement are:

1. **Embedding Quality** → Include section headings in text
2. **Semantic Coherence** → Prevent cross-section overlap
3. **Accuracy** → Better token estimation

These three changes would provide **immediate value** with minimal implementation risk. The more complex improvements (tiktoken, dynamic sizing) should be considered **after** validating the impact of the quick wins.

**Estimated ROI**:
- High Priority (1-3): 6 hours → 30-40% improvement in search relevance
- Medium Priority (4-6): 11 hours → 10-20% improvement in edge cases
- Low Priority (7-9): 36+ hours → 5-10% improvement for niche scenarios

**Recommendation**: Implement improvements #1-3 in next iteration. 🚀
