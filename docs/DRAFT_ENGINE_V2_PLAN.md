# Draft Engine v2 — Industry-Standard Live Draft Rebuild

> **Environment posture — read this first. Phases 0–7 are
> staging-only. Nothing deploys to production until the Phase 8
> readiness gate.**
>
> This is a deliberately stronger posture than "dormant-in-prod behind
> feature flags." Prod is not touched — at all — until v2 has proved
> itself in staging. The rationale:
>
> 1. **Feature flags are a runtime gate, not a deployment gate.**
>    Deploying migrations or cron jobs to prod — even gated off —
>    creates real risk: a migration syntax error blocks other
>    migrations; an accidentally-enabled `pg_cron` job fires against
>    prod data; a misconfigured RPC is reachable via PostgREST. The
>    only way to eliminate that risk is to not deploy.
> 2. **The prior three live-draft disasters were all defects that
>    existed in prod before they detonated.** Keeping v2 entirely out
>    of prod until staging sign-off is the posture that most
>    aggressively avoids a repeat.
> 3. **Supabase migrations are append-only by timestamp**, so holding
>    Phases 1–4 migrations in the staging-only branch until Phase 8 is
>    free — they land on prod as a single batched deploy immediately
>    before shadow mode turns on, with timestamps in original order.
>
> Concretely:
>
> - **Phases 0–4** (spec, schema, RPCs, sweep, worker) — all code,
>   migrations, edge functions, and pg_cron jobs deploy to the
>   **staging Supabase project only**. The prod Supabase project is
>   untouched. `supabase db push` runs against staging. CI deploys
>   only to staging.
> - **Phases 5–7** (simulator, chaos, 48h soak) run **exclusively in
>   staging**, against a staging database seeded with a scrubbed copy
>   of prod schema + synthetic league/user data. Staging pgmq,
>   staging pg_cron, staging edge functions. No prod data, no prod
>   traffic, no prod cron jobs. The acceptance gate for leaving
>   Phase 7 is: all I1–I16 invariants hold across a 48h staging soak
>   with realistic traffic shape.
> - **Phase 8 readiness gate (explicit user sign-off).** Before Phase
>   8 begins, Phases 1–4 migrations + edge functions + pg_cron jobs
>   deploy to prod as a **single batched release**. On prod they
>   arrive gated off (`draft_engine_v2_enabled=false` everywhere,
>   pg_cron job inserted `DISABLED`, worker edge function deployed
>   but not keep-alive-scheduled). This deploy is its own PR, its own
>   review, its own rollback plan — separate from Phase 8's shadow
>   trigger, so if the v2 schema deploy misbehaves on prod we roll it
>   back without ever having touched a real draft.
> - **Phase 8** is the first time v2 observes a real draft — and only
>   as a **shadow/parallel log** while v1 remains the user-facing
>   system. No user action is served by v2.
> - **Phase 9** is the canary cutover (write-both, serve-v2 for
>   opt-in leagues); **Phase 10** removes v1 after 30 clean prod
>   drafts.
>
> If at any point before the Phase 8 readiness gate a v2 artifact
> lands on prod, that is a bug — not an optimization to sneak in
> early. The whole point of the phase gating is to find defects in
> staging instead of in front of users (the exact failure mode of
> the three prior live-draft disasters). Do not skip ahead; do not
> compress Phase 8 by working harder (it's a calendar gate keyed to
> real drafts happening on prod).

## Context

Three live drafts in prod have been disasters. The April 10 postmortem
(`docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md`) documented seven independent
defects, but the core draft engine itself has four architectural gaps
that will bite under load regardless of surrounding fixes:

1. **Client-driven timer** — each client computes `Date.now() - timerStartedAt`
   from its own wall clock. Backgrounded tabs freeze the countdown. Clock-skewed
   devices display the wrong time.
   (`apps/web/src/pages/DraftRoom.tsx:1796-1920`)

2. **Client-driven autopick** — only the commissioner's browser fires autopick
   at `time <= 0`. If the commissioner disconnects, the draft stalls.
   (`apps/web/src/pages/DraftRoom.tsx:2333-2540`)

3. **Fire-and-forget broadcast** — `server/src/routes/draft.ts:27-53`
   swallows broadcast errors with `.catch(() => {})`. Dropped picks silently
   fall back to 200-500ms postgres_changes delivery.

4. **No idempotency, no sequence numbers** — pick submission has no nonce,
   no ordered event log. Retries cause ambiguity; reconnects can deliver
   picks out of order.

Industry standard (Yahoo/ESPN/Sleeper/Socket.IO/Kafka) is uniform on the
fix: server-authoritative absolute deadline, server-run autopick scheduler,
idempotent submission via nonce + unique constraint, sequence-numbered
event log with replay on reconnect.

Staging Supabase (`jjgspcpvqaiitloglxbb`) already has 72,963 rows of prod
data loaded. It's the right place to build and load-test this without
prod blast radius.

## Foundation document

Full formal specification lives at `docs/specs/DRAFT_ENGINE_V2_SPEC.md`
(committed in Phase 0, before any implementation PR). That document is
the contract — schemas, state machines, invariants I1–I16, event types,
observability requirements. This plan is the execution schedule. When
they conflict, the spec wins.

**Spec v1.0 (Phase 0) incorporates two rounds of review fixes:**

*Round 1 (13 architectural fixes):*
- Blockers: pgmq `send_delay` (not VT) for deadline scheduling;
  long-running Edge Function worker topology; explicit synchronous
  trigger-projection model with `draft_picks_v2`; `/events` rate limit
  + `current_seq` early-exit; closed `actor.kind` enum with CHECK.
- Forward-compatibility: commissioner pause/resume/extend RPCs in
  v2.0 scope; `pick_undone` and `commissioner_override` event types
  reserved as enum stubs for v2.1; autopick idempotency key namespaced
  by `draft_generation`.
- Process: Realtime concurrency cap verification in Phase 0;
  per-actor-kind `correlation_id` source documented in event catalog;
  `draft_metrics` partitioned monthly from day one; bursty "draft
  season" 48h soak pattern in Phase 7; revised shadow-mode exit
  criterion for autopick (manual review rather than human-agreement %).

*Round 2 (11 implementation-correctness fixes):*
- pgmq cancellation impossible-as-written → state-machine no-op at
  worker read time, no `pgmq.delete` calls; pause/resume/extend rely
  on generation bump.
- Safety-net sweep raced + read pgmq internals → race-free EXISTS
  predicate over `draft_events`; idempotency key + worker no-op
  guarantee at-most-once even under duplicate enqueue.
- `pgmq.read_retry_count` doesn't exist → worker explicitly checks
  `read_ct >= 3` and inserts into `autopick_failures` DLQ table.
- `send_delay` integer cast truncated sub-second precision → round
  `pick_deadline` to whole seconds via CEIL with +1s pad-up; autopick
  fires after the user-visible timer hits zero, never before.
- Phase 0 column-name collision check (`leagues` table) before any
  ALTER TABLE in Phase 1.
- React engine state hoisted to module-scoped Zustand store (not
  context); store initialized at `LeagueLayout` level so connections
  survive route changes between draft/roster/trades.
- `DraftServiceV2` broadcasts strictly **after** `submit_pick_v2`
  commits, using the row returned by the RPC as the canonical source.
- Realtime channel authorization documented as not-access-controlled;
  RLS-protected `/events` REST is the authoritative read path.
- Autopick `correlation_id` = worker-generated UUIDv4 (not pgmq
  msg_id hash); `pgmq_msg_id` stored separately in payload.
- `feature_flags` delivered to client via `GET /api/league/:id`
  response (no new endpoint).
- Shadow-mode `timing_drift_ms` expected to lead v1 by 10–50ms (up
  to ~200ms) due to trigger-fire ordering; diff script buckets
  accordingly.

*Round 3 (3 final-pass consistency fixes):*
- `submit_pick_v2` signature includes `p_correlation_id uuid` so
  workers can supply their UUIDv4 (closes the loop with round-2 #9).
- Phase 3 sweep tests rewritten to match the no-dedupe design: split
  into "after-worker-commit" (0 enqueues) and "before-worker-commit"
  (duplicates expected, idempotency key still produces exactly one
  pick per league).
- New `record_shadow_event(...)` RPC (Phase 2) used by the Phase 8
  shadow trigger instead of `submit_pick_v2`. Skips preflight by
  design — locked to service-role + `actor.kind='shadow'` +
  `leagues.draft_shadow_mode=true` — so v1↔v2 state drift during
  shadow mode does not trigger spurious validation failures. Diff
  job catches divergence; preflight does not.

## Approach

**Five principles from the spec, non-negotiable:**

1. **Event log is the single source of truth.** `draft_events` is append-only
   with gap-free per-league sequence numbers. All other draft state
   (picks, current_pick_number, deadline) is derivable from the event
   stream. No dual-writes; no "authoritative row" elsewhere.
2. **Server owns time and progression.** Absolute `pick_deadline` as a
   column (not JSONB). Client never triggers autopick. Client clock is
   synced via multi-sample NTP-style handshake (5 samples, pick min-RTT).
3. **Idempotency everywhere.** Every pick submission carries an
   `Idempotency-Key` UUID and a deterministic `payload_hash`. Duplicate
   keys return the original result; different payloads under the same key
   are a hard error.
4. **Dual-path updates.** Realtime broadcast is the fast path (<100ms);
   every client polls `/sync` every 5s as a steady-state safety net.
   Reconnect triggers `/events?since_seq=N` replay.
5. **Invariants are runtime-checked.** I1–I16 (spec §8) run every 60s via
   pg_cron. Violation pages on-call immediately, no self-heal attempt.
6. **Event log + synchronous projection.** `draft_events` is authoritative;
   `draft_picks_v2` is a trigger-maintained projection (a cache) for
   hot-path reads. The trigger fires inside the same txn as the event
   insert, so reading `draft_picks_v2` after a successful pick commit is
   guaranteed consistent. `reconstruct_draft_state(...)` is a
   *rebuild/repair* tool — used to seed the projection on migration,
   verify integrity, and recover after a corrupted projection. It is
   **not** the hot-path read. Invariant I16 (projection ↔ log) is what
   makes this safe.

**Scheduler is dual-layer.** Primary: pgmq message queue. Each pick
commit enqueues the next deadline using pgmq's **send_delay** param
(seconds until the message becomes visible) — *not* visibility timeout.
The visibility timeout (~30s) is set when the worker reads the message
and is the redelivery safety window. The worker is a **single
long-running Edge Function** that loops internally for ≤150s (Edge
Function max duration), polls pgmq every 5s, processes messages, then
returns. A pg_cron job re-invokes the worker every 2 minutes as a
keep-alive (no cold-start cost during active drafts; one log stream per
150s window for clean observability; no overlapping invocations). Safety
net: a separate pg_cron sweep every 10s enqueues into pgmq for leagues
with expired deadlines that have no in-flight message, logging
`safety_net_hit`. Sub-minute pg_cron confirmed available on Supabase Pro
(pg_cron 1.6.4). pgmq native availability confirmed; Phase 0 verifies
Postgres version is not in the 17.6.1.016+ window that hits the
`drop_queue` overload bug.

**v2 is strictly additive, rolled out via shadow mode.** v1 stays intact
and in production. v2 runs in parallel for ≥2 weeks on every real draft,
producing a mirror event log that's continuously diffed against v1 state.
Zero divergence for 5+ consecutive drafts = promotion criteria. Only then
does the feature flag flip for a beta league. v1 is never deleted until
v2 has run 10 prod drafts cleanly.

**Branch:** `claude/debug-staging-environment-mv9CY` (per task
assignment). PRs merge into `staging-setup`; nothing touches `master`
until Phase 8 shadow-mode exit criteria are met.

## Architecture (goal state)

```
CLIENT (React)                 SERVER (Hono)          POSTGRES + SUPABASE
──────────────                 ─────────────          ───────────────────

DraftClock (multi-sample)      GET /sync ×5
 min-RTT offset        ──────► returns {server_time,
 steady-state poll 5s   ◄──── pick_deadline,
                               current_seq,
                               payload_hash}

DraftClient                    POST /pick
 submitPick()                  Idempotency-Key: uuid
  attaches key+hash   ──────► submit_pick_v2(...)  ──► BEGIN
                                                       SELECT nextval
                                                         (leagues.draft_event_counter)
                                                       INSERT draft_events
                                                         (league_id, seq,
                                                          event_type='pick',
                                                          payload, payload_hash,
                                                          idempotency_key,
                                                          actor, causation_id)
                                                       ON CONFLICT (idempotency_key)
                                                         DO NOTHING RETURNING *
                                                       -- materialized views
                                                       -- update via trigger
                                                       COMMIT

DraftEventStream               realtime broadcast {seq, event, payload_hash}
 tracks lastSeq         ◄────  (fast path, <100ms)
 reconcile on poll
 replay on reconnect:
 GET /events?since_seq=N ──►   SELECT * FROM draft_events
                                WHERE league_id=$1 AND seq>$2
                                ORDER BY seq

                               PRIMARY: pgmq queue
                                'draft_deadlines'
                                  ▲                     ┌──────────────────────┐
                                  │ pgmq.send(          │ Edge Function        │
                                  │   queue,            │ draft-autopick       │
                                  │   payload,          │ (long-running)       │
                                  │   delay=            │ kept warm via        │
                                  │     deadline-now()  │ pg_cron every 2 min  │
                                  │ )                   │  loop ≤150s {        │
                                  │  send_delay = secs  │   read(vt=30, qty=10)│
                                  │  until first        │   for each msg:      │
                                  │  visibility         │     state machine    │
                               submit_pick_v2 enqueues  │       §5.2           │
                               next deadline            │     submit_pick_v2   │
                                                        │       key=hash(      │
                                                        │         league,      │
                                                        │         pick,        │
                                                        │         generation,  │
                                                        │         'autopick')  │
                                                        │     archive(msg_id)  │
                                                        │   sleep 5s if empty  │
                                                        │  }                   │
                                                        └──────────────────────┘

                               SAFETY NET: pg_cron '*/10 * * * * *'
                                 SELECT draft_deadline_sweep()
                                 → find leagues with expired deadlines
                                   not already being processed
                                 → pgmq.send(queue, payload, delay=0)
                                 → increment `safety_net_hit` metric

                               KEEP-ALIVE: pg_cron '*/2 * * * *' (2 min)
                                 SELECT net.http_post(<edge-fn-url>)
                                 → invokes worker; worker no-ops fast
                                   if queue is empty

                               INVARIANTS: pg_cron '0 * * * * *' (60s)
                                 SELECT check_draft_invariants()
                                 → evaluate I1–I16
                                 → INSERT violations → alerts table
                                 → page on any row
```

## Phases (each = one PR, each runnable/testable on its own)

### Phase 0 — Spec doc + infrastructure prep
**PR size: small. No code, no behavior change. Must merge before Phase 1.**

Files to create:
- `docs/specs/DRAFT_ENGINE_V2_SPEC.md` — the formal spec (sections §1–§13:
  principles, glossary, schemas, state machines §5.1–§5.3, event catalog,
  invariants I1–I16, observability, error model, rollout plan, open
  questions). This is the contract — authored once, versioned, reviewed.
- `docs/RUNBOOKS/draft-engine-v2-operations.md` — stub pointing to the
  spec; filled in through Phases 3–7.

Infrastructure verification (pre-flight, no migrations yet):
- Confirm Postgres version on staging via
  `SELECT version();` — must be <17.6.1.016 OR ≥ post-fix version to
  avoid the pgmq `drop_queue` overload bug.
- Confirm pgmq is installable:
  `SELECT * FROM pg_available_extensions WHERE name='pgmq';`
- Confirm pg_cron sub-minute works on staging by scheduling a test job
  at `*/10 * * * * *` and verifying 6 runs/min in `cron.job_run_details`.
- Confirm `net.http_post` (pg_net) is available — required for the
  keep-alive cron job that re-invokes the long-running worker.
- **Realtime concurrency cap:** check current Supabase tier's max
  concurrent realtime connections (Pro standard tier is ~500). Target
  scale = 500 drafts × ~20 clients = 10,000 concurrent subscribers.
  If current cap is insufficient, surface this to the user before any
  implementation begins — may require tier upgrade, channel
  consolidation strategy, or scope reduction. Document the answer.
- Edge Function max duration: confirm 150s ceiling on current plan
  (this is what the long-running worker depends on).
- Document the exact staging Postgres version, pgmq version, pg_cron
  version, Edge Function runtime version, and Realtime connection cap
  in the runbook.
- **Column-name collision check (issue #4):** before Phase 1 writes any
  ALTER TABLE, run `SELECT column_name FROM information_schema.columns
   WHERE table_name='leagues' AND column_name IN ('feature_flags',
   'draft_event_counter','pick_deadline','draft_state',
   'draft_generation','draft_shadow_mode')`. If any rows return,
  surface to the user before Phase 1. Likely outcomes: (a) reuse the
  existing `feature_flags` JSONB by namespacing v2 keys inside it
  (`feature_flags->>'draft_engine_v2_enabled'`) instead of adding a
  new column; (b) rename the new column to avoid collision; (c)
  inspect the pre-existing column's data and decide on migration.
  Phase 0 documents the answer; Phase 1 only proceeds once resolved.

Decisions made now (resolved in Phase 0, not deferred):
- **Worker topology = single long-running Edge Function.** Loops ≤150s
  internally, polls pgmq every 5s, returns when budget exhausted or
  queue idle for ≥30s. A pg_cron job re-invokes every 2 minutes as a
  keep-alive. Rationale: avoids cold-start latency during active drafts,
  prevents overlapping invocations, gives one observable log stream per
  150s window, matches Supabase's own pgmq worker example.
- **Autopick decision logic = TypeScript in Edge Function.** Reuses
  existing heuristic from `DraftRoom.tsx:2410-2524`, easier to unit
  test, easier to evolve.
- **Projection model = synchronous trigger projection** (principle 6).
  `draft_picks_v2` is the trigger-maintained cache.
- **pgmq lifecycle = archive (not delete) after processing.** Forensics
  + replay value outweigh storage cost at our volume. Revisit if
  archive table grows past 10M rows.

Verify: spec doc merged; staging pre-flight checks all pass and are
documented in the runbook. No runtime changes.

### Phase 1 — Event log foundation + clock sync endpoint
**PR size: small–medium.** Purely additive; v1 unaffected.

Files to create:
- `supabase/migrations/<ts>_draft_engine_v2_foundation.sql`
  - `draft_events` table per spec §3:
    - `id bigserial primary key`
    - `league_id uuid not null references leagues(id)`
    - `seq bigint not null` — gap-free per-league
    - `event_type text not null` — closed enum from spec §6 catalog,
      enforced by CHECK: `pick | pick_undone | autopick_failed |
      draft_started | draft_paused | draft_resumed | draft_extended |
      draft_completed | draft_cancelled | commissioner_override |
      generation_bumped`. Stubs for `pick_undone` and
      `commissioner_override` are reserved here for forward
      compatibility (their RPCs ship in v2.1; see "Out of scope" below).
    - `event_version smallint not null default 1`
    - `payload jsonb not null` — schema per event type validated by
      `validate_draft_event_payload(event_type, payload)` function;
      called from inside `submit_pick_v2` / `append_draft_event`.
    - `payload_hash text not null` — sha256 of canonical JSON
    - `idempotency_key uuid` — unique where not null
    - `actor jsonb not null` — `{kind, id?, session_id?}` where
      `kind` is enforced via CHECK to closed enum:
      `user | autopick | commissioner | shadow | system`. JSONB for
      forward extensibility of metadata fields, enum locked for audit
      integrity.
    - `causation_id bigint references draft_events(id)` — nullable;
      identifies the event that caused this one (e.g. autopick caused
      by deadline-expiry sweep event).
    - `correlation_id uuid not null` — source per event type:
      - `kind=user`: client-generated UUID propagated via
        `X-Correlation-Id` header (or generated server-side if absent).
      - `kind=autopick`: worker-generated UUIDv4 at the start of
        message processing (issue #9 fix), propagated through
        `submit_pick_v2` and any follow-on events. The pgmq `msg_id`
        is *separately* recorded in the event payload as
        `payload.pgmq_msg_id` for forensic queue-traceability — but
        the correlation ID is a fresh UUID per worker invocation,
        which simplifies the schema (correlation_id stays a real UUID
        rather than a hash) and decouples it from any pgmq
        implementation detail.
      - `kind=commissioner`: client-generated UUID from admin UI.
      - `kind=shadow`: derived from v1 trigger `(league_id, pick_id)`.
      - `kind=system`: migration ID or `gen_random_uuid()`.
    - `created_at timestamptz not null default now()`
    - Unique `(league_id, seq)`
    - Partial unique on `idempotency_key where idempotency_key is not null`
    - Index `(league_id, created_at)` for replay windows
    - Index `(correlation_id)` for trace joins
  - `draft_picks_v2` table (synchronous projection of `draft_events`,
    per principle 6). Schema mirrors v1 `draft_picks` but is rebuilt
    only from events. Columns: `(league_id, pick_number, round, team_id,
    player_id, picked_at, picked_by_actor jsonb, source_event_id bigint
    references draft_events(id), source_seq bigint)`. Unique
    `(league_id, pick_number)`. RLS = same as v1 `draft_picks`.
  - `leagues` column additions:
    - `draft_event_counter bigint not null default 0` — per-league
      gap-free sequence source (advanced inside `submit_pick_v2` txn).
    - `pick_deadline timestamptz` — promoted out of JSONB; null = not
      drafting.
    - `draft_state text not null default 'not_started'` — state machine
      from spec §5.1 (`not_started|pre_draft|active|paused|completed|cancelled`),
      CHECK-enforced.
    - `draft_generation int not null default 0` — bumped on every
      pause→resume cycle and on `draft_extended`. Used to namespace
      autopick idempotency keys so post-pause re-fires don't collide
      with pre-pause keys (issue #8). Bump emits a `generation_bumped`
      event.
    - `draft_shadow_mode boolean not null default true` — toggled off
      only after Phase 8 exit.
    - `feature_flags jsonb not null default '{}'::jsonb` — for
      `draft_engine_v2` per-league flag in Phase 5.
  - RLS: `draft_events` and `draft_picks_v2` readable by league members
    only; writable only by service role (all writes go through RPCs).
  - No RPCs yet — those land in Phase 2.
- `server/src/routes/draftV2Sync.ts` (new file)
  - `GET /api/draft/v2/league/:leagueId/sync` — returns
    `{server_time, pick_deadline, current_seq, current_pick_number,
      draft_state, payload_hash}`.
  - Designed for multi-sample polling: cheap, cacheable for 100ms.
- `server/src/app.ts` — mount sync route (no pick route yet).

Tests:
- Migration test: insert 100 events across 3 leagues, assert
  `(league_id, seq)` gap-free per league, global `id` monotonic.
- `draftV2Sync.test.ts` — endpoint returns consistent snapshot.

Verify:
- `supabase db push` applies cleanly on staging.
- `SELECT * FROM draft_events` returns empty.
- `curl /api/draft/v2/league/$ID/sync` returns 200 with null deadline.
- No v1 regression: existing draft flow on staging unchanged
  (smoke-test one fake draft via prior tooling).

### Phase 2 — Idempotent pick RPC + event replay endpoint
**PR size: medium.** Still no client change. No scheduler yet.

Files to create:
- `supabase/migrations/<ts>_submit_pick_v2.sql`
  - `submit_pick_v2(p_league_id, p_team_id, p_player_id, p_round,
      p_pick_number, p_session_id, p_idempotency_key uuid,
      p_payload_hash text, p_actor jsonb,
      p_correlation_id uuid)` RPC:
    - `SECURITY DEFINER` with `SET search_path = public`.
    - Preflight checks (spec §5.2 state machine):
      - League exists, state = `active`.
      - `pick_number` matches `current_pick_number` derived from events.
      - Team is on the clock (derived from snake/linear order).
      - Player is not already picked (derived from events).
      - Caller is authorized via `auth.uid()` → team membership OR
        actor.kind = 'autopick' (service-role only).
    - Within one transaction:
      1. `SELECT ... FROM draft_events WHERE idempotency_key = $key FOR UPDATE`.
         If found: compare `payload_hash`. Match = return existing event
         (idempotent replay). Mismatch = raise `idempotency_conflict`.
      2. `UPDATE leagues SET draft_event_counter = draft_event_counter + 1
          RETURNING draft_event_counter` — advances gap-free seq.
      3. `INSERT INTO draft_events (...) ON CONFLICT (idempotency_key)
          DO NOTHING RETURNING *`. The insert writes
          `correlation_id := COALESCE(p_correlation_id,
          gen_random_uuid())` into the new event's
          `correlation_id` column — workers (autopick) supply their
          per-message UUIDv4 here; user-path callers pass the value
          received via `X-Correlation-Id` (or null to let the RPC
          generate one server-side). If nothing returned, another txn
          won the race — SELECT and return that row.
      4. AFTER INSERT trigger `tg_draft_events_project_pick` fires
         in-txn: for `event_type='pick'`, INSERT into `draft_picks_v2`
         from the event payload; for `pick_undone`, soft-delete; for
         start/pause/resume, no projection write. This is the
         synchronous projection (principle 6). The trigger is the
         **only** writer to `draft_picks_v2`.
      5. Recompute next `pick_deadline`. **Round to whole seconds via
         CEIL** to match pgmq's integer-second `send_delay` resolution
         (issue #5 fix):
         ```sql
         pick_deadline := date_trunc('second', now())
                        + make_interval(secs => ceil(extract(epoch
                            from league.pick_time_limit))::int)
                        + interval '1 second';  -- pad up
         ```
         This guarantees the autopick fires *after* the user-visible
         timer hits zero, never before. Worst-case extra grace ≈1s on
         a 90s timer; on a 10s tournament timer the +1s pad is still
         conservative (better one second late than one millisecond
         early). `UPDATE leagues SET pick_deadline = ...`.
      6. Enqueue deadline message using **send_delay** (not VT — issue #1
         fix). With deadline already aligned to whole seconds, the
         delay computation is exact:
         ```sql
         pgmq.send(
           'draft_deadlines',
           jsonb_build_object(
             'league_id', league_id,
             'pick_number', new_pick_number,
             'generation', league.draft_generation,
             'scheduled_for', pick_deadline
           ),
           GREATEST(0, ceil(EXTRACT(EPOCH FROM (pick_deadline - now())))::int)
         );
         ```
         The worker sets vt=30s when it later reads — completely
         independent of the deadline. **No attempt is made to cancel
         in-flight messages** when a draft pauses, generation bumps,
         or the user picks before the deadline (issue #1 architectural
         fix). Stale messages are no-ops at worker read time: see Phase
         4 worker logic. This is what the `generation` field in the
         payload is for — the worker compares it against
         `leagues.draft_generation` and discards mismatches.
      7. Return `{event_id, seq, pick_deadline, was_duplicate}`.
  - `append_draft_event(...)` helper RPC for non-pick events (start,
    pause, resume, cancel, extend) — same seq mechanism, no
    pick-specific checks.
  - `record_shadow_event(p_league_id, p_payload jsonb,
      p_idempotency_key uuid, p_payload_hash text,
      p_correlation_id uuid)` RPC — **shadow-mode-only path**
      (round-2 fix #3 avoidance + this round's gap fix). Called
      exclusively by the v1→v2 trigger introduced in Phase 8. Writes
      a `draft_events` row with `actor.kind='shadow'` and
      **completely skips the state-machine preflight** that
      `submit_pick_v2` runs (no `pick_number`-vs-current check, no
      on-the-clock check, no already-picked check, no auth check
      beyond service role). Rationale: in shadow mode v1 is the
      source of truth — v2 is recording, not validating. The
      `draft-shadow-diff` job is what catches divergence;
      `record_shadow_event` must not double-validate or shadow
      mode breaks silently the first time v1 does anything atypical
      (commissioner SQL fix, batched insert, error-path retry that
      double-fires the trigger). Hard guards baked in:
      - `RAISE EXCEPTION` if `auth.role() != 'service_role'`.
      - `RAISE EXCEPTION` if `(payload->'actor'->>'kind') != 'shadow'`
        — the only legal actor kind for this RPC.
      - `RAISE EXCEPTION` if `leagues.draft_shadow_mode = false` for
        this league — defends against the trigger firing during
        cutover when shadow mode has been turned off.
      Still goes through the same idempotency-key + seq machinery
      and fires the same `tg_draft_events_project_pick` trigger
      (writing to `draft_picks_v2`), so the projection still gets
      built — it just gets built without preflight gating. Invariant
      I16 (projection ↔ log) catches any actual corruption.
  - `reconstruct_draft_state(p_league_id)` RPC — reads events, returns
    `{picks[], current_pick_number, on_the_clock_team_id, completed_rounds}`.
    Used as a **rebuild/repair** tool (seed `draft_picks_v2` on
    migration, integrity verification, post-corruption recovery). The
    hot-path read is `draft_picks_v2`. Principle 6.
  - **Commissioner state-transition RPCs (in v2.0 scope).** None of
    these attempt to cancel queued pgmq messages — the worker
    no-ops stale messages by checking `(draft_state, generation)`
    against the message payload (issue #1 architectural fix; full
    logic in Phase 4):
    - `draft_pause(p_league_id, p_actor)` — bumps `draft_generation`,
      sets `draft_state='paused'`, clears `pick_deadline`, emits
      `generation_bumped` then `draft_paused` events. Any pgmq message
      already in flight for the prior generation will, when the worker
      reads it, see `draft_state != 'active'` OR mismatched generation
      and archive it as stale.
    - `draft_resume(p_league_id, p_actor)` — bumps `draft_generation`,
      sets `draft_state='active'`, sets new `pick_deadline`, enqueues
      a fresh pgmq message tagged with the new generation, emits
      `generation_bumped` then `draft_resumed`. The generation bump
      both makes pre-pause queued messages no-op at the worker AND
      prevents autopick idempotency-key collision (issue #8) post-resume.
    - `draft_extend(p_league_id, p_extra_seconds, p_actor)` — bumps
      `draft_generation`, extends `pick_deadline` (whole-second
      rounded), enqueues a fresh pgmq message at the new delay,
      emits `generation_bumped` then `draft_extended`. The previously
      queued message becomes a no-op at worker read time (mismatched
      generation).
    Net effect: pause/resume/extend are simple state mutations + new
    enqueue + event emission. No queue-introspection, no pgmq.delete
    calls (which would not work as written — pgmq.delete takes a
    msg_id, not a payload predicate, and hidden-by-send_delay messages
    are unreadable until visible). The state machine + generation
    counter does the cancellation work for free.
  - **Commissioner override / pick-undo (deferred to v2.1):** event
    types `commissioner_override` and `pick_undone` reserved in Phase 1
    enum. Schemas stubbed in spec §6 but RPCs not implemented in v2.0.
    Spec note: undo is rejected if any subsequent pick has been made
    (no cascading unwind in v2.x — too easy to corrupt audit trail).
    v2.1 may revisit.

Files to create:
- `server/src/services/DraftServiceV2.ts` — wraps `submit_pick_v2`, adds
  broadcast. Broadcast is best-effort; event log is authoritative.
  - **Strict ordering: broadcast happens AFTER the RPC returns
    successfully (issue #7).** Broadcasting before the database commits
    would let subscribers receive an event the DB might not yet have —
    and on rollback, broadcast a phantom. Sequence is:
    1. Call `submit_pick_v2` (RPC commits internally).
    2. Receive `{event_id, seq, ...}`.
    3. Build broadcast payload from the returned row (NOT from the
       caller's input — the row is the canonical truth, including the
       server-assigned `seq` and `created_at`).
    4. `supabase.channel(...).send(...)`. Errors here are logged and
       counted (`broadcast_send_failed` metric) but not surfaced to
       the user — the steady-state poll + reconnect replay catches
       any broadcast that drops on the floor (principle 4).
  - **Realtime channel authorization (issue #8).** The broadcast
    channel `draft_events_v2:${leagueId}` is **not access-controlled
    at the channel layer.** Anyone who knows a league ID can subscribe
    and observe broadcasts. This is acceptable because: (a) league IDs
    are not secret in our model — they appear in URLs; (b) broadcast
    payloads contain only public draft information (no PII, no
    sensitive scoring); (c) the authoritative read path is
    `GET /api/draft/v2/league/:leagueId/events`, which IS
    RLS-protected via `draft_events`'s policies (league-member-only).
    The broadcast is a latency optimization on top of the
    RLS-protected REST path, not a substitute for it. This is
    documented in the runbook and re-confirmed in Phase 6
    (observability section) as part of the security review.
- `server/src/routes/draftV2Pick.ts`
  - `POST /api/draft/v2/league/:leagueId/pick` — requires
    `Idempotency-Key` header (UUID), computes `payload_hash` server-side,
    calls service. Maps `idempotency_conflict` → 409.
- `server/src/routes/draftV2Events.ts`
  - `GET /api/draft/v2/league/:leagueId/events?since_seq=N&limit=500` —
    replay endpoint; enforces membership; caps at 500 rows per response
    with `next_since_seq` cursor.
  - **Rate limit (issue #5):** per `(client_session_id, league_id)`,
    10 replay requests per 30-second sliding window. 11th request
    returns 429 with `Retry-After`. Backed by an in-memory token bucket
    in the Hono app (per-process is fine: a misbehaving client is
    pinned to one Cloud Run instance via session affinity).
  - **Cache headers:** for any response where every event in the
    returned range is from a `draft_state in ('completed','cancelled')`
    league, set `Cache-Control: public, max-age=86400, immutable`.
    Completed-draft replays are immutable and CDN-cacheable.
  - `/sync` already returns `current_seq` (Phase 1) — clients short-circuit
    replay when `lastSeq === current_seq`.
- Update `server/src/app.ts` to mount new routes.

Tests:
- `server/src/__tests__/DraftServiceV2.test.ts`:
  - Idempotent replay returns same `event_id`, same `seq`, no new row.
  - Conflicting payload under same key → `idempotency_conflict` error.
  - Out-of-order `pick_number` → rejected.
  - Wrong team on the clock → rejected.
  - Player already picked → rejected with distinct error code.
  - Concurrent submits with same `pick_number` → exactly one wins.
- SQL test: `reconstruct_draft_state` over 180 events matches hand-rolled
  oracle for a 12-team × 15-round snake draft.

Verify:
- `curl -X POST /api/draft/v2/.../pick -H 'Idempotency-Key: ...'` twice
  returns same response; one row in `draft_events`.
- `seq` strictly increases per league, never has gaps.
- `/events?since_seq=0` returns full draft history in order.

### Phase 3 — pgmq scheduler + pg_cron safety-net sweep
**PR size: medium.** No client change. Worker exists as no-op consumer.

Files to create:
- `supabase/migrations/<ts>_draft_engine_v2_scheduler.sql`
  - `CREATE EXTENSION IF NOT EXISTS pgmq WITH SCHEMA extensions;`
  - `SELECT pgmq.create('draft_deadlines');` — the primary deadline queue.
  - `draft_deadline_sweep()` RPC (SECURITY DEFINER, search_path=public):
    - **Race-free predicate (issue #2 fix).** Do NOT inspect pgmq
      internals to dedupe — pgmq doesn't expose a documented
      "predicate-match in-flight messages" query, querying its
      underlying tables is implementation-dependent, and any
      check-then-send is TOCTOU-racy across concurrent sweeps. Instead
      rely on the autopick idempotency key + state-machine no-op for
      safety. The sweep enqueues unconditionally for any league whose
      current pick slot has not yet been resolved:
      ```sql
      SELECT l.id, l.draft_generation, l.pick_deadline
      FROM leagues l
      WHERE l.draft_state = 'active'
        AND l.pick_deadline IS NOT NULL
        AND l.pick_deadline < now() - interval '2 seconds'
        AND NOT EXISTS (
          -- has a pick or autopick_failed event already landed for
          -- the current pick slot since the deadline expired?
          SELECT 1 FROM draft_events e
          WHERE e.league_id = l.id
            AND e.event_type IN ('pick','autopick_failed')
            AND (e.payload->>'pick_number')::int =
                 (SELECT count(*) + 1 FROM draft_events e2
                  WHERE e2.league_id = l.id
                    AND e2.event_type = 'pick')
            AND e.created_at > l.pick_deadline
        );
      ```
      For each row returned: `pgmq.send('draft_deadlines',
      jsonb_build_object('league_id', id, 'generation',
      draft_generation, 'pick_number', current_pick, 'scheduled_for',
      pick_deadline, 'source', 'safety_net'), 0)` and increment
      `safety_net_hit` metric.
    - **Why this is safe under duplicate enqueue.** If a duplicate
      message gets through (e.g. a prior message is also in flight),
      the worker handles it: both messages call `submit_pick_v2` with
      the same idempotency key `(league_id, pick_number, generation,
      'autopick')`. The first wins. The second receives
      `was_duplicate=true` and archives. At-most-once pick semantics
      are preserved by the unique index on `idempotency_key`, not by
      queue-side de-dupe.
  - `draft_metrics` table — **partitioned by RANGE on `ts` monthly**
    from day one (issue #11): `CREATE TABLE draft_metrics (ts
    timestamptz not null, metric text not null, league_id uuid,
    value bigint not null default 1, detail jsonb) PARTITION BY RANGE
    (ts);`. Migration creates partitions for current + next 3 months;
    `pg_cron` job creates a new partition monthly and drops partitions
    older than 90 days (counters retained in a downsampled
    `draft_metrics_daily` summary table for long-horizon dashboards).
    Per-event raw rows are not the long-term store.
  - `cron.schedule('draft-deadline-sweep', '*/10 * * * * *',
     'SELECT draft_deadline_sweep()')` — sub-minute confirmed available.
  - Advisory lock `pg_try_advisory_xact_lock(hashtext('draft-sweep'))`
    so overlapping sweeps no-op.

Files to create (worker — long-running per Phase 0 decision):
- `supabase/functions/draft-autopick/index.ts` — single long-running
  worker (stub → real in Phase 4):
  - On invocation: record `start_ts = Date.now()`. Loop while
    `Date.now() - start_ts < 140_000` (10s headroom under 150s ceiling):
    - `pgmq.read('draft_deadlines', vt=30, qty=10)`.
    - If no messages: track `idle_since`. If `idle_since` >30s ago,
      return early (saves Edge Function compute; keep-alive cron will
      re-invoke within 2 min).
    - For each message: verify deadline expired (read fresh
      `leagues.pick_deadline`), log, `pgmq.archive(msg_id)`. Phase 3
      no-ops on processing logic; Phase 4 fills in the state machine.
    - Sleep 5s if loop continues.
  - Worker is single-instance per project: pgmq's `read(vt=...)` makes
    overlap safe even if two workers run, but the keep-alive cadence
    (2 min) ensures only one is alive at any time outside the
    cold-restart window.
- `supabase/functions/_shared/supabaseClient.ts` (if not present) — Deno
  service-role client factory.

Worker keep-alive:
- `cron.schedule('draft-autopick-keepalive', '*/2 * * * *',
   'SELECT net.http_post(<edge-fn-url>, headers, body)')` — 2-min
  cadence is enough: a 150s worker plus 2-min cron means
  near-continuous coverage (10s gap max). During this gap, the
  pg_cron sweep (every 10s) catches any expired deadlines and
  re-enqueues them for the next worker invocation.

Tests:
- SQL: manually expire 3 leagues' `pick_deadline`, run sweep,
  assert 3 pgmq messages enqueued. The sweep does NOT have queue-side
  de-dupe (per round-2 fix #2). Two assertions, split:
  - **After worker commit:** expire 3 leagues, run sweep (3
    enqueued), let the worker process all 3 to commit picks, run
    sweep again — assert 0 enqueued. The EXISTS-over-`draft_events`
    predicate excludes leagues whose current slot is already filled.
  - **Before worker commit:** expire 3 leagues, run sweep twice
    back-to-back without letting the worker run — assert 6 messages
    enqueued (3 + 3 duplicates), then run the worker and assert
    exactly 3 picks committed (one per league). Duplicates are
    tolerated by the autopick idempotency key
    `(league_id, pick_number, generation, 'autopick')`; the second
    pass returns `was_duplicate=true` and archives. This proves the
    no-dedupe design's correctness invariant under expected races.
- SQL: advisory-lock contention — run 5 concurrent sweeps, assert only
  one does work.
- Edge Function unit test (Deno test): reads messages, archives cleanly,
  no-ops on missing league.

Verify:
- On staging: insert a fake league with `pick_deadline = now() - 1min`,
  wait 15s, confirm pgmq message appears, worker archives it, metric
  row `safety_net_hit` increments.
- `cron.job_run_details` shows both jobs firing on schedule.

### Phase 4 — Autopick state machine (worker filled in)
**PR size: medium.** No client change. This is where autopick actually
picks players.

Files to modify:
- `supabase/functions/draft-autopick/index.ts` — implement spec §5.2:
  1. Pull message via `pgmq.read('draft_deadlines', vt=30, qty=10)`.
     Each message has `msg_id`, `read_ct` (read count, incremented by
     pgmq on every read), and the JSON `message` payload.
  2. **Retry budget (issue #3 fix).** `pgmq` does NOT have a built-in
     `read_retry_count` config that auto-DLQs after N attempts. The
     worker must check `read_ct` itself:
     ```ts
     if (msg.read_ct >= 3) {
       await dlqInsert(msg);                  // see DLQ table below
       await emitAutopickFailedEvent(msg);    // append_draft_event
       await pgmq.archive('draft_deadlines', msg.msg_id);
       pageOnCall({ league_id, msg_id, read_ct: msg.read_ct });
       continue;
     }
     ```
     `pgmq.archive` removes the message from the active queue and
     stores it in the per-queue archive table for forensics.
  3. Generate a fresh `correlation_id = crypto.randomUUID()` for this
     message-processing pass (issue #9). All events emitted by this
     attempt share this ID. Record `pgmq_msg_id` separately in
     `payload.pgmq_msg_id` for queue-traceability.
  4. Read league state via `reconstruct_draft_state`. **Stale-message
     no-op checks (issue #1):**
     - If `league.draft_state != 'active'`: archive, log
       `worker_skip_state`, no-op.
     - If `msg.message.generation != league.draft_generation`:
       archive, log `worker_skip_generation`, no-op. This is what
       turns pause/resume/extend's queued messages into harmless
       garbage.
     - If `now() < league.pick_deadline`: archive, log
       `worker_skip_premature` (deadline was extended after enqueue).
     - If `msg.message.pick_number != current_pick_number`: archive,
       log `worker_skip_pick_advanced` (a human picked between
       enqueue and read).
  5. Determine on-the-clock team; read `draft_queues` for that team.
     If no `draft_queues` row: fall back to in-function heuristic
     (FPTS × positional need, ported from `DraftRoom.tsx:2410-2524`).
  6. Call `submit_pick_v2` with:
     - `p_idempotency_key` = deterministic UUID v5 namespace-hashed
       from `(league_id, pick_number, generation, 'autopick')`
       (issue #8 fix). Generation from the pgmq message payload makes
       post-pause/resume keys fresh even at the same pick_number.
       Double-tick within the same generation still returns the same
       event; no double-pick possible.
     - `p_actor = {kind: 'autopick'}`.
     - `p_correlation_id` = the UUIDv4 from step 3.
     - `p_payload_hash` computed over canonical JSON.
  7. On success: archive pgmq message. Metric `autopick_fired`.
  8. On `idempotency_conflict`: archive, log as "already picked"
     (human submitted just in time) — expected, not an error.
  9. On retryable error (DB timeout, transient pgmq error): do NOT
     archive. The pgmq visibility timeout (30s) expires and pgmq
     redelivers. `read_ct` increments on the next read; step 2 caps
     attempts at 3.

Files to create (DLQ surface):
- Add to scheduler migration: `autopick_failures (id bigserial pk,
   league_id uuid, pgmq_msg_id bigint, payload jsonb,
   last_error text, read_ct int, failed_at timestamptz default now())`.
   RLS: admin-only. Inserted when `read_ct >= 3`. Simpler than a
   separate pgmq DLQ queue — humans inspect a table during incidents,
   not a queue. Pages on insert via existing `alerts` trigger pattern.

Files to create:
- `supabase/migrations/<ts>_draft_queues.sql` — if not exists, per
  spec §3:
  - `draft_queues (team_id uuid, league_id uuid, position smallint,
     player_id int, created_at timestamptz)`
  - Unique `(team_id, player_id)` and `(team_id, position)`.
  - RLS: team members can read/write their team's queue.
- `supabase/functions/draft-autopick/heuristic.ts` — ported fallback
  heuristic with unit tests.
- `supabase/functions/draft-autopick/__tests__/` — Deno tests for each
  branch of the state machine above.

Tests:
- Unit: state machine with mocked Supabase client — every branch.
- Integration (staging): create a league with 10-second timer, no
  clients connected, assert the worker autopicks all 180 picks within
  (rounds × timer + grace). Assert `draft_events` has 180 picks, all
  with distinct `seq`, in strict order.
- Double-tick test: manually send 2 pgmq messages for the same league
  at the same deadline — assert exactly one pick added, one
  `idempotency_conflict` logged.

Verify:
- On staging: kill all clients mid-draft, draft completes unaided.
- `draft_metrics.autopick_fired` matches number of autopicks observed.

### Phase 5 — v2 client (clock, event stream, dual-path updates)
**PR size: medium-large.** Behind feature flag. `DraftRoom.tsx` gets a
single `if (flag) return <DraftRoomV2/>` branch at the top.

Files to create:
- `apps/web/src/features/draft-v2/engine/DraftClock.ts`
  - Multi-sample sync (spec §2 principle): fires 5 `/sync` requests at
    mount with 150ms gaps, records RTT for each, picks the sample with
    minimum RTT, computes offset = `server_time - (client_t_send + rtt/2)`.
  - `getRemainingMs()` reads `pickDeadline - (Date.now() + offset)`.
  - Re-syncs on reconnect and every 5 minutes during long drafts.
  - Drift guard: if two consecutive 5-min resyncs show offset drift >500ms,
    emit `clock_drift_detected` event to client telemetry.
- `apps/web/src/features/draft-v2/engine/DraftEventStream.ts`
  - Subscribes to `draft_events_v2:${leagueId}` realtime broadcast.
  - Tracks `lastSeq`; on broadcast arrival verifies `seq === lastSeq + 1`.
    On gap: pauses broadcast handling and calls `/events?since_seq=lastSeq`
    to replay; resumes broadcast after catch-up.
  - On reconnect: same replay path.
  - **Steady-state poller:** every 5s calls `/sync`. If server's
    `current_seq > lastSeq`: replay. Per spec principle 4, this is the
    safety net against silent broadcast drops.
- `apps/web/src/features/draft-v2/engine/EventReducer.ts`
  - Pure function: `(state, event) => state'`. This is the client-side
    mirror of server `reconstruct_draft_state`. Event log → derived
    draft state. Unit-tested against shared fixtures with the server.
- `apps/web/src/features/draft-v2/engine/DraftEngineStore.ts` — engine
  state lives in a **module-scoped Zustand store**, not in React
  context (issue #6 fix). React components subscribe via selectors;
  the store survives any route unmount/remount. This is what
  large-scale draft UIs do — context-based engines die at the route
  boundary, which is exactly the bug the mini-bar pattern needs to
  avoid.
- `apps/web/src/features/draft-v2/engine/useDraftEngine.ts` — thin
  React hook over the Zustand store, exposing `{ timeRemaining,
    currentPick, picks, onTheClockTeam, submitPick, connectionState }`.
  Connection lifecycle (broadcast subscribe, poll loop, replay) is
  managed by the store, not the hook — so multiple components calling
  the hook do not multiply connections, and unmounting does not tear
  them down. The store is initialized once per `leagueId` (idempotent)
  and torn down only on explicit `disposeDraftEngine(leagueId)` call
  (e.g. when navigating away from any league screen, or on logout).
- `apps/web/src/features/draft-v2/DraftRoomV2.tsx` — v2 page. Subset
  of v1 UI surfaced first (clock, pick list, queue, chat). Do NOT
  re-implement trade/roster/waiver panes in this PR — v2 scope is the
  live draft only.
  - **Non-draft panes (issue #12):** for routes like
    `/league/:id/roster`, `/league/:id/trades`, `/league/:id/waivers`
    accessed during a v2 draft, `DraftRoomV2` does NOT render them.
    The user navigates away from `DraftRoomV2` and the regular v1
    pages render those panes as they always have. The
    `DraftEngineStore` keeps running because it's module-scoped, so
    the broadcast subscription, the poll loop, and the cached event
    log persist across navigation — no reconnection cost.
    `DraftV2MiniDeckBar.tsx` reads from the same store and renders a
    persistent floating bar showing the timer and the current pick
    while the user is on roster/trades/waivers. Mounted in the
    league-layout component (see below), conditional on
    `draft_state IN ('pre_draft','active','paused')`.
- `apps/web/src/layouts/LeagueLayout.tsx` (existing — modify, do not
  create): mount `<DraftV2MiniDeckBar leagueId={leagueId} />`
  conditionally, and ensure the store is initialized at this layout
  level rather than inside `DraftRoomV2`. The layout is an ancestor
  of all `/league/:id/*` routes, so the store initialization survives
  child route changes. The mini-bar and `DraftRoomV2` both subscribe
  to the same store instance.
- Tests:
  - `DraftClock.test.ts` — offset calc with fake RTTs, drift detection.
  - `DraftEventStream.test.ts` — gap detection, replay, dual-path
    reconciliation, simulated broadcast drop.
  - `EventReducer.test.ts` — shared fixture tests against server oracle.

Files to modify:
- `apps/web/src/pages/DraftRoom.tsx` — at the top of the component:
  ```ts
  const useV2 = useFeatureFlag('draft_engine_v2', leagueId);
  if (useV2) return <DraftRoomV2 leagueId={leagueId} />;
  ```
  Nothing else in the file changes.
- `apps/web/src/config/featureFlags.ts` — create if missing. Sources
  flag from `leagues.feature_flags` JSONB with per-league override,
  falls back to env default.
  - **Client-side delivery path (issue #10).** The flag value is
    bundled into the existing `GET /api/league/:id` response, not
    fetched from a separate endpoint. `LeagueService` (server)
    already returns the league row; extend it to include
    `feature_flags` (or expose a derived `feature_flags_resolved`
    field merging row + env defaults so the client doesn't have to
    reimplement merge logic). The client `LeagueContext` populates
    `useFeatureFlag(name, leagueId)` from the cached league response.
    Verify in Phase 0: confirm `leagues.feature_flags` column is
    readable under the existing RLS policy for league members; if
    not, extend the policy. No new endpoint, no extra round trip.

Non-goals for this phase (explicit):
- v2 client **never** calls autopick.
- v2 client **never** computes the current pick number from wall time —
  only from the event log.
- No migration of v1 users. v1 remains default.

Verify:
- Feature flag off: v1 behaves identically (regression smoke test).
- Feature flag on for one staging league: full 12×15 draft completes
  with live human clients, broadcast + poll both firing, zero gaps
  in client-side event log.

### Phase 6 — Invariant monitoring + observability contract
**PR size: medium.** No behavior change; adds runtime proofs.

Files to create:
- `supabase/migrations/<ts>_draft_invariants.sql` — implement I1–I16
  from spec §8 as individual SQL predicates, each returning 0 rows when
  healthy, ≥1 row when violated. Examples (complete list in spec):
  - **I1:** per-league `seq` is gap-free — `SELECT league_id FROM (
     SELECT league_id, seq, seq - row_number() OVER (PARTITION BY
     league_id ORDER BY seq) AS g FROM draft_events) t
     GROUP BY league_id, g HAVING count(*) < max_seq_gap`.
  - **I2:** every `pick` event has a matching team-on-clock per snake
    order.
  - **I3:** no player picked twice in a league.
  - **I4:** `idempotency_key` uniqueness holds globally.
  - **I5:** `pick_deadline` is always in the future when `draft_state=active`.
  - **I6:** active leagues have a pgmq message OR a safety-net sweep
    touched them in last 15s.
  - (I7–I16 per spec.)
  - `check_draft_invariants()` RPC — runs all predicates, INSERTS any
    violations into `draft_invariant_violations (id, invariant, league_id,
    detected_at, detail jsonb)`.
  - `cron.schedule('draft-invariants', '0 * * * * *',
     'SELECT check_draft_invariants()')` — every 60s.
  - Trigger: AFTER INSERT on `draft_invariant_violations` → emits to
    `alerts` table + webhook (page on-call).
- `server/src/routes/draftV2Metrics.ts`
  - `GET /api/admin/draft/v2/metrics` — admin-only, returns current
    `draft_metrics` counters + recent violations.
- `apps/web/src/features/admin/DraftEngineHealthPage.tsx` — simple
  dashboard reading the metrics endpoint. Shows: autopick_fired rate,
  safety_net_hit rate, broadcast vs poll reconciliation count, current
  invariant violations. Only visible to admins.

Observability additions per spec §9:
- Every `submit_pick_v2` logs structured JSON: `{event_id, seq,
   league_id, latency_ms, idempotent_replay, actor_kind}`.
- Every autopick Edge Function invocation logs:
   `{msg_id, league_id, outcome:'picked'|'already_picked'|'retry'|'fatal',
     latency_ms, attempt}`.
- Client telemetry events posted to `/api/telemetry/draft`:
   `clock_drift_detected`, `broadcast_gap_detected`,
   `reconnect_replay_triggered`, with aggregate counts only (no PII).

Tests:
- SQL: seed a league with an artificial gap in `seq`, run
  `check_draft_invariants()`, assert I1 fires.
- Repeat for each of I2–I16 with a synthetic violation fixture.

Verify: staging runs for 48h with simulation harness (Phase 7) hammering
it. Zero I1–I16 violations. Metrics dashboard shows sensible numbers.

### Phase 7 — Simulation + chaos harness
**PR size: medium.** Staging-only; never runs in prod.

Files to create:
- `scripts/staging/05-simulate-draft.mjs`:
  - Spawns N headless clients via service role, each subscribes to
    realtime + posts picks with their own idempotency keys.
  - Config: team count, pick time limit, clients that "disconnect" at
    random intervals, clock-skew simulation per client (inject ±2s
    offset into `Date.now()` wrappers).
  - Asserts: no duplicate picks, no stalled draft, every `seq` present
    in every client's replay, I1–I16 clean, event log reconstruction
    matches `draft_picks` view.
- `scripts/staging/06-chaos-test.mjs`:
  - Kills random clients mid-draft.
  - Induces broadcast drops by toggling realtime channel subscriptions.
  - Simulates pgmq consumer outages by pausing the Edge Function
    dispatcher, asserts pg_cron safety-net sweep covers.
  - Runs a "commissioner quits" scenario — autopick must carry the
    draft to completion.
  - Runs a "double-ticked pgmq" scenario — exactly one pick must land.
- `scripts/staging/07-shadow-diff.mjs` (used in Phase 8, written here):
  - Given a completed draft that ran through both v1 and v2 (shadow
    mode), diffs the two event streams and reports mismatches.
- `docs/RUNBOOKS/draft-load-test.md` — how to run all three before any
  prod-facing flip.

Verify:
- `node scripts/staging/05-simulate-draft.mjs --teams=12 --rounds=15
   --duration=10m` — green run.
- `node scripts/staging/06-chaos-test.mjs` — green run across all
  scenarios.
- **48h soak with realistic traffic shape (issue #13):** not constant
  load — instead, simulate "draft season" pattern: bursts at 7pm/8pm/9pm
  Mountain Time (10–30 concurrent drafts), midday low (1–3 concurrent),
  overnight quiet (0 drafts for 6h). This surfaces cold-start issues,
  connection-pool recycling, keep-alive cadence holes, and pgmq message
  expiry interactions with idle periods. Constant load hides these.
  Implemented as `scripts/staging/08-soak-pattern.mjs --duration=48h
   --pattern=draft-season`. Acceptance: zero I1–I16 violations across
  the entire 48h, including the overnight-resume window.

### Phase 8 — Shadow mode (2+ weeks, every real draft)
**PR size: small (shadow-writer glue). Time cost: 2 weeks minimum.**

Shadow mode is **write-both, serve-v1**. Every real draft runs through
v1 as the user-facing system; v2 writes a parallel event log and is
continuously diffed.

**Phase 8a — Prod v2 schema deploy (readiness gate, separate PR).**
This is the first time any v2 artifact touches the prod Supabase
project. Everything prior has been staging-only. This deploy is
batched into a single release:

- All Phases 1–4 migrations (event log, RPCs including
  `record_shadow_event`, sweep function, queue setup) replayed onto
  prod in original timestamp order.
- `draft-autopick-worker` edge function deployed to prod but **not
  keep-alive-scheduled** (no pg_cron ping yet, no sweep enqueuing
  work — the worker sits idle).
- `draft-engine-v2-sweep` pg_cron job inserted but **scheduled with
  a dummy NEVER expression** (e.g. `'0 0 31 2 *'`) so it is
  installed but will never fire.
- `leagues.draft_shadow_mode` column added with default `false` for
  every league.

Acceptance for Phase 8a:
- All migrations succeed on prod with zero RLS/constraint violations.
- `SELECT count(*) FROM draft_events WHERE league_id IN (...)` returns
  zero for every existing prod league (v2 has observed nothing yet).
- Prod smoke test: the current live-draft v1 path still works
  identically (run one internal test draft on a throwaway league).
- Rollback rehearsal: in staging, `supabase db reset` + replay up
  to pre-Phase-8a and confirm v1 alone still passes Phase 5's
  simulator run.

If Phase 8a misbehaves, Phase 8b does not begin. The v2 schema is
inert — rolling it back is a migration-down script, not a user-facing
event.

**Phase 8b — Shadow writer enablement (this section's original
scope).** After Phase 8a has been quiet on prod for at least one
full day with zero errors, ship the shadow trigger below and flip
`draft_shadow_mode = true` on one league per real draft as drafts
occur.

Files to create:
- `supabase/migrations/<ts>_draft_engine_v2_shadow.sql`
  - Trigger on `draft_picks` INSERT: when `leagues.draft_shadow_mode =
    true`, call **`record_shadow_event(...)` (defined in Phase 2)**
    with a derived idempotency key
    `uuid_v5(league_id || ':' || pick_id, 'shadow')` and
    `actor.kind='shadow'`. The shadow trigger MUST NOT call
    `submit_pick_v2` — that RPC's preflight (current_pick_number,
    on-the-clock, not-already-picked, auth) would reject any time
    v1's authoritative state drifts from v2's reconstructed state
    (e.g. commissioner SQL fix, error-path retry, batched insert,
    out-of-order recovery). In shadow mode v1 is the source of
    truth; v2 is recording, not validating. The
    `draft-shadow-diff` job is what catches divergence.
    `record_shadow_event` skips preflight by design and is
    locked to service-role + `actor.kind='shadow'` + a non-null
    `leagues.draft_shadow_mode` flag (see Phase 2 RPC definition).
    Events still flow through the seq counter, idempotency-key
    machinery, and the projection trigger writing to
    `draft_picks_v2`, so all observability and invariant checks
    apply unchanged.
  - Shadow writes do NOT update `leagues.pick_deadline` or enqueue
    pgmq messages (v1 is still in control).
  - **Trigger idempotency.** v1 might re-fire the
    `AFTER INSERT ON draft_picks` trigger during error recovery
    (transaction retry, statement retry under serialization
    failure). The shadow idempotency key is deterministic from
    `(league_id, pick_id)`, so re-fires are no-ops at
    `record_shadow_event`'s ON CONFLICT (idempotency_key) — same
    payload returns the same event, divergent payload raises
    `idempotency_conflict` (caught in trigger, logged to a
    `shadow_trigger_errors` table for investigation, never
    propagated up to v1 — v1's transaction must not be aborted by
    a shadow-side hiccup).
- `supabase/functions/draft-shadow-diff/index.ts` — after a v1 draft
  completes, compares:
  - v1 `draft_picks` rows ↔ v2 shadow `draft_events` rows.
  - Order, player IDs, team IDs, pick numbers, round progression.
  - Timing: v2's reconstructed deadline vs v1's `timerStartedAt +
    pickTimeLimit`.
  - Writes `draft_shadow_reports (league_id, draft_completed_at,
    picks_matched, picks_mismatched, timing_drift_ms, detail jsonb)`.
- **Expected timing drift (issue #11).** The shadow trigger fires on
  `draft_picks` INSERT, which is the last DB write of v1's pick path
  but is followed by additional in-process work (broadcast,
  scoring-projection refresh, audit logging) before `make_draft_pick`
  returns to the user. The shadow event's `created_at` therefore
  *leads* v1's user-visible commit by some small interval (typically
  10–50ms, occasionally up to 200ms under load). This is a
  trigger-fire-order artifact, **not** a clock skew or correctness
  issue. The shadow report's `timing_drift_ms` field will routinely
  show negative values in this range; the diff script tags drifts in
  `[-250ms, 0)` as `expected_trigger_lead`, drifts ≥ 0 as
  `equal_or_v1_lead`, and drifts ≤ -250ms as `investigate`. Only the
  third bucket counts against shadow exit criteria. Documented in the
  runbook so on-call doesn't chase a phantom "v2 is faster than v1"
  bug.
- `scripts/staging/07-shadow-diff.mjs` — CLI to inspect reports.

Shadow mode exit criteria (all must hold):
- 5 consecutive real drafts with zero mismatched picks (event log
  reconstructs to the same `draft_picks` v1 produced).
- Zero I1–I16 violations over the full shadow period.
- No `idempotency_conflict` that was not deliberately synthesized.
- On-call for draft engine has not been paged for any v2 invariant.
- **Autopick heuristic validated separately, not against humans (issue
  #4):** for each shadow draft, run a parallel "no-human simulation":
  replay v1's draft from its start, but at every pick where the human
  picked, ask "what would v2 autopick have selected?". Record the
  hypothetical picks. Acceptance is *qualitative* — the picks must be
  reasonable (top-10 remaining FPTS at a positional need, no banned
  players, no roster-rule violations), reviewed by an engineer +
  fantasy SME during Phase 8 sign-off. Pass = no "bizarre" picks
  flagged. The shadow mode's actual job is event-log correctness;
  heuristic quality is owned by the simulation harness (Phase 7) plus
  this manual review.

Only after all criteria pass does Phase 9 begin.

### Phase 9 — Prod rollout (gradual, reversible)
**PR size: small flag flips. Time: spread across ≥4 drafts.**

Rollout order:
1. **Beta league** (internal, single draft) — flag on only for that
   league's ID. Shadow mode also remains on. Full post-draft review.
2. **Small cohort** (2–3 low-stakes leagues) — flag on, monitor.
3. **New leagues default** — flag default-on for newly-created leagues
   only; existing leagues unchanged.
4. **Opt-in migration** — commissioners can opt in per-league.
5. **Default-on everywhere** — after ≥10 clean v2 drafts in prod.

v1 retention: `timerStartedAt`, `make_draft_pick`, client autopick
code path, and `broadcastDraftPick` stay in place indefinitely. v1
removal is a separate, later PR after v2 has run ≥30 prod drafts.

Rollback: flip `leagues.feature_flags.draft_engine_v2 = false` for the
affected league (or globally via env flag). Zero code change required
to revert. v1 state is untouched throughout (shadow mode writes only
to v2 tables), so rollback is instantaneous and lossless.

## Critical files reference

**Existing to reuse:**
- `make_draft_pick` RPC (`supabase/migrations/20260208200000_fix_roster_sync_session_aware.sql:94`)
  — keep intact for v1; v2 does NOT wrap it (v2 writes directly to
  `draft_events`, treats that as source of truth).
- `nuclear_reset_draft` RPC (`supabase/migrations/20260207100000_...:117`)
  — update in Phase 1 to also truncate `draft_events`, reset
  `draft_event_counter`, clear `pick_deadline` for the league.
- Autopick player-selection heuristic (`apps/web/src/pages/DraftRoom.tsx:2410-2524`)
  — port to TypeScript in `supabase/functions/draft-autopick/heuristic.ts`.
- Resilience wrapper `withResilience()` in `server/src/services/DraftService.ts:191`
  — reuse in v2 routes.
- pg_cron, installed via `supabase/migrations/20260208400000_supabase_pro_upgrade.sql:32`.

**Existing not touched by v2 (stays live for shadow period and beyond):**
- Client autopick trigger (`DraftRoom.tsx:2333-2540`) — v2 doesn't call
  it but doesn't remove it. v1 drafts keep working.
- `broadcastDraftPick` fire-and-forget (`draft.ts:27-53`) — v1 keeps
  using it; v2 uses realtime broadcast of `draft_events`.
- Unused reservation RPCs (`20260113200003_add_draft_pick_concurrency_protection.sql`)
  — dead code; not in scope here.

**Infra:**
- `ops/cloudrun/service.yaml` — current `minScale=1, maxScale=10, 2Gi,
  2 CPU` is sufficient for v2 (no new always-on process; pgmq consumer
  is an Edge Function).
- `ops/cloudrun/service-staging.yaml` — bump to match prod before
  Phase 7 load tests.

## Verification

Each phase has its own "Verify" step above. Overall acceptance (before
Phase 9 begins):

1. **Simulation:** `scripts/staging/05-simulate-draft.mjs --teams=12
    --rounds=15 --duration=10m` green. Draft completes, no duplicate
    picks, `draft_events.seq` gap-free per league.
2. **Chaos:** `scripts/staging/06-chaos-test.mjs` green across all
    scenarios (client kill, broadcast drop, pgmq consumer pause,
    commissioner quit, double-tick).
3. **Invariants:** 48h staging soak with harness looping — zero I1–I16
    violations.
4. **Unit tests:** `DraftClock`, `DraftEventStream`, `EventReducer`,
    `submit_pick_v2` idempotency, snake pick-number progression, each
    I1–I16 predicate's fixture — all pass in CI.
5. **Integration:** two concurrent clients submit same `pick_number`
    with different players; exactly one succeeds, other gets 409.
6. **Concurrent idempotency replay:** same client submits same pick 20x
    in parallel; exactly one `draft_events` row, all 20 responses
    identical.
7. **Shadow mode:** 5 consecutive real drafts with zero mismatch
    (Phase 8 exit criteria).

## Out of scope (deferred)

These come from the April 10 postmortem's P1/P2 list but are separate
tracks and not required for v2 correctness:

- Schema-aware column codegen (postmortem §2)
- Realtime integration test suite (postmortem P2) — v2 simulation
  harness partially addresses this
- 24-hour pre-draft change-freeze CI (postmortem P1, partially exists)
- Bundle-size CI gate (postmortem §7)
- Notification realtime server-side brokering (postmortem §5)
- Auction-draft integration — spec §10.2 notes this is loose; v2 Phase
  1–9 scope is snake/linear only. Auction adoption of v2 is a follow-up.
- v1 code removal — deferred to a separate PR after v2 has ≥30 clean
  prod drafts.

## Open questions (resolved here vs. deferred)

**Resolved:**
- pg_cron sub-minute scheduling: available (pg_cron 1.6.4 on Pro).
- pgmq availability on Supabase: available; Phase 0 verifies Postgres
  version is outside the 17.6.1.016+ function-overload bug window.
- `draft_queues` table: does not currently exist; Phase 4 creates it.
- Rollout path: shadow mode (Phase 8) → beta league → cohort → new
  leagues → opt-in → default-on, with v1 retained throughout.
- Branch: `claude/debug-staging-environment-mv9CY` per task assignment.
- Projection model: synchronous trigger projection. `draft_events` is
  authoritative; `draft_picks_v2` is a trigger-maintained cache.
  `reconstruct_draft_state` is rebuild/repair, not hot-path read.
- Worker topology: single long-running Edge Function (≤150s loop),
  re-invoked every 2 min via pg_cron keep-alive.
- Autopick location: TypeScript in Edge Function.
- pgmq lifecycle: `pgmq.archive` (not delete) after processing.
- pgmq enqueue uses **send_delay** parameter (not visibility timeout) —
  see Phase 2 §6.
- Autopick idempotency key includes `draft_generation` to survive
  pause/resume cycles.
- Actor enum: closed set `user|autopick|commissioner|shadow|system`
  enforced via CHECK in Phase 1.
- Commissioner v2.0 scope: pause, resume, extend deadline.
  Commissioner v2.1 scope (deferred): pick-undo, force-pick override.
- Pause/resume/extend do NOT cancel queued pgmq messages — workers
  no-op stale messages by checking `(draft_state, generation,
  pick_number)` against the message payload at read time.
- Safety-net sweep uses an EXISTS predicate over `draft_events` (no
  pgmq-internals introspection); duplicate enqueues are tolerated by
  the autopick idempotency key.
- Worker enforces a 3-attempt budget by inspecting pgmq's `read_ct`
  field and inserting into an `autopick_failures` DLQ table.
- `pick_deadline` rounded to whole seconds (CEIL + 1s pad) so
  autopick fires after the user-visible timer hits zero.
- Engine state is module-scoped Zustand, initialized at
  `LeagueLayout`; connections survive navigation between
  draft/roster/trades panes.
- Broadcast strictly happens after the `submit_pick_v2` commit;
  Realtime channels are not access-controlled (RLS on `/events` REST
  is authoritative).
- Autopick `correlation_id` is a worker-generated UUIDv4; `pgmq_msg_id`
  is stored separately in the event payload.
- `feature_flags` reaches the client via the existing
  `GET /api/league/:id` response.
- Shadow-mode trigger fires ~10–50ms before v1's user-visible commit
  (trigger-fire-order artifact); documented expected drift.

**Surfaced for user decision before Phase 1 (real blockers):**
- **Realtime concurrency cap on current Supabase tier.** If Pro standard
  tier's ~500 concurrent connection limit is below the 10,000-subscriber
  target, do we (a) upgrade tier, (b) consolidate channels (one channel
  per league instead of per-event-type), or (c) accept reduced
  concurrent-draft ceiling for v2.0? Phase 0 surfaces this; user
  decides before Phase 3 builds for it.

**Deferred beyond Phase 9:**
- Auction-draft migration to v2.
- Removal of v1 code (`make_draft_pick`, client autopick,
  `broadcastDraftPick`).
- Pick-undo and force-pick commissioner overrides (v2.1).
- Long-horizon archival / retention policy for `draft_events` and
  `pgmq_archive` (TBD after first 100 v2 drafts to inform sizing).

## Realistic timeline

Per the spec author's estimate, 10–14 weeks end-to-end, with the
long pole being Phase 8 (shadow mode, 2+ weeks of real drafts).

- Phase 0: 2–3 days (doc + infra verification).
- Phases 1–2: ~1 week (event log, pick RPC).
- Phases 3–4: ~2 weeks (scheduler, autopick, worker hardening).
- Phase 5: ~2 weeks (v2 client).
- Phase 6: ~1 week (invariants, dashboard).
- Phase 7: ~1 week (simulation + chaos + 48h soak).
- Phase 8: ≥2 weeks (shadow mode on real drafts, gated on calendar).
- Phase 9: spread across ≥4 drafts, so ≥2 weeks.
