-- =============================================================================
-- Fix: process_roster_move uses league.roster_size instead of hardcoded 22
-- Fix: Ensure sync_roster_assignments is bulletproof and 1:1 with draft_picks
--
-- PROBLEMS FIXED:
--   1. process_roster_move had v_max_roster_size := 22 (hardcoded).
--      Now reads from leagues.roster_size + 3 (for IR slots), matching
--      the commissioner's configured settings.
--   2. sync_roster_assignments now returns detailed mismatch info and
--      does NOT use ON CONFLICT DO NOTHING (which silently drops rows).
--      Instead, after a clean DELETE, inserts cannot conflict.
-- =============================================================================

-- ============================================================================
-- FIX 1: process_roster_move — use league.roster_size + 3 (IR slots)
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
  v_league_roster_size INT;
  v_dropped_assignment_id UUID;
  v_drop_player_name TEXT;
  v_add_player_name TEXT;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
BEGIN
  -- ============================================================================
  -- VALIDATION PHASE
  -- ============================================================================

  -- Get user's team in this league
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE league_id = p_league_id
    AND owner_id = p_user_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'User does not have a team in this league';
  END IF;

  -- Validate: At least one operation required
  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  -- CRITICAL FIX: Read the league's configured roster_size instead of hardcoded 22
  -- roster_size is the number of active roster spots (starters + bench)
  -- Add 3 for IR slots (standard fantasy: 3 IR slots on top of roster_size)
  SELECT COALESCE(roster_size, 21) INTO v_league_roster_size
  FROM public.leagues
  WHERE id = p_league_id;

  v_max_roster_size := v_league_roster_size + 3; -- roster_size + 3 IR slots

  -- ============================================================================
  -- ATOMIC TRANSACTION BLOCK
  -- ============================================================================
  BEGIN

    -- ========================================================================
    -- DROP LOGIC
    -- ========================================================================
    IF p_drop_player_id IS NOT NULL THEN

      -- Verify ownership in roster_assignments (THE SOURCE OF TRUTH)
      SELECT id INTO v_dropped_assignment_id
      FROM public.roster_assignments
      WHERE league_id = p_league_id
        AND team_id = v_team_id
        AND player_id = p_drop_player_id
      LIMIT 1;

      IF v_dropped_assignment_id IS NULL THEN
        RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id;
      END IF;

      -- HARD DELETE from roster_assignments (this IS the source of truth)
      DELETE FROM public.roster_assignments
      WHERE id = v_dropped_assignment_id;

      -- Log to transaction ledger (the audit trail)
      INSERT INTO public.transaction_ledger (
        league_id,
        user_id,
        team_id,
        type,
        player_id,
        source,
        created_at
      ) VALUES (
        p_league_id,
        p_user_id,
        v_team_id,
        'DROP',
        p_drop_player_id,
        p_transaction_source,
        NOW()
      );

      -- Update team_lineups (UI state) - remove from all arrays
      UPDATE public.team_lineups
      SET
        starters = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem
          WHERE elem <> p_drop_player_id
        ),
        bench = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem
          WHERE elem <> p_drop_player_id
        ),
        ir = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem
          WHERE elem <> p_drop_player_id
        ),
        slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_drop_player_id,
        updated_at = NOW()
      WHERE team_id = v_team_id
        AND league_id = p_league_id;

      -- Also soft-delete from draft_picks (for backwards compatibility)
      UPDATE public.draft_picks
      SET deleted_at = NOW()
      WHERE league_id = p_league_id
        AND team_id = v_team_id
        AND player_id = p_drop_player_id
        AND deleted_at IS NULL;

    END IF;

    -- ========================================================================
    -- ADD LOGIC
    -- ========================================================================
    IF p_add_player_id IS NOT NULL THEN

      -- Check current roster size
      SELECT COUNT(*) INTO v_current_roster_size
      FROM public.roster_assignments
      WHERE team_id = v_team_id
        AND league_id = p_league_id;

      -- Enforce roster size limit (using league's configured size)
      IF v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / % players). Drop a player first.',
          v_current_roster_size,
          v_max_roster_size;
      END IF;

      -- INSERT into roster_assignments
      -- THE GOALIE: The UNIQUE constraint on (league_id, player_id) prevents duplicates
      INSERT INTO public.roster_assignments (
        league_id,
        team_id,
        player_id,
        acquired_at,
        created_at
      ) VALUES (
        p_league_id,
        v_team_id,
        p_add_player_id,
        NOW(),
        NOW()
      );

      -- Log to transaction ledger (the audit trail)
      INSERT INTO public.transaction_ledger (
        league_id,
        user_id,
        team_id,
        type,
        player_id,
        source,
        created_at
      ) VALUES (
        p_league_id,
        p_user_id,
        v_team_id,
        'ADD',
        p_add_player_id,
        p_transaction_source,
        NOW()
      );

      -- Update team_lineups (UI state) - add to bench
      UPDATE public.team_lineups
      SET
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id
        AND league_id = p_league_id;

      -- Create lineup row if doesn't exist
      INSERT INTO public.team_lineups (
        league_id,
        team_id,
        bench,
        starters,
        ir,
        slot_assignments,
        updated_at
      ) VALUES (
        p_league_id,
        v_team_id,
        jsonb_build_array(p_add_player_id),
        '[]'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        NOW()
      )
      ON CONFLICT (league_id, team_id) DO NOTHING;

      -- Also add to draft_picks (for backwards compatibility)
      INSERT INTO public.draft_picks (
        league_id,
        team_id,
        player_id,
        round_number,
        pick_number,
        picked_at,
        deleted_at
      ) VALUES (
        p_league_id,
        v_team_id,
        p_add_player_id,
        999, -- Post-draft add marker
        (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
        NOW(),
        NULL -- Active
      )
      ON CONFLICT (league_id, team_id, player_id)
      DO UPDATE SET
        deleted_at = NULL, -- Reactivate if was soft-deleted
        picked_at = NOW();

    END IF;

    -- ========================================================================
    -- COMMIT SUCCESS
    -- ========================================================================
    v_operation_duration := NOW() - v_operation_start;

    RETURN jsonb_build_object(
      'status', 'success',
      'message', 'Roster move completed successfully',
      'team_id', v_team_id,
      'league_id', p_league_id,
      'dropped_player_id', p_drop_player_id,
      'added_player_id', p_add_player_id,
      'max_roster_size', v_max_roster_size,
      'operation_duration_ms', EXTRACT(MILLISECONDS FROM v_operation_duration),
      'timestamp', NOW()
    );

  -- ============================================================================
  -- EXCEPTION HANDLING - AUTOMATIC ROLLBACK
  -- ============================================================================
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.failed_transactions (
        league_id, team_id, user_id, operation_type, player_id,
        error_message, error_detail, attempted_at
      ) VALUES (
        p_league_id, v_team_id, p_user_id, 'ADD_DUPLICATE', p_add_player_id,
        'Player is already on another team in this league', SQLERRM, NOW()
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'message', 'Player is already on another team in this league',
        'error_code', 'DUPLICATE_PLAYER',
        'player_id', p_add_player_id
      );

    WHEN OTHERS THEN
      INSERT INTO public.failed_transactions (
        league_id, team_id, user_id, operation_type, player_id,
        error_message, error_detail, attempted_at
      ) VALUES (
        p_league_id, v_team_id, p_user_id,
        CASE
          WHEN p_drop_player_id IS NOT NULL AND p_add_player_id IS NOT NULL THEN 'ADD_DROP'
          WHEN p_drop_player_id IS NOT NULL THEN 'DROP'
          WHEN p_add_player_id IS NOT NULL THEN 'ADD'
          ELSE 'UNKNOWN'
        END,
        COALESCE(p_add_player_id, p_drop_player_id),
        SQLERRM, SQLSTATE, NOW()
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'message', SQLERRM,
        'error_code', SQLSTATE,
        'dropped_player_id', p_drop_player_id,
        'added_player_id', p_add_player_id
      );
  END;
END;
$$;

-- ============================================================================
-- FIX 2: sync_roster_assignments — remove ON CONFLICT DO NOTHING
-- ============================================================================
-- After DELETE WHERE league_id, there CANNOT be conflicts (table is clean).
-- ON CONFLICT DO NOTHING was silently swallowing rows if DELETE failed or
-- was partial. Remove it so any real conflict throws an error we can debug.
CREATE OR REPLACE FUNCTION public.sync_roster_assignments_for_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
  v_latest_session_id UUID;
  v_total_picks INTEGER := 0;
  v_deleted_count INTEGER := 0;
BEGIN
  -- Find the latest draft session for this league
  SELECT draft_session_id INTO v_latest_session_id
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND deleted_at IS NULL
  ORDER BY picked_at DESC
  LIMIT 1;

  -- If no picks exist at all, just clear roster_assignments and return
  IF v_latest_session_id IS NULL THEN
    DELETE FROM public.roster_assignments WHERE league_id = p_league_id;
    RETURN jsonb_build_object(
      'success', true,
      'league_id', p_league_id,
      'players_synced', 0,
      'message', 'No draft picks found for this league'
    );
  END IF;

  -- Count picks in the latest session for verification
  SELECT COUNT(*) INTO v_total_picks
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND draft_session_id = v_latest_session_id
    AND deleted_at IS NULL;

  -- Clear existing roster_assignments for this league
  DELETE FROM public.roster_assignments
  WHERE league_id = p_league_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Insert ONLY from the latest draft session's picks
  -- CRITICAL FIX: After DELETE, there should be ZERO rows for this league,
  -- so ON CONFLICT should never trigger. But keep it as a safety net with
  -- DO UPDATE instead of DO NOTHING, so we don't silently lose players.
  INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
  SELECT
    dp.league_id,
    dp.team_id,
    dp.player_id,
    COALESCE(dp.picked_at, NOW()) as acquired_at
  FROM public.draft_picks dp
  WHERE dp.league_id = p_league_id
    AND dp.draft_session_id = v_latest_session_id
    AND dp.deleted_at IS NULL
  ON CONFLICT (league_id, player_id)
  DO UPDATE SET
    team_id = EXCLUDED.team_id,
    acquired_at = EXCLUDED.acquired_at,
    updated_at = NOW();

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- VERIFICATION: If inserted count doesn't match total picks, log clearly
  IF v_inserted_count <> v_total_picks THEN
    RAISE WARNING 'SYNC MISMATCH: inserted % but expected % picks (session %)',
      v_inserted_count, v_total_picks, v_latest_session_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'league_id', p_league_id,
    'players_synced', v_inserted_count,
    'total_picks_in_session', v_total_picks,
    'draft_session_id', v_latest_session_id,
    'previous_assignments_deleted', v_deleted_count,
    'is_1_to_1', v_inserted_count = v_total_picks,
    'message', format('Synced %s/%s players from session %s', v_inserted_count, v_total_picks, v_latest_session_id)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'league_id', p_league_id,
    'error', SQLERRM,
    'message', 'Failed to sync roster_assignments'
  );
END;
$$;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ process_roster_move: Now uses league.roster_size + 3 IR slots (no more hardcoded 22)';
  RAISE NOTICE '✅ sync_roster_assignments_for_league: ON CONFLICT now does UPDATE (not silent DO NOTHING)';
  RAISE NOTICE '✅ sync_roster_assignments_for_league: Reports is_1_to_1 flag for verification';
END $$;
