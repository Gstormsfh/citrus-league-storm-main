import { defineConfig } from 'vitest/config';

// Until 2026-09-01 the six suites under src/**/__tests__ were run by nothing:
// this package had no `test` script (`build` is `tsc --noEmit`),
// apps/web/vitest.config.ts includes only `src/**` under apps/web, and
// server/vitest.config.ts only `src/**/__tests__` under server. A test here
// could rot for weeks without anyone seeing it — leagueTimeline.test.ts did
// exactly that after the 2026-08-24 launch build changed the contract it
// pinned. `npm run test:shared` (root), `npm run test` (here) and the CI job
// `test-shared` all run this config.
//
// No aliases: every shared test imports its subject by relative path, and
// nothing under packages/shared imports `@citrus/shared` or `@/`. vitest is
// resolved from the hoisted root node_modules (declared by apps/web and
// server), which is where a root `npm ci` puts it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
