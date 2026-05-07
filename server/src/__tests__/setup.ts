// Phase 4.5 chunk 11g.7 sub-step 7a — vitest test environment setup.
//
// Default `LOG_LEVEL=SILENT` for the test runner so engine tests
// don't spew hundreds of structured log lines into vitest's output.
// Specific tests that need to assert log calls (e.g.,
// `structuredLogger.test.ts`) override `process.env.LOG_LEVEL`
// in `beforeEach` and create a fresh logger instance.
//
// Wired via `vitest.config.ts` setupFiles option.

if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'SILENT';
}
