-- Chunk 11g.9: Full legacy pgmq infrastructure removal — close of the cleanup arc.
--
-- Removes:
--   - draft-autopick Edge Function (supabase/functions/draft-autopick/index.ts)
--   - pg_cron jobs: draft-deadline-sweep, draft-autopick-keepalive
--   - Wrapper RPCs: draft_autopick_read, draft_autopick_archive
--   - draft_deadline_sweep function (body retained from 11g.8 for full removal here)
--   - generation_bumped event-writes from draft_pause, draft_resume, draft_extend
--   - generation_bumped value from draft_events.event_type CHECK constraint
--   - leagues.draft_generation column
--   - v_generation leak in submit_pick_v2 (cleanup from 11g.8)
--   - pgmq extension (DROPs queue + archive tables via CASCADE)
--
-- IRREVERSIBILITY: DROP EXTENSION pgmq CASCADE is the final statement and
-- cannot be undone without re-running migrations. After this migration,
-- the pgmq extension and all its objects are gone. Future need for
-- queue-based coordination should use chunk 11g.7 sub-step 7e LISTEN/NOTIFY
-- or a fresh primitive — NOT restoration of pgmq.
--
-- Incident responders during crises should NOT reach for the legacy pgmq
-- path — it doesn't exist after this migration.
--
-- Historical generation_bumped rows in draft_events remain valid (CHECK
-- enforces INSERTs only). Bootstrap handler skips them via the explicit
-- `case 'generation_bumped':` arm in LobbyManager.applyEventDuringBootstrap
-- (chunk 11g.4 step 6b). This chunk removes only the writing side; the
-- read-side defensive catch stays for forward-compat with replay of
-- historical events.
--
-- KI closures: KI-007 RESOLVED, KI-009 RESOLVED, KI-004 SUPERSEDED.
--
-- ── Decision Log (chunk 11g.9, 2026-05-12) ───────────────────────────
--
-- D1. CHECK enum recount. Recon report described the change as 20→19.
--     Actual current count in 20260507030000_auction_auto_nominate.sql is
--     21 values (11 snake/linear + 9 auction + 1 Path Y skipped). After
--     removing `generation_bumped` the new count is 20, not 19. Migration
--     reflects the correct count.
--
-- D2. leagues.draft_generation DROP COLUMN. Used exclusively for pgmq
--     message-staleness coordination. Engine never read this column. With
--     pgmq removed, no consumer remains. All snake/linear RPCs that
--     SELECT'd / UPDATE'd the column are CoR'd in this migration to drop
--     all references and to stop emitting `generation` in their return
--     value. Server engine code (`server/src/draft/**`) does not read
--     `result.generation` from any of these RPCs — recon-verified via
--     grep — so removing the field is safe. Auction RPCs (20260506-
--     20260507040000) do not reference the column.
--
-- D3. v_generation leak in submit_pick_v2 cleaned up here (Path A) rather
--     than via force-push of 11g.8. Natural completion of the cleanup arc;
--     preserves commit history hygiene. The leak was: `DECLARE v_generation
--     int;` + `SELECT ..., draft_generation INTO ..., v_generation` with
--     no subsequent read. Removing the declaration and the column from
--     the SELECT-INTO list is sufficient.
--
-- D4. generation_bumped event-writes removed from draft_pause / _resume /
--     _extend in same chunk per 11g.8 Option B's deferred-to-11g.9
--     handoff. The emissions were retained in 11g.8 alongside the pgmq
--     emit removal so the chunk could be migration-only and surgical.
--     Closing the protocol here completes the arc.
--
-- D5. Auction RPCs unaffected. The 20260507010000_auction_pause_resume.sql
--     header already declared "No `generation_bumped` events for auction
--     RPCs (the snake/linear pattern's pgmq message-staleness coordinator
--     is being retired in chunk 11g.9)." This chunk honors that.
--
-- D6. Bootstrap dispatcher's `case 'generation_bumped':` arm in
--     LobbyManager.ts is RETAINED as a defensive forward-compat catch
--     for replay of historical events. Removing it would silently route
--     historical events through the unknown-event-type warn path; the
--     explicit case + debug-log keeps replay quiet and intentional.
--
-- D7. Legacy SQL integration test scripts at supabase/tests/draft_engine_v2_
--     phase{1,2,3}*.sql and supabase/seeds/phase1_regression_seed.sql
--     reference draft_generation / generation_bumped / pgmq. They are
--     standalone scripts (not invoked by CI / vitest); they were written
--     to validate the legacy pgmq architecture. They will fail to apply
--     after this migration. Left in place for now — out of scope for
--     11g.9; may be retired or rewritten under 11g.10 / 11g.11.
--
-- D8. Migration statement order: cron.unschedule → DROP wrapper RPCs →
--     DROP sweep function → CoR 4 RPCs → CHECK enum update → DROP COLUMN
--     → DROP EXTENSION CASCADE. The CoRs must precede DROP COLUMN since
--     they currently reference the column; the wrapper RPCs must drop
--     before DROP EXTENSION since they call pgmq.read / pgmq.archive.
--
-- Cross-references:
--   - docs/PHASE_4_5_PLAN.md § Chunk 11g.9
--   - docs/REGISTRY.md § KI-009
--   - docs/RUNBOOKS/draft-engine-v2-known-issues.md § KI-004, KI-007
--   - supabase/migrations/20260511010000_remove_pgmq_emissions.sql (11g.8)

-- ── 1. Unschedule pg_cron jobs ────────────────────────────────────────
-- pg_cron may not exist in dev/test environments. The original schedule
-- migration (20260426150000_draft_engine_v2_phase3_cron_vault.sql) wrapped
-- creation in EXCEPTION-tolerant DO blocks for this reason; mirror that
-- pattern here so the unschedule no-ops cleanly when cron is absent.

DO $unsched_sweep$
BEGIN
  PERFORM cron.unschedule('draft-deadline-sweep');
  RAISE NOTICE '  Unscheduled: draft-deadline-sweep';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available or draft-deadline-sweep already unscheduled, skipping';
END $unsched_sweep$;

DO $unsched_keepalive$
BEGIN
  PERFORM cron.unschedule('draft-autopick-keepalive');
  RAISE NOTICE '  Unscheduled: draft-autopick-keepalive';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available or draft-autopick-keepalive already unscheduled, skipping';
END $unsched_keepalive$;

-- ── 2. Drop pgmq wrapper RPCs ─────────────────────────────────────────
-- Defined in 20260426140000_draft_engine_v2_phase3_pgmq_wrappers.sql.
-- These wrap pgmq.read / pgmq.archive — they MUST drop before
-- DROP EXTENSION pgmq (otherwise they'd carry dangling references). The
-- Edge Function was the only caller; with index.ts removed in this same
-- commit, no other consumer exists.

DROP FUNCTION IF EXISTS public.draft_autopick_read(int, int);
DROP FUNCTION IF EXISTS public.draft_autopick_archive(bigint);

-- ── 3. Drop draft_deadline_sweep function ─────────────────────────────
-- 11g.8 (20260511010000) left the function body in place with the inner
-- pgmq.send block removed — the predicate walk + safety_net_hit metric
-- write was preserved through the cleanup boundary. With the cron job
-- unscheduled above and the engine carrying the deadline path entirely,
-- the function has no callers. Drop it. Its body referenced draft_generation;
-- removing it here unblocks the column drop below.

DROP FUNCTION IF EXISTS public.draft_deadline_sweep();

-- ── 4. CoR submit_pick_v2 — clean up v_generation leak ────────────────
--
-- Changes from 20260511010000_remove_pgmq_emissions.sql:83-317:
--   - DECLARE: removed `v_generation int;` (Decision Log D3)
--   - SELECT FROM leagues: removed `, draft_generation` and `, v_generation`
--     from the INTO list (Decision Log D2)
--   - All other behavior identical: idempotency check, preflight, payload
--     build, counter advance, event INSERT (triggers fire), pick_deadline
--     UPDATE, RETURN shape.
--   - Function COMMENT updated.

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

  SELECT draft_state, league_size, settings
    INTO v_draft_state, v_league_size, v_settings
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
  'Spec §4.5 / §5.2: the pick path. Idempotent (per-key advisory lock); preflight-checked (state, pick_number, round, on-the-clock, player-taken, auth); writes event + projection (via trigger); advances pick_deadline (CEIL + 1s pad). Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed v_generation leak — leagues.draft_generation column dropped.';

-- ── 5. CoR draft_pause — remove generation_bumped + draft_generation refs ─
--
-- Changes from 20260511000000_draft_events_notify.sql:148-264:
--   - DECLARE: removed `v_old_gen`, `v_new_gen` (Decision Log D2, D4)
--   - SELECT FROM leagues: removed `draft_generation` from columns + INTO
--   - UPDATE leagues: removed `draft_generation = v_new_gen` from SET
--   - Removed Event 1 (`generation_bumped`) entirely (Decision Log D4)
--   - RETURN: removed `generation` field (column gone — Decision Log D2)
--   - Function COMMENT updated.
-- Event 2 (`draft_paused`) retained — seq still captured for engine dedup.

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
  v_old_deadline   timestamptz;
  v_pick_count     int;
  v_remaining      int;
  v_paused_pick    int;
  v_paused_at      timestamptz;
  v_reason         text;
  v_caller_role    text;
  v_seq            bigint;
BEGIN
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: draft_pause requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT commissioner_id, draft_state, pick_deadline
    INTO v_commissioner, v_state, v_old_deadline
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
    RAISE EXCEPTION 'illegal_state_transition: cannot pause from state %', v_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_paused_at := now();
  v_reason    := COALESCE(p_actor ->> 'reason', 'commissioner');

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_paused_pick := v_pick_count + 1;
  v_remaining := GREATEST(
    0,
    COALESCE(ceil(EXTRACT(EPOCH FROM (v_old_deadline - now())))::int, 0)
  );

  UPDATE public.leagues
     SET draft_state   = 'paused',
         pick_deadline = NULL
   WHERE id = p_league_id;

  -- Event: draft_paused. Capture seq for the engine's dedup cursor
  -- (chunk 11g.7 sub-step 7e: lastAppliedSeq update path).
  -- Chunk 11g.9: generation_bumped emission removed (Decision Log D4).
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

  RETURN jsonb_build_object(
    'paused_at', v_paused_at,
    'seq',       v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_pause(uuid, jsonb) IS
  'Spec §4.6: clears pick_deadline, transitions to paused. Emits draft_paused. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.9: removed generation_bumped emission + draft_generation refs (column dropped).';

-- ── 6. CoR draft_resume — remove generation_bumped + draft_generation refs ─
--
-- Changes from 20260511010000_remove_pgmq_emissions.sql:334-448:
--   - DECLARE: removed `v_old_gen`, `v_new_gen` (Decision Log D2, D4)
--   - SELECT FROM leagues: removed `draft_generation` from columns + INTO
--   - UPDATE leagues: removed `draft_generation = v_new_gen` from SET
--   - Removed Event 1 (`generation_bumped`) entirely (Decision Log D4)
--   - RETURN: removed `generation` field
--   - Function COMMENT updated.

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

  SELECT commissioner_id, draft_state, settings
    INTO v_commissioner, v_state, v_settings
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
     SET draft_state   = 'active',
         pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  -- Event: draft_resumed. Capture seq for engine dedup (7e).
  -- Chunk 11g.9: generation_bumped emission removed (Decision Log D4).
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

  RETURN jsonb_build_object(
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_resume(uuid, jsonb) IS
  'Spec §4.7: recomputes pick_deadline, transitions to active. Emits draft_resumed. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed generation_bumped emission + draft_generation refs (column dropped).';

-- ── 7. CoR draft_extend — remove generation_bumped + draft_generation refs ─
--
-- Changes from 20260511010000_remove_pgmq_emissions.sql:462-582:
--   - DECLARE: removed `v_old_gen`, `v_new_gen` (Decision Log D2, D4)
--   - SELECT FROM leagues: removed `draft_generation` from columns + INTO
--   - UPDATE leagues: removed `draft_generation = v_new_gen` from SET
--   - Removed Event 1 (`generation_bumped`) entirely (Decision Log D4)
--   - RETURN: removed `generation` field
--   - Function COMMENT updated.

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

  SELECT commissioner_id, draft_state, pick_deadline
    INTO v_commissioner, v_state, v_old_deadline
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

  v_extended_at := now();

  v_new_deadline := date_trunc('second', v_old_deadline)
                  + make_interval(secs => p_extra_seconds);

  SELECT count(*) INTO v_pick_count
    FROM public.draft_picks_v2
   WHERE league_id = p_league_id;
  v_pick_number := v_pick_count + 1;

  UPDATE public.leagues
     SET pick_deadline = v_new_deadline
   WHERE id = p_league_id;

  -- Event: draft_extended. Capture seq for engine dedup (7e).
  -- Chunk 11g.9: generation_bumped emission removed (Decision Log D4).
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

  RETURN jsonb_build_object(
    'new_pick_deadline', v_new_deadline,
    'seq',               v_seq
  );
END;
$$;

COMMENT ON FUNCTION public.draft_extend(uuid, int, jsonb) IS
  'Spec §4.8: extends pick_deadline by p_extra_seconds. Emits draft_extended. Chunk 11g.7 sub-step 7e: returns seq for engine dedup. Chunk 11g.8: removed pgmq emission. Chunk 11g.9: removed generation_bumped emission + draft_generation refs (column dropped).';

-- ── 8. CHECK enum update: drop `generation_bumped` (21 → 20 values) ───
--
-- Decision Log D1: prior recon report said 20 → 19. Actual current count
-- (per 20260507030000_auction_auto_nominate.sql) is 21 values. Correct
-- delta is 21 → 20.
--
-- Historical generation_bumped rows in draft_events remain valid (CHECK
-- enforces on INSERTs, not on existing rows). Bootstrap dispatcher's
-- explicit `case 'generation_bumped':` arm in LobbyManager.applyEventDuringBootstrap
-- (chunk 11g.4 step 6b) handles replay of historical events.

ALTER TABLE public.draft_events
  DROP CONSTRAINT IF EXISTS draft_events_event_type_chk;

ALTER TABLE public.draft_events
  ADD CONSTRAINT draft_events_event_type_chk CHECK (event_type IN (
    -- Snake/linear (chunk 11g.4 step 5+). Chunk 11g.9 removed 'generation_bumped'.
    'pick',
    'pick_undone',
    'autopick_failed',
    'draft_started',
    'draft_paused',
    'draft_resumed',
    'draft_extended',
    'draft_completed',
    'draft_cancelled',
    'commissioner_override',
    -- Auction (chunks 11g.6 sub-steps 6a + 6b + 6c1)
    'auction_nomination_started',
    'auction_bid_placed',
    'auction_nomination_expired',
    'auction_nomination_closed',
    'auction_bid_extends_timer',
    'auction_auto_nominated',
    'auction_paused',
    'auction_resumed',
    'auction_commissioner_override',
    -- Auction (chunk 11g.6 sub-step 6c3 — Path Y extension)
    'auction_nomination_skipped'
  ));

-- ── 9. Drop leagues.draft_generation column ───────────────────────────
--
-- Decision Log D2. All snake/linear RPCs that referenced this column are
-- CoR'd above to remove the references. Auction RPCs do not reference it.
-- Engine code does not read `result.generation` from any RPC return value.

ALTER TABLE public.leagues
  DROP COLUMN IF EXISTS draft_generation;

-- ── 10. Drop pgmq extension (CASCADE) ─────────────────────────────────
--
-- IRREVERSIBILITY POINT. CASCADE drops the pgmq schema and all objects
-- within it (pgmq.q_draft_deadlines queue table, pgmq.a_draft_deadlines
-- archive table, all pgmq.* functions). After this statement, the pgmq
-- extension and the draft_deadlines queue are gone permanently.
--
-- All callers have been removed in this same migration:
--   - draft_autopick_read / _archive wrappers: dropped in section 2.
--   - draft_deadline_sweep: dropped in section 3.
--   - submit_pick_v2 / draft_resume / draft_extend pgmq.send: removed in
--     chunk 11g.8 (20260511010000_remove_pgmq_emissions.sql).
-- No other consumer exists in this project's schema.

DROP EXTENSION IF EXISTS pgmq CASCADE;

-- ── 11. Verify ────────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_col_exists  boolean;
  v_ext_exists  boolean;
  v_func_count  int;
BEGIN
  -- Column removed.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'leagues'
       AND column_name = 'draft_generation'
  ) INTO v_col_exists;
  IF v_col_exists THEN
    RAISE EXCEPTION '11g.9 verify: leagues.draft_generation still exists';
  END IF;

  -- Extension removed.
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgmq'
  ) INTO v_ext_exists;
  IF v_ext_exists THEN
    RAISE EXCEPTION '11g.9 verify: pgmq extension still installed';
  END IF;

  -- Wrapper RPCs + sweep function removed.
  SELECT count(*)
    INTO v_func_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('draft_autopick_read', 'draft_autopick_archive', 'draft_deadline_sweep');
  IF v_func_count <> 0 THEN
    RAISE EXCEPTION '11g.9 verify: % legacy pgmq function(s) still defined', v_func_count;
  END IF;

  RAISE NOTICE '  11g.9 verify: legacy pgmq infrastructure fully removed.';
END
$verify$;
