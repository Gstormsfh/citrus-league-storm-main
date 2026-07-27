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

// Chunk 11g.7 sub-step 7d — disable the WebSocket heartbeat soft-
// check timer in tests by default. Setting `HEARTBEAT_PONG_TIMEOUT_MS`
// or `HEARTBEAT_PING_INTERVAL_MS` to `0` short-circuits the timer
// startup in `uws-server.ts`. Same rationale as the snapshot timer:
// fake-timer-using tests don't want a 10s setInterval ticking in the
// background. Heartbeat-specific tests in `heartbeat.test.ts` are
// pure-function tests that bypass the timer entirely; tests that
// exercise the soft-check end-to-end (none today — chunk 11g.7
// declined uWS integration tests in scope) would override these
// per-test in `beforeEach`.
if (!process.env.HEARTBEAT_PING_INTERVAL_MS) {
  process.env.HEARTBEAT_PING_INTERVAL_MS = '0';
}
if (!process.env.HEARTBEAT_PONG_TIMEOUT_MS) {
  process.env.HEARTBEAT_PONG_TIMEOUT_MS = '0';
}

// Chunk 11g.7 sub-step 7e — disable the LISTEN/NOTIFY event
// subscription in tests by default. The engine entry point at
// `server/src/draft/index.ts` checks this env and skips
// `startEventSubscription` when set to `'1'`. Tests that exercise
// the subscription explicitly (e.g., `eventSubscription.test.ts`'s
// pure-function tests + lifecycle tests with mock pg clients) bypass
// the engine entry point entirely; tests that need real pg LISTEN
// (cross-process integration — out of scope for 7e, belongs to
// chunk 11g.10/11g.11 staging tests) would override this per-test.
if (!process.env.EVENT_SUBSCRIPTION_DISABLED) {
  process.env.EVENT_SUBSCRIPTION_DISABLED = '1';
}

// Chunk 10c-2 batch 3 (2026-07-27) — disable the LobbyRegistry
// idle-eviction scanner in tests by default. Setting either the
// window or scan interval to `0` short-circuits
// `startIdleEvictionTimer` so fake-timer-using tests don't trip on
// a periodic setInterval. Idle-eviction-specific tests
// (`LobbyRegistry.test.ts`'s new suite) override these per-test in
// `beforeEach` OR pass `idleEvictionMs`/`idleEvictionScanMs` via
// the constructor `opts` to exercise the scan path directly.
if (!process.env.LOBBY_IDLE_EVICTION_MS) {
  process.env.LOBBY_IDLE_EVICTION_MS = '0';
}
if (!process.env.LOBBY_IDLE_EVICTION_SCAN_MS) {
  process.env.LOBBY_IDLE_EVICTION_SCAN_MS = '0';
}
