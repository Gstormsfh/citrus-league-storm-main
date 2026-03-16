-- ============================================================================
-- Fix: sync_roster_assignments NULL draft_session_id bug
--
-- ROOT CAUSE: When process_roster_move() creates draft_picks for add/drop
-- transactions, it does NOT set draft_session_id (defaults to NULL).
-- If such a pick has the latest picked_at, the sync function picks up
-- v_latest_session_id = NULL. Then the filter:
--   WHERE dp.draft_session_id = v_latest_session_id
-- becomes NULL = NULL which is ALWAYS FALSE in SQL, making every drafted
-- player invisible to the gap-fill sync.
--
-- FIX:
-- 1. Only look at picks WITH a session_id when finding the latest session
-- 2. Use IS NOT DISTINCT FROM for NULL-safe comparison as a safety net
-- 3. Also fix complete_draft_and_sync to use the same NULL-safe pattern
-- ============================================================================

-- ── Fix sync_roster_assignments_for_league ──────────────────────────────

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
  -- Find the latest ACTUAL draft session (exclude NULL session_id from roster moves)
  SELECT draft_session_id INTO v_latest_session_id
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND deleted_at IS NULL
    AND draft_session_id IS NOT NULL
  ORDER BY picked_at DESC
  LIMIT 1;

  -- If no picks with a session exist, try without session filter
  IF v_latest_session_id IS NULL THEN
    -- Check if ANY active picks exist at all
    IF NOT EXISTS (
      SELECT 1 FROM public.draft_picks
      WHERE league_id = p_league_id AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'league_id', p_league_id,
        'players_synced', 0,
        'message', 'No draft picks found for this league'
      );
    END IF;
  END IF;

  -- Count existing roster assignments
  SELECT COUNT(*) INTO v_existing_count
  FROM public.roster_assignments
  WHERE league_id = p_league_id;

  -- Count picks in the latest session (or all picks if no session)
  SELECT COUNT(*) INTO v_total_picks
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND deleted_at IS NULL
    AND (v_latest_session_id IS NULL OR draft_session_id = v_latest_session_id);

  IF v_existing_count > 0 THEN
    -- ── Gap-fill mode ─────────────────────────────────────────────
    -- Roster assignments already exist. Only insert draft picks that
    -- are MISSING from roster_assignments. Preserves trades/waivers.
    INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
    SELECT
      dp.league_id,
      dp.team_id,
      dp.player_id,
      COALESCE(dp.picked_at, NOW()) as acquired_at
    FROM public.draft_picks dp
    WHERE dp.league_id = p_league_id
      AND dp.deleted_at IS NULL
      AND (v_latest_session_id IS NULL OR dp.draft_session_id = v_latest_session_id)
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
      AND dp.deleted_at IS NULL
      AND (v_latest_session_id IS NULL OR dp.draft_session_id = v_latest_session_id)
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


-- ── Fix complete_draft_and_sync with same NULL-safe pattern ──────────────

CREATE OR REPLACE FUNCTION public.complete_draft_and_sync(
  p_league_id UUID,
  p_draft_session_id UUID,
  p_teams_count INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft_rounds INT;
  v_total_expected INT;
  v_actual_count INT;
  v_current_status TEXT;
BEGIN
  -- Lock the league row to prevent concurrent completion attempts
  SELECT draft_status, COALESCE(draft_rounds, 21)
  INTO v_current_status, v_draft_rounds
  FROM public.leagues
  WHERE id = p_league_id
  FOR UPDATE;

  -- Already completed — skip (idempotent)
  IF v_current_status = 'completed' THEN
    RETURN jsonb_build_object(
      'is_complete', true,
      'already_completed', true,
      'message', 'Draft was already completed'
    );
  END IF;

  -- Calculate expected total picks
  v_total_expected := p_teams_count * v_draft_rounds;

  -- Count actual active picks — NULL-safe session filter
  SELECT COUNT(*) INTO v_actual_count
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND deleted_at IS NULL
    AND (p_draft_session_id IS NULL OR draft_session_id IS NOT DISTINCT FROM p_draft_session_id);

  -- Not complete yet
  IF v_actual_count < v_total_expected THEN
    RETURN jsonb_build_object(
      'is_complete', false,
      'picks_made', v_actual_count,
      'picks_needed', v_total_expected,
      'message', format('%s/%s picks made', v_actual_count, v_total_expected)
    );
  END IF;

  -- ── Draft is complete — atomically finalize ──────────────────────

  -- 1. Update league status
  UPDATE public.leagues
  SET draft_status = 'completed'
  WHERE id = p_league_id;

  -- 2. Sync roster assignments (gap-fill safe)
  INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
  SELECT
    dp.league_id,
    dp.team_id,
    dp.player_id,
    COALESCE(dp.picked_at, NOW()) as acquired_at
  FROM public.draft_picks dp
  WHERE dp.league_id = p_league_id
    AND dp.deleted_at IS NULL
    AND (p_draft_session_id IS NULL OR dp.draft_session_id IS NOT DISTINCT FROM p_draft_session_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roster_assignments ra
      WHERE ra.league_id = dp.league_id
        AND ra.player_id = dp.player_id
    )
  ON CONFLICT (league_id, player_id) DO NOTHING;

  RETURN jsonb_build_object(
    'is_complete', true,
    'already_completed', false,
    'picks_made', v_actual_count,
    'picks_needed', v_total_expected,
    'draft_session_id', p_draft_session_id,
    'message', format('Draft completed and rosters synced (%s picks)', v_actual_count)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'is_complete', false,
    'error', SQLERRM,
    'message', 'Draft completion check failed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_draft_and_sync(UUID, UUID, INT) TO authenticated;


-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Fixed NULL draft_session_id bug in roster sync';
  RAISE NOTICE 'sync_roster_assignments: Now excludes NULL session picks when finding latest session';
  RAISE NOTICE 'complete_draft_and_sync: Uses IS NOT DISTINCT FROM for NULL-safe comparison';
END $$;
