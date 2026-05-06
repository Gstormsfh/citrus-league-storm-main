import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// Phase 4.5 chunk 11g.5b: react-swc plugin added so `.test.tsx`
// files can use JSX without manually importing React in every file
// (tsconfig.app.json's `jsx: react-jsx` automatic runtime — same
// transform as the dev/build pipeline). Pre-5b tests were all
// `.test.ts` (no JSX); 5b is the first set of React component tests.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@citrus/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      include: ['src/utils/**', 'src/services/**'],
    },
  },
});
