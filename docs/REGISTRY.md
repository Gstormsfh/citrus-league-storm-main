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

### KI-014 — F6 close-out: "unreproducible 403" mechanism identified as stale cached membership

**RESOLVED (0752c6fb, 2026-08-03).** Mechanism identified — stale cached membership; teamId variant eliminated by F14(a); boolean variant accepted with documented 30s tolerance. See KI-015.

Beta-triage advance notice (must reach September on-call):
1. A transient 403 within ~30s of any membership change is **EXPECTED**, not an F6 recurrence.
2. A just-joined user opening the draft room may hit a ≤30s denial (stale negative for isMember). Acceptable for v1; logged here so September support does not file it as a bug.

### KI-015 — F14: stale cached membership served a teamId not in the live draft; user silently could not draft

**RESOLVED (0752c6fb, 2026-08-03).** Two-layer fix landed as F14(b) + F14(a).

| | |
|---|---|
| **Severity** | high — I1 invariant violation ("never lose a pick"). Symptomatic on Garrett's 2026-07-31 rig: room mounted with header/clock healthy, Managers panel read "0 of 0 connected," draft submit refused "It's not your turn." |
| **Surface** | `server/src/services/LeagueMembershipService.ts` (cache); `server/src/routes/draft.ts:154, :299` (v1 pick routes that consumed cached `.teamId`); `apps/web/src/hooks/useMyTeamIdCrossCheck.ts` + `apps/web/src/pages/DraftRoomV2.tsx` (client cross-check + fail-loud banner). |
| **Description** | LeagueMembershipService holds a module-level 30s cache keyed `(leagueId, userId)`. Team ownership changed out-of-band (fixture-12 un-owns Gbaby, assigns harness slot 3 to Garrett); nothing invalidated the cache. The room mounted inside the stale window and resolved `myTeamId` to a team not in this draft; myTeamId was fetched once on mount and never re-resolved. **Live-path mechanism trace (Amendment 1):** the v2 pick route (`draftV2Pick.ts`) does NOT consult cached teamId — body.team_id passes straight through to `submit_pick_v2` RPC, which enforces `auth.uid() = team.owner_id`. So on Garrett's incident, F14(b)'s client cross-check was the load-bearing fix; the `[DR-2 diag]` log at `membership.ts:41` was EVIDENCE of staleness, not the mechanism of denial. F14(a) is v1-hardening (`draft.ts:154/:299` still consumed cached `.teamId`) + defense-in-depth hygiene. |
| **Why deferred** | Not deferred. Fixed in the same campaign as F15/F19/F20/F22 (2026-07-31 → 2026-08-03). |
| **Target phase / timeline** | Fixed in phase-4-5-implementation branch across commits `fe268e1c` (F14(b) client cross-check + honest-copy) and `0752c6fb` (F14(a) server cache restructure + honest-copy amendment). |
| **Verification test** | (a) `server/src/__tests__/draftRoutes.f14.test.ts` — BRANCH A (rightful new owner) + BRANCH B (former owner, F14 REPRO). Cache stays warm throughout; divergence between branches proves the route consults `getUserTeamIdFresh`, not cached `.teamId`. (b) `server/src/__tests__/LeagueMembershipService.test.ts` — `getUserTeamIdFresh` method tests including the cache-warm/stale-value F14 repro at method level. (c) `apps/web/src/hooks/__tests__/useMyTeamIdCrossCheck.test.ts` — BRANCH 2 (LOAD-BEARING) confirmed still-stale after re-resolve, BRANCH 2b honest-copy `my_team_unverifiable` on network throw. Field verification pends the fresh acceptance run (criterion C: freshly-authenticated member rejoining a LIVE draft). |

Amendment 3 note (invalidation-unreachable writers): `public.join_league_with_code(...)` (latest: `20260418100000_idempotent_join_league.sql`) writes `owner_id` via DB-side RPC; Node code is unaware after the RPC returns. `clearCache` is structurally unreachable. Boolean cache TTL is the ONLY invalidation for that writer. Future trade/co-manager RPCs (ADR-003) will inherit the same limitation. See KI-024.

### KI-016 — F15: authMiddleware returned 401 for provider-unreachable (should have been 503)

**RESOLVED (9ea634db, 2026-07-31).** Root cause and repro documented in commit.

| | |
|---|---|
| **Severity** | high — Draft-Night blocker. Any Supabase network blip during a request would return 401 to the client; the client (F19 pre-fix) then destroyed the local session. F15+F19 together produced logout on wifi drop. |
| **Surface** | `server/src/middleware/auth.ts` (server); `apps/web/src/api/client.ts:52-107` (client — see KI-020). |
| **Description** | `supabase.auth.getUser()` resolves-with-error (does not reject) for network failures — returning `AuthRetryableFetchError` on the `error` field. Pre-fix middleware returned 401 unconditionally on any truthy error, indistinguishable from "your token is invalid." Fix: allowlist positively-identified credential failures (`AuthApiError` with 400/401 status; enumerated credential codes) → 401; everything else → 503 with `AUTH_PROVIDER_UNREACHABLE` code (apiClient retries 503 with backoff). Amendment 1 rationale: the set of "your token is dead" errors is small, stable, and enumerable; the set of "the network broke" errors grows with every runtime, proxy, and browser. Allowlist rots slower than denylist. Amendment 2 rationale: prefer supabase-js's exported `isAuthApiError` / `isAuthRetryableFetchError` type guards over string-name comparison. |
| **Why deferred** | Not deferred. |
| **Target phase / timeline** | Fixed in phase-4-5-implementation branch commit `9ea634db`. |
| **Verification test** | `server/src/__tests__/authMiddleware.test.ts` (10 tests covering all discrimination paths + amendment-1 regression guards). `server/src/__tests__/supabaseAuthErrorContract.test.ts` (unstubbed contract test at `.invalid` hostname — confirms supabase-js resolves-with-`AuthRetryableFetchError` for network failures; if that ever changes to reject, this test fails immediately). |

### KI-017 — F16: draft harness has never exercised the human-actor branch of submit_pick_v2

| | |
|---|---|
| **Severity** | medium — instrument coverage gap, not a product defect. |
| **Surface** | `scripts/proof/draft-harness.mjs`; `submit_pick_v2` RPC (which branches on `v_actor_kind = 'autopick'` vs `'user'`). |
| **Description** | Every pick the harness has ever submitted was tagged `is_autopick = true` (harness signs its own tokens using service_role and drives the autopick branch). The RPC's rail (insert / trigger / NOTIFY / broadcast / ordering) is downstream of the branch and therefore branch-agnostic, so ratified latency/delivery/ordering numbers stand. What is NOT covered by harness runs is the validation branch upstream of the insert for `actor.kind='user'`. Field coverage of that branch: ~4 browser picks by one person per acceptance run. Same-shape family as KI-014 (harness never resolved membership) and F3 (harness bypasses discovery + signs its own tokens). |
| **Why deferred** | Fix is a new harness client mode that authenticates as a real Supabase user owning a real team. Requires the `garrett.storms+staging2@citrusfantasysports.com` account (queued for multi-user presence work). One account, two ledger items. |
| **Target phase / timeline** | Before public beta / Draft Night. Bundle with the multi-user presence acceptance work. |
| **Verification test** | New harness scenario running as staging2 user with actor.kind='user', asserting the RPC accepts, event lands with `is_autopick=false`, and downstream rail delivers unchanged. **Ship-report caveat**: every mandate number cited from a harness run today carries the actor-branch qualifier — measured on the autopick branch only, human-actor branch validation covers ~4 browser picks per acceptance run. |

### KI-018 — F17: fixture-12's `--human-slot` strips the user's real team ownership for the duration of the run

| | |
|---|---|
| **Severity** | low — documented tooling contract, not a bug. |
| **Surface** | `scripts/proof/fixture-12.mjs`; the staging league's `teams` table. |
| **Description** | `fixture-12.mjs --human-slot=N --human-user=X` un-owns the user's pre-existing team (owner_id → NULL) and assigns a harness team to them for the run. Consequences: (1) The pristine-baseline assertion "Gbaby owned by c4489220" is the ONLY tripwire that catches an incomplete reset (`--reset` restores from the captured state file). Never skip the tripwire — a failed reset orphans Garrett from his own team on staging. (2) Managers panel evidence during a human-slot run reads "Harness Team N," not the user's real team name (per F17 acceptance-criterion F). |
| **Why deferred** | Not a bug; contract documented here and in the ship report. |
| **Target phase / timeline** | N/A — contract lives here and in fixture-12.mjs's header. |
| **Verification test** | Cleanup cookbook's pristine-baseline check verifies `4c742dae… owner_id = c4489220`. |

### KI-019 — F18: harness summary generator miscounts its own accumulators (drop-rate + SIGINT paths)

| | |
|---|---|
| **Severity** | low — instrument reporting; ratified numbers stand once partitions annotated. |
| **Surface** | `scripts/proof/draft-harness.mjs` summary generator (both normal-exit and SIGINT-abort paths). |
| **Description** | Two observed miscounts in the same generator: (1) the drop-rate summary counted certain not-submitted picks as drops; corrected story is "true drop rate 0%" once the not-submitted partition is separated (architect ruling 2026-07-31 arithmetic reconciliation). (2) the SIGINT-abort path reports `Samples captured: 0` despite N picks completed and M delivered observations shown live; the SIGINT counter reads a different accumulator than the one populated during normal run (observed 2026-08-05 in stragglers-run S2-2026-08-05T00-21-15-188Z after Ctrl+C at pick 5 with 60 observations shown live). Same-shape family as F16 (instrument gap) — instrument counts itself incorrectly. Neither variant affects fault-flush integrity or the ratified rail numbers. |
| **Why deferred** | Fix folds into the harness improvement work with F16. Meanwhile, the ship report annotates partitions manually. |
| **Target phase / timeline** | With KI-017's harness client-mode work. |
| **Verification test** | Post-fix harness summary emits the not-submitted count as its own field distinct from delivered/dropped, AND the SIGINT-abort path's "Samples captured" reads the SAME accumulator that populated during the run (test asserts SIGINT-mid-run captured-count == observed-count). Ship-report footnote until then. |

### KI-020 — F19: refreshTokenOnce signed the user out on network failure

**RESOLVED (9ea634db, 2026-07-31).** Same commit as KI-016 (F15+F19 are the same defect at two layers).

| | |
|---|---|
| **Severity** | high — Draft-Night blocker. Wifi drop mid-draft → forced signout → cannot rejoin. |
| **Surface** | `apps/web/src/api/client.ts:52-107`. |
| **Description** | `supabase.auth.refreshSession()` resolves-with-error (not rejects) on network failure. Pre-fix code called `signOut()` on any truthy error in the `.then` branch, destroying the local session on wifi blips. The `.catch` branch was dead code for network faults. The line-59 comment asserted the exact safety property that did NOT hold. Fix: same allowlist as KI-016 (positively-identified credential failures only). Amendment 4: `.catch` NEVER signs out — a rejection is the weakest possible evidence of a bad credential. Field-verification test C (freshly-authenticated rejoin) exercises this path directly. |
| **Why deferred** | Not deferred. |
| **Target phase / timeline** | Commit `9ea634db`. |
| **Verification test** | `apps/web/src/api/__tests__/client.test.ts` (6 new discrimination tests + updated pre-existing test whose fixture was a bad proxy for its stated intent). Unstubbed contract test at `.invalid` hostname confirms library behavior. Fresh acceptance run criterion B(ii): NO auth/v1/logout calls in console during the 90s outage; session survives. |

### KI-021 — F20: draft stalled at seq 25/36 (guard rejected an on-time timer, no re-arm)

**RESOLVED at code level (856a5fe0, 2026-08-03).** Field closure pends the engine deploy + fresh acceptance run — the deployed engine at `73a587ff` still carries the original guard until then.

| | |
|---|---|
| **Severity** | critical — league-that-cannot-finish. Twelve people watching a dead clock with nothing to click. Above F14/F15/F19 in severity: F14/F15/F19 each produce a user who cannot act; F20 produces a LEAGUE that cannot finish. |
| **Surface** | `server/src/draft/LobbyManager.ts:setPickDeadline` + `:handleClockExpired`; new global scanner in `server/src/draft/LobbyRegistry.ts:startClockLivenessScanner` + `:scanClockLiveness`; new public `LobbyManager.attemptClockRecovery(observedSeq)`. |
| **Description** | `handleClockExpired`'s wall-clock guard used strict `<` against a wall clock coming out of `setTimeout`. `setTimeout` can fire sub-millisecond early under GC or event-loop pressure; a fire at 44999.6ms rounds to 44999ms via `Date.now()`'s integer floor, tripping `44999 < 45000`. The pre-fix guard responded with bare `return`. No re-arm. Draft dies logging "healthy" every 30 seconds. The engine sat on a dead league for 44 minutes, logging itself healthy every 30 seconds. **Boundary confirmed by reproduction**: red at tolerance=0 on a 1ms-early fire; sub-ms floor is sole explanation consistent with source, log, and two drift-0 successes at seqs 19 and 25. Fix landed in four commits: (1) guard tolerance 25ms + mandatory re-arm + fail-open cap after 3 consecutive re-arms; (2) Amendment A outcome-assertion tests; (3) global registry scanner (5s scan / 10s stall / idempotent / 3-strike escalation / unkillable per-lobby try-catch + top-level catch); (4) CASE 5b end-to-end outcome test with real LobbyManager. Includes F21 (log-truth: single `Date.now()` capture — pre-fix code called `Date.now()` three times per guard invocation, making sub-ms early fires invisible in the log). |
| **Why deferred** | Not deferred at code level. Field closure pends engine deploy at post-F14 SHA. |
| **Target phase / timeline** | Field closure: after acceptance run criterion D (draft reaches 36/36 with no stall; census of `stale_timer_skipped` / `clock_stall_recovered` / rung1/2/3 counts). |
| **Verification test** | `server/src/draft/__tests__/LobbyManager.f20.test.ts` (8 boundary tests including the CASE 3 tolerance+1ms-early rejection + re-arm + autopick actually fires, and CASE 6 cap exhausted + fail-open + autopick actually lands). `server/src/draft/__tests__/LobbyRegistry.f20.test.ts` (10 tests: scanner detects stall, does NOT re-arm during in-flight submit, escalates at 3 strikes and stops, UNKILLABLE with one throwing lobby, strike-map hygiene on eviction + natural recovery, CASE 5b end-to-end scanner-driven autopick outcome). Field-verification test D on the fresh acceptance run. |

Related but out-of-scope for KI-021: KI-025 (F23 DB-side vanished-lobby scan).

### KI-022 — F22: DraftRoomV2 test suite was not executing (13 tests throwing before assertions)

**RESOLVED (5e5c884e + fe268e1c, 2026-08-03).** Primary fix + structural follow-up.

| | |
|---|---|
| **Severity** | high (test infrastructure). The suite included F4 REGRESSION and F11 DISAMBIGUATION guards — two campaign-paid-for defects. Both still hold at the assertion level (post-fix run), so no silent regression during the chunk-11g.10 window. But the suite was DARK for the entire window. Fourth instance-of-species (F3 stubs lied about the real producer, F17/F16 harness never drove the human path, KI-019 instrument miscounted itself, F22 suite never executed). |
| **Surface** | `apps/web/src/pages/__tests__/DraftRoomV2.test.tsx` + `.dr3.test.tsx` + `.f11.test.tsx`. Runner mock class in each file. |
| **Description** | 11g.10 added `setDraftActive` to `DraftClientRunner`. Three hand-copied mock runner classes drifted from the real interface independently — none got the new method. Every test in all three files threw `TypeError: runner.setDraftActive is not a function` at `DraftRoomV2.tsx:261` BEFORE its first assertion. Primary fix: add `setDraftActive = vi.fn()` to each mock. Structural fix: consolidated to one shared factory `apps/web/src/lib/draftClient/__mocks__/mockRunner.ts` with `satisfies Record<RunnerMethodKey, Mock>` load-bearing type check. `RunnerMethodKey` auto-derived from the real class via `PublicMethodKeys<T>`. **Red-demo observed**: adding a scratch public method to `runner.ts` produced `TS1360` in `mockRunner.ts` verbatim — the next runner method CANNOT go dark silently. |
| **Why deferred** | Not deferred. Fixed in same campaign. |
| **Target phase / timeline** | Commits `5e5c884e` (primary) + `fe268e1c` (structural). |
| **Verification test** | All 13 tests execute; 13/13 pass. Structural guarantee verified by red-demo. See test-strategy provenance table. |

### KI-023 — F13: harness NDJSON append stream + fault-flush + pg-error survival

**FULLY RESOLVED (73a587ff for the code; both halves proven in field by 2026-08-05).**

| | |
|---|---|
| **Severity** | medium — instrument reliability. |
| **Surface** | `scripts/proof/draft-harness.mjs`. |
| **Description** | Harness uses an append-stream NDJSON writer; a pg 'error' handler registered before connect; uncaughtException / unhandledRejection / SIGINT / SIGTERM route through an idempotent flush that writes a PARTIAL SUMMARY tagged with the reason. Both halves proven in field. |
| **Why deferred** | N/A. |
| **Target phase / timeline** | Closed 2026-08-05. |
| **Verification test** | (a) Full-run summary + ndjson on disk with matching byte counts — proven 2026-07-31 (voided run) + 2026-08-04 (S2-2026-08-04T18-10-43-804Z, 36/36 clean). (b) Deliberate SIGINT-mid-run test — proven 2026-08-05 (S2-2026-08-05T00-21-15-188Z, killed after pick 5 exactly per choreography, `── ABORTED (SIGINT) ──` header + partial summary written to disk; cadence break independently confirmed by DB census). Named gap CLOSED. |

*Related NEW ledger observation (folds into KI-019 not here):* the abort-path summary reported `Samples captured: 0` despite 5 completed picks and 60 delivered observations shown live. SIGINT counter reads the wrong accumulator. Instrument reporting, not fault-flush integrity.

### KI-024 — Cloud Run per-instance in-memory caches cannot be coherently invalidated across instances

| | |
|---|---|
| **Severity** | medium — pre-production architecture concern. |
| **Surface** | `server/src/services/LeagueMembershipService.ts` (module-scope `membershipCache` Map); any future service that uses a module-scope Map for cross-request state. |
| **Description** | Cloud Run runs N instances. A `clearCache(leagueId, userId)` call on instance A does NOT touch instances B..N. This is a structural limitation of module-scope caches in horizontally-scaled runtimes — cache invalidation on write is INCAPABLE of being coherent across instances. F14(a) mitigated by removing identity-critical `teamId` from the cache entirely (allowlist-boolean-only design: only cache what a stale positive is low-harm for), so cross-instance staleness reduces to the documented ≤30s TTL on boolean membership. Amendment 3 enumeration extends the argument: DB-side RPC writers (`public.join_league_with_code(...)`; future trade/co-manager RPCs per ADR-003) are ALSO invalidation-unreachable — no Node code runs when they mutate ownership. This is the strongest possible case for the boolean-only cache design: no wiring discipline can cover writers the process never sees. |
| **Why deferred** | Structural — cannot be "fixed" within the module-scope cache paradigm. Real solutions require either a shared cache tier (Redis, Memorystore per Stage 4 of `PHASE_4_5_ARCHITECTURE.md`) or dropping caching entirely (measured freshness cost). Both are ADR-scope decisions. |
| **Target phase / timeline** | Ambient — beta triage protocol acknowledges the ≤30s tolerance (KI-014's two advance-notice items). Revisit if v1 scale surfaces user-visible cache-coherence anomalies. |
| **Verification test** | N/A structurally. The design property to preserve: teamId (or any identity-critical value) never enters the cache. `getUserTeamIdFresh` is the invariant carrier; a review that adds a cache to it renames the method into a lie. |

### KI-025 — F23: draft-engine registry-blind stall recovery (DB-side scan for vanished lobbies)

**Field illustration (2026-08-04):** the zombie draft from the 2026-07-31 void run (league `993c9219…`, max_seq 25, draft_status=in_progress) was still stalled in the DB post-deploy of `527ceb38`. New engine ran for 13+ min after boot without touching it. This is F20's scanner working AS DESIGNED — it iterates lobbies in the in-memory registry, and the zombie league has no lobby (nobody connected post-restart, so the lazy `getOrCreateLobby` never fired). F23's whole surface is exactly this case: the DB says a draft is live, but no in-process lobby represents it. Recorded as the first concrete demonstration of the KI-025 gap.

| | |
|---|---|
| **Severity** | medium — F20's in-memory scanner does not cover the case where a lobby VANISHED from the registry while the DB still says in_progress (no lobby, no scan, no recovery). |
| **Surface** | `server/src/draft/LobbyRegistry.ts` (would host the new DB-side scanner); a new query on `leagues WHERE draft_status='in_progress' AND pick_deadline < now() - threshold`. |
| **Description** | F20's `scanClockLiveness` iterates lobbies IN the registry. If a lobby is evicted or force-purged while the DB still says the draft is in_progress, no scanner sees it. The related open question — after an engine restart mid-draft with NO client connected, does anything resurrect the lobby? — is also unanswered by tonight's abandoned-draft observation (which ran on a lobby already in memory). F23 addresses both: DB-side scan detects the DB-vs-registry mismatch and rehydrates. Not scoped into F20 to keep the fix ship narrow. |
| **Why deferred** | Ships narrow beats ships broad for a load-bearing fix. F20's in-memory scanner covers the observed failure; F23 covers the class ruling 2 called out explicitly. Own chunk. |
| **Target phase / timeline** | Its own chunk, post-launch triage or pre-launch if a DR reveals a vanished-lobby scenario. |
| **Verification test** | (a) DB-side scanner detects a lobby whose DB `pick_deadline` is > threshold past AND no in-registry lobby exists → rehydrates via `getOrCreateLobby` → scanner then advances the clock. (b) Engine restart mid-draft with no client connected → next scanner tick rehydrates and resumes. |

### KI-026 — Ledger: deployed engine at 73a587ff runs OLD authMiddleware on /api/admin

**RESOLVED (deploy 527ceb38, 2026-08-04).** Draft-engine image tag `527ceb38-draft` (digest `sha256:d693189d6b2966e27164e9288bec314ef9a34c8907aa4b5165a9c8a39d6cb614`) deployed to citrus-draft-engine-staging. 9-item boot verification passed at 2026-08-04T15:51:55Z; `deployment.fingerprint` shows `imageSha` == push digest AND `commitSha` == `527ceb384d280ed3853de6e36000b442a54fdc76`. Admin surface (`/api/admin/*`) now runs post-F15 authMiddleware — provider-unreachable errors return 503 instead of 401.

### KI-027 — Ledger: systemFlags.ts:96 — F21-family observability bug (err argument silently dropped)

`server/src/lib/systemFlags.ts:96` passes an `err` third argument to a 2-arg `structuredLogger.debug` signature. At runtime the error object is SILENTLY DROPPED from the log. Not just a type error — a live observability defect in F21's family (log lies by omission). One-minute fix any time; not touched during the F14 campaign because outside scope.

### KI-028 — Ledger: History table "Drafted By" column renders raw UUID

Same demo-optics family as KI-013 (F12). Cosmetic; must not ship to Zach or investors. Fix during pre-first-demo work alongside KI-013.

### KI-031 — Cleanup snapshot orphan from 30 s snapshot-writer race (cookbook amendment)

**RESOLVED-BY-COOKBOOK-AMENDMENT (2026-08-05).** Cleanup cookbook gains a mandatory final `clear-snapshots.local.mjs --execute` step AFTER the engine restart. The pristine baseline's `snapshots=0` field becomes the tripwire that catches the race whenever it recurs.

| | |
|---|---|
| **Severity** | medium — persisted-state variant of the seq-dedup class. First loss observed 2026-08-05 (post-cleanup after stragglers-run showed `snapshots=1` despite the reset's `DELETE FROM draft_snapshots`). First loss in five cleanups; not caught by any single-run test. |
| **Surface** | `scripts/proof/fixture-12.mjs` reset path (`DELETE FROM draft_snapshots`), `server/src/draft/LobbyManager.ts` snapshot writer (30 s periodic tick), pristine-baseline verification (`snapshots=0`), cleanup cookbook in `scripts/proof/README.md` step 6. |
| **Description** | The engine's periodic snapshot writer ticks every 30 s. If the tick fires between the cleanup reset's `DELETE FROM draft_snapshots` (step 4) and the engine restart landing (step 5), the writer re-upserts a snapshot with the CURRENT in-memory state (lastAppliedSeq populated to whatever the just-finished run reached — e.g., 12). Left in place, that orphan snapshot survives every future engine restart (snapshots are persisted on disk, not in-memory). The NEXT run's engine lazy-loads the lobby, reads the orphan snapshot, thinks it's caught up to the stale seq, and skips new events as duplicates. **Persisted cousin of the in-memory seq-dedup bug** that has bitten twice from the LobbyRegistry angle alone. |
| **Why deferred** | Not deferred — resolved by cookbook amendment 2026-08-05. Post-restart placement is correct: no in-memory lobby exists during cleanup (no clients connected), so the snapshot writer has no state to write; clear-snapshots deletes any race orphan and the writer produces nothing new. |
| **Target phase / timeline** | Cookbook amended in commit shipping this KI. Pristine baseline verification (11-field DB read) now includes `snapshots=0` as an explicit tripwire — any recurrence is caught at the next cleanup, not silently carried into the following run. |
| **Verification test** | (a) 2026-08-05 evidence: post-stragglers-run cleanup showed `snapshots=1` orphan with lastAppliedSeq=12 (pre-amendment). (b) After running `clear-snapshots.local.mjs --execute`, re-verified 11/11 pristine including `snapshots=0`. (c) Future cleanups: `snapshots=0` in the pristine baseline check catches any recurrence at the boundary. |

### KI-032 — F25: F24 migration authored against stale live body (capture-before-replace rule ships)

**Field record (2026-08-05).** F24 acceptance run on staging failed at the first pick: `PERFORM public.validate_draft_event_payload('pick', v_payload)` raised `check_violation: pick.pick_deadline missing`. Zero picks committed; the RAISE EXCEPTION rolled every transaction back cleanly. Root cause: `20260805023419_v2_draft_completion_emitter.sql` was authored against the body from `20260512000000_remove_pgmq_infrastructure.sql` and missed the chunk 10c-2 batch 2 update `20260727010000_pick_event_carries_pick_deadline.sql` (2026-07-27), which grew the 'pick' event's required payload fields to include `pick_deadline`. The CREATE OR REPLACE dropped the batch-2 changes on the floor, silently. Reproduced deterministically on every submit attempt; zero side effects to state (Fixture-12's 30 s pre-state-clean plus the transactional rollback covered it).

**RESOLVED (rebase commit 20260805050000, 2026-08-05).** Supersede migration `20260805050000_v2_draft_completion_emitter_rebased.sql` grafts F24 onto the batch-2 body verbatim (both queries filter `AND deleted_at IS NULL` per Amendment 3; pick payload retains `pick_deadline`; INSERT retains `event_version=2`; F24 completion branch preserved with all D1–D8 rulings + Amendments 1–4). The stale 20260805023419 file stays in the repo as evidence — never mutated.

| | |
|---|---|
| **Severity** | high — silent data-model drift class; would have re-occurred on every future function-modifying migration authored the same way. |
| **Surface** | Every `CREATE OR REPLACE FUNCTION` migration in `supabase/migrations/*.sql`; the review process; the acceptance-run gate. |
| **Description** | CREATE OR REPLACE FUNCTION replaces the function body in its entirety — there is no diff, no merge, no "port your changes on top of what's live." Any prior migration's edits to that function body are silently dropped unless the new author starts from the current live body. The Supabase migrations directory is chronological, not current-state — reading only the file that first introduced a function misses every subsequent migration that touched it. Author discipline is the only defense. |
| **Why deferred** | Not deferred — resolved same-day by rebase migration + two standing rules (below). |
| **Target phase / timeline** | Rules folded into the F24 rebase commit; live from 2026-08-05 forward. |
| **Verification test** | (a) Pre-apply capture: every function-modifying migration commit MUST include `pg_get_functiondef(<target>::regprocedure)` output for the target function, captured the same day the migration is authored, committed alongside the migration file. Directory: `supabase/migrations/captures/YYYY-MM-DD_pre_<migration-slug>.sql`. If the commit lacks the capture file, the migration cannot be applied. (b) Post-apply diff: after applying the new migration, `pg_get_functiondef` of the live function MUST equal the migration file body — the apply script performs this check and fails on any diff. (c) F24 acceptance rerun on rebased body: expected clean run with 36/36 picks committed + `draft_completed` event at seq 37 + `leagues.draft_status='completed'` + `leagues.pick_deadline IS NULL`. |

### KI-033 — Machine-find: `draft_events.payload_hash` NOT NULL constraint blocks NULL-hash completion appends

**Field record (2026-08-05).** During F24 rebase review, architect ran the live schema and observed `payload_hash` on `draft_events` is `NOT NULL`. The F24 completion branch as originally written passed `NULL` as `p_payload_hash` into `append_draft_event`, which forwards the argument verbatim into the INSERT. That INSERT would have surfaced a `null value in column "payload_hash" violates not-null constraint` error and rolled back the ENTIRE final-pick transaction — the pick INSERT above the completion branch, the counter increment, and the leagues UPDATE would all have vanished. Would have manifested only on the final pick of every draft; every draft would appear to freeze at N-1/N picks with no completion event ever emitted, and the final pick would be gone from `draft_picks_v2` (rollback erased it). Not caught by any unit test (no test exercises the final-pick transition against a real DB with the NOT NULL constraint present).

**RESOLVED (Amendment 4 in rebase commit 20260805050000, 2026-08-05).** Completion event payload hoisted into `v_completion_payload` before the `append_draft_event` call; `v_completion_hash` = `encode(sha256(convert_to(v_completion_payload::text, 'UTF8')), 'hex')` (core pg, no pgcrypto dependency); passed as `p_payload_hash`. Byte-stable JSONB text serialization keeps the hash reproducible across future audits.

| | |
|---|---|
| **Severity** | high — catastrophic + silent + only-on-completion, i.e. the worst possible combination. |
| **Surface** | `public.submit_pick_v2` completion branch; `public.append_draft_event` (forwards p_payload_hash verbatim); `draft_events.payload_hash NOT NULL` (live schema). Also applies to any future caller of `append_draft_event` for a non-pick event that isn't itself in the pick path (system events, chat events with hashing, etc.). |
| **Description** | The DB-level NOT NULL constraint is the ultimate arbiter of what payloads can land. Function-level defaults (`p_payload_hash DEFAULT NULL`) do NOT override column-level constraints — the default hits, the INSERT rejects. Any code path calling `append_draft_event` must either (a) pass a real hash, or (b) live with the transaction rolling back on the final row. Adding a NOT NULL to an event-log column is one-directional; every caller downstream must be audited when it happens. |
| **Why deferred** | Not deferred — resolved in the same commit that would have introduced the defect. First machine-found defect on this campaign ledger via architect's pre-apply schema read. |
| **Target phase / timeline** | Amendment 4 folded into rebase commit 20260805050000. |
| **Verification test** | (a) Post-apply: pick a league to completion on staging, assert `SELECT event_type, payload_hash FROM draft_events WHERE league_id = <lg> ORDER BY seq DESC LIMIT 1` returns `('draft_completed', <64-hex-char string>)`. (b) Post-apply: `SELECT count(*) FROM draft_events WHERE payload_hash IS NULL` returns 0 (invariant across all event types). (c) Future: any migration adding/removing NOT NULL on `draft_events.*` columns MUST enumerate downstream `append_draft_event` callers in its header comment. |

### KI-029 — F24: v2 engine has no draft-completion transition (emitter contract machine-proven)

**RESOLVED (2026-08-05).** Chunk delivered across commits `c9f37a53` (initial F24 patch, subsequently rebased per F25) → `7d4c7323` (F24 rebase migration `20260805050000_v2_draft_completion_emitter_rebased.sql`) → apply commits INS-4..INS-7 (`1f7b5328` / `2aa44ae1` / `0d179263` / `ac42e4f9` / `e1377a9b`) hardening the direct-apply harness. F24 lives on staging at live md5 `0936f891d707da231446d440b452197f`. Acceptance rerun run out passed A/B/D; C was a true-negative that surfaced F26 (KI-035 below).

**Emitter contract fully machine-proven.** Architect ratification (2026-08-05, post-acceptance):

- **A. leagues transition.** Final pick (pick 12) landed → `draft_status='completed'`, `pick_deadline=NULL`, `draft_event_counter=13`. Flip is the RPC's own — ignition-guarded within the same transaction as the pick INSERT.
- **B. draft_completed event.** Landed at seq 13 with payload `{total_picks:12, completed_at}`. NULL idempotency key (single-fire per D3 lock discipline). Actor inherited from final-pick caller. `correlation_id` == pick 12's correlation. Architect's independent sha256 recompute of the completion payload MATCHES `draft_events.payload_hash` (Amendment 4 hash forwarding verified end-to-end). Event census on draft_events showed 1..13 gap-free, no duplicate seqs, no orphaned events.
- **D. Picks 1-12.** Applied + broadcast clean end-to-end; cursor dedup worked as designed; one WARNING at 18:27:03 `'clock fired but draftStatus=completed — ignored (timer should have been cancelled)'` — F20 guard absorbed and announced the residual expiry that F26 (below) failed to prevent.

**Observations (non-defect, documented for the record):**
- Completion event `event_version=1` — append_draft_event's default, matching draft_started. Pick events at version=2 (batch-2 bump) is the expected version-domain divergence.
- Pick payload_hash is caller-domain by design (idempotency token from the caller's payload, not DB-recomputable). Only completion payload_hash is server-computed (Amendment 4 sha256 of the completion payload).
- `draft_state='active'` still (Amendment 2 evidence-closed — see KI-034).

**Emitter architecture that shipped:**
- Structural SUM `SUM(jsonb_array_length(team_order))` filtered `deleted_at IS NULL` (D1 + Amendment 3 mirror).
- `IF v_total_picks > 0 AND p_pick_number >= v_total_picks` guard (D2 defense-in-depth).
- `RAISE WARNING` on impossible strict-greater case (D8 absorb-and-announce).
- `UPDATE leagues SET draft_status='completed', pick_deadline=NULL` (Amendment 1).
- `append_draft_event('draft_completed', ...)` with sha256-hashed payload (Amendment 4), NULL idem key, inherited actor, reused correlation.
- Snake/linear only (D5); auction completion is a separate future chunk.

**Verification test** (executed on staging 2026-08-05):
- (a) 12-team snake acceptance run → all 12 picks committed, completion event emitted at seq 13, leagues row flipped, pick_deadline NULL. ✓
- (b) Independent sha256 recompute of completion payload matches stored payload_hash. ✓
- (c) Event census 1..13 gap-free with correct type/version distribution. ✓

**Residual (KI-035 / F26).** External-apply LobbyManager path for `draft_completed` sets internal status but does not broadcast/cancel-timer/teardown. Gate: fix before THE TWELVE. Details in KI-035.

### KI-034 — Completed leagues retain `draft_state='active'` post-F24 (Amendment 2 evidence-closed, semantically load-bearing NOT)

**Field record (2026-08-05).** During F24 design review, architect ran `SELECT draft_state FROM leagues WHERE id = <staging test league>` and psql returned `ERROR: column "draft_state" does not exist`. The v2 stack reads `draft_status` (`in_progress` / `completed` / `paused` / etc.); `draft_state` was a Phase 0–4 column that never made it to the v2 schema. F24 originally proposed setting `draft_state='completed'` alongside `draft_status='completed'` in the completion UPDATE for defense-in-depth; Amendment 2 removes that write on the empirical grounds that (a) the column doesn't exist to write to, and (b) no v2 consumer reads it. Recorded as a KI so a future refactor that adds `draft_state` back doesn't silently reinstate the write without an audit.

| | |
|---|---|
| **Severity** | low — semantic-only; no behavior differs today because no consumer reads `draft_state`. Would elevate to medium if a future column re-add treats `draft_state='active'` as authoritative for completed leagues (would break `WHERE draft_state='completed'` queries). |
| **Surface** | `public.leagues` table schema; `public.submit_pick_v2` completion branch; any future consumer that reads `draft_state`. |
| **Description** | F24 completion branch writes `draft_status='completed'` + `pick_deadline=NULL` only. No `draft_state` write, deliberately. If future work re-adds a `draft_state` column (v1 migration back-port, PROD-PORT scope, etc.), the semantics need to be settled at that time — either extend F24's completion UPDATE to write it, or bump this KI severity and document the intentional divergence. Recording the deliberate omission so it isn't discovered as a "bug" by someone who never saw the Amendment 2 decision. |
| **Why deferred** | Not deferred — deliberately not extended. The next actor on any `draft_state` re-add must confront this KI. |
| **Target phase / timeline** | Ambient. Revisits triggered by any migration adding `draft_state` to `public.leagues`, and by PROD-PORT scoping (which will re-encounter the v1 column set). |
| **Verification test** | Any future migration adding `draft_state` to `public.leagues` MUST reference this KI in its header comment AND either (a) extend `submit_pick_v2`'s completion branch to write it (with matching KI-034 update), or (b) document why the column should remain unwritten by the completion path. |

### KI-035 — F26: external-apply `draft_completed` is applied-but-silent (LobbyManager)

**Field record (2026-08-05, F24 acceptance rerun).** F24 emitter contract fully proved on the DB side (KI-029). The C-block acceptance assertion (WebSocket clients observe a `draft_completed` frame after the final pick) was a true-negative: zero `draft_completed` frames in the ndjson capture across all 12 connected clients. Investigation showed the engine had received the seq 13 event via LISTEN/NOTIFY and logged `external_event.applied broadcasted:false` at 2026-08-05T18:26:07.082Z. All 12 clients were still connected at that timestamp; their WS closes began +88 ms later (client-side timer expiries, F26-induced). At 2026-08-05T18:27:03Z, pick 12's armed pick timer fired against the completed draft — F20 guard absorbed and announced: `'clock fired but draftStatus=completed — ignored (timer should have been cancelled)'`. The F20 guard-and-warn absorbed cleanly; F26 is upstream of the guard.

**Root cause.** `server/src/draft/LobbyManager.ts:2833-2835`, the external-apply switch's `case 'draft_completed'`:

```typescript
case 'draft_completed':
  this.draftStatus = 'completed';
  break;
```

Sets lobby-internal status only. Does NOT:
1. Broadcast the `draft_completed` frame to connected clients (analogous to the pick broadcast in `applyPickEvent`).
2. Cancel the currently armed pick timer (the pick 12 timer stays armed → fires → F20 guard absorbs).
3. Initiate teardown of the lobby (leave-timer, snapshot flush, cull-schedule, etc. — analogous to the internal-path teardown at `LobbyManager.ts:1826-1832`).

The internal path (`processSubmitPick` else-branch, `LobbyManager.ts:1826-1832`) does all three correctly — F24 acceptance's *DB* proof carried through *because* the internal path fires when submit_pick_v2 returns a completion-shaped RETURN. The external-apply path is what fires when the completion event arrives via LISTEN/NOTIFY on OTHER engine instances (or on the same engine after a snapshot bootstrap that missed the internal path). Field-proven behavior for internal path; external path was never exercised until acceptance because prior chunks never emitted `draft_completed` at all.

| | |
|---|---|
| **Severity** | high — UX/wrong-signal class, not liveness. Draft completes correctly (DB is right), but clients don't see it and stay connected staring at a locked draft-room. The F20 guard absorbs the timer-expiry residual, so no data corruption; but no user in production would understand why the room went silent + the timer never fires. **Gate: fix + engine deploy before THE TWELVE.** |
| **Surface** | `server/src/draft/LobbyManager.ts` external-apply switch, `case 'draft_completed'` (line 2833-2835). Sibling: the bootstrap-replay switch (`applyEventDuringBootstrap`, line ~2996) needs matching consideration — the bootstrap path is post-restart replay of persisted events and generally should NOT broadcast (clients haven't connected yet), but MUST tear down / not-re-arm any timer for a completed draft. Fix scope must specify per-path semantics. |
| **Description** | F24's DB emitter fires; the internal-path receiver (submit_pick_v2 else-branch) does the right thing (broadcast + cancel + teardown); the external-path receiver (this KI) doesn't. Symptomatic on any engine that receives the completion via LISTEN/NOTIFY rather than as the writer — which will be every engine except the writer once we scale past a single node, AND on the current single-node deploy any client whose lobby was rehydrated between the pick INSERT and now. |
| **Why deferred** | Not deferred — actively gated. F24 close-out ships without this fix; F26 fix + engine deploy must land before THE TWELVE (12-human draft on staging). |
| **Target phase / timeline** | Next chunk after this one; scoped narrow. Extend the external-apply case to: (a) call the same broadcast mechanism `applyPickEvent` uses (probably `this.broadcastToRoom({type:'draft_completed', ...})` or equivalent — grep the pick path for the exact API), (b) call whatever timer-cancel primitive the internal path uses at 1826-1832, (c) initiate teardown symmetric with internal path. Update `applyEventDuringBootstrap` to match with the broadcast omitted (nobody's listening pre-connect). |
| **Verification test** | (a) Fresh 12-team snake acceptance → all 12 clients receive a `draft_completed` WS frame. Pass: 12/12; fail: any client missing the frame. (b) No F20 WARNING `'clock fired but draftStatus=completed — ignored'` post-completion — the timer must be cancelled before it fires, not absorbed after. (c) Second-engine test (deploy N=2 instances, one writer, one reader; write a completion via the writer; assert the reader-engine's clients receive the frame AND the reader-engine's timer/teardown fired). |

**Log evidence (recorded verbatim from acceptance rerun 2026-08-05):**
- `2026-08-05T18:26:07.082Z external_event.applied league=<lg> seq=13 type=draft_completed broadcasted=false`
- `2026-08-05T18:26:07.170Z` — first WS close observed (client-side timer expiry cascade begins)
- `2026-08-05T18:27:03Z RAISE WARNING clock fired but draftStatus=completed — ignored (timer should have been cancelled)` (from the F20 guard, absorbing what F26 failed to cancel)
- Zero `draft_completed` frames in the ndjson capture across all 12 client streams.

---

## How to add a row

1. Append a new `### KI-NNN` section. Use the next sequential ID across **both** registries (this one and `docs/RUNBOOKS/draft-engine-v2-known-issues.md`). Check the highest existing ID in each before assigning.
2. Fill in all seven schema columns. None may be blank.
3. Reference the KI- ID in the deferring code comment, e.g. `// TODO(KI-009): remove Edge Function infrastructure once persistent worker verified`.
4. Reference the KI- ID in the commit message that ships the deferral.
5. When resolving: append `**RESOLVED (commit-sha, date)**` plus a one-line note. Do not delete the row.
