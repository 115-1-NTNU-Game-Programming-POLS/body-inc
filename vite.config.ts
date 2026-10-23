import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative URLs so the build works under the GitHub Pages sub-path.
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
