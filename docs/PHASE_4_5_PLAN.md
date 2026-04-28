# Phase 4.5 — Persistent Node Draft Worker on Cloud Run (Chunks 11g.1–11g.9)

| | |
|---|---|
| **Status** | Plan accepted (2026-04-28). Implementation not yet started. |
| **Authority** | `docs/adr/ADR-001-elixir-phoenix-draft-engine.md` (the architectural decision: persistent Node service on Cloud Run); `CLAUDE.md` § Citrus Draft Performance Mandate (the binding performance targets). |
| **Predecessor** | Phase 4 closeout, with autopick latency ~11.7s/pick measured on staging — non-competitive per the Mandate. |
| **Successor** | Phase 5 (UI client work) is **blocked** until chunk 11g.9 sign-off. |
| **Estimated solo-founder timeline** | Chunks 11g.1–11g.9 ≈ 4–6 weeks of solo-founder work assisted by Claude Code, including cushion for unknowns. The Cloud Run Node path is materially shorter than the prior Elixir plan because there's no new language/runtime to ramp on. |

## Working discipline (carried forward from Phase 0–4)

- **One chunk per commit.** Each chunk pushed and reviewed before the next starts.
- **Pause for review at every chunk gate.** No silent drift between chunks.
- **No deferral lands without a registry row.** New issues that surface during the build go into `docs/REGISTRY.md` (project-wide concerns) or `docs/RUNBOOKS/draft-engine-v2-known-issues.md` (draft-engine-specific) at commit time.
- **Performance Mandate is the binding constraint for every chunk.** Any chunk that introduces a new latency-sensitive surface must measure it; any chunk that fails a target either fixes it before the next chunk starts or registers a KI- with a bounded resolution timeline.
- **Tier 1 perf optimizations are baked in, not deferred (KI-010).** Parallel async on independent reads, byte-limited deltas, fanout protection, in-memory candidate caching — each lands in the chunk that introduces the surface, called out by name in code comments so a reviewer can grep.
- **Integration boundary is the existing Postgres RPC surface plus the WebSocket message protocol.** The RPC surface (`submit_pick_v2`, `append_draft_event`, `reconstruct_draft_state`, etc.) doesn't change without an ADR. The WebSocket message protocol is the chunk 11g.2 deliverable and follows the same governance discipline thereafter.

## Performance targets (binding, from `CLAUDE.md` § Citrus Draft Performance Mandate)

These are the constraints every chunk's acceptance criteria reference:

- Manual pick submission: p95 ≤ 300ms, p99 ≤ 500ms
- Autopick latency: p95 ≤ 1000ms, p99 ≤ 2000ms
- Draft state load: p95 ≤ 1500ms
- Timer drift: < 100ms across all clients
- Pick-to-broadcast fanout: p95 ≤ 200ms
- Reconnection recovery: p95 ≤ 2000ms

A chunk's "performance gate" is a measured-on-staging assertion against these targets, scoped to whatever surface the chunk introduces. The full target set is verified end-to-end at chunk 11g.9.

---

## Phase 4.5 — Persistent Node worker, end-to-end on Cloud Run

The goal of Phase 4.5 is a **persistent Node worker running on Cloud Run, hosting active drafts via WebSocket**, with measured performance meeting every Mandate target and disaster-recovery integration with the Edge Function safety net verified.

Chunk 11g.4 is the first hard performance gate (manual pick latency). Chunk 11g.7 is the recovery gate. Chunk 11g.9 is the Phase 5 entry gate (full Mandate target set verified end-to-end on the deployed Cloud Run worker).

### Chunk 11g.1 — Cloud Run Node service skeleton

**Deliverable.** New Node service in the monorepo (path TBD — likely a top-level workspace alongside `apps/`, `server/`, `packages/`; the chunk's commit documents the choice). Hono or Express HTTP server with a single `/health` endpoint returning `{status: "ok"}`. Dockerfile that builds the service into a container suitable for Cloud Run. `cloudbuild.yaml` (or equivalent) that builds and deploys to a staging Cloud Run service with CPU allocation set to "always", min instances ≥ 0 for staging cost control, max instances bounded. The service imports `@citrus/shared` from the workspace and successfully connects to the staging Postgres at boot via the existing Supabase client factory.

**Dependencies.** None. Pure infrastructure chunk.

**Acceptance criteria.**
- The service boots locally via `npm run dev:worker` (added to root `package.json`); `curl localhost:<port>/health` returns 200.
- The service deploys to staging Cloud Run via the documented pipeline; `curl https://<staging-url>/health` returns 200 from the deployed instance.
- At boot the service successfully creates a Supabase client via the existing factory and runs a trivial query (e.g., `select 1` or a single-row `select * from leagues limit 1`) against staging.
- The service's package imports `@citrus/shared` and the build picks up the canonical `AUTOPICK_NAMESPACE_UUID` constant from the package (no vendoring; verified by a unit test reading the constant and asserting it matches the documented value).
- Top-level README updated with the new workspace's purpose and how to run it locally. Same level of detail as existing workspace docs.

**Performance targets.** None — infrastructure only.

**Estimated effort.** 2–3 days. Most of the work is getting the Cloud Run deploy pipeline + IAM + the Supabase service-role-key wiring solid.

---

### Chunk 11g.2 — WebSocket layer + message protocol v1

**Deliverable.** WebSocket server attached to the Cloud Run service. Library decision lives in the chunk's commit message — either `ws` for minimal surface area or `socket.io` if its reconnection/heartbeat conveniences earn their weight against the bundle-size cost. v1 of the WebSocket message protocol documented in `docs/DRAFT_WEBSOCKET_PROTOCOL.md` (new file) — message envelope shape, the initial set of message kinds (`hello`, `joined`, `error`, `state_snapshot`, `event`), version byte, sequence-number field. v1 doesn't include picks yet — that's chunk 11g.4. Today's deliverable is "two clients can connect, the server can broadcast a message to all of them, the protocol envelope is documented and stable."

**Dependencies.** 11g.1.

**Acceptance criteria.**
- A test (Vitest, in the worker workspace) opens two WebSocket clients to the local worker, the server broadcasts a synthetic message, both clients receive it with the correct envelope.
- The protocol document is comprehensive enough that an external reviewer can implement a compatible client from it alone (the React UI in Phase 5 will be that reviewer).
- Connection cleanup verified: closing a client cleanly removes it from the server's connection registry; closing forcibly (kill -9 the test process) removes it within the heartbeat timeout (timeout value documented).
- The deployed Cloud Run instance accepts WebSocket connections from a real browser (verified manually with a one-off test page).

**Performance targets.** Connection establishment + first server message: p95 ≤ 200ms on the deployed worker. Not a Mandate target, but a sanity check.

**Estimated effort.** 3–4 days.

---

### Chunk 11g.3 — `DraftRoom` class with in-memory state + Tier 1 perf optimizations

**Deliverable.** A `DraftRoom` TypeScript class encapsulating in-memory state for one draft: candidate pool (loaded from `player_directory` + `player_season_stats` for `CURRENT_SEASON`, filtered against `draft_picks_v2`), current pick number, generation, on-the-clock team, per-team queues from `draft_queues`, connected-clients set, last broadcast event id. A static `DraftRoom.load(leagueId)` factory that hydrates state from Postgres and returns a `DraftRoom`. **Tier 1 perf optimizations baked in from this chunk forward (KI-010):**

- **Parallel async on independent reads.** `DraftRoom.load` issues `player_directory`, `player_season_stats`, `draft_picks_v2`, and `draft_queues` reads via `Promise.all`, not sequentially. Each query gets a code comment naming the optimization.
- **In-memory candidate caching.** The candidate pool sits in `DraftRoom._candidates` for the lifetime of the room. Pick events update the cache in place; no re-fetch from Postgres on each pick (KI-006 resolution path).

A `DraftRoomRegistry` (in-memory `Map<leagueId, DraftRoom>`) for lookup. WebSocket `join` messages from clients trigger the registry to ensure the room exists (load on first join, cached thereafter). No persistence of the registry yet — restarts re-load on demand (chunk 11g.7 makes restart explicit).

**Dependencies.** 11g.2.

**Acceptance criteria.**
- A test opens a WebSocket connection, sends a `join` message for a seeded draft, receives a `state_snapshot` containing the in-memory state. The snapshot's pick count, on-the-clock team, and candidate-pool size match what the event log says.
- The `DraftRoom.load` query plan is logged in dev with timing breakdowns showing the parallel reads did indeed run concurrently (verified by total wall time ≈ max of individual query times, not sum).
- Idempotent join: a second `join` message from a different connection returns the same snapshot without re-loading from Postgres.
- A unit test asserts `DraftRoom._candidates.length` decreases by 1 after a synthetic pick event is applied (cache update happens in-process; no Postgres round-trip).

**Performance targets.**
- Draft state load (client `join` → `state_snapshot` received): p95 ≤ 1500ms (Mandate target). **First hard performance gate.** Includes the cold-load case (room not in registry) since that's the user-perceived latency on first join.

**Estimated effort.** 5–7 days. This is the chunk that proves the architectural shape works.

---

### Chunk 11g.4 — Pick submission flow + byte-limited delta broadcasts + fanout protection

**Deliverable.** WebSocket `submit_pick` message handling end-to-end. The client sends `submit_pick` with `(player_id, expected_pick_number)`; the server validates against in-memory state (correct on-the-clock team, player not already picked, draft not paused), calls `submit_pick_v2` via the existing Phase 2 RPC with the appropriate idempotency key (UUIDv5 from `@citrus/shared`'s `computePickPayloadHash` + namespace), updates `DraftRoom` in-memory state on success, broadcasts the pick to all connected clients in the room. **Two more Tier 1 optimizations land in this chunk (KI-010):**

- **Byte-limited delta broadcasts.** Don't ship the full state on every event. Ship a delta (the new pick event + the affected team's queue head + the next on-the-clock team), bounded in size. The WebSocket protocol document is updated to specify the delta envelope. Initial size budget: ≤ 4 KB per broadcast in the typical case.
- **Per-room fanout protection.** A simple per-room rate limiter on broadcast emissions (e.g., a token bucket on the `DraftRoom`). Prevents a runaway loop or a malicious client from flooding the broadcast channel and starving other rooms on the same instance. Exact limits are documented in the chunk's commit message.

**Dependencies.** 11g.3.

**Acceptance criteria.**
- Two WebSocket clients connect to the same room, one submits a valid pick, both receive the broadcast within the Mandate's fanout target. `draft_picks_v2` and `draft_events` have the pick committed with correct `seq` and `idempotency_key`.
- Cross-runtime parity: the worker's pick uses the same `idempotency_key` that the existing TypeScript `DraftServiceV2` path produces for the same logical pick. Verified by a unit test computing both and asserting equality.
- Idempotency: re-submitting the same pick (e.g., client retry on a flaky network) returns `was_duplicate=true` without writing a second event. The second client's connection sees only one broadcast.
- Pick validation rejects: wrong on-the-clock team, already-picked player, paused draft, stale `expected_pick_number`.
- Broadcast delta size ≤ 4 KB in the typical case. A test asserts the upper bound.
- Fanout protection tested: a synthetic loop attempting to emit > N broadcasts/sec on one room is throttled; other rooms on the same worker instance are unaffected.

**Performance targets** (the first hard hot-path gate against the Mandate):
- Manual pick submission (client send → all connected clients receive broadcast): **p95 ≤ 300ms, p99 ≤ 500ms** over 100 trial picks on the deployed Cloud Run worker.
- Pick-to-broadcast fanout (server commits → first/last client receives): **p95 ≤ 200ms**.

Failure of either target triggers a chunk-level revisit before 11g.5 starts; no carry-forward. KI-010 binds.

**Estimated effort.** 5–7 days.

---

### Chunk 11g.5 — Reconnection with sequence-number resume protocol

**Deliverable.** A documented and tested reconnection protocol. Each broadcast carries a monotonically increasing per-room `event_id` (sourced from `draft_events.seq`). On WebSocket disconnect → reconnect, the client passes its `last_seen_event_id` in the `join` envelope; the server compares against the in-memory `DraftRoom` state and replies with either:

- A delta (the events the client missed, drawn from `draft_events` for that room — bounded; if the gap is too large, server sends a full `state_snapshot` instead).
- The standard `state_snapshot` if `last_seen_event_id` is absent or unrecognized (e.g., generation rollover after a `draft_resume`).

Server-side: brief grace period for connected-client tracking (a connection that drops and reconnects within the grace period keeps its slot in the room's connection registry without needing re-authentication). The protocol document from 11g.2 is extended to specify the resume envelope.

**Dependencies.** 11g.4.

**Acceptance criteria.**
- Test: client opens, observes 3 picks, drops connection forcibly (kill -9 or transport-level close), reopens connection with `last_seen_event_id`, receives the missed deltas without a full snapshot.
- Test: client drops connection for > grace period (e.g., 30 seconds), reconnects, server falls back to full snapshot. Reconciles cleanly.
- Test: large gap (≥ N missed events; N documented in the chunk) → server sends snapshot, not delta. Threshold is a config knob.
- Test: a generation rollover (`draft_resume` after `draft_pause`) invalidates `last_seen_event_id` from the prior generation; reconnect gets a fresh snapshot.
- Browser-level test (manual on staging): refresh the page mid-draft, the new tab's reconnect lands within the Mandate target and renders the same state.

**Performance targets.**
- Reconnection recovery (drop → reconnect → state resynced): **p95 ≤ 2000ms** (Mandate target).

**Estimated effort.** 4–5 days.

---

### Chunk 11g.6 — Pick deadline timer + autopick logic

**Deliverable.** Each `DraftRoom` schedules a `setTimeout` for the current pick's deadline (computed from the existing server-owned-time guarantees in Phase 0–4). On expiry the room runs the autopick path:

- Heuristic: queue first (head of `draft_queues` for the on-the-clock team, filtered to undrafted), heuristic fallback (FPTS + positional need, identical to `supabase/functions/draft-autopick/heuristic.ts` — port the heuristic to TypeScript inside the worker workspace, with the existing canonical `@citrus/shared` scoring weights).
- Idempotency key: UUIDv5 over `(league_id, pick_number, generation, "autopick")` using `AUTOPICK_NAMESPACE_UUID` from `@citrus/shared`. Same derivation as the SQL `_v2_test._uuidv5` helper and the existing Edge Function path.
- Commit via `submit_pick_v2` with `actor.kind='autopick'`, broadcast via the chunk 11g.4 delta path, schedule the next deadline.

The Edge Function `draft-autopick` is **not** removed in this chunk. It stays paused on staging. The worker is the primary path; the Edge Function path becomes the safety net (chunk 11g.8 wires the integration explicitly).

Timer cleanup on shutdown / room eviction is explicit; orphaned `setTimeout` handles are documented as a known-bad pattern and avoided.

**Dependencies.** 11g.3, 11g.4, 11g.5.

**Acceptance criteria.**
- A 12-team / 12-pick unattended draft (every pick via autopick, no human clients) runs to completion via the worker. Total wall time well under the round-budget.
- A 12-team / 180-pick (15 rounds) full unattended draft runs to completion via the worker. Total wall time consistent with autopick p95 ≤ 1000ms × 180 picks ≈ 3 minutes; 2× cushion.
- Cross-runtime parity: an autopick committed by the worker has the **same idempotency key** the Edge Function path would have produced for the same logical pick. Verified by computing both and asserting equality.
- Heuristic parity with the existing Edge Function: feed both the same candidate pool + queue + roster state and assert the same selection. (Spot-checked on a fixture; doesn't have to be exhaustive.)
- Timer drift: server-displayed countdown vs. actual deadline, sampled across simulated clients, **drift < 100ms** (Mandate target).

**Performance targets.**
- Autopick latency (deadline expiry → pick committed → broadcast received): **p95 ≤ 1000ms, p99 ≤ 2000ms** (Mandate target).
- All 11g.4 targets continue to hold (no regression on the manual pick path).

**Estimated effort.** 5–7 days. The biggest single chunk.

---

### Chunk 11g.7 — Crash recovery: worker restart reloads all active drafts

**Deliverable.** On worker boot, the service queries Postgres for "currently active drafts" (active `draft_status = 'in_progress'` per the existing schema), and reloads a `DraftRoom` for each. Each room rehydrates state via the chunk 11g.3 path, schedules its next deadline timer based on the current `pick_deadline` minus `now()`, and broadcasts a `state_snapshot` to any clients that reconnect. Connected clients reconnect via the chunk 11g.5 resume protocol; new connections after the gap join cleanly.

Graceful shutdown is wired up: SIGTERM (Cloud Run sends this on instance roll) drains connections (notifies clients of pending shutdown so they reconnect to the new instance), cancels in-flight timers, exits cleanly. Timer cleanup avoids the orphaned-callback pattern.

The chunk also wires up a "draft eviction" path: a room with no connected clients for N minutes (configurable; default 10 minutes) is evicted from the registry to release memory. Reconnect re-loads. Eviction is not crash; it's an explicit graceful release.

**Dependencies.** 11g.6.

**Acceptance criteria.**
- Test: kill the worker mid-draft (5 picks committed, 12 connected clients), restart, verify all clients reconnect via the resume protocol, verify reconstructed state matches the event log, continue picking. **No data loss, no duplicate picks.**
- Test: pause a draft via `draft_pause`, kill the worker, restart, verify the reloaded `DraftRoom` correctly identifies the draft as paused and rejects picks until resumed. Then call `draft_resume` and verify the worker accepts picks under the new generation.
- Test: graceful shutdown — send SIGTERM to a worker hosting an active draft, observe clients getting the pending-shutdown notification, observe clean exit within the drain window (≤ 30 seconds).
- Test: idle eviction — a draft with no connected clients for the configured timeout is evicted; memory drops; reconnect re-loads cleanly with no observable difference from a fresh load.
- Recovery latency: a worker reconstructing state for N=10 active drafts (each 12 teams, ~8 picks committed) completes the boot-time hydration in < 5 seconds total.

**Performance targets.**
- Per-draft reload latency: p95 ≤ 1500ms (matches the Mandate's draft state load target — same operation).
- Manual pick p95 still meets the Mandate after a forced reload mid-draft.

**Estimated effort.** 4–6 days.

---

### Chunk 11g.8 — Integration with pgmq safety net (Edge Function as fallback only)

**Deliverable.** The wiring that makes the persistent worker the primary path and the Edge Function the disaster-recovery path. Specifically:

- The pgmq sweep + keep-alive cron stay scheduled in production (they're already paused on staging from Phase 4 closeout). Re-enable them on staging as part of this chunk's deploy.
- The persistent worker takes precedence: when a pick deadline fires inside a `DraftRoom`, the worker autopicks immediately. Under normal operation, the pgmq sweep's `draft_deadline_sweep()` finds no expired deadlines because the worker has already committed them.
- The Edge Function only acts on deadlines that the worker missed (because the worker was unavailable). The existing pgmq generation gate keeps stale messages stale; the existing idempotency-key advisory lock keeps double-picks from landing if both paths race.
- No code is deleted. The Edge Function `supabase/functions/draft-autopick/` keeps the same role it has on staging today, just with the worker now in front of it. The vendored shared code at `supabase/functions/_shared/_vendored/` (KI-007) stays in place but its scope formally narrows to the Edge Function fallback.

The disaster-recovery drill from KI-009's verification test runs as part of this chunk's acceptance.

**Dependencies.** 11g.7.

**Acceptance criteria.**
- Test (the KI-009 disaster-recovery drill): with a draft in progress, deliberately stop the worker. Verify the pg_cron sweep catches the next expired deadline within ~10 seconds; the Edge Function fires; `submit_pick_v2` commits the autopick; the pick lands in `draft_events` and `draft_picks_v2`. Restart the worker; verify state reload includes the picks committed during the outage; resume cleanly with no duplicate picks. **Pass:** end-to-end picks land during the outage window, no double-picks on recovery.
- Test: under normal operation (worker healthy), verify the pgmq queue stays empty in steady state — the worker drains it before the cron fires. Cron sweep returns 0 picks-processed for the typical case.
- Test: contention case — both paths attempt to pick the same expired deadline simultaneously. Idempotency-key advisory lock prevents both from committing; one path wins, the other gets a `was_duplicate=true` and exits cleanly. Verified at the SQL level.
- KI-009's verification entry references this chunk's tests by file path.

**Performance targets.**
- All Mandate targets continue to hold under normal operation (worker primary).
- Disaster-recovery path latency is documented but not held against the Mandate (it's the safety net, not the hot path).

**Estimated effort.** 3–4 days.

---

### Chunk 11g.9 — Performance instrumentation harness + Phase 5 entry gate

**Deliverable.** A standalone benchmark suite (path TBD inside the worker workspace; chunk's commit documents) that measures and reports against every Mandate target end-to-end. Driver script seeds N concurrent drafts on the deployed Cloud Run worker, opens M client connections per draft, runs picks at the deadline boundary, and emits a structured report: per-target p50/p95/p99 latency, throughput, error rate, plus a one-line per-target pass/fail summary. Output committed to the repo so future regression checks have a reference baseline.

This chunk also produces the operational deliverables that gate Phase 5:

- Cloud Run cost projection at v1 scale (~50 concurrent drafts during peak season). Cost monitoring dashboard wired up.
- Deploy runbook: how to ship a worker code change without dropping in-flight drafts (graceful drain + WebSocket reconnect protocol takes the gap).
- "Worker is down" runbook: the disaster-recovery story written down explicitly. Includes how to verify the safety net is working.
- Observability: worker logs flow into the same aggregation as the Node main app. Each Mandate target has a corresponding metric dashboard. Alerts configured for p95 regressions on the autopick path and broadcast fanout.
- KI-006's heuristic-latency entry can flip to "RESOLVED via 11g.3 in-memory candidate cache" if measurements support the claim.

**Dependencies.** 11g.6, 11g.7, 11g.8.

**Acceptance criteria — and the Phase 5 entry gate per ADR-001 § Validation Gates:**
- The harness measures, end-to-end on the deployed Cloud Run worker:
  - Manual pick latency (client submits → all connected clients have updated state)
  - Autopick latency (deadline expiry → broadcast received)
  - Broadcast fanout (server commits → first/last client receives)
  - Draft state load (client `join` → `state_snapshot` received)
  - Reconnection recovery (drop → reconnect → state resynced)
  - Timer drift (server-displayed countdown vs. actual deadline, sampled across simulated clients)
- Report format: human-readable summary at top, JSONL per-trial detail below for analysis. Committed alongside the harness.
- Re-running the harness is a single command.
- **Every Mandate target met.** Manual pick p95 ≤ 300ms / p99 ≤ 500ms; autopick p95 ≤ 1000ms / p99 ≤ 2000ms; broadcast fanout p95 ≤ 200ms; draft state load p95 ≤ 1500ms; reconnection recovery p95 ≤ 2000ms; timer drift < 100ms. Failures fix forward.
- Cost projection committed; dashboards visible; alerts firing in a test scenario.
- Both runbooks (deploy, "worker is down") are operationally credible: a fresh reader can act on them.

**Pass:** Phase 5 (UI client work) unblocks. **Fail:** any Mandate target missed by more than 10% triggers a design revisit before Phase 5 starts (per ADR-001 § Validation Gates / Reversibility).

**Performance targets.** All Mandate targets, end-to-end, on the deployed Cloud Run worker.

**Estimated effort.** 4–6 days.

---

## Chunk 11g.9 sign-off → Phase 5 unblocks

When 11g.9 lands cleanly:

- Every Mandate target is met on the deployed Cloud Run worker.
- KI-009 is operational: the pgmq + Edge Function safety net stays in place; the worker is the primary path; the disaster-recovery drill passes.
- KI-010 is operational: each Tier 1 perf optimization landed in the chunk that introduced the relevant surface, with code-comment evidence.
- KI-006 (per-pick candidate scan latency) can flip to **RESOLVED** if 11g.9 measurements demonstrate the in-memory cache eliminates the original cost.
- Phase 5 (UI client work) starts. The UI is built against the WebSocket protocol from chunks 11g.2 + 11g.4 + 11g.5. The Phase 0–4 server-side TypeScript pick path (`server/src/services/DraftServiceV2.ts`) stays as a fallback for clients that can't open WebSockets but is no longer the primary path.

---

## Registry tracking during the build

New issues that surface during chunks 11g.1–11g.9 land in the appropriate registry at commit time:

- **Cross-cutting / project-wide concerns** → `docs/REGISTRY.md`. Examples: Cloud Run cost surprises, security review gaps that span the worker + main app boundary, observability integration gaps.
- **Draft-engine-specific concerns** → `docs/RUNBOOKS/draft-engine-v2-known-issues.md`. Examples: a specific Postgres query that needs a new index for the worker's hot path, a WebSocket library quirk, a heuristic edge case that shows up under load.
- **Spec-level concerns (changes to the integration boundary)** → require an ADR. The integration boundary (RPC signatures, payload shapes, idempotency-key derivation, WebSocket message protocol) does not change without explicit governance.

Existing open KIs that interact with this work:

- **KI-003** (Phase 7 carryover): rate limiter session-affinity. The persistent worker's `DraftRoom` model solves the per-instance state problem for picks (per-draft state is held by the room that hosts the draft). For HTTP-side rate limiting (e.g., on the existing Hono server), KI-003 still applies. Re-evaluate at chunk 11g.9.
- **KI-004** (Phase 8a target): hardcoded staging URL in keep-alive cron. Still applies — the Edge Function fallback path is retained (KI-009), so the cron's URL still needs to be Vault-resolved before prod cutover. No change.
- **KI-005** (Phase 8a target): DLQ paging trigger. Still applies — the Edge Function fallback path can still hit `read_ct >= 3` and write to `autopick_failures`. The persistent worker's autopick path also writes to `autopick_failures` on terminal failure (chunk 11g.6 deliverable). The paging trigger covers both.
- **KI-006** (Phase 7 target): heuristic O(N×M) candidate scan latency. **Largely resolved by chunk 11g.3's in-memory candidate cache** — re-evaluate and likely flip to RESOLVED at chunk 11g.9 when the latency harness confirms the elimination of the per-pick query. The Phase 7 latency benchmark stays relevant only for the Edge Function fallback path under disaster-recovery conditions.
- **KI-007** (Phase 7 target): vendored shared code drift. The persistent worker imports `@citrus/shared` natively (same Node ecosystem as the main server), so it does **not** add a third vendor target. KI-007's scope narrows to the Edge Function fallback path only.

KIs filed at plan time (in `docs/REGISTRY.md`):

- **KI-008**: Phase 0–4 architecture insufficient for Yahoo/ESPN-grade live draft (architectural pivot rationale; persistent Node on Cloud Run as the hot-path host).
- **KI-009**: Edge Functions retained as cron-driven disaster-recovery safety net.
- **KI-010**: Tier 1 performance optimizations baked into Phase 4.5 design from the start (parallel async, byte-limited deltas, fanout protection, candidate caching).

Future KIs (likely to be filed during the build):

- A KI covering Cloud Run-specific quirks discovered during chunks 11g.1 or 11g.9 (cost model surprises, connection-cap edges, regional placement).
- A KI for any latency target the benchmark suite chronically misses by < 10% — bounded, documented, scheduled for follow-up.
- A KI for the WebSocket library choice's specific gotchas (filed in chunk 11g.2 if any surface).

---

## Cross-references

- `docs/adr/ADR-001-elixir-phoenix-draft-engine.md` — the architectural decision this plan implements (persistent Node service on Cloud Run; Edge Functions as disaster-recovery safety net).
- `CLAUDE.md` § Citrus Draft Performance Mandate — the binding performance targets.
- `CLAUDE.md` § Tech Stack — the persistent-worker-on-Cloud-Run runtime documentation.
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 + §0.5 — spec-side reference.
- `docs/REGISTRY.md` — KI-008, KI-009, KI-010 (project-wide concerns).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KIs that continue to apply.

This plan is **accepted but not yet executing**. Implementation begins with chunk 11g.1 in a separate session/commit. Each chunk lands as its own commit with deliverables verified before the next starts.
