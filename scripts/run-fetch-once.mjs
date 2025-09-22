#!/usr/bin/env node
import { initDuckDb } from '../dist/core/vector/store/duckdbVectorStore.js';
import { fetchAndPersistDocument } from '../dist/core/content/httpFetchAndPersist.js';

async function main() {
  console.error('[fetch-once] start');
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/run-fetch-once.mjs <url>');
    process.exit(1);
  }
  // Provide defaults for required env to allow DB init without full config
  process.env.GOOGLE_API_KEY ||= 'mock';
  process.env.GOOGLE_SEARCH_ENGINE_ID ||= 'mock';
  process.env.EMBEDDING_SERVER_URL ||= 'http://localhost:11434/v1';
  process.env.EMBEDDING_SERVER_API_KEY ||= 'mock';
  process.env.EMBEDDING_MODEL_NAME ||= 'text-embedding-3-small';
  process.env.DATA_DIR ||= '.mcp-search-dev';
  process.env.REQUEST_TIMEOUT_MS ||= '20000';
  process.env.CONCURRENCY ||= '2';
  process.env.SKIP_VSS_INSTALL = '1';
  console.error('[fetch-once] init duckdb');
  const db = await initDuckDb();
  console.error('[fetch-once] db inited');
  const res = await fetchAndPersistDocument(db, url);
  console.error('[fetch-once] fetch done');
  console.log(JSON.stringify(res, null, 2));
  db.close();
  console.error('[fetch-once] done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
