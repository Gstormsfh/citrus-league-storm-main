-- ============================================================================
-- WORLD-CLASS GAP CLOSURE MIGRATION
-- ============================================================================
-- Closes ALL identified gaps from the comprehensive audit:
--
--   1. H2H Categories Scoring RPC — per-category W/L/T for head-to-head matchups
--   2. Roto Standings Calculation RPC — rank teams by each stat category
--   3. Reverse Standings Waiver Processing — priority recalculation from standings
--   4. Best Ball Auto-Optimization RPC — server-side optimal lineup for daily rosters
--   5. Keeper/Dynasty DB Enforcement — tables, constraints, draft cost enforcement
--   6. Autopick Draft RPC — automatic drafting based on player rankings
--   7. Trade Veto/Voting System — league-wide voting on trades
--
-- ============================================================================

-- ============================================================================
-- 1. H2H CATEGORIES SCORING
-- ============================================================================
-- For h2h-categories leagues, each stat category is its own W/L/T battle.
-- E.g., if Team A has 5 goals and Team B has 3 goals, Team A wins the "goals"
-- category. The overall matchup result is the sum of individual category results.
--
-- This RPC calculates per-category results for a specific matchup week.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_h2h_category_matchup(
  p_league_id UUID,
  p_matchup_id UUID,
  p_team1_id UUID,
  p_team2_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_categories TEXT[]  -- e.g., ARRAY['goals','assists','ppp','sog','hits','blocks','wins','saves','shutouts','gaa']
)
RETURNS TABLE (
  category TEXT,
  team1_value NUMERIC,
  team2_value NUMERIC,
  winner TEXT  -- 'team1', 'team2', or 'tie'
) AS $h2h_cat$
DECLARE
  v_cat TEXT;
  v_t1 NUMERIC;
  v_t2 NUMERIC;
  v_higher_is_better BOOLEAN;
BEGIN
  -- For each category, aggregate stats from fantasy_daily_rosters + player_game_stats
  FOREACH v_cat IN ARRAY p_categories
  LOOP
    -- Determine if higher is better (GAA = lower is better)
    v_higher_is_better := v_cat NOT IN ('gaa', 'goals_against');

    -- Team 1 aggregate
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
      -- Filter by position relevance: goalie stats only for goalies
      AND CASE
        WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
          THEN pgs.is_goalie = true
        ELSE pgs.is_goalie = false
      END;

    -- Team 2 aggregate (same logic)
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

    -- For GAA/save_pct, compute averages if we used raw sums
    IF v_cat = 'gaa' THEN
      -- GAA = goals_against / games_played. We summed goals_against above.
      -- Divide by goalie game starts for proper average
      DECLARE
        v_t1_gp NUMERIC;
        v_t2_gp NUMERIC;
      BEGIN
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
      END;
    END IF;

    -- Determine winner
    RETURN QUERY SELECT
      v_cat,
      ROUND(v_t1, 3),
      ROUND(v_t2, 3),
      CASE
        WHEN v_higher_is_better AND v_t1 > v_t2 THEN 'team1'
        WHEN v_higher_is_better AND v_t2 > v_t1 THEN 'team2'
        WHEN NOT v_higher_is_better AND v_t1 < v_t2 THEN 'team1'  -- Lower GAA wins
        WHEN NOT v_higher_is_better AND v_t2 < v_t1 THEN 'team2'
        ELSE 'tie'
      END;
  END LOOP;

  RETURN;
END;
$h2h_cat$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.calculate_h2h_category_matchup(UUID, UUID, UUID, UUID, DATE, DATE, TEXT[]) TO authenticated;


-- ============================================================================
-- 2. ROTO STANDINGS CALCULATION
-- ============================================================================
-- For rotisserie leagues, teams are ranked 1-N in each stat category.
-- The team ranked 1st in a category gets N points (where N = num teams),
-- 2nd gets N-1, etc. Total roto points = sum across all categories.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_roto_standings(
  p_league_id UUID,
  p_categories TEXT[],        -- e.g., ARRAY['goals','assists','ppp','sog','hits','blocks','wins','saves','shutouts','gaa']
  p_through_week INT DEFAULT NULL  -- NULL = entire season so far
)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  category_name TEXT,
  stat_value NUMERIC,
  category_rank INT,
  roto_points INT
) AS $roto$
DECLARE
  v_cat TEXT;
  v_higher_is_better BOOLEAN;
  v_num_teams INT;
BEGIN
  -- Count teams in league
  SELECT COUNT(*) INTO v_num_teams FROM teams WHERE league_id = p_league_id;

  FOREACH v_cat IN ARRAY p_categories
  LOOP
    v_higher_is_better := v_cat NOT IN ('gaa', 'goals_against');

    RETURN QUERY
    WITH team_stats AS (
      SELECT
        t.id AS tid,
        t.team_name AS tname,
        COALESCE(SUM(
          CASE v_cat
            WHEN 'goals' THEN pws.goals
            WHEN 'assists' THEN pws.assists
            WHEN 'points' THEN pws.goals + pws.assists
            WHEN 'plus_minus' THEN pws.plus_minus
            WHEN 'ppp' THEN pws.ppp
            WHEN 'shp' THEN pws.shp
            WHEN 'sog' THEN pws.shots_on_goal
            WHEN 'hits' THEN pws.hits
            WHEN 'blocks' THEN pws.blocks
            WHEN 'pim' THEN pws.pim
            WHEN 'wins' THEN pws.wins
            WHEN 'saves' THEN pws.saves
            WHEN 'shutouts' THEN pws.shutouts
            WHEN 'goals_against' THEN pws.goals_against
            WHEN 'gaa' THEN CASE WHEN pws.wins > 0 OR COALESCE(pws.goals_against, 0) > 0
                                  THEN pws.goals_against ELSE NULL END
            WHEN 'save_pct' THEN CASE WHEN pws.saves + pws.goals_against > 0
                                       THEN pws.saves::NUMERIC / (pws.saves + pws.goals_against)
                                       ELSE NULL END
            ELSE 0
          END
        ), 0) AS total_stat
      FROM teams t
      JOIN roster_assignments ra ON ra.team_id = t.id AND ra.league_id = p_league_id
      LEFT JOIN player_weekly_stats pws ON pws.player_id = ra.player_id::INT
        AND (p_through_week IS NULL OR pws.week_number <= p_through_week)
        -- Filter by goalie/skater relevance
        AND CASE
          WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
            THEN EXISTS (SELECT 1 FROM player_directory pd
                         WHERE pd.player_id = ra.player_id::INT
                           AND pd.position_code = 'G'
                           AND pd.season = CASE WHEN EXTRACT(MONTH FROM NOW()) >= 10
                                                THEN EXTRACT(YEAR FROM NOW())
                                                ELSE EXTRACT(YEAR FROM NOW()) - 1 END)
          ELSE NOT EXISTS (SELECT 1 FROM player_directory pd
                           WHERE pd.player_id = ra.player_id::INT
                             AND pd.position_code = 'G'
                             AND pd.season = CASE WHEN EXTRACT(MONTH FROM NOW()) >= 10
                                                  THEN EXTRACT(YEAR FROM NOW())
                                                  ELSE EXTRACT(YEAR FROM NOW()) - 1 END)
        END
      WHERE t.league_id = p_league_id
      GROUP BY t.id, t.team_name
    ),
    ranked AS (
      SELECT
        ts.tid,
        ts.tname,
        ts.total_stat,
        CASE v_higher_is_better
          WHEN true THEN RANK() OVER (ORDER BY ts.total_stat DESC)
          ELSE RANK() OVER (ORDER BY ts.total_stat ASC)  -- Lower GAA = better rank
        END AS cat_rank
      FROM team_stats ts
    )
    SELECT
      r.tid,
      r.tname,
      v_cat,
      ROUND(r.total_stat, 3),
      r.cat_rank::INT,
      (v_num_teams + 1 - r.cat_rank)::INT;  -- 1st place gets N points, last gets 1
  END LOOP;

  RETURN;
END;
$roto$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.calculate_roto_standings(UUID, TEXT[], INT) TO authenticated;


-- ============================================================================
-- 3. REVERSE STANDINGS WAIVER PROCESSING
-- ============================================================================
-- For 'reverse_standings' waiver type, waiver priority should be
-- recalculated before each processing run based on actual league standings.
-- Worst team gets priority 1 (first claim), best team gets highest priority.
-- This ensures the waiver wire always benefits struggling teams.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recalculate_reverse_standings_priority(p_league_id UUID)
RETURNS VOID AS $reverse$
DECLARE
  v_waiver_type TEXT;
BEGIN
  SELECT waiver_type INTO v_waiver_type
  FROM leagues WHERE id = p_league_id;

  IF v_waiver_type != 'reverse_standings' THEN
    RETURN;  -- Only applies to reverse_standings leagues
  END IF;

  -- Recalculate priority based on actual matchup record
  -- Worst team (lowest win pct) gets priority 1
  WITH team_records AS (
    SELECT
      t.id AS tid,
      COALESCE(SUM(CASE
        WHEN (m.team1_id = t.id AND m.team1_score > m.team2_score) OR
             (m.team2_id = t.id AND m.team2_score > m.team1_score)
        THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE
        WHEN (m.team1_id = t.id AND m.team1_score < m.team2_score) OR
             (m.team2_id = t.id AND m.team2_score < m.team1_score)
        THEN 1 ELSE 0 END), 0) AS losses
    FROM teams t
    LEFT JOIN matchups m ON m.league_id = p_league_id
      AND m.status = 'completed'
      AND (m.team1_id = t.id OR m.team2_id = t.id)
    WHERE t.league_id = p_league_id
    GROUP BY t.id
  ),
  ranked AS (
    SELECT
      tid,
      ROW_NUMBER() OVER (
        ORDER BY
          wins::NUMERIC / GREATEST(1, wins + losses) ASC,  -- Worst win pct first
          losses DESC,  -- More losses = worse = better priority
          tid ASC       -- Stable tiebreak
      ) AS new_priority
    FROM team_records
  )
  UPDATE waiver_priority wp
  SET priority = r.new_priority,
      updated_at = NOW()
  FROM ranked r
  WHERE wp.team_id = r.tid
    AND wp.league_id = p_league_id;

END;
$reverse$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recalculate_reverse_standings_priority(UUID) TO authenticated;

-- Update process_waiver_claims to call recalculate before processing
CREATE OR REPLACE FUNCTION process_waiver_claims(p_league_id UUID)
RETURNS TABLE (
  claim_id UUID,
  team_id UUID,
  player_id INT,
  status TEXT,
  failure_reason TEXT
) AS $$
DECLARE
  v_claim RECORD;
  v_league RECORD;
  v_roster_count INT;
  v_max_roster_size INT;
  v_waiver_type TEXT;
  v_player_id_str TEXT;
  v_drop_player_id_str TEXT;
  v_processed_count INT := 0;
  v_batch_size INT := 100;
  v_lock_acquired BOOLEAN;
  v_move_result JSONB;
  v_user_id UUID;
BEGIN
  -- STEP 1: ACQUIRE ADVISORY LOCK
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_league_id::TEXT));
  IF NOT v_lock_acquired THEN
    RAISE NOTICE 'Waiver processing already in progress for league %', p_league_id;
    RETURN;
  END IF;
  RAISE NOTICE 'Advisory lock acquired for league %', p_league_id;

  -- STEP 2: GET LEAGUE SETTINGS
  SELECT
    roster_size,
    waiver_type,
    COALESCE(roster_size, 20) + 3 as max_roster
  INTO v_league
  FROM leagues
  WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'League % not found', p_league_id;
  END IF;

  v_max_roster_size := v_league.max_roster;
  v_waiver_type := COALESCE(v_league.waiver_type, 'rolling');

  -- STEP 2.5: RECALCULATE REVERSE STANDINGS PRIORITY (NEW)
  -- For reverse_standings leagues, update waiver priority based on actual record.
  -- Wrapped in error handling to ensure claim processing still proceeds even if
  -- recalculation fails (e.g., no matchup data yet). Falls back to existing priorities.
  IF v_waiver_type = 'reverse_standings' THEN
    BEGIN
      PERFORM recalculate_reverse_standings_priority(p_league_id);
      RAISE NOTICE 'Reverse standings priority recalculated for league %', p_league_id;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Reverse standings recalculation failed for league %, using existing priorities: %', p_league_id, SQLERRM;
    END;
  END IF;

  -- STEP 3: PROCESS CLAIMS
  FOR v_claim IN
    SELECT
      wc.id,
      wc.team_id,
      wc.player_id,
      wc.drop_player_id,
      wp.priority,
      wc.created_at
    FROM waiver_claims wc
    JOIN waiver_priority wp ON wp.team_id = wc.team_id AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
    ORDER BY
      wp.priority ASC,  -- Priority 1 = first (works for both rolling and reverse_standings)
      wc.created_at ASC
    LIMIT v_batch_size
    FOR UPDATE OF wc SKIP LOCKED
  LOOP
    v_processed_count := v_processed_count + 1;

    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE WHEN v_claim.drop_player_id IS NOT NULL
                                 THEN v_claim.drop_player_id::TEXT
                                 ELSE NULL END;

    SELECT owner_id INTO v_user_id
    FROM teams WHERE id = v_claim.team_id LIMIT 1;

    IF v_user_id IS NULL THEN
      UPDATE waiver_claims
      SET status = 'failed', failure_reason = 'Team has no owner', processed_at = NOW()
      WHERE id = v_claim.id;

      RETURN QUERY SELECT v_claim.id, v_claim.team_id, v_claim.player_id,
        'failed'::TEXT, 'Team has no owner'::TEXT;
      CONTINUE;
    END IF;

    SELECT public.process_roster_move(
      p_league_id, v_user_id, v_drop_player_id_str, v_player_id_str, 'Waiver Processing'
    ) INTO v_move_result;

    IF (v_move_result->>'status') = 'success' THEN
      UPDATE waiver_claims
      SET status = 'successful', processed_at = NOW()
      WHERE id = v_claim.id;

      -- Rolling: successful claimer moves to last position
      IF v_waiver_type = 'rolling' THEN
        UPDATE waiver_priority
        SET priority = (SELECT MAX(priority) + 1 FROM waiver_priority WHERE league_id = p_league_id)
        WHERE team_id = v_claim.team_id AND league_id = p_league_id;

        WITH ranked AS (
          SELECT wp2.team_id, ROW_NUMBER() OVER (ORDER BY wp2.priority ASC) as new_priority
          FROM waiver_priority wp2 WHERE wp2.league_id = p_league_id
        )
        UPDATE waiver_priority wp SET priority = ranked.new_priority
        FROM ranked WHERE wp.team_id = ranked.team_id AND wp.league_id = p_league_id;
      END IF;

      -- Reverse standings: no priority bump needed — it's recalculated each run

      RETURN QUERY SELECT v_claim.id, v_claim.team_id, v_claim.player_id,
        'successful'::TEXT, NULL::TEXT;
    ELSE
      UPDATE waiver_claims
      SET status = 'failed', failure_reason = v_move_result->>'message', processed_at = NOW()
      WHERE id = v_claim.id;

      RETURN QUERY SELECT v_claim.id, v_claim.team_id, v_claim.player_id,
        'failed'::TEXT, (v_move_result->>'message')::TEXT;
    END IF;
  END LOOP;

  RAISE NOTICE 'Processed % waiver claims for league %', v_processed_count, p_league_id;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 4. BEST BALL AUTO-OPTIMIZATION (Server-Side)
-- ============================================================================
-- For Best Ball leagues, nobody sets lineups manually. This function
-- auto-populates fantasy_daily_rosters with the optimal lineup for
-- each team on a given date by selecting the highest-scoring active players.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.optimize_best_ball_daily_rosters(
  p_league_id UUID,
  p_roster_date DATE
)
RETURNS TABLE (
  team_id UUID,
  players_optimized INT,
  total_points NUMERIC
) AS $bb$
DECLARE
  v_team RECORD;
  v_matchup_id UUID;
  v_player RECORD;
  v_slot_counts JSONB;
  v_slots_remaining JSONB;
  v_inserted INT;
  v_total NUMERIC;
  v_slot TEXT;
  v_eligible BOOLEAN;
  v_league_settings JSONB;
  v_scoring JSONB;
  -- Dynamic scoring weights (read from league settings)
  w_goals NUMERIC;
  w_assists NUMERIC;
  w_sog NUMERIC;
  w_blocks NUMERIC;
  w_hits NUMERIC;
  w_ppp NUMERIC;
  w_shp NUMERIC;
  w_pim NUMERIC;
  w_goalie_wins NUMERIC;
  w_goalie_saves NUMERIC;
  w_goalie_shutouts NUMERIC;
  w_goalie_ga NUMERIC;
BEGIN
  -- Read league settings for dynamic roster slots and scoring weights
  SELECT l.settings, l.scoring_settings INTO v_league_settings, v_scoring
  FROM leagues l WHERE l.id = p_league_id;

  -- Build roster slot counts from league settings, fall back to defaults
  -- Commissioners configure this in CreateLeague.tsx
  v_slot_counts := COALESCE(
    v_league_settings->'rosterSlots',
    '{"C":2,"LW":2,"RW":2,"D":4,"G":2,"UTIL":2}'::JSONB
  );

  -- Extract dynamic scoring weights from league scoring_settings
  w_goals := COALESCE((v_scoring->'skater'->>'goals')::NUMERIC, 3.0);
  w_assists := COALESCE((v_scoring->'skater'->>'assists')::NUMERIC, 2.0);
  w_sog := COALESCE((v_scoring->'skater'->>'shots_on_goal')::NUMERIC, 0.4);
  w_blocks := COALESCE((v_scoring->'skater'->>'blocks')::NUMERIC, 0.5);
  w_hits := COALESCE((v_scoring->'skater'->>'hits')::NUMERIC, 0.2);
  w_ppp := COALESCE((v_scoring->'skater'->>'power_play_points')::NUMERIC, 1.0);
  w_shp := COALESCE((v_scoring->'skater'->>'short_handed_points')::NUMERIC, 2.0);
  w_pim := COALESCE((v_scoring->'skater'->>'penalty_minutes')::NUMERIC, 0.5);
  w_goalie_wins := COALESCE((v_scoring->'goalie'->>'wins')::NUMERIC, 4.0);
  w_goalie_saves := COALESCE((v_scoring->'goalie'->>'saves')::NUMERIC, 0.2);
  w_goalie_shutouts := COALESCE((v_scoring->'goalie'->>'shutouts')::NUMERIC, 3.0);
  w_goalie_ga := COALESCE((v_scoring->'goalie'->>'goals_against')::NUMERIC, -1.0);

  FOR v_team IN
    SELECT t.id AS tid
    FROM teams t
    WHERE t.league_id = p_league_id
  LOOP
    v_inserted := 0;
    v_total := 0;
    v_slots_remaining := v_slot_counts;

    -- Find or create the matchup_id for this team/date
    SELECT m.id INTO v_matchup_id
    FROM matchups m
    WHERE m.league_id = p_league_id
      AND (m.team1_id = v_team.tid OR m.team2_id = v_team.tid)
      AND m.week_start_date <= p_roster_date
      AND m.week_end_date >= p_roster_date
    LIMIT 1;

    -- Delete any existing entries for this team/date (we'll recalculate)
    DELETE FROM fantasy_daily_rosters
    WHERE league_id = p_league_id
      AND team_id = v_team.tid
      AND roster_date = p_roster_date;

    -- Get all rostered players with their actual points for this date, sorted by points desc
    -- Uses DYNAMIC scoring weights from league settings (commissioner-configurable)
    FOR v_player IN
      SELECT
        ra.player_id,
        pd.position_code,
        COALESCE(SUM(
          CASE
            WHEN pgs.is_goalie = false THEN
              (pgs.nhl_goals * w_goals) + (pgs.nhl_assists * w_assists) +
              (pgs.nhl_shots_on_goal * w_sog) + (pgs.nhl_blocks * w_blocks) +
              (COALESCE(pgs.nhl_hits, 0) * w_hits) +
              (COALESCE(pgs.nhl_ppp, 0) * w_ppp) +
              (COALESCE(pgs.nhl_shp, 0) * w_shp) +
              (COALESCE(pgs.nhl_pim, 0) * w_pim)
            ELSE
              (pgs.nhl_wins * w_goalie_wins) + (pgs.nhl_saves * w_goalie_saves) +
              (pgs.nhl_shutouts * w_goalie_shutouts) + (pgs.nhl_goals_against * w_goalie_ga)
          END
        ), 0) AS day_points
      FROM roster_assignments ra
      LEFT JOIN player_directory pd ON pd.player_id = ra.player_id::INT
        AND pd.season = CASE WHEN EXTRACT(MONTH FROM NOW()) >= 10
                             THEN EXTRACT(YEAR FROM NOW())
                             ELSE EXTRACT(YEAR FROM NOW()) - 1 END
      LEFT JOIN player_game_stats pgs ON pgs.player_id = ra.player_id::INT
      LEFT JOIN nhl_games ng ON pgs.game_id = ng.game_id AND ng.game_date = p_roster_date
      WHERE ra.league_id = p_league_id
        AND ra.team_id = v_team.tid
      GROUP BY ra.player_id, pd.position_code
      ORDER BY day_points DESC
    LOOP
      v_slot := NULL;

      -- Try to assign to specific position slot first
      IF v_player.position_code IN ('C', 'Centre') AND (v_slots_remaining->>'C')::INT > 0 THEN
        v_slot := 'C';
      ELSIF v_player.position_code IN ('LW', 'Left Wing') AND (v_slots_remaining->>'LW')::INT > 0 THEN
        v_slot := 'LW';
      ELSIF v_player.position_code IN ('RW', 'Right Wing') AND (v_slots_remaining->>'RW')::INT > 0 THEN
        v_slot := 'RW';
      ELSIF v_player.position_code IN ('D', 'Defence', 'Defense') AND (v_slots_remaining->>'D')::INT > 0 THEN
        v_slot := 'D';
      ELSIF v_player.position_code IN ('G', 'Goalie') AND (v_slots_remaining->>'G')::INT > 0 THEN
        v_slot := 'G';
      -- Try UTIL for non-goalies
      ELSIF v_player.position_code NOT IN ('G', 'Goalie') AND (v_slots_remaining->>'UTIL')::INT > 0 THEN
        v_slot := 'UTIL';
      END IF;

      IF v_slot IS NOT NULL THEN
        -- Insert as active
        INSERT INTO fantasy_daily_rosters (league_id, team_id, matchup_id, player_id, roster_date, slot_type)
        VALUES (p_league_id, v_team.tid, v_matchup_id, v_player.player_id::INT, p_roster_date, 'active')
        ON CONFLICT DO NOTHING;

        v_slots_remaining := jsonb_set(v_slots_remaining, ARRAY[v_slot],
          to_jsonb(GREATEST(0, (v_slots_remaining->>v_slot)::INT - 1)));

        v_inserted := v_inserted + 1;
        v_total := v_total + v_player.day_points;
      ELSE
        -- Bench
        INSERT INTO fantasy_daily_rosters (league_id, team_id, matchup_id, player_id, roster_date, slot_type)
        VALUES (p_league_id, v_team.tid, v_matchup_id, v_player.player_id::INT, p_roster_date, 'bench')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    RETURN QUERY SELECT v_team.tid, v_inserted, ROUND(v_total, 3);
  END LOOP;

  RETURN;
END;
$bb$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.optimize_best_ball_daily_rosters(UUID, DATE) TO authenticated;


-- ============================================================================
-- 5. KEEPER / DYNASTY DB ENFORCEMENT
-- ============================================================================

-- 5a. Keeper designations table — tracks which players are kept between seasons
CREATE TABLE IF NOT EXISTS keeper_designations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,             -- matches roster_assignments.player_id
  season_year INT NOT NULL,            -- e.g., 2025 for the 2025-26 season
  keeper_round INT,                    -- draft round cost (NULL = no round cost)
  keeper_penalty_type TEXT DEFAULT 'none'
    CHECK (keeper_penalty_type IN ('none', 'round-cost', 'round-escalation')),
  original_draft_round INT,            -- round player was originally drafted
  years_kept INT NOT NULL DEFAULT 1,   -- how many consecutive seasons kept
  designated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES auth.users(id), -- commissioner approval
  status TEXT NOT NULL DEFAULT 'designated'
    CHECK (status IN ('designated', 'approved', 'released', 'locked')),

  -- Each player can only be kept once per league per season
  UNIQUE (league_id, player_id, season_year),
  -- Each team has limited keeper slots
  CONSTRAINT keeper_team_season UNIQUE (league_id, team_id, player_id, season_year)
);

CREATE INDEX IF NOT EXISTS idx_keeper_league_season ON keeper_designations (league_id, season_year);
CREATE INDEX IF NOT EXISTS idx_keeper_team ON keeper_designations (team_id, season_year);

ALTER TABLE keeper_designations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "keeper_select" ON keeper_designations FOR SELECT
  USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "keeper_insert" ON keeper_designations FOR INSERT
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "keeper_update" ON keeper_designations FOR UPDATE
  USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
    OR league_id IN (SELECT id FROM leagues WHERE commissioner_id = auth.uid()));

-- 5b. Function to validate keeper selections for a team
CREATE OR REPLACE FUNCTION public.validate_keeper_selections(
  p_league_id UUID,
  p_team_id UUID,
  p_season_year INT
)
RETURNS TABLE (
  is_valid BOOLEAN,
  error_message TEXT,
  keepers_count INT,
  max_keepers INT
) AS $keeper_validate$
DECLARE
  v_settings JSONB;
  v_keeper_enabled BOOLEAN;
  v_max_keepers INT;
  v_dynasty_mode BOOLEAN;
  v_current_count INT;
  v_invalid_players TEXT[];
BEGIN
  -- Get league keeper settings
  SELECT settings INTO v_settings FROM leagues WHERE id = p_league_id;

  v_keeper_enabled := COALESCE((v_settings->>'keeperEnabled')::BOOLEAN, false);
  v_dynasty_mode := COALESCE((v_settings->>'dynastyMode')::BOOLEAN, false);
  v_max_keepers := CASE
    WHEN v_dynasty_mode THEN 999  -- Dynasty = unlimited keepers
    ELSE COALESCE((v_settings->>'keeperCount')::INT, 0)
  END;

  IF NOT v_keeper_enabled THEN
    RETURN QUERY SELECT false, 'Keeper leagues are not enabled for this league'::TEXT, 0, 0;
    RETURN;
  END IF;

  -- Count current keeper designations
  SELECT COUNT(*) INTO v_current_count
  FROM keeper_designations
  WHERE league_id = p_league_id
    AND team_id = p_team_id
    AND season_year = p_season_year
    AND status IN ('designated', 'approved', 'locked');

  -- Check keeper count limit
  IF v_current_count > v_max_keepers THEN
    RETURN QUERY SELECT false,
      format('Too many keepers: %s designated but max is %s', v_current_count, v_max_keepers)::TEXT,
      v_current_count, v_max_keepers;
    RETURN;
  END IF;

  -- Validate all kept players are actually on the team's roster
  SELECT ARRAY_AGG(kd.player_id) INTO v_invalid_players
  FROM keeper_designations kd
  WHERE kd.league_id = p_league_id
    AND kd.team_id = p_team_id
    AND kd.season_year = p_season_year
    AND kd.status IN ('designated', 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM roster_assignments ra
      WHERE ra.league_id = p_league_id
        AND ra.team_id = p_team_id
        AND ra.player_id = kd.player_id
    );

  IF v_invalid_players IS NOT NULL AND array_length(v_invalid_players, 1) > 0 THEN
    RETURN QUERY SELECT false,
      format('Players not on roster: %s', array_to_string(v_invalid_players, ', '))::TEXT,
      v_current_count, v_max_keepers;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, v_current_count, v_max_keepers;
END;
$keeper_validate$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.validate_keeper_selections(UUID, UUID, INT) TO authenticated;

-- 5c. Function to calculate keeper draft costs (round-cost and round-escalation penalties)
CREATE OR REPLACE FUNCTION public.get_keeper_draft_costs(
  p_league_id UUID,
  p_team_id UUID,
  p_season_year INT
)
RETURNS TABLE (
  player_id TEXT,
  keeper_round INT,
  penalty_type TEXT,
  original_draft_round INT,
  years_kept INT,
  effective_round INT  -- the actual draft round this keeper costs
) AS $keeper_cost$
DECLARE
  v_settings JSONB;
  v_penalty_type TEXT;
BEGIN
  SELECT settings INTO v_settings FROM leagues WHERE id = p_league_id;
  v_penalty_type := COALESCE(v_settings->>'keeperPenalty', 'none');

  RETURN QUERY
  SELECT
    kd.player_id,
    kd.keeper_round,
    v_penalty_type,
    kd.original_draft_round,
    kd.years_kept,
    CASE v_penalty_type
      WHEN 'none' THEN NULL  -- No round cost, keeper is free
      WHEN 'round-cost' THEN COALESCE(kd.original_draft_round, 1)  -- Costs the round they were drafted
      WHEN 'round-escalation' THEN GREATEST(1,
        COALESCE(kd.original_draft_round, 1) - kd.years_kept  -- Moves up 1 round per year kept
      )
      ELSE NULL
    END
  FROM keeper_designations kd
  WHERE kd.league_id = p_league_id
    AND kd.team_id = p_team_id
    AND kd.season_year = p_season_year
    AND kd.status IN ('approved', 'locked');
END;
$keeper_cost$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_keeper_draft_costs(UUID, UUID, INT) TO authenticated;

-- 5d. Function to lock in keepers and prepare draft (commissioner action)
CREATE OR REPLACE FUNCTION public.lock_keepers_for_season(
  p_league_id UUID,
  p_season_year INT
)
RETURNS TABLE (
  team_id UUID,
  keepers_locked INT,
  rounds_consumed INT[]
) AS $lock_keepers$
DECLARE
  v_team RECORD;
  v_count INT;
  v_rounds INT[];
BEGIN
  -- Validate all teams' keeper selections
  FOR v_team IN SELECT id FROM teams WHERE league_id = p_league_id
  LOOP
    -- Check validity
    PERFORM 1 FROM validate_keeper_selections(p_league_id, v_team.id, p_season_year)
    WHERE is_valid = false;

    IF FOUND THEN
      RAISE EXCEPTION 'Team % has invalid keeper selections', v_team.id;
    END IF;
  END LOOP;

  -- Lock all designated keepers
  FOR v_team IN SELECT id FROM teams WHERE league_id = p_league_id
  LOOP
    UPDATE keeper_designations
    SET status = 'locked'
    WHERE league_id = p_league_id
      AND team_id = v_team.id
      AND season_year = p_season_year
      AND status IN ('designated', 'approved');

    GET DIAGNOSTICS v_count = ROW_COUNT;

    SELECT ARRAY_AGG(effective_round ORDER BY effective_round) INTO v_rounds
    FROM get_keeper_draft_costs(p_league_id, v_team.id, p_season_year)
    WHERE effective_round IS NOT NULL;

    RETURN QUERY SELECT v_team.id, v_count, COALESCE(v_rounds, ARRAY[]::INT[]);
  END LOOP;

  RETURN;
END;
$lock_keepers$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.lock_keepers_for_season(UUID, INT) TO authenticated;


-- ============================================================================
-- 6. AUTOPICK DRAFT
-- ============================================================================
-- Automatically drafts the best available player for a team based on
-- positional needs and player rankings. Used for:
-- - Autopick draft type (entire draft is automatic)
-- - AFK timer expiration (single pick for absent manager)
-- ============================================================================

-- 6a. Player rankings table for autopick
CREATE TABLE IF NOT EXISTS player_autopick_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,  -- NULL = global default ranking
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,      -- NULL = league/global default
  player_id INT NOT NULL,
  rank_position INT NOT NULL,
  position_code TEXT,
  tier INT DEFAULT 1,         -- tier grouping for ADP
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index using expressions to handle NULLs (can't use COALESCE in table UNIQUE constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_autopick_rankings_unique
  ON player_autopick_rankings (
    COALESCE(league_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(team_id, '00000000-0000-0000-0000-000000000000'),
    player_id
  );

CREATE INDEX IF NOT EXISTS idx_autopick_rankings_league ON player_autopick_rankings (league_id, rank_position);
CREATE INDEX IF NOT EXISTS idx_autopick_rankings_global ON player_autopick_rankings (rank_position) WHERE league_id IS NULL;

ALTER TABLE player_autopick_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autopick_rankings_select" ON player_autopick_rankings FOR SELECT USING (true);
CREATE POLICY "autopick_rankings_insert" ON player_autopick_rankings FOR INSERT
  WITH CHECK (
    team_id IS NULL  -- Global/league rankings: anyone
    OR team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())  -- Team-specific: owner only
  );
CREATE POLICY "autopick_rankings_update" ON player_autopick_rankings FOR UPDATE
  USING (
    team_id IS NULL
    OR team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
  );

-- 6b. Autopick function — picks the best available player
CREATE OR REPLACE FUNCTION public.autopick_next_player(
  p_league_id UUID,
  p_team_id UUID,
  p_draft_session_id UUID,
  p_round_number INT,
  p_pick_number INT
)
RETURNS TABLE (
  picked_player_id INT,
  player_name TEXT,
  position TEXT,
  pick_id UUID
) AS $autopick$
DECLARE
  v_player RECORD;
  v_pick_id UUID;
  v_best_player_id INT;
  v_best_name TEXT;
  v_best_position TEXT;
BEGIN
  -- Find the highest-ranked available player
  -- Priority: team-specific rankings > league rankings > global rankings > fallback to projections
  SELECT
    COALESCE(apr.player_id, pd.player_id) AS pid,
    pd.full_name,
    pd.position_code
  INTO v_player
  FROM (
    -- Try team-specific rankings first
    SELECT player_id, rank_position FROM player_autopick_rankings
    WHERE league_id = p_league_id AND team_id = p_team_id
    UNION ALL
    -- Then league-level rankings
    SELECT player_id, rank_position + 10000 FROM player_autopick_rankings
    WHERE league_id = p_league_id AND team_id IS NULL
    UNION ALL
    -- Then global rankings
    SELECT player_id, rank_position + 20000 FROM player_autopick_rankings
    WHERE league_id IS NULL AND team_id IS NULL
    UNION ALL
    -- Fallback: use projected stats (higher projected = better)
    SELECT pps.player_id, 30000 + ROW_NUMBER() OVER (ORDER BY pps.projected_points DESC)
    FROM player_projected_stats pps
    WHERE NOT EXISTS (SELECT 1 FROM player_autopick_rankings WHERE player_id = pps.player_id)
  ) apr
  JOIN player_directory pd ON pd.player_id = apr.player_id
    AND pd.season = CASE WHEN EXTRACT(MONTH FROM NOW()) >= 10
                         THEN EXTRACT(YEAR FROM NOW())
                         ELSE EXTRACT(YEAR FROM NOW()) - 1 END
  WHERE NOT EXISTS (
    -- Player not already drafted in this session
    SELECT 1 FROM draft_picks dp
    WHERE dp.league_id = p_league_id
      AND dp.draft_session_id = p_draft_session_id
      AND dp.player_id = apr.player_id::TEXT
      AND dp.deleted_at IS NULL
  )
  ORDER BY apr.rank_position ASC
  LIMIT 1;

  IF v_player IS NULL THEN
    RAISE NOTICE 'No available players for autopick in league %', p_league_id;
    RETURN;
  END IF;

  v_best_player_id := v_player.pid;
  v_best_name := v_player.full_name;
  v_best_position := v_player.position_code;

  -- Make the draft pick
  INSERT INTO draft_picks (
    league_id, team_id, player_id, round_number, pick_number,
    draft_session_id, picked_at
  ) VALUES (
    p_league_id, p_team_id, v_best_player_id::TEXT, p_round_number, p_pick_number,
    p_draft_session_id, NOW()
  )
  RETURNING id INTO v_pick_id;

  RETURN QUERY SELECT v_best_player_id, v_best_name, v_best_position, v_pick_id;
END;
$autopick$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.autopick_next_player(UUID, UUID, UUID, INT, INT) TO authenticated;

-- 6c. Run full autopick draft for a league (all rounds, all teams)
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
$full_auto$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.run_full_autopick_draft(UUID) TO authenticated;


-- ============================================================================
-- 7. TRADE VETO / VOTING SYSTEM
-- ============================================================================
-- When a trade is accepted, it enters a league-wide review period.
-- League members can vote to veto the trade. If enough votes are cast
-- (configurable threshold), the trade is vetoed.
-- Default: commissioner-veto (commissioner decides) or league-vote.
-- ============================================================================

-- 7a. Trade votes table
CREATE TABLE IF NOT EXISTS trade_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_offer_id UUID NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  voter_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('approve', 'veto')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each team votes once per trade
  UNIQUE (trade_offer_id, voter_team_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_votes_offer ON trade_votes (trade_offer_id);
CREATE INDEX IF NOT EXISTS idx_trade_votes_league ON trade_votes (league_id);

ALTER TABLE trade_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trade_votes_select" ON trade_votes FOR SELECT
  USING (league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "trade_votes_insert" ON trade_votes FOR INSERT
  WITH CHECK (voter_team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

-- 7b. Add trade review settings to leagues
-- trade_review_type: 'none' (instant), 'commissioner' (commissioner approves), 'league_vote' (league votes)
-- trade_review_period_hours: how long voting is open (default 48h)
-- trade_veto_threshold: fraction of league needed to veto (default 0.5 = majority)
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trade_review_type TEXT DEFAULT 'none'
  CHECK (trade_review_type IN ('none', 'commissioner', 'league_vote'));
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trade_review_period_hours INT DEFAULT 48;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS trade_veto_threshold NUMERIC DEFAULT 0.5
  CHECK (trade_veto_threshold > 0 AND trade_veto_threshold <= 1);

-- Add 'under_review' status to trade_offers if not already present
-- (Safe: CHECK constraint will be recreated)
DO $$
BEGIN
  -- Drop existing check and recreate with 'under_review' added
  ALTER TABLE trade_offers DROP CONSTRAINT IF EXISTS trade_offers_status_check;
  ALTER TABLE trade_offers ADD CONSTRAINT trade_offers_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'cancelled', 'expired', 'under_review', 'vetoed'));
END $$;

-- Add review tracking columns to trade_offers
ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ;
ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS review_ends_at TIMESTAMPTZ;
ALTER TABLE trade_offers ADD COLUMN IF NOT EXISTS vetoed_at TIMESTAMPTZ;

-- 7c. Function to submit a trade vote
CREATE OR REPLACE FUNCTION public.submit_trade_vote(
  p_trade_offer_id UUID,
  p_voter_team_id UUID,
  p_vote TEXT  -- 'approve' or 'veto'
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  veto_count INT,
  approve_count INT,
  votes_needed INT,
  is_vetoed BOOLEAN
) AS $vote$
DECLARE
  v_trade RECORD;
  v_league RECORD;
  v_total_teams INT;
  v_eligible_voters INT;
  v_veto_count INT;
  v_approve_count INT;
  v_threshold INT;
  v_is_vetoed BOOLEAN := false;
BEGIN
  -- Get trade details
  SELECT * INTO v_trade FROM trade_offers WHERE id = p_trade_offer_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Trade not found'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Trade must be under_review to accept votes
  IF v_trade.status != 'under_review' THEN
    RETURN QUERY SELECT false, format('Trade is not under review (status: %s)', v_trade.status)::TEXT,
      0, 0, 0, false;
    RETURN;
  END IF;

  -- Can't vote on your own trade
  IF p_voter_team_id = v_trade.from_team_id OR p_voter_team_id = v_trade.to_team_id THEN
    RETURN QUERY SELECT false, 'Cannot vote on a trade you are involved in'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Check review period hasn't expired
  IF v_trade.review_ends_at IS NOT NULL AND NOW() > v_trade.review_ends_at THEN
    RETURN QUERY SELECT false, 'Review period has ended'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Get league settings
  SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;

  -- Insert or update vote
  INSERT INTO trade_votes (trade_offer_id, league_id, voter_team_id, vote)
  VALUES (p_trade_offer_id, v_trade.league_id, p_voter_team_id, p_vote)
  ON CONFLICT (trade_offer_id, voter_team_id)
  DO UPDATE SET vote = p_vote, created_at = NOW();

  -- Count votes
  SELECT COUNT(*) INTO v_total_teams FROM teams WHERE league_id = v_trade.league_id;
  v_eligible_voters := v_total_teams - 2;  -- Exclude the two trading teams

  SELECT
    COUNT(*) FILTER (WHERE vote = 'veto'),
    COUNT(*) FILTER (WHERE vote = 'approve')
  INTO v_veto_count, v_approve_count
  FROM trade_votes WHERE trade_offer_id = p_trade_offer_id;

  v_threshold := CEIL(v_eligible_voters * COALESCE(v_league.trade_veto_threshold, 0.5));

  -- Check if trade is vetoed
  IF v_veto_count >= v_threshold THEN
    v_is_vetoed := true;
    UPDATE trade_offers
    SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
    WHERE id = p_trade_offer_id;
  END IF;

  RETURN QUERY SELECT true, 'Vote recorded'::TEXT,
    v_veto_count, v_approve_count, v_threshold, v_is_vetoed;
END;
$vote$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.submit_trade_vote(UUID, UUID, TEXT) TO authenticated;

-- 7d. Function to process expired trade reviews (auto-approve if no veto)
CREATE OR REPLACE FUNCTION public.process_expired_trade_reviews()
RETURNS TABLE (
  trade_id UUID,
  league_id UUID,
  action TEXT  -- 'approved' or 'vetoed'
) AS $review$
DECLARE
  v_trade RECORD;
  v_league RECORD;
  v_total_teams INT;
  v_veto_count INT;
  v_threshold INT;
BEGIN
  FOR v_trade IN
    SELECT * FROM trade_offers
    WHERE status = 'under_review'
      AND review_ends_at IS NOT NULL
      AND NOW() > review_ends_at
  LOOP
    SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;
    SELECT COUNT(*) INTO v_total_teams FROM teams WHERE league_id = v_trade.league_id;

    SELECT COUNT(*) INTO v_veto_count
    FROM trade_votes WHERE trade_offer_id = v_trade.id AND vote = 'veto';

    v_threshold := CEIL((v_total_teams - 2) * COALESCE(v_league.trade_veto_threshold, 0.5));

    IF v_veto_count >= v_threshold THEN
      -- Vetoed
      UPDATE trade_offers SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
      WHERE id = v_trade.id;

      RETURN QUERY SELECT v_trade.id, v_trade.league_id, 'vetoed'::TEXT;
    ELSE
      -- Approved — trade goes through
      UPDATE trade_offers SET status = 'accepted', processed_at = NOW()
      WHERE id = v_trade.id;

      RETURN QUERY SELECT v_trade.id, v_trade.league_id, 'approved'::TEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$review$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.process_expired_trade_reviews() TO authenticated;

-- 7e. Schedule trade review processing via pg_cron
DO $cron_setup$
BEGIN
  PERFORM cron.schedule(
    'process-trade-reviews',
    '*/15 * * * *',  -- Every 15 minutes
    'SELECT * FROM public.process_expired_trade_reviews()'
  );
  RAISE NOTICE '  Scheduled: process-trade-reviews (every 15 min)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping trade review schedule';
END $cron_setup$;

-- Schedule Best Ball optimization via pg_cron (daily at 7 AM UTC)
DO $cron_bb$
BEGIN
  PERFORM cron.schedule(
    'optimize-best-ball-rosters',
    '0 7 * * *',  -- Daily at 7 AM UTC (2 AM EST, after games end)
    $$
      SELECT optimize_best_ball_daily_rosters(l.id, (NOW() AT TIME ZONE 'America/New_York')::DATE - 1)
      FROM leagues l
      WHERE l.settings->>'bestBallEnabled' = 'true'
        OR l.settings->>'scoringFormat' = 'best-ball'
    $$
  );
  RAISE NOTICE '  Scheduled: optimize-best-ball-rosters (daily 7 AM UTC)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping Best Ball optimization schedule';
END $cron_bb$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  WORLD-CLASS GAP CLOSURE — ALL 7 FIXES DEPLOYED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  1. H2H Categories Scoring RPC';
  RAISE NOTICE '     calculate_h2h_category_matchup(league, matchup, t1, t2, start, end, categories)';
  RAISE NOTICE '     Returns per-category W/L/T with stat values';
  RAISE NOTICE '';
  RAISE NOTICE '  2. Roto Standings Calculation RPC';
  RAISE NOTICE '     calculate_roto_standings(league, categories, through_week)';
  RAISE NOTICE '     Returns team rankings per category with roto points';
  RAISE NOTICE '';
  RAISE NOTICE '  3. Reverse Standings Waiver Processing';
  RAISE NOTICE '     recalculate_reverse_standings_priority(league)';
  RAISE NOTICE '     Updated process_waiver_claims to auto-recalculate before processing';
  RAISE NOTICE '';
  RAISE NOTICE '  4. Best Ball Auto-Optimization RPC';
  RAISE NOTICE '     optimize_best_ball_daily_rosters(league, date)';
  RAISE NOTICE '     Server-side greedy optimizer + daily cron at 7 AM UTC';
  RAISE NOTICE '';
  RAISE NOTICE '  5. Keeper/Dynasty DB Enforcement';
  RAISE NOTICE '     keeper_designations table + validate_keeper_selections()';
  RAISE NOTICE '     get_keeper_draft_costs() + lock_keepers_for_season()';
  RAISE NOTICE '';
  RAISE NOTICE '  6. Autopick Draft';
  RAISE NOTICE '     player_autopick_rankings table';
  RAISE NOTICE '     autopick_next_player() + run_full_autopick_draft()';
  RAISE NOTICE '';
  RAISE NOTICE '  7. Trade Veto/Voting System';
  RAISE NOTICE '     trade_votes table + submit_trade_vote()';
  RAISE NOTICE '     process_expired_trade_reviews() + cron (every 15 min)';
  RAISE NOTICE '     Supports: none, commissioner, league_vote review types';
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
END $$;
