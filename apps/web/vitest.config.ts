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
    // HERMETIC ENV (2026-08-25). Pin the VITE_* values the suite is written
    // against so a local run and a CI run are the same run.
    //
    // Without this, whichever .env files happen to exist on the machine leak
    // into import.meta.env and silently change behaviour. Two ways that bit:
    //
    //   * api/client.ts reads VITE_API_URL and prefixes it onto every path.
    //     A developer with it set gets absolute URLs and fails the
    //     relative-path assertions in api/__tests__/client.test.ts, while CI
    //     — which has no .env at all — passes. "Works on CI, fails locally"
    //     is just as expensive as the reverse.
    //   * Several tests exist specifically to prove a module can be imported
    //     with VITE_SUPABASE_* UNSET (integrations/supabase/client.ts throws
    //     at module scope otherwise). On a machine where those vars are set,
    //     those guards pass without guarding anything.
    //
    // Empty strings, not absent keys: that is exactly what CI's environment
    // looks like to import.meta.env, so the suite behaves identically here.
    //
    // NOTE the env-directory split that made this easy to hit. vite.config.ts
    // sets `envDir` to the MONOREPO ROOT; this config sets none, so Vitest
    // defaults it to apps/web. The two halves of the same package read .env
    // from two different directories — a file that the build ignores can
    // still reach the tests, which is precisely how this surfaced.
    env: {
      VITE_API_URL: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      include: ['src/utils/**', 'src/services/**'],
    },
  },
});
