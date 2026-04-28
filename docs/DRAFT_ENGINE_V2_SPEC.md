# Draft Engine v2 — Formal Specification

**Status:** v1.0 (Phase 0). Authored once, versioned, reviewed.
**Owner:** Draft engine working group.
**Source plan:** `docs/DRAFT_ENGINE_V2_PLAN.md` (commit a39e4f5).
**Companion runbook:** `docs/RUNBOOKS/draft-engine-v2-staging-preflight.md`.
**Environment posture:** Phases 0–7 are **staging-only** on
`staging.citrusfantasysports.com` (Supabase project ref
`jjgspcpvqaiitloglxbb`). Production is untouched until the Phase 8a
readiness gate.

> When this spec and the plan disagree, **the spec wins.** Subsequent
> implementation PRs cite section numbers from this document
> (e.g. "Phase 2 implements §4.1 and §6.2"). Section numbers are
> stable across spec revisions; if a section is removed, its number
> is retired, not reused.

### Scope

- **In scope:** snake / linear drafts; server-authoritative timer +
  autopick scheduling; append-only `draft_events` log as single source
  of truth; idempotent pick submission via UUID nonce + payload hash;
  reconnect-safe replay (`/events?since_seq=N`); commissioner
  pause / resume / extend (v2.0).
- **Out of scope (deferred):** auction draft (v2.x is snake / linear
  only); pick-undo and force-pick commissioner overrides (reserved as
  enum stubs `pick_undone`, `commissioner_override`; RPCs ship in v2.1);
  removal of v1 code (separate PR after ≥30 clean prod v2 drafts);
  long-horizon archival of `draft_events` and pgmq archive tables.

### Versioning

- Spec versions follow `vMAJOR.MINOR`. Breaking event-schema changes
  bump MAJOR; additive changes bump MINOR.
- `event_version smallint` is recorded on every `draft_events` row so
  consumers can dispatch on it.
- This document is **v1.0**. The §13 change log records every revision.

---

## Table of Contents

1. Principles
2. Glossary
3. Database schema
4. RPC signatures
5. State machines
   - 5.1 Draft lifecycle state machine
   - 5.2 Pick submission state machine
   - 5.3 Autopick decision state machine
6. Event catalog
7. Client contract
8. Invariants (I1–I16)
9. Observability contract
10. Error model
11. Rollout plan
12. Open questions
13. Change log

Appendices:
- Appendix A — Architecture overview (ASCII diagram)
- Appendix B — Section-renumber map (v0.1 → v1.0 Rosetta Stone)

> **Note on plan §5.x ambiguity.** `DRAFT_ENGINE_V2_PLAN.md` references
> "spec §5.2" in two places: Phase 2's pick-submission preflight
> (which matches §5.2 in this spec) and Phase 4's autopick worker
> (which is actually §5.3 in this spec). When implementing Phase 4,
> cite **§5.3**, not §5.2. This is recorded in §12 (Open questions →
> erratum).

---

## §0: Performance Mandate

Citrus must be competitive with Yahoo/ESPN on live draft feel. See CLAUDE.md > Citrus Draft Performance Mandate for binding targets and architectural requirements.

The principles below (event sourcing, idempotency, server-owned time, etc.) are necessary but not sufficient for competitive parity. The persistent-worker architecture introduced in Phase 4.5 is required to meet the performance mandate.

Any conflict between the performance mandate and the principles below is resolved in favor of the performance mandate.

## §0.5 Architectural Approach

Per **ADR-001** (`docs/adr/ADR-001-elixir-phoenix-draft-engine.md`), the live draft engine is a **persistent Node.js service running on Cloud Run**, alongside the existing Node server. The service holds per-draft state in memory (one `DraftRoom` instance per active draft) and communicates with clients via **WebSocket transport**. The rest of the Citrus application — leagues, rosters, matchups, scoring dashboards, AI Assistant, public pages — remains on the existing **Node.js / Next.js / Supabase** stack unchanged.

The Phase 0–4 architectural primitives below (event log as source of truth, idempotency keys, payload hashes, projection trigger, pgmq sweep, server-owned time, runtime-checked invariants) are **preserved**. The persistent worker writes to Postgres through the existing RPCs (`submit_pick_v2`, `append_draft_event`, `record_shadow_event`, `reconstruct_draft_state`, `draft_pause`, `draft_resume`, `draft_extend`, `validate_draft_event_payload`); it reads the event log via the existing Postgres clients; the projection trigger fires synchronously inside the same transaction the worker commits. From Postgres's perspective, the worker looks like another well-behaved RPC caller with a fresh `correlation_id` per pass.

What the persistent worker adds:

- **Persistent in-memory state per draft.** Candidate pool, current pick, timer, per-team queues, connected-clients set, last broadcast event id — held in the `DraftRoom` instance for the duration of the draft. No per-action Postgres reads on the hot path.
- **WebSocket transport for the live experience.** Picks, broadcasts, timer ticks, chat, presence. Sub-200ms broadcast fanout to all connected clients (per the Performance Mandate, §0).
- **Sub-1s autopick.** Deadline expiry → in-memory candidate selection → `submit_pick_v2` write → broadcast. The 11.7s/pick latency observed in Phase 4's Edge Function-based autopick is unacceptable; the persistent worker targets p95 ≤ 1000ms (Performance Mandate §0). Tier 1 perf optimizations (parallel async, byte-limited deltas, fanout protection, candidate caching) are baked into the design from chunk 11g.3 onward, not deferred — see KI-010.
- **Reconnection with sequence-number resume protocol.** Mobile network blips, page refreshes, brief drops — clients resync within 2s without losing draft progress (Performance Mandate §0). On reconnect the client passes `last_seen_id`; the server replays missed events from `draft_events`.

What the persistent worker **does not** add:

- A new source of truth. `draft_events` remains authoritative. The worker's in-memory state is a derivation of the event log; on `DraftRoom` startup it rebuilds from `draft_events` (and `draft_picks_v2` for the projection cache). If the worker crashes or restarts (chunk 11g.7), it reloads all active drafts from Postgres state and resumes timers — connected clients reconnect via the resume protocol.
- A new idempotency-key namespace. The same `AUTOPICK_NAMESPACE_UUID` and the same UUIDv5 derivation `(league_id, pick_number, generation, 'autopick')` apply. The integration boundary is the existing Postgres RPC surface; it does not change without an ADR.
- A replacement for the pgmq sweep + keep-alive cron. Those remain as the **disaster-recovery safety net**, demoted from "hot-path worker" to "fallback worker." If the persistent worker is unavailable mid-draft (deploy, crash, network partition), the existing Edge Function autopick path still commits picks (slowly but correctly). The Deno-runtime code in `supabase/functions/draft-autopick` is retained on-cron — see KI-009.

Phase 4.5 (`docs/PHASE_4_5_PLAN.md`) is the chunk-by-chunk plan for building the persistent worker (chunks 11g.1 through 11g.9). Phase 5 (UI client work) MUST consume the Phase 4.5 architecture; it cannot be built against the Phase 0–4 architecture alone (per Performance Mandate §0, "Recovery from prior decisions").

## §1 Principles (non-negotiable)

These six principles are load-bearing. A change that violates one of
them is not an "optimisation" — it is a different system.

**P1. Event log is the single source of truth.** `draft_events` is
append-only with **gap-free per-league `seq`**. All other draft state
(picks, current pick number, deadline) is derivable from the event
stream. No dual-writes; no "authoritative row" elsewhere.

**P2. Server owns time and progression.** Absolute `pick_deadline` is a
column (not JSONB). The client never triggers autopick. Client clocks
are synced via a multi-sample handshake (5 samples, pick min-RTT).

**P3. Idempotency everywhere.** Every pick submission carries an
`Idempotency-Key` UUID and a deterministic `payload_hash`. Duplicate
keys return the original result; **different payloads under the same
key are a hard error** (`idempotency_conflict`).

**P4. Dual-path updates.** Realtime broadcast is the fast path
(target <100ms). Every client also polls `/sync` every 5s as a
steady-state safety net. Reconnect triggers `/events?since_seq=N`
replay. The poll is mandatory — broadcast is a latency optimisation,
never a correctness mechanism.

**P5. Invariants are runtime-checked.** I1–I16 (§8) run every 60s via
`pg_cron`. Violation **pages on-call** immediately. No self-heal.

**P6. Event log + synchronous projection.** `draft_events` is
authoritative; `draft_picks_v2` is a trigger-maintained projection
(a cache) for hot-path reads. The trigger fires inside the same
transaction as the event insert. `reconstruct_draft_state(...)` is a
**rebuild / repair** tool — it seeds the projection on migration,
verifies integrity, and recovers after corruption. It is **not** the
hot-path read. Invariant **I16** is what makes this safe.

## §2 Glossary

- **Event**: a row in `draft_events`. The unit of progression.
- **Seq**: per-league monotonic counter, gap-free, sourced from
  `leagues.draft_event_counter` (advanced inside the same txn as the
  event insert). Distinct from the global `id bigserial`.
- **Generation** (`leagues.draft_generation`): integer bumped on every
  pause/resume cycle and on `draft_extended`. Namespaces autopick
  idempotency keys so post-pause re-fires never collide with pre-pause
  keys. Worker discards messages whose payload generation does not
  match the current league generation.
- **Idempotency key**: client-supplied UUID for user picks; for
  autopicks, deterministic UUIDv5 over
  `(league_id, pick_number, generation, 'autopick')`.
- **Payload hash**: sha256 of the canonical JSON form of the event
  payload. Used to detect "same key, different payload" conflicts.
- **Correlation ID**: UUID grouping all events caused by one logical
  request. Sources are documented in §6.13 (source-of-truth table).
- **Causation ID**: optional pointer to the event that caused this
  event (e.g. an autopick caused by a deadline-expiry sweep).
- **Actor**: who/what produced the event. Closed kind enum:
  `user | autopick | commissioner | shadow | system`.
- **Projection**: `draft_picks_v2`, the synchronous cache of `pick`
  events, written by an AFTER INSERT trigger on `draft_events`.
- **Shadow mode**: write-both, serve-v1 mode used in Phase 8 to
  validate v2 against real prod traffic. Toggled by
  `leagues.draft_shadow_mode = true`.
- **Sweep**: pg_cron job (`*/10 * * * * *`) that enqueues a pgmq
  message for any active league whose deadline has expired and whose
  current pick slot is unfilled.
- **Worker**: long-running Edge Function (`draft-autopick`) that
  loops ≤150s per invocation, polls pgmq every 5s, processes
  messages, and is re-invoked every 2 minutes by a pg_cron keep-alive.
- **Staging**: `staging.citrusfantasysports.com`, backed by Supabase
  project ref `jjgspcpvqaiitloglxbb`. **All Phase 0–7 work runs here
  exclusively.**

## §3 Database schema

All v2 tables ship in **Phase 1** except where noted. RLS is enabled
on every new table. All writes go through SECURITY DEFINER RPCs;
direct INSERT/UPDATE/DELETE by clients is denied by RLS.

### §3.1 `draft_events` (Phase 1)

```sql
CREATE TABLE draft_events (
  id              bigserial PRIMARY KEY,
  league_id       uuid NOT NULL REFERENCES leagues(id),
  seq             bigint NOT NULL,         -- gap-free per league
  event_type      text NOT NULL,           -- §6 catalog (CHECK enum)
  event_version   smallint NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL,          -- validated by §4.10
  payload_hash    text NOT NULL,           -- sha256(canonical JSON)
  idempotency_key uuid,                    -- partial-unique (NOT NULL)
  actor           jsonb NOT NULL,          -- {kind, id?, session_id?}
  causation_id    bigint REFERENCES draft_events(id),
  correlation_id  uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type IN (
    'pick','pick_undone','autopick_failed',
    'draft_started','draft_paused','draft_resumed','draft_extended',
    'draft_completed','draft_cancelled',
    'commissioner_override','generation_bumped'
  )),
  CHECK ((actor->>'kind') IN
         ('user','autopick','commissioner','shadow','system'))
);
CREATE UNIQUE INDEX ON draft_events (league_id, seq);
CREATE UNIQUE INDEX ON draft_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ON draft_events (league_id, created_at);
CREATE INDEX ON draft_events (correlation_id);
```

**RLS.** SELECT for league members. INSERT/UPDATE/DELETE denied for
all roles except `service_role` (mediated by the RPCs).

### §3.2 `draft_picks_v2` (Phase 1, projection of §3.1)

```sql
CREATE TABLE draft_picks_v2 (
  league_id         uuid NOT NULL REFERENCES leagues(id),
  pick_number       int  NOT NULL,
  round             int  NOT NULL,
  team_id           uuid NOT NULL,
  player_id         int  NOT NULL,
  picked_at         timestamptz NOT NULL,
  picked_by_actor   jsonb NOT NULL,
  source_event_id   bigint NOT NULL REFERENCES draft_events(id),
  source_seq        bigint NOT NULL,
  PRIMARY KEY (league_id, pick_number)
);
CREATE INDEX ON draft_picks_v2 (league_id, team_id);
CREATE INDEX ON draft_picks_v2 (league_id, player_id);
```

**RLS.** Identical to v1 `draft_picks`. The projection trigger
(`tg_draft_events_project_pick`) is the only writer.

### §3.3 `leagues` column additions (Phase 1)

```sql
ALTER TABLE leagues
  ADD COLUMN draft_event_counter bigint NOT NULL DEFAULT 0,
  ADD COLUMN pick_deadline       timestamptz,
  ADD COLUMN draft_state         text NOT NULL DEFAULT 'not_started'
    CHECK (draft_state IN ('not_started','pre_draft','active',
                           'paused','completed','cancelled')),
  ADD COLUMN draft_generation    int  NOT NULL DEFAULT 0,
  ADD COLUMN draft_shadow_mode   boolean NOT NULL DEFAULT true,
  ADD COLUMN feature_flags       jsonb NOT NULL DEFAULT '{}'::jsonb;
```

> **Phase 0 collision check.** Before this migration runs, the runbook
> verifies that `feature_flags`, `draft_event_counter`, `pick_deadline`,
> `draft_state`, `draft_generation`, and `draft_shadow_mode` are not
> already columns on `leagues`. If any are, the resolution is documented
> in the runbook before Phase 1 begins.

### §3.4 `draft_queues` (Phase 4)

```sql
CREATE TABLE draft_queues (
  team_id   uuid NOT NULL,
  league_id uuid NOT NULL REFERENCES leagues(id),
  position  smallint NOT NULL,
  player_id int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, player_id),
  UNIQUE (team_id, position)
);
```

**RLS.** Team members can read/write their own team's queue.

### §3.5 `draft_metrics` (Phase 3, partitioned monthly)

```sql
CREATE TABLE draft_metrics (
  ts        timestamptz NOT NULL,
  metric    text NOT NULL,
  league_id uuid,
  value     bigint NOT NULL DEFAULT 1,
  detail    jsonb
) PARTITION BY RANGE (ts);
-- migration creates current + next 3 months;
-- monthly cron creates new + drops >90d old.
```

A separate `draft_metrics_daily` summary retains downsampled counters
for long-horizon dashboards.

### §3.6 `autopick_failures` (Phase 4 DLQ)

```sql
CREATE TABLE autopick_failures (
  id           bigserial PRIMARY KEY,
  league_id    uuid NOT NULL,
  pgmq_msg_id  bigint NOT NULL,
  payload      jsonb NOT NULL,
  last_error   text,
  read_ct      int NOT NULL,
  failed_at    timestamptz NOT NULL DEFAULT now()
);
```

**RLS.** Admin-only. Triggered alert on INSERT.

### §3.7 `draft_invariant_violations` (Phase 6)

```sql
CREATE TABLE draft_invariant_violations (
  id          bigserial PRIMARY KEY,
  invariant   text NOT NULL,         -- 'I1' .. 'I16'
  league_id   uuid,
  detected_at timestamptz NOT NULL DEFAULT now(),
  detail      jsonb NOT NULL
);
```

Trigger on INSERT pages on-call.

### §3.8 `draft_shadow_reports` (Phase 8)

```sql
CREATE TABLE draft_shadow_reports (
  league_id          uuid PRIMARY KEY,
  draft_completed_at timestamptz NOT NULL,
  picks_matched      int  NOT NULL,
  picks_mismatched   int  NOT NULL,
  timing_drift_ms    int  NOT NULL,    -- v2.created_at − v1.committed_at
  detail             jsonb NOT NULL
);
```

### §3.9 `shadow_trigger_errors` (Phase 8)

```sql
CREATE TABLE shadow_trigger_errors (
  id         bigserial PRIMARY KEY,
  league_id  uuid NOT NULL,
  pick_id    uuid,
  error_code text NOT NULL,
  detail     jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
```

Errors caught here are **never propagated up** to v1's transaction —
shadow-side issues must not abort v1 picks.

## §4 RPC signatures

All RPCs are `SECURITY DEFINER` with `SET search_path = public`.
Return types are jsonb unless noted. Error handling: every RPC raises
`RAISE EXCEPTION` with one of the codes in §11. Callers map these to
HTTP statuses per §11.2.

### §4.1 `submit_pick_v2` (Phase 2)

```sql
submit_pick_v2(
  p_league_id        uuid,
  p_team_id          uuid,
  p_player_id        int,
  p_round            int,
  p_pick_number      int,
  p_session_id       uuid,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid
) RETURNS jsonb
-- {
--   event_id        bigint,
--   seq             bigint,
--   pick_deadline   timestamptz,
--   was_duplicate   boolean
-- }
```

Behavior: see §5.2. Idempotent.

**Auth:** `auth.uid()` must be a member of `p_team_id` OR
`actor.kind='autopick'` AND caller is `service_role`. *Implementation
deviation D2 (see `docs/RUNBOOKS/draft-engine-v2-operations.md`):* the
`actor.kind='autopick'` branch accepts both `service_role` AND
`postgres`, mirroring D1's rationale. PostgREST roles (`anon`,
`authenticated`) remain rejected.

**Commissioner pick power (intentionally absent in v2.0 and v2.1).**
Commissioners cannot directly submit picks via this RPC. Owner
absences are handled via `draft_pause` (§4.6) + offline coordination
+ `draft_resume` (§4.7), or by simply waiting for autopick. The v2.1
`commissioner_override` event is for *override operations on
existing picks* (force-replace, undo) — not for "commissioner picks
on behalf of an absent owner." This is a deliberate v1→v2 behavior
change; v1's commissioner-can-pick-for-anyone path does not exist in
v2.

**Idempotent retry contract (`was_duplicate=true`).** When the RPC
returns `was_duplicate=true`, the `pick_deadline` field carries the
**live** `leagues.pick_deadline` value at the time of the retry, NOT
the deadline that applied when the original pick committed. If picks
have happened since the original, the returned deadline is for some
later pick number. Clients receiving `was_duplicate=true` MUST treat
it as "your original landed; re-sync state via `/sync` rather than
acting on the returned `pick_deadline` directly."

**Session ID propagation.** `p_session_id` is written into the event
payload as `payload.session_id` for tracing; the RPC does not
otherwise act on it.

### §4.2 `append_draft_event` (Phase 2)

```sql
append_draft_event(
  p_league_id        uuid,
  p_event_type       text,
  p_payload          jsonb,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_actor            jsonb,
  p_correlation_id   uuid
) RETURNS jsonb
-- { event_id, seq, was_duplicate }
```

Used for non-pick events (`draft_started`, `draft_paused`, `draft_resumed`,
`draft_extended`, `draft_completed`, `draft_cancelled`,
`generation_bumped`, `autopick_failed`). Same seq mechanism, no
pick-specific preflight. Validates payload shape via §4.10.

### §4.3 `record_shadow_event` (Phase 2; called only by Phase 8 trigger)

```sql
record_shadow_event(
  p_league_id        uuid,
  p_payload          jsonb,
  p_idempotency_key  uuid,
  p_payload_hash     text,
  p_correlation_id   uuid
) RETURNS jsonb
-- { event_id, seq, was_duplicate }
```

**Hard guards** (raise on any violation):
1. `auth.role() = 'service_role'`.
   *Implementation deviation D1 (see
   `docs/RUNBOOKS/draft-engine-v2-operations.md`):* the Phase 2 RPC
   accepts `auth.role() IN ('service_role', 'postgres')` so the
   Phase 8 SECURITY DEFINER trigger and manual SQL surgery via the
   Supabase Dashboard both pass. PostgREST roles (`anon`,
   `authenticated`) remain rejected.
2. `p_payload->'actor'->>'kind' = 'shadow'`.
3. `(SELECT draft_shadow_mode FROM leagues WHERE id = p_league_id) = true`.

Skips state-machine preflight by design. Goes through seq counter +
idempotency machinery + projection trigger. The diff job (§11)
catches divergence; this RPC does not validate.

### §4.4 `reconstruct_draft_state` (Phase 2)

```sql
reconstruct_draft_state(p_league_id uuid) RETURNS jsonb
-- {
--   picks                : array of {pick_number, round, team_id, player_id, picked_at},
--   current_pick_number  : int,
--   on_the_clock_team_id : uuid | null,
--   completed_rounds     : int,
--   draft_state          : text,
--   generation           : int
-- }
```

Reads `draft_events` only. Used as **rebuild/repair**, not hot-path.
Hot-path read is `SELECT FROM draft_picks_v2 WHERE league_id = $1`.

### §4.5 `draft_pause` (Phase 2)

```sql
draft_pause(
  p_league_id  uuid,
  p_actor      jsonb     -- {kind:'commissioner', id, session_id}
) RETURNS jsonb           -- { generation, paused_at }
```

In one txn:
1. `draft_generation += 1`, emit `generation_bumped`.
2. `draft_state := 'paused'`, `pick_deadline := NULL`.
3. Emit `draft_paused`.

Stale pgmq messages no-op at worker read time (see §5.3).

### §4.6 `draft_resume` (Phase 2)

```sql
draft_resume(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb           -- { generation, new_pick_deadline }
```

In one txn:
1. `draft_generation += 1`, emit `generation_bumped`.
2. `draft_state := 'active'`, recompute `pick_deadline` per §5.2.2.
3. `pgmq.send('draft_deadlines', payload, send_delay)` for the new
   generation.
4. Emit `draft_resumed`.

### §4.7 `draft_extend` (Phase 2)

```sql
draft_extend(
  p_league_id      uuid,
  p_extra_seconds  int,
  p_actor          jsonb
) RETURNS jsonb           -- { generation, new_pick_deadline }
```

In one txn:
1. `draft_generation += 1`, emit `generation_bumped`.
2. `pick_deadline += p_extra_seconds` (re-rounded per §5.2.2).
3. `pgmq.send(...)` fresh message at the new delay.
4. Emit `draft_extended`.

### §4.8 `draft_deadline_sweep` (Phase 3)

```sql
draft_deadline_sweep() RETURNS int   -- count of messages enqueued
```

Race-free predicate over `draft_events` (no pgmq introspection); see
plan §2 / spec §5.3 for the SQL form. Wrapped in
`pg_try_advisory_xact_lock(hashtext('draft-sweep'))` so overlapping
runs no-op. Increments `draft_metrics.safety_net_hit` per enqueue.

### §4.9 `check_draft_invariants` (Phase 6)

```sql
check_draft_invariants() RETURNS int   -- count of violations inserted
```

Runs each I1–I16 predicate (§8). Inserts violations into
`draft_invariant_violations`. After-insert trigger pages on-call.

### §4.10 `validate_draft_event_payload` (Phase 1)

```sql
validate_draft_event_payload(
  p_event_type text,
  p_payload    jsonb
) RETURNS boolean
```

Validates payload shape per §6 catalog. Called inside
`submit_pick_v2`, `append_draft_event`, `record_shadow_event` before
INSERT. Raises `invalid_event_payload` on mismatch.

## §5 State machines

### §5.1 Draft lifecycle

`leagues.draft_state` is a CHECK-constrained text column with values:
`not_started | pre_draft | active | paused | completed | cancelled`.

```
                  draft_started
  not_started ─────────────────► pre_draft
                                    │
                              first pick due
                                    ▼
                                  active ◄──┐
                                    │       │
                  draft_paused      │       │ draft_resumed
                  ┌─────────────────┘       │ (gen++)
                  ▼                         │
                paused ──────────────────────┘
                  │
                  │ draft_cancelled
                  ▼
              cancelled

  active ─── all picks made ──► completed
  active ─── draft_extended ──► active (gen++, deadline pushed)
  any state ── draft_cancelled ─► cancelled
```

Legal transitions are enumerated in invariant **I14** (§8). Any other
transition raises `illegal_state_transition` and is logged as a fatal.

**Generation bump rule.** Every entry into `paused`, every exit from
`paused` (`draft_resumed`), and every `draft_extended` increments
`leagues.draft_generation` and emits a `generation_bumped` event
**before** the lifecycle event. This is what lets the autopick worker
no-op stale pgmq messages without queue-side cancellation (see §5.3).

### §5.2 Pick submission state machine

Executed inside `submit_pick_v2`. All steps are in one transaction.

```
  ┌─ idempotency-key seen?
  │   yes → SELECT FOR UPDATE existing event
  │         payload_hash match? ──► return existing (was_duplicate=true)
  │         payload_hash mismatch? ──► ERROR idempotency_conflict
  │   no  ↓
  ├─ preflight (§5.2.1)
  │   • league.draft_state = 'active'?            else ERROR illegal_state
  │   • pick_number == current_pick_number?       else ERROR pick_out_of_order
  │   • team is on the clock (snake/linear)?      else ERROR not_on_clock
  │   • player not already picked?                else ERROR player_taken
  │   • caller authorized (auth.uid() == team_member
  │     OR actor.kind='autopick' service-role)?   else ERROR unauthorized
  │   ↓
  ├─ UPDATE leagues SET draft_event_counter += 1 RETURNING new_seq
  │   ↓
  ├─ INSERT draft_events(seq, ..., correlation_id := COALESCE(p_correlation_id,
  │     gen_random_uuid()))
  │   ON CONFLICT (idempotency_key) DO NOTHING RETURNING *
  │   ↓ (if no row returned, another txn won the race; SELECT and return that row)
  ├─ AFTER INSERT trigger tg_draft_events_project_pick:
  │     INSERT INTO draft_picks_v2 from event.payload
  │   ↓
  ├─ Compute next pick_deadline (§5.2.2):
  │     pick_deadline := date_trunc('second', now())
  │                    + make_interval(secs => ceil(pick_time_limit_seconds)::int)
  │                    + interval '1 second'  -- pad up
  │   UPDATE leagues SET pick_deadline = pick_deadline
  │   ↓
  ├─ pgmq.send('draft_deadlines', payload, GREATEST(0,
  │     ceil(EXTRACT(EPOCH FROM (pick_deadline - now())))::int))
  │   ↓
  └─ COMMIT, return {event_id, seq, pick_deadline, was_duplicate}
```

#### §5.2.1 Preflight ordering rationale
Idempotency check runs **before** preflight. A retried pick that is
"out of order" relative to current state may simply be the original
attempt — returning the original event is correct, raising
`pick_out_of_order` would be a false positive on retry.

#### §5.2.2 Deadline rounding rule
`pick_deadline` is rounded to whole seconds via `CEIL` and padded by
`+1s`. Rationale: pgmq's `send_delay` parameter takes integer seconds,
and we require autopick to fire **after** the user-visible timer hits
zero, never before. Worst-case extra grace is ~1s on a 90s timer; on a
10s tournament timer the +1s pad is still conservative ("better one
second late than one millisecond early").

### §5.3 Autopick decision state machine

Executed by the long-running worker (`supabase/functions/draft-autopick`).

```
  pgmq.read('draft_deadlines', vt=30, qty=10)
       │
       ▼
  for each msg:
       │
       ├─ msg.read_ct >= 3?
       │   yes → INSERT autopick_failures(...)
       │         append_draft_event(autopick_failed)
       │         pgmq.archive(msg_id)
       │         page on-call
       │         continue
       │
       ├─ correlation_id := crypto.randomUUID()
       │
       ├─ load league = SELECT FROM leagues WHERE id = msg.league_id
       │
       ├─ league.draft_state != 'active'?
       │   yes → log worker_skip_state, archive, continue
       │
       ├─ msg.payload.generation != league.draft_generation?
       │   yes → log worker_skip_generation, archive, continue
       │
       ├─ now() < league.pick_deadline?
       │   yes → log worker_skip_premature, archive, continue
       │         (deadline was extended after enqueue)
       │
       ├─ msg.payload.pick_number != current_pick_number?
       │   yes → log worker_skip_pick_advanced, archive, continue
       │         (a human picked between enqueue and read)
       │
       ├─ pick player:
       │   • on-the-clock team's draft_queues row, head of queue,
       │     filtered to "not already picked"
       │   • else fallback heuristic (FPTS × positional need),
       │     ported from DraftRoom.tsx:2410-2524
       │
       ├─ submit_pick_v2(
       │     p_idempotency_key = uuidv5(league_id, pick_number,
       │                                generation, 'autopick'),
       │     p_actor           = {kind:'autopick'},
       │     p_correlation_id  = correlation_id,
       │     p_payload_hash    = sha256(canonical_json(payload)))
       │
       ├─ result?
       │   • success                  → metric autopick_fired,
       │                                 pgmq.archive(msg_id)
       │   • idempotency_conflict     → log "human picked just in time",
       │                                 pgmq.archive(msg_id)
       │   • retryable error          → DO NOT archive; vt expires,
       │                                 pgmq redelivers; read_ct++
       │   • fatal error              → DLQ + autopick_failed event
       │                                 + page on-call
       │
       └─ continue loop
```

**No queue-side cancellation.** Stale messages — created before a
pause, or before a generation bump from `draft_extended`, or before a
human submitted a real pick — are no-ops at read time. The
`(draft_state, generation, pick_number)` checks above are the entire
cancellation mechanism. `pgmq.delete` is **never** called.


## §6 Event catalog

Every event row in `draft_events` carries an `event_type`, a typed
payload, an `actor`, a `correlation_id`, an optional `causation_id`,
and a `payload_hash`. The catalog below specifies the **payload shape
only** — the envelope is fixed by §3.1.

Payloads are JSON. Required fields are bold; optional fields are
italic. Unknown fields are rejected by §4.10 (closed schema, not open).

### §6.1 `pick`

```jsonc
{
  "pick_number": 1,           // **int**, 1-based, monotonic per league
  "round": 1,                 // **int**, 1-based
  "team_id": "uuid",          // **uuid**
  "player_id": 8478402,       // **int**
  "picked_at": "iso8601",     // **timestamptz**, server-assigned
  "is_autopick": false,       // **bool**
  "session_id": "uuid",       // *uuid*, optional, propagated from
                              //          submit_pick_v2 p_session_id
                              //          for tracing
  "pgmq_msg_id": 12345        // *int*, present only for autopicks
}
```

### §6.2 `pick_undone` (reserved for v2.1)

```jsonc
{
  "target_event_id": 4711,    // **bigint**, the pick event being undone
  "reason": "string"          // **text**, free-form
}
```

Constraint (v2.1): undo is rejected if any subsequent pick has been
made. No cascading unwind. Audit-trail integrity outweighs
flexibility.

### §6.3 `autopick_failed`

```jsonc
{
  "pick_number": 7,           // **int**
  "generation": 3,            // **int**
  "read_ct": 3,               // **int**, pgmq read count at failure
  "last_error": "...",        // **text**
  "pgmq_msg_id": 12345        // **int**
}
```

### §6.4 `draft_started`

```jsonc
{
  "started_at": "iso8601",
  "first_pick_deadline": "iso8601",
  "total_rounds": 15,
  "total_teams": 12,
  "pick_time_limit_seconds": 90,
  "draft_format": "snake"     // "snake" | "linear"
}
```

### §6.5 `draft_paused`

```jsonc
{
  "paused_at": "iso8601",
  "paused_pick_number": 47,
  "remaining_seconds": 23,    // seconds left on the timer at pause
  "reason": "commissioner"    // "commissioner" | "system"
}
```

### §6.6 `draft_resumed`

```jsonc
{
  "resumed_at": "iso8601",
  "resumed_pick_number": 47,
  "new_pick_deadline": "iso8601"
}
```

### §6.7 `draft_extended`

```jsonc
{
  "extended_at": "iso8601",
  "pick_number": 47,
  "extra_seconds": 30,
  "new_pick_deadline": "iso8601"
}
```

### §6.8 `draft_completed`

```jsonc
{
  "completed_at": "iso8601",
  "total_picks": 180
}
```

### §6.9 `draft_cancelled`

```jsonc
{
  "cancelled_at": "iso8601",
  "reason": "string",
  "cancelled_at_pick_number": 47   // *int*, last pick number reached
}
```

### §6.10 `commissioner_override` (reserved for v2.1)

Schema stubbed; RPC ships in v2.1.

### §6.11 `generation_bumped`

```jsonc
{
  "old_generation": 2,
  "new_generation": 3,
  "reason": "pause"           // "pause" | "resume" | "extend"
}
```

### §6.12 Actor envelope (all events)

```jsonc
"actor": {
  "kind": "user",             // **enum**: user|autopick|commissioner|shadow|system
  "id":   "uuid",             // **uuid for user/commissioner**, NULL for autopick/system
  "session_id": "uuid"        // *uuid*, for user/commissioner only
}
```

### §6.13 `correlation_id` source-of-truth table

| `actor.kind`   | `correlation_id` source                                   |
|----------------|-----------------------------------------------------------|
| `user`         | `X-Correlation-Id` header from client; server-generates if absent. |
| `autopick`     | Worker-generated `crypto.randomUUID()` per message processing pass (NOT the pgmq `msg_id`). pgmq `msg_id` lives in `payload.pgmq_msg_id`. |
| `commissioner` | Client-generated UUID from admin UI.                      |
| `shadow`       | Deterministic UUIDv5 over `(league_id, v1_pick_id)`.      |
| `system`       | Migration ID, or `gen_random_uuid()` for synthetic events.|

### §6.14 Realtime broadcast shape

Channel: `draft_events_v2:${leagueId}`
Event name: `event`
Payload: the full `draft_events` row, serialized as JSON, **after** the
RPC commits. Strict ordering rule: `DraftServiceV2.broadcast()` runs
**after** `submit_pick_v2` returns successfully. The row returned by
the RPC is the canonical payload (NOT the caller's input).

The broadcast channel is **not access-controlled at the channel
layer** (anyone with the league ID can subscribe). RLS on `/events`
REST is the authoritative read path. Documented as security review
item in Phase 6.

## §7 Client contract

### §7.1 Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/api/draft/v2/league/:leagueId/sync`             | member  | Snapshot for clock + state (§7.2) |
| POST | `/api/draft/v2/league/:leagueId/pick`              | member  | Submit a pick (§7.3) |
| GET  | `/api/draft/v2/league/:leagueId/events?since_seq=N&limit=500` | member | Replay (§7.4) |
| GET  | `/api/admin/draft/v2/metrics`                      | admin   | Health dashboard (Phase 6) |

The existing `GET /api/league/:id` response is extended (Phase 5) to
include `feature_flags` so the client knows whether to render
`<DraftRoomV2>`. No new endpoint for the flag.

### §7.2 `/sync` response shape

```jsonc
{
  "server_time":          "iso8601",
  "pick_deadline":        "iso8601|null",
  "current_seq":          1234,
  "current_pick_number":  47,
  "draft_state":          "active",
  "payload_hash":         "sha256:..."
}
```

Cacheable for 100ms server-side; client re-polls every 5s
(steady-state safety net).

### §7.3 `POST /pick` contract

Headers:
- `X-Idempotency-Key: <uuid>` — **required**.
- `X-Correlation-Id: <uuid>` — optional; server generates one if absent.

Body:
```jsonc
{
  "team_id":     "uuid",
  "player_id":   8478402,
  "round":       1,
  "pick_number": 1
}
```

Server computes `payload_hash` server-side from the canonical JSON
form. Client does NOT supply `picked_at` — it is server-assigned.

Response (200):
```jsonc
{
  "event_id":      4711,
  "seq":           48,
  "pick_deadline": "iso8601",
  "was_duplicate": false
}
```

Status mapping:
- 200: success or idempotent replay.
- 400: payload validation failure.
- 401/403: auth / membership failure.
- 409: `idempotency_conflict` (same key, different payload).
- 409: `pick_out_of_order` / `not_on_clock` / `player_taken`.
- 422: `illegal_state` (draft not active).
- 5xx: retryable; client should retry with the same Idempotency-Key.

### §7.4 `/events` replay

Returns events with `seq > since_seq`, ordered by `seq`, cap 500.
Response includes `next_since_seq` cursor. Cache:
`Cache-Control: public, max-age=86400, immutable` only when every
returned event belongs to a league with `draft_state IN ('completed',
'cancelled')`. Active drafts are not cached.

**Rate limit**: 10 requests per 30-second sliding window per
`(client_session_id, league_id)`, returning 429 with `Retry-After`.
Client short-circuits replay when `lastSeq === current_seq` from
`/sync`.

### §7.5 Clock sync (`DraftClock.ts`)

1. On mount: fire 5 `/sync` requests at 150ms intervals.
2. For each sample: record `t_send`, `t_recv`, `server_time`, and
   `rtt = t_recv - t_send`.
3. Pick the sample with **minimum** `rtt`.
4. `offset = server_time - (t_send + rtt/2)`.
5. `getRemainingMs() = pick_deadline - (Date.now() + offset)`.
6. Re-sync on reconnect AND every 5 minutes.
7. **Drift guard**: if two consecutive 5-minute resyncs show offset
   change >500ms, emit `clock_drift_detected` to telemetry.

### §7.6 Event stream (`DraftEventStream.ts`)

1. Subscribe to `draft_events_v2:${leagueId}` realtime channel.
2. Track `lastSeq` (in-memory + sessionStorage).
3. On broadcast arrival: verify `seq === lastSeq + 1`. On gap, pause
   broadcast handling, call `/events?since_seq=lastSeq`, replay
   in-order, then resume.
4. On reconnect: same replay path.
5. Steady-state poll: every 5s, call `/sync`. If
   `current_seq > lastSeq`, replay.

### §7.7 Engine state ownership

- Engine state lives in a **module-scoped Zustand store**
  (`DraftEngineStore.ts`), NOT React context.
- Store is initialized at `LeagueLayout.tsx`, idempotently per
  `leagueId`. It survives route changes between draft / roster /
  trades / waivers.
- `DraftV2MiniDeckBar.tsx` is mounted in `LeagueLayout`, conditional
  on `draft_state IN ('pre_draft','active','paused')`. It reads from
  the same store as `DraftRoomV2`.
- Teardown is **explicit**: `disposeDraftEngine(leagueId)` on logout
  or navigation away from any `/league/:id/*` route.

### §7.8 Client invariants

- **CI1.** The client never computes the current pick number from
  wall time; only from the event log.
- **CI2.** The client never fires autopick. Period.
- **CI3.** The client treats broadcast as advisory; the steady-state
  poll is the correctness mechanism (P4).
- **CI4.** The client never trusts its own clock; only the
  server-anchored offset from §7.5.

## §8 Invariants (I1–I16)

Each invariant is a SQL predicate that returns **0 rows when healthy,
≥1 row when violated**. `check_draft_invariants()` (§4.9) runs all of
them every 60s and inserts violations into
`draft_invariant_violations` (§3.7). Violations page on-call. There
is no self-heal.

The 16 invariants are grouped under the 7 high-level categories
called out in the plan handoff. Each grouping below tells you which
invariants prove that category holds; each invariant is also
individually catalogued.

> **Provenance note (please review).** `DRAFT_ENGINE_V2_PLAN.md`
> defines **I1–I6** and **I16** explicitly. For **I7–I15** the plan
> says only "per spec" — meaning the spec author chose them. The
> selections recorded below are **this spec author's judgment**, not
> the plan author's:
> - **I7** — exactly one team on the clock when active.
> - **I8** — `leagues.draft_event_counter` ↔ `max(seq)`.
> - **I9** — strictly increasing per-league `seq` (defensive; subsumed
>   by the unique index).
> - **I10** — autopick events fire at or after the deadline.
> - **I11** — `actor.kind` matches the closed enum (defensive;
>   CHECK-enforced).
> - **I12** — every autopick event records its pgmq `msg_id` in
>   payload.
> - **I13** — `pick_number` ≤ league's max picks.
> - **I14** — draft-state transitions follow §5.1.
> - **I15** — `correlation_id` non-null on every event (defensive;
>   NOT NULL on the column).
>
> These are runtime-enforced and will page on-call when violated.
> Before Phase 1 begins, please confirm the set above matches your
> mental model of "what could be wrong with a live draft that we
> should detect within 60 seconds." If any are missing, redundant, or
> mis-defined, raise it — easier to fix here than in a 3am incident.

### §8.1 Category-to-invariant mapping

| Category               | Invariants                  |
|------------------------|-----------------------------|
| **G1. Uniqueness**     | I3 (no duplicate picks), I4 (idempotency-key uniqueness) |
| **G2. Atomicity**      | I8 (counter ↔ max(seq)), I16 (projection ↔ log) |
| **G3. Monotonic clock**| I5 (deadline in future when active), I10 (autopick fires after timer hits zero) |
| **G4. Idempotent autopick** | I4, I12 (every autopick event has a pgmq msg_id) |
| **G5. Reconnect safety**| I1 (gap-free seq), I9 (strictly increasing seq), I15 (correlation_id non-null) |
| **G6. Eligibility**    | I2 (pick implies team-on-clock), I7 (exactly one team on the clock when active), I11 (actor.kind in closed enum), I13 (pick_number ≤ total picks) |
| **G7. Ordering**       | I1, I8, I14 (legal state transitions), I6 (active leagues have a sweep watcher) |

### §8.2 Per-invariant catalogue

**I1 — `seq` is gap-free per league.**
```sql
SELECT league_id
FROM (
  SELECT league_id, seq, seq - row_number() OVER
                          (PARTITION BY league_id ORDER BY seq) AS g
  FROM draft_events
) t
GROUP BY league_id, g
HAVING count(*) > 1 AND min(seq) <> 1;
-- Healthy: 0 rows.
```

**I2 — Every `pick` event matches the team-on-clock per snake order.**
```sql
SELECT e.id, e.league_id
FROM draft_events e
JOIN leagues l ON l.id = e.league_id
WHERE e.event_type = 'pick'
  AND (e.payload->>'team_id')::uuid <>
      expected_team_on_clock(l.id, (e.payload->>'pick_number')::int);
```

**I3 — No player picked twice in a league.**
```sql
SELECT league_id, (payload->>'player_id')::int, count(*)
FROM draft_events
WHERE event_type = 'pick'
GROUP BY 1, 2
HAVING count(*) > 1;
```

**I4 — `idempotency_key` uniqueness holds globally.**
```sql
SELECT idempotency_key, count(*)
FROM draft_events
WHERE idempotency_key IS NOT NULL
GROUP BY 1
HAVING count(*) > 1;
-- Should be impossible (unique index), but verify in case of catastrophic schema drift.
```

**I5 — `pick_deadline` is in the future when `draft_state='active'`.**
```sql
SELECT id
FROM leagues
WHERE draft_state = 'active'
  AND (pick_deadline IS NULL OR pick_deadline < now() - interval '5 seconds');
-- 5-second slack covers worker grace + sweep cadence.
```

**I6 — Active leagues have either a pgmq message in flight OR a
safety-net sweep touched them in the last 15 seconds.**
```sql
SELECT l.id
FROM leagues l
WHERE l.draft_state = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM pgmq.q_draft_deadlines q
    WHERE (q.message->>'league_id')::uuid = l.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM draft_metrics m
    WHERE m.metric = 'safety_net_hit'
      AND m.league_id = l.id
      AND m.ts > now() - interval '15 seconds'
  );
```

**I7 — Exactly one team is on the clock when `draft_state='active'`.**
```sql
SELECT l.id
FROM leagues l
WHERE l.draft_state = 'active'
  AND cardinality(teams_on_clock(l.id)) <> 1;
-- Helper teams_on_clock(uuid) returns the singleton or empty set.
```

**I8 — `leagues.draft_event_counter` equals max(seq) per league.**
```sql
SELECT l.id
FROM leagues l
LEFT JOIN (
  SELECT league_id, max(seq) AS m FROM draft_events GROUP BY 1
) e ON e.league_id = l.id
WHERE l.draft_event_counter <> COALESCE(e.m, 0);
```

**I9 — Per-league `seq` is strictly increasing (no duplicates).**
Subsumed by the unique index on `(league_id, seq)`; predicate runs
defensively.
```sql
SELECT league_id, seq, count(*)
FROM draft_events
GROUP BY 1, 2
HAVING count(*) > 1;
```

**I10 — Autopick events fire at or after the deadline.**
```sql
SELECT e.id
FROM draft_events e
JOIN draft_events deadline_event
  ON deadline_event.id = e.causation_id
WHERE e.actor->>'kind' = 'autopick'
  AND e.event_type = 'pick'
  AND e.created_at <
      (deadline_event.payload->>'pick_deadline')::timestamptz - interval '500 milliseconds';
```

**I11 — `actor.kind` matches the closed enum.**
Enforced by CHECK on §3.1; predicate runs as a safety net.
```sql
SELECT id FROM draft_events
WHERE (actor->>'kind') NOT IN
  ('user','autopick','commissioner','shadow','system');
```

**I12 — Every autopick event records a pgmq `msg_id` in payload.**
```sql
SELECT id FROM draft_events
WHERE actor->>'kind' = 'autopick'
  AND payload->>'pgmq_msg_id' IS NULL;
```

**I13 — `pick_number` does not exceed the league's max picks.**
```sql
SELECT e.id
FROM draft_events e
JOIN leagues l ON l.id = e.league_id
WHERE e.event_type = 'pick'
  AND (e.payload->>'pick_number')::int >
      (l.settings->>'total_rounds')::int * (l.settings->>'team_count')::int;
```

**I14 — Draft-state transitions follow §5.1.**
Predicate walks `draft_started` / `draft_paused` / `draft_resumed` /
`draft_extended` / `draft_completed` / `draft_cancelled` /
`generation_bumped` events in `seq` order per league and asserts each
adjacent pair is a legal transition. Implementation is a SQL CTE with
a transition allowlist; emits violation rows for any illegal pair.

**I15 — `correlation_id` is non-null on every event.**
Enforced by NOT NULL on §3.1; predicate is a safety net.
```sql
SELECT id FROM draft_events WHERE correlation_id IS NULL;
```

**I16 — Projection ↔ log consistency: `draft_picks_v2` row count for
each league equals the count of `pick` events minus undone picks.**
```sql
WITH log AS (
  SELECT league_id,
         count(*) FILTER (WHERE event_type = 'pick')
       - count(*) FILTER (WHERE event_type = 'pick_undone') AS expected
  FROM draft_events
  GROUP BY 1
)
SELECT l.league_id
FROM log l
LEFT JOIN (
  SELECT league_id, count(*) AS actual
  FROM draft_picks_v2 GROUP BY 1
) p ON p.league_id = l.league_id
WHERE l.expected <> COALESCE(p.actual, 0);
```

I16 is the load-bearing invariant for principle P6 (synchronous
projection). If it ever fires, hot-path reads are no longer
trustworthy and the projection must be rebuilt from
`reconstruct_draft_state` (§4.4).

### §8.3 What "violation" means

- **Page on-call immediately.** No self-heal attempt by the engine.
- The runbook (§11 + companion staging-preflight runbook) prescribes
  triage: snapshot the league's events, identify the affected pick
  range, decide whether to pause the draft (`draft_pause`) before
  investigation.
- During shadow mode (Phase 8), violations on **any** league fail the
  shadow exit criteria.

## §9 Observability contract

### §9.1 Structured logs

Every `submit_pick_v2` invocation emits one structured JSON log line:
```jsonc
{
  "kind":               "submit_pick_v2",
  "event_id":           4711,
  "seq":                48,
  "league_id":          "uuid",
  "actor_kind":         "user",
  "idempotent_replay":  false,
  "latency_ms":         34
}
```

Every autopick worker pass emits one log per message:
```jsonc
{
  "kind":          "autopick",
  "msg_id":        12345,
  "league_id":     "uuid",
  "outcome":       "picked",   // picked|already_picked|retry|fatal|skip_state|skip_generation|skip_premature|skip_pick_advanced
  "latency_ms":    52,
  "attempt":       1,
  "correlation_id":"uuid"
}
```

Client telemetry to `POST /api/telemetry/draft` emits aggregate
counters only (no PII):
- `clock_drift_detected`
- `broadcast_gap_detected`
- `reconnect_replay_triggered`

### §9.2 Metrics (in `draft_metrics`)

| Metric | When emitted |
|---|---|
| `pick_committed`             | Every successful `submit_pick_v2`. |
| `pick_idempotent_replay`     | When `was_duplicate=true`. |
| `pick_idempotency_conflict`  | On `idempotency_conflict`. |
| `autopick_fired`             | Successful autopick. |
| `autopick_skipped`           | Worker no-op (state/generation/premature/advanced). |
| `autopick_dlq`               | Insert into `autopick_failures`. |
| `safety_net_hit`             | Sweep enqueues a message. |
| `broadcast_send_failed`      | Realtime broadcast failed (post-commit). |
| `replay_request`             | `/events` call. |
| `replay_rate_limited`        | 429 returned. |
| `clock_drift_detected`       | Client telemetry. |

### §9.3 Dashboards (Phase 6)

- **Live drafts** — `pick_committed` rate, autopick share, p50/p95
  `submit_pick_v2` latency, broadcast vs poll reconciliation count.
- **Health** — invariant violation counts (last 24h), DLQ depth, sweep
  hit rate, idempotency conflict count.

## §10 Error model

### §10.1 Error codes

| Code                       | HTTP | Raised by | Meaning |
|----------------------------|------|-----------|---------|
| `idempotency_conflict`     | 409  | `submit_pick_v2`, `record_shadow_event` | Same key, different `payload_hash`. |
| `pick_out_of_order`        | 409  | `submit_pick_v2` | `pick_number` ≠ current. |
| `not_on_clock`             | 409  | `submit_pick_v2` | Team is not on the clock. |
| `player_taken`             | 409  | `submit_pick_v2` | Player already picked. |
| `unauthorized`             | 403  | `submit_pick_v2` | `auth.uid()` not on team. |
| `illegal_state`            | 422  | all RPCs | `draft_state` ≠ allowed for this op. |
| `illegal_state_transition` | 500  | `append_draft_event` | New state not legal from current. |
| `invalid_event_payload`    | 400  | §4.10    | Payload fails schema check. |
| `shadow_guard_violated`    | 500  | `record_shadow_event` | Hard-guard failure (§4.3). |
| `generation_mismatch`      | 500  | worker   | Stale message; worker no-ops, not surfaced to client. |

### §10.2 Retry semantics

- Clients retry on 5xx **with the same `Idempotency-Key`**.
- Clients do NOT retry 4xx — they surface to the user.
- Workers do not archive on retryable errors; pgmq's vt expires and
  redelivers; `read_ct` increments; §5.3 caps attempts at 3.

## §11 Rollout plan

Reproduces the plan's phase gating for spec-side reference. The
plan (`DRAFT_ENGINE_V2_PLAN.md`) is the source of truth for the
schedule; this section exists so the spec is self-contained for
auditors.

| Phase | Surface | Environment | Gate |
|-------|---------|-------------|------|
| 0     | Spec + runbook + infra preflight | Staging only | This document + runbook merged. |
| 1     | `draft_events`, `draft_picks_v2`, `leagues` columns, `/sync` endpoint | Staging | Migration applies cleanly; `/sync` returns 200. |
| 2     | `submit_pick_v2`, `/pick`, `/events`, projection trigger | Staging | Idempotency tests green. |
| 3     | pgmq queue, sweep, worker scaffold | Staging | Sweep enqueues; worker archives. |
| 4     | Autopick state machine + heuristic + DLQ | Staging | Headless 12×15 draft completes unaided. |
| 5     | v2 client (`<DraftRoomV2>`, store, mini-bar) | Staging | Live human draft completes with broadcast + poll both firing. |
| 6     | Invariants + observability | Staging | I1–I16 fire on synthetic violations. |
| 7     | Simulation + chaos + 48h soak with draft-season traffic shape | Staging | Zero I1–I16 violations across the 48h. |
| 8a    | Schema deploy to prod (gated off, no cron, no keep-alive) | **Prod** | Migrations apply; v1 still works. |
| 8b    | Shadow trigger ON; `record_shadow_event` writes parallel log | Prod | 5 consecutive real drafts with zero mismatched picks. |
| 9     | Beta league → cohort → new-league default → opt-in → default-on | Prod | ≥10 clean v2 drafts before default-on. |
| 10    | Remove v1 code | Prod | ≥30 clean v2 drafts. |

Calendar gates apply: even if Phase 0 finishes in a day, Phase 1 does
not start until the spec + runbook have soaked for 48h of review.

## §12 Open questions

### §12.1 Resolved (decisions captured here)

- Worker topology = single long-running Edge Function (≤150s loop),
  re-invoked every 2 min via pg_cron keep-alive.
- Autopick decision logic = TypeScript in Edge Function.
- Projection = synchronous trigger on `draft_events` →
  `draft_picks_v2`.
- pgmq lifecycle = `archive` (not `delete`) after processing.
- pgmq scheduling = `send_delay` (not VT). VT (~30s) is the
  redelivery window only.
- Autopick idempotency key = UUIDv5 over `(league_id, pick_number,
  generation, 'autopick')`.
- Pause/resume/extend = generation bump + state mutation + new
  enqueue; **no queue-side cancellation**.
- `correlation_id` for autopick = worker-generated UUIDv4 (NOT
  derived from pgmq `msg_id`); pgmq `msg_id` lives in
  `payload.pgmq_msg_id`.
- `feature_flags` reach the client via the existing
  `GET /api/league/:id` response (no new endpoint).
- Realtime channel is not access-controlled; RLS on `/events` REST
  is the authoritative read path.
- Broadcast happens **after** RPC commit; the row returned by the
  RPC is the canonical broadcast payload.
- Shadow mode trigger fires ~10–50ms before v1's user-visible commit
  (trigger-fire-order artifact), not a clock-skew bug. Diff job
  buckets accordingly.

### §12.2 Surfaced for user decision before Phase 1

- **Realtime concurrency cap on current Supabase tier.** Phase 0
  preflight (companion runbook) measures the actual cap. If Pro
  standard tier's ~500-connection cap is below the
  10,000-subscriber target (500 drafts × 20 clients), the user
  decides between (a) tier upgrade, (b) channel consolidation, or
  (c) reduced concurrent-draft ceiling for v2.0.
- **`leagues` column-name collisions.** Phase 0 preflight queries
  `information_schema.columns` for collisions. If any collide, the
  user decides between reuse-via-namespacing, rename, or
  inspect-and-migrate. Documented in the runbook.

### §12.3 Deferred beyond Phase 9

- Auction-draft adoption of v2.
- v1 code removal.
- Pick-undo and force-pick commissioner overrides (v2.1).
- Long-horizon retention policy for `draft_events` and the pgmq
  archive.

### §12.4 Errata against `DRAFT_ENGINE_V2_PLAN.md`

This spec is the contract; where the plan and the spec disagree, the
spec wins (per the front-matter quote-block). Known disagreements:

- **Plan §5.2 / §5.3 ambiguity.** `DRAFT_ENGINE_V2_PLAN.md` references
  "spec §5.2" in two places that describe different state machines —
  Phase 2's pick-submission preflight (which is genuinely §5.2 in
  this spec) and Phase 4's autopick worker (which is **§5.3** in
  this spec). When implementing Phase 4, cite **§5.3**.
- **Plan calls the Phase 0 runbook `draft-engine-v2-operations.md`;
  this spec's companion runbook is `draft-engine-v2-staging-preflight.md`**
  per the user's task assignment. A shorter `draft-engine-v2-operations.md`
  stub also exists (created in Phase 0) as a forward-looking ops
  document filled in across Phases 3–7.
- **Spec sections vs. plan sections.** This is v1.0; v0.1 used a
  different numbering. See Appendix B for the Rosetta Stone.

## §13 Change log

- **v1.0 (Phase 0)** — initial spec, incorporating three rounds of
  review fixes from `DRAFT_ENGINE_V2_PLAN.md` (commit a39e4f5).
  Renumbered from v0.1 (initial Phase 0 draft) to align section
  numbers with the plan's references; see Appendix B for the
  Rosetta Stone. I7–I15 invariant selections are spec-author
  judgment and flagged for review in §8.
- **v1.0.1 (Phase 2 implementation)** — §4.3 guard #1 annotated
  with implementation deviation D1 (postgres role allowlisted
  alongside service_role; full rationale in
  `docs/RUNBOOKS/draft-engine-v2-operations.md`). No semantic
  change to the contract; the spec just documents what shipped.
- **v1.0.2 (Phase 2 chunk 5)** — §4.1 expanded:
  - Auth annotated with deviation D2 (postgres role allowlisted
    for `actor.kind='autopick'`).
  - Deviation D3 documented: commissioners have no direct pick
    power in v2.0 or v2.1; owner absences are handled via
    pause/resume; v2.1's `commissioner_override` is for
    overrides of existing picks, not absentee picks.
  - Idempotent retry contract clarified: `was_duplicate=true`
    returns LIVE deadline; clients must re-sync, not act on it.
  - `p_session_id` propagation documented (written to
    `payload.session_id` for tracing).
  §6.1 pick payload adds optional `session_id` field.

---

## Appendix A — Architecture overview

```
CLIENT (React)              SERVER (Hono)         POSTGRES + SUPABASE
─────────────               ─────────────         ───────────────────

DraftClock                  GET /sync ×5
  multi-sample,    ───────► returns {
  min-RTT offset             server_time,
  steady-state poll 5s ◄──   pick_deadline,
                             current_seq,
                             current_pick_number,
                             draft_state,
                             payload_hash }

DraftClient                 POST /pick
  submitPick()              X-Idempotency-Key: uuid
   key + hash      ───────► submit_pick_v2(...) ──► BEGIN
                                                    UPDATE leagues
                                                      SET draft_event_counter
                                                          = draft_event_counter+1
                                                      RETURNING seq
                                                    INSERT draft_events(...)
                                                      ON CONFLICT (idempotency_key)
                                                      DO NOTHING RETURNING *
                                                    AFTER INSERT TRIGGER →
                                                      INSERT draft_picks_v2
                                                    UPDATE leagues
                                                      SET pick_deadline = ...
                                                    pgmq.send(
                                                      'draft_deadlines',
                                                      payload,
                                                      send_delay = secs)
                                                    COMMIT

DraftEventStream             realtime broadcast
  tracks lastSeq    ◄──────  channel: draft_events_v2:${leagueId}
  reconcile on poll          payload: full event row
  replay on reconnect:
   GET /events?since_seq=N ──► SELECT * FROM draft_events
                               WHERE league_id=$1 AND seq>$2
                               ORDER BY seq LIMIT 500

                             ┌─ pgmq queue: draft_deadlines ─┐
                             │                               │
                             │  Worker (Edge Function,       │
                             │   long-running ≤150s):        │
                             │   read(vt=30, qty=10)         │
                             │   for each msg:               │
                             │     §5.3 state machine        │
                             │     submit_pick_v2(           │
                             │       actor='autopick',       │
                             │       idempotency_key =       │
                             │         uuidv5(league,        │
                             │           pick_number,        │
                             │           generation,         │
                             │           'autopick'))        │
                             │     pgmq.archive(msg_id)      │
                             │   sleep 5s if loop continues  │
                             │                               │
                             │  Keep-alive: pg_cron */2 min  │
                             │   net.http_post(<edge-url>)   │
                             │                               │
                             │  Safety net: pg_cron */10s    │
                             │   draft_deadline_sweep()      │
                             │                               │
                             │  Invariants: pg_cron */60s    │
                             │   check_draft_invariants()    │
                             └───────────────────────────────┘
```

---

## Appendix B — Section-renumber map (v0.1 → v1.0)

The first Phase 0 draft of this spec used a different section
numbering. Subsequent PRs and any chat history that references the
old numbers should consult this table to translate. **Body content
is unchanged**; only section numbers moved.

| v0.1 (initial draft) | v1.0 (this version) | Notes |
|----------------------|---------------------|-------|
| §1 Purpose, scope, versioning | (front-matter) | Folded into the "Scope" and "Versioning" front-matter sections. |
| §2 Principles                 | §1 Principles | |
| §3 Glossary                   | §2 Glossary | |
| §4 Architecture overview      | Appendix A | Moved to keep §1–§13 aligned with the plan. |
| §5 State machines             | §5 State machines | Unchanged. Subsections §5.1, §5.2, §5.3 preserved. |
| §6 Database schema            | §3 Database schema | Subsections §6.1–§6.9 → §3.1–§3.9. |
| §7 RPC signatures             | §4 RPC signatures | Subsections §7.1–§7.10 → §4.1–§4.10. |
| §8 Event catalog              | §6 Event catalog | Subsections §8.1–§8.14 → §6.1–§6.14. |
| §9 Client contract            | §7 Client contract | Subsections §9.1–§9.8 → §7.1–§7.8. |
| §10 Invariants                | §8 Invariants | Subsections §10.1–§10.3 → §8.1–§8.3. |
| §11 Observability contract    | §9 Observability contract | Subsections §11.1–§11.3 → §9.1–§9.3. |
| §12 Error model               | §10 Error model | Subsections §12.1–§12.2 → §10.1–§10.2. |
| §13 Rollout plan              | §11 Rollout plan | Subsection §13.2 → §11.2. |
| §14 Open questions            | §12 Open questions | Subsections §14.1–§14.3 → §12.1–§12.3. |
| §15 Change log                | §13 Change log | |

**Rationale for renumbering.** `DRAFT_ENGINE_V2_PLAN.md` was written
assuming the spec would be numbered §1–§13 with the layout used in
v1.0 (e.g. plan Phase 1 cites "spec §3" expecting schemas; plan
Phase 6 cites "spec §8" expecting invariants). The v0.1 draft
deviated, which would have caused every implementation PR to either
cite the wrong section or quietly drift from the spec. v1.0 is the
contract Phases 1–10 cite by section number.











