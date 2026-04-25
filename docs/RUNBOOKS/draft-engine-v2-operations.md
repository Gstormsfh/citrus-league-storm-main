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
- Reading `draft_metrics.safety_net_hit` rates.
- Pausing the keep-alive cron job.
- Draining a stuck `draft_deadlines` queue manually.
- DLQ inspection (`autopick_failures`).

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

## Add-only convention

Append-only. Old playbooks stay, even after the underlying issue is
fixed — they are part of the audit trail. If a playbook becomes
obsolete, mark it `**OBSOLETE (date)**` at the top and link to its
replacement; do not delete.
