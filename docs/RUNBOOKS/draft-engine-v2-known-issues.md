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

**SUPERSEDED by ADR-001 / KI-009 (2026-04-28). Closure shipped (chunk 11g.9 commit, 2026-05-12).** The Edge Function infrastructure — including the `draft-autopick-keepalive` cron and the staging-URL issue this row tracks — was removed entirely in chunk 11g.9 (migration `supabase/migrations/20260512000000_remove_pgmq_infrastructure.sql`). The cron job no longer exists; no prod cutover migration is needed to parameterize its URL because the cron no longer fires. Verification post-migration: `SELECT count(*) FROM cron.job WHERE jobname = 'draft-autopick-keepalive'` returns 0.

---

### KI-007 — Vendored `@citrus/shared` code at `supabase/functions/_shared/_vendored/`

| | |
|---|---|
| **Severity** | medium (at deferral time); now scheduled for resolution. |
| **Function / file** | `supabase/functions/_shared/_vendored/scoring.ts`, `payload-hash.ts`, `season.ts`, `query-columns.ts`. The Phase 4 Edge Function `draft-autopick` consumes these copies because the Supabase bundler couldn't resolve workspace-level imports of `@citrus/shared` from the Deno runtime on Windows dev boxes. |
| **Description** | Drift risk: the canonical `@citrus/shared` source and the vendored copies must stay byte-for-byte identical for cross-runtime hash agreement (UUIDv5 idempotency keys, `computePickPayloadHash`, scoring weights). A drift between Node and Deno means autopicks and manual picks compute different idempotency keys for the same logical pick — silent double-picks under contention. The Phase 4 commit added a `KI-007 RESOLVED` placeholder comment at every vendored file plus a structural validator on `ScoringCalculator` so a malformed scoring config crashes loud rather than silently producing zeros. |
| **Why deferred** | Phase 4 needed the autopick path on staging before Phase 4.5 design closure. Vendoring was the lowest-friction path; resolving the bundler issue properly would have blocked the chunk. The drift risk was acceptable at Phase 4 scope because the cross-runtime parity test suite catches divergence before deploy. |
| **Target phase for resolution** | **Phase 4.5 chunk 11g.9** (per ADR-001 / KI-009). The Edge Function infrastructure is removed entirely; the vendored copies, the cross-runtime hash-agreement test infrastructure, and the SQL `_v2_test._uuidv5` parity helper all get deleted alongside the autopick worker. The persistent Node engine in the existing server imports `@citrus/shared` natively — no vendoring needed. |
| **Verification test** | After chunk 11g.9 lands (completion target: Phase 4.5 sign-off): `git ls-files supabase/functions/_shared/_vendored/` must return **0 files** (directory deleted). Plus `git grep -n "_vendored"` returns no references in shipped code. Plus the test suite's UUIDv5 cross-runtime parity test (which compared TS vs SQL vs Deno) is removed cleanly because there's no second runtime to compare against. |

**RESOLVED (chunk 11g.9 commit, 2026-05-12).** The Edge Function infrastructure was removed entirely (`supabase/migrations/20260512000000_remove_pgmq_infrastructure.sql` + `supabase/functions/draft-autopick/index.ts` deletion). Per 2026-05-12 recon, `supabase/functions/_shared/_vendored/` was already absent from this codebase version (no action needed), and the SQL `_v2_test._uuidv5` cross-runtime parity helper was likewise already removed. The drift risk this KI tracked no longer exists: there is no second runtime, so there is nothing to drift against. The persistent in-server engine imports `@citrus/shared` natively.

---

---

## Persistent-engine known issues (post-11g.9)

> Section added 2026-05-19 at chunk 11g.10 sub-step 10e. Initial
> registry for known operational quirks in the post-pgmq persistent-
> engine world. Populated as 10b/10c/10d surface real operational
> behavior; the initial KI-E010 below documents the most likely
> deploy-time misconfiguration even without an observed incident
> (silent-failure mode → worth pre-emptive documentation).
>
> **Numbering convention.** Engine-specific KIs in this file use the
> `KI-E###` prefix to disambiguate from project-wide KIs in
> `docs/REGISTRY.md` (which use the plain `KI-###` prefix). Pre-Phase-4.5
> entries in this file (KI-001..KI-007) predate the convention and are
> not retroactively renamed — they're effectively grandfathered, and
> the project-wide registry's numbering does not collide with theirs
> (REGISTRY.md starts at KI-008). New engine-specific KIs from
> chunk 11g.10 forward use `KI-E###`. The collision that motivated the
> convention: engine KI-010 (this file) vs project KI-010 (REGISTRY.md
> "Tier 1 perf optimizations"). Decision Log entry 2026-05-19 in
> `docs/PHASE_4_5_PROJECT_PLAN.md` records the convention.

### KI-E010 — PgBouncer-pooled `SUPABASE_DB_URL` drops LISTEN frames silently

| | |
|---|---|
| **Severity** | high (silent failure → cross-process events invisible to engine until WS reconnect bootstrap) |
| **Function / file** | `server/src/draft/eventSubscription.ts` (consumes `SUPABASE_DB_URL`); deployment env (the actual value lives in GCE service env / Docker env, not in code). |
| **Description** | The chunk 11g.7-7e LISTEN/NOTIFY path requires a direct primary Postgres connection. PgBouncer / Supabase pooled connections (port `6543`, host `pooler.supabase.com`) accept LISTEN commands without error but never propagate notifications to the client. Symptom: engine reaches `event_subscription.started` cleanly but never receives notifications; cross-process events (commissioner pause/resume/extend, override) are invisible to the engine until a WS reconnect triggers bootstrap. Bootstrap is the correctness foundation — no events are lost — but runtime behavior degrades: commissioner actions appear to "not work" until users reconnect their browser tabs. |
| **Why deferred** | Not deferred — this is documented as a known operational gotcha rather than a code defect. The chunk 11g.7-7e startup self-test (synthetic NOTIFY within 5s of LISTEN; failure fires `event_subscription.self_test_failed` with explicit operator hint) is the in-code mitigation. The KI exists because the failure mode is silent at deploy time if the self-test is somehow disabled or its log is missed — operators should know to look for this. |
| **Target phase for resolution** | Operational, not code. Resolution = (a) deploy-pipeline assertion that `SUPABASE_DB_URL` doesn't match pooled patterns (TODO(10b): add to deploy checks), AND (b) on-call awareness via this KI + `draft-engine-v2-staging-preflight.md` §3.4. |
| **Verification test** | `draft-engine-v2-staging-preflight.md` §3.4 (env-variable inspection) AND §4.1 (synthetic NOTIFY end-to-end test). Both checks must pass for the engine to be considered operational. |

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
