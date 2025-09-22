const duckdb = require('duckdb');
const { join, dirname } = require('path');
const { mkdirSync, rmSync } = require('fs');

const dbDir = join(__dirname, 'db-diagnostics');
const dbPath = join(dbDir, 'test.duckdb');

function cleanup() {
  console.log('[DIAGNOSTIC] Cleaning up diagnostic directory...');
  try {
    rmSync(dbDir, { recursive: true, force: true });
    console.log('[DIAGNOSTIC] Cleanup successful.');
  } catch (e) {
    console.error('[DIAGNOSTIC] Cleanup failed', e);
  }
}

console.log(`[DIAGNOSTIC] Starting DuckDB test.`);
console.log(`[DIAGNOSTIC] Database path: ${dbPath}`);

cleanup();
mkdirSync(dbDir, { recursive: true });

console.log('[DIAGNOSTIC] Calling new duckdb.Database()...');

const db = new duckdb.Database(dbPath, (err) => {
  if (err) {
    console.error('[DIAGNOSTIC] FATAL: Error during DB initialization callback:', err);
    cleanup();
    process.exit(1);
  }
  console.log('[DIAGNOSTIC] DB constructor callback fired successfully.');

  db.close((err) => {
    if (err) {
      console.error('[DIAGNOSTIC] FATAL: Error during DB close callback:', err);
      cleanup();
      process.exit(1);
    }
    console.log('[DIAGNOSTIC] DB close callback fired successfully.');
    cleanup();
    console.log('[DIAGNOSTIC] Script finished successfully.');
    process.exit(0);
  });
});

console.log('[DIAGNOSTIC] Script execution finished, waiting for callbacks...');
