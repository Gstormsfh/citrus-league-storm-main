-- Fix critical bugs in the waiver claim processor pipeline.
--
-- Three bugs uncovered by live end-to-end testing on 2026-04-07:
--
-- 1. waiver_claims had an `update_waiver_claims_updated_at` trigger calling
--    `update_updated_at_column()`, but the table had no `updated_at` column,
--    so EVERY UPDATE (success or failure path) inside process_waiver_claims
--    raised "record new has no field updated_at" and rolled the cron back.
--
-- 2. process_waiver_claims checked `v_move_result->>'status'` and
--    `->>'message'`, but process_roster_move returns `success` and `error`.
--    Result: every successful claim was marked failed and every failure
--    reason was "Unknown error".
--
-- 3. The OUT parameter `team_id` collided with the `waiver_priority.team_id`
--    column inside the rolling-priority maintenance INSERT, raising
--    "column reference team_id is ambiguous" and aborting the whole tx.
--
-- Plus: process_roster_move never marked player_waiver_status.cleared_at
-- when a player was successfully added, so winning claims left a stale
-- "on waivers" row indefinitely.

ALTER TABLE public.waiver_claims
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP FUNCTION IF EXISTS public.process_waiver_claims(uuid);

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

-- process_roster_move: clear waiver status when a player is added.
CREATE OR REPLACE FUNCTION public.process_roster_move(
  p_league_id uuid,
  p_user_id uuid,
  p_drop_player_id text DEFAULT NULL::text,
  p_add_player_id text DEFAULT NULL::text,
  p_transaction_source text DEFAULT 'Roster Tab'::text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_id UUID;
  v_current_roster_size INT;
  v_max_roster_size INT;
  v_dropped_assignment_id UUID;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: user_id mismatch');
  END IF;

  SELECT COALESCE(l.roster_size, 22) INTO v_max_roster_size FROM public.leagues l WHERE l.id = p_league_id;
  IF v_max_roster_size IS NULL THEN v_max_roster_size := 22; END IF;

  SELECT id INTO v_team_id FROM public.teams WHERE league_id = p_league_id AND owner_id = p_user_id LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'User does not have a team in this league'; END IF;

  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  BEGIN
    IF p_drop_player_id IS NOT NULL THEN
      SELECT id INTO v_dropped_assignment_id FROM public.roster_assignments
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id LIMIT 1;
      IF v_dropped_assignment_id IS NULL THEN RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id; END IF;
      DELETE FROM public.roster_assignments WHERE id = v_dropped_assignment_id;
      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'DROP', p_drop_player_id, p_transaction_source, NOW());

      INSERT INTO public.player_waiver_status (league_id, player_id, dropped_at, dropped_by_team_id)
      VALUES (p_league_id, p_drop_player_id::INT, NOW(), v_team_id)
      ON CONFLICT (league_id, player_id, dropped_at) DO NOTHING;

      UPDATE public.team_lineups SET
        starters = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        bench = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        ir = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_drop_player_id,
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;
      UPDATE public.draft_picks SET deleted_at = NOW()
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id AND deleted_at IS NULL;
    END IF;

    IF p_add_player_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_roster_size FROM public.roster_assignments
      WHERE team_id = v_team_id AND league_id = p_league_id;
      IF p_drop_player_id IS NULL AND v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / %)', v_current_roster_size, v_max_roster_size;
      END IF;

      DECLARE
        v_is_goalie BOOLEAN;
        v_goalie_limit INT;
        v_current_goalies INT;
        v_starting_g INT;
        v_league_settings JSONB;
      BEGIN
        SELECT bool_or(pd.is_goalie) INTO v_is_goalie
        FROM public.player_directory pd WHERE pd.player_id = p_add_player_id::INT;

        IF COALESCE(v_is_goalie, FALSE) THEN
          SELECT COALESCE(l.settings, '{}'::jsonb) INTO v_league_settings FROM public.leagues l WHERE l.id = p_league_id;
          v_starting_g := COALESCE((v_league_settings->'rosterSlots'->>'G')::INT, 2);
          v_goalie_limit := GREATEST(v_starting_g + 2, 4);

          SELECT COUNT(*) INTO v_current_goalies
          FROM public.roster_assignments ra
          WHERE ra.team_id = v_team_id AND ra.league_id = p_league_id
            AND EXISTS (SELECT 1 FROM public.player_directory pd WHERE pd.player_id = ra.player_id::INT AND pd.is_goalie = TRUE);

          IF v_current_goalies >= v_goalie_limit THEN
            RAISE EXCEPTION 'Goalie limit reached (% / %). Drop a goalie first.', v_current_goalies, v_goalie_limit;
          END IF;
        END IF;
      END;

      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at, created_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, NOW(), NOW());
      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'ADD', p_add_player_id, p_transaction_source, NOW());

      -- Clear any open waiver status for the added player so the FA list is fresh.
      UPDATE public.player_waiver_status
      SET cleared_at = NOW()
      WHERE league_id = p_league_id AND player_id = p_add_player_id::INT AND cleared_at IS NULL;

      UPDATE public.team_lineups SET
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;
      INSERT INTO public.team_lineups (league_id, team_id, bench, starters, ir, slot_assignments, updated_at)
      VALUES (p_league_id, v_team_id, jsonb_build_array(p_add_player_id), '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW())
      ON CONFLICT (league_id, team_id) DO NOTHING;

      UPDATE public.draft_picks SET deleted_at = NULL, picked_at = NOW(), team_id = v_team_id
      WHERE league_id = p_league_id AND player_id = p_add_player_id AND deleted_at IS NOT NULL;

      IF NOT FOUND THEN
        INSERT INTO public.draft_picks (league_id, team_id, player_id, round_number, pick_number, picked_at, deleted_at)
        SELECT p_league_id, v_team_id, p_add_player_id, 999,
          (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
          NOW(), NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE league_id = p_league_id AND player_id = p_add_player_id AND deleted_at IS NULL);
      END IF;
    END IF;

    v_operation_duration := NOW() - v_operation_start;
    RETURN jsonb_build_object(
      'success', true, 'team_id', v_team_id, 'dropped', p_drop_player_id, 'added', p_add_player_id,
      'roster_size', (SELECT COUNT(*) FROM public.roster_assignments WHERE team_id = v_team_id AND league_id = p_league_id),
      'max_roster_size', v_max_roster_size,
      'duration_ms', EXTRACT(MILLISECOND FROM v_operation_duration)::int
    );
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, 'ADD', p_add_player_id, 'DUPLICATE_PLAYER', SQLERRM);
      RETURN jsonb_build_object('success', false, 'error', 'Player is already on a team in this league', 'code', 'DUPLICATE_PLAYER');
    WHEN OTHERS THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, CASE WHEN p_add_player_id IS NOT NULL THEN 'ADD' ELSE 'DROP' END,
        COALESCE(p_add_player_id, p_drop_player_id), SQLERRM, SQLSTATE);
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$function$;
