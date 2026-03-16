-- ============================================================================
-- Fix: sync_roster_assignments_for_league — gap-fill instead of skip
--
-- PROBLEM: The previous version was all-or-nothing. If roster_assignments
-- already had ANY rows for a league, it skipped entirely. This means if a
-- draft pick was missed during the initial sync (race condition, partial
-- failure, etc.), that player would be permanently missing from the roster
-- with no way to recover via the sync endpoint.
--
-- FIX: When roster_assignments already exist, do a targeted gap-fill:
-- insert only draft picks that are MISSING from roster_assignments.
-- This preserves all post-draft moves (trades, waivers, adds/drops) while
-- recovering any players that were dropped during the initial sync.
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
  v_gap_filled_count INTEGER := 0;
  v_latest_session_id UUID;
  v_total_picks INTEGER := 0;
BEGIN
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

  -- Count existing roster assignments
  SELECT COUNT(*) INTO v_existing_count
  FROM public.roster_assignments
  WHERE league_id = p_league_id;

  -- Count picks in the latest session
  SELECT COUNT(*) INTO v_total_picks
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND draft_session_id = v_latest_session_id
    AND deleted_at IS NULL;

  IF v_existing_count > 0 THEN
    -- ── Gap-fill mode ─────────────────────────────────────────────
    -- Roster assignments already exist. Only insert draft picks that
    -- are MISSING from roster_assignments (not currently on any team
    -- in this league). This preserves trades/waivers/adds/drops.
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
      AND NOT EXISTS (
        SELECT 1 FROM public.roster_assignments ra
        WHERE ra.league_id = dp.league_id
          AND ra.player_id = dp.player_id
      )
    ON CONFLICT (league_id, player_id) DO NOTHING;

    GET DIAGNOSTICS v_gap_filled_count = ROW_COUNT;

    RETURN jsonb_build_object(
      'success', true,
      'league_id', p_league_id,
      'players_synced', v_gap_filled_count,
      'existing_count', v_existing_count,
      'total_picks_in_session', v_total_picks,
      'draft_session_id', v_latest_session_id,
      'skipped', false,
      'mode', 'gap_fill',
      'message', CASE
        WHEN v_gap_filled_count = 0 THEN
          format('No gaps found: all %s draft picks already have roster assignments', v_total_picks)
        ELSE
          format('Gap-fill: recovered %s missing player(s) from draft session %s (had %s, now %s)',
            v_gap_filled_count, v_latest_session_id, v_existing_count, v_existing_count + v_gap_filled_count)
      END
    );
  ELSE
    -- ── Initial sync mode ─────────────────────────────────────────
    -- No existing assignments — do full sync from draft_picks
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
      'mode', 'initial_sync',
      'is_1_to_1', v_inserted_count = v_total_picks,
      'message', format('Initial sync: %s/%s players from session %s', v_inserted_count, v_total_picks, v_latest_session_id)
    );
  END IF;

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
  RAISE NOTICE 'sync_roster_assignments_for_league: Now gap-fills missing players instead of skipping';
  RAISE NOTICE 'Preserves post-draft moves while recovering any draft picks that were missed';
END $$;
