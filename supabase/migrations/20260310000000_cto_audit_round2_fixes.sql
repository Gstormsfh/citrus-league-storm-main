-- =============================================================================
-- CTO AUDIT ROUND 2 — Security hardening + remaining gaps
-- =============================================================================
--
-- 1. Add SET search_path = public to process_roster_move
-- 2. Add auth.uid() validation to execute_trade and process_roster_move
-- 3. Add roster-size validation to execute_trade
-- =============================================================================

-- ============================================================================
-- FIX: process_roster_move — add SET search_path = public
-- The CTO audit migration created this function without search_path,
-- which was previously set by the security hardening migration.
-- Also adds auth.uid() validation to prevent unauthorized invocations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_roster_move(
  p_league_id UUID,
  p_user_id UUID,
  p_drop_player_id TEXT DEFAULT NULL,
  p_add_player_id TEXT DEFAULT NULL,
  p_transaction_source TEXT DEFAULT 'Roster Tab'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id UUID;
  v_current_roster_size INT;
  v_max_roster_size INT;
  v_dropped_assignment_id UUID;
  v_drop_player_name TEXT;
  v_add_player_name TEXT;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
BEGIN
  -- Validate the authenticated user matches the claimed user_id
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: user_id mismatch');
  END IF;

  -- Read roster_size from league (with fallback to 22)
  SELECT COALESCE(l.roster_size, 22) INTO v_max_roster_size
  FROM public.leagues l WHERE l.id = p_league_id;
  IF v_max_roster_size IS NULL THEN
    v_max_roster_size := 22;
  END IF;

  -- Get user's team in this league
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE league_id = p_league_id AND owner_id = p_user_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'User does not have a team in this league';
  END IF;

  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  BEGIN
    -- ======== DROP LOGIC ========
    IF p_drop_player_id IS NOT NULL THEN
      SELECT id INTO v_dropped_assignment_id
      FROM public.roster_assignments
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id
      LIMIT 1;

      IF v_dropped_assignment_id IS NULL THEN
        RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id;
      END IF;

      DELETE FROM public.roster_assignments WHERE id = v_dropped_assignment_id;

      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'DROP', p_drop_player_id, p_transaction_source, NOW());

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

    -- ======== ADD LOGIC ========
    IF p_add_player_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_roster_size
      FROM public.roster_assignments
      WHERE team_id = v_team_id AND league_id = p_league_id;

      -- Enforce roster size limit (only when not doing a simultaneous drop)
      IF p_drop_player_id IS NULL AND v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / %)', v_current_roster_size, v_max_roster_size;
      END IF;

      -- Enforce goalie position limit from league settings
      DECLARE
        v_add_position TEXT;
        v_goalie_limit INT;
        v_current_goalies INT;
        v_league_settings JSONB;
      BEGIN
        SELECT p.position INTO v_add_position
        FROM public.nhl_players p WHERE p.id = p_add_player_id::INT;

        IF v_add_position = 'G' THEN
          SELECT COALESCE(l.settings, '{}'::jsonb) INTO v_league_settings
          FROM public.leagues l WHERE l.id = p_league_id;

          v_goalie_limit := COALESCE(
            (v_league_settings->'rosterSlots'->>'G')::INT, 3
          );

          SELECT COUNT(*) INTO v_current_goalies
          FROM public.roster_assignments ra
          JOIN public.nhl_players np ON np.id = ra.player_id::INT
          WHERE ra.team_id = v_team_id AND ra.league_id = p_league_id AND np.position = 'G';

          IF v_current_goalies >= v_goalie_limit THEN
            RAISE EXCEPTION 'Goalie limit reached (% / %)', v_current_goalies, v_goalie_limit;
          END IF;
        END IF;
      END;

      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at, created_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, NOW(), NOW());

      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'ADD', p_add_player_id, p_transaction_source, NOW());

      UPDATE public.team_lineups SET
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;

      INSERT INTO public.team_lineups (league_id, team_id, bench, starters, ir, slot_assignments, updated_at)
      VALUES (p_league_id, v_team_id, jsonb_build_array(p_add_player_id), '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW())
      ON CONFLICT (league_id, team_id) DO NOTHING;

      INSERT INTO public.draft_picks (league_id, team_id, player_id, round_number, pick_number, picked_at, deleted_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, 999,
        (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
        NOW(), NULL)
      ON CONFLICT (league_id, team_id, player_id) DO UPDATE SET deleted_at = NULL, picked_at = NOW();
    END IF;

    v_operation_duration := NOW() - v_operation_start;

    RETURN jsonb_build_object(
      'success', true,
      'team_id', v_team_id,
      'dropped', p_drop_player_id,
      'added', p_add_player_id,
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
$$;

COMMENT ON FUNCTION public.process_roster_move IS
  'Atomic roster transaction engine with auth.uid() validation and SET search_path. '
  'Reads roster_size from league settings. Enforces goalie position limit. '
  'Full rollback on any failure.';


-- ============================================================================
-- FIX: execute_trade — add auth.uid() validation
-- Verifies the authenticated user is the owner of one of the teams involved
-- in the trade, preventing arbitrary trade execution by any authenticated user.
-- Also adds roster-size validation for the receiving teams.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execute_trade(
  p_trade_id UUID,
  p_league_id UUID,
  p_from_team_id UUID,
  p_to_team_id UUID,
  p_offered_player_ids TEXT[],
  p_requested_player_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_offered_moved INT := 0;
  v_requested_moved INT := 0;
  v_caller_uid UUID;
  v_from_team_size INT;
  v_to_team_size INT;
  v_max_roster_size INT;
BEGIN
  -- Validate the authenticated user is the owner of one of the teams
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM teams
      WHERE id IN (p_from_team_id, p_to_team_id)
        AND league_id = p_league_id
        AND owner_id = v_caller_uid
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: you are not an owner of either team');
    END IF;
  END IF;

  -- Validate both teams exist in the league
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_from_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'From-team does not exist in this league';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_to_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'To-team does not exist in this league';
  END IF;

  -- Read roster size limit
  SELECT COALESCE(l.roster_size, 22) INTO v_max_roster_size
  FROM leagues l WHERE l.id = p_league_id;

  -- Validate post-trade roster sizes won't exceed limit
  SELECT COUNT(*) INTO v_from_team_size
  FROM roster_assignments WHERE team_id = p_from_team_id AND league_id = p_league_id;
  SELECT COUNT(*) INTO v_to_team_size
  FROM roster_assignments WHERE team_id = p_to_team_id AND league_id = p_league_id;

  -- After trade: from_team loses offered, gains requested; to_team loses requested, gains offered
  IF (v_from_team_size - array_length(p_offered_player_ids, 1) + array_length(p_requested_player_ids, 1)) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for proposing team (% players)', v_max_roster_size;
  END IF;
  IF (v_to_team_size - array_length(p_requested_player_ids, 1) + array_length(p_offered_player_ids, 1)) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for accepting team (% players)', v_max_roster_size;
  END IF;

  -- ======== MOVE OFFERED PLAYERS: from_team → to_team ========
  FOREACH v_pid IN ARRAY p_offered_player_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM roster_assignments
      WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid
    ) THEN
      RAISE EXCEPTION 'Offered player % is not on from-team roster', v_pid;
    END IF;

    UPDATE roster_assignments
    SET team_id = p_to_team_id, updated_at = v_now
    WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid;

    v_offered_moved := v_offered_moved + 1;
  END LOOP;

  -- ======== MOVE REQUESTED PLAYERS: to_team → from_team ========
  FOREACH v_pid IN ARRAY p_requested_player_ids
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM roster_assignments
      WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid
    ) THEN
      RAISE EXCEPTION 'Requested player % is not on to-team roster', v_pid;
    END IF;

    UPDATE roster_assignments
    SET team_id = p_from_team_id, updated_at = v_now
    WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid;

    v_requested_moved := v_requested_moved + 1;
  END LOOP;

  -- ======== AUDIT TRAIL ========
  INSERT INTO transaction_ledger (league_id, team_id, player_id, type, created_at)
  SELECT p_league_id, p_from_team_id, unnest(p_offered_player_ids), 'TRADE_OUT', v_now
  UNION ALL
  SELECT p_league_id, p_to_team_id, unnest(p_offered_player_ids), 'TRADE_IN', v_now
  UNION ALL
  SELECT p_league_id, p_to_team_id, unnest(p_requested_player_ids), 'TRADE_OUT', v_now
  UNION ALL
  SELECT p_league_id, p_from_team_id, unnest(p_requested_player_ids), 'TRADE_IN', v_now;

  -- Record in trade_history
  INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
  VALUES (p_league_id, p_trade_id, p_from_team_id, p_to_team_id,
          ARRAY(SELECT unnest(p_offered_player_ids)::int),
          ARRAY(SELECT unnest(p_requested_player_ids)::int));

  RETURN jsonb_build_object(
    'success', true,
    'offered_moved', v_offered_moved,
    'requested_moved', v_requested_moved
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_trade(UUID, UUID, UUID, UUID, TEXT[], TEXT[]) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_trade(UUID, UUID, UUID, UUID, TEXT[], TEXT[]) TO authenticated;

COMMENT ON FUNCTION public.execute_trade IS
  'Atomic trade execution with auth.uid() validation and roster-size enforcement. '
  'Validates ownership, checks roster limits, updates roster_assignments, '
  'logs to transaction_ledger and trade_history. Full rollback on any failure.';
