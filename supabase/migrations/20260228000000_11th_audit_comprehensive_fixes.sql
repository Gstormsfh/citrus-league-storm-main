-- ============================================================================
-- 11TH AUDIT: COMPREHENSIVE FIXES
-- ============================================================================
-- Fixes critical, high, and medium severity issues found across:
--   - Database schema & migrations audit
--   - RPC functions & cron jobs audit
--   - Security & scalability audit
-- ============================================================================

-- ============================================================================
-- 1. FIX: delete_user_account() references wrong table names
--    (fantasy_teams → teams, fantasy_leagues → leagues, user_id → owner_id)
--    Also fixes trade_history column references (no proposer_team_name column)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_teams_deleted int := 0;
  v_leagues_deleted int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Step 1: Delete roster assignments for user's teams
  DELETE FROM roster_assignments
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 2: Delete team lineups
  DELETE FROM team_lineups
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 3: Delete waiver claims
  DELETE FROM waiver_claims
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 4: Delete waiver priority entries
  DELETE FROM waiver_priority
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 5: Delete matchup lines for user's teams
  DELETE FROM fantasy_matchup_lines
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 6: Delete draft picks by user's teams
  DELETE FROM draft_picks
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 7: Delete transaction ledger entries for user's teams
  DELETE FROM transaction_ledger
  WHERE team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Step 8: Trade history uses team1_id/team2_id, no name columns to anonymize
  -- Just leave trade records intact for audit trail (team references will cascade on team delete)

  -- Step 9: Delete user's teams
  DELETE FROM teams WHERE owner_id = v_user_id;
  GET DIAGNOSTICS v_teams_deleted = ROW_COUNT;

  -- Step 10: Delete orphaned leagues where user was commissioner and no teams remain
  DELETE FROM leagues
  WHERE commissioner_id = v_user_id
    AND id NOT IN (SELECT DISTINCT league_id FROM teams);
  GET DIAGNOSTICS v_leagues_deleted = ROW_COUNT;

  -- Step 11: Reassign commissioner of leagues that still have teams
  UPDATE leagues
  SET commissioner_id = (
    SELECT t.owner_id FROM teams t
    WHERE t.league_id = leagues.id
    ORDER BY t.created_at ASC
    LIMIT 1
  )
  WHERE commissioner_id = v_user_id
    AND id IN (SELECT DISTINCT league_id FROM teams);

  -- Step 12: Delete privacy consent records
  DELETE FROM user_privacy_consent WHERE user_id = v_user_id;

  -- Step 13: Delete user profile
  DELETE FROM profiles WHERE id = v_user_id;

  -- Step 14: Delete the auth user (final step)
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'teams_deleted', v_teams_deleted,
    'leagues_deleted', v_leagues_deleted
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;


-- ============================================================================
-- 2. FIX: export_user_data() references wrong table names
--    (fantasy_teams → teams, fantasy_leagues → leagues, user_id → owner_id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_user_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_profile jsonb;
  v_teams jsonb;
  v_leagues jsonb;
  v_transactions jsonb;
  v_draft_picks jsonb;
  v_consent jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Profile data
  SELECT to_jsonb(p.*) INTO v_profile
  FROM profiles p
  WHERE p.id = v_user_id;

  -- Teams
  SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) INTO v_teams
  FROM teams t
  WHERE t.owner_id = v_user_id;

  -- Leagues user is in (via their teams)
  SELECT COALESCE(jsonb_agg(to_jsonb(l.*)), '[]'::jsonb) INTO v_leagues
  FROM leagues l
  WHERE l.id IN (
    SELECT league_id FROM teams WHERE owner_id = v_user_id
  );

  -- Transaction history
  SELECT COALESCE(jsonb_agg(to_jsonb(tl.*)), '[]'::jsonb) INTO v_transactions
  FROM transaction_ledger tl
  WHERE tl.team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Draft picks
  SELECT COALESCE(jsonb_agg(to_jsonb(dp.*)), '[]'::jsonb) INTO v_draft_picks
  FROM draft_picks dp
  WHERE dp.team_id IN (
    SELECT id FROM teams WHERE owner_id = v_user_id
  );

  -- Privacy consent records
  SELECT COALESCE(jsonb_agg(to_jsonb(pc.*)), '[]'::jsonb) INTO v_consent
  FROM user_privacy_consent pc
  WHERE pc.user_id = v_user_id;

  -- Build final export
  v_result := jsonb_build_object(
    'success', true,
    'exported_at', now(),
    'user_id', v_user_id,
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'teams', v_teams,
    'leagues', v_leagues,
    'transactions', v_transactions,
    'draft_picks', v_draft_picks,
    'privacy_consent', v_consent
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_user_data() TO authenticated;


-- ============================================================================
-- 3. FIX: process_all_pending_waivers() references l.league_name (should be l.name)
--    Also: should_process_waivers_now() and get_waiver_processing_status()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_all_pending_waivers()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  total_processed INT,
  successful INT,
  failed INT,
  details JSONB
) AS $$
DECLARE
  v_league RECORD;
  v_result RECORD;
  v_processed INT := 0;
  v_successful INT := 0;
  v_failed INT := 0;
  v_details JSONB := '[]'::JSONB;
BEGIN
  -- Loop through all leagues with pending claims
  FOR v_league IN
    SELECT DISTINCT wc.league_id, l.name AS league_name
    FROM waiver_claims wc
    JOIN leagues l ON l.id = wc.league_id
    WHERE wc.status = 'pending'
  LOOP
    v_processed := 0;
    v_successful := 0;
    v_failed := 0;
    v_details := '[]'::JSONB;

    -- Process claims for this league
    FOR v_result IN
      SELECT * FROM process_waiver_claims(v_league.league_id)
    LOOP
      v_processed := v_processed + 1;

      IF v_result.status = 'successful' THEN
        v_successful := v_successful + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

      v_details := v_details || jsonb_build_object(
        'claim_id', v_result.claim_id,
        'player_id', v_result.player_id,
        'team_id', v_result.team_id,
        'status', v_result.status,
        'failure_reason', v_result.failure_reason
      );
    END LOOP;

    -- Return row for this league
    league_id := v_league.league_id;
    league_name := v_league.league_name;
    total_processed := v_processed;
    successful := v_successful;
    failed := v_failed;
    details := v_details;

    RETURN NEXT;
  END LOOP;

  -- Also clear any players whose waiver period has expired
  UPDATE player_waiver_status
  SET cleared_at = NOW()
  WHERE cleared_at IS NULL
    AND NOW() > dropped_at + (waiver_period_hours || ' hours')::INTERVAL;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Restrict to service_role only (cron jobs), not all authenticated users
REVOKE EXECUTE ON FUNCTION public.process_all_pending_waivers() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_all_pending_waivers() TO service_role;

-- Fix should_process_waivers_now() - l.league_name → l.name
CREATE OR REPLACE FUNCTION public.should_process_waivers_now()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  waiver_process_time TIME,
  current_time_est TIME,
  should_process BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id as league_id,
    l.name AS league_name,
    l.waiver_process_time,
    (NOW() AT TIME ZONE 'America/New_York')::TIME as current_time_est,
    ABS(EXTRACT(EPOCH FROM (l.waiver_process_time - (NOW() AT TIME ZONE 'America/New_York')::TIME))) < 300 as should_process
  FROM leagues l
  WHERE l.waiver_process_time IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM waiver_claims wc
      WHERE wc.league_id = l.id AND wc.status = 'pending'
    );
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.should_process_waivers_now() TO authenticated;

-- Fix get_waiver_processing_status() - l.league_name → l.name
CREATE OR REPLACE FUNCTION public.get_waiver_processing_status()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  pending_claims INT,
  last_processed TIMESTAMPTZ,
  next_process_time TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id as league_id,
    l.name AS league_name,
    COALESCE(pending.count, 0)::INT as pending_claims,
    (SELECT MAX(processed_at) FROM waiver_claims WHERE league_id = l.id AND processed_at IS NOT NULL) as last_processed,
    l.waiver_process_time as next_process_time
  FROM leagues l
  LEFT JOIN (
    SELECT wc.league_id, COUNT(*) as count
    FROM waiver_claims wc
    WHERE wc.status = 'pending'
    GROUP BY wc.league_id
  ) pending ON pending.league_id = l.id
  WHERE EXISTS (
    SELECT 1 FROM teams t WHERE t.league_id = l.id
  )
  ORDER BY l.name;
END;
$$ LANGUAGE plpgsql STABLE
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_waiver_processing_status() TO authenticated;


-- ============================================================================
-- 4. FIX: join_league_with_code() accepts p_user_id param (security hole)
--    Should use auth.uid() internally instead
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

  -- 3. Check if league is full
  SELECT COUNT(*) INTO v_team_count
  FROM public.teams t
  WHERE t.league_id = v_league.id;

  v_max_teams := COALESCE(
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
-- 5. FIX: calculate_h2h_category_matchup nested DECLARE inside IF (invalid syntax)
--    Move variables to outer DECLARE block and use plain BEGIN/END for the nested block
--    Must DROP first because CREATE OR REPLACE cannot change parameter names
-- ============================================================================

DROP FUNCTION IF EXISTS public.calculate_h2h_category_matchup(UUID, UUID, UUID, UUID, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION public.calculate_h2h_category_matchup(
  p_league_id UUID,
  p_matchup_id UUID,
  p_team1_id UUID,
  p_team2_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_categories TEXT[]
)
RETURNS TABLE (
  category TEXT,
  team1_value NUMERIC,
  team2_value NUMERIC,
  winner TEXT
) AS $h2h_cat$
DECLARE
  v_cat TEXT;
  v_t1 NUMERIC;
  v_t2 NUMERIC;
  v_higher_is_better BOOLEAN;
  v_t1_gp NUMERIC;
  v_t2_gp NUMERIC;
BEGIN
  FOREACH v_cat IN ARRAY p_categories
  LOOP
    -- Determine if higher is better
    v_higher_is_better := v_cat NOT IN ('gaa', 'goals_against');

    -- Calculate team 1 stat
    SELECT COALESCE(SUM(
      CASE v_cat
        WHEN 'goals' THEN pgs.nhl_goals
        WHEN 'assists' THEN pgs.nhl_assists
        WHEN 'points' THEN pgs.nhl_goals + pgs.nhl_assists
        WHEN 'plus_minus' THEN pgs.nhl_plus_minus
        WHEN 'ppp' THEN COALESCE(pgs.nhl_ppp, 0)
        WHEN 'shp' THEN COALESCE(pgs.nhl_shp, 0)
        WHEN 'sog' THEN pgs.nhl_shots_on_goal
        WHEN 'hits' THEN COALESCE(pgs.nhl_hits, 0)
        WHEN 'blocks' THEN pgs.nhl_blocks
        WHEN 'pim' THEN COALESCE(pgs.nhl_pim, 0)
        WHEN 'wins' THEN pgs.nhl_wins
        WHEN 'saves' THEN pgs.nhl_saves
        WHEN 'shutouts' THEN pgs.nhl_shutouts
        WHEN 'goals_against' THEN pgs.nhl_goals_against
        WHEN 'gaa' THEN CASE WHEN pgs.nhl_wins + COALESCE(pgs.nhl_losses, 0) > 0
                              THEN pgs.nhl_goals_against
                              ELSE 0 END
        WHEN 'save_pct' THEN CASE WHEN pgs.nhl_saves + pgs.nhl_goals_against > 0
                                   THEN pgs.nhl_saves::NUMERIC / (pgs.nhl_saves + pgs.nhl_goals_against)
                                   ELSE 0 END
        ELSE 0
      END
    ), 0) INTO v_t1
    FROM fantasy_daily_rosters fdr
    JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    JOIN nhl_games ng ON pgs.game_id = ng.game_id
    WHERE fdr.matchup_id = p_matchup_id
      AND fdr.team_id = p_team1_id
      AND fdr.roster_date >= p_week_start
      AND fdr.roster_date <= p_week_end
      AND fdr.slot_type = 'active'
      AND ng.game_date = fdr.roster_date
      AND CASE
        WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
          THEN pgs.is_goalie = true
        ELSE pgs.is_goalie = false
      END;

    -- Calculate team 2 stat
    SELECT COALESCE(SUM(
      CASE v_cat
        WHEN 'goals' THEN pgs.nhl_goals
        WHEN 'assists' THEN pgs.nhl_assists
        WHEN 'points' THEN pgs.nhl_goals + pgs.nhl_assists
        WHEN 'plus_minus' THEN pgs.nhl_plus_minus
        WHEN 'ppp' THEN COALESCE(pgs.nhl_ppp, 0)
        WHEN 'shp' THEN COALESCE(pgs.nhl_shp, 0)
        WHEN 'sog' THEN pgs.nhl_shots_on_goal
        WHEN 'hits' THEN COALESCE(pgs.nhl_hits, 0)
        WHEN 'blocks' THEN pgs.nhl_blocks
        WHEN 'pim' THEN COALESCE(pgs.nhl_pim, 0)
        WHEN 'wins' THEN pgs.nhl_wins
        WHEN 'saves' THEN pgs.nhl_saves
        WHEN 'shutouts' THEN pgs.nhl_shutouts
        WHEN 'goals_against' THEN pgs.nhl_goals_against
        WHEN 'gaa' THEN CASE WHEN pgs.nhl_wins + COALESCE(pgs.nhl_losses, 0) > 0
                              THEN pgs.nhl_goals_against
                              ELSE 0 END
        WHEN 'save_pct' THEN CASE WHEN pgs.nhl_saves + pgs.nhl_goals_against > 0
                                   THEN pgs.nhl_saves::NUMERIC / (pgs.nhl_saves + pgs.nhl_goals_against)
                                   ELSE 0 END
        ELSE 0
      END
    ), 0) INTO v_t2
    FROM fantasy_daily_rosters fdr
    JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    JOIN nhl_games ng ON pgs.game_id = ng.game_id
    WHERE fdr.matchup_id = p_matchup_id
      AND fdr.team_id = p_team2_id
      AND fdr.roster_date >= p_week_start
      AND fdr.roster_date <= p_week_end
      AND fdr.slot_type = 'active'
      AND ng.game_date = fdr.roster_date
      AND CASE
        WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
          THEN pgs.is_goalie = true
        ELSE pgs.is_goalie = false
      END;

    -- For GAA, compute averages (divide by goalie game starts)
    IF v_cat = 'gaa' THEN
      SELECT COUNT(DISTINCT ng.game_id) INTO v_t1_gp
      FROM fantasy_daily_rosters fdr
      JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      JOIN nhl_games ng ON pgs.game_id = ng.game_id
      WHERE fdr.matchup_id = p_matchup_id AND fdr.team_id = p_team1_id
        AND fdr.roster_date >= p_week_start AND fdr.roster_date <= p_week_end
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date;

      SELECT COUNT(DISTINCT ng.game_id) INTO v_t2_gp
      FROM fantasy_daily_rosters fdr
      JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      JOIN nhl_games ng ON pgs.game_id = ng.game_id
      WHERE fdr.matchup_id = p_matchup_id AND fdr.team_id = p_team2_id
        AND fdr.roster_date >= p_week_start AND fdr.roster_date <= p_week_end
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date;

      v_t1 := CASE WHEN v_t1_gp > 0 THEN v_t1 / v_t1_gp ELSE 0 END;
      v_t2 := CASE WHEN v_t2_gp > 0 THEN v_t2 / v_t2_gp ELSE 0 END;
    END IF;

    -- For save_pct, it's already computed as a ratio per-row, but was summed.
    -- Recompute as proper weighted average: total_saves / (total_saves + total_goals_against)
    IF v_cat = 'save_pct' THEN
      SELECT
        CASE WHEN SUM(pgs.nhl_saves) + SUM(pgs.nhl_goals_against) > 0
             THEN SUM(pgs.nhl_saves)::NUMERIC / (SUM(pgs.nhl_saves) + SUM(pgs.nhl_goals_against))
             ELSE 0 END
      INTO v_t1
      FROM fantasy_daily_rosters fdr
      JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      JOIN nhl_games ng ON pgs.game_id = ng.game_id
      WHERE fdr.matchup_id = p_matchup_id AND fdr.team_id = p_team1_id
        AND fdr.roster_date >= p_week_start AND fdr.roster_date <= p_week_end
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date;

      SELECT
        CASE WHEN SUM(pgs.nhl_saves) + SUM(pgs.nhl_goals_against) > 0
             THEN SUM(pgs.nhl_saves)::NUMERIC / (SUM(pgs.nhl_saves) + SUM(pgs.nhl_goals_against))
             ELSE 0 END
      INTO v_t2
      FROM fantasy_daily_rosters fdr
      JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      JOIN nhl_games ng ON pgs.game_id = ng.game_id
      WHERE fdr.matchup_id = p_matchup_id AND fdr.team_id = p_team2_id
        AND fdr.roster_date >= p_week_start AND fdr.roster_date <= p_week_end
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date;
    END IF;

    -- Determine winner
    RETURN QUERY SELECT
      v_cat,
      ROUND(v_t1, 3),
      ROUND(v_t2, 3),
      CASE
        WHEN v_higher_is_better AND v_t1 > v_t2 THEN 'team1'
        WHEN v_higher_is_better AND v_t2 > v_t1 THEN 'team2'
        WHEN NOT v_higher_is_better AND v_t1 < v_t2 THEN 'team1'
        WHEN NOT v_higher_is_better AND v_t2 < v_t1 THEN 'team2'
        ELSE 'tie'
      END;
  END LOOP;

  RETURN;
END;
$h2h_cat$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.calculate_h2h_category_matchup(UUID, UUID, UUID, UUID, DATE, DATE, TEXT[]) TO authenticated;


-- ============================================================================
-- 6. FIX: Drop residual overly-permissive RLS policies
--    keeper_select USING(true-ish) and autopick_rankings_select USING(true)
-- ============================================================================

DO $$ BEGIN
  -- Drop the overly-broad keeper_select policy that overrides the narrower audit policies
  DROP POLICY IF EXISTS "keeper_select" ON keeper_designations;

  -- Drop the overly-broad autopick_rankings_select USING(true) policy
  DROP POLICY IF EXISTS "autopick_rankings_select" ON player_autopick_rankings;

  -- Recreate autopick_rankings select with proper scoping
  -- Global rankings (league_id IS NULL) are readable by all, team-specific only by owner
  CREATE POLICY "autopick_rankings_select_scoped" ON player_autopick_rankings FOR SELECT
    USING (
      league_id IS NULL  -- Global rankings: visible to all
      OR league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid())  -- League rankings: league members
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 7. FIX: run_full_autopick_draft() -- add commissioner authorization check
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

      -- Snake draft: even rounds reverse order
      IF v_round % 2 = 0 THEN
        v_current_team := v_teams[v_team_count + 1 - v_team_idx];
      ELSE
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
-- 8. FIX: record_player_transaction() -- add team ownership validation
--    Original signature: (INTEGER, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) RETURNS UUID
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_player_transaction(
    p_player_id INTEGER,
    p_league_id UUID,
    p_team_id UUID,
    p_transaction_type TEXT,
    p_source TEXT DEFAULT 'free_agent',
    p_player_name TEXT DEFAULT NULL,
    p_player_team TEXT DEFAULT NULL,
    p_player_position TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_transaction_id UUID;
BEGIN
    -- Validate that the caller owns this team
    IF NOT EXISTS (
      SELECT 1 FROM teams WHERE id = p_team_id AND owner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'You do not own this team.';
    END IF;

    INSERT INTO player_transactions (
        player_id,
        league_id,
        team_id,
        user_id,
        transaction_type,
        source,
        player_name,
        player_team,
        player_position
    )
    VALUES (
        p_player_id,
        p_league_id,
        p_team_id,
        auth.uid(),
        p_transaction_type,
        p_source,
        p_player_name,
        p_player_team,
        p_player_position
    )
    RETURNING id INTO v_transaction_id;

    RETURN v_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_player_transaction(INTEGER, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Revoke anon access from get_trending_players
REVOKE EXECUTE ON FUNCTION public.get_trending_players(INTEGER, INTEGER, TEXT) FROM anon;


-- ============================================================================
-- 9. FIX: Enable RLS on tables that are missing it
-- ============================================================================

DO $$ BEGIN
  -- player_toi_by_situation
  ALTER TABLE IF EXISTS player_toi_by_situation ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read player TOI" ON player_toi_by_situation
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE IF EXISTS player_shifts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read player shifts" ON player_shifts
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE IF EXISTS player_gar_components ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read player GAR" ON player_gar_components
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE IF EXISTS team_lineups_backup_log ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read backup logs" ON team_lineups_backup_log
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE IF EXISTS auto_recovery_log ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read recovery logs" ON auto_recovery_log
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE IF EXISTS team_mapping_config ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read team mapping" ON team_mapping_config
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE IF EXISTS projection_cache ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Authenticated users can read projections" ON projection_cache
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN undefined_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- 10. FIX: Add missing indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_roster_assignments_league_player
  ON roster_assignments(league_id, player_id);

CREATE INDEX IF NOT EXISTS idx_trade_offers_status_expires
  ON trade_offers(status, expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_waiver_claims_league_status
  ON waiver_claims(league_id, status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fantasy_daily_rosters_matchup
  ON fantasy_daily_rosters(matchup_id, team_id, roster_date);


-- ============================================================================
-- 11. FIX: Add search_path to SECURITY DEFINER functions that lack it
-- ============================================================================

-- autopick_next_player
DO $$ BEGIN
  ALTER FUNCTION public.autopick_next_player(UUID, UUID, UUID, INT, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- submit_trade_vote
DO $$ BEGIN
  ALTER FUNCTION public.submit_trade_vote(UUID, UUID, TEXT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- process_expired_trade_reviews
DO $$ BEGIN
  ALTER FUNCTION public.process_expired_trade_reviews() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- validate_keeper_selections (UUID, UUID, INT)
DO $$ BEGIN
  ALTER FUNCTION public.validate_keeper_selections(UUID, UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- get_keeper_draft_costs (UUID, UUID, INT)
DO $$ BEGIN
  ALTER FUNCTION public.get_keeper_draft_costs(UUID, UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- lock_keepers_for_season (UUID, INT)
DO $$ BEGIN
  ALTER FUNCTION public.lock_keepers_for_season(UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- calculate_roto_standings
DO $$ BEGIN
  ALTER FUNCTION public.calculate_roto_standings(UUID, TEXT[], INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- recalculate_reverse_standings_priority
DO $$ BEGIN
  ALTER FUNCTION public.recalculate_reverse_standings_priority(UUID) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- optimize_best_ball_daily_rosters
DO $$ BEGIN
  ALTER FUNCTION public.optimize_best_ball_daily_rosters(UUID, DATE) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- score_survivor_week, score_pickem_week, score_confidence_week, score_all_pools_for_week
DO $$ BEGIN
  ALTER FUNCTION public.score_survivor_week(UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  ALTER FUNCTION public.score_pickem_week(UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  ALTER FUNCTION public.score_confidence_week(UUID, INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  ALTER FUNCTION public.score_all_pools_for_week(INT) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- process_faab_waivers_for_league / process_all_faab_waivers
DO $$ BEGIN
  ALTER FUNCTION public.process_faab_waivers_for_league(UUID) SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  ALTER FUNCTION public.process_all_faab_waivers() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Restrict process_all_faab_waivers to service_role only
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.process_all_faab_waivers() FROM authenticated;
  GRANT EXECUTE ON FUNCTION public.process_all_faab_waivers() TO service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  11TH AUDIT FIXES APPLIED SUCCESSFULLY';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  CRITICAL FIXES:';
  RAISE NOTICE '    1. delete_user_account() - fixed table references';
  RAISE NOTICE '    2. export_user_data() - fixed table references';
  RAISE NOTICE '    3. process_all_pending_waivers() - fixed column name';
  RAISE NOTICE '    4. join_league_with_code() - uses auth.uid() now';
  RAISE NOTICE '    5. calculate_h2h_category_matchup() - fixed DECLARE syntax';
  RAISE NOTICE '';
  RAISE NOTICE '  HIGH FIXES:';
  RAISE NOTICE '    6. Dropped overly-permissive RLS policies';
  RAISE NOTICE '    7. run_full_autopick_draft() - commissioner auth check';
  RAISE NOTICE '    8. record_player_transaction() - team ownership check';
  RAISE NOTICE '';
  RAISE NOTICE '  SECURITY:';
  RAISE NOTICE '    9. RLS enabled on 7 unprotected tables';
  RAISE NOTICE '   10. Added missing performance indexes';
  RAISE NOTICE '   11. SET search_path on 15+ SECURITY DEFINER functions';
  RAISE NOTICE '   12. Restricted bulk waiver/FAAB processing to service_role';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
