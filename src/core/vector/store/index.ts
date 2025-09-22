export { initDuckDb } from './connection';
export { runSchema } from './schema';
export { ensureEmbeddingConfig, clearEmbeddingConfig } from './meta';
export { upsertDocument, getDocument, deleteDocument, type DocumentRow } from './documents';
export {
  upsertChunks,
  similaritySearch,
  deleteChunkById,
  deleteChunksByUrl,
  type ChunkRow,
  type SimilarChunkRow,
} from './chunks';
export { DuckDbPool, getPool, type PoolOptions } from './pool';
