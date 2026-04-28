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

### KI-008 — Phase 0–4 architecture insufficient for Yahoo/ESPN-grade live draft

| | |
|---|---|
| **Severity** | high — blocks Phase 5 (UI) until resolved by Phase 4.5. |
| **Surface** | The draft hot path. Spans `supabase/functions/draft-autopick/` (now demoted to fallback), `supabase/migrations/2026042*/`, `server/src/services/DraftServiceV2.ts`, the pgmq scheduler, and (post-resolution) the new persistent Node draft worker on Cloud Run. |
| **Description** | Phase 0–4 used Supabase Edge Functions as the autopick host. This was the wrong runtime model for live multiplayer state. Edge Functions are ephemeral stateless invocations; live drafts demand persistent stateful processes. Phase 4 verification on staging measured autopick latency at **~11.7 seconds per pick** — an order of magnitude over the Performance Mandate's p95 ≤ 1000ms target (`CLAUDE.md` § Citrus Draft Performance Mandate). Causes are structural: pg_cron's 2-minute minimum keep-alive cadence introduces tail latency, the Edge Function cold-starts between invocations (no per-draft persistent state), the candidate pool is re-fetched from Postgres every pick, broadcast fanout via Supabase Realtime hits rate limits at modest connection counts. No combination of optimizations within the Edge Function architecture closes the gap to Yahoo/ESPN/Sleeper. World-class real-time platforms (Discord, Sleeper, Figma, Yahoo, ESPN) all use persistent stateful server processes for the live experience layer. |
| **Why deferred** | Not a deferral — the architectural pivot itself. Phase 0–4 shipped correctness with the explicit understanding that performance was a "Phase 7 optimization." The Performance Mandate (added 2026-04-27) reframes performance as a foundational constraint, retroactively making the Phase 0–4 runtime choice insufficient. The Phase 0–4 primitives (event log, idempotency, projection trigger, pgmq sweep) are **kept** as the durability and disaster-recovery layer; only the hot-path host changes. |
| **Target phase / timeline** | **Phase 4.5** (`docs/PHASE_4_5_PLAN.md`). Persistent Node service on Cloud Run, alongside the existing Node server. Chunks 11g.1 through 11g.9 cover skeleton, WebSocket layer, DraftRoom in-memory state, pick submission flow, reconnection/resume, autopick + timer, crash recovery, integration with the pgmq fallback, and performance verification against the Mandate. Phase 5 UI work blocks until 11g.9 sign-off. |
| **Verification test** | Performance instrumentation harness from chunk 11g.9. Seed concurrent drafts on the deployed Cloud Run worker, drive picks at the deadline boundary, measure end-to-end (`deadline_expiry → submit_pick_v2 commit → all connected clients have updated UI`). **Pass:** every Performance Mandate target met (manual pick p95 ≤ 300ms, autopick p95 ≤ 1000ms, broadcast fanout p95 ≤ 200ms, draft state load p95 ≤ 1500ms, reconnection p95 ≤ 2000ms). **Fail:** any target missed by more than 10% triggers a design revisit before Phase 5 starts. The benchmark suite re-runs at each chunk gate so regressions are caught early. |

### KI-009 — Edge Functions retained as cron-driven disaster-recovery safety net

| | |
|---|---|
| **Severity** | medium — accepted operational shape; must be tracked so the fallback role is preserved correctly. |
| **Surface** | `supabase/functions/draft-autopick/` (Deno runtime), `supabase/functions/_shared/` (vendored shared code from KI-007), the pgmq sweep + keep-alive cron in `supabase/migrations/20260426150000_..._cron_vault.sql`, the `autopick_failures` DLQ. |
| **Description** | Phase 4.5 makes the persistent Node worker on Cloud Run the **primary** autopick path. The Deno-runtime Edge Function in `supabase/functions/draft-autopick/` is **not removed**. It stays deployed and on-cron as the disaster-recovery safety net: if the persistent worker is unavailable (deploy in flight, crash, network partition between Cloud Run and Postgres), the existing pg_cron sweep catches expired deadlines, the Edge Function autopicks, and `submit_pick_v2` commits. Slowly but correctly. The architectural change is which path is primary; the safety net stays. The vendored shared code in `supabase/functions/_shared/_vendored/` (KI-007) stays in place but its scope is now narrower — only the Edge Function fallback path consumes it. The persistent Node worker imports `@citrus/shared` natively (it's the same Node ecosystem as the main server), no vendoring needed. |
| **Why deferred** | Not a deferral — a deliberate operational choice. Removing the safety net would mean the persistent worker is the only autopick path, and a worker outage during a draft would silently miss deadlines. Keeping the cron-driven path costs almost nothing at idle (the worker drains the queue first; the cron sweep finds nothing to do under normal operation) and provides a meaningful reliability guarantee. Trade-off is transparent: a small ongoing maintenance surface (the Deno code stays; vendored shared code KI-007 stays narrower-scoped) in exchange for a real disaster-recovery story. |
| **Target phase / timeline** | **Ongoing.** Chunk 11g.8 wires the integration explicitly (the persistent worker takes precedence; the cron path stays as fallback). Phase 4.6 — when it lands — will polish the runbook for "what to do when the persistent worker is down." Re-evaluate end of 2026: if the persistent worker proves reliable enough that the safety net never fires, simplification could be considered, but the default is to keep it. |
| **Verification test** | Disaster-recovery drill, run after chunks 11g.7 + 11g.8 land: deliberately stop the Cloud Run worker mid-draft, verify the pg_cron sweep catches the next expired deadline within ~10s, the Edge Function fires, `submit_pick_v2` commits, the pick lands in `draft_events` and `draft_picks_v2`. Restart the worker; verify it loads state including the picks committed during its outage and resumes cleanly with no duplicate picks. **Pass:** end-to-end picks land during the outage window; no double-picks on recovery. **Fail:** any picks lost during the outage, or any duplicate picks on recovery. |

### KI-010 — Tier 1 performance optimizations baked into Phase 4.5 design from the start

| | |
|---|---|
| **Severity** | medium — design-time constraint, not a deferred fix. |
| **Surface** | The persistent Node worker's `DraftRoom` class and surrounding infrastructure (chunks 11g.3 onward in `docs/PHASE_4_5_PLAN.md`). |
| **Description** | Phase 4 left the Edge Function autopick path with several known performance liabilities that were intentionally deferred to "later optimization" — KI-006 (O(N×M) candidate scan per autopick), broadcast fanout limits, redundant per-pick Postgres reads. The Phase 4.5 plan does NOT defer those again. **Tier 1 perf optimizations are baked into the persistent worker's design from chunk 11g.3 onward**: parallel async on independent state reads (load player_directory + player_season_stats + draft_picks_v2 in parallel, not serially); byte-limited deltas on broadcast (don't ship the entire draft state on every event, ship the diff); fanout protection (per-room rate limiting on broadcasts to prevent runaway loops); candidate caching (the candidate pool lives in memory in the `DraftRoom`, refreshed on pick events, not re-fetched per autopick decision). An indexing audit was completed against the existing Postgres schema; existing indexes are reasonable and not the bottleneck. The bottleneck was the runtime model. |
| **Why deferred** | Not deferred — proactively planned. The risk this KI exists to track is that under chunk-by-chunk pressure the optimizations get cut for "we'll do it in Phase 7" reasons. This row is a binding reminder: that pattern produced KI-008 in the first place. The Performance Mandate forbids "optimize later" framings (`CLAUDE.md` § Citrus Draft Performance Mandate, "Non-negotiables"). |
| **Target phase / timeline** | **Built into Phase 4.5 chunks 11g.3 through 11g.9.** Each chunk's acceptance criteria reference the relevant Mandate target. Chunk 11g.9 explicitly verifies the suite end-to-end. No carry-forward to Phase 7 — if these aren't in by Phase 4.5 sign-off, Phase 5 doesn't start. |
| **Verification test** | The Mandate's full target set, measured at chunk 11g.9: manual pick p95 ≤ 300ms, autopick p95 ≤ 1000ms, broadcast fanout p95 ≤ 200ms, draft state load p95 ≤ 1500ms, reconnection p95 ≤ 2000ms, timer drift < 100ms. Each Tier 1 optimization gets called out by name in the chunk that introduces it (parallel async in 11g.3, candidate caching in 11g.3, byte-limited deltas in 11g.4, fanout protection in 11g.4) so a code reviewer can grep for the design-decision comments. |

---

## How to add a row

1. Append a new `### KI-NNN` section. Use the next sequential ID across **both** registries (this one and `docs/RUNBOOKS/draft-engine-v2-known-issues.md`). Check the highest existing ID in each before assigning.
2. Fill in all seven schema columns. None may be blank.
3. Reference the KI- ID in the deferring code comment, e.g. `// TODO(KI-008): swap to Elixir engine`.
4. Reference the KI- ID in the commit message that ships the deferral.
5. When resolving: append `**RESOLVED (commit-sha, date)**` plus a one-line note. Do not delete the row.
