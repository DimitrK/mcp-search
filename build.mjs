/* global process */
import { build } from 'esbuild';
import { copyFile } from 'fs/promises';
import * as glob from 'glob';

const baseConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  outdir: 'dist',
  packages: 'external',
};

const entryPoints = glob.sync('src/**/*.ts');

await build({
  ...baseConfig,
  entryPoints,
});

await copyFile(
  'src/core/vector/store/worker/db-worker.js',
  'dist/core/vector/store/worker/db-worker.js'
);

process.stdout.write('✅ Build completed successfully\n');
