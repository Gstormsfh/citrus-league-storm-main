# Draft Engine v2 — Operations Runbook (stub)

> **Status:** stub (Phase 0). This file is filled in across Phases
> 3–7 as runtime concerns surface. Per `DRAFT_ENGINE_V2_PLAN.md`,
> Phase 0 only requires the stub to exist with a pointer to the
> spec.

> **Companion docs.**
> - `docs/DRAFT_ENGINE_V2_SPEC.md` — the formal contract. Cite by
>   section number from any incident notes added to this runbook.
> - `docs/RUNBOOKS/draft-engine-v2-staging-preflight.md` — the
>   Phase 0 staging preflight (one-time, gates Phase 1).
> - `docs/DRAFT_ENGINE_V2_PLAN.md` — multi-phase plan.

## What this document is for

The operations runbook is what an on-call engineer reaches for
during a live-draft incident. It is **not** the spec (read-once,
contract) and **not** the staging preflight (read-once, Phase 0).
It is the durable, growing collection of:

- "Here's what to do when invariant Iₙ fires."
- "Here's how to read the autopick worker logs."
- "Here's how to drain a stuck pgmq message."
- "Here's how to roll back the v2 feature flag for a single league."

## What this document covers (eventually)

The sections below are placeholders. Each is filled in by the phase
that introduces the relevant runtime surface.

### Phase 3 additions (scheduler + sweep)
- Reading `draft_metrics.safety_net_hit` rates. *(deferred to chunk 10f)*
- Draining a stuck `draft_deadlines` queue manually. *(deferred to chunk 10f)*
- DLQ inspection (`autopick_failures`). *(deferred to Phase 4)*

#### Provisioning the `draft-autopick-token` Vault secret (chunk 10d)

The keep-alive cron job (`draft-autopick-keepalive`, every 2 min)
reads its bearer token from a Vault secret named
`draft-autopick-token`. Without this secret, the cron fires but the
Edge Function rejects each invocation with 401 (visible as
`auth_failed` log lines on the Edge Function and 401 rows in
`net.http_response`). The sweep cron is unaffected.

To provision (run as `postgres` in the Supabase Dashboard SQL
Editor — the value MUST NOT be committed to git):

```sql
SELECT vault.create_secret(
  '<paste SUPABASE_SERVICE_ROLE_KEY here>',
  'draft-autopick-token',
  'Bearer token used by draft-autopick-keepalive cron to invoke the
   draft-autopick Edge Function. Matches the Edge Function''s timing-
   safe compare against SUPABASE_SERVICE_ROLE_KEY (chunk 10c follow-
   up commit). Rotate when the project service-role key rotates.'
);
```

Verify:

```sql
SELECT name, description FROM vault.decrypted_secrets
 WHERE name = 'draft-autopick-token';
-- expect 1 row; do NOT log the secret value.
```

To rotate (after the project service-role key is rotated):

```sql
-- Vault has no UPDATE; delete + recreate.
SELECT vault.update_secret(
  (SELECT id FROM vault.decrypted_secrets WHERE name = 'draft-autopick-token'),
  '<paste new SUPABASE_SERVICE_ROLE_KEY>'
);
-- The next keep-alive cron tick (within 2 min) picks up the new token.
```

#### Pausing / resuming the keep-alive cron

Use this when a buggy worker deploy is draining real `submit_pick_v2`
messages and you need to halt it without redeploying the Edge
Function.

```sql
-- Pause: keep-alive stops; sweep continues to enqueue safety-net msgs.
-- Pgmq messages accumulate in q_draft_deadlines until resumed.
UPDATE cron.job SET active = false WHERE jobname = 'draft-autopick-keepalive';

-- Resume.
UPDATE cron.job SET active = true  WHERE jobname = 'draft-autopick-keepalive';
```

To pause both sweep AND keep-alive (full Phase 3 stop, only do this
if you know what you're doing — accumulated expired deadlines will
NOT be picked up until the sweep resumes):

```sql
UPDATE cron.job SET active = false
 WHERE jobname IN ('draft-deadline-sweep', 'draft-autopick-keepalive');
```

**Propagation delay (~1 min).** pg_cron's launcher rechecks
`cron.job` once per minute. The `active = false` flip takes effect at
the **next launcher poll**, not the next scheduled tick. Worst case,
one keep-alive can still fire after your UPDATE commits (a 30–90s
window). For a clean cutoff, wait ~1 min after the UPDATE before
assuming the cron is silent.

**Verifying the pause took effect.** Two queries:

```sql
-- 1. Confirm the active flag flipped.
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'draft-autopick-keepalive';
-- expect: active = false
```

```sql
-- 2. Confirm no firings since the pause. Run ~3 min after the UPDATE
--    to span at least one would-have-been-fired tick.
SELECT jobname, status, start_time, return_message
  FROM cron.job_run_details
 WHERE jobname = 'draft-autopick-keepalive'
 ORDER BY start_time DESC
 LIMIT 5;
-- expect: most recent start_time pre-dates your UPDATE commit.
```

**Note on accumulation while paused.** With keep-alive paused but
sweep still running, any active draft whose deadline expires
produces a `safety_net_hit` row + a pgmq message in
`q_draft_deadlines`. Messages accumulate until the keep-alive
resumes (or until manually drained — see chunk 10f for the drain
recipe). On staging during Phase 3 with no active drafts, expected
accumulation is zero; verify with
`SELECT count(*) FROM pgmq.q_draft_deadlines;` before resuming.

#### Forcing an out-of-band keep-alive (chunk 10d)

When the keep-alive's 2-min cadence is too slow during an incident
and you want to invoke the worker immediately:

```sql
SELECT net.http_post(
  url := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || vault.read_secret('draft-autopick-token'),
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 150000
);
-- Returns a request_id (bigint). Inspect net.http_response for the
-- response when it arrives (~140s later for a busy worker, ~30s
-- if the queue is idle and the worker exits early).
```

### Phase 4 additions (worker)
- Reading the `draft-autopick` Edge Function logs.
- Diagnosing a stuck `read_ct ≥ 3` message.
- Forcing a worker invocation (out-of-band).

### Phase 5 additions (client)
- Triaging client-side `clock_drift_detected` telemetry.
- Investigating `broadcast_gap_detected` rate spikes.
- Forcing a client to take the replay path.

### Phase 6 additions (invariants)
- One playbook per invariant I1–I16. Format: cause, blast radius,
  triage steps, escalation contact.
- How to confirm an invariant violation is a true positive vs. a
  predicate bug.

### Phase 7 additions (chaos / soak)
- How to interpret a 48h soak run that ended with non-zero I1–I16
  fires.
- How to re-run individual chaos scenarios.

### Phase 8 additions (shadow mode)
- Reading `draft_shadow_reports`.
- Investigating non-zero `picks_mismatched`.
- Interpreting `timing_drift_ms` (expected ranges per spec §8 / §11).

### Phase 9 additions (rollout)
- Per-league feature-flag flip.
- Global feature-flag rollback.
- Communication template for affected commissioners.

## Documented deviations from spec

Implementation choices that depart from the literal spec wording, with
rationale. Any implementer reading the spec should also read this
section before assuming the code matches verbatim.

### D2 — `submit_pick_v2` accepts `postgres` role for `actor.kind='autopick'`

**Spec section:** §4.1 (Auth bullet, "actor.kind='autopick' AND
caller is service_role").
**Implementation:** when `actor.kind='autopick'`,
`auth.role() NOT IN ('service_role', 'postgres')` raises
`unauthorized` (insufficient_privilege).
**Why:** the Phase 4 worker (`supabase/functions/draft-autopick`)
runs as `service_role` (Supabase Edge Function with the service
key); but emergency / out-of-band picks driven by manual SQL via the
Supabase Dashboard run as `postgres`. A strict `service_role`-only
check would either block emergency operations or force operators to
issue picks via PostgREST as service_role, which is awkward in
incident contexts. The deviation is narrow: `postgres` is privileged
but not client-reachable; PostgREST callers (`anon`,
`authenticated`) are still rejected. Same rationale as D1.
**Surfaced in code:** `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`
(submit_pick_v2 step 2f auth dispatch).

### D3 — Commissioners have no direct pick power in v2.0 or v2.1

**Spec section:** §4.1 / §5.2 preflight 2f (auth check).
**Implementation:** `submit_pick_v2` rejects
`actor.kind='commissioner'` (and `'shadow'`, `'system'`) with
`unauthorized`. Only `'user'` and `'autopick'` are accepted.
**Why:** v1 lets commissioners pick on behalf of any team (often
used for absent owners). v2 deliberately removes this, replacing it
with two narrower paths:
- **Owner absences** — `draft_pause` (§4.6) + offline coordination
  + `draft_resume` (§4.7), or simply wait for autopick.
- **Override of an already-committed pick** (force-replace, undo) —
  reserved for v2.1's `commissioner_override` event.
This separates "commissioner deciding which player" from
"commissioner administering the draft." The former conflates the
draft's audit trail with the commissioner's tools; the latter
preserves the audit trail by keeping picks attributable to the team
that actually owns them or to autopick.
**Operator implication:** any v1 runbook step that says "have the
commissioner submit the pick" must be rewritten as "pause the
draft, coordinate offline, resume" before v2.0 ships.
**Surfaced in code:** `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`
(submit_pick_v2 step 2f, ELSE branch).

### D1 — `record_shadow_event` accepts `postgres` role in addition to `service_role`

**Spec section:** §4.3 (guard #1, "service_role only").
**Implementation:** `auth.role() NOT IN ('service_role', 'postgres')`
raises `shadow_guard_violated`.
**Why:** the Phase 8 v1→v2 trigger fires inside Postgres itself
(SECURITY DEFINER trigger executing as the table owner — typically
`postgres`), and manual SQL surgery via the Supabase Dashboard SQL
Editor also runs as `postgres`. A strict `service_role` check would
either:
1. Reject the trigger outright, breaking shadow mode end-to-end, or
2. Force the trigger to be rewritten as a service-role HTTP callout,
   which couples shadow recording to network availability and adds
   latency to v1's commit path.
The deviation is narrow: `postgres` is a privileged DB role, not a
client-reachable one. PostgREST callers are still restricted to
`anon` / `authenticated` and would still be rejected by this guard.
**Alternatives considered:** strict `service_role` only (rejected —
breaks the trigger), broad allowlist (rejected — too lax).
**Surfaced in code:** `supabase/migrations/20260425140000_draft_engine_v2_rpcs.sql`
(record_shadow_event guard #1 comment).

### D4 — `draft_metrics` PK includes synthetic `id` column

**Spec section:** §3.5 (`draft_metrics` schema; spec lists no PK).
**Implementation:** `draft_metrics` has `id bigserial NOT NULL` and
`PRIMARY KEY (ts, id)`.
**Why:** PostgreSQL range partitioning requires the partition key
(`ts`) to be part of any PK or UNIQUE constraint declared on the
partitioned table. The spec literal omits a PK entirely, but one is
needed both for partitioning and for standard hygiene (replication
identity, `ON CONFLICT` targets, distinguishing same-timestamp rows).
A PK on `ts` alone would force every metric write to a strictly unique
timestamp — fine in low-volume periods, but during a draft burst
(multiple `pick_committed` rows in the same microsecond) the second
insert would silently fail. `(ts, id)` with a `bigserial` `id` column
avoids the collision and preserves time-ordering. The `bigserial`
sequence is shared across partitions, so ids are globally unique even
though the PK is per-partition-enforced.
**Operator implication:** queries that read `draft_metrics` should
project `metric, ts, league_id, value, detail` and treat `id` as a
row-identity column with no semantic meaning — do not expose it in
dashboards or alerts.
**Surfaced in code:** `supabase/migrations/20260426120000_draft_engine_v2_phase3_metrics.sql`
(table definition, "deviation D4" comment).

## Add-only convention

Append-only. Old playbooks stay, even after the underlying issue is
fixed — they are part of the audit trail. If a playbook becomes
obsolete, mark it `**OBSOLETE (date)**` at the top and link to its
replacement; do not delete.
