-- ============================================================================
-- FIX: FAAB budget auto-initialization + duplicate bid prevention
-- ============================================================================
-- 1. Restore FAAB budget initialization in join_league_with_code
--    (was accidentally dropped in the 11th audit auth.uid() rewrite)
-- 2. Add partial unique index on waiver_claims to prevent duplicate
--    pending bids for the same player by the same team
-- 3. Fix teamsCount key mismatch (frontend uses 'teamsCount', RPC had 'teamCount')
-- ============================================================================

-- ============================================================================
-- 1. FIX: join_league_with_code — restore FAAB budget init (step 8)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.join_league_with_code(
  p_join_code TEXT,
  p_user_id UUID DEFAULT NULL,  -- DEPRECATED: ignored, kept for backward compat
  p_team_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $join$
DECLARE
  v_user_id UUID;
  v_league RECORD;
  v_existing_team RECORD;
  v_team_count INT;
  v_max_teams INT;
  v_final_team_name TEXT;
  v_new_team RECORD;
  v_max_priority INT;
  v_faab_budget NUMERIC;
BEGIN
  -- Always use authenticated user, ignore p_user_id parameter
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not authenticated.'
    );
  END IF;

  -- 1. Find league by join code
  SELECT l.*
  INTO v_league
  FROM public.leagues l
  WHERE l.join_code = p_join_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid join code. Please check and try again.'
    );
  END IF;

  -- 2. Check if user already has a team in this league
  SELECT t.* INTO v_existing_team
  FROM public.teams t
  WHERE t.league_id = v_league.id
    AND t.owner_id = v_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already have a team in this league.'
    );
  END IF;

  -- 3. Check if league is full (check both teamsCount and teamCount keys)
  SELECT COUNT(*) INTO v_team_count
  FROM public.teams t
  WHERE t.league_id = v_league.id;

  v_max_teams := COALESCE(
    (v_league.settings->>'teamsCount')::INT,
    (v_league.settings->>'teamCount')::INT,
    (v_league.settings->>'numberOfTeams')::INT,
    12
  );

  IF v_team_count >= v_max_teams THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This league is full.'
    );
  END IF;

  -- 4. Check draft status
  IF v_league.draft_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot join — the draft is currently in progress.'
    );
  END IF;

  IF v_league.draft_status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot join — the draft has already been completed.'
    );
  END IF;

  -- 5. Determine team name
  IF p_team_name IS NOT NULL AND LENGTH(TRIM(p_team_name)) > 0 THEN
    v_final_team_name := TRIM(p_team_name);
  ELSE
    SELECT COALESCE(p.default_team_name, p.username, 'Team ' || (v_team_count + 1))
    INTO v_final_team_name
    FROM profiles p
    WHERE p.id = v_user_id;

    IF v_final_team_name IS NULL THEN
      v_final_team_name := 'Team ' || (v_team_count + 1);
    END IF;
  END IF;

  -- 6. Create the team
  INSERT INTO public.teams (league_id, owner_id, team_name)
  VALUES (v_league.id, v_user_id, v_final_team_name)
  RETURNING * INTO v_new_team;

  -- 7. Initialize waiver priority (last in line)
  SELECT COALESCE(MAX(priority), 0) INTO v_max_priority
  FROM waiver_priority
  WHERE league_id = v_league.id;

  INSERT INTO waiver_priority (league_id, team_id, priority)
  VALUES (v_league.id, v_new_team.id, v_max_priority + 1)
  ON CONFLICT DO NOTHING;

  -- 8. Initialize FAAB budget if league uses FAAB waivers
  IF v_league.waiver_type = 'faab' THEN
    v_faab_budget := COALESCE(
      (v_league.settings->>'faabBudget')::NUMERIC,
      100
    );

    INSERT INTO public.faab_budgets (league_id, team_id, initial_budget, remaining_budget)
    VALUES (v_league.id, v_new_team.id, v_faab_budget, v_faab_budget)
    ON CONFLICT (league_id, team_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'league_id', v_league.id,
    'league_name', v_league.name,
    'team_id', v_new_team.id,
    'team_name', v_final_team_name
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$join$;

GRANT EXECUTE ON FUNCTION public.join_league_with_code(TEXT, UUID, TEXT) TO authenticated;

-- ============================================================================
-- 1b. NOTE: waiver_claims intentionally has NO DELETE RLS policy.
-- ============================================================================
-- Claims use soft-delete via status='cancelled' (see cancelWaiverClaim).
-- Hard deletes are blocked by RLS to preserve the audit trail.
-- This is intentional — do NOT add a DELETE policy.
-- ============================================================================

-- ============================================================================
-- 2. Partial unique index: prevent duplicate pending waiver claims
-- ============================================================================
-- A team should not be able to have two pending claims for the same player
-- in the same league. This prevents accidental double-bids.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_waiver_claims_no_duplicate_pending
  ON waiver_claims (league_id, team_id, player_id)
  WHERE status = 'pending';

-- ============================================================================
-- 3. Backfill: create FAAB budget rows for existing teams that are missing them
-- ============================================================================
-- Any team in a FAAB league that doesn't have a budget row gets one now.
-- ============================================================================

INSERT INTO faab_budgets (league_id, team_id, initial_budget, remaining_budget)
SELECT
  t.league_id,
  t.id,
  COALESCE((l.settings->>'faabBudget')::NUMERIC, 100),
  COALESCE((l.settings->>'faabBudget')::NUMERIC, 100)
FROM teams t
JOIN leagues l ON l.id = t.league_id
WHERE l.waiver_type = 'faab'
  AND NOT EXISTS (
    SELECT 1 FROM faab_budgets fb
    WHERE fb.league_id = t.league_id AND fb.team_id = t.id
  )
ON CONFLICT (league_id, team_id) DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $verify$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  FAAB BUDGET INIT + DUPLICATE BID PREVENTION';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  1. join_league_with_code: restored FAAB budget init (step 8)';
  RAISE NOTICE '     - Also fixed teamsCount key (was teamCount)';
  RAISE NOTICE '  2. idx_waiver_claims_no_duplicate_pending: partial unique index';
  RAISE NOTICE '     - Prevents duplicate pending bids per team+player';
  RAISE NOTICE '  3. Backfilled FAAB budgets for existing teams missing them';
  RAISE NOTICE '';
END $verify$;
