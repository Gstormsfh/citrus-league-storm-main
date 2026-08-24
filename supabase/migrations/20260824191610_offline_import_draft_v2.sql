-- ============================================================================
-- offline_import_draft_v2 (2026-08-24 launch build)
-- [ALREADY APPLIED TO PROD iezwazccqqrhrjupxzvf as version 20260824191610 —
--  this file is the repo mirror for environment parity.]
--
-- Commissioner bulk-import of an offline (in-person) draft's results into
-- the v2 event log. The import IS a real event stream — draft_started,
-- one 'pick' event per selection, draft_completed — so every existing
-- consumer works unchanged with ZERO new moving parts:
--   * tg_draft_events_project_pick projects each pick into draft_picks_v2
--   * tg_draft_events_sync_roster (on draft_completed) builds rosters and
--     finalizes leagues.draft_status/draft_state='completed'
--   * draft_events_notify_trigger NOTIFYs fire post-commit, when the
--     league is already 'completed' — the engine's NOTIFY-creates-lobby
--     gate (draft_status='in_progress' only) skips them, so the live
--     engine NEVER builds a lobby for an offline league. The league is
--     never observable in 'in_progress' (single transaction).
--
-- Auth: service_role/postgres (API route pre-verifies commissioner) or
-- an authenticated caller whose auth.uid() = leagues.commissioner_id.
-- p_actor must be kind='commissioner' with id = commissioner_id.
--
-- Idempotency: p_idempotency_key rides on the draft_started event.
-- A replay (same key) short-circuits and reports current state.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.offline_import_draft_v2(
  p_league_id       uuid,
  p_picks           jsonb,             -- [{pick_number int, team_id uuid, player_id int}, ...]
  p_actor           jsonb,             -- {kind:'commissioner', id:<commissioner uuid>}
  p_idempotency_key uuid,
  p_correlation_id  uuid DEFAULT NULL,
  p_allow_partial   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role    text;
  v_commissioner   uuid;
  v_draft_status   text;
  v_settings       jsonb;
  v_draft_type     text;

  v_team_ids       uuid[];
  v_team_count     int;

  v_n              int;
  v_rounds         int;
  v_pick           jsonb;
  v_pn             int;
  v_team_id        uuid;
  v_player_id      bigint;

  v_seen_pns       int[]  := '{}';
  v_seen_players   bigint[] := '{}';
  v_team_pick_ct   jsonb := '{}'::jsonb;

  v_now            timestamptz := date_trunc('second', now());
  v_session_id     uuid := gen_random_uuid();
  v_correlation    uuid;
  v_payload        jsonb;
  v_hash           text;
  v_append         jsonb;
  v_first_seq      bigint := NULL;
  v_last_seq       bigint := NULL;
  v_existing_ct    int;
  v_sync           jsonb;

  v_existing_payload jsonb;
BEGIN
  -- ── Step 0: idempotency short-circuit ──────────────────────────────
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_input: p_idempotency_key required'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('draft_events_idem:' || p_idempotency_key::text)
  );

  SELECT payload INTO v_existing_payload
    FROM public.draft_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF COALESCE(v_existing_payload ->> 'source', '') <> 'offline_import' THEN
      RAISE EXCEPTION 'idempotency_conflict: key % previously used for a non-import event',
        p_idempotency_key USING ERRCODE = 'unique_violation';
    END IF;
    SELECT count(*) INTO v_existing_ct
      FROM public.draft_events
     WHERE league_id = p_league_id AND event_type = 'pick';
    SELECT draft_status::text INTO v_draft_status
      FROM public.leagues WHERE id = p_league_id;
    RETURN jsonb_build_object(
      'success', true, 'was_duplicate', true,
      'total_picks', v_existing_ct, 'draft_status', v_draft_status
    );
  END IF;

  -- ── Step 1: authorization ──────────────────────────────────────────
  IF (p_actor ->> 'kind') IS DISTINCT FROM 'commissioner' THEN
    RAISE EXCEPTION 'unauthorized: offline_import_draft_v2 requires actor.kind=commissioner (got %)',
      COALESCE(p_actor ->> 'kind', '<missing>') USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_caller_role := auth.role();

  -- ── Step 2: league preflight (row lock serializes double imports) ──
  SELECT commissioner_id, draft_status::text, settings
    INTO v_commissioner, v_draft_status, v_settings
    FROM public.leagues
   WHERE id = p_league_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'illegal_state: league % not found', p_league_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller_role NOT IN ('service_role', 'postgres')
     AND auth.uid() IS DISTINCT FROM v_commissioner THEN
    RAISE EXCEPTION 'unauthorized: caller % is not the commissioner of league %',
      auth.uid(), p_league_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (p_actor ->> 'id') IS DISTINCT FROM v_commissioner::text THEN
    RAISE EXCEPTION 'unauthorized: actor.id % is not the commissioner of league %',
      COALESCE(p_actor ->> 'id', '<missing>'), p_league_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_draft_type := COALESCE(v_settings ->> 'draftType', 'snake');
  IF v_draft_type <> 'offline' THEN
    RAISE EXCEPTION 'offline_only: league % has draftType=% — import is only for offline drafts',
      p_league_id, v_draft_type USING ERRCODE = 'check_violation';
  END IF;

  IF v_draft_status = 'completed' THEN
    RAISE EXCEPTION 'draft_already_completed: league % draft is already completed',
      p_league_id USING ERRCODE = 'check_violation';
  END IF;
  IF v_draft_status NOT IN ('not_started', 'queued') THEN
    RAISE EXCEPTION 'illegal_state: league % has draft_status=% (import requires not_started)',
      p_league_id, v_draft_status USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_existing_ct
    FROM public.draft_events
   WHERE league_id = p_league_id
     AND event_type IN ('pick', 'draft_started', 'draft_completed');
  IF v_existing_ct > 0 THEN
    RAISE EXCEPTION 'already_imported: league % already has % draft event(s)',
      p_league_id, v_existing_ct USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 3: teams ──────────────────────────────────────────────────
  SELECT array_agg(id), count(*) INTO v_team_ids, v_team_count
    FROM public.teams WHERE league_id = p_league_id;
  IF COALESCE(v_team_count, 0) < 2 THEN
    RAISE EXCEPTION 'draft_not_configured: league % has % team(s); need at least 2',
      p_league_id, COALESCE(v_team_count, 0) USING ERRCODE = 'check_violation';
  END IF;

  -- ── Step 4: validate picks payload ─────────────────────────────────
  IF p_picks IS NULL OR jsonb_typeof(p_picks) <> 'array' THEN
    RAISE EXCEPTION 'invalid_picks: p_picks must be a JSON array'
      USING ERRCODE = 'check_violation';
  END IF;
  v_n := jsonb_array_length(p_picks);
  IF v_n < 1 THEN
    RAISE EXCEPTION 'invalid_picks: p_picks is empty' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_picks) LOOP
    IF jsonb_typeof(v_pick -> 'pick_number') <> 'number' THEN
      RAISE EXCEPTION 'invalid_picks: every pick needs a numeric pick_number'
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(v_pick -> 'player_id') <> 'number' THEN
      RAISE EXCEPTION 'invalid_picks: every pick needs a numeric player_id (pick %)',
        v_pick ->> 'pick_number' USING ERRCODE = 'check_violation';
    END IF;
    v_pn := (v_pick ->> 'pick_number')::int;
    BEGIN
      v_team_id := (v_pick ->> 'team_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_picks: pick % team_id is not a valid uuid', v_pn
        USING ERRCODE = 'check_violation';
    END;
    v_player_id := (v_pick ->> 'player_id')::bigint;

    IF v_pn < 1 OR v_pn > v_n THEN
      RAISE EXCEPTION 'non_contiguous_picks: pick_number % outside 1..%', v_pn, v_n
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_pn = ANY (v_seen_pns) THEN
      RAISE EXCEPTION 'non_contiguous_picks: duplicate pick_number %', v_pn
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen_pns := v_seen_pns || v_pn;

    IF NOT (v_team_id = ANY (v_team_ids)) THEN
      RAISE EXCEPTION 'team_not_in_league: pick % team % is not in league %',
        v_pn, v_team_id, p_league_id USING ERRCODE = 'check_violation';
    END IF;

    IF v_player_id <= 0 THEN
      RAISE EXCEPTION 'invalid_picks: pick % player_id must be positive', v_pn
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_player_id = ANY (v_seen_players) THEN
      RAISE EXCEPTION 'duplicate_player: player % appears more than once (pick %)',
        v_player_id, v_pn USING ERRCODE = 'check_violation';
    END IF;
    v_seen_players := v_seen_players || v_player_id;

    v_team_pick_ct := jsonb_set(
      v_team_pick_ct, ARRAY[v_team_id::text],
      to_jsonb(COALESCE((v_team_pick_ct ->> v_team_id::text)::int, 0) + 1)
    );
  END LOOP;

  -- Rectangularity: full imports must be teams × rounds with every
  -- league team appearing exactly rounds times.
  IF NOT p_allow_partial THEN
    IF v_n % v_team_count <> 0 THEN
      RAISE EXCEPTION 'not_rectangular: % picks does not divide evenly across % teams (pass p_allow_partial for a short draft)',
        v_n, v_team_count USING ERRCODE = 'check_violation';
    END IF;
    v_rounds := v_n / v_team_count;
    FOR v_pn IN 1..v_team_count LOOP
      v_team_id := v_team_ids[v_pn];
      IF COALESCE((v_team_pick_ct ->> v_team_id::text)::int, 0) <> v_rounds THEN
        RAISE EXCEPTION 'not_rectangular: team % has % pick(s), expected % (pass p_allow_partial for uneven results)',
          v_team_id, COALESCE((v_team_pick_ct ->> v_team_id::text)::int, 0), v_rounds
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  ELSE
    v_rounds := CEIL(v_n::numeric / v_team_count)::int;
  END IF;

  v_correlation := COALESCE(p_correlation_id, gen_random_uuid());

  -- ── Step 5: draft_started (carries the import idempotency key) ─────
  v_payload := jsonb_build_object(
    'started_at',              v_now,
    'first_pick_deadline',     v_now,
    'total_rounds',            v_rounds,
    'total_teams',             v_team_count,
    'pick_time_limit_seconds', 0,
    'draft_format',            'offline',
    'source',                  'offline_import'
  );
  v_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  v_append := public.append_draft_event(
    p_league_id, 'draft_started', v_payload,
    p_idempotency_key, v_hash, p_actor, v_correlation
  );
  v_first_seq := (v_append ->> 'seq')::bigint;

  -- ── Step 6: pick events, in pick_number order ──────────────────────
  FOR v_pick IN
    SELECT value FROM jsonb_array_elements(p_picks)
    ORDER BY (value ->> 'pick_number')::int
  LOOP
    v_pn        := (v_pick ->> 'pick_number')::int;
    v_team_id   := (v_pick ->> 'team_id')::uuid;
    v_player_id := (v_pick ->> 'player_id')::bigint;

    v_payload := jsonb_build_object(
      'pick_number',   v_pn,
      'round',         ((v_pn - 1) / v_team_count) + 1,
      'team_id',       v_team_id,
      'player_id',     v_player_id,
      'picked_at',     v_now + (v_pn * interval '1 millisecond'),
      'is_autopick',   false,
      'pick_deadline', v_now,
      'session_id',    v_session_id,
      'source',        'offline_import'
    );
    v_hash := 'sha256:' || encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
    v_append := public.append_draft_event(
      p_league_id, 'pick', v_payload,
      gen_random_uuid(), v_hash, p_actor, v_correlation
    );
    v_last_seq := (v_append ->> 'seq')::bigint;
  END LOOP;

  -- ── Step 7: draft_completed (trigger syncs rosters + finalizes) ────
  v_payload := jsonb_build_object(
    'completed_at', v_now + ((v_n + 1) * interval '1 millisecond'),
    'total_picks',  v_n,
    'source',       'offline_import'
  );
  v_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  v_append := public.append_draft_event(
    p_league_id, 'draft_completed', v_payload,
    gen_random_uuid(), v_hash, p_actor, v_correlation
  );
  v_last_seq := (v_append ->> 'seq')::bigint;

  -- ── Step 8: verify + report ────────────────────────────────────────
  -- The sync-roster trigger already ran (never re-raises). Re-invoke for
  -- a verifiable result surface — it is gap-fill/idempotent, so this
  -- reports counts without double-writing.
  v_sync := public.sync_roster_assignments_for_league(p_league_id);

  SELECT draft_status::text INTO v_draft_status
    FROM public.leagues WHERE id = p_league_id;

  RETURN jsonb_build_object(
    'success',       true,
    'was_duplicate', false,
    'total_picks',   v_n,
    'total_rounds',  v_rounds,
    'total_teams',   v_team_count,
    'first_seq',     v_first_seq,
    'last_seq',      v_last_seq,
    'draft_status',  v_draft_status,
    'roster_sync',   v_sync
  );
END;
$function$;
