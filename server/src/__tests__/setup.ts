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

// Chunk 11g.7 sub-step 7c — disable the periodic snapshot timer
// in tests by default. Setting `SNAPSHOT_INTERVAL_MS=0` short-
// circuits `LobbyManager.startSnapshotTimer()` so fake-timer-using
// tests don't trip on the `setInterval` that would otherwise keep
// firing under `vi.useFakeTimers()`. Tests that exercise snapshot
// behavior trigger via `lobby.scheduleSnapshot()` directly OR
// override per-test by setting `process.env.SNAPSHOT_INTERVAL_MS`
// inside `beforeEach`.
if (!process.env.SNAPSHOT_INTERVAL_MS) {
  process.env.SNAPSHOT_INTERVAL_MS = '0';
}
// Same rationale for the milestone trigger: the auction tests bid
// in tight loops that would otherwise blow past 50 events and
// fire snapshots mid-test. `0` disables the milestone trigger.
if (!process.env.SNAPSHOT_EVENT_MILESTONE) {
  process.env.SNAPSHOT_EVENT_MILESTONE = '0';
}
