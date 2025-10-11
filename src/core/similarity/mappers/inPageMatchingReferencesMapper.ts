import { ConsolidatedChunk } from '../types';
import { InPageMatchingReferencesType } from '../../../mcp/schemas';

export class InPageMatchingReferencesMapper {
  static mapChunksToInPageMatching(
    chunks: ConsolidatedChunk[],
    lastCrawled?: string
  ): InPageMatchingReferencesType {
    return {
      lastCrawled: lastCrawled || new Date().toISOString(),
      relevantChunks: chunks.map(chunk => ({
        id: chunk.id,
        text: chunk.text,
        score: chunk.score,
        sectionPath: chunk.section_path ? chunk.section_path.split('|') : undefined,
      })),
    };
  }
}
