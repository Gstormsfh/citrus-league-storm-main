import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Chunk 11g.7 sub-step 7a: default LOG_LEVEL=SILENT for tests so
    // engine tests don't spew structured log lines into vitest's
    // output. Specific tests override per-test as needed.
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@citrus/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
});
