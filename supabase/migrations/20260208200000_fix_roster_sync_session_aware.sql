-- =============================================================================
-- Fix: Make sync_roster_assignments_for_league session-aware
--
-- PROBLEM: The existing sync function pulls ALL draft_picks where deleted_at IS NULL.
-- If a league had multiple draft sessions (e.g., draft was reset and re-done),
-- picks from ALL sessions get mixed together. Combined with ON CONFLICT DO NOTHING,
-- this can cause:
--   1. Players assigned to wrong teams (old session's pick wins over new session)
--   2. Missing players (player drafted by Team A in session 1, Team B in session 2 —
--      only one gets inserted)
--
-- FIX: Only sync picks from the LATEST draft_session_id for the league.
-- This ensures only the most recent draft's picks are used.
-- =============================================================================

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
BEGIN
  -- Find the latest draft session for this league
  -- This ensures we only sync picks from the most recent draft
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

  -- Insert ONLY from the latest draft session's picks
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
  ON CONFLICT (league_id, player_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'league_id', p_league_id,
    'players_synced', v_inserted_count,
    'total_picks_in_session', v_total_picks,
    'draft_session_id', v_latest_session_id,
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

-- Also improve the make_draft_pick function to NOT delete all soft-deleted picks
-- (the original deleted ALL soft-deleted picks on every pick, which is too aggressive)
-- Instead, only clean up picks from the CURRENT session
CREATE OR REPLACE FUNCTION public.make_draft_pick(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id TEXT,
  p_round_number INT,
  p_pick_number INT,
  p_draft_session_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pick_id UUID;
  v_is_member BOOLEAN;
BEGIN
  -- Verify the caller is commissioner or team owner in this league
  SELECT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
    AND (
      commissioner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.teams
        WHERE teams.league_id = p_league_id
        AND teams.owner_id = auth.uid()
      )
    )
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Not authorized to make picks in this league';
  END IF;

  -- Check if player already drafted in THIS SESSION (active picks only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
    AND player_id = p_player_id
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Player already drafted in this session';
  END IF;

  -- Check for duplicate pick number (within same session, active only)
  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id
    AND draft_session_id = p_draft_session_id
    AND round_number = p_round_number
    AND pick_number = p_pick_number
    AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This pick number is already taken in this session';
  END IF;

  -- Clean up stale soft-deleted picks from THIS SESSION ONLY
  -- (Don't delete picks from other sessions — they're historical data)
  DELETE FROM public.draft_picks
  WHERE league_id = p_league_id
  AND draft_session_id = p_draft_session_id
  AND deleted_at IS NOT NULL;

  -- Insert the pick
  INSERT INTO public.draft_picks (
    league_id, team_id, player_id, round_number, pick_number,
    draft_session_id, picked_at
  ) VALUES (
    p_league_id, p_team_id, p_player_id, p_round_number, p_pick_number,
    p_draft_session_id, NOW()
  )
  RETURNING id INTO v_pick_id;

  RETURN v_pick_id;
END;
$$;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ sync_roster_assignments_for_league: Now session-aware (only syncs latest session)';
  RAISE NOTICE '✅ make_draft_pick: Now only cleans up soft-deleted picks from current session';
END $$;
