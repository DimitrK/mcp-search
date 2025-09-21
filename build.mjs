import { build } from 'esbuild';

const baseConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  outdir: 'dist',
  packages: 'external',
};

await Promise.all([
  build({
    ...baseConfig,
    entryPoints: ['src/index.ts'],
  }),
  build({
    ...baseConfig,
    entryPoints: ['src/cli.ts'],
  }),
]);

console.log('✅ Build completed successfully');
