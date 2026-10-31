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
    // Tests that spawn a check script or replay a whole exam run past 5 s when all workers share the machine.
    testTimeout: 30_000,
  },
});
