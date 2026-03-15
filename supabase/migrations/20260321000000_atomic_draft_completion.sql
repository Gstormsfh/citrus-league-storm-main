-- ============================================================================
-- Atomic Draft Completion + Roster Sync
--
-- PROBLEM: DraftService.makePick() detected draft completion via 3 separate
-- queries (read draft_rounds → count picks → update status → sync rosters).
-- This created race conditions where:
--   1. Concurrent final picks could both trigger sync
--   2. Server crash between status update and sync left rosters empty
--   3. Count query didn't filter by draft_session_id (multi-session bug)
--
-- FIX: Single atomic RPC that checks completion, updates status, and syncs
-- rosters in one transaction. If any step fails, everything rolls back.
-- ============================================================================

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
  v_sync_result JSONB;
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

  -- Count actual active picks for this session only
  SELECT COUNT(*) INTO v_actual_count
  FROM public.draft_picks
  WHERE league_id = p_league_id
    AND deleted_at IS NULL
    AND (p_draft_session_id IS NULL OR draft_session_id = p_draft_session_id);

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

  -- 2. Sync roster assignments (inline the logic to keep it atomic)
  --    Uses the same gap-fill approach as sync_roster_assignments_for_league
  INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at)
  SELECT
    dp.league_id,
    dp.team_id,
    dp.player_id,
    COALESCE(dp.picked_at, NOW()) as acquired_at
  FROM public.draft_picks dp
  WHERE dp.league_id = p_league_id
    AND dp.deleted_at IS NULL
    AND (p_draft_session_id IS NULL OR dp.draft_session_id = p_draft_session_id)
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
  -- Transaction rolls back automatically, return error info
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
  RAISE NOTICE 'complete_draft_and_sync: Atomic draft completion + roster sync in single transaction';
  RAISE NOTICE 'Prevents race conditions, crash-safety issues, and multi-session count bugs';
END $$;
