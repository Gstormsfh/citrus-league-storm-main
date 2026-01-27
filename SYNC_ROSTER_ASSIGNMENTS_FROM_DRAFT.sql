-- ============================================================================
-- SYNC ROSTER_ASSIGNMENTS FROM DRAFT_PICKS
-- ============================================================================
-- This function syncs roster_assignments from draft_picks for a specific league
-- Should be run after draft completion to populate the transactional engine
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_roster_assignments_for_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
  v_duplicate_count INTEGER := 0;
  v_error_count INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Clear existing roster_assignments for this league
  DELETE FROM public.roster_assignments
  WHERE league_id = p_league_id;
  
  -- Insert from draft_picks (deleted_at IS NULL = currently owned)
  INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
  SELECT 
    dp.league_id,
    dp.team_id,
    dp.player_id,
    COALESCE(dp.picked_at, NOW()) as acquired_at
  FROM public.draft_picks dp
  WHERE dp.league_id = p_league_id
    AND dp.deleted_at IS NULL
  ON CONFLICT (league_id, player_id) DO NOTHING;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  -- Build result JSON
  v_result := jsonb_build_object(
    'success', true,
    'league_id', p_league_id,
    'players_synced', v_inserted_count,
    'message', format('Successfully synced %s players to roster_assignments', v_inserted_count)
  );
  
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'league_id', p_league_id,
    'error', SQLERRM,
    'message', 'Failed to sync roster_assignments'
  );
END;
$$;

COMMENT ON FUNCTION sync_roster_assignments_for_league IS 
  'Syncs roster_assignments from draft_picks for a specific league. Call after draft completion.';

-- ============================================================================
-- HOW TO USE THIS FUNCTION
-- ============================================================================
-- After draft completion, run this for your league:
-- SELECT sync_roster_assignments_for_league('YOUR-LEAGUE-ID-HERE');
--
-- Expected output:
-- {
--   "success": true,
--   "league_id": "750f4e1a-92ae-44cf-a798-2f3e06d0d5c9",
--   "players_synced": 240,
--   "message": "Successfully synced 240 players to roster_assignments"
-- }
-- ============================================================================
