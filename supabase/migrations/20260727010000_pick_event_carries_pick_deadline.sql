-- Phase 4.5 chunk 11g.10 sub-step 10c-2 batch 2 (item 1: pick event payload
-- carries pick_deadline). Ratified 2026-07-27 (Option A directly, no
-- stopgap) — see PROJECT_PLAN.md Decision Log entry this date for the
-- verify report and rationale.
--
-- ── The defect this migration fixes ─────────────────────────────────
--
-- Before this migration:
--   1. Client submits pick via POST /api/draft/v2/league/:leagueId/pick
--      (server/src/routes/draftV2Pick.ts:53).
--   2. Route calls submit_pick_v2 RPC. RPC computes v_new_deadline
--      locally, UPDATEs leagues.pick_deadline, RETURNs it in jsonb.
--      Writes 'pick' event to draft_events — **without** pick_deadline
--      in the payload.
--   3. AFTER-INSERT trigger draft_events_notify_after_insert fires,
--      NOTIFYs {league_id, seq} to the engine.
--   4. Engine's processExternalEvent (LobbyManager.ts:4758) applies via
--      applyPickEvent (LobbyManager.ts:2885). applyPickEvent advances
--      picksMade + draftStatus but does NOT re-arm the pick timer.
--   5. Engine's timer is still armed from bootstrap (leagues.pick_deadline
--      at construction time). Stale timer eventually fires and autopicks
--      for the CURRENT on-clock team — a premature-steal for every human
--      pick in production.
--
-- After this migration:
--   Step 2 embeds pick_deadline in the 'pick' event payload AND bumps
--   event_version to 2 for pick events. The engine change (separate
--   commit, applied after this migration is live per the deploy-order
--   rule below) reads payload.pick_deadline and calls setPickDeadline.
--
-- ── Deploy-order rule (10f rehearsal pattern) ───────────────────────
--
-- MIGRATION FIRST, ENGINE SECOND.
--
-- The old engine ignores the new field harmlessly (payload.pick_deadline
-- is present but never read). No behavioral change for the old engine.
-- Once the migration is live everywhere, deploy the engine change; the
-- new engine reads the field on every live-apply event and re-arms the
-- timer correctly.
--
-- Rolling back is symmetric: engine first, then migration. Old engine
-- + new migration is safe; new engine + old migration is NOT safe (new
-- engine would try to read a missing field). If a rollback is needed
-- mid-window, roll the ENGINE back first (revert the deploy), then the
-- migration (if truly necessary). See docs/PHASE_4_5_PROJECT_PLAN.md
-- Decision Log 2026-07-27 "10f coordinated-deploy rehearsal pattern"
-- for the durable record.

BEGIN;

-- ── Step 1: bump validate_draft_event_payload's required fields. ────
--
-- Add `pick_deadline` to the 'pick' event's required-field set. The
-- validator is called via PERFORM inside submit_pick_v2 (line 2198 of
-- the recovery migration) BEFORE the INSERT, so this gate protects
-- both engine-authored and external RPC callers.
--
-- Rationale for making it required rather than optional: (a) an event-
-- sourcing purist read — the durable event IS the state, and re-arming
-- the timer depends on the field's presence, so a missing field is a
-- correctness bug at write time; (b) simpler engine code path (no
-- conditional branch on presence for new events); (c) the field is
-- always available in submit_pick_v2 — the RPC computes v_new_deadline
-- unconditionally and there's no scenario where a new pick would
-- legitimately lack a deadline.
--
-- Backwards compat with existing v1 events replayed at bootstrap:
-- validate_draft_event_payload is called at write time only, not at
-- read time. So old rows in draft_events without pick_deadline are
-- not re-validated. The engine's applyPickEvent guards on presence
-- (v1 events skip the re-arm — matches current behavior for those old
-- rows). See LobbyManager.ts applyPickEvent for the presence guard.

CREATE OR REPLACE FUNCTION public.validate_draft_event_payload(
  p_event_type text,
  p_payload    jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_required text[];
  v_field    text;
BEGIN
  CASE p_event_type
    WHEN 'pick' THEN
      -- §6.1 — chunk 10c-2 batch 2 (2026-07-27): pick_deadline added
      -- to the required set. Fixes the external-apply timer-not-armed
      -- defect (S5 evidence, verify report 2026-07-27).
      v_required := ARRAY['pick_number','round','team_id','player_id','picked_at','is_autopick','pick_deadline'];

    WHEN 'pick_undone' THEN
      v_required := ARRAY['target_event_id','reason'];

    WHEN 'autopick_failed' THEN
      v_required := ARRAY['pick_number','generation','read_ct','last_error','pgmq_msg_id'];

    WHEN 'draft_started' THEN
      v_required := ARRAY['started_at','first_pick_deadline','total_rounds','total_teams','pick_time_limit_seconds','draft_format'];

    WHEN 'draft_paused' THEN
      v_required := ARRAY['paused_at','paused_pick_number','remaining_seconds','reason'];

    WHEN 'draft_resumed' THEN
      -- Already has new_pick_deadline in the required set (unchanged).
      -- Engine applyDraftResumedEvent (new in the paired engine commit)
      -- reads this on live apply.
      v_required := ARRAY['resumed_at','resumed_pick_number','new_pick_deadline'];

    WHEN 'draft_extended' THEN
      -- Already has new_pick_deadline in the required set (unchanged).
      -- Engine applyDraftExtendedEvent (new in the paired engine commit)
      -- reads this on live apply.
      v_required := ARRAY['extended_at','pick_number','extra_seconds','new_pick_deadline'];

    WHEN 'draft_completed' THEN
      v_required := ARRAY['completed_at','total_picks'];

    WHEN 'draft_cancelled' THEN
      v_required := ARRAY['cancelled_at','reason'];

    WHEN 'commissioner_override' THEN
      RETURN true;

    WHEN 'generation_bumped' THEN
      v_required := ARRAY['old_generation','new_generation','reason'];

    WHEN 'auction_nomination_started'
       , 'auction_bid_placed'
       , 'auction_bid_extends_timer'
       , 'auction_nomination_closed'
       , 'auction_nomination_expired'
       , 'auction_paused'
       , 'auction_resumed'
       , 'auction_nomination_skipped'
       , 'auction_auto_nominated'
       , 'auction_commissioner_override' THEN
      -- Auction events (chunk 11g.6 6a-6c4): payload validation is
      -- handled inside the auction RPCs; keep the validator permissive
      -- here to avoid churn on this migration.
      RETURN true;

    ELSE
      RAISE EXCEPTION 'invalid_event_payload: unknown event_type %', p_event_type
        USING ERRCODE = 'check_violation';
  END CASE;

  -- Required-fields check.
  FOREACH v_field IN ARRAY v_required LOOP
    IF NOT (p_payload ? v_field) THEN
      RAISE EXCEPTION 'invalid_event_payload: % missing required field "%"',
        p_event_type, v_field
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Spot-check critical types where a wrong type would corrupt the
  -- projection or invariant predicates (spec §10).
  IF p_event_type = 'pick' THEN
    IF jsonb_typeof(p_payload->'pick_number') <> 'number' THEN
      RAISE EXCEPTION 'invalid_event_payload: pick.pick_number must be a number'
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(p_payload->'player_id') <> 'number' THEN
      RAISE EXCEPTION 'invalid_event_payload: pick.player_id must be a number'
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(p_payload->'is_autopick') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_event_payload: pick.is_autopick must be a boolean'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Chunk 10c-2 batch 2: pick_deadline is a timestamptz encoded as a
    -- JSON string (jsonb_typeof returns 'string' for these). Accepts
    -- ISO 8601 strings that Postgres's ::timestamptz cast can parse;
    -- the engine parses via `new Date(...)`.
    IF jsonb_typeof(p_payload->'pick_deadline') <> 'string' THEN
      RAISE EXCEPTION 'invalid_event_payload: pick.pick_deadline must be a string (ISO 8601 timestamp)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.validate_draft_event_payload(text, jsonb) IS
  'Spec §6 payload catalog. Chunk 10c-2 batch 2 (2026-07-27): pick event required-fields grew pick_deadline (event_version 2). Validator runs at write time only; existing v1 rows are not re-validated on read.';


-- ── Step 2: submit_pick_v2 writes pick_deadline into the event payload. ─
--
-- The RPC already computed v_new_deadline in prior versions but only
-- persisted it into leagues.pick_deadline and returned it in the jsonb
-- result. This modification computes v_new_deadline BEFORE the event
-- INSERT, embeds it in the payload jsonb, bumps event_version to 2
-- on the INSERT, and preserves the returned jsonb shape so existing
-- callers of the RPC are unaffected.

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

  -- ── Step 3: Compute next pick_deadline BEFORE the event insert ──────
  --
  -- Chunk 10c-2 batch 2 (2026-07-27): moved the deadline computation
  -- up from Step 4 to here so it can be embedded in the event payload.
  -- The value is written twice (identically):
  --   (a) into the event payload as `pick_deadline` (for engine re-arm)
  --   (b) into leagues.pick_deadline in Step 5 (for engine bootstrap
  --       and for the RPC's jsonb return value used by callers)
  --
  -- Both writes happen inside the same transaction; they cannot diverge.

  v_picked_at := now();
  v_pick_time := COALESCE(
    (v_settings ->> 'pickTimeLimit')::int,
    90
  );
  v_new_deadline := date_trunc('second', now())
                  + make_interval(secs => ceil(v_pick_time)::int)
                  + interval '1 second';

  v_payload := jsonb_build_object(
    'pick_number',   p_pick_number,
    'round',         p_round,
    'team_id',       p_team_id,
    'player_id',     p_player_id,
    'picked_at',     v_picked_at,
    'is_autopick',   (v_actor_kind = 'autopick'),
    'session_id',    p_session_id,
    -- 10c-2 batch 2: pick_deadline embedded here.
    'pick_deadline', v_new_deadline
  );

  PERFORM public.validate_draft_event_payload('pick', v_payload);

  -- ── Step 4: Advance seq counter + INSERT event ──────────────────────
  --
  -- event_version bumped to 2 on new pick events (chunk 10c-2 batch 2).
  -- Older v1 rows in the log are unaffected; the engine's apply logic
  -- reads pick_deadline conditionally.

  UPDATE public.leagues
     SET draft_event_counter = draft_event_counter + 1
   WHERE id = p_league_id
  RETURNING draft_event_counter INTO v_new_seq;

  v_correlation_id := COALESCE(p_correlation_id, gen_random_uuid());

  INSERT INTO public.draft_events (
    league_id, seq, event_type, event_version, payload, payload_hash,
    idempotency_key, actor, correlation_id
  )
  VALUES (
    p_league_id, v_new_seq, 'pick', 2, v_payload, p_payload_hash,
    p_idempotency_key, p_actor, v_correlation_id
  )
  RETURNING id INTO v_event_id;

  -- AFTER INSERT trigger tg_draft_events_project_pick fires HERE,
  -- writing the corresponding row into draft_picks_v2.
  -- AFTER INSERT trigger draft_events_notify_after_insert (chunk 11g.7
  -- sub-step 7e) fires HERE, emitting pg_notify('draft_events', ...).

  -- ── Step 5: Persist the new deadline into leagues ──────────────────

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
  'Spec §4.5 / §5.2: the pick path. Chunk 10c-2 batch 2 (2026-07-27): pick event payload now carries pick_deadline for engine external-apply timer re-arm; event_version bumped to 2. The RPC computes the deadline ONCE and writes it to both the event payload (for engine consumption) and leagues.pick_deadline (for bootstrap + RPC return); both writes happen inside the same transaction.';


-- ── Step 3: verify. ─────────────────────────────────────────────────
--
-- Idempotency tripwire: writes a synthetic pick event to a
-- nonexistent league to force the validator into the required-fields
-- branch. The exception is caught; the point is that the required-
-- field check for `pick_deadline` MUST be reachable. If a future
-- refactor removes it from the required set, this DO block fails.

DO $verify$
BEGIN
  BEGIN
    PERFORM public.validate_draft_event_payload(
      'pick',
      jsonb_build_object(
        'pick_number', 1,
        'round', 1,
        'team_id', gen_random_uuid()::text,
        'player_id', 1,
        'picked_at', now(),
        'is_autopick', false
        -- pick_deadline intentionally omitted
      )
    );
    -- Should not reach here.
    RAISE EXCEPTION 'validate_draft_event_payload FAILED to enforce pick_deadline requirement';
  EXCEPTION
    WHEN check_violation THEN
      -- Expected: the required-fields loop raised. Ratify by no-op.
      NULL;
  END;
END;
$verify$;

COMMIT;
