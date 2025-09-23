#!/usr/bin/env node
/* eslint-disable no-console */
import dotenv from 'dotenv';

dotenv.config();

const mode = (process.argv[2] || process.env.VECTOR_DB_MODE).toLowerCase();
if (!['thread', 'process', 'inline'].includes(mode)) {
  console.error('Usage: node scripts/test-db-worker.mjs <thread|process>');
  process.exit(1);
}
async function main() {
  console.log(`[worker-smoke] mode=${mode}`);

  const { dbAll, dbRun, closeDb } = await import('../dist/core/vector/store/worker/db-client.js');
  console.log('[worker-smoke] imported worker client');

  try {
    await dbRun('CREATE TABLE IF NOT EXISTS __smoke(n INTEGER)');
    await dbRun('INSERT INTO __smoke(n) VALUES (?)', [42]);
    const rows = await dbAll('SELECT n FROM __smoke');
    console.log('[worker-smoke] rows:', rows);
    await dbRun('DELETE FROM __smoke WHERE n = ?', [42]);
    await dbRun('DROP TABLE IF EXISTS __smoke');
  } finally {
    await closeDb();
  }
  console.log('[worker-smoke] success');
}

main().catch(err => {
  console.error('[worker-smoke] error:', err);
  process.exit(1);
});
