# Phase 4.5 — Persistent Node Draft Engine in Existing Server (Chunks 11g.0–11g.10)

| | |
|---|---|
| **Status** | Plan accepted (2026-04-28). Implementation not yet started. |
| **Authority** | `docs/adr/ADR-001-persistent-node-draft-engine.md` (the architectural decision: persistent code inside the existing Node.js / Hono server on Cloud Run, with `uWebSockets.js` as the live WebSocket layer; Edge Functions removed entirely); `CLAUDE.md` § Citrus Draft Performance Mandate (binding performance targets). |
| **Predecessor** | Phase 4 closeout, with autopick latency ~11.7s/pick measured on staging — non-competitive per the Mandate. |
| **Successor** | Phase 5 (UI client work) is **blocked** until chunk 11g.10 sign-off. |
| **Estimated solo-founder timeline** | Chunks 11g.0–11g.10 ≈ 3–5 weeks of solo-founder work assisted by Claude Code, including cushion for unknowns. No new language or runtime; the engine ships inside the existing server. |

## Working discipline (carried forward from Phase 0–4)

- **One chunk per commit.** Each chunk pushed and reviewed before the next starts.
- **Pause for review at every chunk gate.** No silent drift between chunks.
- **No deferral lands without a registry row.** New issues that surface during the build go into `docs/REGISTRY.md` (project-wide concerns) or `docs/RUNBOOKS/draft-engine-v2-known-issues.md` (draft-engine-specific) at commit time.
- **Performance Mandate is the binding constraint for every chunk.** Any chunk that introduces a new latency-sensitive surface must measure it; any chunk that fails a target either fixes it before the next chunk starts or registers a KI- with a bounded resolution timeline.
- **Tier 1 perf optimizations are baked in, not deferred (KI-010).** Parallel async via `Promise.all`, candidate pool cached at draft start in `LobbyManager` (chunk 11g.3), byte-limited delta broadcasts and per-socket fanout protection via `getBufferedAmount()` (chunk 11g.4) — each lands in the chunk that introduces the relevant surface, with code-comment evidence. End-to-end verification at chunk 11g.10.
- **Integration boundary is the existing Postgres RPC surface plus the WebSocket message protocol.** RPC surface (`submit_pick_v2`, `append_draft_event`, `reconstruct_draft_state`, etc.) doesn't change without an ADR. WebSocket message protocol is established across chunks 11g.2 (transport + upgrade) and 11g.4 (pick + chat message types); same governance discipline.

## Performance targets (binding, from `CLAUDE.md` § Citrus Draft Performance Mandate)

Every chunk's acceptance criteria reference these:

- Manual pick submission: p95 ≤ 300ms, p99 ≤ 500ms
- Autopick latency: p95 ≤ 1000ms, p99 ≤ 2000ms
- Draft state load: p95 ≤ 1500ms
- Timer drift: < 100ms across all clients
- Pick-to-broadcast fanout: p95 ≤ 200ms
- Reconnection recovery: p95 ≤ 2000ms

A chunk's "performance gate" is a measured-on-staging assertion against these targets, scoped to whatever surface the chunk introduces. The full target set is verified end-to-end at chunk 11g.10 — that's the Phase 5 entry gate.

---

## Phase 4.5 — Build the in-server engine, remove the Edge Function infrastructure

### Chunk 11g.0 — Dependency compatibility verification

**Deliverable.** A pre-flight audit on the existing Node server before any draft-engine code lands. The chunk's commit produces a single document — pass/fail with specifics — and zero application code. Audit scope:

- Existing `server/package.json` dependencies vs. uWebSockets.js. Confirm the native C++ binary builds cleanly for the Cloud Run container architecture (Linux x64), peer-deps and types resolve, no version conflicts. Per ADR-001 the architecture specifies uWebSockets.js; alternative libraries (`ws`, `socket.io`) are explicitly not in scope.
- Hono's HTTP-upgrade handling. Confirm Hono routes can coexist with a WebSocket upgrade handler on the same port, or document the specific Hono version + adapter combination required.
- TypeScript build pipeline. Confirm `tsc` / `tsx` build path handles both the existing routes and the new WebSocket code without configuration churn.
- Existing middleware (auth, JWT, RLS context). Confirm the middleware stack extends cleanly to WebSocket connections — auth on the upgrade handshake, league-membership check before `LobbyManager` join.
- Async patterns and event loop. Confirm the existing server's existing background tasks, cron callers, and request handlers won't conflict with long-lived WebSocket connections holding the event loop.

**Output.** A short writeup committed at `docs/PHASE_4_5_CHUNK_11g_0_compat_audit.md`: either "all clean, proceed to 11g.1" with the specific library + version pinned, or a numbered list of conflicts with proposed resolutions.

**Dependencies.** None.

**Acceptance criteria.**
- The audit document exists at the path above and answers each scope item with a definite yes/no/conflict.
- A scratch branch demonstrates the WebSocket library installing into `server/` cleanly and Hono accepting a WebSocket upgrade on a test endpoint. The scratch branch is committed but not merged into `staging-setup` — its purpose is evidence, not deployable code.
- If conflicts exist that can't be cleanly resolved, the chunk **escalates** before proceeding. The documented fall-back is alternative (a) from ADR-001 — a separate Cloud Run service. KI-009's "refactor not rewrite" framing is the binding promise; the architectural pattern carries either way.

**Performance targets.** None.

**Estimated effort.** 1–2 days. Mostly install + a tiny prototype to prove the upgrade path works on the existing Hono setup.

---

The goal of Phase 4.5 is a **single working draft running end-to-end on the existing Cloud Run server**, with measured performance meeting the Mandate, the Edge Function infrastructure deleted, and the in-memory `LobbyManager` model proven under realistic load. No new language, no new runtime, no new deploy target.

Sign-off discipline carries forward from Phase 0–4: each chunk lands as its own commit, runs on staging, and is reviewed before the next chunk starts. The chunk 11g.10 sign-off is the Phase 5 entry gate.

### Chunk 11g.1 — Discovery endpoint + JWT issuance

**Deliverable.** A new Hono route `GET /api/drafts/:draftId/server` that returns `{ host, port, token }`. The `host` and `port` are sourced from environment configuration (single Cloud Run instance Day 1; the protocol shape is what matters for future sharding). The `token` is a short-lived JWT (5-minute expiration) signed with `SUPABASE_JWT_SECRET` (the same secret Supabase signs auth tokens with — one auth surface for the whole server), with claims `{ sub: userId, draftId, leagueId, iat, exp }`. The route runs through the existing `authMiddleware` and `membershipMiddleware` so only authenticated league members can request a token. (Note: `draftId` and `lobbyId` are the same identifier in Citrus — the draft IS the lobby. `draftId` is the canonical wire-format claim; later chunks may use `lobbyId` as an internal variable name for the same value.)

**Dependencies.** 11g.0.

**Acceptance criteria.**
- `GET /api/drafts/:draftId/server` returns 200 with `{ host, port, token }` for a league member.
- Returns 401 without a valid Authorization header. Returns 403 if the caller is not a member of the draft's league.
- Token claims include `sub`, `draftId`, `leagueId`, `iat`, and `exp` (= `iat + 300`). Signed with `SUPABASE_JWT_SECRET` (HS256) so that future fast-path verification by the uWS upgrade handler is local-only (no Supabase round-trip).
- Token decode helper (`server/src/lib/draftToken.ts`) exports `issueDraftToken(...)` and `verifyDraftToken(token, expectedDraftId)`. The verify helper rejects expired tokens, tokens with bad signatures, and tokens whose `draftId` claim does not match the `expectedDraftId` argument (the draft-mismatch check is exercised in chunk 11g.2 but the helper lands here).
- Vitest covers: happy-path issuance, expired-token rejection, wrong-secret rejection, lobby-mismatch rejection, missing-claim rejection.

**Performance targets.** Discovery endpoint p95 ≤ 50ms (it is a config lookup + signed JWT; no DB read beyond the membership check the existing middleware already does).

**Estimated effort.** 2–3 days.

---

### Chunk 11g.2 — uWebSockets.js setup with WebSocket upgrade auth

**Deliverable.** `uWebSockets.js` added to `server/package.json`, instantiated as a separate `uWS.App()` running on its own port (configurable; default 3002). The WebSocket endpoint at `/ws/draft/:draftId` validates the upgrade in the `upgrade` handler: extracts the `token` from the `Sec-WebSocket-Protocol` header (per chunk 11g.1: subprotocol header keeps the token out of URLs / logs / referrers), calls `verifyDraftToken(token, draftIdFromUrl)`, which confirms the token's `draftId` claim matches the URL parameter. Rejects with appropriate WS close codes on auth failure (4401 unauthorized, 4403 forbidden, 4404 draft mismatch). On accept, subscribes the socket to the topic `draft:${draftId}` and sets per-connection user context (`userId`, `leagueId`, `draftId`) for downstream message handlers.

This chunk also extracts `verifyJwt` and `checkLeagueMembership` as runtime-agnostic helpers (current implementations are tightly coupled to Hono's `Context<Env>`, per chunk 11g.0 audit finding 3). Both Hono middleware and the uWS upgrade handler call into the extracted helpers. Existing middleware tests don't change; the helpers get called from inside the existing wrappers.

**Dependencies.** 11g.1.

**Acceptance criteria.**
- The Hono HTTP server (port 3001) and the uWS server (port 3002) coexist; the existing API routes still pass their suite.
- A test client with a valid token can upgrade to `/ws/draft/:draftId`. A test client with no token, an expired token, or a token for a different draft is rejected with the documented close code.
- Two test clients connected to the same `:draftId` both receive a message published to topic `draft:${draftId}` from a third actor (the test calls uWS `app.publish(topic, message)` directly — uWebSockets.js's built-in C++-backed pub/sub fast path — to confirm fanout works before LobbyManager exists).
- A test client connected to a different `:draftId` does **not** receive the message (topic isolation verified).
- Vitest covers each upgrade rejection path and the basic publish/subscribe roundtrip.
- Graceful shutdown handler in `server/src/index.ts` is updated to stop the uWS app before the 10s force-exit fires (capture the listen-socket token returned by `uwsApp.listen(...)` and call `us_listen_socket_close(token)`). Verified by sending SIGTERM during a live WebSocket connection: connection closes cleanly within shutdown window, no force-exit triggered. Per chunk 11g.0 audit finding 4.

**Performance targets.** Pick-to-broadcast fanout p95 ≤ 200ms measured at this chunk for the bare publish path (no LobbyManager work yet); recorded as the floor for chunk 11g.4's full-pick measurement.

**Estimated effort.** 3–4 days. Most of the surprise here is on the upgrade-handler shape; the rest is a thin wrapper.

---

### Chunk 11g.3 — `LobbyManager` class with single-writer queue and ring buffer

**Deliverable.** A `LobbyManager` class (`server/src/draft/LobbyManager.ts`) holding the in-memory state for one active draft. One instance per active lobby in a top-level `Map<lobbyId, LobbyManager>` (`LobbyRegistry`). Per-instance state: `pickNumber`, `onClockTeamId`, `pickDeadline`, `recentEvents` (ring buffer of ~200 events), `candidatePool` (cached at draft start; updated in place on pick events), `connectedSockets` (set of uWS WebSocket refs), `lastBroadcastSeq`. The constructor loads initial state from Postgres: `reconstruct_draft_state(draftId)` for the projection, plus a parallel `Promise.all` fetch of `player_directory`, `player_season_stats`, and `draft_picks_v2` to build the in-memory candidate pool. A single-writer queue serializes mutations: `this.queue = this.queue.then(() => doMutation())` so concurrent pick submissions never interleave. The lobby is registered into `LobbyRegistry` on construction and de-registered on shutdown.

**Dependencies.** 11g.2.

**Acceptance criteria.**
- Constructing a `LobbyManager` for a seeded staging draft completes the full state load (RPC + parallel candidate fetch) in p95 ≤ 1500ms (Mandate: draft state load).
- Two concurrent in-process mutations on the same `LobbyManager` execute in the order they were enqueued; a Vitest test deliberately races 50 mutations and asserts the resulting in-memory state matches a sequential application.
- Ring buffer: pushing > 200 events keeps the most recent 200; older events are dropped from the buffer (they remain authoritative in `draft_events`).
- `LobbyRegistry.get(lobbyId)` returns the same instance across calls within a process; `LobbyRegistry.evict(lobbyId)` clears it cleanly without leaking sockets.
- **KI-010 Tier 1 evidence:** the parallel `Promise.all` candidate-pool load is annotated with a `// KI-010 Tier 1: parallel async on independent reads` comment so a reviewer can grep for it. The candidate pool is held on `this._candidates` for the lifetime of the draft (`// KI-010 Tier 1: candidate pool cached at draft start`).

**Performance targets.**
- Draft state load p95 ≤ 1500ms (Mandate).

**Estimated effort.** 3–4 days.

---

### Chunk 11g.4 — Pick submission flow + draft-room chat

**Deliverable.** WebSocket message handler routes inbound `{ type: 'submit_pick', ... }` and `{ type: 'chat', ... }` messages to the right `LobbyManager` method. `submitPick` validates: the sender is on the clock for this lobby, the player is available in the cached candidate pool, the idempotency key is unused. On valid input, it executes a transactional `submit_pick_v2` RPC against Postgres (which appends to `draft_events` and updates `draft_state` atomically), updates the in-memory projection (decrements candidate pool, advances pick number, recomputes on-clock team), pushes the event onto the ring buffer, and broadcasts a delta event over uWS topic `draft:${lobbyId}`. Broadcast is byte-limited (delta only, not full state) and uses `getBufferedAmount()` to skip slow sockets above a documented threshold (~1MB) — those sockets are flagged for the chunk 11g.5 reconnection path. Chat handler is a thin pass-through: validates league membership (already on the connection context from chunk 11g.2's upgrade handler) and calls the existing `send_league_chat_message` Postgres RPC. Chat does NOT broadcast over uWS — it goes through the existing notifications real-time path so it appears in `LeagueNotifications.tsx` everywhere, exactly as in-product chat does today (per the chat/notification architecture findings: draft chat = league chat that happens during a draft).

**Dependencies.** 11g.3.

**Acceptance criteria.**
- Two test clients connected to the same lobby; client A submits a pick; client B receives the broadcast event with the pick payload and updated `pickNumber` within p95 ≤ 200ms (Mandate: pick-to-broadcast fanout). Client A receives the same broadcast (or a `pick_committed` ack — chunk decides).
- A duplicate `submit_pick` with the same idempotency key from the same client returns `{ was_duplicate: true }` without committing a second `draft_events` row.
- A pick submitted by a client who is not on the clock is rejected with a typed error message and does not commit.
- A pick for an already-drafted player is rejected with a typed error message.
- A chat message sent over the WebSocket appears in `notifications` for every league member via `send_league_chat_message` and renders in `LeagueNotifications.tsx` for any user who has the matchup view open. The draft-room UI (chunk arrives in Phase 5) will read the same notification feed; nothing parallel is built.
- End-to-end manual pick latency (client submit → broadcast received on other client) p95 ≤ 300ms / p99 ≤ 500ms over 100 trial picks (Mandate: manual pick submission).
- **KI-010 Tier 1 evidence:** broadcast site annotated `// KI-010 Tier 1: byte-limited delta (not full state)` and `// KI-010 Tier 1: per-socket fanout protection via getBufferedAmount()`. Pick handler annotated `// KI-010 Tier 1: parallel async via Promise.all` at any independent read site.

**Performance targets.**
- Manual pick submission p95 ≤ 300ms / p99 ≤ 500ms.
- Pick-to-broadcast fanout p95 ≤ 200ms.

**Estimated effort.** 4–5 days. The biggest correctness chunk in 11g — the integration with the existing RPC surface and the in-memory projection consistency are both load-bearing.

---

### Chunk 11g.5 — Reconnection with `last_seen_seq` resume

**Deliverable.** WebSocket resync handler. Client reconnects after a drop and sends `{ type: 'resume', lastSeenSeq }` as the first message after upgrade. Server compares to the lobby's ring buffer: if the gap is small (`lastSeenSeq` is still in the buffer), the server replays missed events from the buffer in order; if the gap exceeds the buffer (~200 events behind), the server sends a full snapshot — the same payload shape as `LobbyManager.constructor` produces — and the client reconciles. Reconnection state is per-socket; the lobby's authoritative state is unaffected.

**Dependencies.** 11g.4.

**Acceptance criteria.**
- Test: open a client, commit 5 picks while the client is connected, drop the WebSocket, reconnect with `lastSeenSeq` from before the drop. Client receives the 5 missed picks via ring-buffer replay, no full snapshot needed.
- Test: open a client, commit 250 picks (more than the ring buffer), reconnect with the pre-burst `lastSeenSeq`. Client receives a full snapshot (the buffer overflow path) and the resulting in-memory client state matches what `LobbyManager` says.
- Test: the figma-style scenario — two clients reconnect simultaneously after a network blip; both reconcile correctly without one starving the other.
- Reconnection recovery p95 ≤ 2000ms (Mandate: reconnection recovery), measured as `client.connect() → client has consistent state`.

**Performance targets.**
- Reconnection recovery p95 ≤ 2000ms.

**Estimated effort.** 2–3 days.

---

### Chunk 11g.6 — Pick deadline timer + autopick

**Deliverable.** Each `LobbyManager` runs a `setInterval` (1s tick) for the duration of the lobby's life. Each tick: compute `timeRemaining = pickDeadline - now`, broadcast `{ type: 'time_remaining', value }` over the lobby topic. On expiration (`timeRemaining ≤ 0`): the autopick path runs through the same single-writer queue as manual picks. Selection algorithm: queue head first (head of `draft_queues` for the on-clock team, filter against the in-memory candidate pool); heuristic fallback (FPTS + positional need — port the existing `supabase/functions/draft-autopick/heuristic.ts` to TypeScript inside `server/src/draft/heuristic.ts`, same algorithm byte-for-byte). Autopick calls `submit_pick_v2` with `actor.kind='autopick'` and the existing UUIDv5-derived idempotency key (same `AUTOPICK_NAMESPACE_UUID` and same `(league_id, pick_number, generation, 'autopick')` derivation). Same broadcast path as a manual pick. Additionally, **autopicks write a single-recipient notification** to the affected user via the `notifications` table (`type='SYSTEM'`, `user_id = autopicked_team.owner_id`) so a user away from the draft room sees the autopick happened on their next visit to the in-product activity feed. This is the only `notifications` table write the engine performs per pick — manual picks are not surfaced through `notifications` (they reach in-room clients via the WebSocket and reach absentee users via the draft room's event log on next visit). This deliberate scope-cut is the "no notification storm" guarantee per the chat/notification architecture findings.

**Dependencies.** 11g.4.

**Acceptance criteria.**
- Timer ticks: with the deadline 60s out, clients receive 60 `time_remaining` events ±100ms (Mandate: timer drift < 100ms across clients).
- Autopick on deadline: a 12-team / 12-pick unattended draft runs to completion. Every pick is via autopick. Total wall-clock < 30 seconds. Per-pick p95 ≤ 1000ms / p99 ≤ 2000ms (Mandate: autopick latency).
- A 12-team / 180-pick (15 rounds) full unattended draft completes in < 6 minutes (autopick p95 × 180 ≈ 3 minutes plus 2× cushion).
- Cross-runtime parity preserved during cutover: an autopick committed by the in-server engine produces the same idempotency key as the existing Edge Function path would have for the same `(league_id, pick_number, generation)`. Verified at chunk 11g.6 time against `_v2_test._uuidv5` SQL helper output for a known input vector. The helper itself is removed in chunk 11g.9 after the second runtime is gone — the parity check is a one-shot verification at cutover, not an ongoing invariant.
- Per autopick: one row in `notifications` with `user_id = autopicked_team.owner_id`, `type = 'SYSTEM'`, `metadata.source = 'draft_engine'`, `metadata.pick_number = N`. Zero rows for manual picks. Vitest asserts both directions.

**Performance targets.**
- Autopick latency p95 ≤ 1000ms / p99 ≤ 2000ms.
- Timer drift < 100ms across all connected clients.

**Estimated effort.** 4–5 days.

---

### Chunk 11g.7 — Snapshot persistence and process bootstrap

**Deliverable.** `LobbyManager` writes a snapshot to `draft_state` every N picks (suggest N=5) and every 30 seconds, whichever comes first. Snapshot payload is the minimum needed to recover the in-memory projection without replaying the full event log: `pickNumber`, `onClockTeamId`, `pickDeadline`, `lastBroadcastSeq`. The candidate pool is NOT persisted in the snapshot — it gets rebuilt from `player_directory` + `draft_picks_v2` on bootstrap (cheaper than serializing 2000 rows × 14 columns). On process startup, a bootstrap routine queries `leagues WHERE draft_status = 'drafting'` and, for each, instantiates a `LobbyManager` from the latest snapshot + replay of `draft_events` since the snapshot's `lastBroadcastSeq`. Lobbies are registered into `LobbyRegistry` and timers resume. Connected clients reconnect via chunk 11g.5's protocol; the server-side state is already there waiting for them.

**Dependencies.** 11g.6.

**Acceptance criteria.**
- A snapshot row appears in `draft_state` after every 5 committed picks during a test draft, and at least one row per 30 seconds even if no picks happen. Verified via row count + timestamp inspection.
- Test: kill the server process mid-draft (5 picks committed, 2 clients connected, deadline 30s out). Restart. The bootstrap reloads the lobby from snapshot + 5 events of replay; the timer resumes with the correct `pickDeadline`; clients reconnect via 11g.5 and receive the current state. **No picks lost. No duplicates. Total recovery time < 5 seconds.**
- Test: the snapshot/replay path agrees with a from-scratch `reconstruct_draft_state` call — the in-memory projection after bootstrap is byte-equal to a full reconstruction. Vitest property test runs over a corpus of synthetic event logs.
- Bootstrap routine logs structured events (`lobby_bootstrap_started`, `lobby_bootstrap_complete`, `lobby_bootstrap_failed`) at INFO/INFO/ERROR for ops visibility.

**Performance targets.**
- Bootstrap completes in < 5 seconds for a 12-team / 50-picks-committed draft.
- Snapshot write does not block the single-writer queue (runs as a fire-and-forget side effect after the mutation commits).

**Estimated effort.** 3–4 days.

---

### Chunk 11g.8 — Failure mode test suite

**Deliverable.** Six failure-mode integration tests covering the brief's scenarios. Each test runs against a real staging Cloud Run deploy (or a local server with the same wiring), seeds fixtures, asserts behavior end-to-end. Scenarios:

1. **Process crash mid-draft** — kill the Node process during an active draft (5 picks committed, 2 clients connected). Expected: clients see WS disconnect, server restarts, lobby bootstraps from snapshot + replay (chunk 11g.7), clients reconnect with `last_seen_seq` (chunk 11g.5), draft continues. No picks lost, no duplicates.
2. **Client reconnect after network drop** — drop a single client's WS connection mid-draft (TCP close). Expected: client reconnects, replays missed events from ring buffer (chunk 11g.5). No effect on other clients. Reconnection p95 ≤ 2000ms.
3. **Duplicate pick submission with idempotency keys** — client A submits the same pick twice (same idempotency key, e.g. retry after a flaky network). Expected: second submission returns `{ was_duplicate: true }`, no second `draft_events` row, no second broadcast.
4. **Two users racing on the clock** — clients A and B both submit picks within the same single-writer-queue tick. Expected: one wins (commits + broadcasts), the other receives a typed "not on clock" rejection without committing.
5. **Slow client** — one client's WS has `getBufferedAmount() > 1MB` (simulated by withholding ACKs). Expected: chunk 11g.4's fanout protection skips the slow socket on subsequent broadcasts; the slow client is flagged for resync; other clients receive picks at normal latency.
6. **Deploy during active draft (drain mode)** — Cloud Run revision swap while a draft is mid-clock. Expected: old instance flushes its single-writer queue and commits in-flight mutations before exit; new instance bootstraps the lobby from snapshot + replay; clients reconnect via 11g.5. Draft continues without operator intervention.

**Dependencies.** 11g.5, 11g.6, 11g.7.

**Acceptance criteria.**
- All six tests pass on staging. Each test produces a structured log artifact (committed alongside the test) showing the timeline of events for review.
- Each test asserts both the happy outcome AND the absence of a failure mode (e.g., scenario 3 also asserts that `draft_events` has exactly one row, not zero or two).
- Mandate targets continue to hold under each scenario where they apply (e.g., scenario 2 asserts reconnection p95 ≤ 2000ms; scenario 4 asserts manual pick latency under contention p95 ≤ 300ms).

**Performance targets.**
- All Mandate targets continue to hold under each scenario where they apply.

**Estimated effort.** 4–5 days. Scenario 6 is the trickiest — needs the chosen Cloud Run revision-swap mechanism documented and a drain-mode hook on the engine (chunk should design this).

---

### Chunk 11g.9 — Edge Function infrastructure removal

**Deliverable.** Once chunks 11g.1–11g.8 are deployed and verified on staging, this chunk deletes the Phase 0–4 Edge Function infrastructure entirely. Specifically:

- Delete `supabase/functions/draft-autopick/` (the Deno autopick worker).
- Drop the pg_cron jobs `draft-deadline-sweep` and `draft-autopick-keepalive` via a new migration in `supabase/migrations/`.
- Drop the pgmq queue `draft_deadlines` and its archive table via the same migration.
- Delete `supabase/functions/_shared/_vendored/` (no second runtime needs vendored shared code; the in-server engine imports `@citrus/shared` natively).
- Remove the SQL `_v2_test._uuidv5` cross-runtime parity helper and the corresponding TypeScript test fixture — there is no second runtime to compare against.
- `git grep` audit confirms zero remaining references to deleted surfaces in shipped code (test fixtures, comments, runbooks). Stale references either get updated or get deleted.

The chunk also closes the runbook entries: **KI-007** (vendored shared code drift) flips to `RESOLVED (chunk 11g.9 commit-sha, date)`. **KI-004** (Phase 3 keep-alive cron's hardcoded staging URL) is annotated `SUPERSEDED by chunk 11g.9 — surface deleted` with the same commit SHA.

**Dependencies.** 11g.6 (the in-server autopick path must be the primary path before the Edge Function is removed), 11g.8 (the failure-mode test suite must pass without the Edge Function as a fallback).

**Acceptance criteria.**
- `git ls-files supabase/functions/draft-autopick/` returns 0 files.
- `git ls-files supabase/functions/_shared/_vendored/` returns 0 files.
- `git grep -n "_vendored\|draft-deadline-sweep\|draft-autopick-keepalive\|draft_deadlines"` returns no references in shipped code (matches in `docs/RUNBOOKS/draft-engine-v2-known-issues.md` and migration history are expected and acceptable).
- The removal migration applies cleanly on staging and is idempotent (re-running is a no-op).
- The chunk 11g.8 test suite re-runs after the deletion and all six scenarios still pass — confirming the Edge Function was already not on the critical path.
- KI-007 row in `docs/RUNBOOKS/draft-engine-v2-known-issues.md` carries `RESOLVED (commit-sha, date)`. KI-004 row similarly annotated.

**Performance targets.** None (subtractive chunk).

**Estimated effort.** 1–2 days. Mostly auditing and writing the migration; the deletes themselves are mechanical.

---

### Chunk 11g.10 — Performance verification against the Mandate

**Deliverable.** End-to-end performance verification on the deployed staging Cloud Run server against every binding target in `CLAUDE.md` § Citrus Draft Performance Mandate. A `server/bench/` benchmark harness drives realistic load (12-user lobbies, multiple concurrent drafts) using the `node --cpu-prof` workflow per VS Code Node profiling docs to capture flame graphs for any regression. The harness emits a structured report: per-Mandate-target p50/p95/p99 latency, throughput, error rate. Output committed to the repo so future regressions have a baseline.

The KI-010 Tier 1 optimizations are verified-in-place via grep:
- Parallel async via `Promise.all`: chunk 11g.3 `LobbyManager` constructor.
- Candidate pool cached at draft start: chunk 11g.3 `this._candidates`.
- Byte-limited delta broadcasts: chunk 11g.4 broadcast site.
- Per-socket fanout protection via `getBufferedAmount()`: chunk 11g.4 broadcast site.

A code-comment audit (`git grep "KI-010 Tier 1"`) produces the four expected hits. Missing hits indicate the optimization was deferred or removed silently — both fail the chunk.

**Dependencies.** 11g.9.

**Acceptance criteria — and the Phase 5 entry gate:**
- Manual pick submission p95 ≤ 300ms / p99 ≤ 500ms over 1000 trial picks across 5 concurrent lobbies.
- Autopick latency p95 ≤ 1000ms / p99 ≤ 2000ms over 500 trial autopicks.
- Pick-to-broadcast fanout p95 ≤ 200ms.
- Draft state load (cold lobby bootstrap) p95 ≤ 1500ms.
- Reconnection recovery p95 ≤ 2000ms over 100 reconnect cycles.
- Timer drift < 100ms across all clients in a 12-user lobby over a full 15-round draft.
- `git grep "KI-010 Tier 1"` returns ≥ 4 hits in `server/src/draft/`.
- Benchmark report committed at `server/bench/PHASE_4_5_BASELINE.json` (machine-readable) and `server/bench/PHASE_4_5_BASELINE.md` (human-readable summary). Future Phase 5+ work re-runs against this baseline.

**Pass:** Phase 5 (UI client work) unblocks. KI-010 closes (RESOLVED, with the chunk 11g.10 commit-sha as evidence).
**Fail (any target missed by > 10%):** stop. Targeted optimization, not a fresh chunk. The Mandate is binding.

**Performance targets.** The full Mandate set, end-to-end, on the deployed Cloud Run server.

**Estimated effort.** 3–5 days. Includes profiling time and any targeted optimization passes that surface during the run.

---

## Registry tracking during the build

New issues that surface during Phase 4.5 land in the appropriate registry at commit time:

- **Cross-cutting / project-wide concerns** → `docs/REGISTRY.md`. Examples: ops surface area changes, new external dependencies, hosting-cost surprises.
- **Draft-engine-specific concerns** → `docs/RUNBOOKS/draft-engine-v2-known-issues.md`. Examples: a `uWebSockets.js` quirk on Cloud Run, a Postgres query that needs an index, a Hono+uWS coexistence gotcha.
- **Spec-level concerns (changes to the integration boundary)** → require an ADR. The integration boundary (Postgres RPC signatures, payload shapes, idempotency-key derivation, WebSocket message protocol) does not change without explicit governance.

Existing open KIs that interact with this work:

- **KI-003** (Phase 7 carryover): rate limiter session-affinity. The single-process Day 1 architecture means every connection for a given lobby lands on the same instance, which solves the immediate session-affinity problem in a degenerate way. Re-evaluate KI-003 if/when multi-process sharding ships.
- **KI-004** (Phase 8a target): hardcoded staging URL in the keep-alive cron. **SUPERSEDED by chunk 11g.9** — the cron job ceases to exist. The runbook row carries the supersede annotation with the chunk 11g.9 commit-sha.
- **KI-005** (Phase 8a target): DLQ paging trigger on `autopick_failures`. Still applies, but now narrower in scope: the in-server engine writes to `autopick_failures` on terminal autopick failure (chunk 11g.6 deliverable). The Edge Function path is gone (chunk 11g.9), so this is the only writer.
- **KI-006** (Phase 7 target): heuristic O(N×M) candidate scan latency. **RESOLVED at chunk 11g.10** — the chunk 11g.3 in-memory candidate cache eliminates the per-pick query that was the cost driver; chunk 11g.10's benchmark confirms.
- **KI-007** (Phase 7 target): vendored shared code drift. **RESOLVED at chunk 11g.9** — the vendored `_shared/_vendored/` directory is deleted alongside the Edge Function infrastructure. The in-server engine imports `@citrus/shared` natively; no second runtime needs vendored copies.

New KIs filed at plan time (all rewritten to match the in-server engine direction):

- **KI-008**: Phase 0–4 architecture insufficient for Yahoo/ESPN-grade live draft (architectural pivot rationale; the autopick latency was structural to the Edge Function model).
- **KI-009**: Edge Function infrastructure removed entirely; engine in existing server (operational simplicity over dual-runtime hedging).
- **KI-010**: Tier 1 perf optimizations baked into Phase 4.5 design from the start (parallel async, candidate pool caching, byte-limited delta broadcasts, fanout protection — closes at chunk 11g.10 with measured evidence).

Future KIs (likely to be filed during the build):

- A KI covering whichever Cloud Run quirk surfaces (e.g., WebSocket idle-timeout tuning, revision-swap drain mode behavior).
- A KI covering whichever Hono+uWS coexistence quirk surfaces (port allocation, middleware reuse, build-pipeline interactions).
- A KI for any latency target the benchmark suite chronically misses by < 10% — bounded, documented, scheduled for follow-up before Phase 5 starts.
- **KI-011** is filed at plan time for the Day 2 multi-process sharding transition (single-process Day 1 is a deliberate scope cut, not a long-term posture; trigger conditions and refactor-not-rewrite contract documented in the registry row).

---

## Cross-references

- `docs/adr/ADR-001-persistent-node-draft-engine.md` — the architectural decision this plan implements.
- `CLAUDE.md` § Citrus Draft Performance Mandate — the binding performance targets.
- `CLAUDE.md` § Tech Stack — the in-server engine architecture documentation.
- `docs/DRAFT_ENGINE_V2_SPEC.md` § §0 + §0.5 — spec-side reference. `LobbyManager` is the in-process holder of the same projection (formerly referred to as `DraftRoom` in early architectural drafts; see ADR-001 Decision History).
- `docs/REGISTRY.md` — KI-008, KI-009, KI-010 (project-wide concerns; rewritten for the in-server direction).
- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — Phase 0–4 KIs; KI-004 SUPERSEDED and KI-007 RESOLVED at chunk 11g.9.

This plan is **accepted but not yet executing**. Implementation begins with chunk 11g.0 in a separate session/commit. Each chunk lands as its own commit with deliverables verified on staging before the next starts.
