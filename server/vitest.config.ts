import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
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
