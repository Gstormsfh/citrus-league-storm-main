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
