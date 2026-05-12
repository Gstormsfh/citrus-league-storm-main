-- Chunk 11g.8: Remove pgmq emissions from RPCs.
--
-- Removed pgmq.send calls from the following functions:
--   submit_pick_v2 (was lines 913-923 of 20260425140000_draft_engine_v2_rpcs.sql)
--   draft_resume (was lines 386-396 of 20260511000000_draft_events_notify.sql)
--   draft_extend (was lines 538-548 of 20260511000000_draft_events_notify.sql)
--   draft_deadline_sweep (was lines 140-150 of 20260426130000_draft_engine_v2_phase3_sweep.sql)
--
-- Each RPC's other behavior preserved: idempotency, actor authorization,
-- atomicity contracts, draft_events INSERT trigger (NOTIFY emission from
-- chunk 11g.7 sub-step 7e). The associated `v_send_delay` variables and
-- their computations are also removed where they were exclusively used
-- to schedule the pgmq message (submit_pick_v2, draft_resume, draft_extend).
-- `v_pick_time` and `v_new_deadline` STAY — both still feed the
-- `UPDATE leagues SET pick_deadline = ...` step that backs the engine's
-- in-memory timer via `result.pick_deadline` in the RPC return value.
--
-- ── ADR-001 + persistent-engine rationale ──
--
-- The persistent draft engine (`server/src/draft/LobbyManager.ts`,
-- chunk 11g.4 step 6c onwards) fires autopicks via in-memory
-- `setTimeout` timers + direct `submit_pick_v2` invocation with
-- `actor.kind='autopick'`. The engine reads `result.pick_deadline`
-- from the RPC response and sets its own timer; the pgmq emission
-- is a side effect nothing in the engine observes. Per ADR-001
-- (persistent-Node-engine) and chunk 11g.4 step 6c Decision Log,
-- the in-server autopick path is the canonical mechanism. The
-- pgmq writer wiring is vestigial.
--
-- ── 11g.9 follow-up scope ──
--
-- Chunk 11g.9 (next) removes the pgmq consumer (draft-autopick edge
-- function at `supabase/functions/draft-autopick/index.ts`), the
-- pgmq queue + archive table (`draft_deadlines`), the pgmq extension
-- itself, the pg_cron jobs (`draft-deadline-sweep`,
-- `draft-autopick-keepalive`), the pgmq wrapper RPCs
-- (`draft_autopick_read`, `draft_autopick_archive` from
-- `20260426140000_draft_engine_v2_phase3_pgmq_wrappers.sql`), and the
-- `generation_bumped` event-write protocol (currently emitted before
-- every `draft_paused` / `draft_resumed` / `draft_extended` for
-- Phase 4 worker staleness coordination — no longer load-bearing).
-- `generation_bumped` events are already handled by the bootstrap's
-- default skip-with-debug-log arm per chunk 11g.4 step 6b Decision
-- Log, so leaving them as no-op event-writes here in 11g.8 is safe.
--
-- ── Rollback boundary ──
--
-- The pgmq path was always a stub — even in Phase 3/4, the
-- `draft-autopick` Edge Function was a no-op archiver. Removing
-- emissions doesn't reduce production capability. Worst-case
-- rollback = persistent engine has critical bug → rollback to "no
-- autopick at all" which is the same as today's stub-archiver
-- behavior. Incident responders should NOT reach for the legacy
-- pgmq path during crises — it does nothing.
--
-- ── Test impact ──
--
-- Zero test references to `pgmq` / `draft_deadlines` / `pgmq.send`
-- across `server/src/**/*.test.ts` and `apps/web/src/**/*.test.ts`.
-- All 874 server tests stay green; no test additions in 11g.8.
--
-- ── Migration ordering ──
--
-- This migration MUST come after `20260511000000_draft_events_notify.sql`
-- (chunk 11g.7 sub-step 7e) because it restates `draft_resume` and
-- `draft_extend` whose latest definitions live in that migration.
-- Postgres CoR semantics: only the most-recent function body
-- matters; this migration's CoR is authoritative.

-- ── 1. submit_pick_v2 — remove pgmq emission ─────────────────────────
--
-- Changes from 20260425140000_draft_engine_v2_rpcs.sql:658-934:
--   - DECLARE: removed `v_send_delay int;`
--   - Removed entire Step 5 block (was lines 904-923):
--       `v_send_delay := GREATEST(...);` + `PERFORM pgmq.send(...)`
--   - Comment block above Step 5 also removed
--   - Function COMMENT updated (removed "enqueues pgmq deadline message")
-- All other behavior identical: idempotency check, preflight (state /
-- pick_number / round / on-clock / player-taken / auth), payload build,
-- counter advance, event INSERT (which fires the chunk 11g.7 sub-step 7e
-- NOTIFY trigger), pick_deadline UPDATE, RETURN shape unchanged.

CREATE OR REPLACE FUNCTION public.submit_pick_v2(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id    bigint;
  v_existing_seq   bigint;
  v_existing_hash  text;
  v_current_dl     timestamptz;
  v_draft_state    text;
  v_league_size    int;
  v_settings       jsonb;
  v_generation     int;
  v_pick_count     int;
  v_expected_round int;
  v_pick_in_round  int;
  v_team_order     jsonb;
  v_expected_team  uuid;
  v_actor_kind     text;
  v_team_owner     uuid;
  v_caller_role    text;
  v_player_taken   boolean;
  v_picked_at      timestamptz;
  v_payload        jsonb;
  v_new_seq        bigint;
  v_event_id       bigint;
  v_correlation_id uuid;
  v_pick_time      int;
  v_new_deadline   timestamptz;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_event_payload: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 1: Idempotency check (spec §5.2.1) ─────────────────────────
  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT id, seq, payload_hash
    INTO v_existing_id, v_existing_seq, v_existing_hash
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash = p_payload_hash THEN
      SELECT pick_deadline INTO v_current_dl
        FROM public.leagues WHERE id = p_league_id;
      RETURN jsonb_build_object(
        'event_id',      v_existing_id,
        'seq',           v_existing_seq,
        'pick_deadline', v_current_dl,
        'was_duplicate', true
      );
    ELSE
      RAISE EXCEPTION 'idempotency_conflict: same key, different payload_hash'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- ── Step 2: Preflight (spec §5.2) ───────────────────────────────────

  SELECT draft_state, league_size, settings, draft_generation
    INTO v_draft_state, v_league_size, v_settings, v_generation
    FROM public.leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_draft_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state: draft_state is % (expected active)',
      v_draft_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_league_size IS NULL OR v_league_size <= 0 THEN
    RAISE EXCEPTION 'illegal_state: league_size not configured'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;

  IF p_pick_number <> v_pick_count + 1 THEN
    RAISE EXCEPTION 'pick_out_of_order: expected pick % got %',
      v_pick_count + 1, p_pick_number
      USING ERRCODE = 'check_violation';
  END IF;

  v_expected_round := ((p_pick_number - 1) / v_league_size) + 1;
  IF p_round <> v_expected_round THEN
    RAISE EXCEPTION 'pick_out_of_order: round mismatch (expected % got %)',
      v_expected_round, p_round
      USING ERRCODE = 'check_violation';
  END IF;

  v_pick_in_round := ((p_pick_number - 1) % v_league_size) + 1;

  SELECT team_order INTO v_team_order
    FROM public.draft_order
   WHERE league_id = p_league_id AND round_number = p_round;

  IF v_team_order IS NULL THEN
    RAISE EXCEPTION 'illegal_state: draft_order missing for round %', p_round
      USING ERRCODE = 'no_data_found';
  END IF;

  v_expected_team := (v_team_order ->> (v_pick_in_round - 1))::uuid;
  IF v_expected_team IS DISTINCT FROM p_team_id THEN
    RAISE EXCEPTION 'not_on_clock: expected team % got %',
      v_expected_team, p_team_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.draft_picks_v2
     WHERE league_id = p_league_id AND player_id = p_player_id
  ) INTO v_player_taken;

  IF v_player_taken THEN
    RAISE EXCEPTION 'player_taken: player % already picked in league %',
      p_player_id, p_league_id
      USING ERRCODE = 'unique_violation';
  END IF;

  v_actor_kind := p_actor ->> 'kind';
  v_caller_role := auth.role();

  IF v_actor_kind = 'autopick' THEN
    IF v_caller_role NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'unauthorized: actor.kind=autopick requires service_role (got %)',
        v_caller_role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_actor_kind = 'user' THEN
    SELECT owner_id INTO v_team_owner
      FROM public.teams
     WHERE id = p_team_id AND league_id = p_league_id;

    IF v_team_owner IS NULL THEN
      RAISE EXCEPTION 'unauthorized: team % is not in league %',
        p_team_id, p_league_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_team_owner IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'unauthorized: caller % is not owner of team %',
        auth.uid(), p_team_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'unauthorized: actor.kind=% not allowed by submit_pick_v2',
      COALESCE(v_actor_kind, '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Step 3: Build payload, advance counter, insert event ────────────
  v_picked_at := now();
  v_payload := jsonb_build_object(
    'pick_number', p_pick_number,
    'round',       p_round,
    'team_id',     p_team_id,
    'player_id',   p_player_id,
    'picked_at',   v_picked_at,
    'is_autopick', (v_actor_kind = 'autopick'),
    'session_id',  p_session_id
  );

  PERFORM public.validate_draft_event_payload('pick', v_payload);

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  INSERT INTO public.draft_events (
    league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'pick', v_payload, p_payload_hash,
    p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  -- AFTER INSERT trigger tg_draft_events_project_pick fires HERE,
  -- writing the corresponding row into draft_picks_v2.
  -- AFTER INSERT trigger draft_events_notify_after_insert (chunk 11g.7
  -- sub-step 7e) fires HERE, emitting pg_notify('draft_events', ...).

  -- ── Step 4: Compute next pick_deadline (spec §5.2.2) ────────────────
  -- Engine reads this from the RPC return value and sets its own
  -- in-memory `setTimeout` timer (chunk 11g.4 step 6c). The
  -- previously-emitted pgmq deadline message is removed in chunk
  -- 11g.8 — the persistent engine doesn't observe pgmq.
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90
  );

  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  UPDATE public.leagues
     SET pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'event_id',      v_event_id,
    'seq',           v_new_seq,
    'pick_deadline', v_new_deadline,
    'was_duplicate', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid) IS
  'Spec §4.5 / §5.2: the pick path. Idempotent (per-key advisory lock); preflight-checked (state, pick_number, round, on-the-clock, player-taken, auth); writes event + projection (via trigger); advances pick_deadline (CEIL + 1s pad). Chunk 11g.8: removed pgmq emission — persistent engine reads pick_deadline from RPC return value and runs its own in-memory timer.';

-- ── 2. draft_resume — remove pgmq emission ───────────────────────────
--
-- Changes from 20260511000000_draft_events_notify.sql:271-409:
--   - DECLARE: removed `v_send_delay int;`
--   - Removed `PERFORM pgmq.send(...)` block (was lines 376-396)
--     plus the surrounding comment + `v_send_delay := GREATEST(...)`
--   - Function COMMENT updated
-- generation_bumped event emission RETAINED per chunk 11g.8 scope
-- decision (Option B: defer removal to chunk 11g.9). The event is
-- handled by the bootstrap's default skip-with-debug-log arm per
-- chunk 11g.4 step 6b Decision Log.

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
  v_caller_role    text;
  v_seq            bigint;
BEGIN
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

  IF v_state <> 'paused' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot resume from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_gen     := v_old_gen + 1;
  v_resumed_at  := now();
  v_pick_time   := COALESCE((v_settings ->> 'pickTimeLimit')::int, 90);

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

  -- Event 1: generation_bumped. Retained per chunk 11g.8 Option B
  -- (removal deferred to 11g.9 alongside the pgmq protocol cleanup).
  -- Handled by `applyEventDuringBootstrap`'s default skip-with-
  -- debug-log arm during bootstrap event-replay.
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

  -- Event 2: draft_resumed. Capture seq for engine dedup (7e).
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

  -- Chunk 11g.8: pgmq emission removed. Engine reads
  -- `new_pick_deadline` from RPC return + sets its own in-memory
  -- timer via `LobbyManager.setPickDeadline()`.

  RETURN jsonb_build_object(
    'generation',        v_new_gen,
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_resume(uuid, jsonb) IS
  'Spec §4.7: bumps generation, recomputes pick_deadline, transitions to active. Emits generation_bumped + draft_resumed events. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.8: removed pgmq emission — persistent engine reads new_pick_deadline from RPC return.';

-- ── 3. draft_extend — remove pgmq emission ───────────────────────────
--
-- Changes from 20260511000000_draft_events_notify.sql:413-558:
--   - DECLARE: removed `v_send_delay int;`
--   - Removed `PERFORM pgmq.send(...)` block (was lines 528-548)
--     plus the surrounding comment + `v_send_delay := GREATEST(...)`
--   - Function COMMENT updated
-- generation_bumped event emission RETAINED per chunk 11g.8 Option B.

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

  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'illegal_state_transition: cannot extend from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_old_deadline IS NULL THEN
    RAISE EXCEPTION 'illegal_state: active draft has no pick_deadline (data corruption?)'
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_gen     := v_old_gen + 1;
  v_extended_at := now();

  v_new_deadline := date_trunc('second', v_old_deadline)
                  + make_interval(secs => p_extra_seconds);

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_pick_number := v_pick_count + 1;

  UPDATE public.leagues
     SET draft_generation = v_new_gen,
         pick_deadline    = v_new_deadline
   WHERE id = p_league_id;

  -- Event 1: generation_bumped. Retained per chunk 11g.8 Option B.
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

  -- Event 2: draft_extended. Capture seq for engine dedup (7e).
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

  -- Chunk 11g.8: pgmq emission removed. Engine reads
  -- `new_pick_deadline` from RPC return + sets its own in-memory
  -- timer via `LobbyManager.setPickDeadline()`.

  RETURN jsonb_build_object(
    'generation',        v_new_gen,
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_extend(uuid, int, jsonb) IS
  'Spec §4.8: bumps generation, extends pick_deadline by p_extra_seconds. Emits generation_bumped + draft_extended events. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.8: removed pgmq emission — persistent engine reads new_pick_deadline from RPC return.';

-- ── 4. draft_deadline_sweep — remove pgmq emission ───────────────────
--
-- Changes from 20260426130000_draft_engine_v2_phase3_sweep.sql:41-174:
--   - Removed `PERFORM pgmq.send(...)` block (was lines 140-150)
--     including the surrounding comment about message schema
-- The function's other behavior is preserved: auth gate, advisory
-- lock, expired-leagues predicate walk, `safety_net_hit` metric write.
-- The metric write is now meaningless under the persistent-engine
-- model (engine handles its own deadlines via setTimeout — no
-- "missed deadline" case for the safety net to catch). Chunk 11g.9
-- removes the function entirely along with its pg_cron job.
-- Keeping the function callable in 11g.8 preserves the pg_cron job
-- contract (cron will continue invoking it harmlessly until 11g.9).

CREATE OR REPLACE FUNCTION public.draft_deadline_sweep()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role    text;
  v_lock_acquired  boolean;
  v_now            timestamptz := now();
  v_enqueued       int := 0;
  v_league         record;
  v_current_pick   int;
  v_expired_by_sec int;
BEGIN
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: draft_deadline_sweep requires service_role/postgres (got %)',
      COALESCE(v_caller_role, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pg_try_advisory_xact_lock(hashtext('draft-sweep'))
    INTO v_lock_acquired;

  IF NOT v_lock_acquired THEN
    RETURN 0;
  END IF;

  -- Predicate walk preserved for observability (`safety_net_hit`
  -- metric). Chunk 11g.8: pgmq emission removed from the inner block;
  -- the function still records when an expired deadline is detected
  -- but no longer attempts to wake the legacy worker (which doesn't
  -- exist anyway — Edge Function is a no-op archiver).
  FOR v_league IN
    SELECT
      l.id              AS league_id,
      l.draft_generation,
      l.pick_deadline
    FROM public.leagues l
    WHERE l.draft_state = 'active'
      AND l.pick_deadline IS NOT NULL
      AND l.pick_deadline < v_now - interval '2 seconds'
      AND NOT EXISTS (
        SELECT 1
        FROM public.draft_events e
        WHERE e.league_id = l.id
          AND e.event_type IN ('pick','autopick_failed')
          AND (e.payload->>'pick_number')::int =
               (SELECT count(*) + 1
                  FROM public.draft_events e2
                 WHERE e2.league_id = l.id
                   AND e2.event_type = 'pick')
          AND e.created_at > l.pick_deadline
      )
  LOOP
    SELECT count(*) + 1
      INTO v_current_pick
      FROM public.draft_events e
     WHERE e.league_id = v_league.league_id
       AND e.event_type = 'pick';

    v_expired_by_sec := EXTRACT(
      EPOCH FROM (v_now - v_league.pick_deadline)
    )::int;

    -- Chunk 11g.8: pgmq.send block removed. Persistent engine handles
    -- its own deadlines via in-memory setTimeout (chunk 11g.4 step 6c);
    -- safety-net re-enqueue is no longer load-bearing. Metric write
    -- preserved for observability — sweep function + pg_cron job get
    -- removed entirely in chunk 11g.9.

    INSERT INTO public.draft_metrics (metric, league_id, value, detail)
    VALUES (
      'safety_net_hit',
      v_league.league_id,
      1,
      jsonb_build_object(
        'expired_by_sec', v_expired_by_sec,
        'generation',     v_league.draft_generation
      )
    );

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION public.draft_deadline_sweep() IS
  'Spec §4.8: race-free safety-net deadline detection. Predicate over draft_events; pg_try_advisory_xact_lock(hashtext(''draft-sweep'')) so overlapping runs no-op; one safety_net_hit row per affected league per run. Chunk 11g.8: pgmq emission removed; function still records metric but no longer enqueues. Chunk 11g.9 removes the function + its pg_cron job entirely.';
