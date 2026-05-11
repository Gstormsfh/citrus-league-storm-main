-- Phase 4.5 chunk 11g.7 sub-step 7e — live event subscription via Postgres NOTIFY.
--
-- This migration wires Postgres NOTIFY emission into every `draft_events`
-- INSERT so the persistent draft engine can observe events written by
-- OTHER processes (e.g., commissioner UI → main API server → RPC →
-- INSERT INTO draft_events). The engine subscribes via LISTEN on a
-- dedicated `pg` client connection in `server/src/draft/eventSubscription.ts`.
-- When NOTIFY fires, engine looks up the LobbyManager via LobbyRegistry,
-- enqueues an external_event action through the single-writer queue,
-- and applies the event via the canonical-replay handlers from
-- chunk 11g.6 sub-step 6b.
--
-- ── Architecture override of brief: trigger, not per-RPC ──
--
-- The chunk 11g.7 sub-step 7e recon proposed CREATE OR REPLACE FUNCTION
-- statements for each of the 11 RPCs that write `draft_events`, adding
-- `PERFORM pg_notify(...)` at the end of each function body. This
-- migration uses a SINGLE `AFTER INSERT` trigger on `draft_events`
-- instead. Tradeoffs:
--   (+) ~30-line migration vs ~3000-line per-RPC rewrite. Each
--       CREATE OR REPLACE FUNCTION requires the full function body
--       to be restated even for a 1-line addition.
--   (+) Future RPCs that write `draft_events` automatically get NOTIFY
--       coverage. No risk of "shipped a new RPC but forgot to add
--       pg_notify" — the trigger covers them all.
--   (+) Single source of NOTIFY logic. The trigger function is the
--       canonical reference for the NOTIFY payload shape.
--   (-) Cannot selectively skip events (e.g., suppress NOTIFY for
--       `generation_bumped` events). Not a real downside — the engine's
--       dedup via `lastAppliedSeq` short-circuits already-applied events
--       cheaply (~1ms per no-op skip).
-- Commit-coupling is identical between trigger and inline pg_notify:
-- the trigger runs in the same transaction as the INSERT; NOTIFY is
-- delivered at commit time and discarded on rollback (Postgres semantics).
--
-- ── lifecycle RPC modifications ──
--
-- 3 of the 11 RPCs that write draft_events (`draft_pause`, `draft_resume`,
-- `draft_extend`) currently do NOT include `seq` in their returned jsonb.
-- The engine's dedup architecture requires its runtime emissions to
-- update `LobbyManager.lastAppliedSeq` to the highest seq emitted — so
-- when the NOTIFY for that same seq bounces back to the engine's
-- LISTEN subscription, the dedup gate (`seq <= lastAppliedSeq`)
-- short-circuits without re-applying. Without seq in the return value,
-- the engine cannot capture it; the NOTIFY would re-apply already-
-- applied state (idempotent for these particular lifecycle handlers,
-- but inefficient and confusing in logs).
--
-- This migration adds seq capture + return to those three RPCs by
-- changing the second `PERFORM append_draft_event(...)` call (the
-- lifecycle event, not the generation_bumped scaffold) to
-- `SELECT (append_draft_event(...) ->> 'seq')::bigint INTO v_seq`,
-- then including `seq` in the RETURN jsonb. The 8 other v2 RPCs
-- already include `seq` in their returns (recon-verified).
--
-- ── post-deploy verification checklist ──
-- 1. Verify SUPABASE_DB_URL is set in engine process to a DIRECT
--    Postgres connection (not pooled). PgBouncer / Supabase pooled
--    connections do not support LISTEN.
-- 2. Restart engine process.
-- 3. Check engine startup logs for `event_subscription.started` (info)
--    within 5 seconds. The startup self-test in eventSubscription.ts
--    fires a synthetic NOTIFY and waits for receipt; if it doesn't
--    arrive, the log line `event_subscription.self_test_failed` (error)
--    surfaces with explicit operator instructions.
-- 4. Trigger any draft-event-writing RPC (e.g., auction_pause_v2);
--    check engine logs for `event_subscription.notification_received`
--    (debug) within 1 second. If absent, verify SUPABASE_DB_URL.
-- This checklist prevents "deployed migration but notifications don't
-- fire" troubleshooting marathons.
--
-- ── chunk references ──
-- - Closes deferred cross-process notification from chunk 11g.6 sub-step 6c1
--   (Decision Log 2026-05-07: "auction pause/resume engine state diverges
--   if commissioner UI fires the RPC without the engine being in-loop").
-- - Builds on chunk 11g.7 sub-step 7c snapshot+delta bootstrap:
--   notifications missed during engine downtime are caught at next WS
--   reconnect when bootstrap reads snapshot + delta events.
-- - chunk 11g.7 functionally complete after this migration + the
--   companion server-side wiring lands.

-- ── 1. NOTIFY trigger function ────────────────────────────────────────
--
-- Fires on every `INSERT INTO draft_events` with a minimal JSON payload
-- containing the leagueId + seq. Engine fetches full event details by
-- seq via the existing `listDraftEvents(leagueId, sinceSeq=seq-1)`
-- helper — keeping the NOTIFY payload small (~70 bytes) well below
-- Postgres's 8KB notification payload limit.
--
-- Single global channel `draft_events`; per-engine JS-side filter on
-- the league_id field discards notifications for lobbies this engine
-- doesn't have in memory. Per-league channels (`draft_events_${leagueId}`
-- with dynamic LISTEN/UNLISTEN on lobby load/unload) are deferred to
-- Stage 3 (multi-VM MIG) per chunk 11g.7 sub-step 7e Decision Log;
-- the JS filter cost is ~1ms per no-op which is acceptable at Day 1
-- single-VM scale.

CREATE OR REPLACE FUNCTION public.draft_events_notify_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_notify(
    'draft_events',
    json_build_object(
      'league_id', NEW.league_id,
      'seq',       NEW.seq
    )::text
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.draft_events_notify_trigger() IS
  'Chunk 11g.7 sub-step 7e: emits pg_notify on every draft_events INSERT for cross-process engine subscription. Payload is minimal JSON {league_id, seq}; engine fetches full event details by seq. Commit-coupled by Postgres NOTIFY semantics (delivered at COMMIT, discarded on ROLLBACK).';

-- ── 2. AFTER INSERT trigger on draft_events ──────────────────────────
--
-- AFTER INSERT (not BEFORE) so the trigger sees the row as it was
-- actually inserted (defense against any future BEFORE INSERT triggers
-- that mutate NEW). FOR EACH ROW so every event fires its own NOTIFY
-- (auction RPCs that emit one event per call, lifecycle RPCs that emit
-- two events per call — generation_bumped + lifecycle event — both fire
-- two NOTIFY's, which is correct: the engine applies both).

DROP TRIGGER IF EXISTS draft_events_notify_after_insert ON public.draft_events;

CREATE TRIGGER draft_events_notify_after_insert
AFTER INSERT ON public.draft_events
FOR EACH ROW
EXECUTE FUNCTION public.draft_events_notify_trigger();

COMMENT ON TRIGGER draft_events_notify_after_insert ON public.draft_events IS
  'Chunk 11g.7 sub-step 7e: fires pg_notify on draft_events INSERT. See draft_events_notify_trigger() and 20260511000000_draft_events_notify.sql for rationale.';

-- ── 3. draft_pause — add seq capture + return ────────────────────────
--
-- Changes from the prior version (20260425140000_draft_engine_v2_rpcs.sql:961):
--   1. Add `v_seq bigint;` to DECLARE block.
--   2. Change the second `PERFORM append_draft_event(...)` (the
--      draft_paused lifecycle event) to capture its seq:
--        SELECT (public.append_draft_event(...) ->> 'seq')::bigint
--          INTO v_seq;
--   3. Include `seq` in the RETURN jsonb.
-- Function body otherwise identical to the prior version.

CREATE OR REPLACE FUNCTION public.draft_pause(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_gen        int;
  v_new_gen        int;
  v_old_deadline   timestamptz;
  v_pick_count     int;
  v_remaining      int;
  v_paused_pick    int;
  v_paused_at      timestamptz;
  v_reason         text;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  -- Auth: actor.kind must be 'commissioner'.
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_pause requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Auth: caller must be commissioner OR service_role/postgres.
  SELECT commissioner_id, draft_state, draft_generation, pick_deadline
    INTO v_commissioner, v_state, v_old_gen, v_old_deadline
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- State-machine guard: pause is only legal from 'active' (spec §5.1).
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot pause from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Bump generation + clear deadline + transition state, all in this txn.
  v_new_gen   := v_old_gen + 1;
  v_paused_at := now();
  v_reason    := COALESCE(p_actor ->> 'reason', 'commissioner');

  -- Compute paused_pick_number + remaining_seconds for the event payload.
  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_paused_pick := v_pick_count + 1;
  v_remaining := GREATEST(
    0,
    COALESCE(ceil(EXTRACT(EPOCH FROM (v_old_deadline - now())))::int, 0)
  );

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         draft_state      = 'paused',
         pick_deadline    = NULL
   WHERE id = p_league_id;

  -- Event 1: generation_bumped (spec §5.1: emit before lifecycle event).
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'generation_bumped',
    p_payload          => jsonb_build_object(
      'old_generation', v_old_gen,
      'new_generation', v_new_gen,
      'reason',         'pause'
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Event 2: draft_paused. Capture seq for the engine's dedup cursor
  -- (chunk 11g.7 sub-step 7e: lastAppliedSeq update path).
  SELECT (public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_paused',
    p_payload          => jsonb_build_object(
      'paused_at',          v_paused_at,
      'paused_pick_number', v_paused_pick,
      'remaining_seconds',  v_remaining,
      'reason',             v_reason
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  ) ->> 'seq')::bigint INTO v_seq;

  -- KI-002 RESOLVED: removed RAISE NOTICE. Phase 6 wires draft_metrics.

  RETURN jsonb_build_object(
    'generation', v_new_gen,
    'paused_at',  v_paused_at,
    'seq',        v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_pause(uuid, jsonb) IS
  'Spec §4.6: bumps generation, clears pick_deadline, transitions to paused. Emits generation_bumped then draft_paused. Stale pgmq messages no-op at worker read time. Chunk 11g.7 sub-step 7e: returns seq of the draft_paused event for engine dedup.';

-- ── 4. draft_resume — add seq capture + return ───────────────────────

CREATE OR REPLACE FUNCTION public.draft_resume(
  p_league_id  uuid,
  p_actor      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_gen        int;
  v_new_gen        int;
  v_settings       jsonb;
  v_pick_time      int;
  v_pick_count     int;
  v_resumed_pick   int;
  v_new_deadline   timestamptz;
  v_resumed_at     timestamptz;
  v_send_delay     int;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  -- Auth: actor.kind must be 'commissioner'.
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_resume requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, draft_generation, settings
    INTO v_commissioner, v_state, v_old_gen, v_settings
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Resume is only legal from 'paused' (spec §5.1).
  IF v_state <> 'paused' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot resume from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_gen     := v_old_gen + 1;
  v_resumed_at  := now();
  v_pick_time   := COALESCE((v_settings ->> 'pickTimeLimit')::int, 90);

  -- Recompute deadline (CEIL + 1s pad, spec §5.2.2).
  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_resumed_pick := v_pick_count + 1;

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         draft_state      = 'active',
         pick_deadline    = v_new_deadline
   WHERE id = p_league_id;

  -- Event 1: generation_bumped (spec §5.1: emit before lifecycle event).
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'generation_bumped',
    p_payload          => jsonb_build_object(
      'old_generation', v_old_gen,
      'new_generation', v_new_gen,
      'reason',         'resume'
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Event 2: draft_resumed. Capture seq for engine dedup.
  SELECT (public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_resumed',
    p_payload          => jsonb_build_object(
      'resumed_at',          v_resumed_at,
      'resumed_pick_number', v_resumed_pick,
      'new_pick_deadline',   v_new_deadline
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  ) ->> 'seq')::bigint INTO v_seq;

  -- Enqueue a fresh deadline message for the new generation, AFTER the
  -- two events are appended (spec criterion: pgmq.send happens with the
  -- NEW generation in the payload, after both events are committed).
  -- Any pre-pause pgmq messages still in flight will hit the worker's
  -- generation check and no-op.
  v_send_delay := GREATEST(
    0,
    ceil(EXTRACT(EPOCH FROM (v_new_deadline - now())))::int
  );

  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     p_league_id,
      'pick_number',   v_resumed_pick,
      'generation',    v_new_gen,
      'scheduled_for', v_new_deadline,
      'source',        'draft_resume'
    ),
    v_send_delay
  );

  -- KI-002 RESOLVED: removed RAISE NOTICE. Phase 6 wires draft_metrics.

  RETURN jsonb_build_object(
    'generation',        v_new_gen,
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_resume(uuid, jsonb) IS
  'Spec §4.7: bumps generation, recomputes pick_deadline, transitions to active, enqueues fresh pgmq message tagged with new generation. Pre-pause queue messages no-op at worker. Chunk 11g.7 sub-step 7e: returns seq of the draft_resumed event for engine dedup.';

-- ── 5. draft_extend — add seq capture + return ───────────────────────

CREATE OR REPLACE FUNCTION public.draft_extend(
  p_league_id      uuid,
  p_extra_seconds  int,
  p_actor          jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_commissioner   uuid;
  v_state          text;
  v_old_gen        int;
  v_new_gen        int;
  v_old_deadline   timestamptz;
  v_new_deadline   timestamptz;
  v_extended_at    timestamptz;
  v_pick_count     int;
  v_pick_number    int;
  v_send_delay     int;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  IF p_extra_seconds IS NULL OR p_extra_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid_event_payload: p_extra_seconds must be a positive int (got %)',
      p_extra_seconds
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_extend requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, draft_generation, pick_deadline
    INTO v_commissioner, v_state, v_old_gen, v_old_deadline
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner
  THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Extend is only legal from 'active' (spec §5.1).
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot extend from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_old_deadline IS NULL THEN
    -- Active-but-no-deadline shouldn't happen; surface as illegal_state.
    RAISE EXCEPTION 'illegal_state: active draft has no pick_deadline (data corruption?)'
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_gen     := v_old_gen + 1;
  v_extended_at := now();

  -- Push the deadline forward by p_extra_seconds, re-rounded per §5.2.2.
  v_new_deadline := date_trunc('second', v_old_deadline)
                  + make_interval(secs => p_extra_seconds);

  -- Determine the pick the extension applies to.
  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_pick_number := v_pick_count + 1;

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         pick_deadline    = v_new_deadline
   WHERE id = p_league_id;

  -- Event 1: generation_bumped (spec §5.1: emit before lifecycle event).
  PERFORM public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'generation_bumped',
    p_payload          => jsonb_build_object(
      'old_generation', v_old_gen,
      'new_generation', v_new_gen,
      'reason',         'extend'
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  );

  -- Event 2: draft_extended. Capture seq for engine dedup.
  SELECT (public.append_draft_event(
    p_league_id        => p_league_id,
    p_event_type       => 'draft_extended',
    p_payload          => jsonb_build_object(
      'extended_at',       v_extended_at,
      'pick_number',       v_pick_number,
      'extra_seconds',     p_extra_seconds,
      'new_pick_deadline', v_new_deadline
    ),
    p_idempotency_key  => gen_random_uuid(),
    p_payload_hash     => 'sha256:server-generated',
    p_actor            => p_actor,
    p_correlation_id   => NULL
  ) ->> 'seq')::bigint INTO v_seq;

  -- Enqueue a fresh message tagged with the new generation, AFTER the
  -- two events are appended (spec criterion: pgmq.send with NEW
  -- generation, after both events committed). The previously queued
  -- message becomes a no-op when the worker reads it (mismatched
  -- generation).
  v_send_delay := GREATEST(
    0,
    ceil(EXTRACT(EPOCH FROM (v_new_deadline - now())))::int
  );

  PERFORM pgmq.send(
    'draft_deadlines',
    jsonb_build_object(
      'league_id',     p_league_id,
      'pick_number',   v_pick_number,
      'generation',    v_new_gen,
      'scheduled_for', v_new_deadline,
      'source',        'draft_extend'
    ),
    v_send_delay
  );

  -- KI-002 RESOLVED: removed RAISE NOTICE. Phase 6 wires draft_metrics.

  RETURN jsonb_build_object(
    'generation',        v_new_gen,
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_extend(uuid, int, jsonb) IS
  'Spec §4.8: bumps generation, extends pick_deadline by p_extra_seconds, enqueues fresh pgmq message. Old queued message no-ops at worker (mismatched generation). Chunk 11g.7 sub-step 7e: returns seq of the draft_extended event for engine dedup.';
