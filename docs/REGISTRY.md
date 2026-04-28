# Citrus — Project Registry

> **Purpose.** Top-level project registry for cross-cutting known issues
> and deferred decisions. The conversation history is not durable; this
> file is.
>
> **Scope.** Project-wide concerns that span multiple subsystems
> (draft engine + main app, Node.js + Elixir, ops + product). Issues
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
| **Severity** | high — blocks Phase 5 (UI) until resolved by Phase 4.5 chunk 11g.9. |
| **Surface** | The draft hot path. Spans `server/src/services/DraftServiceV2.ts`, the new in-server `DraftRoom` + WebSocket code (Phase 4.5+), and (until removed) `supabase/functions/draft-autopick/` plus the pgmq scheduler. |
| **Description** | Phase 0–4 used Supabase Edge Functions as the autopick host. Phase 4 verification on staging measured autopick latency at **~11.7s/pick** — an order of magnitude over the Performance Mandate's p95 ≤ 1000ms target (`CLAUDE.md` § Citrus Draft Performance Mandate). Causes are structural to the runtime model: ephemeral stateless invocations, pg_cron 2-minute keep-alive cadence, no per-draft persistent state, candidate pool re-fetched every pick, broadcast fanout via third-party Realtime with rate limits. **Edge Functions are the wrong runtime model for live multiplayer state.** Phase 4.5 moves the live engine to **persistent Node code in the existing server** (one `DraftRoom` per active draft, WebSocket transport, in-process autopick scheduler). Phase 0–4 durability primitives (event log, idempotency, projection trigger, RPCs) stay unchanged — the engine is a new caller of the existing surface, not a replacement. ADR-001 documents the architectural decision. |
| **Why deferred** | Not a deferral — the architectural pivot itself. Phase 0–4 shipped correctness with performance knowingly punted to "Phase 7 optimization." The Performance Mandate (2026-04-27) reframed performance as a foundational constraint, retroactively making the runtime choice unacceptable. The 11.7s number was the trigger; the structural causes made the pivot non-negotiable. |
| **Target phase / timeline** | **Phase 4.5 (chunks 11g.0–11g.9, `docs/PHASE_4_5_PLAN.md`).** Chunk 11g.0 verifies dependency compatibility. Chunks 11g.1–11g.7 build the in-server engine end-to-end. Chunk 11g.8 removes the Edge Function infrastructure entirely (KI-009). Chunk 11g.9 verifies all Mandate targets on the deployed server. Phase 5 (UI) unblocks at 11g.9 sign-off. |
| **Verification test** | The chunk 11g.9 performance harness on the deployed Cloud Run server. Seed concurrent drafts, drive picks at the deadline boundary, measure end-to-end (`deadline_expiry → submit_pick_v2 commit → all clients have updated UI`). **Pass:** every Mandate target met (manual pick p95 ≤ 300ms / p99 ≤ 500ms; autopick p95 ≤ 1000ms / p99 ≤ 2000ms; broadcast fanout p95 ≤ 200ms; draft state load p95 ≤ 1500ms; reconnection p95 ≤ 2000ms; timer drift < 100ms). **Fail:** any target missed by more than 10% triggers a design revisit before Phase 5 starts. The benchmark suite re-runs at every chunk gate so regressions are caught early. |

### KI-009 — Edge Function infrastructure removed entirely; engine in existing server

| | |
|---|---|
| **Severity** | medium — accepted operational shape; must be tracked so the simplification rationale is preserved across future scale conversations. |
| **Surface** | `supabase/functions/draft-autopick/`, `supabase/functions/_shared/_vendored/`, the pg_cron jobs (`draft-deadline-sweep`, `draft-autopick-keepalive`), the pgmq queue (`draft_deadlines`) and its archive table, the Vault secret + keep-alive token plumbing, the cross-runtime hash-agreement infrastructure. All deleted in chunk 11g.8. |
| **Description** | **Edge Function infrastructure removed entirely (not retained as safety net) and draft engine integrated into existing Node server (not separate service) per CTO ethos of operational simplicity.** Recovery via event log replay on Cloud Run restart is sufficient. **If future scale demands service separation, splitting out the draft engine is a refactor, not a rewrite — Phase 0–4 primitives don't change.** The integration boundary (existing Postgres RPC surface + WebSocket message protocol) is stable across that hypothetical pivot; only the deployment unit changes. The simplest thing that works wins now; complexity gets added back if and only if measured scale demands it. |
| **Why deferred** | Not a deferral — a deliberate simplification. Keeping the safety net would mean maintaining the pgmq queue, pg_cron jobs, vendored shared code (KI-007), Vault wiring, and the Deno worker for a path that almost never fires once the in-server engine carries the hot path. Cloud Run restart latency is on the order of seconds; the WebSocket reconnect protocol covers the gap. Keeping the engine in the existing server (vs. a separate Cloud Run service) means one deployment unit, one observability surface, one CI pipeline — and a refactor-not-rewrite path forward if scale ever justifies separation. |
| **Target phase / timeline** | **Phase 4.5 chunk 11g.8.** That chunk explicitly verifies nothing else in the codebase depends on the Edge Function surfaces, then deletes them in one commit. The "engine inside existing server" choice is locked in by chunks 11g.1 (WebSocket layer added to existing Hono server) and chunks 11g.2–11g.7 (everything builds inside `server/`). Re-evaluate end of 2026 if v1 scale exposes any limitation; the refactor-to-separate-service path is documented as the response. |
| **Verification test** | (a) Chunk 11g.8 commit's `git grep` audit shows zero remaining references to deleted Edge Function surfaces. (b) Chunk 11g.6 crash-recovery test: kill the Cloud Run server mid-draft (5 picks committed, clients connected); restart; verify all active drafts reload state from `draft_events`, timers resume, clients reconnect via the chunk 11g.4 protocol, **no picks lost, no duplicates**. (c) End-of-2026 ops review: total time spent on Edge-Function-related issues since chunk 11g.8 deploy. **Pass:** zero, because they don't exist anymore. |

### KI-010 — Tier 1 perf optimizations baked into Phase 4.5 design from the start

| | |
|---|---|
| **Severity** | medium — design-time constraint, not a deferred fix. |
| **Surface** | The in-server engine's `DraftRoom` class and surrounding infrastructure (chunk 11g.7 in `docs/PHASE_4_5_PLAN.md`). |
| **Description** | Phase 4 left the Edge Function path with several known performance liabilities that were intentionally deferred to "later optimization" — KI-006 (per-pick candidate scan), broadcast fanout limits, redundant per-pick Postgres reads. The Phase 4.5 plan does NOT defer those again. **Tier 1 perf optimizations are baked into the in-server engine's design from chunk 11g.7**: parallel async on independent state reads (`Promise.all` on `player_directory` + `player_season_stats` + `draft_picks_v2` at draft start, not sequentially); candidate pool cached in `DraftRoom._candidates` for the lifetime of the draft, updated in place on pick events (no per-pick re-fetch — KI-006 resolution path); byte-limited delta broadcasts (don't ship full state every event, ship the diff with a documented size budget); per-room fanout protection (token-bucket on broadcast emissions to prevent runaway loops or hostile clients from starving other rooms on the same instance). |
| **Why deferred** | Not deferred — proactively planned. The risk this KI exists to track is that under chunk-by-chunk pressure the optimizations get cut for "we'll do it later" reasons. That deferral pattern produced the 11.7s problem in the first place. The Performance Mandate forbids "optimize later" framings (`CLAUDE.md` § Citrus Draft Performance Mandate, "Non-negotiables"). |
| **Target phase / timeline** | **Built into Phase 4.5 chunks 11g.2 through 11g.7.** Each chunk's acceptance criteria reference the relevant Mandate target. Chunk 11g.7 explicitly introduces the four Tier 1 optimizations as design-decision comments in the code so a reviewer can grep for them. Chunk 11g.9 verifies them end-to-end. No carry-forward to Phase 7 — if these aren't in by Phase 4.5 sign-off, Phase 5 doesn't start. |
| **Verification test** | The Mandate's full target set, measured at chunk 11g.9: manual pick p95 ≤ 300ms, autopick p95 ≤ 1000ms, broadcast fanout p95 ≤ 200ms, draft state load p95 ≤ 1500ms, reconnection p95 ≤ 2000ms, timer drift < 100ms. Each Tier 1 optimization called out by name in code comments in chunk 11g.7 so a code reviewer can grep. **KI-006** (per-pick candidate scan latency) flips to **RESOLVED** at chunk 11g.9 if the latency harness confirms the in-memory cache eliminates the original cost. |

---

## How to add a row

1. Append a new `### KI-NNN` section. Use the next sequential ID across **both** registries (this one and `docs/RUNBOOKS/draft-engine-v2-known-issues.md`). Check the highest existing ID in each before assigning.
2. Fill in all seven schema columns. None may be blank.
3. Reference the KI- ID in the deferring code comment, e.g. `// TODO(KI-008): swap to Elixir engine`.
4. Reference the KI- ID in the commit message that ships the deferral.
5. When resolving: append `**RESOLVED (commit-sha, date)**` plus a one-line note. Do not delete the row.
