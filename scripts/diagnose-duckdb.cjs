const { DuckDBInstance } = require('@duckdb/node-api');
const { join } = require('path');
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

async function main() {
  console.log(`[DIAGNOSTIC] Starting DuckDB test with @duckdb/node-api.`);
  console.log(`[DIAGNOSTIC] Database path: ${dbPath}`);

  cleanup();
  mkdirSync(dbDir, { recursive: true });

  try {
    console.log('[DIAGNOSTIC] Calling DuckDBInstance.create()...');
    const instance = await DuckDBInstance.create(dbPath);
    console.log('[DIAGNOSTIC] DuckDB instance created successfully.');

    console.log('[DIAGNOSTIC] Connecting to database...');
    const conn = await instance.connect();
    console.log('[DIAGNOSTIC] Connection established successfully.');

    console.log('[DIAGNOSTIC] Running test query...');
    await conn.run('CREATE TABLE test (id INTEGER, name TEXT)');
    await conn.run("INSERT INTO test VALUES (1, 'hello'), (2, 'world')");
    const result = await conn.runAndReadAll('SELECT * FROM test');
    const rows = result.getRowObjects();
    console.log('[DIAGNOSTIC] Test query results:', rows);

    console.log('[DIAGNOSTIC] Closing connection...');
    conn.closeSync();
    console.log('[DIAGNOSTIC] Connection closed successfully.');

    console.log('[DIAGNOSTIC] Closing instance...');
    instance.closeSync();
    console.log('[DIAGNOSTIC] Instance closed successfully.');

    cleanup();
    console.log('[DIAGNOSTIC] Script finished successfully.');
  } catch (err) {
    console.error('[DIAGNOSTIC] FATAL: Error during DuckDB operations:', err);
    cleanup();
    process.exit(1);
  }
}

main();
