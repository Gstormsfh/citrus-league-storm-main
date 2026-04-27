# Draft Engine v2 — Known Issues Registry

> **Purpose.** Persistent registry for every deferred issue, intentional
> shortcut, and "fix in a later phase" item. The conversation history
> is not durable; this file is.
>
> **Hard rule.** No deferral lands without a row here. If a code review
> flags something and the response is "defer to chunk N / Phase N", the
> commit that ships the deferral MUST update this file in the same
> change. A reviewer seeing a deferral comment in code without a
> corresponding KI- row should reject the change.
>
> **Lifecycle.** Rows stay even after the underlying issue is fixed.
> Append a `**RESOLVED (commit, date)**` note in place; do not delete.
> This is the audit trail for "why was this code like this in October
> when we fixed it in December."

## Schema

Each row uses these columns:

| Column | Meaning |
|---|---|
| **ID** | `KI-NNN`, monotonically assigned. Reusable as a citation key in code comments and PRs. |
| **Severity** | `low` / `medium` / `high` / `critical`. **`low` and `medium` ship in the same phase as introduced unless explicitly re-targeted in this file.** **`high` and `critical` block phase exit until resolved.** |
| **Function / file** | Where the issue lives in the code — file path + symbol or line range. |
| **Description** | What the issue is, in plain language. |
| **Why deferred** | Why we didn't fix it in the chunk that surfaced it. |
| **Target phase for resolution** | The phase / chunk that will fix it, with a reason ("observability work touches all six RAISE NOTICE sites at once"). |
| **Verification test** | The test that, when added, proves the fix landed. Even if the test is hypothetical until then, name it. |

---

## Registry

### Phase 2 closeout (2026-04-26)

Phase 2 substantively complete. All 8 Phase 2 RPCs deployed to staging
(`submit_pick_v2`, `append_draft_event`, `record_shadow_event`,
`reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`,
`validate_draft_event_payload`) plus the `tg_draft_events_project_pick`
projection trigger and the `pgmq` extension + `draft_deadlines` queue.
TypeScript surface (`DraftServiceV2`, `/api/draft/v2/league/:id/sync`,
`/pick`, `/events`) deployed to staging. Verification:

- 484/484 vitest cases pass (service unit, route HTTP, KI-001 timeout).
- 28 SQL integration scenarios pass on staging
  (`supabase/tests/draft_engine_v2_phase2_integration.sql`):
  - 5 happy path + idempotency (SC-001..SC-005)
  - 6 preflight + state machine (SC-006..SC-011)
  - 7 auth + shadow guards (SC-012..SC-018)
  - 4 lifecycle pause/resume/extend (SC-019..SC-022)
  - 6 invariants + schema + trigger + validator (SC-023..SC-028)
- Residue check after each suite run: all four counts = 0
  (proves savepoint cleanup is sound).

Deviations documented:
- **D1** — `record_shadow_event` accepts `postgres` alongside
  `service_role` (Phase 8 trigger context).
- **D2** — `submit_pick_v2` accepts `postgres` alongside
  `service_role` for `actor.kind='autopick'` (Phase 4 worker
  + emergency SQL operations).
- **D3** — Commissioners have no direct pick power in v2.0/v2.1;
  owner absences handled via pause/resume.

Open issues at end of Phase 2:
- **KI-003** open (rate limiter session-affinity gap; target Phase 7).
- **KI-001 / KI-002** RESOLVED in chunks 9c / 9d.

Phase 3 begins next: pgmq scheduler RPC (`draft_deadline_sweep`),
pg_cron sub-minute schedule, worker scaffold (Edge Function stub).

### Phase 3 closeout (2026-04-27)

> ⚠️ **CURRENTLY PAUSED ON STAGING.** Both Phase 3 cron jobs —
> `draft-deadline-sweep` and `draft-autopick-keepalive` — are
> deliberately paused (`active = false` in `cron.job`) and **must
> remain paused until Phase 4 completes.** The Phase 3 worker is
> archive-only; if the keep-alive fires against real
> `submit_pick_v2`-enqueued messages, picks would be silently
> dropped. "Phase 3 done" ≠ "Phase 3 enabled." See the operations
> runbook section "Phase 4 prerequisites (must land before
> unpausing Phase 3 crons)" for the gating list.

Phase 3 substantively complete. All Phase 3 surfaces deployed to
staging:

- **Schema (chunk 10a):** `draft_metrics` (partitioned monthly,
  Apr–Jul 2026 initial partitions), `draft_metrics_daily` (rollup),
  `autopick_failures` (DLQ), and `manage_draft_metrics_partitions()`
  with monthly pg_cron schedule.
- **Sweep RPC (chunk 10b):** `draft_deadline_sweep()` — race-free
  `draft_events` predicate, `pg_try_advisory_xact_lock`-guarded,
  per-league `safety_net_hit` writes per locked Q3.
- **Edge Function scaffold (chunk 10c):** `supabase/functions/
  draft-autopick/index.ts` (≤140s loop, 30s idle exit, archive-only,
  timing-safe bearer compare) + pgmq wrappers
  (`draft_autopick_read`, `draft_autopick_archive`) + shared
  service-role client factory.
- **Cron + Vault (chunk 10d):** `draft-deadline-sweep` (every 10s)
  and `draft-autopick-keepalive` (every 2 min). Vault secret
  `draft-autopick-token` provisioning recipe in operations runbook.
- **Integration scenarios (chunk 10e):** 12 SC-3xx scenarios
  (`supabase/tests/draft_engine_v2_phase3_integration.sql`) all
  passing on staging — predicate correctness, 2s back-buffer
  boundary, advisory-lock reentry, pgmq wrapper roundtrip, partition
  manager idempotence, plus the load-bearing SC-301
  BEGIN/ROLLBACK harness verification.

Verification:
- 12/12 SC-3xx scenarios pass on staging.
- `draft_deadline_sweep()` smoke test from SQL Editor returns 0 with
  zero residue (no pgmq messages, no `safety_net_hit` rows).
- Edge Function `auth_failed` 401 path confirmed via wrong-bearer
  curl test.
- Cron jobs registered in `cron.job` with correct schedules; both
  paused immediately after apply per spec ("Phase 3 done and
  currently disabled until Phase 4").

Deviations documented:
- **D4** — `draft_metrics` PK includes synthetic `id` column
  (operations runbook).

Open issues at end of Phase 3:
- **KI-003** still open (Phase 2 carryover; target Phase 7 load
  testing).
- **KI-004** open — Phase 3 keep-alive cron's `net.http_post` URL
  is hardcoded to staging project ref `jjgspcpvqaiitloglxbb`.
  Target: Phase 8a prod cutover (re-parameterize via Vault).
- KI-001 / KI-002 RESOLVED in Phase 2.

Phase 4 begins next: real autopick state machine in
`draft-autopick/index.ts` (read pgmq → `submit_pick_v2(actor.kind=
'autopick')` → archive on success), 3-strikes-and-DLQ pattern via
`autopick_failures` insert, player-selection logic (queue lookup
with FPTS+positional-need fallback), Phase 4 integration scenarios.

---

### KI-001 — `DraftServiceV2.broadcastEvent` can hang on non-SUBSCRIBED channel status

**RESOLVED** (commit landing this chunk; 2026-04-25). Fix shipped in
chunk 9c: `BROADCAST_TIMEOUT_MS = 5000` constant, channel.subscribe
result raced against a `setTimeout`, terminal statuses
(`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) all resolve
the outer Promise. Send happens only on `SUBSCRIBED`; any other
terminal or the timeout logs `broadcast_channel_failed` and skips
send. Cleanup (`removeChannel`) always runs. Test coverage:
`DraftServiceV2.test.ts` cases `KI-001: resolves within ~5s when
channel never reaches SUBSCRIBED`, `terminal CHANNEL_ERROR …`,
`terminal CLOSED …`. Real-Realtime verification still rides on
Phase 7 chaos testing as documented in this row's verification
field below — the mocked tests prove the timeout race is wired
correctly, not that the production Realtime client behaves as
modeled.

| | |
|---|---|
| **Severity** | medium |
| **Function / file** | `server/src/services/DraftServiceV2.ts`, `broadcastEvent` (the `channel.subscribe` Promise wrapper). |
| **Description** | The Promise wrapping `channel.subscribe` only resolves when `status === 'SUBSCRIBED'` fires. Other statuses (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) cause the inner callback to short-circuit with a bare `return`, leaving the outer Promise unresolved indefinitely. The route handler awaits forever. The same flaw exists in v1's `broadcastDraftPick` (`server/src/routes/draft.ts:37-49`), so this is not a v2 regression — but it should not ship as a v2 feature. |
| **Why deferred** | Flag surfaced during chunk 7 review. Fix is straightforward (Promise.race against a 5s timeout, or handle all `RealtimeChannelStatus` enum values explicitly), but the broader observability + structured-logging work in chunk 9 is the natural place to do it alongside RAISE NOTICE cleanup, and pulling the fix forward would have delayed chunk 8 (routes) for no scheduling benefit. |
| **Target phase for resolution** | **Phase 2 chunk 9** (observability). Pair with KI-002 in the same commit. |
| **Verification test** | `DraftServiceV2.test.ts > broadcastEvent > KI-001: resolves within ~5s when channel never reaches SUBSCRIBED`. Mocked channel that never emits a terminal status; vi fake timers advanced past the 5s timeout; assert send was NOT called and removeChannel WAS called. Plus two complementary tests for terminal `CHANNEL_ERROR` and `CLOSED` statuses. **Real-Realtime verification remains a Phase 7 chaos-test responsibility** — the mocks prove the wiring is correct, not that production Realtime emits these statuses on real network failures. |

### KI-002 — `RAISE NOTICE` noise in 6 v2 RPCs

**RESOLVED** (commit landing this chunk; 2026-04-25). Fix shipped in
chunk 9d: all 6 `RAISE NOTICE` lines removed from
`supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`. Each
removal site carries a `KI-002 RESOLVED` placeholder comment so the
audit trail is visible in-place. Proper structured emission into
`draft_metrics` is deliberately deferred to Phase 6 when that table
+ the metric pipeline land per spec §11.2 — the current Phase 2
RPCs are silent on success, error paths still raise. No replacement
wire-up needed for chunk 9d.

| | |
|---|---|
| **Severity** | low |
| **Function / file** | `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`, all of: `append_draft_event`, `record_shadow_event`, `submit_pick_v2`, `draft_pause`, `draft_resume`, `draft_extend`. |
| **Description** | Each RPC ends with a `RAISE NOTICE 'function_name committed: ...'` line for development debugging. In production, every commit produces a NOTICE log line (4 per pick at peak — submit_pick_v2 + the projection trigger fires + sometimes downstream events). The volume drowns out signal logs and increases Supabase log ingestion cost. |
| **Why deferred** | Replacing 6 sites with proper structured logging belongs in the observability work scheduled for chunk 9, where the broader `pick_committed`, `autopick_fired`, `safety_net_hit` etc. metric pipeline lands (spec §11.2). Removing them piecemeal before that work is wasted churn. |
| **Target phase for resolution** | **Phase 2 chunk 9** (observability). Either remove entirely or convert to structured `pg_logical_emit_message` / `INSERT INTO draft_metrics` per spec §11.1. |
| **Verification test** | After chunk 9d lands, `grep -c 'RAISE NOTICE' supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql` must return zero matches outside header comments. **Before** chunk 9d: 6 NOTICE sites in function bodies. **After:** zero in function bodies; six placeholder comments naming KI-002. The full structured-logging verification (NOTICE volume during a real pick path) re-targets to Phase 6 when `draft_metrics` lands. |

### KI-003 — `/events` in-memory rate limiter is per-instance, not per-deployment

| | |
|---|---|
| **Severity** | medium |
| **Function / file** | `server/src/routes/draftV2Events.ts`, the `rateLimitCheck` function and its module-scoped `buckets: Map`. |
| **Description** | The rate limiter state lives in a `Map` inside the Cloud Run instance's process memory. With Cloud Run configured for `maxScale=10` (`ops/cloudrun/service.yaml`), a single misbehaving client whose requests round-robin across instances can make **up to 100 requests per 30s** (10 documented limit × 10 instances) instead of the documented 10. Spec §7.4 hand-waves "per-process is fine: a misbehaving client is pinned to one Cloud Run instance via session affinity" — but session affinity is not currently verified to be configured, and even if it is, it can be lost across deploys, instance recycles, or LB reconfiguration. **Not a security issue** — `/events` is read-only, the membership middleware still gates league access, and the realistic blast radius is "noisy DB query load." But the limit doesn't actually limit at the documented rate. |
| **Why deferred** | Two viable fixes, both larger than a chunk-9 cleanup: **(a)** verify Cloud Run session affinity is configured AND holds across deploys (operational change + monitoring); **(b)** move rate-limiter state to a shared store (Redis, Postgres). Either warrants its own design decision and review, not a wedge fix. |
| **Target phase for resolution** | **Phase 7** at the latest (load testing — that's when actual rate-limit behavior gets measured). Could land earlier if a separate decision on shared rate-limit infrastructure (Redis vs. Postgres-backed bucket) is made independently. |
| **Verification test** | Spin up ≥2 Cloud Run instances on staging. From a single client, hammer `/api/draft/v2/league/$ID/events` at 30 req/s for 60s. Count actual responses by status code. **Pass** = (200 count + 429 count) corresponds to the documented 10/30s rate (so 10 successes per 30s window, all others 429). **Fail** = success count exceeds 10/30s by more than the documented limit × instance count. Alternative if shared store lands first: integration test against a multi-instance simulated dispatch confirming the rate limit holds. |

### KI-004 — Phase 3 keep-alive cron's `net.http_post` URL is hardcoded to staging

| | |
|---|---|
| **Severity** | medium |
| **Function / file** | `supabase/migrations/20260426150000_draft_engine_v2_phase3_cron_vault.sql`, the `draft-autopick-keepalive` cron command body (search-string `STAGING_PROJECT_REF`). |
| **Description** | The cron's `net.http_post(url := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick', ...)` call has the staging Supabase project ref baked in as a string literal. There is no environment variable available at SQL apply time, and pg_cron stores the literal command text in `cron.job.command`. The same migration file applied verbatim to a prod project would still POST to staging — which means prod's safety-net deadlines would never reach a prod worker. |
| **Why deferred** | Phase 3 is staging-only by spec (Phase 8a is the prod cutover). Parameterizing the URL via Vault now would require a second Vault secret (`draft_autopick_worker_url` or similar), additional provisioning steps in the operations runbook, and a `COALESCE`-based fallback for the case where the URL secret is missing — all overhead for a problem that does not yet exist. The simpler fix is to ship a prod-flavored cutover migration in Phase 8a that reads URL from Vault from day one, alongside the existing `draft-autopick-token` provisioning. |
| **Target phase for resolution** | **Phase 8a** (prod cutover). The prod cutover migration replaces the literal URL with `'https://' \|\| vault.read_secret('draft_autopick_worker_url') \|\| '/functions/v1/draft-autopick'` (or equivalent). Same Vault provisioning recipe as `draft-autopick-token`; same rotation procedure. The runbook's "STAGING_PROJECT_REF" marker comment in the chunk 10d migration flags the line that must change. |
| **Verification test** | After the Phase 8a cutover migration applies on prod: `SELECT count(*) FROM cron.job WHERE jobname = 'draft-autopick-keepalive' AND command LIKE '%jjgspcpvqaiitloglxbb%';` must return **0** (no staging ref leaked into prod). Plus the positive assertion `SELECT count(*) FROM cron.job WHERE jobname = 'draft-autopick-keepalive' AND command LIKE '%vault.read_secret%';` must return **1** (URL is Vault-resolved). Both assertions fail-loud during the cutover smoke test. |

### KI-005 — `draft_autopick_dlq` paging trigger not wired

| | |
|---|---|
| **Severity** | medium |
| **Function / file** | `supabase/migrations/20260427130000_draft_engine_v2_phase4_autopick_dlq.sql`, the `draft_autopick_dlq` RPC. Also: `autopick_failures` table (chunk 10a) has no AFTER INSERT trigger. |
| **Description** | When the Phase 4 worker reaches `msg.read_ct >= 3` on a pgmq message, it calls `draft_autopick_dlq(...)` which atomically inserts a row into `autopick_failures` and emits an `autopick_failed` event. The Phase 3 plan and operations runbook call for an AFTER INSERT trigger on `autopick_failures` that pages on-call. **No such trigger exists in this codebase yet** — the `alerts` pattern referenced in earlier planning was never instantiated. So Phase 4 ships with **silent DLQ inserts**: operators must actively poll `autopick_failures` during incidents instead of being paged. The blast radius is "incident triage takes longer because nobody is woken up by a stuck autopick" — not a correctness issue, but a meaningful operational gap. |
| **Why deferred** | A paging trigger requires a destination — Discord webhook, PagerDuty, Slack, etc. The project has the `DEADMAN_WEBHOOK_URL` pattern from `pipeline-deadman` but no general DB-side alerting surface. Wiring this requires a separate design pass (which webhook? what payload shape? rate-limit window?), best done alongside the Phase 8a prod cutover when alerting infrastructure is being defined for prod end-to-end. Wedging it in for staging-only Phase 4 produces throwaway scaffolding. |
| **Target phase for resolution** | **Phase 8a** (prod cutover). The trigger must (a) fire AFTER INSERT on `autopick_failures`, (b) emit a webhook POST whose body includes `league_id`, `pick_number` (extracted via `payload->>'pick_number'`), `generation` (extracted via `payload->>'generation'`), `last_error`, `read_ct`, and a link/reference to the corresponding `autopick_failed` event in `draft_events` (joinable by `(league_id, pgmq_msg_id)`), and (c) rate-limit to **at most one page per league per 24h** to avoid a multi-pick failure storming on-call. |
| **Verification test** | After the Phase 8a paging trigger lands on prod: synthetic-call `draft_autopick_dlq(...)` from the Supabase Dashboard SQL Editor with a fake `pgmq_msg_id` and verify the on-call channel receives a page within 30 seconds containing the expected fields. Then a second call with a different `pgmq_msg_id` for the **same** `league_id` within the 24h window must NOT page (rate-limit). Then a call for a **different** `league_id` in the same window MUST page (per-league scope). |

### KI-006 — Worker player-select heuristic does O(N×M) candidate scan per autopick

| | |
|---|---|
| **Severity** | low |
| **Function / file** | `supabase/functions/draft-autopick/index.ts`, the heuristic-fallback branch of `processMessage` (the `player_directory` + `player_season_stats!inner` query around the "6b: heuristic fallback" block). |
| **Description** | When the on-the-clock team has no `draft_queues` row (or every queued player is already drafted), the worker fetches every active NHL player + season stats for the current season via a single PostgREST `!inner` join, filters to undrafted in-process, scores all of them via `selectByHeuristic`. Per-autopick cost: O(M) bytes pulled (M ≈ 1500 active NHL players × ~14 stat columns) + O(M) FPTS calculations. Across an unattended draft of N picks (180 for a 12×15 league), worst case is N × M = 270,000 stat-row reads + 270,000 FPTS calculations. Each pick is also doing a `draft_picks_v2` read to build `draftedSet` (O(picks_so_far)). At staging scale (no concurrent drafts, single worker invocation per ~2 min keep-alive) this is unmeasurable. At production scale with multiple concurrent drafts hitting their deadlines simultaneously, the worker could become latency-bound and miss deadlines. |
| **Why deferred** | Premature optimization without measurement. The right intervention (precomputed undrafted-candidates view? per-league cache in the worker? heuristic in SQL?) depends on what the actual hotspot turns out to be — query latency, JSON parsing, FPTS math, or PostgREST overhead. Phase 7 load testing is when we'll have the data to choose. |
| **Target phase for resolution** | **Phase 7** (load testing). Latency benchmark in the chaos suite must verify: with 1500 active players, 200 picks already taken in the league, and 5 concurrent autopick worker invocations against different leagues, the per-autopick latency stays under **5 seconds** end-to-end (queue-read → submit_pick_v2 success). If it doesn't, the optimization choice is informed by the load profile, not guessed. |
| **Verification test** | Phase 7 chaos suite, scenario name TBD (suggested: `chaos-08-autopick-latency-soak`). Setup: seed a 12-team league, pre-populate 200 draft_picks_v2 rows, set `pick_deadline` 5s past, invoke the worker 5 times concurrently against 5 different leagues, measure end-to-end latency from invocation start to `autopick_fired` metric write. **Pass:** all 5 worker invocations report autopick latency p95 < 5000ms. **Fail:** any p95 > 5000ms triggers a follow-up design sprint to pick the optimization vector. |

---

## How to add a row

When a code review surfaces a deferral, before the commit lands:

1. Append a new `### KI-NNN` section (next sequential ID).
2. Fill in all seven schema columns. None may be blank.
3. Reference the KI- ID in the deferring code comment, e.g.
   `// TODO(KI-001): wrap subscribe in Promise.race timeout`.
4. Reference the KI- ID in the commit message that ships the deferral.
5. Update the resolving commit's message with the KI- ID being closed,
   and update the row in this file with `**RESOLVED (commit-sha, date)**`
   plus a one-line note.
