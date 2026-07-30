# Citrus — Project Registry

> **Purpose.** Top-level project registry for cross-cutting known issues
> and deferred decisions. The conversation history is not durable; this
> file is.
>
> **Scope.** Project-wide concerns that span multiple subsystems
> (draft engine + main app, Node.js, ops + product). Issues
> scoped to a single subsystem live in that subsystem's own registry —
> for the draft engine, see
> `docs/RUNBOOKS/draft-engine-v2-known-issues.md` (KI-001 through
> KI-007 live there; KI-008+ may live in either registry depending on
> scope).
>
> **Hard rule.** Same as the draft-engine registry: no deferral lands
> without a row here. Code review responses of "defer to later" must
> reference a KI- ID, and the commit shipping the deferral updates this
> file in the same change.
>
> **Lifecycle.** Append-only. Resolved issues stay with a
> `**RESOLVED (commit, date)**` annotation. Audit trail beats tidiness.
>
> **Numbering.** KI-IDs are monotonic across both registries. The
> draft-engine registry holds KI-001..KI-007 (Phase 0–4 era). KI-008
> and onward live here for project-wide concerns; subsystem-specific
> KIs continue to land in the subsystem's registry. When in doubt,
> file in the subsystem registry; this file is for things that genuinely
> cross subsystem boundaries.

## Schema

| Column | Meaning |
|---|---|
| **ID** | `KI-NNN`, monotonically assigned across both registries. |
| **Severity** | `low` / `medium` / `high` / `critical`. `low` and `medium` ship in the same phase as introduced unless explicitly re-targeted; `high` and `critical` block phase exit. |
| **Surface** | The subsystems / files / runtimes the issue spans. |
| **Description** | What the issue is, in plain language. |
| **Why deferred** | Why we didn't fix it in the change that surfaced it. |
| **Target phase / timeline** | When this gets resolved and what triggers the work. |
| **Verification test** | What proves the fix landed. Hypothetical until then; name it anyway. |

## See also

- `docs/RUNBOOKS/draft-engine-v2-known-issues.md` — draft-engine-specific KIs (KI-001..KI-007).
- `docs/adr/` — Architecture Decision Records. Read these for context on _why_ the system is structured the way it is.
- `CLAUDE.md` § Citrus Draft Performance Mandate — binding performance targets.

---

## Registry

### KI-008 — Architectural pivot: Edge Functions were the wrong runtime model for live multiplayer

| | |
|---|---|
| **Severity** | high — blocks Phase 5 (UI) until resolved by Phase 4.5 chunk 11g.10. |
| **Surface** | The draft hot path. Spans `server/src/services/DraftServiceV2.ts`, the new in-server `LobbyManager` + WebSocket code (Phase 4.5+), and (until removed) `supabase/functions/draft-autopick/` plus the pgmq scheduler. |
| **Description** | Phase 0–4 used Supabase Edge Functions as the autopick host. Phase 4 verification on staging measured autopick latency at **~11.7s/pick** — an order of magnitude over the Performance Mandate's p95 ≤ 1000ms target (`CLAUDE.md` § Citrus Draft Performance Mandate). Causes are structural to the runtime model: ephemeral stateless invocations, pg_cron 2-minute keep-alive cadence, no per-draft persistent state, candidate pool re-fetched every pick, broadcast fanout via third-party Realtime with rate limits. **Edge Functions are the wrong runtime model for live multiplayer state.** Phase 4.5 moves the live engine to **persistent Node code in the existing server** (one `LobbyManager` per active draft, WebSocket transport, in-process autopick scheduler). Phase 0–4 durability primitives (event log, idempotency, projection trigger, RPCs) stay unchanged — the engine is a new caller of the existing surface, not a replacement. ADR-001 documents the architectural decision. |
| **Why deferred** | Not a deferral — the architectural pivot itself. Phase 0–4 shipped correctness with performance knowingly punted to "Phase 7 optimization." The Performance Mandate (2026-04-27) reframed performance as a foundational constraint, retroactively making the runtime choice unacceptable. The 11.7s number was the trigger; the structural causes made the pivot non-negotiable. |
| **Target phase / timeline** | **Phase 4.5 (chunks 11g.0–11g.10, `docs/PHASE_4_5_PLAN.md`).** Chunk 11g.0 verifies dependency compatibility. Chunks 11g.1–11g.7 build the in-server engine end-to-end (discovery + JWT, uWS upgrade, LobbyManager, pick + chat flow, reconnect, timer + autopick, snapshot + bootstrap). Chunk 11g.8 is the failure-mode integration test suite. Chunk 11g.9 removes the Edge Function infrastructure entirely (KI-009). Chunk 11g.10 verifies all Mandate targets on the deployed server. Phase 5 (UI) unblocks at 11g.10 sign-off. |
| **Verification test** | The chunk 11g.10 performance harness on the deployed Cloud Run server. Seed concurrent drafts, drive picks at the deadline boundary, measure end-to-end (`deadline_expiry → submit_pick_v2 commit → all clients have updated UI`). **Pass:** every Mandate target met (manual pick p95 ≤ 300ms / p99 ≤ 500ms; autopick p95 ≤ 1000ms / p99 ≤ 2000ms; broadcast fanout p95 ≤ 200ms; draft state load p95 ≤ 1500ms; reconnection p95 ≤ 2000ms; timer drift < 100ms). **Fail:** any target missed by more than 10% triggers a design revisit before Phase 5 starts. The benchmark suite re-runs at every chunk gate so regressions are caught early. |

### KI-009 — Edge Function infrastructure removed entirely; engine in existing server

**RESOLVED (chunk 11g.9 commit, 2026-05-12).** Migration `supabase/migrations/20260512000000_remove_pgmq_infrastructure.sql` shipped on branch `phase-4-5-implementation`. Removed: `supabase/functions/draft-autopick/index.ts`; pg_cron jobs `draft-deadline-sweep` and `draft-autopick-keepalive`; pgmq wrapper RPCs `draft_autopick_read` / `draft_autopick_archive`; `draft_deadline_sweep()` function; `generation_bumped` event-writes from `draft_pause` / `draft_resume` / `draft_extend`; `'generation_bumped'` from the `draft_events.event_type` CHECK enum (21 → 20 values); `leagues.draft_generation` column; pgmq extension (CASCADE — drops queue + archive tables). The persistent in-server engine + chunk 11g.7 sub-step 7e LISTEN/NOTIFY path carry the production load; recovery is event-log replay on server restart. The deployment shape locked in by ADR-001 is now the only shape — no parallel safety net to maintain. Future need for queue-based coordination should use LISTEN/NOTIFY or a fresh primitive, NOT restoration of pgmq (see migration header irreversibility statement). KI-007 and KI-004 closed in the same commit.

| | |
|---|---|
| **Severity** | medium — accepted operational shape; must be tracked so the simplification rationale is preserved across future scale conversations. |
| **Surface** | `supabase/functions/draft-autopick/`, `supabase/functions/_shared/_vendored/`, the pg_cron jobs (`draft-deadline-sweep`, `draft-autopick-keepalive`), the pgmq queue (`draft_deadlines`) and its archive table, the Vault secret + keep-alive token plumbing, the cross-runtime hash-agreement infrastructure. All deleted in chunk 11g.9. |
| **Description** | **Edge Function infrastructure removed entirely (not retained as safety net) and draft engine integrated into existing Node server (not separate service) per CTO ethos of operational simplicity.** Recovery via event log replay on Cloud Run restart is sufficient. **If future scale demands service separation, splitting out the draft engine is a refactor, not a rewrite — Phase 0–4 primitives don't change.** The integration boundary (existing Postgres RPC surface + WebSocket message protocol) is stable across that hypothetical pivot; only the deployment unit changes. The simplest thing that works wins now; complexity gets added back if and only if measured scale demands it. |
| **Why deferred** | Not a deferral — a deliberate simplification. Keeping the safety net would mean maintaining the pgmq queue, pg_cron jobs, vendored shared code (KI-007), Vault wiring, and the Deno worker for a path that almost never fires once the in-server engine carries the hot path. Cloud Run restart latency is on the order of seconds; the WebSocket reconnect protocol covers the gap. Keeping the engine in the existing server (vs. a separate Cloud Run service) means one deployment unit, one observability surface, one CI pipeline — and a refactor-not-rewrite path forward if scale ever justifies separation. |
| **Target phase / timeline** | **Phase 4.5 chunk 11g.9.** That chunk explicitly verifies nothing else in the codebase depends on the Edge Function surfaces, then deletes them in one commit. The "engine inside existing server" choice is locked in by chunks 11g.2 (uWS layer added to existing Hono server) and chunks 11g.3–11g.7 (everything builds inside `server/`). Re-evaluate end of 2026 if v1 scale exposes any limitation; the refactor-to-separate-service path is documented as the response. |
| **Verification test** | (a) Chunk 11g.9 commit's `git grep` audit shows zero remaining references to deleted Edge Function surfaces. (b) Chunk 11g.7 crash-recovery test (and chunk 11g.8 scenario 1): kill the Cloud Run server mid-draft (5 picks committed, clients connected); restart; verify all active drafts reload state from `draft_events` via snapshot + replay, timers resume, clients reconnect via the chunk 11g.5 protocol, **no picks lost, no duplicates**. (c) End-of-2026 ops review: total time spent on Edge-Function-related issues since chunk 11g.9 deploy. **Pass:** zero, because they don't exist anymore. |

### KI-010 — Tier 1 perf optimizations baked into Phase 4.5 design from the start

| | |
|---|---|
| **Severity** | medium — design-time constraint, not a deferred fix. |
| **Surface** | The in-server engine's `LobbyManager` class and surrounding infrastructure (chunks 11g.3 and 11g.4 in `docs/PHASE_4_5_PLAN.md`). |
| **Description** | Phase 4 left the Edge Function path with several known performance liabilities that were intentionally deferred to "later optimization" — KI-006 (per-pick candidate scan), broadcast fanout limits, redundant per-pick Postgres reads. The Phase 4.5 plan does NOT defer those again. **Tier 1 perf optimizations are baked into the in-server engine's design across chunks 11g.3 and 11g.4**: parallel async on independent state reads (`Promise.all` on `player_directory` + `player_season_stats` + `draft_picks_v2` at draft start, not sequentially — chunk 11g.3); candidate pool cached in `LobbyManager._candidates` for the lifetime of the draft, updated in place on pick events (no per-pick re-fetch — KI-006 resolution path; chunk 11g.3); byte-limited delta broadcasts (don't ship full state every event, ship the diff with a documented size budget — chunk 11g.4); per-socket fanout protection via `getBufferedAmount()` to skip slow sockets and prevent runaway buffering from starving other connections on the same instance (chunk 11g.4). |
| **Why deferred** | Not deferred — proactively planned. The risk this KI exists to track is that under chunk-by-chunk pressure the optimizations get cut for "we'll do it later" reasons. That deferral pattern produced the 11.7s problem in the first place. The Performance Mandate forbids "optimize later" framings (`CLAUDE.md` § Citrus Draft Performance Mandate, "Non-negotiables"). |
| **Target phase / timeline** | **Built into Phase 4.5 chunks 11g.3 and 11g.4.** Each chunk's acceptance criteria reference the relevant Mandate target. Both chunks explicitly introduce the four Tier 1 optimizations as design-decision comments (`// KI-010 Tier 1: ...`) in the code so a reviewer can grep for them. Chunk 11g.10 verifies them end-to-end. No carry-forward to Phase 7 — if these aren't in by Phase 4.5 sign-off, Phase 5 doesn't start. |
| **Verification test** | The Mandate's full target set, measured at chunk 11g.10: manual pick p95 ≤ 300ms, autopick p95 ≤ 1000ms, broadcast fanout p95 ≤ 200ms, draft state load p95 ≤ 1500ms, reconnection p95 ≤ 2000ms, timer drift < 100ms. Each Tier 1 optimization called out by name in code comments in chunks 11g.3 and 11g.4 (`git grep "KI-010 Tier 1"` returns ≥ 4 hits). **KI-006** (per-pick candidate scan latency) flips to **RESOLVED** at chunk 11g.10 if the latency harness confirms the in-memory cache eliminates the original cost. |

### KI-011 — Multi-process sharding deferred to Day 2

| | |
|---|---|
| **Severity** | low — deliberate scope cut, OPEN by design. |
| **Surface** | `server/src/draft/LobbyManager.ts` (single-process Day 1); the discovery-as-function endpoint at `GET /api/drafts/:draftId/server` (chunk 11g.1); the in-process `LobbyRegistry` (chunk 11g.3). |
| **Description** | The Day 1 architecture runs a single Node process holding all active `LobbyManager` instances in a shared `LobbyRegistry`. The discovery-as-function endpoint pattern (chunk 11g.1) is shaped to support multi-process sharding without client or protocol changes — when the time comes, the endpoint starts returning shard-specific addresses (the lobby ID is the shard key from Day 1) and the `LobbyRegistry` adds a routing layer. Until then, every connection for a given lobby lands on the same instance, which solves the immediate session-affinity problem in a degenerate way (KI-003 narrows accordingly). |
| **Why deferred** | At v1 scale (~50 concurrent drafts at peak) a single Node process comfortably handles the workload, and the operational surface of multi-process coordination (shared discovery store, instance-to-lobby routing, deploy-time draining across shards) is real complexity that buys nothing today. The simplest thing that works wins now; complexity gets added back if and only if measured scale demands it. The protocol shape — clients calling `GET /api/drafts/:draftId/server` and connecting to whatever the response says — is what makes this a refactor, not a rewrite. |
| **Target phase / timeline** | **Day 2 work.** Trigger for transition: either a capacity signal (single process exceeds ~10k concurrent WebSocket connections under realistic load, or autopick scheduling jitter degrades under contention) or an operational signal (deploy/restart blast radius becomes unacceptable for the user count at the time). When triggered, the work is its own effort with its own ADR if scope warrants — at minimum the routing layer, the cross-instance restart story, and the deploy-coordination semantics need design. |
| **Verification test** | Not applicable until the trigger fires. When it does, the verification surface is the same Mandate target set that chunk 11g.10 establishes, re-run against the multi-process deployment with realistic per-shard load. The chunk 11g.1 protocol must not change as part of the transition — that's the contract this KI exists to enforce. |

### KI-012 — v2 room commissioner tools must NOT wire the v1 `/api/draft/league/:leagueId/undo` route

| | |
|---|---|
| **Severity** | medium — architectural trap; wrong-path wiring would bypass the v2 event log and desync the persistent engine's in-memory state from Postgres. |
| **Surface** | `apps/web/src/pages/DraftRoomV2.tsx` (sidebar's `SidebarPanel`, DraftControls gate currently `{false && null}`); `server/src/routes/draft.ts:273` (v1 `/undo` route, commissioner-only); the post-Zach commissioner-policy chunk that lands pause/resume/undo/extend endpoints. |
| **Description** | DR-3 shipped with `DraftControls` mounted-but-hidden in the v2 sidebar because Phase 2 Step 0 spike found only one of the three commissioner surfaces exposed as an HTTP route: `/undo` exists at `server/src/routes/draft.ts:273`, but `/pause`, `/resume`, and `/extend` do not (the engine has `LobbyManager.pauseDraft()` at `:4546` and the Postgres RPCs exist — no browser-callable path). When the post-Zach chunk lands the missing HTTP surfaces, it is tempting to also wire the v2 room's Undo button to the existing v1 `/undo` route because it is "already there". **DO NOT.** The v1 `/undo` route was written for the Phase 0–4 architecture where DraftServiceV2 owned the pick log directly. The persistent-engine architecture (ADR-001) makes the in-server `LobbyManager` the authoritative source of live state; undo MUST flow as a `pick_undone` event via a v2 RPC that (a) writes to `draft_events`, (b) triggers LISTEN/NOTIFY so the engine folds it into memory (`deriveDraftState.ts:228` handles the client-side fold; the engine's `applyPickUndoneEvent` at `LobbyManager.ts:3150` is the server-side fold), and (c) broadcasts the event over WebSocket so all clients re-render. Wiring the v1 `/undo` route into the v2 room bypasses steps (b) and (c) — the engine's in-memory `LobbyManager` state would remain stale, autopick would keep operating from the pre-undo pick count, and other clients would only see the change on their next resync. Silent divergence with a 30-second discovery window is exactly the failure mode the persistent-engine architecture exists to prevent. |
| **Why deferred** | Not a deferral of a fix; a deferral of an *avoidable trap*. Recording it now means the post-Zach commissioner chunk starts with the correct constraint written down instead of discovering it at speed. Architect ruling 2026-07-29 (DR-3 Phase 2 Rider 2). |
| **Target phase / timeline** | **Post-Zach commissioner-policy chunk** (schedule TBD). That chunk MUST: (1) ship new v2 HTTP routes for pause/resume/extend/undo that call the RPCs and let the engine's LISTEN/NOTIFY path do the fanout; (2) update `apps/web/src/pages/DraftRoomV2.tsx` to un-hide `DraftControls` and wire its callbacks to the new v2 routes; (3) delete or explicitly mark `server/src/routes/draft.ts:273` `/undo` as v1-only. The comment on the `DraftControls` gate in `DraftRoomV2.tsx` already points here. |
| **Verification test** | Integration test that fires an Undo through the v2 route and asserts: (a) a `pick_undone` event lands in `draft_events`; (b) the engine's in-memory `LobbyManager.picksMade` decrements without a restart (LISTEN/NOTIFY-triggered fold); (c) all connected clients receive the `pick_undone` broadcast. Guardrail: a `git grep` gate in CI that forbids any import of the string `/api/draft/league/` combined with `/undo` from `apps/web/src/pages/DraftRoomV2.tsx` or its adapter module — makes the trap detectable at PR time, not at incident time. |

### KI-013 — fixture-12 uses synthetic player IDs; acceptance runs display #<id> for most picks

| | |
|---|---|
| **Severity** | low — tooling/demo quality issue, not a product defect. |
| **Surface** | `scripts/proof/fixture-12.mjs` (`HARNESS_PLAYER_IDS` sequential 8478000+ per pick) — feeds every non-human pick in every DR-*/S* acceptance run against staging. The v1 room's DraftBoard, DraftHistory, and TeamRosters render the fallback `#<id>` chip (per DR-3.1 `v1Adapters.rosolvePlayerDisplay`) for every id that doesn't resolve to a row in `player_directory`. |
| **Description** | The DR-4 acceptance run (2026-07-30T16-12-24-468Z) exercised BOTH name-resolution paths in one screen — Garrett's three human picks landed real NHL players (McDavid, MacKinnon, Kucherov) that resolved to real names; every non-human pick landed a synthetic id in the 8478000+ range that mostly didn't resolve, so the board showed "#8478029 / ?" for those slots. **This is CORRECT behavior** — the `#<id>` fallback is the DR-3.1 F9 field-proof path and satisfies the DR-3 pool-usability criterion. But it makes every demo screenshot look broken to a non-technical viewer (Zach, investors, etc.). Fix: fixture-12 should draft the non-human picks from a real player pool sourced from `player_directory` (deterministic selection — e.g., top-N by overall projected rank excluding any already drafted). Every pick lands a real NHL name; the demo screenshots look like a real draft. |
| **Why deferred** | Not a ship blocker for DR-4 — the acceptance run passed all six criteria with synthetic ids because the fallback path renders correctly. Architect ruling 2026-07-30 explicitly deferred F12 as tooling/demo quality, not product bug. **Must land before ANY Zach-facing or investor-facing demo.** |
| **Target phase / timeline** | **Pre-first-demo work.** Trigger: any planned demo where a non-Citrus observer will see the room. When triggered, expand `fixture-12.mjs` setup to query `player_directory` for top-N candidates (via `SUPABASE_DB_URL` since fixture already has it) and use their real ids as `HARNESS_PLAYER_IDS`. Delete or generalize the sequential `8478000+` constant. |
| **Verification test** | Post-fix acceptance run (same DR-4 shape) should produce screenshots where every pick's playerName column reads a real NHL name (Auston Matthews, Connor McDavid, etc.) and NO row shows `#8478xxx`. The `#<id>` fallback path stays covered by unit tests in `v1Adapters.test.ts` (already: "emits #<id> fallback name + ? position when player is unresolved"), so removing synthetic ids from the fixture doesn't lose coverage of the fallback contract itself. |

---

## How to add a row

1. Append a new `### KI-NNN` section. Use the next sequential ID across **both** registries (this one and `docs/RUNBOOKS/draft-engine-v2-known-issues.md`). Check the highest existing ID in each before assigning.
2. Fill in all seven schema columns. None may be blank.
3. Reference the KI- ID in the deferring code comment, e.g. `// TODO(KI-009): remove Edge Function infrastructure once persistent worker verified`.
4. Reference the KI- ID in the commit message that ships the deferral.
5. When resolving: append `**RESOLVED (commit-sha, date)**` plus a one-line note. Do not delete the row.
