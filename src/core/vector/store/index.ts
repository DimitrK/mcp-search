export { initDuckDb } from './connection';
export { runSchema } from './schema';
export { ensureEmbeddingConfig } from './meta';
export { upsertDocument, getDocument, type DocumentRow } from './documents';
export { upsertChunks, similaritySearch, type ChunkRow, type SimilarChunkRow } from './chunks';
