#!/usr/bin/env node
import { getPool } from '../dist/core/vector/store/pool.js';
import { fetchAndPersistDocument } from '../dist/core/content/httpFetchAndPersist.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const mode = (process.env.VECTOR_DB_MODE || 'inline').toLowerCase();
  console.log(`[fetch-once] db-mode=${mode}`);
  console.error('[fetch-once] start');
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/run-fetch-once.mjs <url>');
    process.exit(1);
  }
  process.env.SKIP_VSS_INSTALL = '1';
  // console.error('[fetch-once] init duckdb');
  console.error('[fetch-once] db inited');
  const res = await fetchAndPersistDocument(url);
  console.error('[fetch-once] fetch done');
  console.log(JSON.stringify(res, null, 2));
  const db = await getPool();
  const closePromise = db.close();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Pool close timeout')), 5000)
  );
  try {
    await Promise.race([closePromise, timeoutPromise]);
  } catch (error) {
    console.error('[fetch-once] Error closing pool:', error);
  }
  console.error('[fetch-once] done');

}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
