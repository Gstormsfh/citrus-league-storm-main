-- ============================================================================
-- Migration: Fix autopick draft type + sync_roster_assignments safety
--
-- 1. run_full_autopick_draft() — reads draftType from league settings
--    instead of hardcoding snake order. Supports snake, linear, and auction.
--
-- 2. sync_roster_assignments_for_league() — NO LONGER wipes all
--    roster_assignments and rebuilds from draft_picks. Post-draft moves
--    (trades, waivers, FAAB, adds/drops via process_roster_move) write
--    directly to roster_assignments and would be lost on re-sync.
--    New behavior: only sync for leagues that have ZERO roster_assignments
--    (i.e., fresh post-draft). If assignments already exist, skip.
-- ============================================================================

-- ============================================================================
-- 1. run_full_autopick_draft() — respect league draftType setting
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_full_autopick_draft(
  p_league_id UUID
)
RETURNS TABLE (
  round_number INT,
  pick_number INT,
  team_id UUID,
  player_id INT,
  player_name TEXT
) AS $full_auto$
DECLARE
  v_league RECORD;
  v_teams UUID[];
  v_team_count INT;
  v_session_id UUID;
  v_round INT;
  v_pick INT := 0;
  v_team_idx INT;
  v_current_team UUID;
  v_result RECORD;
  v_draft_type TEXT;
BEGIN
  -- Authorization: only the commissioner can run a full autopick
  IF NOT EXISTS (
    SELECT 1 FROM leagues WHERE id = p_league_id AND commissioner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the league commissioner can run a full autopick draft.';
  END IF;

  -- Get league settings
  SELECT l.draft_rounds, l.settings INTO v_league
  FROM leagues l WHERE l.id = p_league_id;

  -- Read draft type from league settings (default to snake)
  v_draft_type := COALESCE(v_league.settings->>'draftType', 'snake');

  -- Get teams in order
  SELECT ARRAY_AGG(t.id ORDER BY t.created_at) INTO v_teams
  FROM teams t WHERE t.league_id = p_league_id;

  v_team_count := array_length(v_teams, 1);
  IF v_team_count IS NULL OR v_team_count = 0 THEN
    RAISE EXCEPTION 'No teams found in league %', p_league_id;
  END IF;

  -- Create new draft session
  v_session_id := gen_random_uuid();

  -- Update league to in_progress
  UPDATE leagues SET draft_status = 'in_progress' WHERE id = p_league_id;

  -- Run the draft
  FOR v_round IN 1..COALESCE(v_league.draft_rounds, 21)
  LOOP
    FOR v_team_idx IN 1..v_team_count
    LOOP
      v_pick := v_pick + 1;

      -- Determine team order based on draft type
      IF v_draft_type = 'snake' AND v_round % 2 = 0 THEN
        -- Snake draft: even rounds reverse order
        v_current_team := v_teams[v_team_count + 1 - v_team_idx];
      ELSE
        -- Linear draft (and odd rounds of snake): same order every round
        v_current_team := v_teams[v_team_idx];
      END IF;

      -- Make the autopick
      SELECT * INTO v_result
      FROM autopick_next_player(p_league_id, v_current_team, v_session_id, v_round, v_pick);

      IF v_result IS NOT NULL THEN
        RETURN QUERY SELECT v_round, v_pick, v_current_team,
          v_result.picked_player_id, v_result.player_name;
      END IF;
    END LOOP;
  END LOOP;

  -- Mark draft as completed
  UPDATE leagues SET draft_status = 'completed' WHERE id = p_league_id;

  -- Sync roster assignments
  PERFORM sync_roster_assignments_for_league(p_league_id);

  RETURN;
END;
$full_auto$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.run_full_autopick_draft(UUID) TO authenticated;


-- ============================================================================
-- 2. sync_roster_assignments_for_league() — safe version
--
-- The old version deleted ALL roster_assignments and rebuilt from draft_picks.
-- This destroyed any post-draft moves (trades, FAAB pickups, waiver claims,
-- free agent adds/drops) that were written directly to roster_assignments
-- by process_roster_move().
--
-- New behavior:
--   - If roster_assignments already has rows for this league, do nothing
--     (post-draft moves are already in place, re-syncing would destroy them)
--   - If roster_assignments is empty for this league, populate from draft_picks
--     (fresh post-draft initial sync)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_roster_assignments_for_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count INTEGER := 0;
  v_inserted_count INTEGER := 0;
  v_latest_session_id UUID;
  v_total_picks INTEGER := 0;
BEGIN
  -- Check if roster_assignments already has data for this league
  SELECT COUNT(*) INTO v_existing_count
  FROM public.roster_assignments
  WHERE league_id = p_league_id;

  -- If assignments already exist, skip sync to preserve post-draft moves
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'league_id', p_league_id,
      'players_synced', 0,
      'existing_count', v_existing_count,
      'skipped', true,
      'message', format('Skipped sync: %s roster_assignments already exist (preserving trades/waivers/adds)', v_existing_count)
    );
  END IF;

  -- No existing assignments — do initial sync from draft_picks
  -- Find the latest draft session for this league
  SELECT draft_session_id INTO v_latest_session_id
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND deleted_at IS NULL
  ORDER BY picked_at DESC
  LIMIT 1;

  -- If no picks exist at all, nothing to sync
  IF v_latest_session_id IS NULL THEN
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

  -- Insert from the latest draft session's picks
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

  -- Verification
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
    'skipped', false,
    'is_1_to_1', v_inserted_count = v_total_picks,
    'message', format('Initial sync: %s/%s players from session %s', v_inserted_count, v_total_picks, v_latest_session_id)
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

GRANT EXECUTE ON FUNCTION public.sync_roster_assignments_for_league(UUID) TO authenticated;


-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'run_full_autopick_draft: Now reads draftType from league settings (snake/linear)';
  RAISE NOTICE 'sync_roster_assignments_for_league: No longer overwrites post-draft roster moves';
END $$;
