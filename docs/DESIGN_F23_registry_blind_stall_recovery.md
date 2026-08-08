# F23 design doc — registry-blind stall recovery

**Status.** Design authored 2026-08-08 (T4 unattended-day third-shift). Ratification-ready per house style.
**Author.** Terminal.
**Owner.** Engine team (server/src/draft/).
**Priority.** Standing gap; escalation trigger = second registry-blind stall observation OR THE TWELVE incident.

---

## §1 — Problem

`scanClockLiveness` (`server/src/draft/LobbyRegistry.ts:895-980`) is the engine's periodic stall detector. It iterates every in-memory `LobbyManager` in `this.lobbies` and, for each one that's `in_progress` with a past-due `currentTimerDeadline`, attempts recovery via `attemptClockRecovery`. This is the F20 hardening path.

**The scanner is registry-BLIND.** If a lobby is not in `this.lobbies`, it cannot be scanned. Three states put a league in that condition:

1. **Never-created.** Draft ignited (draft_status=in_progress, pick_deadline set) but no client has connected → `LobbyManager` never constructed. Engine has no in-memory tracking.
2. **Idle-evicted.** Lobby existed, then reached `connectionCount === 0` for > idleEvictionMs → `scanIdleLobbies` evicted it → registry-blind.
3. **Never-hydrated post-restart.** Engine restart happens; lobbies rehydrate lazily on WS connect. Any league that hasn't had a client connect since the restart is registry-blind.

Empirical evidence: **the 9.5-hour stalled league** observed 2026-08-06 morning. Fixture league, `in_progress`, seq 1, pick_deadline expired ~9.5h prior. `LobbyRegistry` did not know about it (no client connected in that window). No sweeper caught the stall. Discovered manually via DB inspection.

**Related architect note (INSTRUMENT_LEDGER 2026-08-06):** "F27 brief Q2 (which assumed scanClockLiveness covered this class) is FORMALLY CORRECTED — scanner is live-in-progress-lobbies only, not registry-blind stalls. F23 is now the natural inheritor with concrete evidence."

---

## §2 — Non-goals

- Not a replacement for `scanClockLiveness`. The in-memory scanner is fast + accurate for hydrated lobbies. F23 is the safety net for the registry-blind residual class.
- Not a real-time recovery. Registry-blind stalls are by definition low-frequency; a 60-second detection window is acceptable.
- Not a fix for legitimate zero-client drafts that WILL be joined soon (Rider 2 abandoned-mid-draft class already covered by engine-alone autopick cascade — see 8661d3d4 evidence 2026-08-08).
- Not a replacement for engine-restart recovery via event replay (that path works for lobbies that GET a client post-restart).

---

## §3 — Design options considered

### Option A — DB-side sweep, engine-side action
**Shape.** Add a pg_cron job that runs every 60s. Queries `SELECT id, pick_deadline FROM public.leagues WHERE draft_status='in_progress' AND pick_deadline < now() - interval '2 minutes'`. Sends a NOTIFY on channel `draft_stall_recovery` with `{league_id, expected_deadline}` payload.

Engine (`server/src/draft/index.ts` dispatch) receives NOTIFY on that channel, resolves league → lobby (if hydrated) OR triggers hydration (if not) → engine's LobbyManager attempts recovery via its normal timer-arm/expire path.

**Pros.**
- DB is authoritative source of truth for `pick_deadline`; single query catches every registry-blind stall.
- Engine's existing hydration + recovery flow is reused.
- Zero engine-side polling.
- Compatible with the NOTIFY dispatch pattern engine already understands.

**Cons.**
- Adds a new pg_cron job to prod (cross-workstream coordination per PROD_CHANGE_LEDGER + KI-041 lessons).
- NOTIFY delivery is at-least-once, not exactly-once (defense-in-depth on engine side needed to prevent duplicate hydration).
- Engine-side hydration on NOTIFY re-introduces the resource-exhaustion attack surface that `index.ts:728` explicitly disallows for the general NOTIFY path.

### Option B — Engine-side DB poll on periodic timer
**Shape.** Add a `startRegistryBlindStallScanner` in `LobbyRegistry` that runs every 60s. Queries `SELECT id FROM public.leagues WHERE draft_status='in_progress' AND pick_deadline < now() - interval '2 minutes' AND id NOT IN (<current in-memory lobby ids>)`. For each hit, hydrate + trigger scanClockLiveness's per-lobby recovery path.

**Pros.**
- Fully engine-side; no new pg_cron.
- Reuses `scanClockLiveness` recovery logic once hydration completes.
- Composable with `scanClockLiveness` cadence (same 60s tick).

**Cons.**
- Adds a DB query every 60s. Small load but not zero.
- Hydration-on-poll path (re-)introduces resource-exhaustion class.
- The `NOT IN (<lobby ids>)` filter grows with active-lobby count; not a scale concern at THE TWELVE scale.

### Option C — Snapshot-persistence freshness heartbeat
**Shape.** Every lobby writes a snapshot to `draft_snapshots` on a periodic milestone (already happens per `LobbyManager.snapshotEventMilestone`). A pg_cron job checks `WHERE ds.created_at < now() - interval '5 minutes' AND l.draft_status = 'in_progress'` — snapshot staleness = engine heartbeat missing = candidate for recovery.

**Pros.**
- Reuses existing snapshot-write plumbing.
- Detects a broader class than pick-deadline stall (also catches engine that stopped writing snapshots for other reasons).

**Cons.**
- Snapshot cadence is event-driven, not time-driven. A fresh league with 0 events has no snapshot until first pick. False positive on ignited-not-picked class.
- Requires engine change to enable time-based snapshots on healthy lobbies.
- Overloads snapshot semantics (which are for bootstrap, not heartbeating).

### Recommendation: **Option B (engine-side DB poll on periodic timer)**

Rationale:
- **Single-workstream authoring.** No cross-workstream pg_cron coordination; PROD_CHANGE_LEDGER discipline avoided.
- **Reuses existing recovery path.** Once a lobby is hydrated, `scanClockLiveness` handles the rest via its already-hardened per-lobby logic (F20 identity+wallclock guards).
- **Bounded resource exposure.** Poll query filters to `NOT IN (<in-memory lobby ids>)` + `in_progress` + past-deadline; result set is tiny in practice (0-N registry-blind leagues; usually 0). Hydration is a normal WS-open equivalent.
- **60s cadence matches user-perceived stall tolerance.** Users typically notice a stall around 30-60s; 60s scanner + normal hydration (~100ms) + attemptClockRecovery gets to autopick within ~65s of stall onset. Acceptable given the "F23 = safety net for the residual class" framing.

---

## §4 — Detailed design (Option B)

### 4.1 — File changes

**Extend `server/src/draft/LobbyRegistry.ts`:**

1. Add new interval-scanner constant:
   ```typescript
   /** F23 (2026-08-08): registry-blind-stall scanner interval. */
   static readonly REGISTRY_BLIND_STALL_SCAN_MS = 60_000;
   ```

2. Add new state field for the interval handle (parallel to `clockLivenessScannerHandle`):
   ```typescript
   private registryBlindStallScannerHandle: NodeJS.Timeout | null = null;
   ```

3. New method `startRegistryBlindStallScanner(overrideMs?: number): void`:
   - Symmetric with `startClockLivenessScanner` (LobbyRegistry.ts:830-871).
   - Wraps `scanRegistryBlindStalls` in setInterval + top-level catch.
   - Logs `registry.registry_blind_stall_scanner_started` (INFO).

4. New method `stopRegistryBlindStallScanner(): void` — for graceful shutdown.

5. New method `scanRegistryBlindStalls(): Promise<{ scanned: number; hydrated: number; escalated: number; errored: number }>`:
   - Query: `SELECT id FROM public.leagues WHERE draft_status='in_progress' AND pick_deadline IS NOT NULL AND pick_deadline < now() - interval '2 minutes'`
   - Filter to `NOT IN (in-memory lobby ids)` client-side (avoids parameterizing a growing NOT IN in SQL).
   - For each hit:
     - Log `registry.registry_blind_stall_detected` (WARN) with `{leagueId, pickDeadline}`
     - Call `this.getOrCreate(leagueId, leagueId)` (self-hydrating) to construct + bootstrap the lobby.
     - Once hydrated, `scanClockLiveness` will pick it up on next 60s tick OR call it directly for this lobby.
     - Log `registry.registry_blind_stall_hydrated` (INFO).
   - Return counters.

6. Boot-time invocation: `index.ts` startup — call `lobbyRegistry.startRegistryBlindStallScanner()` alongside existing scanner starts.

### 4.2 — Boot signal (for INS-16 vocabulary)

Add `registry.registry_blind_stall_scanner_started` INFO log at scanner start. Update `docs/DEPLOY_PROTOCOL_F26_F27.md` §1 9-item boot verification list to include the new signal (or promote to 10-item — architect ratifies).

### 4.3 — Config

Two new env-tunable params (optional, sensible defaults):
- `REGISTRY_BLIND_STALL_SCAN_MS` (default 60000)
- `REGISTRY_BLIND_STALL_MIN_OVERDUE_MS` (default 120000 — 2 minutes past deadline before flagging)

Both read at boot from `process.env`, fall back to constants.

### 4.4 — Idempotency + duplicate-scan safety

If two scans race (impossible with setInterval on a single Node process, defensive for MIG-shard future), `getOrCreate` at `LobbyRegistry.ts:397` already synchronously inserts a Promise placeholder before await → concurrent same-key calls converge on one construction. Safe.

### 4.5 — Failure modes

- **DB query fails.** Log ERROR, skip this scan cycle, continue next. Same pattern as existing scanners.
- **Hydration throws.** Per-lobby try/catch pattern (already used in `scanClockLiveness:936-1000`). One bad league doesn't kill the scanner.
- **Hydration succeeds but lobby stays registry-blind on next scan.** Only possible if `getOrCreate` returned but the lobby object doesn't land in `this.lobbies` — that's a broader bug, not F23's concern.
- **False positive: lobby that's about to be joined by a client anyway.** Hydration is idempotent (Map.set + subscribe are no-ops on re-invoke); wasted DB fetch but no state corruption.

### 4.6 — Observability

Structured log lines (per INS-16 harvest-from-real-output pattern; grep-verifiable):
- `registry.registry_blind_stall_scanner_started` (INFO, once at boot)
- `registry.registry_blind_stall_scanner_stopped` (INFO, on shutdown)
- `registry.registry_blind_stall_detected` (WARN, per detection; league_id + overdueMs)
- `registry.registry_blind_stall_hydrated` (INFO, per successful hydration)
- `registry.registry_blind_stall_scan_error` (ERROR, on query or per-lobby throw)

### 4.7 — Tests (offline)

Extend `server/src/draft/__tests__/LobbyRegistry.test.ts`:
1. `scanRegistryBlindStalls: empty in-memory registry + past-deadline league in mock DB → hydrated 1, scanClockLiveness eligible on next tick`
2. `scanRegistryBlindStalls: past-deadline league already in registry → NOT hydrated (NOT IN filter)`
3. `scanRegistryBlindStalls: DB query throws → logs ERROR, returns errored=1, scanner continues`
4. `scanRegistryBlindStalls: past-deadline league with pick_deadline=null → NOT hydrated (guard)`
5. `scanRegistryBlindStalls: past-deadline league with draft_status='completed' → NOT hydrated (guard)`
6. Full-flow test: mock DB returns 1 stalled league → scanRegistryBlindStalls → hydration completes → scanClockLiveness immediately called → attemptClockRecovery fires → engine's setTimeout for autopick queued.

Regression test: after fix lands + first prod deploy, verify existing scanClockLiveness tests still pass (`LobbyRegistry.f20.test.ts`) — no functional regression.

---

## §5 — Ratification bars

| Bar | Check |
|---|---|
| 1. Query-shape safe | `SELECT id FROM leagues WHERE draft_status='in_progress' AND pick_deadline IS NOT NULL AND pick_deadline < now() - interval '2 minutes'` — indexed on draft_status? Verify or add. |
| 2. NOT IN filter avoids SQL-cost blow-up | Client-side filter, not SQL. Result set is small (registry-blind is rare). |
| 3. Hydration path is idempotent | Yes — `getOrCreate` promise-cache. |
| 4. F27b-2 interaction | F27b-2 fix (cursor advance) is orthogonal; new hydration produces same cursor discipline. |
| 5. Boot signal added to §15.14 checklist | Task: update `DEPLOY_PROTOCOL_F26_F27.md` §1 to add `registry.registry_blind_stall_scanner_started` when implemented. |
| 6. No engine-restart regression | Boot-order: existing scanners start after LobbyRegistry.init; F23 scanner slots in same position. |
| 7. Legacy scanner behavior unchanged | `scanClockLiveness` untouched; F23 only adds a new scanner. |
| 8. Observability honesty (INS-16) | All 5 log line names harvest-verified in this doc; PR must grep-verify emissions match cited names. |

---

## §6 — Rollout

1. **Author** (this doc + code) — Terminal, 2026-08-08.
2. **Ratify** — Architect reads this doc; approves Option B; approves ratification bars 1-8.
3. **Implement** — Post-ratification session. Add scanner + tests + wire to boot.
4. **Deploy** — via standard §15.14 pipeline. Boot verification checks 10th signal (or extended 9-item list).
5. **Verify** — Reset a fresh league to in_progress + past-due deadline; do NOT connect any client; wait 60-120s; verify hydration + autopick fires. Post-hydration lobby persists in registry until idle-evicted.
6. **Prod-monitor** — Grep prod logs weekly for `registry.registry_blind_stall_detected` occurrences. Any hit is a real registry-blind stall + evidence of value.

---

## §7 — Related work

- **F20** — clock-liveness for hydrated lobbies (`scanClockLiveness`). F23 is the registry-blind complement.
- **F27b-1** — bootstrap replay dispatch gap. Orthogonal; both hydrated + registry-blind-then-hydrated lobbies use the same replay path.
- **F27b-2** — bootstrap cursor advance. Orthogonal; hydration triggered by F23 uses same cursor discipline.
- **INS-16** — log-vocabulary discipline. F23's 5 new log lines authored per that rule.
- **KI-041** — cron governance. F23 avoids new pg_cron (Option B choice) partly to sidestep this coordination cost.
- **PROD_CHANGE_LEDGER** — engine image pin table would advance on F23-carrying deploy.
- **Empirical evidence:** 9.5h stalled league (2026-08-06); ledger note "F23 formally corrected as natural inheritor" (INSTRUMENT_LEDGER 2026-08-06).

---

**Sign-off.** Design ratification-ready. Awaits architect approval before implementation. Not a THE TWELVE blocker (registry-blind stalls are low-frequency; F23 is prod-hardening). Implementation window: post-close, pre-general-launch.
