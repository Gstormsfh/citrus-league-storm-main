-- Two live-database bugs in the waiver cron pipeline:
--
-- 1. process_all_pending_waivers ends with an UPDATE that references
--    `waiver_period_hours` as if it were a column on player_waiver_status.
--    It lives on leagues. The UPDATE errors with "column does not exist"
--    and, because the function has no EXCEPTION block, the error rolls
--    back EVERY claim the function just processed. The nightly cron has
--    been silently failing since player_waiver_status was created.
--
-- 2. process_waiver_claims had no waiver-window gate: if the cron ran
--    before a player's waiver period had elapsed, the claim would be
--    awarded immediately, giving the first claimant the player before
--    other managers had a chance to submit a competing claim. Claims
--    for players still inside their waiver window are now skipped and
--    picked up on the next cron run after the window closes.

CREATE OR REPLACE FUNCTION public.process_waiver_claims(p_league_id uuid)
 RETURNS TABLE(out_claim_id uuid, out_team_id uuid, out_player_id integer, out_status text, out_failure_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim RECORD;
  v_league RECORD;
  v_waiver_type TEXT;
  v_player_id_str TEXT;
  v_drop_player_id_str TEXT;
  v_lock_acquired BOOLEAN;
  v_move_result JSONB;
  v_user_id UUID;
  v_max_priority NUMERIC;
BEGIN
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_league_id::TEXT));
  IF NOT v_lock_acquired THEN RETURN; END IF;

  SELECT waiver_type INTO v_league FROM leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'League % not found', p_league_id; END IF;
  v_waiver_type := COALESCE(v_league.waiver_type, 'rolling');
  IF v_waiver_type = 'faab' THEN RETURN; END IF;

  IF v_waiver_type = 'reverse_standings' THEN
    BEGIN PERFORM public.recalculate_reverse_standings_priority(p_league_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  SELECT COALESCE(MAX(priority), 0) + 1 INTO v_max_priority
  FROM waiver_priority WHERE league_id = p_league_id;

  FOR v_claim IN
    SELECT wc.id, wc.team_id, wc.player_id, wc.drop_player_id,
           COALESCE(wp.priority, v_max_priority) AS priority, wc.created_at
    FROM waiver_claims wc
    LEFT JOIN waiver_priority wp ON wp.team_id = wc.team_id AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id AND wc.status = 'pending'
      -- Skip claims whose target player is still inside their waiver
      -- window so other managers can still submit competing claims.
      AND NOT public.is_player_on_waivers(wc.league_id, wc.player_id)
    ORDER BY COALESCE(wp.priority, v_max_priority) ASC, wc.created_at ASC
    LIMIT 100 FOR UPDATE OF wc SKIP LOCKED
  LOOP
    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE WHEN v_claim.drop_player_id IS NOT NULL
      THEN v_claim.drop_player_id::TEXT ELSE NULL END;

    SELECT owner_id INTO v_user_id FROM teams WHERE id = v_claim.team_id LIMIT 1;
    IF v_user_id IS NULL THEN
      SELECT commissioner_id INTO v_user_id FROM leagues WHERE id = p_league_id LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      UPDATE waiver_claims SET status='failed',
        failure_reason='Team has no owner and league has no commissioner', processed_at=NOW()
      WHERE id = v_claim.id;
      out_claim_id := v_claim.id; out_team_id := v_claim.team_id; out_player_id := v_claim.player_id;
      out_status := 'failed'; out_failure_reason := 'Team has no owner and league has no commissioner';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT public.process_roster_move(
      p_league_id, v_user_id, v_drop_player_id_str, v_player_id_str, 'Waiver Processing'
    ) INTO v_move_result;

    IF (v_move_result->>'success')::BOOLEAN IS TRUE THEN
      UPDATE waiver_claims SET status='successful', processed_at=NOW() WHERE id = v_claim.id;

      IF v_waiver_type = 'rolling' THEN
        INSERT INTO waiver_priority (league_id, team_id, priority)
        VALUES (p_league_id, v_claim.team_id,
          (SELECT COALESCE(MAX(wp2.priority), 0) + 1 FROM waiver_priority wp2 WHERE wp2.league_id = p_league_id))
        ON CONFLICT (league_id, team_id) DO UPDATE
        SET priority = (SELECT COALESCE(MAX(wp2.priority), 0) + 1 FROM waiver_priority wp2 WHERE wp2.league_id = p_league_id);

        WITH ranked AS (
          SELECT wp3.team_id AS t_id, ROW_NUMBER() OVER (ORDER BY wp3.priority ASC) AS new_priority
          FROM waiver_priority wp3 WHERE wp3.league_id = p_league_id
        )
        UPDATE waiver_priority wpu SET priority = ranked.new_priority
        FROM ranked WHERE wpu.team_id = ranked.t_id AND wpu.league_id = p_league_id;
      END IF;

      out_claim_id := v_claim.id; out_team_id := v_claim.team_id; out_player_id := v_claim.player_id;
      out_status := 'successful'; out_failure_reason := NULL;
      RETURN NEXT;
    ELSE
      UPDATE waiver_claims SET status='failed',
        failure_reason = COALESCE(v_move_result->>'error', v_move_result->>'message', 'Unknown error'),
        processed_at = NOW()
      WHERE id = v_claim.id;
      out_claim_id := v_claim.id; out_team_id := v_claim.team_id; out_player_id := v_claim.player_id;
      out_status := 'failed';
      out_failure_reason := COALESCE(v_move_result->>'error', v_move_result->>'message', 'Unknown error');
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_all_pending_waivers()
 RETURNS TABLE(league_id uuid, league_name text, total_processed integer, successful integer, failed integer, details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league RECORD;
  v_result RECORD;
  v_processed INT := 0;
  v_successful INT := 0;
  v_failed INT := 0;
  v_details JSONB := '[]'::JSONB;
BEGIN
  FOR v_league IN
    SELECT DISTINCT wc.league_id, l.name AS league_name
    FROM waiver_claims wc
    JOIN leagues l ON l.id = wc.league_id
    WHERE wc.status = 'pending'
      AND COALESCE(l.waiver_type, 'rolling') <> 'faab'
  LOOP
    v_processed := 0;
    v_successful := 0;
    v_failed := 0;
    v_details := '[]'::JSONB;

    FOR v_result IN
      SELECT * FROM public.process_waiver_claims(v_league.league_id)
    LOOP
      v_processed := v_processed + 1;
      IF v_result.out_status = 'successful' THEN
        v_successful := v_successful + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

      v_details := v_details || jsonb_build_object(
        'claim_id', v_result.out_claim_id,
        'player_id', v_result.out_player_id,
        'team_id', v_result.out_team_id,
        'status', v_result.out_status,
        'failure_reason', v_result.out_failure_reason
      );
    END LOOP;

    league_id := v_league.league_id;
    league_name := v_league.league_name;
    total_processed := v_processed;
    successful := v_successful;
    failed := v_failed;
    details := v_details;
    RETURN NEXT;
  END LOOP;

  -- Mark expired player_waiver_status rows as cleared. Previously this
  -- UPDATE referenced waiver_period_hours as a column on player_waiver_status
  -- (it's on leagues), which raised "column does not exist" and rolled
  -- back every claim the cron had just processed.
  BEGIN
    UPDATE public.player_waiver_status pws
    SET cleared_at = NOW()
    FROM public.leagues l
    WHERE pws.league_id = l.id
      AND pws.cleared_at IS NULL
      AND NOW() > pws.dropped_at + (COALESCE(l.waiver_period_hours, 48) || ' hours')::INTERVAL;
  EXCEPTION WHEN OTHERS THEN
    -- Never let housekeeping abort the whole cron run.
    NULL;
  END;

  RETURN;
END;
$function$;
