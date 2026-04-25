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

### KI-001 — `DraftServiceV2.broadcastEvent` can hang on non-SUBSCRIBED channel status

| | |
|---|---|
| **Severity** | medium |
| **Function / file** | `server/src/services/DraftServiceV2.ts`, `broadcastEvent` (the `channel.subscribe` Promise wrapper). |
| **Description** | The Promise wrapping `channel.subscribe` only resolves when `status === 'SUBSCRIBED'` fires. Other statuses (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) cause the inner callback to short-circuit with a bare `return`, leaving the outer Promise unresolved indefinitely. The route handler awaits forever. The same flaw exists in v1's `broadcastDraftPick` (`server/src/routes/draft.ts:37-49`), so this is not a v2 regression — but it should not ship as a v2 feature. |
| **Why deferred** | Flag surfaced during chunk 7 review. Fix is straightforward (Promise.race against a 5s timeout, or handle all `RealtimeChannelStatus` enum values explicitly), but the broader observability + structured-logging work in chunk 9 is the natural place to do it alongside RAISE NOTICE cleanup, and pulling the fix forward would have delayed chunk 8 (routes) for no scheduling benefit. |
| **Target phase for resolution** | **Phase 2 chunk 9** (observability). Pair with KI-002 in the same commit. |
| **Verification test** | `DraftServiceV2.test.ts > broadcastEvent > resolves within 5s when channel never reaches SUBSCRIBED`. Mock the Supabase channel to never emit `SUBSCRIBED`; assert the awaited promise resolves and a `broadcast_channel_failed` log line was emitted. |

### KI-002 — `RAISE NOTICE` noise in 6 v2 RPCs

| | |
|---|---|
| **Severity** | low |
| **Function / file** | `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`, all of: `append_draft_event`, `record_shadow_event`, `submit_pick_v2`, `draft_pause`, `draft_resume`, `draft_extend`. |
| **Description** | Each RPC ends with a `RAISE NOTICE 'function_name committed: ...'` line for development debugging. In production, every commit produces a NOTICE log line (4 per pick at peak — submit_pick_v2 + the projection trigger fires + sometimes downstream events). The volume drowns out signal logs and increases Supabase log ingestion cost. |
| **Why deferred** | Replacing 6 sites with proper structured logging belongs in the observability work scheduled for chunk 9, where the broader `pick_committed`, `autopick_fired`, `safety_net_hit` etc. metric pipeline lands (spec §11.2). Removing them piecemeal before that work is wasted churn. |
| **Target phase for resolution** | **Phase 2 chunk 9** (observability). Either remove entirely or convert to structured `pg_logical_emit_message` / `INSERT INTO draft_metrics` per spec §11.1. |
| **Verification test** | First run `SELECT installed_version FROM pg_available_extensions WHERE name = 'pg_stat_statements'` against the target environment. **If installed:** `supabase/tests/draft_engine_v2_chunk9_log_volume.sql` exec one full pick path, count NOTICE-level emissions for the league via `pg_stat_statements`, assert ≤1 per logical operation. **If not installed:** manual log-stream inspection during chunk 9 sign-off — exec one full pick path, capture the Supabase Functions / Postgres log stream for that minute, grep `RAISE NOTICE` mentions for the test league_id, assert count is the expected number of structured-log emissions (not the current chatty one-per-RPC). |

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
