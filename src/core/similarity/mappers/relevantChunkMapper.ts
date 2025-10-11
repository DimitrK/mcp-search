import { ConsolidatedChunk } from '../types';
import { RelevantChunkType } from '../../../mcp/schemas';

export class RelevantChunkMapper {
  static mapChunksToRelevant(chunks: ConsolidatedChunk[]): RelevantChunkType[] {
    return chunks.map(chunk => ({
      id: chunk.id,
      text: chunk.text,
      score: chunk.score,
      sectionPath: chunk.section_path ? chunk.section_path.split('|') : undefined,
    }));
  }
}
