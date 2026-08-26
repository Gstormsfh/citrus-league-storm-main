

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."draft_status" AS ENUM (
    'not_started',
    'queued',
    'in_progress',
    'completed'
);


ALTER TYPE "public"."draft_status" OWNER TO "postgres";


CREATE TYPE "public"."matchup_status" AS ENUM (
    'scheduled',
    'in_progress',
    'completed'
);


ALTER TYPE "public"."matchup_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_playoff_round"("p_bracket_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bracket RECORD;
  v_series RECORD;
  v_winner_id UUID;
  v_loser_id UUID;
  v_advanced_count INT := 0;
  v_league_id UUID;
BEGIN
  -- Get bracket
  SELECT * INTO v_bracket
  FROM public.playoff_brackets
  WHERE id = p_bracket_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Bracket not found');
  END IF;

  v_league_id := v_bracket.league_id;

  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can advance rounds');
  END IF;

  IF v_bracket.status = 'completed' THEN
    RETURN json_build_object('error', 'Bracket is already completed');
  END IF;

  -- Process each active series in the current round
  FOR v_series IN
    SELECT ps.*
    FROM public.playoff_series ps
    WHERE ps.bracket_id = p_bracket_id
    AND ps.round_number = v_bracket.current_round
    AND ps.status = 'active'
    AND ps.home_team_id IS NOT NULL
    AND ps.away_team_id IS NOT NULL
  LOOP
    -- Get scores from matchups table (aggregate if two-week)
    SELECT
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END), 0)
    INTO v_series.home_score, v_series.away_score
    FROM public.matchups m
    WHERE m.league_id = v_league_id
    AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
    AND (
      (m.team1_id = v_series.home_team_id AND m.team2_id = v_series.away_team_id) OR
      (m.team1_id = v_series.away_team_id AND m.team2_id = v_series.home_team_id)
    );

    -- Determine winner (higher seed wins tiebreaker)
    IF v_series.home_score > v_series.away_score THEN
      v_winner_id := v_series.home_team_id;
      v_loser_id := v_series.away_team_id;
    ELSIF v_series.away_score > v_series.home_score THEN
      v_winner_id := v_series.away_team_id;
      v_loser_id := v_series.home_team_id;
    ELSE
      -- Tiebreaker: higher seed wins
      IF v_series.home_seed IS NOT NULL AND v_series.away_seed IS NOT NULL AND v_series.home_seed < v_series.away_seed THEN
        v_winner_id := v_series.home_team_id;
        v_loser_id := v_series.away_team_id;
      ELSE
        v_winner_id := v_series.away_team_id;
        v_loser_id := v_series.home_team_id;
      END IF;
    END IF;

    -- Update series with results
    UPDATE public.playoff_series
    SET
      home_score = v_series.home_score,
      away_score = v_series.away_score,
      winner_team_id = v_winner_id,
      loser_team_id = v_loser_id,
      status = 'completed'
    WHERE id = v_series.id;

    -- Advance winner to next series
    IF v_series.winner_advances_to IS NOT NULL THEN
      IF v_series.winner_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_winner_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_winner_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      END IF;

      -- Create matchup rows for the newly activated series
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.winner_advances_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    -- Drop loser to consolation/third-place if configured
    IF v_series.loser_drops_to IS NOT NULL THEN
      IF v_series.loser_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_loser_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_loser_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      END IF;

      -- Create matchup rows for consolation
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.loser_drops_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    v_advanced_count := v_advanced_count + 1;
  END LOOP;

  -- Check if the finals are now completed -> bracket complete
  IF EXISTS (
    SELECT 1 FROM public.playoff_series
    WHERE bracket_id = p_bracket_id
    AND bracket_position = 'winners'
    AND round_number = v_bracket.total_rounds
    AND status = 'completed'
  ) THEN
    -- Get champion and runner-up from finals
    UPDATE public.playoff_brackets
    SET
      status = 'completed',
      current_round = v_bracket.total_rounds,
      champion_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      runner_up_team_id = (
        SELECT loser_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      third_place_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'third_place'
        AND status = 'completed' LIMIT 1
      ),
      completed_at = NOW()
    WHERE id = p_bracket_id;
  ELSE
    -- Advance to next round
    UPDATE public.playoff_brackets
    SET current_round = v_bracket.current_round + 1
    WHERE id = p_bracket_id;
  END IF;

  RETURN json_build_object(
    'advanced_count', v_advanced_count,
    'current_round', v_bracket.current_round,
    'success', true
  );
END;
$$;


ALTER FUNCTION "public"."advance_playoff_round"("p_bracket_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aggregate_player_playoff_stats"("p_season" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  DELETE FROM player_playoff_stats WHERE season = p_season;

  INSERT INTO player_playoff_stats (
    player_id, season, games_played, goals, assists, points,
    ppp, shp, shots, hits, blocks, pim, plus_minus,
    wins, saves, shutouts, goals_against, is_goalie,
    team_abbrev, last_game_id, updated_at
  )
  SELECT
    pgs.player_id,
    p_season,
    COUNT(DISTINCT pgs.game_id)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_goals, pgs.goals)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_assists, COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0))), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_points, pgs.points)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_ppp, pgs.ppp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shp, pgs.shp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_hits, pgs.hits)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_blocks, pgs.blocks)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_pim, pgs.pim)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_plus_minus, pgs.plus_minus)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_wins, pgs.wins)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_saves, pgs.saves)), 0)::INTEGER,
    COALESCE(SUM(COALESCE(pgs.nhl_shutouts, pgs.shutouts)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_goals_against, pgs.goals_against)), 0)::SMALLINT,
    BOOL_OR(COALESCE(pgs.is_goalie, false)),
    MAX(pd.team_abbrev),
    MAX(pgs.game_id),
    NOW()
  FROM player_game_stats pgs
  JOIN nhl_games g ON pgs.game_id = g.game_id
  LEFT JOIN player_directory pd ON pgs.player_id = pd.player_id
  WHERE g.game_type = 'playoff'
    AND g.season = p_season
    AND g.status = 'final'
  GROUP BY pgs.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO nhl_pipeline_meta (key, last_refresh)
  VALUES ('player_playoff_stats', NOW())
  ON CONFLICT (key) DO UPDATE SET last_refresh = NOW();

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."aggregate_player_playoff_stats"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."aggregate_player_playoff_stats"("p_season" integer) IS 'Rebuilds player_playoff_stats from per-game stats for playoff games only. Idempotent / self-healing.';



CREATE OR REPLACE FUNCTION "public"."aggregate_player_playoff_stats_live"("p_season" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  DELETE FROM player_playoff_stats WHERE season = p_season;

  INSERT INTO player_playoff_stats (
    player_id, season, games_played, goals, assists, points,
    ppp, shp, shots, hits, blocks, pim, plus_minus,
    wins, saves, shutouts, goals_against, is_goalie,
    team_abbrev, last_game_id, updated_at
  )
  SELECT
    pgs.player_id,
    p_season,
    COUNT(DISTINCT pgs.game_id)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_goals, pgs.goals)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_assists, COALESCE(pgs.primary_assists, 0) + COALESCE(pgs.secondary_assists, 0))), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_points, pgs.points)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_ppp, pgs.ppp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shp, pgs.shp)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_hits, pgs.hits)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_blocks, pgs.blocks)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_pim, pgs.pim)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_plus_minus, pgs.plus_minus)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_wins, pgs.wins)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_saves, pgs.saves)), 0)::INTEGER,
    COALESCE(SUM(COALESCE(pgs.nhl_shutouts, pgs.shutouts)), 0)::SMALLINT,
    COALESCE(SUM(COALESCE(pgs.nhl_goals_against, pgs.goals_against)), 0)::SMALLINT,
    BOOL_OR(COALESCE(pgs.is_goalie, false)),
    MAX(pd.team_abbrev),
    MAX(pgs.game_id),
    NOW()
  FROM player_game_stats pgs
  JOIN nhl_games g ON pgs.game_id = g.game_id
  LEFT JOIN player_directory pd ON pgs.player_id = pd.player_id
  WHERE g.game_type = 'playoff'
    AND g.season = p_season
    AND g.status IN ('live', 'in_progress', 'final')
  GROUP BY pgs.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO nhl_pipeline_meta (key, last_refresh)
  VALUES ('player_playoff_stats', NOW())
  ON CONFLICT (key) DO UPDATE SET last_refresh = NOW();

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."aggregate_player_playoff_stats_live"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_rink_adjustment"("p_season" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n bigint;
begin
  with m as (
    select s.game_id, s.event_id,
      kx0.v + (cx.cdf_mid*1000 - floor(cx.cdf_mid*1000)) * (kx1.v - kx0.v) as xa,
      ky0.v + (cy.cdf_mid*1000 - floor(cy.cdf_mid*1000)) * (ky1.v - ky0.v) as ya
    from nhl_shots s
    join nhl_game_arena a on a.game_id = s.game_id
    join nhl_rink_cdf cx on cx.coord='x' and cx.home_team=a.home_team and cx.season=s.season and cx.v = s.x_norm::int
    join nhl_rink_cdf cy on cy.coord='y' and cy.home_team=a.home_team and cy.season=s.season and cy.v = s.y_norm::int
    join nhl_rink_ref_knots kx0 on kx0.coord='x' and kx0.k = least(999, floor(cx.cdf_mid*1000)::int)
    join nhl_rink_ref_knots kx1 on kx1.coord='x' and kx1.k = least(999, floor(cx.cdf_mid*1000)::int)+1
    join nhl_rink_ref_knots ky0 on ky0.coord='y' and ky0.k = least(999, floor(cy.cdf_mid*1000)::int)
    join nhl_rink_ref_knots ky1 on ky1.coord='y' and ky1.k = least(999, floor(cy.cdf_mid*1000)::int)+1
    where s.season = p_season and s.x_norm is not null and s.y_norm is not null
  )
  update nhl_shots t set
     x_adj = m.xa,
     y_adj = m.ya,
     distance_adj = sqrt(power(89 - m.xa, 2) + power(m.ya, 2)),
     angle_adj = degrees(atan2(m.ya, 89 - m.xa))
  from m where t.game_id = m.game_id and t.event_id = m.event_id;
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."apply_rink_adjustment"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_rink_adjustment_live"("p_season" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n bigint;
begin
  with res as (
    select a.game_id, a.home_team, public.rink_cdf_season_for(a.home_team, a.season) as cdf_season
    from nhl_game_arena a where a.season = p_season
  ),
  m as (
    select s.game_id, s.event_id,
      kx0.v + (cx.cdf_mid*1000 - floor(cx.cdf_mid*1000)) * (kx1.v - kx0.v) as xa,
      ky0.v + (cy.cdf_mid*1000 - floor(cy.cdf_mid*1000)) * (ky1.v - ky0.v) as ya
    from nhl_shots s
    join res r on r.game_id = s.game_id and r.cdf_season is not null
    join nhl_rink_cdf cx on cx.coord='x' and cx.home_team=r.home_team and cx.season=r.cdf_season and cx.v=s.x_norm::int
    join nhl_rink_cdf cy on cy.coord='y' and cy.home_team=r.home_team and cy.season=r.cdf_season and cy.v=s.y_norm::int
    join nhl_rink_ref_knots kx0 on kx0.coord='x' and kx0.k=least(999, floor(cx.cdf_mid*1000)::int)
    join nhl_rink_ref_knots kx1 on kx1.coord='x' and kx1.k=least(999, floor(cx.cdf_mid*1000)::int)+1
    join nhl_rink_ref_knots ky0 on ky0.coord='y' and ky0.k=least(999, floor(cy.cdf_mid*1000)::int)
    join nhl_rink_ref_knots ky1 on ky1.coord='y' and ky1.k=least(999, floor(cy.cdf_mid*1000)::int)+1
    where s.season = p_season and s.x_norm is not null and s.y_norm is not null and s.distance_adj is null
  )
  update nhl_shots t set x_adj=m.xa, y_adj=m.ya,
    distance_adj = sqrt(power(89-m.xa,2)+power(m.ya,2)),
    angle_adj    = degrees(atan2(m.ya, 89-m.xa))
  from m where t.game_id=m.game_id and t.event_id=m.event_id;
  get diagnostics n = row_count; return n;
end $$;


ALTER FUNCTION "public"."apply_rink_adjustment_live"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_backup_before_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_backup_id UUID;
BEGIN
  -- Only create backup if deleting 10% or more of rows
  IF (SELECT COUNT(*) FROM team_lineups) * 0.1 <= 
     (SELECT COUNT(*) FROM team_lineups WHERE team_id = OLD.team_id) THEN
    
    v_backup_id := backup_team_lineups(
      'auto_before_delete_' || to_char(NOW(), 'YYYY-MM-DD_HH24:MI:SS'),
      'Auto-backup triggered by mass delete operation'
    );
    
    RAISE NOTICE 'Auto-backup created: %', v_backup_id;
  END IF;
  
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."auto_backup_before_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_complete_matchups"() RETURNS TABLE("updated_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_league_ids UUID[];
  league_id UUID;
  v_error_count INTEGER := 0;
BEGIN
  -- Get all unique league IDs for matchups that need to be completed
  -- Only get leagues where matchups have valid scores
  -- FIX: Use table alias 'm' to avoid ambiguous column reference with variable 'league_id'
  SELECT ARRAY_AGG(DISTINCT m.league_id) INTO v_league_ids
  FROM public.matchups m
  WHERE m.status IN ('scheduled', 'in_progress')
    AND m.week_end_date < CURRENT_DATE
    AND (
      (m.team2_id IS NULL AND m.team1_score > 0) OR
      (m.team2_id IS NOT NULL AND m.team1_score > 0 AND m.team2_score > 0)
    )
    AND m.league_id IS NOT NULL;  -- Ensure league_id is not null
  
  -- Update matchups to 'completed' status
  UPDATE public.matchups
  SET status = 'completed',
      updated_at = NOW()
  WHERE status IN ('scheduled', 'in_progress')
    AND week_end_date < CURRENT_DATE
    AND (
      (team2_id IS NULL AND team1_score > 0) OR
      (team2_id IS NOT NULL AND team1_score > 0 AND team2_score > 0)
    );
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  -- Update scores for all leagues that had matchups completed
  -- This ensures scores are current when matchups are marked as completed
  IF v_league_ids IS NOT NULL AND array_length(v_league_ids, 1) > 0 THEN
    FOREACH league_id IN ARRAY v_league_ids
    LOOP
      -- Update scores for this league (silently - don't fail if there's an error)
      BEGIN
        -- Verify league exists before attempting update
        IF EXISTS (SELECT 1 FROM leagues WHERE id = league_id) THEN
          PERFORM update_all_matchup_scores(league_id);
        ELSE
          RAISE WARNING 'League % does not exist, skipping score update', league_id;
          v_error_count := v_error_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Log error but don't fail the auto-complete operation
        v_error_count := v_error_count + 1;
        RAISE WARNING 'Error updating scores for league %: %', league_id, SQLERRM;
      END;
    END LOOP;
  END IF;
  
  -- Log summary if there were errors
  IF v_error_count > 0 THEN
    RAISE WARNING 'auto_complete_matchups completed with % score update errors', v_error_count;
  END IF;
  
  RETURN QUERY SELECT v_updated_count;
END;
$$;


ALTER FUNCTION "public"."auto_complete_matchups"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."auto_complete_matchups"() IS 'Automatically marks matchups as completed when the week has ended and scores are present. Also updates scores for affected leagues to ensure they are current. Returns the number of matchups updated.';



CREATE OR REPLACE FUNCTION "public"."auto_fix_integrity_issues"() RETURNS TABLE("fix_applied" "text", "teams_affected" integer, "players_restored" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_record RECORD;
  v_teams_fixed INTEGER := 0;
  v_players_fixed INTEGER := 0;
BEGIN
  RAISE NOTICE '[AUTO_FIX] Starting automatic integrity repairs...';

  -- Fix missing players (restore from draft_picks)
  FOR v_team_record IN
    SELECT DISTINCT
      t.id as team_id,
      t.team_name
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN team_lineups tl ON tl.team_id = t.id
    WHERE dp.deleted_at IS NULL
      AND NOT (
        tl.starters ? dp.player_id::text OR
        tl.bench    ? dp.player_id::text OR
        tl.ir       ? dp.player_id::text
      )
  LOOP
    -- Add missing players to bench.
    -- SL-1b (2026-08-06): concatenate the jsonb_agg array DIRECTLY into
    -- bench (no jsonb_build_array wrapper — that produced [[uuids]]).
    -- COALESCE guards the empty-input NULL from jsonb_agg (theoretical
    -- only under the outer FOR loop's guarantee; defense-in-depth).
    UPDATE team_lineups
    SET bench = bench || COALESCE(
      (SELECT jsonb_agg(dp.player_id::text)
       FROM draft_picks dp
       WHERE dp.team_id = v_team_record.team_id
         AND dp.deleted_at IS NULL
         AND NOT (
           team_lineups.starters ? dp.player_id::text OR
           team_lineups.bench    ? dp.player_id::text OR
           team_lineups.ir       ? dp.player_id::text
         )),
      '[]'::jsonb
    )
    WHERE team_id = v_team_record.team_id;

    GET DIAGNOSTICS v_players_fixed = ROW_COUNT;
    v_teams_fixed := v_teams_fixed + 1;

    RAISE NOTICE '[AUTO_FIX] Fixed % : restored missing players', v_team_record.team_name;
  END LOOP;

  IF v_teams_fixed > 0 THEN
    RETURN QUERY
    SELECT
      'restored_missing_players'::TEXT,
      v_teams_fixed,
      v_players_fixed;
  END IF;

  IF v_teams_fixed = 0 THEN
    RETURN QUERY
    SELECT
      'no_issues_found'::TEXT,
      0,
      0;
  END IF;

  RAISE NOTICE '[AUTO_FIX] Complete: % teams fixed, % players restored',
    v_teams_fixed, v_players_fixed;

END;
$$;


ALTER FUNCTION "public"."auto_fix_integrity_issues"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."auto_fix_integrity_issues"() IS 'Automatically repairs detected integrity issues.
Restores missing players from draft_picks to team_lineups.
SL-1 (2026-08-05): all jsonb `?` comparisons + jsonb_agg cast now use
  dp.player_id::text (fixed 22P02 uuid→integer crash).
SL-1b (2026-08-06): concatenate jsonb_agg array directly into bench
  (no jsonb_build_array wrapper). v1 shape was [[uuids]] which the ?
  operator cannot see through — this migration produces flat [uuids].
See KI-036 for scope + acceptance ladder.
Usage: SELECT * FROM auto_fix_integrity_issues();';



CREATE OR REPLACE FUNCTION "public"."auto_generate_playoff_bracket"("p_league_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_league RECORD;
  v_series_season INT;
  v_regular_weeks INT;
  v_incomplete_count INT;
  v_matchups_exist BOOLEAN;
  v_playoff_teams INT;
  v_result JSON;
BEGIN
  IF EXTRACT(MONTH FROM NOW()) >= 10 THEN
    v_series_season := EXTRACT(YEAR FROM NOW())::INT;
  ELSE
    v_series_season := (EXTRACT(YEAR FROM NOW()) - 1)::INT;
  END IF;

  SELECT l.*,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE((l.settings->>'autoPlayoffs')::BOOLEAN, TRUE) AS cfg_auto_playoffs,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN RETURN json_build_object('skipped', 'league_not_found'); END IF;
  IF v_league.cfg_league_type != 'fantasy' THEN RETURN json_build_object('skipped', 'not_fantasy'); END IF;
  IF NOT v_league.cfg_auto_playoffs THEN RETURN json_build_object('skipped', 'auto_disabled'); END IF;
  IF v_league.cfg_playoff_teams < 4 THEN RETURN json_build_object('skipped', 'playoffs_disabled'); END IF;
  IF v_league.draft_status != 'completed' THEN RETURN json_build_object('skipped', 'draft_not_completed'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id AND pb.season = v_series_season
  ) THEN
    RETURN json_build_object('skipped', 'bracket_already_exists');
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_weeks
    FROM public.matchups WHERE league_id = p_league_id;
  END IF;

  IF v_regular_weeks = 0 THEN RETURN json_build_object('skipped', 'no_matchups'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.matchups WHERE league_id = p_league_id AND week_number <= v_regular_weeks)
  INTO v_matchups_exist;
  IF NOT v_matchups_exist THEN RETURN json_build_object('skipped', 'no_regular_season_matchups'); END IF;

  SELECT COUNT(*) INTO v_incomplete_count
  FROM public.matchups
  WHERE league_id = p_league_id
    AND week_number <= v_regular_weeks
    AND LOWER(status) NOT IN ('completed', 'final');

  IF v_incomplete_count > 0 THEN
    RETURN json_build_object('skipped', 'regular_season_in_progress', 'remaining', v_incomplete_count);
  END IF;

  SELECT public.generate_playoff_bracket(
    p_league_id,
    COALESCE((v_league.settings->>'consolationBracket')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'twoWeekMatchups')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'reseedEachRound')::BOOLEAN, FALSE),
    COALESCE(v_league.settings->>'seedingMethod', 'standings')
  ) INTO v_result;

  RETURN json_build_object('generated', true, 'result', v_result);
END;
$$;


ALTER FUNCTION "public"."auto_generate_playoff_bracket"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."autopick_next_player"("p_league_id" "uuid", "p_team_id" "uuid", "p_draft_session_id" "uuid", "p_round_number" integer, "p_pick_number" integer) RETURNS TABLE("picked_player_id" integer, "player_name" "text", "position" "text", "pick_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_player RECORD; v_pick_id UUID; v_season INT;
  v_best_player_id INT; v_best_name TEXT; v_best_position TEXT;
BEGIN
  v_season := public.get_projection_target_season();

  SELECT COALESCE(apr.player_id, pd.player_id) AS pid, pd.full_name, pd.position_code
  INTO v_player
  FROM (
    SELECT player_id, rank_position FROM player_autopick_rankings
     WHERE league_id = p_league_id AND team_id = p_team_id
    UNION ALL
    SELECT player_id, rank_position + 10000 FROM player_autopick_rankings
     WHERE league_id = p_league_id AND team_id IS NULL
    UNION ALL
    SELECT player_id, rank_position + 20000 FROM player_autopick_rankings
     WHERE league_id IS NULL AND team_id IS NULL
    UNION ALL
    -- Same source and ordering as autopickStrategy.ts projectionsStrategy.
    SELECT rp.player_id,
           (30000 + ROW_NUMBER() OVER (
              ORDER BY rp.total_projected_points DESC NULLS LAST, rp.player_id))::INT
      FROM player_ros_projections rp
     WHERE rp.season = v_season
       AND NOT EXISTS (SELECT 1 FROM player_autopick_rankings r
                        WHERE r.player_id = rp.player_id)
  ) apr
  JOIN player_directory pd ON pd.player_id = apr.player_id AND pd.season = v_season
  WHERE NOT EXISTS (
    SELECT 1 FROM draft_picks dp
     WHERE dp.league_id = p_league_id
       AND dp.draft_session_id = p_draft_session_id
       AND dp.player_id = apr.player_id::TEXT
       AND dp.deleted_at IS NULL
  )
  ORDER BY apr.rank_position ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'No available players for autopick in league % (season %)', p_league_id, v_season;
    RETURN;
  END IF;

  v_best_player_id := v_player.pid;
  v_best_name := v_player.full_name;
  v_best_position := v_player.position_code;

  INSERT INTO draft_picks (league_id, team_id, player_id, round_number, pick_number,
                           draft_session_id, picked_at)
  VALUES (p_league_id, p_team_id, v_best_player_id::TEXT, p_round_number, p_pick_number,
          p_draft_session_id, NOW())
  RETURNING id INTO v_pick_id;

  RETURN QUERY SELECT v_best_player_id, v_best_name, v_best_position, v_pick_id;
END $$;


ALTER FUNCTION "public"."autopick_next_player"("p_league_id" "uuid", "p_team_id" "uuid", "p_draft_session_id" "uuid", "p_round_number" integer, "p_pick_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backtest_inseason_weight"("p_season" integer, "p_asof" "date", "p_w" numeric, "p_min_holdout_gp" integer DEFAULT 10) RETURNS TABLE("n_players" integer, "rmse" numeric, "mae" numeric, "corr" numeric, "mean_actual" numeric, "mean_pred" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH hist AS (
    SELECT pgs.player_id,
           substring(pgs.game_id::text,1,4)::int AS season,
           bool_or(pgs.is_goalie) AS is_goalie,
           count(*)::numeric gp,
           sum(pgs.nhl_goals)::numeric g,    sum(pgs.nhl_assists)::numeric a,
           sum(pgs.nhl_shots_on_goal)::numeric sog, sum(pgs.nhl_blocks)::numeric blk,
           sum(pgs.nhl_ppp)::numeric ppp,    sum(pgs.nhl_shp)::numeric shp,
           sum(pgs.nhl_hits)::numeric hits,  sum(pgs.nhl_pim)::numeric pim
      FROM player_game_stats pgs
     WHERE substring(pgs.game_id::text,5,2) = '02'
       AND substring(pgs.game_id::text,1,4)::int BETWEEN p_season-3 AND p_season
       AND (substring(pgs.game_id::text,1,4)::int < p_season OR pgs.game_date <= p_asof)
     GROUP BY 1,2
  ),
  w AS (
    SELECT h.*,
           (CASE p_season - h.season
              WHEN 0 THEN p_w WHEN 1 THEN 5.0 WHEN 2 THEN 3.0 ELSE 2.0 END)::numeric wt
      FROM hist h
  ),
  agg AS (
    SELECT player_id, bool_or(is_goalie) is_goalie,
           sum(wt*gp) wgp, sum(wt*g) wg, sum(wt*a) wa, sum(wt*sog) wsog,
           sum(wt*blk) wblk, sum(wt*ppp) wppp, sum(wt*shp) wshp,
           sum(wt*hits) whits, sum(wt*pim) wpim, sum(gp) raw_gp
      FROM w GROUP BY 1
  ),
  bd AS (SELECT DISTINCT ON (player_id) player_id, birthdate
           FROM player_directory WHERE birthdate IS NOT NULL ORDER BY player_id, season DESC),
  grp AS (
    SELECT a.*,
           coalesce((SELECT pd.position_code FROM player_directory pd
                      WHERE pd.player_id=a.player_id ORDER BY pd.season DESC LIMIT 1),'C') AS position_code,
           extract(year FROM age(make_date(p_season,10,1), bd.birthdate))::int AS age
      FROM agg a LEFT JOIN bd ON bd.player_id=a.player_id
  ),
  grp2 AS (
    SELECT g.*, CASE WHEN g.position_code='D' THEN 'D' ELSE 'F' END AS pos_group,
           public.get_age_multiplier(g.age) AS am
      FROM grp g WHERE NOT g.is_goalie
  ),
  means AS (
    SELECT pos_group,
           sum(wg)/nullif(sum(wgp),0) m_goal, sum(wa)/nullif(sum(wgp),0) m_a,
           sum(wsog)/nullif(sum(wgp),0) m_sog, sum(wblk)/nullif(sum(wgp),0) m_blk,
           sum(wppp)/nullif(sum(wgp),0) m_ppp, sum(wshp)/nullif(sum(wgp),0) m_shp,
           sum(whits)/nullif(sum(wgp),0) m_hits, sum(wpim)/nullif(sum(wgp),0) m_pim
      FROM grp2 WHERE raw_gp >= 20 GROUP BY 1
  ),
  pred AS (
    SELECT g.player_id,
           ( ((g.wg   + 20*m.m_goal)/(g.wgp+20)  * g.am) * 3.0
           + ((g.wa   + 10*m.m_a)   /(g.wgp+10)  * g.am) * 2.0
           + ((g.wppp + 10*m.m_ppp) /(g.wgp+10)  * g.am) * 1.0
           + ((g.wshp + 10*m.m_shp) /(g.wgp+10)  * g.am) * 2.0
           + ((g.wsog + 10*m.m_sog) /(g.wgp+10)  * g.am) * 0.4
           + ((g.wblk + 15*m.m_blk) /(g.wgp+15)  * g.am) * 0.5
           + ((g.whits+  8*m.m_hits)/(g.wgp+8)   * g.am) * 0.2
           + ((g.wpim + 20*m.m_pim) /(g.wgp+20)  * g.am) * 0.5 ) AS pred_fppg
      FROM grp2 g JOIN means m ON m.pos_group=g.pos_group
     WHERE g.raw_gp >= 1
  ),
  actual AS (
    SELECT pgs.player_id, count(*)::numeric hold_gp,
           ( sum(pgs.nhl_goals)*3.0 + sum(pgs.nhl_assists)*2.0 + sum(pgs.nhl_ppp)*1.0
           + sum(pgs.nhl_shp)*2.0 + sum(pgs.nhl_shots_on_goal)*0.4 + sum(pgs.nhl_blocks)*0.5
           + sum(pgs.nhl_hits)*0.2 + sum(pgs.nhl_pim)*0.5 ) / count(*)::numeric AS act_fppg
      FROM player_game_stats pgs
     WHERE substring(pgs.game_id::text,5,2)='02'
       AND substring(pgs.game_id::text,1,4)::int = p_season
       AND pgs.game_date > p_asof
       AND NOT pgs.is_goalie
     GROUP BY 1
    HAVING count(*) >= p_min_holdout_gp
  ),
  j AS (SELECT a.player_id, a.hold_gp, a.act_fppg, p.pred_fppg
          FROM actual a JOIN pred p ON p.player_id=a.player_id)
  SELECT count(*)::int,
         round(sqrt(sum(hold_gp*power(pred_fppg-act_fppg,2))/nullif(sum(hold_gp),0))::numeric,5),
         round((sum(hold_gp*abs(pred_fppg-act_fppg))/nullif(sum(hold_gp),0))::numeric,5),
         round(corr(pred_fppg, act_fppg)::numeric,4),
         round(avg(act_fppg)::numeric,4), round(avg(pred_fppg)::numeric,4)
    FROM j;
$$;


ALTER FUNCTION "public"."backtest_inseason_weight"("p_season" integer, "p_asof" "date", "p_w" numeric, "p_min_holdout_gp" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backup_team_lineups"("p_backup_name" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_backup_id UUID;
  v_backup_data JSONB;
  v_team_count INTEGER;
  v_player_count INTEGER;
BEGIN
  -- Generate default backup name if not provided
  IF p_backup_name IS NULL THEN
    p_backup_name := 'auto_backup_' || to_char(NOW(), 'YYYY-MM-DD_HH24:MI:SS');
  END IF;
  
  -- Create backup data
  SELECT jsonb_agg(row_to_json(tl))
  INTO v_backup_data
  FROM team_lineups tl;
  
  -- Calculate stats
  SELECT COUNT(*) INTO v_team_count FROM team_lineups;
  
  SELECT SUM(
    jsonb_array_length(COALESCE(starters, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(bench, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(ir, '[]'::jsonb))
  )
  INTO v_player_count
  FROM team_lineups;
  
  -- Insert backup
  INSERT INTO team_lineups_backup_log (
    backup_name,
    backup_data,
    team_count,
    player_count,
    notes
  )
  VALUES (
    p_backup_name,
    v_backup_data,
    v_team_count,
    v_player_count,
    p_notes
  )
  RETURNING id INTO v_backup_id;
  
  RAISE NOTICE 'Backup created: % (ID: %, % teams, % players)', 
    p_backup_name, v_backup_id, v_team_count, v_player_count;
  
  RETURN v_backup_id;
END;
$$;


ALTER FUNCTION "public"."backup_team_lineups"("p_backup_name" "text", "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."backup_team_lineups"("p_backup_name" "text", "p_notes" "text") IS 'Creates a backup snapshot of team_lineups. Returns backup ID for restore.
Usage: SELECT backup_team_lineups(''before_migration'', ''Safety backup before destructive operation'');';



CREATE OR REPLACE FUNCTION "public"."build_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric DEFAULT 40) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
declare r0 double precision; tot bigint; lv int;
begin
  if p_slot in (0,1,2,3,4,20) then raise exception 'slot % is a production fold', p_slot; end if;
  if p_pfx not in ('a','b','x') then raise exception 'bad ladder %', p_pfx; end if;
  delete from public.nhl_xg_sql_cells where fold = p_slot;
  execute format('create temp table _e on commit drop as
     select is_goal, %1$s1 k1, %1$s2 k2, %1$s3 k3, %1$s4 k4, %1$s5 k5
       from public.nhl_xg_sql_keys_exp where season between %2$s and %3$s',
     p_pfx, p_season_lo, p_season_hi);
  select avg(is_goal::int) into r0 from _e;
  insert into public.nhl_xg_sql_cells values
    (p_slot, 0, 'ALL', (select count(*) from _e),
     (select count(*) filter (where is_goal) from _e), r0);
  insert into public.nhl_xg_sql_cells
  select p_slot, 1, k1, count(*), count(*) filter (where is_goal),
         (count(*) filter (where is_goal) + p_m*r0)/(count(*) + p_m) from _e group by k1;
  for lv in 2..5 loop
    execute format($f$insert into public.nhl_xg_sql_cells
      select %1$s, %2$s, t.child, t.n, t.kk, (t.kk + %3$s*p.rate)/(t.n + %3$s)
        from (select k%4$s parent, k%2$s child, count(*) n,
                     count(*) filter (where is_goal) kk from _e group by 1,2) t
        join public.nhl_xg_sql_cells p on p.fold=%1$s and p.lvl=%4$s and p.ckey=t.parent$f$,
      p_slot, lv, p_m, lv-1);
  end loop;
  select count(*) into tot from public.nhl_xg_sql_cells where fold=p_slot;
  return tot;
end $_$;


ALTER FUNCTION "public"."build_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."build_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) IS 'Experiment rig for xG feature work. Trains the hierarchical shrinkage cell model into a NON-production fold slot (refuses 0-4 and 20) over a chosen key ladder: x = production, a/b = speed-as-context variants in nhl_xg_sql_keys_exp. Pair with eval_xg_exp2 for a forward holdout. Built 2026-08-12 to test pre-shot speed; kept so any future feature can be judged in minutes instead of argued about.';



CREATE OR REPLACE FUNCTION "public"."build_xg_sql_fold"("p_score_fold" integer, "p_m" numeric DEFAULT 40) RETURNS TABLE("o_lvl" integer, "o_cells" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r0 double precision;
begin
  delete from nhl_xg_sql_cells where fold = p_score_fold;

  create temp table _f on commit drop as
  select is_goal,
    case when f_en_for then 'E|'||dbc else 'G|'||db||'|'||ab end as k1,
    case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type end as k2,
    case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type||'|'||ctx end as k3,
    case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type||'|'||ctx||'|'||strc end as k4
  from nhl_xg_sql_keys where fold_id <> p_score_fold;

  select avg(is_goal::int) into r0 from _f;
  insert into nhl_xg_sql_cells values
    (p_score_fold, 0, 'ALL', (select count(*) from _f), (select count(*) filter (where is_goal) from _f), r0);

  insert into nhl_xg_sql_cells
  select p_score_fold, 1, k1, count(*), count(*) filter (where is_goal),
         (count(*) filter (where is_goal) + p_m*r0)/(count(*) + p_m) from _f group by k1;

  insert into nhl_xg_sql_cells
  select p_score_fold, 2, t.k2, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
  from (select k1, k2, count(*) n, count(*) filter (where is_goal) kk from _f group by 1,2) t
  join nhl_xg_sql_cells p on p.fold=p_score_fold and p.lvl=1 and p.ckey=t.k1;

  insert into nhl_xg_sql_cells
  select p_score_fold, 3, t.k3, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
  from (select k2, k3, count(*) n, count(*) filter (where is_goal) kk from _f group by 1,2) t
  join nhl_xg_sql_cells p on p.fold=p_score_fold and p.lvl=2 and p.ckey=t.k2;

  insert into nhl_xg_sql_cells
  select p_score_fold, 4, t.k4, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
  from (select k3, k4, count(*) n, count(*) filter (where is_goal) kk from _f group by 1,2) t
  join nhl_xg_sql_cells p on p.fold=p_score_fold and p.lvl=3 and p.ckey=t.k3;

  return query select c.lvl::int, count(*) from nhl_xg_sql_cells c where c.fold=p_score_fold group by c.lvl order by 1;
end $$;


ALTER FUNCTION "public"."build_xg_sql_fold"("p_score_fold" integer, "p_m" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."build_xg_sql_fold"("p_score_fold" integer, "p_m" numeric) IS 'DEPRECATED -- builds only 4 levels on an older key ladder with no royal-road term. The shipped model is 5 levels; use build_xg_sql_slot(slot, ''fold'', null, null, 40) for a cross-fit fold and build_xg_sql_slot(20, ''range'', 2017, 2025, 40) for the all-data slot. Kept for provenance only. Verified 2026-08-12 that nothing calls it.';



CREATE OR REPLACE FUNCTION "public"."build_xg_sql_slot"("p_slot" integer, "p_mode" "text", "p_lo" integer DEFAULT 2017, "p_hi" integer DEFAULT 2025, "p_m" numeric DEFAULT 40) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r0 double precision; tot bigint;
begin
  delete from nhl_xg_sql_cells where fold = p_slot;
  drop table if exists _t;
  create temp table _t as
  select k.is_goal, k.k1, k.k2, k.k3, k.k4, k.k5
  from nhl_xg_sql_keys k
  left join nhl_shot_fold fo on fo.game_id = k.game_id and fo.event_id = k.event_id
  where (p_mode = 'range' and k.season between p_lo and p_hi)
     or (p_mode = 'fold'  and k.season between 2017 and 2025 and fo.fold_id <> p_slot);

  select avg(is_goal::int) into r0 from _t;
  insert into nhl_xg_sql_cells values
    (p_slot, 0, 'ALL', (select count(*) from _t), (select count(*) filter (where is_goal) from _t), r0);
  insert into nhl_xg_sql_cells
    select p_slot, 1, k1, count(*), count(*) filter (where is_goal),
           (count(*) filter (where is_goal) + p_m*r0)/(count(*) + p_m) from _t group by k1;
  insert into nhl_xg_sql_cells
    select p_slot, 2, t.k2, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k1,k2,count(*) n,count(*) filter (where is_goal) kk from _t group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=1 and p.ckey=t.k1;
  insert into nhl_xg_sql_cells
    select p_slot, 3, t.k3, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k2,k3,count(*) n,count(*) filter (where is_goal) kk from _t group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=2 and p.ckey=t.k2;
  insert into nhl_xg_sql_cells
    select p_slot, 4, t.k4, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k3,k4,count(*) n,count(*) filter (where is_goal) kk from _t group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=3 and p.ckey=t.k3;
  insert into nhl_xg_sql_cells
    select p_slot, 5, t.k5, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k4,k5,count(*) n,count(*) filter (where is_goal) kk from _t group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=4 and p.ckey=t.k4;
  select count(*) into tot from nhl_xg_sql_cells where fold=p_slot;
  return tot;
end $$;


ALTER FUNCTION "public"."build_xg_sql_slot"("p_slot" integer, "p_mode" "text", "p_lo" integer, "p_hi" integer, "p_m" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."build_xg_sql_slot"("p_slot" integer, "p_mode" "text", "p_lo" integer, "p_hi" integer, "p_m" numeric) IS 'THE production xG trainer. 5-level hierarchical shrinkage cell model over nhl_xg_sql_keys, m=40 (verified against the shipped cells: implied m = 40.00 exactly across 468 level-1 cells). mode=''fold'' trains on 2017-2025 excluding one cross-fit fold; mode=''range'' trains on a season range for the all-data slot 20. Full retrain runbook: five fold slots, then slot 20, then score_xg_sql_v2 per season, then refresh_xg_season_layer per season, then rebuild_goalie_gsax_primary(). Accept test: public.xg_scorecard().';



CREATE OR REPLACE FUNCTION "public"."build_xg_sql_variant"("p_slot" integer, "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric DEFAULT 40) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r0 double precision; tot bigint;
begin
  delete from nhl_xg_sql_cells where fold = p_slot;

  create temp table _v on commit drop as
  select is_goal,
    case when f_en_for then 'E|'||dbc else 'G|'||db||'|'||ab end as k1,
    case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type end as k2,
    case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type||'|'||ctx end as k3,
    case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type||'|'||ctx||'|'||strc end as k4
  from nhl_xg_sql_keys where season between p_season_lo and p_season_hi;

  select avg(is_goal::int) into r0 from _v;
  insert into nhl_xg_sql_cells values
    (p_slot, 0, 'ALL', (select count(*) from _v), (select count(*) filter (where is_goal) from _v), r0);
  insert into nhl_xg_sql_cells
    select p_slot, 1, k1, count(*), count(*) filter (where is_goal),
           (count(*) filter (where is_goal) + p_m*r0)/(count(*) + p_m) from _v group by k1;
  insert into nhl_xg_sql_cells
    select p_slot, 2, t.k2, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k1,k2,count(*) n,count(*) filter (where is_goal) kk from _v group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=1 and p.ckey=t.k1;
  insert into nhl_xg_sql_cells
    select p_slot, 3, t.k3, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k2,k3,count(*) n,count(*) filter (where is_goal) kk from _v group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=2 and p.ckey=t.k2;
  insert into nhl_xg_sql_cells
    select p_slot, 4, t.k4, t.n, t.kk, (t.kk + p_m*p.rate)/(t.n + p_m)
    from (select k3,k4,count(*) n,count(*) filter (where is_goal) kk from _v group by 1,2) t
    join nhl_xg_sql_cells p on p.fold=p_slot and p.lvl=3 and p.ckey=t.k3;
  select count(*) into tot from nhl_xg_sql_cells where fold=p_slot;
  return tot;
end $$;


ALTER FUNCTION "public"."build_xg_sql_variant"("p_slot" integer, "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
  v_before_count INTEGER;
  v_after_count INTEGER;
  v_error_detail TEXT;
BEGIN
  -- VALIDATION
  IF NEW.league_id IS NULL THEN
    RAISE WARNING '[SYNC] league_id is NULL for team %, skipping sync', NEW.team_id;
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NULL THEN
    RAISE WARNING '[SYNC] team_id is NULL, skipping sync';
    RETURN NEW;
  END IF;

  -- Find current/future matchup for this team
  SELECT m.id, m.week_start_date, m.week_end_date
  INTO v_matchup_id, v_week_start, v_week_end
  FROM matchups m
  WHERE m.league_id = NEW.league_id
    AND (m.team1_id = NEW.team_id OR m.team2_id = NEW.team_id)
    AND m.week_end_date >= v_today
  ORDER BY m.week_start_date ASC
  LIMIT 1;

  IF v_matchup_id IS NULL THEN
    RAISE NOTICE '[SYNC] No current/future matchup for team %, skipping sync', NEW.team_id;
    RETURN NEW;
  END IF;

  -- Count current entries before sync
  SELECT COUNT(*) INTO v_before_count
  FROM fantasy_daily_rosters
  WHERE team_id = NEW.team_id
    AND matchup_id = v_matchup_id
    AND is_locked = false;

  RAISE NOTICE '[SYNC] Starting sync for team % in matchup % (% unlocked entries before)',
    NEW.team_id, v_matchup_id, v_before_count;

  BEGIN
    -- Delete existing daily roster entries for FUTURE dates ONLY
    -- CRITICAL: Uses > not >= to preserve TODAY's data
    DELETE FROM fantasy_daily_rosters
    WHERE team_id = NEW.team_id
      AND matchup_id = v_matchup_id
      AND roster_date > v_today
      AND is_locked = false;

    -- =======================================================================
    -- Insert starters for ALL dates (past included, ON CONFLICT DO NOTHING
    -- for past locked entries, DO UPDATE for today/future)
    -- =======================================================================
    -- Past dates: ON CONFLICT DO NOTHING (preserve locked state)
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.starters)::integer),
      d.roster_date,
      'active',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.starters)::text),
      d.roster_date < v_today  -- Lock past dates on insert
    FROM generate_series(v_week_start, v_today - INTERVAL '1 day', '1 day'::interval) AS d(roster_date)
    WHERE NEW.starters IS NOT NULL
      AND jsonb_array_length(NEW.starters) > 0
      AND v_week_start < v_today  -- Only if there are past dates
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

    -- Today + future dates: ON CONFLICT DO UPDATE (allow lineup changes)
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.starters)::integer),
      d.roster_date,
      'active',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.starters)::text),
      false
    FROM generate_series(
      GREATEST(v_today, v_week_start),
      v_week_end,
      '1 day'::interval
    ) AS d(roster_date)
    WHERE NEW.starters IS NOT NULL
      AND jsonb_array_length(NEW.starters) > 0
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
    SET
      slot_type = EXCLUDED.slot_type,
      slot_id = EXCLUDED.slot_id,
      updated_at = NOW();

    -- =======================================================================
    -- Bench: same pattern (past DO NOTHING, today+future DO UPDATE)
    -- =======================================================================
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.bench)::integer),
      d.roster_date,
      'bench',
      NULL,
      d.roster_date < v_today
    FROM generate_series(v_week_start, v_today - INTERVAL '1 day', '1 day'::interval) AS d(roster_date)
    WHERE NEW.bench IS NOT NULL
      AND jsonb_array_length(NEW.bench) > 0
      AND v_week_start < v_today
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.bench)::integer),
      d.roster_date,
      'bench',
      NULL,
      false
    FROM generate_series(
      GREATEST(v_today, v_week_start),
      v_week_end,
      '1 day'::interval
    ) AS d(roster_date)
    WHERE NEW.bench IS NOT NULL
      AND jsonb_array_length(NEW.bench) > 0
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
    SET
      slot_type = EXCLUDED.slot_type,
      updated_at = NOW();

    -- =======================================================================
    -- IR: same pattern
    -- =======================================================================
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.ir)::integer),
      d.roster_date,
      'ir',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.ir)::text),
      d.roster_date < v_today
    FROM generate_series(v_week_start, v_today - INTERVAL '1 day', '1 day'::interval) AS d(roster_date)
    WHERE NEW.ir IS NOT NULL
      AND jsonb_array_length(NEW.ir) > 0
      AND v_week_start < v_today
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.ir)::integer),
      d.roster_date,
      'ir',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.ir)::text),
      false
    FROM generate_series(
      GREATEST(v_today, v_week_start),
      v_week_end,
      '1 day'::interval
    ) AS d(roster_date)
    WHERE NEW.ir IS NOT NULL
      AND jsonb_array_length(NEW.ir) > 0
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
    SET
      slot_type = EXCLUDED.slot_type,
      slot_id = EXCLUDED.slot_id,
      updated_at = NOW();

    -- POST-SYNC VALIDATION
    SELECT COUNT(*) INTO v_after_count
    FROM fantasy_daily_rosters
    WHERE team_id = NEW.team_id
      AND matchup_id = v_matchup_id;

    RAISE NOTICE '[SYNC] Sync complete for team % (% total entries, % before)',
      NEW.team_id, v_after_count, v_before_count;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_detail = MESSAGE_TEXT;
      RAISE WARNING '[SYNC] ERROR during sync for team %: %',
        NEW.team_id, v_error_detail;
      RAISE;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() IS 'Auto-sync trigger function. Syncs team_lineups changes to fantasy_daily_rosters. FIX: Now also backfills past dates in the matchup week using ON CONFLICT DO NOTHING (preserving locked entries). Ensures AI teams and late-joining teams get full-week coverage. Today + future dates use ON CONFLICT DO UPDATE to reflect lineup changes.';



CREATE OR REPLACE FUNCTION "public"."calculate_daily_matchup_scores"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") RETURNS TABLE("roster_date" "date", "daily_score" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_date DATE;
  v_score NUMERIC(10, 3);
  v_league_id UUID;
  v_goalie_wins_weight NUMERIC(10, 3) := 4.0;
  v_goalie_saves_weight NUMERIC(10, 3) := 0.2;
  v_goalie_shutouts_weight NUMERIC(10, 3) := 3.0;
  v_goalie_ga_weight NUMERIC(10, 3) := -1.0;
  v_skater_goals_weight NUMERIC(10, 3) := 3.0;
  v_skater_assists_weight NUMERIC(10, 3) := 2.0;
  v_skater_ppp_weight NUMERIC(10, 3) := 1.0;
  v_skater_shp_weight NUMERIC(10, 3) := 2.0;
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.5;
  v_skater_hits_weight NUMERIC(10, 3) := 0.2;
  v_skater_pim_weight NUMERIC(10, 3) := 0.5;
  v_scoring_settings JSONB;
BEGIN
  SELECT m.league_id, l.scoring_settings
  INTO v_league_id, v_scoring_settings
  FROM matchups m
  LEFT JOIN leagues l ON m.league_id = l.id
  WHERE m.id = p_matchup_id;

  IF v_scoring_settings IS NOT NULL THEN
    IF v_scoring_settings->'goalie' IS NOT NULL THEN
      v_goalie_wins_weight     := COALESCE((v_scoring_settings->'goalie'->>'wins')::numeric, 4.0);
      v_goalie_saves_weight    := COALESCE((v_scoring_settings->'goalie'->>'saves')::numeric, 0.2);
      v_goalie_shutouts_weight := COALESCE((v_scoring_settings->'goalie'->>'shutouts')::numeric, 3.0);
      v_goalie_ga_weight       := COALESCE((v_scoring_settings->'goalie'->>'goals_against')::numeric, -1.0);
    END IF;
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_skater_goals_weight   := COALESCE((v_scoring_settings->'skater'->>'goals')::numeric, 3.0);
      v_skater_assists_weight := COALESCE((v_scoring_settings->'skater'->>'assists')::numeric, 2.0);
      v_skater_ppp_weight     := COALESCE((v_scoring_settings->'skater'->>'power_play_points')::numeric, 1.0);
      v_skater_shp_weight     := COALESCE((v_scoring_settings->'skater'->>'short_handed_points')::numeric, 2.0);
      v_skater_sog_weight     := COALESCE((v_scoring_settings->'skater'->>'shots_on_goal')::numeric, 0.4);
      v_skater_blocks_weight  := COALESCE((v_scoring_settings->'skater'->>'blocks')::numeric, 0.5);
      v_skater_hits_weight    := COALESCE((v_scoring_settings->'skater'->>'hits')::numeric, 0.2);
      v_skater_pim_weight     := COALESCE((v_scoring_settings->'skater'->>'penalty_minutes')::numeric, 0.5);
    END IF;
  END IF;

  FOR v_date IN
    SELECT generate_series(p_week_start, p_week_end, '1 day'::interval)::DATE
  LOOP
    SELECT COALESCE(SUM(
      CASE
        WHEN COALESCE(pd.is_goalie, pgs.is_goalie, false)
          OR COALESCE(pd.position_code, '') = 'G' THEN
          (COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) * v_goalie_wins_weight) +
          (COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) * v_goalie_saves_weight) +
          (COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) * v_goalie_shutouts_weight) +
          (COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) * v_goalie_ga_weight)
        ELSE
          (COALESCE(pgs.nhl_goals, pgs.goals, 0) * v_skater_goals_weight) +
          (COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) * v_skater_assists_weight) +
          (COALESCE(pgs.nhl_ppp, pgs.ppp, 0) * v_skater_ppp_weight) +
          (COALESCE(pgs.nhl_shp, pgs.shp, 0) * v_skater_shp_weight) +
          (COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) * v_skater_sog_weight) +
          (COALESCE(pgs.nhl_blocks, pgs.blocks, 0) * v_skater_blocks_weight) +
          (COALESCE(pgs.nhl_hits, pgs.hits, 0) * v_skater_hits_weight) +
          (COALESCE(pgs.nhl_pim, pgs.pim, 0) * v_skater_pim_weight)
      END
    ), 0) INTO v_score
    FROM fantasy_daily_rosters fdr
    INNER JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      AND pgs.game_date = v_date
    INNER JOIN nhl_games g_reg ON g_reg.game_id = pgs.game_id
      AND g_reg.game_type = 'regular'
    -- 0F-SCORE-2: season comes from the GAME being scored, never the calendar.
    LEFT JOIN player_directory pd ON fdr.player_id = pd.player_id
      AND pd.season = substring(pgs.game_id::text from 1 for 4)::int
    WHERE fdr.matchup_id = p_matchup_id
      AND fdr.team_id = p_team_id
      AND fdr.roster_date = v_date
      AND fdr.slot_type = 'active';

    RETURN QUERY SELECT v_date, COALESCE(v_score, 0);
  END LOOP;

  RETURN;
END;
$$;


ALTER FUNCTION "public"."calculate_daily_matchup_scores"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_daily_matchup_scores"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") IS 'Calculates daily fantasy scores using ALL 8 stat categories (Sunday-Saturday weeks). Uses fantasy_daily_rosters to determine active players each day, then sums NHL official stats. Returns 7 daily scores (Sun-Sat).';



CREATE OR REPLACE FUNCTION "public"."calculate_daily_matchup_scores_v2"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") RETURNS TABLE("roster_date" "date", "daily_score" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select d::date as roster_date,
         coalesce((select round(sum(sl.points),3)
                     from public.score_matchup_lines(p_matchup_id,p_team_id,p_week_start,p_week_end) sl
                    where sl.roster_date = d::date), 0) as daily_score
    from generate_series(p_week_start, p_week_end, '1 day'::interval) d;
$$;


ALTER FUNCTION "public"."calculate_daily_matchup_scores_v2"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_h2h_category_matchup"("p_league_id" "uuid", "p_matchup_id" "uuid", "p_team1_id" "uuid", "p_team2_id" "uuid", "p_week_start" "date", "p_week_end" "date", "p_categories" "text"[]) RETURNS TABLE("category" "text", "team1_value" numeric, "team2_value" numeric, "winner" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    v_higher_is_better := v_cat NOT IN ('gaa', 'goals_against');

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
      AND ng.game_type = 'regular'
      AND CASE
        WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
          THEN pgs.is_goalie = true
        ELSE pgs.is_goalie = false
      END;

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
      AND ng.game_type = 'regular'
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
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date
        AND ng.game_type = 'regular';

      SELECT COUNT(DISTINCT ng.game_id) INTO v_t2_gp
      FROM fantasy_daily_rosters fdr
      JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      JOIN nhl_games ng ON pgs.game_id = ng.game_id
      WHERE fdr.matchup_id = p_matchup_id AND fdr.team_id = p_team2_id
        AND fdr.roster_date >= p_week_start AND fdr.roster_date <= p_week_end
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date
        AND ng.game_type = 'regular';

      v_t1 := CASE WHEN v_t1_gp > 0 THEN v_t1 / v_t1_gp ELSE 0 END;
      v_t2 := CASE WHEN v_t2_gp > 0 THEN v_t2 / v_t2_gp ELSE 0 END;
    END IF;

    -- For save_pct, recompute as proper weighted average
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
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date
        AND ng.game_type = 'regular';

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
        AND fdr.slot_type = 'active' AND pgs.is_goalie = true AND ng.game_date = fdr.roster_date
        AND ng.game_type = 'regular';
    END IF;

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
$$;


ALTER FUNCTION "public"."calculate_h2h_category_matchup"("p_league_id" "uuid", "p_matchup_id" "uuid", "p_team1_id" "uuid", "p_team2_id" "uuid", "p_week_start" "date", "p_week_end" "date", "p_categories" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_implied_probability"("moneyline" integer) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF moneyline IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Favorite (negative moneyline, e.g., -150)
  IF moneyline < 0 THEN
    RETURN ABS(moneyline)::NUMERIC / (ABS(moneyline) + 100)::NUMERIC;
  -- Underdog (positive moneyline, e.g., +130)
  ELSE
    RETURN 100::NUMERIC / (moneyline + 100)::NUMERIC;
  END IF;
END;
$$;


ALTER FUNCTION "public"."calculate_implied_probability"("moneyline" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_matchup_total_score"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total_score NUMERIC(10, 3) := 0;
BEGIN
  -- Sum all 7 daily scores from calculate_daily_matchup_scores
  -- This is the EXACT same calculation used in the matchup tab
  SELECT COALESCE(SUM(daily_score), 0) INTO v_total_score
  FROM calculate_daily_matchup_scores(p_matchup_id, p_team_id, p_week_start, p_week_end);
  
  RETURN v_total_score;
END;
$$;


ALTER FUNCTION "public"."calculate_matchup_total_score"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_matchup_total_score"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") IS 'Calculates total matchup score for a team by summing 7 daily scores from calculate_daily_matchup_scores RPC. Uses EXACT same logic as matchup tab. Ensures all matchups (user teams AND AI teams) use identical calculation.';



CREATE OR REPLACE FUNCTION "public"."calculate_ppg_standings"("p_league_id" "uuid", "p_through_week" integer DEFAULT NULL::integer) RETURNS TABLE("team_id" "uuid", "team_name" "text", "total_points" numeric, "games_played" integer, "ppg" numeric, "rank" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH team_weekly_scores AS (
    -- Get each team's weekly total from matchups
    SELECT
      t.id AS tid,
      t.team_name AS tname,
      m.week_number,
      CASE
        WHEN m.team1_id = t.id THEN m.team1_score
        WHEN m.team2_id = t.id THEN m.team2_score
        ELSE 0
      END AS weekly_score,
      CASE
        WHEN m.status = 'completed' THEN 1
        ELSE 0
      END AS week_played
    FROM teams t
    JOIN matchups m ON m.league_id = t.league_id
      AND (m.team1_id = t.id OR m.team2_id = t.id)
      AND m.status = 'completed'
      AND (p_through_week IS NULL OR m.week_number <= p_through_week)
    WHERE t.league_id = p_league_id
  ),
  team_totals AS (
    SELECT
      tid,
      tname,
      COALESCE(SUM(weekly_score), 0) AS total_pts,
      COALESCE(SUM(week_played), 0) AS gp
    FROM team_weekly_scores
    GROUP BY tid, tname
  )
  SELECT
    tt.tid,
    tt.tname,
    ROUND(tt.total_pts, 2),
    tt.gp::INT,
    CASE WHEN tt.gp > 0
      THEN ROUND(tt.total_pts / tt.gp, 3)
      ELSE 0
    END,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN tt.gp > 0 THEN tt.total_pts / tt.gp ELSE 0 END DESC,
        tt.total_pts DESC  -- Tiebreaker: total points
    )::INT
  FROM team_totals tt
  ORDER BY
    CASE WHEN tt.gp > 0 THEN tt.total_pts / tt.gp ELSE 0 END DESC,
    tt.total_pts DESC;
END;
$$;


ALTER FUNCTION "public"."calculate_ppg_standings"("p_league_id" "uuid", "p_through_week" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_roto_standings"("p_league_id" "uuid", "p_categories" "text"[], "p_through_week" integer DEFAULT NULL::integer) RETURNS TABLE("team_id" "uuid", "team_name" "text", "category_name" "text", "stat_value" numeric, "category_rank" integer, "roto_points" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cat TEXT;
  v_higher_is_better BOOLEAN;
  v_num_teams INT;
  v_is_rate BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_num_teams FROM teams WHERE league_id = p_league_id;

  FOREACH v_cat IN ARRAY p_categories
  LOOP
    v_higher_is_better := v_cat NOT IN ('gaa', 'goals_against');
    v_is_rate          := v_cat IN ('gaa', 'save_pct');

    RETURN QUERY
    WITH team_stats AS (
      SELECT
        t.id AS tid,
        t.team_name AS tname,
        -- counting stats: sum the per-row value as before
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
            ELSE 0
          END
        ), 0) AS counting_stat,
        -- rate components, aggregated across the whole team before dividing
        COALESCE(SUM(pws.saves), 0)         AS sum_saves,
        COALESCE(SUM(pws.goals_against), 0) AS sum_ga,
        COALESCE(SUM(pws.goalie_gp), 0)     AS sum_goalie_gp
      FROM teams t
      JOIN roster_assignments ra ON ra.team_id = t.id AND ra.league_id = p_league_id
      LEFT JOIN player_weekly_stats pws ON pws.player_id = ra.player_id::INT
        AND (p_through_week IS NULL OR pws.week_number <= p_through_week)
        -- 0G-ROTO-1: goalie-ness is season-invariant; classify without season-pinning.
        AND CASE
          WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
            THEN EXISTS (SELECT 1 FROM player_directory pd
                         WHERE pd.player_id = ra.player_id::INT
                           AND (pd.is_goalie OR pd.position_code = 'G'))
          ELSE NOT EXISTS (SELECT 1 FROM player_directory pd
                           WHERE pd.player_id = ra.player_id::INT
                             AND (pd.is_goalie OR pd.position_code = 'G'))
        END
      WHERE t.league_id = p_league_id
      GROUP BY t.id, t.team_name
    ),
    valued AS (
      SELECT
        ts.tid, ts.tname,
        CASE
          WHEN v_cat = 'save_pct' THEN
            CASE WHEN ts.sum_saves + ts.sum_ga > 0
                 THEN ts.sum_saves::NUMERIC / (ts.sum_saves + ts.sum_ga)
                 ELSE NULL END
          WHEN v_cat = 'gaa' THEN
            CASE WHEN ts.sum_goalie_gp > 0
                 THEN ts.sum_ga::NUMERIC / ts.sum_goalie_gp
                 ELSE NULL END
          ELSE ts.counting_stat
        END AS total_stat
      FROM team_stats ts
    ),
    ranked AS (
      SELECT
        v.tid, v.tname, v.total_stat,
        CASE v_higher_is_better
          WHEN true THEN RANK() OVER (ORDER BY v.total_stat DESC NULLS LAST)
          ELSE RANK() OVER (ORDER BY v.total_stat ASC NULLS LAST)
        END AS cat_rank
      FROM valued v
    )
    SELECT
      r.tid,
      r.tname,
      v_cat,
      ROUND(COALESCE(r.total_stat, 0), 3),
      r.cat_rank::INT,
      (v_num_teams + 1 - r.cat_rank)::INT
    FROM ranked r;
  END LOOP;

  RETURN;
END;
$$;


ALTER FUNCTION "public"."calculate_roto_standings"("p_league_id" "uuid", "p_categories" "text"[], "p_through_week" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_insert_team"("p_league_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Check if user is the commissioner of this league
  -- Security definer bypasses RLS on leagues table
  select commissioner_id = auth.uid()
  from public.leagues
  where id = p_league_id;
$$;


ALTER FUNCTION "public"."can_insert_team"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_audit_trail_integrity"("p_days" integer DEFAULT 7) RETURNS TABLE("severity" "text", "problem" "text", "detail" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_since         timestamptz := now() - make_interval(days => p_days);
  v_gotrue_logins bigint;
  v_gotrue_human  bigint;
  v_app_logins    bigint;
  v_app_any       bigint;
  v_orphan        bigint;
  v_orphan_types  text;
  v_canary_ok     boolean := false;
  v_canary_err    text := '(no exception raised at all -- canary never ran)';
  v_cov           numeric;
  -- provider actions that mean a person did something, as opposed to a token
  -- rotating on its own behind an idle tab
  c_human         text[] := ARRAY['login','logout','user_signedup','user_repeated_signup',
                                  'user_modified','user_recovery_requested','user_confirmation_requested'];
BEGIN
  SELECT count(*) FILTER (WHERE payload->>'action' = 'login'),
         count(*) FILTER (WHERE payload->>'action' = ANY(c_human))
    INTO v_gotrue_logins, v_gotrue_human
    FROM auth.audit_log_entries
   WHERE created_at >= v_since;

  SELECT count(*) FILTER (WHERE event_type = 'AUTH_LOGIN'), count(*)
    INTO v_app_logins, v_app_any
    FROM public.security_audit_log
   WHERE created_at >= v_since;

  -------------------------------------------------------------------- ARM 1
  IF v_gotrue_logins = 0 THEN
    RETURN QUERY SELECT 'INFO'::text, 'login_coverage_not_evaluated'::text,
      format('identity provider recorded 0 logins in the last %s day(s) -- capture rate is UNDEFINED, not passing', p_days);
  ELSE
    v_cov := round(100.0 * v_app_logins / v_gotrue_logins, 1);
    IF v_app_logins = 0 THEN
      RETURN QUERY SELECT 'ERROR'::text, 'login_audit_blackout'::text,
        format('identity provider recorded %s login(s) in the last %s day(s); security_audit_log recorded 0 AUTH_LOGIN rows',
               v_gotrue_logins, p_days);
    ELSIF v_cov < 50 THEN
      RETURN QUERY SELECT 'WARN'::text, 'login_audit_lossy'::text,
        format('only %s%% of logins captured (%s AUTH_LOGIN rows vs %s provider logins over %s day(s))',
               v_cov, v_app_logins, v_gotrue_logins, p_days);
    END IF;
  END IF;

  -------------------------------------------------------------------- ARM 2
  IF v_gotrue_human > 0 AND v_app_any = 0 THEN
    RETURN QUERY SELECT 'ERROR'::text, 'audit_trail_silent'::text,
      format('%s human-initiated auth event(s) in the last %s day(s) but security_audit_log wrote nothing at all',
             v_gotrue_human, p_days);
  END IF;

  -------------------------------------------------------------------- ARM 3
  SELECT count(*), string_agg(DISTINCT event_type, ', ')
    INTO v_orphan, v_orphan_types
    FROM public.security_audit_log
   WHERE created_at >= v_since
     AND user_id IS NULL
     AND event_type IN ('AUTH_LOGIN','AUTH_LOGOUT','LEAGUE_CREATE','LEAGUE_JOIN','LEAGUE_LEAVE',
                        'ROSTER_MOVE','ROSTER_MOVE_FAILED','WAIVER_CLAIM','TRADE_OFFER',
                        'TRADE_ACCEPT','TRADE_REJECT','ADMIN_ACTION','DATA_EXPORT');
  IF v_orphan > 0 THEN
    RETURN QUERY SELECT 'WARN'::text, 'audit_attribution_lost'::text,
      format('%s row(s) in the last %s day(s) carry user_id NULL on user-scoped event types (%s) -- writer used a service-role client',
             v_orphan, p_days, v_orphan_types);
  END IF;

  -------------------------------------------------------------------- ARM 4
  BEGIN
    PERFORM public.log_security_event('AUTH_LOGIN', NULL,
              jsonb_build_object('synthetic_canary', true, 'source', 'check_audit_trail_integrity'), 'INFO');
    RAISE EXCEPTION 'CITRUS_CANARY_ROLLBACK';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'CITRUS_CANARY_ROLLBACK' THEN v_canary_ok := true;
      ELSE v_canary_err := SQLSTATE || ' ' || SQLERRM; END IF;
    WHEN OTHERS THEN
      v_canary_err := SQLSTATE || ' ' || SQLERRM;
  END;
  IF NOT v_canary_ok THEN
    RETURN QUERY SELECT 'ERROR'::text, 'audit_writer_broken'::text,
      format('log_security_event() failed a synthetic end-to-end write: %s', v_canary_err);
  END IF;

  -------------------------------------------------------------------- ARM 5
  IF NOT has_function_privilege('authenticated','public.log_security_event(text,uuid,jsonb,text)','EXECUTE') THEN
    RETURN QUERY SELECT 'ERROR'::text, 'audit_grant_revoked'::text,
      'role authenticated has lost EXECUTE on log_security_event -- the app can no longer write audit rows'::text;
  END IF;
  IF has_function_privilege('anon','public.log_security_event(text,uuid,jsonb,text)','EXECUTE') THEN
    RETURN QUERY SELECT 'ERROR'::text, 'audit_grant_too_broad'::text,
      'role anon can EXECUTE log_security_event -- unauthenticated callers can forge audit rows'::text;
  END IF;
END;
$$;


ALTER FUNCTION "public"."check_audit_trail_integrity"("p_days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_audit_trail_integrity"("p_days" integer) IS 'Outside observer for the SOC 2 CC7.2 audit trail. Exists because security_audit_log went silent for 51 days (2026-06-23 to 2026-08-12) and nothing alarmed: every app call site is fire-and-forget and supabase-js .rpc() returns its error instead of throwing, so a failed audit write is invisible by construction. Cross-sources auth.audit_log_entries (the identity provider''s own log) against security_audit_log, checks attribution, drives an ACTIVE rolled-back canary through the real writer so zero traffic cannot produce a false green, and asserts the grant surface two-sided. Run: SELECT * FROM check_audit_trail_integrity(7);';



CREATE OR REPLACE FUNCTION "public"."check_boxscore_reconciliation"("p_season" integer) RETURNS TABLE("severity" "text", "stat" "text", "rows_compared" bigint, "rows_disagreeing" bigint, "net_delta" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with games as (
    select distinct game_id from player_game_stats where season = p_season
  ),
  skaters as (
    select r.game_id,
           (p->>'playerId')::int      as player_id,
           (p->>'goals')::int         as goals,
           (p->>'assists')::int       as assists,
           (p->>'plusMinus')::int     as plus_minus,
           (p->>'pim')::int           as pim,
           (p->>'hits')::int          as hits,
           (p->>'blockedShots')::int  as blocks,
           (p->>'sog')::int           as sog
      from raw_nhl_data r
      join games g on g.game_id = r.game_id
      cross join lateral jsonb_array_elements(
          coalesce(r.boxscore_json->'playerByGameStats'->'homeTeam'->'forwards','[]'::jsonb) ||
          coalesce(r.boxscore_json->'playerByGameStats'->'homeTeam'->'defense','[]'::jsonb)  ||
          coalesce(r.boxscore_json->'playerByGameStats'->'awayTeam'->'forwards','[]'::jsonb) ||
          coalesce(r.boxscore_json->'playerByGameStats'->'awayTeam'->'defense','[]'::jsonb)
      ) as p
  ),
  goalies as (
    select r.game_id,
           (p->>'playerId')::int        as player_id,
           (p->>'goalsAgainst')::int    as goals_against,
           (p->>'saves')::int           as saves,
           (p->>'shotsAgainst')::int    as shots_against
      from raw_nhl_data r
      join games g on g.game_id = r.game_id
      cross join lateral jsonb_array_elements(
          coalesce(r.boxscore_json->'playerByGameStats'->'homeTeam'->'goalies','[]'::jsonb) ||
          coalesce(r.boxscore_json->'playerByGameStats'->'awayTeam'->'goalies','[]'::jsonb)
      ) as p
  ),
  sk as (
    select 'goals' stat, count(*) n,
           count(*) filter (where s.nhl_goals <> b.goals) d,
           sum(s.nhl_goals - b.goals) delta
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'assists', count(*),
           count(*) filter (where s.nhl_assists <> b.assists),
           sum(s.nhl_assists - b.assists)
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'plus_minus', count(*),
           count(*) filter (where s.nhl_plus_minus <> b.plus_minus),
           sum(s.nhl_plus_minus - b.plus_minus)
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'pim', count(*),
           count(*) filter (where s.nhl_pim <> b.pim),
           sum(s.nhl_pim - b.pim)
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'hits', count(*),
           count(*) filter (where s.nhl_hits <> b.hits),
           sum(s.nhl_hits - b.hits)
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'blocks', count(*),
           count(*) filter (where s.nhl_blocks <> b.blocks),
           sum(s.nhl_blocks - b.blocks)
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'shots_on_goal', count(*),
           count(*) filter (where s.nhl_shots_on_goal <> b.sog),
           sum(s.nhl_shots_on_goal - b.sog)
      from skaters b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'goalie_goals_against', count(*),
           count(*) filter (where s.nhl_goals_against <> b.goals_against),
           sum(s.nhl_goals_against - b.goals_against)
      from goalies b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'goalie_saves', count(*),
           count(*) filter (where s.nhl_saves <> b.saves),
           sum(s.nhl_saves - b.saves)
      from goalies b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
    union all select 'goalie_shots_faced', count(*),
           count(*) filter (where s.nhl_shots_faced <> b.shots_against),
           sum(s.nhl_shots_faced - b.shots_against)
      from goalies b join player_game_stats s on s.game_id=b.game_id and s.player_id=b.player_id
  )
  select case when d > 0 then 'ERROR' else 'OK' end::text,
         stat, n, d, coalesce(delta,0)::bigint
    from sk;
$$;


ALTER FUNCTION "public"."check_boxscore_reconciliation"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_boxscore_reconciliation"("p_season" integer) IS 'Reconciles every player_game_stats row for a season against the archived official boxscore in raw_nhl_data. 100% coverage, no network. Replaces sample-based confidence with population-based proof.';



CREATE OR REPLACE FUNCTION "public"."check_cron_job_health"("p_hours" integer DEFAULT 48) RETURNS TABLE("severity" "text", "jobname" "text", "issue" "text", "failed_runs" bigint, "last_failure" timestamp with time zone, "last_message" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- ARM 1: jobs that ran and failed inside the window
  select 'ERROR'::text, j.jobname,
         'cron job failed '||count(*)||' time(s) in the last '||p_hours||'h',
         count(*), max(d.start_time), left(max(d.return_message), 300)
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where d.status = 'failed'
     and d.start_time > now() - make_interval(hours => p_hours)
     and j.active
   group by j.jobname

  union all

  -- ARM 2: active jobs with NO run history that have already had 1.5 of their
  -- own periods to fire. A job registered minutes ago is not a fault.
  select 'WARN'::text, j.jobname,
         'active cron job has never run, and its schedule ('||j.schedule||') has come around at least once since '
           ||to_char(coalesce(r.first_seen, now()),'YYYY-MM-DD HH24:MI')||' UTC',
         0::bigint, null::timestamptz, null::text
    from cron.job j
    left join public.cron_job_registry r on r.jobid = j.jobid
   where j.active
     and not exists (select 1 from cron.job_run_details d where d.jobid = j.jobid)
     and now() - coalesce(r.first_seen, now()) > 1.5 * public.cron_schedule_grace(j.schedule)

  union all

  -- ARM 3: an active job whose MOST RECENT run failed, however long ago.
  -- Restricted to failures older than the window so it can never duplicate arm 1.
  select 'ERROR'::text, j.jobname,
         'most recent run FAILED at '||to_char(lr.start_time,'YYYY-MM-DD HH24:MI')
           ||' UTC, which is outside the '||p_hours||'h window -- job has not succeeded since',
         1::bigint, lr.start_time, left(lr.return_message, 300)
    from cron.job j
    cross join lateral (
      select d.start_time, d.status, d.return_message
        from cron.job_run_details d where d.jobid = j.jobid
       order by d.start_time desc limit 1) lr
   where j.active and lr.status = 'failed'
     and lr.start_time <= now() - make_interval(hours => p_hours);
$$;


ALTER FUNCTION "public"."check_cron_job_health"("p_hours" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_cron_job_health"("p_hours" integer) IS 'Watches pg_cron for jobs that RUN AND FAIL, jobs whose latest run failed outside the window, and jobs that have never run despite having had 1.5 of their own scheduled periods to do so. The grace period exists because a job created minutes ago is not a fault, and a permanently amber gate is one nobody reads.';



CREATE OR REPLACE FUNCTION "public"."check_data_integrity"() RETURNS TABLE("check_name" "text", "status" "text", "details" "text", "affected_teams" "text"[])
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_check_result RECORD;
  v_total_checks INTEGER := 0;
  v_passed_checks INTEGER := 0;
  v_failed_checks INTEGER := 0;
  v_matchup_live BOOLEAN;
  v_status TEXT;
BEGIN
  RAISE NOTICE 'DATA INTEGRITY CHECK - %', NOW();

  -- CHECK 1: ownership (draft_picks) vs team_lineups.
  -- Scoped by check_data_integrity_check1_scope(), which enters the comparison
  -- from teams-that-own-players OR teams-that-have-a-lineup. Driving it from
  -- team_lineups alone made the missing-lineup case invisible.
  v_total_checks := v_total_checks + 1;

  FOR v_check_result IN
    SELECT s.team_name, s.detail, s.missing_lineup_row
      FROM public.check_data_integrity_check1_scope() s
  LOOP
    v_failed_checks := v_failed_checks + 1;
    -- absence is auto-repairable (the snapshot path builds from draft_picks);
    -- disagreement between an existing lineup and ownership is corruption.
    v_status := CASE WHEN v_check_result.missing_lineup_row THEN 'warning' ELSE 'fail' END;

    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES ('team_lineups_vs_draft_picks_count', v_status,
            v_check_result.detail, ARRAY[v_check_result.team_name]);
    RETURN QUERY SELECT 'team_lineups_vs_draft_picks_count'::TEXT, v_status,
      v_check_result.team_name || ': ' || v_check_result.detail,
      ARRAY[v_check_result.team_name];
  END LOOP;

  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('team_lineups_vs_draft_picks_count', 'pass', 'All teams match');
    RETURN QUERY SELECT 'team_lineups_vs_draft_picks_count'::TEXT, 'pass'::TEXT,
      'All teams have matching player counts'::TEXT, ARRAY[]::TEXT[];
  END IF;

  -- CHECK 2: fantasy_daily_rosters sync, scoped to teams in a live matchup.
  v_total_checks := v_total_checks + 1;
  v_failed_checks := 0;

  SELECT EXISTS (
    SELECT 1 FROM matchups m
     WHERE CURRENT_DATE BETWEEN m.week_start_date AND m.week_end_date
  ) INTO v_matchup_live;

  IF NOT v_matchup_live THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('fantasy_daily_rosters_sync_today', 'pass',
            'not applicable: no matchup covers ' || CURRENT_DATE
            || '. fantasy_daily_rosters.matchup_id is NOT NULL, so no row can '
            || 'exist for a date no matchup spans. Check resumes automatically '
            || 'on the first day of week 1.');
    RETURN QUERY SELECT 'fantasy_daily_rosters_sync_today'::TEXT, 'pass'::TEXT,
      ('Not applicable - no matchup covers ' || CURRENT_DATE)::TEXT, ARRAY[]::TEXT[];
  ELSE
    FOR v_check_result IN
      SELECT s.team_name, s.expected, s.actual,
             'Expected: ' || s.expected || ', Actual: ' || s.actual as detail_text
        FROM public.check_data_integrity_check2_scope() s
    LOOP
      v_failed_checks := v_failed_checks + 1;
      INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
      VALUES ('fantasy_daily_rosters_sync_today', 'fail',
              v_check_result.detail_text, ARRAY[v_check_result.team_name]);
      RETURN QUERY SELECT 'fantasy_daily_rosters_sync_today'::TEXT, 'fail'::TEXT,
        v_check_result.team_name || ': ' || v_check_result.detail_text,
        ARRAY[v_check_result.team_name];
    END LOOP;

    IF v_failed_checks = 0 THEN
      v_passed_checks := v_passed_checks + 1;
      INSERT INTO integrity_check_results (check_name, status, details)
      VALUES ('fantasy_daily_rosters_sync_today', 'pass', 'All teams synced for today');
      RETURN QUERY SELECT 'fantasy_daily_rosters_sync_today'::TEXT, 'pass'::TEXT,
        'All teams synced with fantasy_daily_rosters for today'::TEXT, ARRAY[]::TEXT[];
    END IF;
  END IF;

  -- CHECK 3: No phantom players (in rosters but not in draft_picks)
  v_total_checks := v_total_checks + 1;
  v_failed_checks := 0;

  FOR v_check_result IN
    WITH daily_players AS (
      SELECT DISTINCT fdr.team_id, fdr.player_id, t.team_name
      FROM fantasy_daily_rosters fdr JOIN teams t ON t.id = fdr.team_id
      WHERE fdr.roster_date = CURRENT_DATE
    )
    SELECT dp.team_name, dp.player_id,
      'Phantom player in daily rosters, not in draft_picks' as detail_text
    FROM daily_players dp
    WHERE NOT EXISTS (
      SELECT 1 FROM draft_picks draft
      WHERE draft.team_id = dp.team_id AND draft.player_id = dp.player_id::TEXT
        AND draft.deleted_at IS NULL)
  LOOP
    v_failed_checks := v_failed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES ('phantom_players_check', 'warning',
            'Player ' || v_check_result.player_id || ' in rosters but not owned',
            ARRAY[v_check_result.team_name]);
    RETURN QUERY SELECT 'phantom_players_check'::TEXT, 'warning'::TEXT,
      v_check_result.team_name || ': Player ' || v_check_result.player_id::TEXT,
      ARRAY[v_check_result.team_name];
  END LOOP;

  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('phantom_players_check', 'pass', 'No phantom players found');
  END IF;

  -- CHECK 4: No missing players (in draft_picks but not in team_lineups)
  v_total_checks := v_total_checks + 1;
  v_failed_checks := 0;

  FOR v_check_result IN
    SELECT t.team_name, dp.player_id,
      'Player owned but missing from team_lineups' as detail_text
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN team_lineups tl ON tl.team_id = t.id
    WHERE dp.deleted_at IS NULL
      AND NOT (tl.starters ? dp.player_id OR tl.bench ? dp.player_id OR tl.ir ? dp.player_id)
  LOOP
    v_failed_checks := v_failed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES ('missing_players_check', 'fail',
            'Player ' || v_check_result.player_id || ' owned but not in lineup',
            ARRAY[v_check_result.team_name]);
    RETURN QUERY SELECT 'missing_players_check'::TEXT, 'fail'::TEXT,
      v_check_result.team_name || ': Player ' || v_check_result.player_id::TEXT,
      ARRAY[v_check_result.team_name];
  END LOOP;

  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('missing_players_check', 'pass', 'No missing players');
  END IF;

  RAISE NOTICE 'Integrity check complete: % passed, % failed',
    v_passed_checks, v_total_checks - v_passed_checks;
END;
$$;


ALTER FUNCTION "public"."check_data_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_data_integrity"() IS 'Runs comprehensive data integrity checks. Returns issues found.
Usage: SELECT * FROM check_data_integrity();';



CREATE OR REPLACE FUNCTION "public"."check_data_integrity_check1_scope"() RETURNS TABLE("team_id" "uuid", "team_name" "text", "lineup_count" integer, "draft_count" integer, "missing_lineup_row" boolean, "detail" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH in_scope AS (
    SELECT t.id, t.team_name
      FROM teams t
     WHERE EXISTS (SELECT 1 FROM team_lineups tl WHERE tl.team_id = t.id)
        OR EXISTS (SELECT 1 FROM draft_picks d WHERE d.team_id = t.id AND d.deleted_at IS NULL)
  ),
  counts AS (
    SELECT s.id, s.team_name,
           (tl.team_id IS NULL) AS missing_lineup_row,
           jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
           jsonb_array_length(COALESCE(tl.bench,    '[]'::jsonb)) +
           jsonb_array_length(COALESCE(tl.ir,       '[]'::jsonb)) AS lineup_count,
           (SELECT count(*) FROM draft_picks d
             WHERE d.team_id = s.id AND d.deleted_at IS NULL)::int AS draft_count
      FROM in_scope s
      LEFT JOIN team_lineups tl ON tl.team_id = s.id
  )
  SELECT c.id, c.team_name, c.lineup_count, c.draft_count, c.missing_lineup_row,
         CASE WHEN c.missing_lineup_row
              THEN 'owns ' || c.draft_count || ' drafted players but has NO team_lineups row'
              ELSE 'team_lineups: ' || c.lineup_count || ', draft_picks: ' || c.draft_count
         END
    FROM counts c
   WHERE c.lineup_count <> c.draft_count;
$$;


ALTER FUNCTION "public"."check_data_integrity_check1_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_data_integrity_check2_scope"() RETURNS TABLE("team_id" "uuid", "team_name" "text", "expected" integer, "actual" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH live_teams AS (
    SELECT DISTINCT t.id AS team_id, t.team_name
      FROM teams t
      JOIN matchups m ON m.league_id = t.league_id
     WHERE CURRENT_DATE BETWEEN m.week_start_date AND m.week_end_date
  ),
  lineup_counts AS (
    SELECT lt.team_id, lt.team_name,
           jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
           jsonb_array_length(COALESCE(tl.bench,    '[]'::jsonb)) +
           jsonb_array_length(COALESCE(tl.ir,       '[]'::jsonb)) AS expected
      FROM live_teams lt
      JOIN team_lineups tl ON tl.team_id = lt.team_id
  ),
  daily_counts AS (
    SELECT fdr.team_id, COUNT(DISTINCT fdr.player_id) AS actual
      FROM fantasy_daily_rosters fdr
     WHERE fdr.roster_date = CURRENT_DATE
     GROUP BY fdr.team_id
  )
  SELECT lc.team_id, lc.team_name, lc.expected, COALESCE(dc.actual, 0)::integer
    FROM lineup_counts lc
    LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
   WHERE lc.expected <> COALESCE(dc.actual, 0);
$$;


ALTER FUNCTION "public"."check_data_integrity_check2_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_matchup_score_calibration"() RETURNS TABLE("severity" "text", "matchup_id" "uuid", "stored_t1" numeric, "calc_t1" numeric, "stored_t2" numeric, "calc_t2" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select 'ERROR'::text, m.id, v.team1_stored, v.team1_calculated,
         v.team2_stored, v.team2_calculated
    from matchups m
    cross join lateral public.verify_matchup_scores(m.id) v
   where not v.is_calibrated;
$$;


ALTER FUNCTION "public"."check_matchup_score_calibration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_monitor_liveness"() RETURNS TABLE("severity" "text", "monitor" "text", "last_seen" timestamp with time zone, "hours_quiet" numeric, "expected" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with m(prefix, label, max_hours, note) as (values
    ('freshness_%',  'data-freshness-check.yml (hourly)',      6.0,  'hourly GitHub workflow writing one row per table'),
    ('xg_integrity_v2', 'xg-integrity-check-v2 (cron 23)',    30.0,  'daily 05:45 UTC'),
    ('security_drift',  'security-drift-check (cron 11)',     30.0,  'daily 05:30 UTC'),
    ('pipeline_coverage','pipeline-coverage-check (cron 15)', 30.0,  'daily 06:00 UTC'),
    ('stats_layer_freshness','stats-layer-freshness (cron 21)',30.0, 'daily 09:00 UTC')
  )
  select case when extract(epoch from (now() - coalesce(x.seen, '2000-01-01'::timestamptz)))/3600 > m.max_hours
              then 'ERROR' else 'OK' end,
         m.label,
         x.seen,
         round((extract(epoch from (now() - coalesce(x.seen,'2000-01-01'::timestamptz)))/3600)::numeric, 1),
         'a row at least every '||m.max_hours||'h -- '||m.note
    from m
    left join lateral (
      select max(check_time) seen from integrity_check_results r
       where r.check_name like m.prefix
    ) x on true;
$$;


ALTER FUNCTION "public"."check_monitor_liveness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_pipeline_coverage"() RETURNS TABLE("severity" "text", "game_type" "text", "layer" "text", "games_affected" integer, "detail" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH g AS (SELECT game_id, game_type, game_date FROM public.nhl_games
              WHERE game_date < current_date)
  SELECT 'ERROR'::text, g.game_type::text, 'play_by_play_missing'::text, count(*)::int,
         'scheduled games with no row in raw_nhl_data -- the scraper never captured them: '
         || left(string_agg(g.game_id::text, ',' ORDER BY g.game_id), 400)
    FROM g WHERE NOT EXISTS (SELECT 1 FROM public.raw_nhl_data d WHERE d.game_id = g.game_id)
   GROUP BY g.game_type
  UNION ALL
  SELECT 'ERROR', g.game_type::text, 'shot_records_missing', count(*)::int,
         'games with play-by-play but no rows in raw_shots -- the shot extractor dropped them: '
         || left(string_agg(g.game_id::text, ',' ORDER BY g.game_id), 400)
    FROM g WHERE EXISTS (SELECT 1 FROM public.raw_nhl_data d WHERE d.game_id = g.game_id)
      AND NOT EXISTS (SELECT 1 FROM public.raw_shots r WHERE r.game_id = g.game_id)
   GROUP BY g.game_type
  UNION ALL
  SELECT 'ERROR', g.game_type::text, 'player_stats_missing', count(*)::int,
         'games with NO player stat lines -- FANTASY SCORES ZERO for every player on these days: '
         || left(string_agg(g.game_id::text, ',' ORDER BY g.game_id), 400)
    FROM g WHERE NOT EXISTS (SELECT 1 FROM public.player_game_stats p WHERE p.game_id = g.game_id)
   GROUP BY g.game_type
  UNION ALL
  SELECT 'ERROR', d.game_type::text, 'player_stats_thin', count(*)::int,
         'games with FEWER THAN 30 stat lines (a dressed NHL game has ~40) -- partial ingestion: '
         || left(string_agg(d.game_id::text, ',' ORDER BY d.game_id), 400)
    FROM (SELECT g.game_id, g.game_type, count(p.*) AS n
            FROM g JOIN public.player_game_stats p ON p.game_id = g.game_id
           GROUP BY g.game_id, g.game_type) d
   WHERE d.n < 30
   GROUP BY d.game_type;
$$;


ALTER FUNCTION "public"."check_pipeline_coverage"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_pipeline_coverage"() IS 'Cross-checks every ingestion layer against the schedule: play-by-play, shot records, player stat lines, and stat-line depth. Exists because 22 consecutive games on 2026-04-04/05 landed schedule + play-by-play + shots with ZERO player stat lines and nothing alarmed for four months. Fantasy scoring reads player_game_stats, so a gap there means every player scores zero. Run: SELECT * FROM check_pipeline_coverage();';



CREATE OR REPLACE FUNCTION "public"."check_player_directory_freshness"() RETURNS TABLE("severity" "text", "target_season" integer, "problem" "text", "detail" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH t AS (SELECT public.get_projection_target_season() AS season),
  d AS (
    SELECT t.season,
           (SELECT count(*) FROM public.player_directory p WHERE p.season = t.season) AS rows_n,
           (SELECT max(p.source_last_fetched_at) FROM public.player_directory p WHERE p.season = t.season) AS fetched,
           (SELECT count(DISTINCT ra.player_id) FROM public.roster_assignments ra
             WHERE NOT EXISTS (SELECT 1 FROM public.player_directory p2
                                WHERE p2.season = t.season AND p2.player_id = ra.player_id::int)) AS rostered_missing
      FROM t
  )
  SELECT 'ERROR', d.season, 'directory_stale',
         format('season %s directory last fetched %s ago (threshold 168h) -- the table-wide freshness SLA cannot see this because any row in any season resets it',
                d.season, age(now(), d.fetched))
    FROM d WHERE d.fetched IS NULL OR d.fetched < now() - interval '168 hours'

  UNION ALL
  SELECT 'ERROR', d.season, 'directory_undersized',
         format('season %s directory holds only %s rows (32 teams x ~23 players ~= 736 expected)', d.season, d.rows_n)
    FROM d WHERE d.rows_n < 700

  UNION ALL
  SELECT 'WARN', d.season, 'rostered_players_absent',
         format('%s currently-rostered player(s) have no season-%s directory row and will render as raw ids in get_daily_lineup',
                d.rostered_missing, d.season)
    FROM d WHERE d.rostered_missing > 0;
$$;


ALTER FUNCTION "public"."check_player_directory_freshness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_pool_scoring_integrity"("p_grace_days" integer DEFAULT 1) RETURNS TABLE("severity" "text", "scope" "text", "metric" "text", "value" numeric, "expected" "text", "issue" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Input cardinality FIRST. Every arm below reads zero when no picks exist, and a
  -- zero over an empty set proves nothing. These INFO rows make "scoring is healthy"
  -- distinguishable from "nobody has ever made a pick".
  RETURN QUERY
  SELECT 'INFO'::TEXT, z.src, 'rows_total'::TEXT, z.n::NUMERIC, 'context'::TEXT,
         format('%s row(s) exist, %s still unscored', z.n, z.un)
  FROM (
    SELECT 'confidence_picks' src, count(*) n, count(*) FILTER (WHERE is_correct IS NULL) un FROM confidence_picks
    UNION ALL SELECT 'pool_picks', count(*), count(*) FILTER (WHERE is_correct IS NULL) FROM pool_picks
    UNION ALL SELECT 'survivor_selections', count(*), count(*) FILTER (WHERE is_correct IS NULL) FROM survivor_selections
  ) z;

  -- Arm 1: game-keyed picks still unscored after their game finished.
  RETURN QUERY
  SELECT 'ERROR'::TEXT, z.src, 'unscored_settled_picks'::TEXT, z.n::NUMERIC, '0'::TEXT,
         format('%s pick(s) reference a final game that ended over %s day(s) ago and are still unscored - the nightly scorer is not landing',
                z.n, p_grace_days)
  FROM (
    SELECT 'confidence_picks' src, count(*) n
      FROM confidence_picks cp JOIN nhl_games g ON g.id::TEXT = cp.game_id
     WHERE cp.is_correct IS NULL AND g.status='final' AND g.game_date < current_date - p_grace_days
    UNION ALL
    SELECT 'pool_picks', count(*)
      FROM pool_picks pp JOIN nhl_games g ON g.id::TEXT = pp.game_id
     WHERE pp.is_correct IS NULL AND g.status='final' AND g.game_date < current_date - p_grace_days
  ) z WHERE z.n > 0;

  -- Arm 2: survivor selections still unscored after their week finished.
  -- Uses the same 1-arg get_pool_week_dates the scorer uses, so the gate and the
  -- scorer can never disagree about which week a selection belongs to.
  RETURN QUERY
  SELECT 'ERROR'::TEXT, 'survivor_selections'::TEXT, 'unscored_settled_weeks'::TEXT, count(*)::NUMERIC, '0'::TEXT,
         format('%s survivor selection(s) sit in weeks that ended over %s day(s) ago and had final games for the picked team',
                count(*), p_grace_days)
  FROM survivor_selections ss
  CROSS JOIN LATERAL public.get_pool_week_dates(ss.week_number) w
  WHERE ss.is_correct IS NULL
    AND w.week_end < current_date - p_grace_days
    AND EXISTS (SELECT 1 FROM nhl_games g
                 WHERE g.game_date BETWEEN w.week_start AND w.week_end AND g.status='final'
                   AND (g.home_team = ss.picked_team OR g.away_team = ss.picked_team))
  HAVING count(*) > 0;

  RETURN;
END $$;


ALTER FUNCTION "public"."check_pool_scoring_integrity"("p_grace_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_scoring_config_divergence"() RETURNS TABLE("severity" "text", "league_id" "uuid", "league_name" "text", "stat_key" "text", "jsonb_value" numeric, "effective_value" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select 'ERROR'::text, l.id, l.name, c.stat_key,
         (l.scoring_settings->c.applies_to->>c.stat_key)::numeric,
         r.multiplier
    from public.leagues l
    cross join lateral public.get_effective_scoring_rules(l.id) r
    join public.stat_catalog c on c.stat_key = r.stat_key
   where l.scoring_settings is null
      or not (l.scoring_settings->c.applies_to ? c.stat_key)
      or (l.scoring_settings->c.applies_to->>c.stat_key)::numeric
         is distinct from r.multiplier;
$$;


ALTER FUNCTION "public"."check_scoring_config_divergence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_season_boundary"("p_horizon_days" integer DEFAULT 180) RETURNS TABLE("severity" "text", "problem" "text", "detail" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_callers text; v_seasons int; v_last date;
BEGIN
  -- 1. the naive calendar rule must only ever be reached through get_current_season
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_callers
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ '\mget_nhl_season_year\s*\('
     AND p.proname NOT IN ('get_nhl_season_year','get_current_season','check_season_boundary');
  IF v_callers IS NOT NULL THEN
    RETURN QUERY SELECT 'ERROR'::text, 'calendar_rule_called_directly'::text,
      format('%s call get_nhl_season_year() directly. It returns 2025 for 2026-09-29 -- opening night -- because it only knows the Oct-1 calendar. Use get_current_season(), which resolves against the loaded schedule.', v_callers);
  END IF;

  -- 2. a schedule has to exist for any of this to mean anything
  SELECT count(DISTINCT season), max(game_date) INTO v_seasons, v_last
    FROM nhl_games WHERE game_type = 'regular';
  IF coalesce(v_seasons,0) = 0 THEN
    RETURN QUERY SELECT 'ERROR'::text, 'no_schedule_loaded'::text,
      'nhl_games holds no regular-season rows, so get_current_season falls all the way back to the calendar rule and opening night resolves to the wrong year'::text;
    RETURN;
  END IF;

  -- 3. and it has to still cover the horizon
  IF v_last < current_date + p_horizon_days THEN
    RETURN QUERY SELECT 'WARN'::text, 'schedule_runs_out'::text,
      format('the loaded regular-season schedule ends %s, inside the %s-day horizon -- past that date get_current_season silently falls back to the calendar rule',
             v_last, p_horizon_days);
  END IF;
END;
$$;


ALTER FUNCTION "public"."check_season_boundary"("p_horizon_days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_season_boundary"("p_horizon_days" integer) IS 'Guards the season boundary. Opening night 2026-09-29 falls in September, and the Oct-1 calendar rule in get_nhl_season_year() returns 2025 for it. Asserts that no product-path function reaches that rule directly, that a regular-season schedule is loaded, and that it still covers the horizon.';



CREATE OR REPLACE FUNCTION "public"."check_security_drift"() RETURNS TABLE("severity" "text", "object_type" "text", "object_name" "text", "issue" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH anon_write AS (
    SELECT c.oid, c.relname, c.relrowsecurity AS rls
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> 'waitlist'
       AND c.relname NOT LIKE '\_deprecated\_%'
       AND ( pg_catalog.has_table_privilege('anon', c.oid, 'INSERT')
          OR pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE')
          OR pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
          OR pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE') )
  ),
  wide_open AS (
    SELECT DISTINCT p.tablename
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public'
       AND p.cmd IN ('INSERT','UPDATE','DELETE','ALL')
       AND (p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%public%')
       AND btrim(coalesce(p.with_check, p.qual, 'true')) = 'true'
  )
  SELECT 'ERROR'::text, 'table'::text, c.relname::text, 'RLS is not enabled'::text
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT c.relrowsecurity AND c.relname NOT LIKE '\_deprecated\_%'
  UNION ALL
  SELECT 'ERROR', 'table', a.relname::text,
         'anon can actually WRITE here: ' ||
         CASE WHEN NOT a.rls THEN 'RLS is off' ELSE 'a write policy open to anon has no auth condition' END
    FROM anon_write a LEFT JOIN wide_open w ON w.tablename = a.relname
   WHERE NOT a.rls OR w.tablename IS NOT NULL
  UNION ALL
  SELECT 'WARN', 'table', a.relname::text,
         'anon holds a write grant, but RLS policy expressions block it -- grant should still be revoked'
    FROM anon_write a LEFT JOIN wide_open w ON w.tablename = a.relname
   WHERE a.rls AND w.tablename IS NULL
  UNION ALL
  SELECT 'WARN', 'function', p.oid::regprocedure::text, 'grants EXECUTE to PUBLIC'
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  UNION ALL
  SELECT 'ERROR', 'function', p.oid::regprocedure::text,
         'anon can EXECUTE a SECURITY DEFINER function'
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('is_commissioner_of_league','user_owns_team_in_league_simple')
  UNION ALL
  SELECT 'ERROR', 'view', c.relname::text,
         'owner-run view readable by anon (bypasses RLS on its base tables)'
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND COALESCE((SELECT option_value FROM pg_catalog.pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false') = 'false'
     AND pg_catalog.has_table_privilege('anon', c.oid, 'SELECT');
$$;


ALTER FUNCTION "public"."check_security_drift"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_security_drift"() IS 'Re-derives the security invariants established by the 0D-SEC migrations and reports any regression. Run it after adding tables or RPCs: SELECT * FROM check_security_drift();';



CREATE OR REPLACE FUNCTION "public"."check_stat_column_parity"() RETURNS TABLE("severity" "text", "stat" "text", "rows_disagreeing" bigint, "net_delta" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with p(stat, disagree, delta) as (
    select 'goals',         count(*) filter (where coalesce(goals,0)<>coalesce(nhl_goals,0)),
                            sum(coalesce(goals,0)-coalesce(nhl_goals,0))            from player_game_stats where not is_goalie
    union all select 'assists_primary_plus_secondary',
                            count(*) filter (where coalesce(primary_assists,0)+coalesce(secondary_assists,0)<>coalesce(nhl_assists,0)),
                            sum(coalesce(primary_assists,0)+coalesce(secondary_assists,0)-coalesce(nhl_assists,0)) from player_game_stats where not is_goalie
    union all select 'shots_on_goal', count(*) filter (where coalesce(shots_on_goal,0)<>coalesce(nhl_shots_on_goal,0)),
                            sum(coalesce(shots_on_goal,0)-coalesce(nhl_shots_on_goal,0))   from player_game_stats where not is_goalie
    union all select 'hits',   count(*) filter (where coalesce(hits,0)<>coalesce(nhl_hits,0)),
                            sum(coalesce(hits,0)-coalesce(nhl_hits,0))               from player_game_stats where not is_goalie
    union all select 'blocks', count(*) filter (where coalesce(blocks,0)<>coalesce(nhl_blocks,0)),
                            sum(coalesce(blocks,0)-coalesce(nhl_blocks,0))           from player_game_stats where not is_goalie
    union all select 'pim',    count(*) filter (where coalesce(pim,0)<>coalesce(nhl_pim,0)),
                            sum(coalesce(pim,0)-coalesce(nhl_pim,0))                 from player_game_stats where not is_goalie
    union all select 'plus_minus', count(*) filter (where coalesce(plus_minus,0)<>coalesce(nhl_plus_minus,0)),
                            sum(coalesce(plus_minus,0)-coalesce(nhl_plus_minus,0))   from player_game_stats where not is_goalie
    union all select 'power_play_points', count(*) filter (where coalesce(ppp,0)<>coalesce(nhl_ppp,0)),
                            sum(coalesce(ppp,0)-coalesce(nhl_ppp,0))                 from player_game_stats where not is_goalie
    union all select 'short_handed_points', count(*) filter (where coalesce(shp,0)<>coalesce(nhl_shp,0)),
                            sum(coalesce(shp,0)-coalesce(nhl_shp,0))                 from player_game_stats where not is_goalie
    union all select 'goalie_wins', count(*) filter (where coalesce(wins,0)<>coalesce(nhl_wins,0)),
                            sum(coalesce(wins,0)-coalesce(nhl_wins,0))               from player_game_stats where is_goalie
    union all select 'goalie_saves', count(*) filter (where coalesce(saves,0)<>coalesce(nhl_saves,0)),
                            sum(coalesce(saves,0)-coalesce(nhl_saves,0))             from player_game_stats where is_goalie
    union all select 'goalie_goals_against', count(*) filter (where coalesce(goals_against,0)<>coalesce(nhl_goals_against,0)),
                            sum(coalesce(goals_against,0)-coalesce(nhl_goals_against,0)) from player_game_stats where is_goalie
    union all select 'goalie_shutouts', count(*) filter (where coalesce(shutouts,0)<>coalesce(nhl_shutouts,0)),
                            sum(coalesce(shutouts,0)-coalesce(nhl_shutouts,0))       from player_game_stats where is_goalie
    union all select 'goalie_shots_faced', count(*) filter (where coalesce(shots_faced,0)<>coalesce(nhl_shots_faced,0)),
                            sum(coalesce(shots_faced,0)-coalesce(nhl_shots_faced,0)) from player_game_stats where is_goalie
  )
  select 'ERROR'::text, stat, disagree, coalesce(delta,0)::bigint from p where disagree > 0;
$$;


ALTER FUNCTION "public"."check_stat_column_parity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_stats_layer_freshness"() RETURNS TABLE("severity" "text", "layer" "text", "detail" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 'ERROR', 'player_game_stats_stale',
         format('newest updated_at is %s old, and NHL games were played inside that window',
                age(now(), max(updated_at)))
    FROM public.player_game_stats
  HAVING max(updated_at) < now() - interval '36 hours'
     AND EXISTS (SELECT 1 FROM public.nhl_games g
                  WHERE g.game_date >= (now() - interval '36 hours')::date
                    AND g.game_date <= current_date)

  UNION ALL
  SELECT 'ERROR', 'identity_stale',
         format('nhl_player_identity newest %s old, and NHL games were played inside that window',
                age(now(), max(updated_at)))
    FROM public.nhl_player_identity
  HAVING max(updated_at) < now() - interval '36 hours'
     AND EXISTS (SELECT 1 FROM public.nhl_games g
                  WHERE g.game_date >= (now() - interval '36 hours')::date
                    AND g.game_date <= current_date)

  UNION ALL
  SELECT 'ERROR', 'rollups_empty', 'player_season_totals has zero rows'
    FROM public.player_season_totals HAVING count(*) = 0

  UNION ALL
  SELECT 'ERROR', 'career_identity_broken', format('%s career rows have no name', count(*))
    FROM public.player_career_totals WHERE full_name IS NULL HAVING count(*) > 0

  UNION ALL
  SELECT 'ERROR', 'assist_split_drift',
         format('%s player-games where primary+secondary <> boxscore assists', count(*))
    FROM public.player_game_stats
   WHERE primary_assists + secondary_assists <> nhl_assists HAVING count(*) > 0;
$$;


ALTER FUNCTION "public"."check_stats_layer_freshness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_waiver_priority_integrity"() RETURNS TABLE("severity" "text", "league_id" "uuid", "league_name" "text", "problem" "text", "detail" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 'ERROR'::text, l.id, l.name, 'MISSING_ROW'::text,
         count(*)::text || ' of '
           || (SELECT count(*) FROM teams t2 WHERE t2.league_id = l.id)::text
           || ' teams have no waiver_priority row'
    FROM leagues l
    JOIN teams t ON t.league_id = l.id
   WHERE NOT EXISTS (SELECT 1 FROM waiver_priority wp
                      WHERE wp.league_id = l.id AND wp.team_id = t.id)
   GROUP BY l.id, l.name

  UNION ALL

  SELECT 'ERROR'::text, l.id, l.name, 'NOT_CONTIGUOUS'::text,
         'priorities min=' || min(wp.priority) || ' max=' || max(wp.priority)
           || ' n=' || count(*) || ' distinct=' || count(DISTINCT wp.priority)
    FROM leagues l
    JOIN waiver_priority wp ON wp.league_id = l.id
   GROUP BY l.id, l.name
  HAVING min(wp.priority) <> 1
      OR max(wp.priority) <> count(*)
      OR count(DISTINCT wp.priority) <> count(*);
$$;


ALTER FUNCTION "public"."check_waiver_priority_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_weekly_stats_vs_source"() RETURNS TABLE("severity" "text", "stat" "text", "week_number" integer, "stored" bigint, "source" bigint, "delta" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with wk as (
    select distinct week_number, week_start_date, week_end_date from player_weekly_stats
  ),
  src as (
    select wk.week_number,
           sum(pgs.nhl_goals)          as goals,
           sum(pgs.nhl_assists)        as assists,
           sum(pgs.nhl_shots_on_goal)  as sog,
           sum(pgs.nhl_hits)           as hits,
           sum(pgs.nhl_blocks)         as blocks,
           sum(pgs.nhl_pim)            as pim,
           sum(pgs.nhl_ppp)            as ppp,
           sum(pgs.nhl_shp)            as shp,
           sum(pgs.nhl_plus_minus)     as plus_minus,
           sum(pgs.nhl_wins)           as wins,
           sum(pgs.nhl_saves)          as saves,
           sum(pgs.nhl_goals_against)  as goals_against,
           sum(pgs.nhl_shutouts)       as shutouts,
           sum(pgs.nhl_shots_faced)    as shots_faced
      from wk
      join nhl_games ng
        on ng.game_date between wk.week_start_date and wk.week_end_date
       and ng.game_type = 'regular'
      join player_game_stats pgs on pgs.game_id = ng.game_id
     group by wk.week_number
  ),
  stored as (
    select week_number,
           sum(nhl_goals)         as goals,   sum(nhl_assists)       as assists,
           sum(nhl_shots_on_goal) as sog,     sum(nhl_hits)          as hits,
           sum(nhl_blocks)        as blocks,  sum(nhl_pim)           as pim,
           sum(nhl_ppp)           as ppp,     sum(nhl_shp)           as shp,
           sum(nhl_plus_minus)    as plus_minus, sum(nhl_wins)       as wins,
           sum(nhl_saves)         as saves,   sum(nhl_goals_against) as goals_against,
           sum(nhl_shutouts)      as shutouts, sum(nhl_shots_faced)  as shots_faced
      from player_weekly_stats group by week_number
  ),
  cmp as (
    select s.week_number, v.stat, v.stored, v.source
      from stored s join src r on r.week_number = s.week_number
      cross join lateral (values
        ('goals',s.goals,r.goals),('assists',s.assists,r.assists),('sog',s.sog,r.sog),
        ('hits',s.hits,r.hits),('blocks',s.blocks,r.blocks),('pim',s.pim,r.pim),
        ('ppp',s.ppp,r.ppp),('shp',s.shp,r.shp),('plus_minus',s.plus_minus,r.plus_minus),
        ('wins',s.wins,r.wins),('saves',s.saves,r.saves),
        ('goals_against',s.goals_against,r.goals_against),
        ('shutouts',s.shutouts,r.shutouts),('shots_faced',s.shots_faced,r.shots_faced)
      ) as v(stat, stored, source)
  )
  select 'ERROR'::text, cmp.stat, cmp.week_number,
         coalesce(cmp.stored,0)::bigint, coalesce(cmp.source,0)::bigint,
         (coalesce(cmp.stored,0) - coalesce(cmp.source,0))::bigint
    from cmp
   where coalesce(cmp.stored,0) <> coalesce(cmp.source,0);
$$;


ALTER FUNCTION "public"."check_weekly_stats_vs_source"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_weekly_stats_vs_source"() IS 'Recomputes player_weekly_stats from player_game_stats and reports any week/stat that drifted. Catches a stale cache, which a paired-column parity check cannot: both sides can go stale together.';



CREATE OR REPLACE FUNCTION "public"."check_xg_chain_integrity"() RETURNS TABLE("severity" "text", "season" integer, "metric" "text", "value" numeric, "expected" "text", "issue" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with s as (
  select n.season,
         count(*) as shots,
         count(*) filter (where n.seconds_since_prev < 0) as neg_time,
         count(*) filter (where n.is_rebound) as rebounds,
         count(*) filter (where n.prev_event_type is null) as no_prev
    from public.nhl_shots n group by n.season
)
select 'ERROR', s.season::int, 'event_chain_negative_time', s.neg_time::numeric, 'zero',
       'shots whose previous event is timestamped AFTER them -- the extractor is ordering the play-by-play by something that is not game time. Every pre-shot feature (prev_event_type, seconds_since_prev, distance_from_prev, is_rebound, is_rush) is wrong for these rows.'
  from s where s.neg_time > 0
union all
select 'WARN', s.season::int, 'rebound_rate_pct',
       round((100.0*s.rebounds/nullif(s.shots,0))::numeric,2),
       'between 6% and 13% (clean seasons observed 6.79 to 10.62)',
       'rebound detection is out of band. Below the floor is the signature of a misordered event chain: a wrong previous event cannot be recognised as a rebound. 2017 and 2018 sat at 5.3% and 5.6% for years on exactly this cause.'
  from s where (100.0*s.rebounds/nullif(s.shots,0)) not between 6.0 and 13.0
union all
select 'ERROR', s.season::int, 'shots_with_no_previous_event', s.no_prev::numeric,
       'at most one per game (the opening event)',
       'shots with no previous event at all -- the chain is broken or the game has no preceding play'
  from s where s.no_prev > (select count(distinct game_id) from public.nhl_shots x where x.season = s.season);
$$;


ALTER FUNCTION "public"."check_xg_chain_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_xg_chain_integrity"() IS 'Guards the play-by-play event chain that every pre-shot feature is derived from. Exists because extract_shots_season ordered by the raw feed''s sortOrder, which is not monotonic in game time in the 2017-18 and 2018-19 feeds: 12,092 shots carried a negative seconds_since_prev (down to -26 minutes) and rebound detection was suppressed by roughly 3,600 shots across the two seasons, undetected for the life of the data.';



CREATE OR REPLACE FUNCTION "public"."check_xg_integrity"() RETURNS TABLE("severity" "text", "season" integer, "metric" "text", "value" numeric, "expected" "text", "issue" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
WITH s AS (
  SELECT r.season,
         count(*)                                                    AS shots,
         count(*) FILTER (WHERE r.is_goal)                           AS goals,
         sum(r.xg_value)                                             AS sum_xg,
         avg(r.xg_value) FILTER (WHERE r.is_goal)                    AS avg_goals,
         avg(r.xg_value) FILTER (WHERE NOT r.is_goal)                AS avg_nongoals,
         count(*) FILTER (WHERE NOT r.is_goal AND r.xg_value > 0.30) AS ng_hi,
         count(*) FILTER (WHERE NOT r.is_goal)                       AS ng,
         count(*) FILTER (WHERE r.xg_value IS NULL)                  AS nulls
    FROM public.raw_shots r
   GROUP BY r.season
),
modal AS (
  SELECT season, max(cnt) AS modal_cnt
    FROM (SELECT season, xg_value, count(*) AS cnt
            FROM public.raw_shots GROUP BY season, xg_value) m
   GROUP BY season
)
SELECT 'ERROR', s.season::int, 'calibration_pct',
       round((100.0*(s.sum_xg - s.goals)/NULLIF(s.goals,0))::numeric,2),
       'within +/-6% (observed MoneyPuck range -4.34 to +2.46)',
       'sum(xG) does not reconcile to actual goals -- miscalibrated model or wrong provenance'
  FROM s WHERE abs(100.0*(s.sum_xg - s.goals)/NULLIF(s.goals,0)) > 6.0
UNION ALL
SELECT 'ERROR', s.season::int, 'separation_ratio',
       round((s.avg_goals/NULLIF(s.avg_nongoals,0))::numeric,2),
       'between 2.0 and 6.0 (observed MoneyPuck range 3.09 to 3.61)',
       'xG separates goals from non-goals far too well -- target leakage signature'
  FROM s WHERE (s.avg_goals/NULLIF(s.avg_nongoals,0)) NOT BETWEEN 2.0 AND 6.0
UNION ALL
SELECT 'ERROR', s.season::int, 'pct_nongoals_above_0.30',
       round((100.0*s.ng_hi/NULLIF(s.ng,0))::numeric,3),
       'between 0.8% and 5% (observed MoneyPuck range 1.408 to 2.526)',
       'a real xG model rates many good chances that did not score -- this one barely does'
  FROM s WHERE (100.0*s.ng_hi/NULLIF(s.ng,0)) NOT BETWEEN 0.8 AND 5.0
UNION ALL
SELECT 'ERROR', s.season::int, 'pct_rows_on_single_xg_value',
       round((100.0*m.modal_cnt/NULLIF(s.shots,0))::numeric,3),
       'below 3% (observed MoneyPuck range 0.675 to 1.775)',
       'too many shots share one exact xG -- indicates a clip ceiling or hardcoded constant'
  FROM s JOIN modal m ON m.season = s.season
 WHERE (100.0*m.modal_cnt/NULLIF(s.shots,0)) > 3.0
UNION ALL
SELECT 'ERROR', s.season::int, 'null_xg_rows', s.nulls::numeric, 'zero',
       'shots exist with no xG value'
  FROM s WHERE s.nulls > 0
UNION ALL
SELECT 'ERROR', g.season, 'games_ingested_without_shots', g.n::numeric, 'zero',
       'raw_nhl_data holds play-by-play for these games but raw_shots has no rows for them -- the extractor dropped whole games'
  FROM (
    SELECT substr(d.game_id::text,1,4)::int AS season, count(*) AS n
      FROM public.raw_nhl_data d
     WHERE d.raw_json ? 'plays'
       AND NOT EXISTS (SELECT 1 FROM public.raw_shots r WHERE r.game_id = d.game_id)
     GROUP BY 1
  ) g
UNION ALL
SELECT 'ERROR', z.season, 'games_with_zero_scored_shots', z.n::numeric, 'zero',
       'every shot in these games has a NULL xg_value -- a scoring pass silently skipped whole games'
  FROM (
    SELECT q.season, count(*) AS n
      FROM (SELECT r.season, r.game_id FROM public.raw_shots r
             GROUP BY r.season, r.game_id HAVING count(r.xg_value) = 0) q
     GROUP BY q.season
  ) z
UNION ALL
SELECT 'WARN', e.season, 'duplicate_game_event_rows', e.dups::numeric,
       'at most 25 per season (measured baseline: 0 for 2017-2024, 13 for 2025-26)',
       'rows share one (game_id,event_id) -- event_id degrades as a join key as this grows'
  FROM (
    SELECT x.season, sum(x.c - 1) AS dups
      FROM (SELECT r.season, r.game_id, r.event_id, count(*) AS c
              FROM public.raw_shots r WHERE r.event_id IS NOT NULL
             GROUP BY r.season, r.game_id, r.event_id HAVING count(*) > 1) x
     GROUP BY x.season
  ) e
 WHERE e.dups > 25;
$$;


ALTER FUNCTION "public"."check_xg_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_xg_integrity"() IS 'DEPRECATED -- reports on public.raw_shots, the RETIRED third-party import, whose xG carries the target leak (2025 separation ratio 22.42 against a real-world 3.09-3.61, calibration -20.93%). Its ERRORs describe a model the product no longer serves; the shipped model is nhl_shots.xg_sql and its gate is check_xg_integrity_v2(). Nothing calls this function or log_xg_integrity(): verified against cron.job, pg_proc and the repo on 2026-08-12. Kept as the record of what the leaked model looked like. Do not schedule it.';



CREATE OR REPLACE FUNCTION "public"."check_xg_integrity_v2"() RETURNS TABLE("severity" "text", "season" integer, "metric" "text", "value" numeric, "expected" "text", "issue" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
with s as (
  select n.season, count(*) shots, count(*) filter (where n.is_goal) goals, sum(n.xg_sql) sum_xg,
         avg(n.xg_sql) filter (where n.is_goal) avg_g,
         avg(n.xg_sql) filter (where not n.is_goal) avg_ng,
         count(*) filter (where not n.is_goal and n.xg_sql > 0.30) ng_hi,
         count(*) filter (where not n.is_goal) ng,
         count(*) filter (where n.xg_sql is null) nulls,
         count(*) filter (where n.distance_adj is null) unadjusted,
         count(*) filter (where n.is_empty_net) en_shots,
         count(*) filter (where n.is_empty_net and n.is_goal) en_goals,
         sum(n.xg_sql) filter (where n.is_empty_net) en_xg
    from public.nhl_shots n group by n.season
),
modal as (select season, max(cnt) modal_cnt
            from (select season, xg_sql, count(*) cnt from public.nhl_shots group by 1,2) m group by season),
gs as (select g.season, sum(g.gsax) league_gsax, count(*) goalie_rows
         from public.goalie_xg_season g group by g.season),
resid as (
  select s.season, s.goals, s.sum_xg, gs.league_gsax, gs.goalie_rows,
         (-(s.goals - s.sum_xg) - gs.league_gsax) as resid_goals,
         100.0 * (-(s.goals - s.sum_xg) - gs.league_gsax) / nullif(s.goals,0) as resid_pct
    from s left join gs on gs.season = s.season
)
select 'ERROR', r.season::int, 'xg_residual_after_gsax_pct', round(r.resid_pct::numeric,2),
       'within +/-3% of goals',
       'the gap between goals and xG is NOT absorbed by goalie GSAx -- this is model drift, not a finishing season'
  from resid r where r.goalie_rows > 0 and abs(r.resid_pct) > 3.0
union all
select 'WARN', r.season::int, 'xg_residual_after_gsax_pct', round(r.resid_pct::numeric,2),
       'within +/-1.5% of goals (observed 0.05% to 0.87%)',
       'more of the goals-vs-xG gap is unexplained by GSAx than usual -- watch for drift'
  from resid r where r.goalie_rows > 0 and abs(r.resid_pct) between 1.5 and 3.0
union all
select 'WARN', r.season::int, 'xg_residual_not_evaluated', 0::numeric,
       'goalie_xg_season populated for the season',
       'goalie_xg_season has no rows for this season, so the calibration gap cannot be checked against GSAx at all'
  from resid r where coalesce(r.goalie_rows,0) = 0
union all
select 'INFO', s.season::int, 'calibration_pct',
       round((100.0*(s.sum_xg - s.goals)/nullif(s.goals,0))::numeric,2),
       'informational -- judged via xg_residual_after_gsax_pct',
       'sum(xG) vs goals. A negative value in a high-shooting-percentage season is the league out-finishing the model, and is expected.'
  from s
union all
select 'WARN', s.season::int, 'empty_net_calibration_pct',
       round((100.0*(s.en_xg - s.en_goals)/nullif(s.en_goals,0))::numeric,1),
       'within +/-10%',
       'empty-net xG is effectively a constant (avg 0.583-0.599 every season) while the real EN conversion rate has fallen four seasons running -- EN carries ~7% of all xG on ~1% of shots, so this skews the handful of players who take them'
  from s where s.en_goals > 0 and abs(100.0*(s.en_xg - s.en_goals)/nullif(s.en_goals,0)) > 10.0
union all
select 'ERROR', s.season::int, 'separation_ratio', round((s.avg_g/nullif(s.avg_ng,0))::numeric,2),
       'between 2.0 and 6.0', 'xG separates goals from non-goals implausibly well -- leakage signature'
  from s where (s.avg_g/nullif(s.avg_ng,0)) not between 2.0 and 6.0
union all
select 'ERROR', s.season::int, 'pct_nongoals_above_0.30', round((100.0*s.ng_hi/nullif(s.ng,0))::numeric,3),
       'between 0.3% and 5%',
       'upper tail is gone (or implausible) -- the model has stopped distinguishing high-danger chances'
  from s where (100.0*s.ng_hi/nullif(s.ng,0)) not between 0.3 and 5.0
union all
select 'INFO', s.season::int, 'pct_nongoals_above_0.30', round((100.0*s.ng_hi/nullif(s.ng,0))::numeric,3),
       'informational: 0.8%+ is what a model with tracking features reaches',
       'thin upper tail -- expected for an official-PBP-only feature set, worse in older seasons; not a defect'
  from s where (100.0*s.ng_hi/nullif(s.ng,0)) between 0.3 and 0.8
union all
select 'ERROR', s.season::int, 'pct_rows_on_single_xg_value', round((100.0*m.modal_cnt/nullif(s.shots,0))::numeric,3),
       'below 3%', 'too many shots share one exact xG -- clip ceiling or hardcoded constant'
  from s join modal m on m.season = s.season where (100.0*m.modal_cnt/nullif(s.shots,0)) > 3.0
union all
select 'ERROR', s.season::int, 'null_xg_rows', s.nulls::numeric, 'zero', 'shots exist with no xG value' from s where s.nulls > 0
union all
select 'ERROR', s.season::int, 'unrink_adjusted_rows', s.unadjusted::numeric, 'zero',
       'shots exist whose coordinates were never rink-bias adjusted -- modelled on raw geometry'
  from s where s.unadjusted > 0
union all
select 'ERROR', g.season, 'games_ingested_without_shots', g.n::numeric, 'zero',
       'raw_nhl_data holds play-by-play for these games but nhl_shots has no rows for them'
  from (select substr(d.game_id::text,1,4)::int season, count(*) n from public.raw_nhl_data d
         where d.raw_json ? 'plays' and not exists (select 1 from public.nhl_shots r where r.game_id = d.game_id)
         group by 1) g
union all
select 'ERROR', z.season, 'games_with_zero_scored_shots', z.n::numeric, 'zero',
       'every shot in these games has a NULL xg_sql -- a scoring pass skipped whole games'
  from (select q.season, count(*) n from (select r.season, r.game_id from public.nhl_shots r
          group by 1,2 having count(r.xg_sql) = 0) q group by q.season) z;
$$;


ALTER FUNCTION "public"."check_xg_integrity_v2"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_xg_integrity_v2"() IS 'Health of the SHIPPED xG model (nhl_shots.xg_sql). Calibration is judged by the residual AFTER goalie GSAx, not by raw sum(xG) vs goals: in 2021 and 2022 the league out-finished the model by 629 and 670 goals and GSAx absorbed 586 and 666 of that, leaving residuals of 0.49% and 0.05%. A model forced to calibrate to zero each season could not produce a meaningful GSAx at all. Also watches the empty-net bucket, where xG is effectively a constant while the real conversion rate falls.';



CREATE OR REPLACE FUNCTION "public"."cleanup_expired_draft_reservations"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM draft_picks
  WHERE reserved_by IS NOT NULL
    AND reservation_expires_at <= NOW()
    AND deleted_at IS NULL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_draft_reservations"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_expired_draft_reservations"() IS 'Clean up expired draft reservations. Should be run every minute via cron job.';



CREATE OR REPLACE FUNCTION "public"."cleanup_old_audit_logs"("p_retention_days" integer DEFAULT 365) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted INT;
BEGIN
  -- auth.role() is the JWT role claim: 'authenticated'/'anon' for an end user arriving
  -- through PostgREST, 'service_role' for the backend, NULL for an internal caller such
  -- as pg_cron or a direct psql session. This guard survives someone re-granting EXECUTE.
  IF coalesce(auth.role(), 'internal') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'cleanup_old_audit_logs is an operator function and is not callable by end users'
      USING ERRCODE = '42501';
  END IF;

  -- A retention of zero or less means "delete the entire audit trail". Never legitimate.
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'refusing retention of % day(s): that would erase the whole audit log', p_retention_days
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.security_audit_log
   WHERE created_at < NOW() - (p_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.security_audit_log (event_type, details, severity)
  VALUES ('ADMIN_ACTION', jsonb_build_object(
            'action', 'audit_log_cleanup',
            'records_deleted', v_deleted,
            'retention_days', p_retention_days), 'INFO');

  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_audit_logs"("p_retention_days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_old_audit_logs"("p_retention_days" integer) IS 'SOC 2 CC6.5: Purge audit logs beyond retention period (default 365 days).';



CREATE OR REPLACE FUNCTION "public"."cleanup_old_backups"("p_days_to_keep" integer DEFAULT 30) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM team_lineups_backup_log
  WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % backups older than % days', v_deleted_count, p_days_to_keep;
  
  RETURN v_deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_backups"("p_days_to_keep" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_join_attempts"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Delete attempts older than 7 days
  DELETE FROM public.join_code_attempts
  WHERE attempt_time < now() - interval '7 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_join_attempts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_draft_and_sync"("p_league_id" "uuid", "p_draft_session_id" "uuid", "p_teams_count" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
  BEGIN PERFORM public.log_function_error('complete_draft_and_sync', SQLSTATE, SQLERRM, 'draft completion check failed', jsonb_build_object('league_id', p_league_id, 'draft_session_id', p_draft_session_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object(
    'is_complete', false,
    'error', SQLERRM,
    'message', 'Draft completion check failed'
  );
END;
$$;


ALTER FUNCTION "public"."complete_draft_and_sync"("p_league_id" "uuid", "p_draft_session_id" "uuid", "p_teams_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_team_id" "uuid", "p_round_number" integer, "p_pick_number" integer, "p_user_id" "uuid", "p_draft_session_id" "uuid") RETURNS TABLE("success" boolean, "message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reservation_id UUID;
BEGIN
  -- Check if user has a valid reservation
  SELECT id INTO v_reservation_id
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by = p_user_id
    AND reservation_expires_at > NOW()
    AND deleted_at IS NULL;
  
  IF v_reservation_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Reservation expired or not found'::TEXT;
    RETURN;
  END IF;
  
  -- Update reservation to become a real pick
  UPDATE draft_picks
  SET 
    team_id = p_team_id,
    round_number = p_round_number,
    pick_number = p_pick_number,
    draft_session_id = p_draft_session_id,
    picked_at = NOW(),
    reserved_by = NULL,
    reserved_at = NULL,
    reservation_expires_at = NULL
  WHERE id = v_reservation_id;
  
  RETURN QUERY SELECT TRUE, 'Pick confirmed'::TEXT;
END;
$$;


ALTER FUNCTION "public"."confirm_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_team_id" "uuid", "p_round_number" integer, "p_pick_number" integer, "p_user_id" "uuid", "p_draft_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_team_id" "uuid", "p_round_number" integer, "p_pick_number" integer, "p_user_id" "uuid", "p_draft_session_id" "uuid") IS 'Confirm a reserved pick and convert it to a permanent draft selection.';



CREATE OR REPLACE FUNCTION "public"."create_matchup_scoring_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_rules JSONB;
  v_stats JSONB;
BEGIN
  SELECT jsonb_object_agg(r.stat_key, r.multiplier)
    INTO v_rules
  FROM public.get_effective_scoring_rules(NEW.league_id) r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.stat_key,
           'name', COALESCE(c.display_name, r.stat_key),
           'points', r.multiplier,
           'enabled', true,
           'applies_to', c.applies_to
         ) ORDER BY r.stat_key), '[]'::jsonb)
    INTO v_stats
  FROM public.get_effective_scoring_rules(NEW.league_id) r
  LEFT JOIN public.stat_catalog c ON c.stat_key = r.stat_key;

  INSERT INTO public.matchup_scoring_snapshots(matchup_id, league_id, rules)
  VALUES (NEW.id, NEW.league_id,
          jsonb_build_object(
            'stats', v_stats,
            'rules', COALESCE(v_rules, '{}'::jsonb),
            'source', 'league_scoring_rules'
          ))
  ON CONFLICT (matchup_id) DO NOTHING;

  RETURN NEW;
END $$;


ALTER FUNCTION "public"."create_matchup_scoring_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notifications_from_transaction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_league_id uuid;
  v_user_id uuid;
  v_team_id uuid;
  v_player_id text;
  v_transaction_type text;
  v_team_name text;
  v_user_name text;
  v_player_name text;
  v_league_member_id uuid;
  v_notification_title text;
  v_notification_message text;
BEGIN
  -- Get transaction details
  v_league_id := NEW.league_id;
  v_user_id := NEW.user_id;
  v_team_id := NEW.team_id;
  v_player_id := NEW.player_id;
  v_transaction_type := NEW.type;
  
  -- Get team name
  SELECT team_name INTO v_team_name
  FROM public.teams
  WHERE id = v_team_id;
  
  -- Get user name (FIX: profiles has first_name and last_name, not full_name)
  SELECT COALESCE(
    NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
    'A user'
  ) INTO v_user_name
  FROM public.profiles
  WHERE id = v_user_id;
  
  -- Get player name (from staging tables - simplified for now)
  -- In production, you might want to join with a players table
  v_player_name := v_player_id; -- Placeholder - will be enriched by frontend
  
  -- Build notification content
  IF v_transaction_type = 'ADD' THEN
    v_notification_title := v_player_name || ' added';
    v_notification_message := v_user_name || ' added ' || v_player_name || ' to ' || COALESCE(v_team_name, 'their team');
  ELSIF v_transaction_type = 'DROP' THEN
    v_notification_title := v_player_name || ' dropped';
    v_notification_message := v_user_name || ' dropped ' || v_player_name || ' from ' || COALESCE(v_team_name, 'their team');
  ELSE
    -- Unknown type, skip
    RETURN NEW;
  END IF;
  
  -- Create notifications for all league members except the transaction owner
  FOR v_league_member_id IN
    SELECT DISTINCT t.owner_id
    FROM public.teams t
    WHERE t.league_id = v_league_id
      AND t.owner_id IS NOT NULL
      AND t.owner_id != v_user_id
  LOOP
    INSERT INTO public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata
    ) VALUES (
      v_league_id,
      v_league_member_id,
      v_transaction_type,
      v_notification_title,
      v_notification_message,
      jsonb_build_object(
        'transaction_id', NEW.id,
        'team_id', v_team_id,
        'player_id', v_player_id,
        'source', NEW.source
      )
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_notifications_from_transaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_waiver_priority_for_team"("p_league_id" "uuid", "p_team_id" "uuid") RETURNS TABLE("priority" integer, "success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_max_priority INT; v_new_priority INT; v_user_id UUID;
BEGIN
  SELECT t.owner_id INTO v_user_id
  FROM teams t WHERE t.id = p_team_id AND t.league_id = p_league_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::INT, false, 'Team not found or team has no owner'::TEXT;
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL AND v_user_id <> auth.uid() THEN
    RETURN QUERY SELECT NULL::INT, false, 'User does not own this team'::TEXT;
    RETURN;
  END IF;

  SELECT wp.priority INTO v_new_priority
  FROM waiver_priority wp
  WHERE wp.league_id = p_league_id AND wp.team_id = p_team_id;

  IF v_new_priority IS NOT NULL THEN
    RETURN QUERY SELECT v_new_priority, true, NULL::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(wp.priority), 0) INTO v_max_priority
  FROM waiver_priority wp WHERE wp.league_id = p_league_id;

  INSERT INTO waiver_priority (league_id, team_id, priority, updated_at)
  VALUES (p_league_id, p_team_id, v_max_priority + 1, NOW())
  ON CONFLICT (league_id, team_id) DO NOTHING;

  SELECT wp.priority INTO v_new_priority
  FROM waiver_priority wp
  WHERE wp.league_id = p_league_id AND wp.team_id = p_team_id;

  RETURN QUERY SELECT v_new_priority, true, NULL::TEXT;
END $$;


ALTER FUNCTION "public"."create_waiver_priority_for_team"("p_league_id" "uuid", "p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cron_schedule_grace"("p_schedule" "text") RETURNS interval
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN p_schedule IS NULL                                   THEN interval '48 hours'
    WHEN split_part(p_schedule,' ',3) <> '*'                  THEN interval '35 days'   -- day-of-month set: monthly
    WHEN split_part(p_schedule,' ',5) <> '*'                  THEN interval '9 days'    -- day-of-week set: weekly
    WHEN split_part(p_schedule,' ',2) <> '*'                  THEN interval '26 hours'  -- hour set: daily
    WHEN split_part(p_schedule,' ',1) <> '*'                  THEN interval '90 minutes'-- minute set: hourly
    ELSE interval '15 minutes'
  END;
$$;


ALTER FUNCTION "public"."cron_schedule_grace"("p_schedule" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_account"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id uuid := auth.uid();
  v_teams_deleted int := 0;
  v_leagues_deleted int := 0;
  v_leagues_reassigned int := 0;
  v_leagues_orphaned int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  DELETE FROM roster_assignments    WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);
  DELETE FROM team_lineups          WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);
  DELETE FROM waiver_claims         WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);
  DELETE FROM waiver_priority       WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);
  DELETE FROM fantasy_matchup_lines WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);
  DELETE FROM draft_picks           WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);
  DELETE FROM transaction_ledger    WHERE team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);

  -- Trade history keys on team1_id/team2_id and cascades on team delete; left for audit.

  DELETE FROM teams WHERE owner_id = v_user_id;
  GET DIAGNOSTICS v_teams_deleted = ROW_COUNT;

  DELETE FROM leagues
  WHERE commissioner_id = v_user_id
    AND id NOT IN (SELECT DISTINCT league_id FROM teams);   -- teams.league_id is NOT NULL, so NOT IN is safe
  GET DIAGNOSTICS v_leagues_deleted = ROW_COUNT;

  -- BLOCKER 1 (the one that actually fired). This picked the earliest REMAINING team's
  -- owner_id with no IS NOT NULL test. 38 teams in prod are unowned AI teams, so when the
  -- earliest survivor was one of them this wrote NULL into leagues.commissioner_id, which
  -- is NOT NULL -- aborting the whole deletion. Now only an owned team can inherit, and the
  -- EXISTS guard means we only touch leagues that actually have a successor.
  UPDATE leagues l
  SET commissioner_id = (
        SELECT t.owner_id FROM teams t
        WHERE t.league_id = l.id AND t.owner_id IS NOT NULL AND t.owner_id <> v_user_id
        ORDER BY t.created_at ASC
        LIMIT 1)
  WHERE l.commissioner_id = v_user_id
    AND EXISTS (SELECT 1 FROM teams t
                WHERE t.league_id = l.id AND t.owner_id IS NOT NULL AND t.owner_id <> v_user_id);
  GET DIAGNOSTICS v_leagues_reassigned = ROW_COUNT;

  -- Any league STILL naming the departing user has no human members left. It was previously
  -- destroyed silently by leagues.commissioner_id -> profiles ON DELETE CASCADE at the profile
  -- delete below. Same outcome, but now it is deliberate, counted, and returned to the caller
  -- instead of being decided by a foreign key nobody was looking at.
  DELETE FROM leagues l
  WHERE l.commissioner_id = v_user_id
    AND NOT EXISTS (SELECT 1 FROM teams t
                    WHERE t.league_id = l.id AND t.owner_id IS NOT NULL AND t.owner_id <> v_user_id);
  GET DIAGNOSTICS v_leagues_orphaned = ROW_COUNT;

  -- BLOCKER 2. public.user_privacy_consent does not exist in this database and never has.
  -- plpgsql bodies are not dependency-checked, so this parsed fine and threw at run time.
  -- Guarded rather than removed, so it starts working by itself if the table is ever created.
  IF to_regclass('public.user_privacy_consent') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.user_privacy_consent WHERE user_id = $1' USING v_user_id;
  END IF;

  -- BLOCKER 3. These four carry ON DELETE NO ACTION against auth.users, so the final
  -- auth.users delete would have thrown for any pool participant. 25 users in prod hold
  -- rows here and all 25 also own teams. They are the user's own submissions, so erasure
  -- deletes them. The last two are nullable references held BY other records ABOUT this user.
  DELETE FROM playoff_roster_picks     WHERE user_id = v_user_id;
  DELETE FROM playoff_bracket_picks    WHERE user_id = v_user_id;
  DELETE FROM playoff_confidence_picks WHERE user_id = v_user_id;
  DELETE FROM playoff_pool_standings   WHERE user_id = v_user_id;
  UPDATE keeper_designations SET approved_by   = NULL WHERE approved_by   = v_user_id;
  UPDATE leagues            SET pool_winner_id = NULL WHERE pool_winner_id = v_user_id;

  DELETE FROM profiles   WHERE id = v_user_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'teams_deleted', v_teams_deleted,
    'leagues_deleted', v_leagues_deleted,
    'leagues_reassigned', v_leagues_reassigned,
    'leagues_orphaned_deleted', v_leagues_orphaned
  );

EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('delete_user_account', SQLSTATE, SQLERRM, 'GDPR erasure rolled back - account left whole', NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
  -- Kept deliberately: this block is an implicit subtransaction, so a failure here rolls
  -- back every delete above and leaves the account whole rather than half-erased. Proven
  -- 2026-08-12: 3 rows survived a caught exception in a controlled probe.
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$_$;


ALTER FUNCTION "public"."delete_user_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_season_from_date"("game_date" "date") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
    year_part INTEGER;
    month_part INTEGER;
BEGIN
    year_part := EXTRACT(YEAR FROM game_date)::INTEGER;
    month_part := EXTRACT(MONTH FROM game_date)::INTEGER;
    
    -- NHL seasons: October (10) through June (06) of next year
    IF month_part >= 10 THEN
        RETURN year_part;
    ELSE
        RETURN year_part - 1;
    END IF;
END;
$$;


ALTER FUNCTION "public"."derive_season_from_date"("game_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_season_from_game_id"("game_id" integer) RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
    game_id_str TEXT;
    year_part INTEGER;
    month_part INTEGER;
BEGIN
    -- Convert game_id to string
    game_id_str := game_id::TEXT;
    
    -- Extract year (first 4 digits)
    year_part := SUBSTRING(game_id_str, 1, 4)::INTEGER;
    
    -- Extract month (digits 5-6)
    month_part := SUBSTRING(game_id_str, 5, 2)::INTEGER;
    
    -- NHL seasons: October (10) through June (06) of next year
    -- If month >= 10, season starts in that year
    -- If month < 10, season started in previous year
    IF month_part >= 10 THEN
        RETURN year_part;
    ELSE
        RETURN year_part - 1;
    END IF;
END;
$$;


ALTER FUNCTION "public"."derive_season_from_game_id"("game_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_and_recover_data_loss"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_before_count INTEGER;
  v_after_count INTEGER;
  v_loss_percentage NUMERIC;
  v_recovery_id UUID;
  v_teams_affected TEXT[];
  v_players_restored INTEGER := 0;
BEGIN
  -- This trigger fires AFTER DELETE on team_lineups
  -- If >10% of rows deleted, assume catastrophic failure and auto-recover
  
  -- Count rows before (from OLD table in statement-level trigger)
  -- For row-level, we'll check total table count
  SELECT COUNT(*) INTO v_after_count FROM team_lineups;
  
  -- We don't have access to before count in row-level trigger
  -- Instead, check if this team now has ZERO players
  SELECT 
    jsonb_array_length(COALESCE(starters, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(bench, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(ir, '[]'::jsonb))
  INTO v_before_count
  FROM team_lineups
  WHERE team_id = OLD.team_id;
  
  -- If team now has 0 players, this is likely a catastrophic delete
  IF v_before_count = 0 THEN
    RAISE WARNING '[AUTO_RECOVERY] Data loss detected for team %!', OLD.team_id;
    RAISE WARNING '[AUTO_RECOVERY] Attempting automatic recovery from draft_picks...';
    
    -- Attempt smart restore
    BEGIN
      PERFORM smart_restore_team_lineups(OLD.team_id);
      
      -- Log successful recovery
      INSERT INTO auto_recovery_log (
        trigger_reason,
        teams_affected,
        recovery_method,
        success,
        details
      )
      VALUES (
        'Team lost all players after DELETE',
        ARRAY[(SELECT team_name FROM teams WHERE id = OLD.team_id)],
        'smart_restore_team_lineups',
        true,
        'Successfully restored team ' || OLD.team_id || ' from draft_picks'
      );
      
      RAISE NOTICE '[AUTO_RECOVERY] ✅ Successfully restored team %', OLD.team_id;
      
    EXCEPTION
      WHEN OTHERS THEN
        -- Log failed recovery
        INSERT INTO auto_recovery_log (
          trigger_reason,
          teams_affected,
          recovery_method,
          success,
          details
        )
        VALUES (
          'Team lost all players after DELETE',
          ARRAY[(SELECT team_name FROM teams WHERE id = OLD.team_id)],
          'smart_restore_team_lineups',
          false,
          'Recovery failed: ' || SQLERRM
        );
        
        RAISE WARNING '[AUTO_RECOVERY] ❌ Failed to restore team %: %', OLD.team_id, SQLERRM;
    END;
  END IF;
  
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."detect_and_recover_data_loss"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."detect_and_recover_data_loss"() IS 'Detects catastrophic data loss in team_lineups and automatically restores from draft_picks.
Trigger is DISABLED by default - enable only after thorough testing.';



CREATE OR REPLACE FUNCTION "public"."detect_security_anomalies"() RETURNS TABLE("anomaly_type" "text", "severity" "text", "details" "text", "user_id" "uuid", "detected_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Detect 1: Users with roster assignments in leagues they don't belong to
  RETURN QUERY
  SELECT 
    'ORPHANED_ROSTER_ASSIGNMENT'::TEXT,
    'CRITICAL'::TEXT,
    'User has roster assignment in league without team ownership'::TEXT,
    ra.team_id,
    NOW()
  FROM public.roster_assignments ra
  WHERE NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = ra.team_id
      AND t.league_id = ra.league_id
  );
  
  -- Detect 2: Draft picks for players that don't exist in the active session
  RETURN QUERY
  SELECT 
    'DUPLICATE_PLAYER_ACROSS_TEAMS'::TEXT,
    'ERROR'::TEXT,
    'Player ' || dp.player_id || ' appears on multiple teams in league ' || dp.league_id::TEXT,
    dp.team_id,
    NOW()
  FROM public.draft_picks dp
  WHERE dp.deleted_at IS NULL
  GROUP BY dp.league_id, dp.player_id, dp.team_id
  HAVING COUNT(*) > 1;
  
  -- Detect 3: Teams without an owner in active leagues
  RETURN QUERY
  SELECT 
    'ORPHANED_TEAM'::TEXT,
    'WARN'::TEXT,
    'Team ' || t.team_name || ' has no owner in league ' || t.league_id::TEXT,
    t.id,
    NOW()
  FROM public.teams t
  WHERE t.owner_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id = t.league_id
    );
END;
$$;


ALTER FUNCTION "public"."detect_security_anomalies"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."detect_security_anomalies"() IS 'SOC 2 CC7.3: Detect potential security anomalies and data integrity issues.';



CREATE OR REPLACE FUNCTION "public"."draft_freeze_blockers"("p_upcoming_hours" integer DEFAULT 24, "p_live_hours" integer DEFAULT 6) RETURNS TABLE("league_id" "uuid", "league_name" "text", "reason" "text", "at_time" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- 1. a draft scheduled inside the freeze window
  SELECT l.id, l.name,
         'draft scheduled within ' || p_upcoming_hours || 'h',
         l.scheduled_draft_time
    FROM leagues l
   WHERE l.scheduled_draft_time IS NOT NULL
     AND l.scheduled_draft_time >= now()
     AND l.scheduled_draft_time <= now() + make_interval(hours => p_upcoming_hours)

  UNION ALL

  -- 2. a draft that is in progress AND demonstrably moving
  SELECT l.id, l.name,
         'draft in progress, last pick ' ||
           round(extract(epoch FROM (now() - p.last_pick)) / 60.0)::text || ' min ago',
         p.last_pick
    FROM leagues l
    JOIN LATERAL (
      SELECT max(d.picked_at) AS last_pick
        FROM draft_picks d
       WHERE d.league_id = l.id AND d.deleted_at IS NULL
    ) p ON true
   WHERE l.draft_status = 'in_progress'
     AND p.last_pick IS NOT NULL
     AND p.last_pick >= now() - make_interval(hours => p_live_hours)

  UNION ALL

  -- 3. in progress, no picks yet, but its scheduled start has just passed --
  --    the window where the room is open and the first pick is pending
  SELECT l.id, l.name,
         'draft in progress, scheduled start just passed, no picks yet',
         l.scheduled_draft_time
    FROM leagues l
   WHERE l.draft_status = 'in_progress'
     AND l.scheduled_draft_time IS NOT NULL
     AND l.scheduled_draft_time >= now() - make_interval(hours => p_live_hours)
     AND l.scheduled_draft_time <= now()
     AND NOT EXISTS (
       SELECT 1 FROM draft_picks d
        WHERE d.league_id = l.id AND d.deleted_at IS NULL);
$$;


ALTER FUNCTION "public"."draft_freeze_blockers"("p_upcoming_hours" integer, "p_live_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_trade_deadline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_league RECORD;
  v_deadline_week INT;
  v_current_week INT;
BEGIN
  -- Get league settings
  SELECT l.settings INTO v_league
  FROM public.leagues l
  WHERE l.id = NEW.league_id;

  IF NOT FOUND THEN
    RETURN NEW;  -- No league found, let it through (will fail on FK)
  END IF;

  -- Get trade deadline week (0 = no deadline)
  v_deadline_week := COALESCE((v_league.settings->>'tradeDeadlineWeek')::INT, 0);

  IF v_deadline_week = 0 THEN
    RETURN NEW;  -- No deadline set
  END IF;

  -- Get current week (max completed + 1, or max scheduled)
  SELECT COALESCE(MAX(m.week_number), 0) INTO v_current_week
  FROM public.matchups m
  WHERE m.league_id = NEW.league_id
    AND m.status IN ('in_progress', 'completed');

  -- If we're past the deadline, block the trade
  IF v_current_week >= v_deadline_week THEN
    RAISE EXCEPTION 'Trade deadline has passed (week %). No new trades allowed.', v_deadline_week;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_trade_deadline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enrich_pbp_season"("p_season" integer) RETURNS TABLE("goals_seen" integer, "rows_updated" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_goals int; v_rows int;
BEGIN
  UPDATE public.player_game_stats
     SET primary_assists=0, secondary_assists=0, nhl_ppp=0, nhl_shp=0,
         ppp=0, shp=0, nhl_shg=0, nhl_gwg=0, nhl_otg=0, nhl_ppa=0, nhl_sha=0
   WHERE season = p_season;

  CREATE TEMP TABLE _enr ON COMMIT DROP AS
  WITH gm AS (
    SELECT d.game_id, d.raw_json,
           (d.boxscore_json->'homeTeam'->>'id')::int AS h_id,
           (d.boxscore_json->'awayTeam'->>'id')::int AS a_id,
           (d.boxscore_json->'homeTeam'->>'score')::int AS h_sc,
           (d.boxscore_json->'awayTeam'->>'score')::int AS a_sc
      FROM public.raw_nhl_data d
     WHERE substring(d.game_id::text from 1 for 4)::int = p_season
       AND d.raw_json IS NOT NULL AND d.boxscore_json IS NOT NULL
  ), goals AS (
    SELECT gm.game_id, gm.h_id, gm.a_id, gm.h_sc, gm.a_sc,
           (p->>'sortOrder')::int AS so,
           (p->'details'->>'eventOwnerTeamId')::int AS team,
           (p->'details'->>'scoringPlayerId')::int AS scorer,
           (p->'details'->>'assist1PlayerId')::int AS a1,
           (p->'details'->>'assist2PlayerId')::int AS a2,
           nullif(p->>'situationCode','') AS sit,
           coalesce(p->'periodDescriptor'->>'periodType','REG') AS ptype,
           (p->'periodDescriptor'->>'number')::int AS pnum
      FROM gm CROSS JOIN LATERAL jsonb_array_elements(gm.raw_json->'plays') p
     WHERE (p->>'typeCode')::int = 505
       AND coalesce(p->'periodDescriptor'->>'periodType','') <> 'SO'
  ), strength AS (
    -- digits: [awayGoalie][awaySkaters][homeSkaters][homeGoalie]
    SELECT g.*,
           CASE WHEN g.team = g.h_id
                THEN substr(g.sit,3,1)::int + substr(g.sit,4,1)::int
                ELSE substr(g.sit,2,1)::int + substr(g.sit,1,1)::int END AS own_str,
           CASE WHEN g.team = g.h_id
                THEN substr(g.sit,2,1)::int + substr(g.sit,1,1)::int
                ELSE substr(g.sit,3,1)::int + substr(g.sit,4,1)::int END AS opp_str
      FROM goals g WHERE g.sit ~ '^[0-9]{4}$'
  ), flagged AS (
    SELECT s.*, (s.own_str > s.opp_str) AS is_pp, (s.own_str < s.opp_str) AS is_sh,
           (s.ptype='OT' OR s.pnum > 3) AS is_ot,
           row_number() OVER (PARTITION BY s.game_id, s.team ORDER BY s.so) AS team_goal_no,
           CASE WHEN s.h_sc > s.a_sc AND s.team = s.h_id THEN least(s.h_sc,s.a_sc)+1
                WHEN s.a_sc > s.h_sc AND s.team = s.a_id THEN least(s.h_sc,s.a_sc)+1
                ELSE NULL END AS gwg_index
      FROM strength s
  ), credits AS (
    SELECT game_id, scorer AS player_id, 1 AS g, 0 AS pa, 0 AS sa,
           (is_pp)::int AS ppg, (is_sh)::int AS shg, (is_pp)::int AS ppp, (is_sh)::int AS shp,
           coalesce((team_goal_no = gwg_index)::int,0) AS gwg, coalesce((is_ot)::int,0) AS otg
      FROM flagged WHERE scorer IS NOT NULL
    UNION ALL
    SELECT game_id, a1, 0,1,0, 0,0, (is_pp)::int,(is_sh)::int, 0,0 FROM flagged WHERE a1 IS NOT NULL
    UNION ALL
    SELECT game_id, a2, 0,0,1, 0,0, (is_pp)::int,(is_sh)::int, 0,0 FROM flagged WHERE a2 IS NOT NULL
  )
  SELECT game_id, player_id, sum(g)::int AS pbp_goals, sum(pa)::int AS prim_a,
         sum(sa)::int AS sec_a, sum(ppg)::int AS ppg, sum(shg)::int AS shg,
         sum(ppp)::int AS ppp, sum(shp)::int AS shp, sum(gwg)::int AS gwg, sum(otg)::int AS otg
    FROM credits GROUP BY game_id, player_id;

  SELECT count(*)::int INTO v_goals FROM _enr;

  UPDATE public.player_game_stats s
     SET primary_assists = coalesce(e.prim_a,0), secondary_assists = coalesce(e.sec_a,0),
         nhl_ppp = coalesce(e.ppp,0), nhl_shp = coalesce(e.shp,0),
         ppp = coalesce(e.ppp,0), shp = coalesce(e.shp,0),
         nhl_shg = coalesce(e.shg,0), nhl_gwg = coalesce(e.gwg,0), nhl_otg = coalesce(e.otg,0),
         nhl_ppa = greatest(coalesce(e.ppp,0)-coalesce(e.ppg,0),0),
         nhl_sha = greatest(coalesce(e.shp,0)-coalesce(e.shg,0),0),
         updated_at = now()
    FROM _enr e
   WHERE s.season = p_season AND s.game_id = e.game_id AND s.player_id = e.player_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  goals_seen := v_goals; rows_updated := v_rows;
  RETURN NEXT;
END $_$;


ALTER FUNCTION "public"."enrich_pbp_season"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eval_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season" integer) RETURNS TABLE("auc" numeric, "calibration" numeric, "shots" bigint, "goals" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
begin
  return query execute format($f$
    with sc as (
      select k.is_goal, coalesce(c5.rate,c4.rate,c3.rate,c2.rate,c1.rate,c0.rate) xg
        from public.nhl_xg_sql_keys_exp k
        join      public.nhl_xg_sql_cells c0 on c0.fold=%1$s and c0.lvl=0 and c0.ckey='ALL'
        left join public.nhl_xg_sql_cells c1 on c1.fold=%1$s and c1.lvl=1 and c1.ckey=k.%2$s1
        left join public.nhl_xg_sql_cells c2 on c2.fold=%1$s and c2.lvl=2 and c2.ckey=k.%2$s2
        left join public.nhl_xg_sql_cells c3 on c3.fold=%1$s and c3.lvl=3 and c3.ckey=k.%2$s3
        left join public.nhl_xg_sql_cells c4 on c4.fold=%1$s and c4.lvl=4 and c4.ckey=k.%2$s4
        left join public.nhl_xg_sql_cells c5 on c5.fold=%1$s and c5.lvl=5 and c5.ckey=k.%2$s5
       where k.season = %3$s),
    g as (select xg s, count(*) filter (where is_goal)::numeric p,
                 count(*) filter (where not is_goal)::numeric qq from sc group by 1),
    c as (select *, sum(qq) over (order by s rows between unbounded preceding and 1 preceding) qb from g)
    select round(sum(p*(coalesce(qb,0)+0.5*qq))/(sum(p)*sum(qq)),4),
           round(((select sum(xg) from sc)/nullif((select sum(is_goal::int) from sc),0))::numeric,4),
           (select count(*) from sc)::bigint, (select sum(is_goal::int) from sc)::bigint
      from c$f$, p_slot, p_pfx, p_season);
end $_$;


ALTER FUNCTION "public"."eval_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eval_xg_slot"("p_slot" integer, "p_season" integer) RETURNS TABLE("auc" numeric, "cal_ratio" numeric, "n" bigint, "goals" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with sc as (
    select k.is_goal, coalesce(c5.rate,c4.rate,c3.rate,c2.rate,c1.rate,c0.rate) as xg
    from nhl_xg_sql_keys k
    join      nhl_xg_sql_cells c0 on c0.fold=p_slot and c0.lvl=0 and c0.ckey='ALL'
    left join nhl_xg_sql_cells c1 on c1.fold=p_slot and c1.lvl=1 and c1.ckey=k.k1
    left join nhl_xg_sql_cells c2 on c2.fold=p_slot and c2.lvl=2 and c2.ckey=k.k2
    left join nhl_xg_sql_cells c3 on c3.fold=p_slot and c3.lvl=3 and c3.ckey=k.k3
    left join nhl_xg_sql_cells c4 on c4.fold=p_slot and c4.lvl=4 and c4.ckey=k.k4
    left join nhl_xg_sql_cells c5 on c5.fold=p_slot and c5.lvl=5 and c5.ckey=k.k5
    where k.season = p_season
  ),
  g as (select xg s, count(*) filter (where is_goal)::numeric p, count(*) filter (where not is_goal)::numeric qq from sc group by 1),
  c as (select *, sum(qq) over (order by s rows between unbounded preceding and 1 preceding) qb from g)
  select round(sum(p*(coalesce(qb,0)+0.5*qq))/(sum(p)*sum(qq)),4),
         round(((select sum(xg) from sc)/(select sum(is_goal::int) from sc))::numeric,4),
         (select count(*) from sc), (select sum(is_goal::int) from sc)
  from c;
$$;


ALTER FUNCTION "public"."eval_xg_slot"("p_slot" integer, "p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_trade"("p_trade_id" "uuid", "p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_offered_player_ids" "text"[], "p_requested_player_ids" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pid TEXT; v_now TIMESTAMPTZ := NOW();
  v_offered_moved INT := 0; v_requested_moved INT := 0;
  v_caller_uid UUID; v_from_team_size INT; v_to_team_size INT; v_max_roster_size INT;
  v_from_user UUID; v_to_user UUID; v_commissioner UUID;
  v_n_offered INT := COALESCE(array_length(p_offered_player_ids, 1), 0);
  v_n_requested INT := COALESCE(array_length(p_requested_player_ids, 1), 0);
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM teams WHERE id IN (p_from_team_id, p_to_team_id)
                     AND league_id = p_league_id AND owner_id = v_caller_uid) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: you are not an owner of either team');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_from_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'From-team does not exist in this league';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_to_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'To-team does not exist in this league';
  END IF;
  IF p_from_team_id = p_to_team_id THEN
    RAISE EXCEPTION 'A team cannot trade with itself';
  END IF;
  IF v_n_offered = 0 AND v_n_requested = 0 THEN
    RAISE EXCEPTION 'Trade moves no players';
  END IF;

  SELECT l.commissioner_id, COALESCE(NULLIF(l.roster_size, 0), 22)
    INTO v_commissioner, v_max_roster_size
  FROM leagues l WHERE l.id = p_league_id;

  SELECT COALESCE(owner_id, v_commissioner) INTO v_from_user FROM teams WHERE id = p_from_team_id;
  SELECT COALESCE(owner_id, v_commissioner) INTO v_to_user   FROM teams WHERE id = p_to_team_id;

  SELECT COUNT(*) INTO v_from_team_size FROM roster_assignments
   WHERE team_id = p_from_team_id AND league_id = p_league_id;
  SELECT COUNT(*) INTO v_to_team_size FROM roster_assignments
   WHERE team_id = p_to_team_id AND league_id = p_league_id;

  IF (v_from_team_size - v_n_offered + v_n_requested) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for proposing team (% players)', v_max_roster_size;
  END IF;
  IF (v_to_team_size - v_n_requested + v_n_offered) > v_max_roster_size THEN
    RAISE EXCEPTION 'Trade would exceed roster limit for accepting team (% players)', v_max_roster_size;
  END IF;

  FOREACH v_pid IN ARRAY COALESCE(p_offered_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Offered player % is not on from-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_to_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_from_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_from_team_id, p_to_team_id, v_pid, v_now);
    v_offered_moved := v_offered_moved + 1;
  END LOOP;

  FOREACH v_pid IN ARRAY COALESCE(p_requested_player_ids, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM roster_assignments
                    WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid) THEN
      RAISE EXCEPTION 'Requested player % is not on to-team roster', v_pid;
    END IF;
    UPDATE roster_assignments SET team_id = p_from_team_id, updated_at = v_now
     WHERE league_id = p_league_id AND team_id = p_to_team_id AND player_id = v_pid;
    PERFORM public.trade_move_player_lineup(p_league_id, p_to_team_id, p_from_team_id, v_pid, v_now);
    v_requested_moved := v_requested_moved + 1;
  END LOOP;

  INSERT INTO transaction_ledger (league_id, user_id, team_id, player_id, type, source, created_at)
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_to_user, p_to_team_id, x, 'TRADE', 'Trade out', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x
  UNION ALL
  SELECT p_league_id, v_from_user, p_from_team_id, x, 'TRADE', 'Trade in', v_now
    FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x;

  INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
  VALUES (p_league_id, p_trade_id, p_from_team_id, p_to_team_id,
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_offered_player_ids, ARRAY[]::text[])) x),
          ARRAY(SELECT x::int FROM unnest(COALESCE(p_requested_player_ids, ARRAY[]::text[])) x));

  RETURN jsonb_build_object('success', true,
    'offered_moved', v_offered_moved, 'requested_moved', v_requested_moved);

EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('execute_trade', SQLSTATE, SQLERRM, 'trade rolled back whole', jsonb_build_object('trade_id', p_trade_id, 'league_id', p_league_id, 'from_team_id', p_from_team_id, 'to_team_id', p_to_team_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;


ALTER FUNCTION "public"."execute_trade"("p_trade_id" "uuid", "p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_offered_player_ids" "text"[], "p_requested_player_ids" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."execute_trade"("p_trade_id" "uuid", "p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_offered_player_ids" "text"[], "p_requested_player_ids" "text"[]) IS 'Atomic trade execution with auth.uid() validation and roster-size enforcement. Validates ownership, checks roster limits, updates roster_assignments, logs to transaction_ledger and trade_history. Full rollback on any failure.';



CREATE OR REPLACE FUNCTION "public"."expire_stale_trade_offers"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_expired_count INT;
BEGIN
  -- Mark all pending trades past their expiration date as expired
  UPDATE public.trade_offers
  SET status = 'expired',
      processed_at = NOW()
  WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'processed_at', NOW()
  );
END;
$$;


ALTER FUNCTION "public"."expire_stale_trade_offers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."export_user_data"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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

  SELECT to_jsonb(p.*) INTO v_profile FROM profiles p WHERE p.id = v_user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) INTO v_teams
  FROM teams t WHERE t.owner_id = v_user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(l.*)), '[]'::jsonb) INTO v_leagues
  FROM leagues l WHERE l.id IN (SELECT league_id FROM teams WHERE owner_id = v_user_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(tl.*)), '[]'::jsonb) INTO v_transactions
  FROM transaction_ledger tl WHERE tl.team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(dp.*)), '[]'::jsonb) INTO v_draft_picks
  FROM draft_picks dp WHERE dp.team_id IN (SELECT id FROM teams WHERE owner_id = v_user_id);

  -- Same missing table as the deletion path; it made every export throw. Guarded, not removed.
  IF to_regclass('public.user_privacy_consent') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(pc.*)), ''[]''::jsonb)
             FROM public.user_privacy_consent pc WHERE pc.user_id = $1'
      INTO v_consent USING v_user_id;
  ELSE
    v_consent := '[]'::jsonb;
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'exported_at', now(), 'user_id', v_user_id,
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'teams', v_teams, 'leagues', v_leagues,
    'transactions', v_transactions, 'draft_picks', v_draft_picks,
    'privacy_consent', v_consent);

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('export_user_data', SQLSTATE, SQLERRM, 'GDPR export failed', NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$_$;


ALTER FUNCTION "public"."export_user_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_shots_season"("p_season" integer) RETURNS TABLE("games" integer, "shots" integer, "goals" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_games int; v_shots int; v_goals int;
BEGIN
  DELETE FROM public.nhl_shots WHERE season = p_season;

  INSERT INTO public.nhl_shots (
    game_id, event_id, season, game_date, game_type, period, period_type,
    seconds_elapsed, shooter_id, goalie_id, team_id, is_home,
    x_raw, y_raw, x_norm, y_norm, distance, angle, shot_type, event_type, is_goal,
    own_skaters, opp_skaters, own_goalie, opp_goalie, strength_state,
    is_power_play, is_shorthanded, is_empty_net, score_diff,
    assist1_id, assist2_id, prev_event_type, prev_x, prev_y,
    seconds_since_prev, distance_from_prev, is_rebound, is_rush)
  WITH gm AS (
    SELECT d.game_id, d.raw_json, d.game_date,
           CASE WHEN substr(d.game_id::text,5,2)='03' THEN 'playoff' ELSE 'regular' END AS gtype,
           (d.boxscore_json->'homeTeam'->>'id')::int AS h_id
      FROM public.raw_nhl_data d
     WHERE substring(d.game_id::text from 1 for 4)::int = p_season
       AND d.raw_json IS NOT NULL AND d.boxscore_json IS NOT NULL
  ), ev AS (
    SELECT gm.game_id, gm.game_date, gm.gtype, gm.h_id,
           (p->>'eventId')::int AS event_id,
           (p->>'sortOrder')::int AS so,
           (p->>'typeCode')::int AS tc,
           p->>'typeDescKey' AS tdesc,
           (p->'periodDescriptor'->>'number')::int AS period,
           coalesce(p->'periodDescriptor'->>'periodType','REG') AS ptype,
           p->>'timeInPeriod' AS tip,
           nullif(p->>'situationCode','') AS sit,
           (p->'details'->>'xCoord')::numeric AS x,
           (p->'details'->>'yCoord')::numeric AS y,
           p->'details'->>'shotType' AS stype,
           (p->'details'->>'eventOwnerTeamId')::int AS team_id,
           (p->'details'->>'goalieInNetId')::int AS goalie_id,
           coalesce((p->'details'->>'scoringPlayerId')::int,
                    (p->'details'->>'shootingPlayerId')::int) AS shooter_id,
           (p->'details'->>'assist1PlayerId')::int AS a1,
           (p->'details'->>'assist2PlayerId')::int AS a2
      FROM gm CROSS JOIN LATERAL jsonb_array_elements(gm.raw_json->'plays') p
     WHERE coalesce(p->'periodDescriptor'->>'periodType','') <> 'SO'
  ), seq AS (
    SELECT *,
           (coalesce(period,1)-1)*1200
             + split_part(tip,':',1)::int*60 + split_part(tip,':',2)::int AS secs,
           lag(tdesc) OVER (PARTITION BY game_id ORDER BY (coalesce(period,1)-1)*1200 + split_part(tip,':',1)::int*60 + split_part(tip,':',2)::int, so, event_id) AS prev_type,
           lag((ev.x)) OVER (PARTITION BY game_id ORDER BY (coalesce(period,1)-1)*1200 + split_part(tip,':',1)::int*60 + split_part(tip,':',2)::int, so, event_id) AS prev_x,
           lag((ev.y)) OVER (PARTITION BY game_id ORDER BY (coalesce(period,1)-1)*1200 + split_part(tip,':',1)::int*60 + split_part(tip,':',2)::int, so, event_id) AS prev_y,
           lag((coalesce(period,1)-1)*1200
               + split_part(tip,':',1)::int*60 + split_part(tip,':',2)::int)
             OVER (PARTITION BY game_id ORDER BY (coalesce(period,1)-1)*1200 + split_part(tip,':',1)::int*60 + split_part(tip,':',2)::int, so, event_id) AS prev_secs
      FROM ev
  ), scored AS (
    SELECT *,
           sum(CASE WHEN tc=505 AND team_id = h_id THEN 1 ELSE 0 END)
             OVER (PARTITION BY game_id ORDER BY secs, so, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS h_goals_before,
           sum(CASE WHEN tc=505 AND team_id <> h_id THEN 1 ELSE 0 END)
             OVER (PARTITION BY game_id ORDER BY secs, so, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS a_goals_before
      FROM seq
  ), shots AS (
    SELECT * FROM scored WHERE tc IN (505,506,507) AND x IS NOT NULL AND y IS NOT NULL
  ), calc AS (
    SELECT s.*,
           (s.team_id = s.h_id) AS is_home,
           CASE WHEN s.x < 0 THEN -s.x ELSE s.x END AS xn,
           CASE WHEN s.x < 0 THEN -s.y ELSE s.y END AS yn,
           CASE WHEN s.sit ~ '^[0-9]{4}$' THEN
                CASE WHEN s.team_id = s.h_id THEN substr(s.sit,3,1)::int ELSE substr(s.sit,2,1)::int END END AS own_sk,
           CASE WHEN s.sit ~ '^[0-9]{4}$' THEN
                CASE WHEN s.team_id = s.h_id THEN substr(s.sit,2,1)::int ELSE substr(s.sit,3,1)::int END END AS opp_sk,
           CASE WHEN s.sit ~ '^[0-9]{4}$' THEN
                CASE WHEN s.team_id = s.h_id THEN substr(s.sit,4,1)::int ELSE substr(s.sit,1,1)::int END END AS own_g,
           CASE WHEN s.sit ~ '^[0-9]{4}$' THEN
                CASE WHEN s.team_id = s.h_id THEN substr(s.sit,1,1)::int ELSE substr(s.sit,4,1)::int END END AS opp_g
      FROM shots s
  )
  SELECT c.game_id, c.event_id, p_season, c.game_date, c.gtype, c.period, c.ptype,
         c.secs, c.shooter_id, c.goalie_id, c.team_id, c.is_home,
         c.x, c.y, c.xn, c.yn,
         round(sqrt(power(89 - c.xn, 2) + power(c.yn, 2))::numeric, 3),
         round(degrees(atan2(c.yn, greatest(89 - c.xn, 0.001)))::numeric, 3),
         c.stype,
         CASE c.tc WHEN 505 THEN 'goal' WHEN 506 THEN 'shot-on-goal' ELSE 'missed-shot' END,
         (c.tc = 505),
         c.own_sk, c.opp_sk, c.own_g, c.opp_g,
         CASE WHEN c.own_sk IS NULL THEN NULL
              ELSE c.own_sk || 'v' || c.opp_sk END,
         (c.own_sk + c.own_g) > (c.opp_sk + c.opp_g),
         (c.own_sk + c.own_g) < (c.opp_sk + c.opp_g),
         (c.opp_g = 0),
         CASE WHEN c.is_home THEN coalesce(c.h_goals_before,0) - coalesce(c.a_goals_before,0)
              ELSE coalesce(c.a_goals_before,0) - coalesce(c.h_goals_before,0) END,
         c.a1, c.a2, c.prev_type, c.prev_x, c.prev_y,
         (c.secs - c.prev_secs)::numeric,
         CASE WHEN c.prev_x IS NOT NULL
              THEN round(sqrt(power(c.x - c.prev_x,2) + power(c.y - c.prev_y,2))::numeric,3) END,
         (c.prev_type IN ('shot-on-goal','missed-shot','blocked-shot') AND (c.secs - c.prev_secs) <= 3),
         (c.prev_type IN ('takeaway','giveaway','faceoff') AND (c.secs - c.prev_secs) <= 5
          AND abs(coalesce(c.prev_x,0)) < 25)
    FROM calc c;

  SELECT count(DISTINCT game_id), count(*), count(*) FILTER (WHERE is_goal)
    INTO v_games, v_shots, v_goals FROM public.nhl_shots WHERE season = p_season;
  games := v_games; shots := v_shots; goals := v_goals;
  RETURN NEXT;
END $_$;


ALTER FUNCTION "public"."extract_shots_season"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."extract_shots_season"("p_season" integer) IS 'Extracts nhl_shots from raw_nhl_data play-by-play. The event chain is ordered by GAME TIME ((period-1)*1200 + timeInPeriod), with sortOrder and eventId as tie-breakers only. It used to order by sortOrder alone, which the NHL feed does not keep monotonic in 2017-18 and 2018-19 -- that produced 12,092 shots with a negative seconds_since_prev (up to -26 minutes) and silently suppressed rebound and rush detection in both seasons.';



CREATE OR REPLACE FUNCTION "public"."fix_goalie_assists_season"("p_season" integer) RETURNS TABLE("rows_fixed" integer, "assists_recovered" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_rows int; v_ast int;
BEGIN
  SELECT count(*)::int,
         coalesce(sum(primary_assists + secondary_assists - nhl_assists),0)::int
    INTO v_rows, v_ast
    FROM public.player_game_stats
   WHERE season = p_season AND is_goalie
     AND primary_assists + secondary_assists <> nhl_assists;

  UPDATE public.player_game_stats
     SET nhl_assists = primary_assists + secondary_assists,
         nhl_points  = nhl_goals + primary_assists + secondary_assists,
         points      = nhl_goals + primary_assists + secondary_assists,
         updated_at  = now()
   WHERE season = p_season AND is_goalie
     AND primary_assists + secondary_assists <> nhl_assists;

  rows_fixed := v_rows; assists_recovered := v_ast;
  RETURN NEXT;
END $$;


ALTER FUNCTION "public"."fix_goalie_assists_season"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fix_goalie_decisions_season"("p_season" integer) RETURNS TABLE("games" integer, "changed" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_games int; v_changed int;
BEGIN
  WITH g AS (
    SELECT d.game_id, d.raw_json, d.boxscore_json AS bx,
           (d.boxscore_json->'homeTeam'->>'score')::int AS h_score,
           (d.boxscore_json->'awayTeam'->>'score')::int AS a_score,
           (d.boxscore_json->'homeTeam'->>'id')::int AS h_id,
           (d.boxscore_json->'awayTeam'->>'id')::int AS a_id,
           coalesce(d.boxscore_json->'gameOutcome'->>'lastPeriodType','REG') AS lastp
      FROM public.raw_nhl_data d
     WHERE substring(d.game_id::text from 1 for 4)::int = p_season
       AND d.boxscore_json IS NOT NULL AND d.raw_json IS NOT NULL
  ), meta AS (
    SELECT *, CASE WHEN h_score > a_score THEN h_id ELSE a_id END AS win_team,
              CASE WHEN h_score > a_score THEN a_id ELSE h_id END AS lose_team,
              least(h_score, a_score) AS loser_goals
      FROM g WHERE h_score <> a_score
  ), ev AS (
    SELECT m.game_id, m.win_team, m.lose_team, m.loser_goals, m.lastp,
           (p->>'typeCode')::int AS tc,
           (p->>'sortOrder')::int AS so,
           (p->'details'->>'eventOwnerTeamId')::int AS owner,
           (p->'details'->>'goalieInNetId')::int AS goalie_in_net,
           coalesce(p->'periodDescriptor'->>'periodType','REG') AS ptype
      FROM meta m
      CROSS JOIN LATERAL jsonb_array_elements(m.raw_json->'plays') p
     WHERE (p->>'typeCode')::int IN (505,506,507)
  ), wgoals AS (
    SELECT game_id, win_team, lose_team, loser_goals, lastp, so, goalie_in_net,
           row_number() OVER (PARTITION BY game_id ORDER BY so) AS goal_no
      FROM ev WHERE tc = 505 AND owner = win_team AND ptype <> 'SO'
  ), gwg AS (
    SELECT game_id, win_team, lose_team, lastp, so AS gwg_so,
           goalie_in_net AS losing_goalie
      FROM wgoals WHERE goal_no = loser_goals + 1
  ), win_goalie AS (
    SELECT DISTINCT ON (w.game_id) w.game_id, e.goalie_in_net AS winning_goalie
      FROM gwg w
      JOIN ev e ON e.game_id = w.game_id AND e.owner = w.lose_team
                AND e.goalie_in_net IS NOT NULL AND e.ptype <> 'SO'
     ORDER BY w.game_id, abs(e.so - w.gwg_so)
  ), decided AS (
    SELECT g.game_id, g.losing_goalie, wg.winning_goalie, g.lastp
      FROM gwg g LEFT JOIN win_goalie wg USING (game_id)
     WHERE g.losing_goalie IS NOT NULL AND wg.winning_goalie IS NOT NULL
  ), upd AS (
    UPDATE public.player_game_stats s
       SET nhl_wins  = CASE WHEN s.player_id = d.winning_goalie THEN 1 ELSE 0 END,
           wins      = CASE WHEN s.player_id = d.winning_goalie THEN 1 ELSE 0 END,
           nhl_losses= CASE WHEN s.player_id = d.losing_goalie AND d.lastp='REG' THEN 1 ELSE 0 END,
           nhl_ot_losses = CASE WHEN s.player_id = d.losing_goalie AND d.lastp<>'REG' THEN 1 ELSE 0 END,
           updated_at = now()
      FROM decided d
     WHERE s.game_id = d.game_id AND s.season = p_season AND s.is_goalie
       AND (s.nhl_wins <> CASE WHEN s.player_id = d.winning_goalie THEN 1 ELSE 0 END
         OR s.nhl_losses <> CASE WHEN s.player_id = d.losing_goalie AND d.lastp='REG' THEN 1 ELSE 0 END
         OR s.nhl_ot_losses <> CASE WHEN s.player_id = d.losing_goalie AND d.lastp<>'REG' THEN 1 ELSE 0 END)
     RETURNING 1)
  SELECT (SELECT count(*)::int FROM decided), (SELECT count(*)::int FROM upd)
    INTO v_games, v_changed;

  games := v_games; changed := v_changed;
  RETURN NEXT;
END $$;


ALTER FUNCTION "public"."fix_goalie_decisions_season"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gate_assist_split"("p_season" integer) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_sk int; v_go int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT is_goalie), count(*) FILTER (WHERE is_goalie)
    INTO v_sk, v_go
    FROM public.player_game_stats
   WHERE season = p_season AND primary_assists + secondary_assists <> nhl_assists;

  IF v_sk > 0 THEN
    PERFORM public.record_rebuild_audit(p_season,'assist_split_exact',0,v_sk,
      'SKATER assist split mismatch — investigate');
    RAISE EXCEPTION 'season %: % skater rows with assist split <> boxscore', p_season, v_sk;
  END IF;

  PERFORM public.record_rebuild_audit(p_season,'assist_split_exact',0,v_sk,
    format('skaters exact; goalie rows remaining=%s (should be 0 after goalie-assist recovery)', v_go));
  RETURN format('season %s: skater split exact, goalie residual %s', p_season, v_go);
END $$;


ALTER FUNCTION "public"."gate_assist_split"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_playoff_bracket"("p_league_id" "uuid", "p_consolation_enabled" boolean DEFAULT false, "p_two_week_matchups" boolean DEFAULT false, "p_reseed_each_round" boolean DEFAULT false, "p_seeding_method" "text" DEFAULT 'standings'::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bracket_id UUID;
  v_league RECORD;
  v_bracket_size INT;
  v_total_rounds INT;
  v_playoff_teams INT;
  v_team_count INT;
  v_regular_season_weeks INT;
  v_playoff_start_week INT;
  v_team RECORD;
  v_seed_num INT := 0;
  v_series_season INT;
  v_qf1 UUID; v_qf2 UUID; v_qf3 UUID; v_qf4 UUID;
  v_sf1 UUID; v_sf2 UUID;
  v_finals UUID;
  v_third_place UUID;
  v_con_sf1 UUID; v_con_sf2 UUID; v_con_finals UUID;
  v_con_r1_1 UUID; v_con_r1_2 UUID;
  v_week_offset INT;
BEGIN
  IF EXTRACT(MONTH FROM NOW()) >= 10 THEN
    v_series_season := EXTRACT(YEAR FROM NOW())::INT;
  ELSE
    v_series_season := (EXTRACT(YEAR FROM NOW()) - 1)::INT;
  END IF;

  SELECT l.*,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams,
    COALESCE((l.settings->>'playoffWeeks')::INT, 3) AS cfg_playoff_weeks,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  -- Allow admin/service callers (auth.uid() IS NULL) to bypass commissioner gate
  IF auth.uid() IS NOT NULL AND v_league.commissioner_id != auth.uid() THEN
    RETURN json_build_object('error', 'Only the commissioner can generate playoff brackets');
  END IF;

  IF v_league.cfg_league_type != 'fantasy' THEN
    RETURN json_build_object('error', 'Playoff brackets are only available for fantasy leagues');
  END IF;

  IF v_league.draft_status != 'completed' THEN
    RETURN json_build_object('error', 'Draft must be completed before generating playoffs');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
    AND pb.season = v_series_season
    AND pb.status != 'completed'
  ) THEN
    RETURN json_build_object('error', 'An active playoff bracket already exists. Reset it first.');
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = p_league_id;

  v_playoff_teams := v_league.cfg_playoff_teams;
  IF v_playoff_teams > v_team_count THEN v_playoff_teams := v_team_count; END IF;

  IF v_playoff_teams >= 8 THEN v_bracket_size := 8;
  ELSIF v_playoff_teams >= 6 THEN v_bracket_size := 6;
  ELSIF v_playoff_teams >= 4 THEN v_bracket_size := 4;
  ELSE RETURN json_build_object('error', 'Need at least 4 teams for playoffs');
  END IF;

  IF v_bracket_size = 8 THEN v_total_rounds := 3;
  ELSIF v_bracket_size = 6 THEN v_total_rounds := 3;
  ELSE v_total_rounds := 2;
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_season_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_season_weeks
    FROM public.matchups m WHERE m.league_id = p_league_id;
  END IF;
  v_playoff_start_week := v_regular_season_weeks + 1;

  INSERT INTO public.playoff_brackets (
    league_id, season, bracket_size, status, current_round, total_rounds,
    seeding_method, reseed_each_round, consolation_enabled, two_week_matchups,
    generated_by, started_at
  ) VALUES (
    p_league_id, v_series_season, v_bracket_size, 'active', 1, v_total_rounds,
    p_seeding_method, p_reseed_each_round, p_consolation_enabled, p_two_week_matchups,
    auth.uid(), NOW()
  )
  RETURNING id INTO v_bracket_id;

  v_seed_num := 0;
  FOR v_team IN
    SELECT t.id AS team_id,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
                        ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
                        ELSE 0 END), 0) AS losses,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
                        WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
                        ELSE 0 END), 0) AS ties,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id THEN m.team1_score
                        WHEN m.team2_id = t.id THEN m.team2_score
                        ELSE 0 END), 0) AS points_for
    FROM public.teams t
    LEFT JOIN public.matchups m ON ((m.team1_id = t.id OR m.team2_id = t.id)
      AND m.league_id = p_league_id AND m.week_number <= v_regular_season_weeks)
    WHERE t.league_id = p_league_id
    GROUP BY t.id
    ORDER BY wins DESC, points_for DESC, losses ASC
    LIMIT v_bracket_size
  LOOP
    v_seed_num := v_seed_num + 1;
    INSERT INTO public.playoff_seeds (
      bracket_id, team_id, seed_number,
      regular_season_wins, regular_season_losses, regular_season_ties,
      regular_season_points_for, source
    ) VALUES (
      v_bracket_id, v_team.team_id, v_seed_num,
      v_team.wins, v_team.losses, v_team.ties,
      v_team.points_for, p_seeding_method
    );
  END LOOP;

  IF v_bracket_size = 8 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 8, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 3, 'winners', 2, 7, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf3;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 4, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf4;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'home' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'home' WHERE id = v_qf3;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf4;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;

      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_1;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 2, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_2;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_con_finals;

      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'home' WHERE id = v_qf1;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'away' WHERE id = v_qf2;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'home' WHERE id = v_qf3;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'away' WHERE id = v_qf4;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'home' WHERE id = v_con_r1_1;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'away' WHERE id = v_con_r1_2;
    END IF;

  ELSIF v_bracket_size = 6 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 1, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 2, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;

  ELSE
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 4, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 2, 3, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;
  END IF;

  UPDATE public.playoff_series ps
  SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed),
      away_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.away_seed)
  WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 1 AND ps.home_seed IS NOT NULL;

  IF v_bracket_size = 6 THEN
    UPDATE public.playoff_series ps
    SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed)
    WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 2 AND ps.home_seed IS NOT NULL;
  END IF;

  INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
  SELECT p_league_id, ps.matchup_week_1, ps.home_team_id, ps.away_team_id,
    0, 0, 'scheduled', CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
  FROM public.playoff_series ps
  WHERE ps.bracket_id = v_bracket_id AND ps.home_team_id IS NOT NULL AND ps.away_team_id IS NOT NULL AND ps.status = 'active'
  ON CONFLICT DO NOTHING;

  RETURN json_build_object(
    'bracket_id', v_bracket_id,
    'bracket_size', v_bracket_size,
    'total_rounds', v_total_rounds,
    'playoff_start_week', v_playoff_start_week,
    'consolation_enabled', p_consolation_enabled,
    'two_week_matchups', p_two_week_matchups,
    'success', true
  );
END;
$$;


ALTER FUNCTION "public"."generate_playoff_bracket"("p_league_id" "uuid", "p_consolation_enabled" boolean, "p_two_week_matchups" boolean, "p_reseed_each_round" boolean, "p_seeding_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_age_multiplier"("p_age" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_age is null then 1.00
    when p_age <= 19 then 1.10
    when p_age = 20 then 1.08
    when p_age = 21 then 1.06
    when p_age = 22 then 1.06
    when p_age = 23 then 1.04
    when p_age = 24 then 1.02
    when p_age = 25 then 1.01
    when p_age = 26 then 1.00
    when p_age = 27 then 1.00
    when p_age = 28 then 0.99
    when p_age = 29 then 0.98
    when p_age = 30 then 0.97
    when p_age = 31 then 0.96
    when p_age = 32 then 0.95
    when p_age = 33 then 0.94
    when p_age = 34 then 0.94
    else 0.93
  end::numeric;
$$;


ALTER FUNCTION "public"."get_age_multiplier"("p_age" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_age_multiplier"("p_age" integer) IS 'Measured NHL aging curve (delta method, consecutive-season pairs). Floored at 0.93 from age 35 because the raw 35+ measurement is survivorship-biased upward.';



CREATE OR REPLACE FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_canonical TEXT;
BEGIN
    -- Look up the canonical code for this team
    SELECT canonical_team_code
    INTO v_canonical
    FROM public.team_mapping_config
    WHERE p_team_code = ANY(aliased_team_codes)
    ORDER BY effective_date DESC
    LIMIT 1;
    
    -- If no mapping found, return the original code
    RETURN COALESCE(v_canonical, p_team_code);
END;
$$;


ALTER FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") IS 'Returns the canonical team code for a given team code. If no mapping exists, returns the original code.';



CREATE OR REPLACE FUNCTION "public"."get_current_pool_week"("p_on" "date" DEFAULT CURRENT_DATE, "p_season" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE v_season INT; v_first DATE; v_w1 DATE;
BEGIN
  -- Inverse of get_pool_week_dates. Deliberately reuses get_current_season and the
  -- same week-1 anchor (the Sunday on or before the opener) rather than inventing a
  -- second week rule, so the two can never disagree.
  v_season := COALESCE(p_season, public.get_current_season(p_on));
  SELECT MIN(g.game_date) INTO v_first FROM nhl_games g WHERE g.season = v_season;
  IF v_first IS NULL THEN RETURN NULL; END IF;
  v_w1 := v_first - (EXTRACT(DOW FROM v_first)::INT || ' days')::INTERVAL;
  RETURN GREATEST(1, FLOOR((p_on - v_w1) / 7.0)::INT + 1);
END $$;


ALTER FUNCTION "public"."get_current_pool_week"("p_on" "date", "p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_current_pool_week"("p_on" "date", "p_season" integer) IS 'Week number for a date, inverse of get_pool_week_dates. Anchored on the Sunday on or before the season opener.';



CREATE OR REPLACE FUNCTION "public"."get_current_season"("p_on" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    -- 1. the loaded regular-season schedule that actually spans this date
    (SELECT g.season
       FROM nhl_games g
      WHERE g.game_type = 'regular'
      GROUP BY g.season
     HAVING min(g.game_date) <= p_on AND max(g.game_date) >= p_on
      ORDER BY g.season DESC
      LIMIT 1),
    -- 2. between seasons: the most recent one that has already begun
    (SELECT max(g.season)
       FROM nhl_games g
      WHERE g.game_type = 'regular' AND g.game_date <= p_on),
    -- 3. no schedule loaded at all: fall back to the calendar rule
    public.get_nhl_season_year(p_on)
  );
$$;


ALTER FUNCTION "public"."get_current_season"("p_on" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_game_stats"("p_player_ids" integer[], "p_game_date" "date") RETURNS TABLE("player_id" integer, "game_id" bigint, "is_goalie" boolean, "goals" integer, "assists" integer, "points" integer, "shots_on_goal" integer, "pim" integer, "plus_minus" integer, "toi_seconds" integer, "hits" integer, "blocks" integer, "faceoff_wins" integer, "faceoff_losses" integer, "faceoff_taken" integer, "takeaways" integer, "giveaways" integer, "ppp" integer, "ppg" integer, "ppa" integer, "shp" integer, "shg" integer, "sha" integer, "shots_missed" integer, "shots_blocked" integer, "shot_attempts" integer, "gwg" integer, "otg" integer, "shifts" integer, "wins" integer, "losses" integer, "ot_losses" integer, "saves" integer, "shots_faced" integer, "goals_against" integer, "shutouts" integer, "save_pct" numeric, "even_saves" integer, "even_shots_against" integer, "pp_saves" integer, "pp_shots_against" integer, "sh_saves" integer, "sh_shots_against" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    pgs.player_id,
    pgs.game_id,
    pgs.is_goalie,
    
    -- Core stats (use ONLY nhl_* columns - official NHL stats)
    -- No fallback to PBP data - we have everything we need in NHL official stats
    COALESCE(pgs.nhl_goals, 0) as goals,
    COALESCE(pgs.nhl_assists, 0) as assists,
    COALESCE(pgs.nhl_points, 0) as points,
    -- SOG: Use ONLY nhl_shots_on_goal (scraper extracts from boxscore "shots" field)
    COALESCE(pgs.nhl_shots_on_goal, 0) as shots_on_goal,
    -- PIM: Use nhl_pim
    COALESCE(pgs.nhl_pim, 0) as pim,
    COALESCE(pgs.nhl_plus_minus, 0) as plus_minus,
    COALESCE(pgs.nhl_toi_seconds, 0) as toi_seconds,
    
    -- Physical stats: Use ONLY nhl_* columns
    COALESCE(pgs.nhl_hits, 0) as hits,
    COALESCE(pgs.nhl_blocks, 0) as blocks,
    
    -- Faceoffs
    COALESCE(pgs.nhl_faceoff_wins, 0) as faceoff_wins,
    COALESCE(pgs.nhl_faceoff_losses, 0) as faceoff_losses,
    COALESCE(pgs.nhl_faceoff_taken, 0) as faceoff_taken,
    
    -- Possession
    COALESCE(pgs.nhl_takeaways, 0) as takeaways,
    COALESCE(pgs.nhl_giveaways, 0) as giveaways,
    
    -- Power Play: Calculate from components if nhl_ppp is 0
    -- Components (nhl_ppg, nhl_ppa) are always extracted from boxscore
    -- If nhl_ppp is 0 but components exist, calculate it
    COALESCE(
      NULLIF(pgs.nhl_ppp, 0),
      (COALESCE(pgs.nhl_ppg, 0) + COALESCE(pgs.nhl_ppa, 0))
    ) as ppp,
    COALESCE(pgs.nhl_ppg, 0) as ppg,
    COALESCE(pgs.nhl_ppa, 0) as ppa,
    
    -- Shorthanded: Calculate from components if nhl_shp is 0
    -- Components (nhl_shg, nhl_sha) are always extracted from boxscore
    -- If nhl_shp is 0 but components exist, calculate it
    COALESCE(
      NULLIF(pgs.nhl_shp, 0),
      (COALESCE(pgs.nhl_shg, 0) + COALESCE(pgs.nhl_sha, 0))
    ) as shp,
    COALESCE(pgs.nhl_shg, 0) as shg,
    COALESCE(pgs.nhl_sha, 0) as sha,
    
    -- Shot metrics
    COALESCE(pgs.nhl_shots_missed, 0) as shots_missed,
    COALESCE(pgs.nhl_shots_blocked, 0) as shots_blocked,
    COALESCE(pgs.nhl_shot_attempts, 0) as shot_attempts,
    
    -- Game context
    COALESCE(pgs.nhl_gwg, 0) as gwg,
    COALESCE(pgs.nhl_otg, 0) as otg,
    COALESCE(pgs.nhl_shifts, 0) as shifts,
    
    -- Goalie core - USE FALLBACK: nhl_* columns may not be populated for all goalie games
    COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) as wins,
    COALESCE(pgs.nhl_losses, 0) as losses,
    COALESCE(pgs.nhl_ot_losses, 0) as ot_losses,
    COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) as saves,
    COALESCE(NULLIF(pgs.nhl_shots_faced, 0), pgs.shots_faced, 0) as shots_faced,
    COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) as goals_against,
    COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) as shutouts,
    COALESCE(pgs.nhl_save_pct, 0.000) as save_pct,
    
    -- Goalie situation splits
    COALESCE(pgs.nhl_even_saves, 0) as even_saves,
    COALESCE(pgs.nhl_even_shots_against, 0) as even_shots_against,
    COALESCE(pgs.nhl_pp_saves, 0) as pp_saves,
    COALESCE(pgs.nhl_pp_shots_against, 0) as pp_shots_against,
    COALESCE(pgs.nhl_sh_saves, 0) as sh_saves,
    COALESCE(pgs.nhl_sh_shots_against, 0) as sh_shots_against
    
  FROM public.player_game_stats pgs
  INNER JOIN public.nhl_games ng ON pgs.game_id = ng.game_id
  WHERE pgs.player_id = ANY(p_player_ids)
    AND ng.game_date = p_game_date;
$$;


ALTER FUNCTION "public"."get_daily_game_stats"("p_player_ids" integer[], "p_game_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_lineup"("p_team_id" "uuid", "p_matchup_id" "uuid", "p_date" "date") RETURNS TABLE("player_id" integer, "player_name" "text", "player_position" "text", "nhl_team" "text", "headshot_url" "text", "slot_type" "text", "slot_id" "text", "is_locked" boolean, "daily_points" numeric, "goals" integer, "assists" integer, "shots_on_goal" integer, "blocks" integer, "hits" integer, "pim" integer, "ppp" integer, "shp" integer, "wins" integer, "saves" integer, "goals_against" integer, "shutouts" integer, "is_goalie" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_league_id UUID;
  v_goalie_wins_weight NUMERIC(10, 3) := 4.0;
  v_goalie_saves_weight NUMERIC(10, 3) := 0.2;
  v_goalie_shutouts_weight NUMERIC(10, 3) := 3.0;
  v_goalie_ga_weight NUMERIC(10, 3) := -1.0;
  v_skater_goals_weight NUMERIC(10, 3) := 3.0;
  v_skater_assists_weight NUMERIC(10, 3) := 2.0;
  v_skater_ppp_weight NUMERIC(10, 3) := 1.0;
  v_skater_shp_weight NUMERIC(10, 3) := 2.0;
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.5;
  v_skater_hits_weight NUMERIC(10, 3) := 0.2;
  v_skater_pim_weight NUMERIC(10, 3) := 0.5;
  v_scoring_settings JSONB;
BEGIN
  SELECT m.league_id, l.scoring_settings
  INTO v_league_id, v_scoring_settings
  FROM matchups m
  LEFT JOIN leagues l ON m.league_id = l.id
  WHERE m.id = p_matchup_id;

  IF v_scoring_settings IS NOT NULL THEN
    IF v_scoring_settings->'goalie' IS NOT NULL THEN
      v_goalie_wins_weight     := COALESCE((v_scoring_settings->'goalie'->>'wins')::numeric, 4.0);
      v_goalie_saves_weight    := COALESCE((v_scoring_settings->'goalie'->>'saves')::numeric, 0.2);
      v_goalie_shutouts_weight := COALESCE((v_scoring_settings->'goalie'->>'shutouts')::numeric, 3.0);
      v_goalie_ga_weight       := COALESCE((v_scoring_settings->'goalie'->>'goals_against')::numeric, -1.0);
    END IF;
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_skater_goals_weight   := COALESCE((v_scoring_settings->'skater'->>'goals')::numeric, 3.0);
      v_skater_assists_weight := COALESCE((v_scoring_settings->'skater'->>'assists')::numeric, 2.0);
      v_skater_ppp_weight     := COALESCE((v_scoring_settings->'skater'->>'power_play_points')::numeric, 1.0);
      v_skater_shp_weight     := COALESCE((v_scoring_settings->'skater'->>'short_handed_points')::numeric, 2.0);
      v_skater_sog_weight     := COALESCE((v_scoring_settings->'skater'->>'shots_on_goal')::numeric, 0.4);
      v_skater_blocks_weight  := COALESCE((v_scoring_settings->'skater'->>'blocks')::numeric, 0.5);
      v_skater_hits_weight    := COALESCE((v_scoring_settings->'skater'->>'hits')::numeric, 0.2);
      v_skater_pim_weight     := COALESCE((v_scoring_settings->'skater'->>'penalty_minutes')::numeric, 0.5);
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    fdr.player_id,
    COALESCE(pd.full_name, 'Player ' || fdr.player_id::text) AS player_name,
    COALESCE(pd.position_code,
             CASE WHEN COALESCE(pgs.is_goalie, false) THEN 'G' ELSE 'UNK' END) AS player_position,
    pd.team_abbrev AS nhl_team,
    pd.headshot_url,
    fdr.slot_type,
    fdr.slot_id,
    fdr.is_locked,
    COALESCE(
      CASE
        WHEN COALESCE(pd.is_goalie, pgs.is_goalie, false)
          OR COALESCE(pd.position_code, '') = 'G' THEN
          (COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) * v_goalie_wins_weight) +
          (COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) * v_goalie_saves_weight) +
          (COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) * v_goalie_shutouts_weight) +
          (COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) * v_goalie_ga_weight)
        ELSE
          (COALESCE(pgs.nhl_goals, pgs.goals, 0) * v_skater_goals_weight) +
          (COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) * v_skater_assists_weight) +
          (COALESCE(pgs.nhl_ppp, pgs.ppp, 0) * v_skater_ppp_weight) +
          (COALESCE(pgs.nhl_shp, pgs.shp, 0) * v_skater_shp_weight) +
          (COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) * v_skater_sog_weight) +
          (COALESCE(pgs.nhl_blocks, pgs.blocks, 0) * v_skater_blocks_weight) +
          (COALESCE(pgs.nhl_hits, pgs.hits, 0) * v_skater_hits_weight) +
          (COALESCE(pgs.nhl_pim, pgs.pim, 0) * v_skater_pim_weight)
      END
    , 0)::NUMERIC(10, 3) AS daily_points,
    COALESCE(pgs.nhl_goals, pgs.goals, 0)::INTEGER AS goals,
    COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0)::INTEGER AS assists,
    COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0)::INTEGER AS shots_on_goal,
    COALESCE(pgs.nhl_blocks, pgs.blocks, 0)::INTEGER AS blocks,
    COALESCE(pgs.nhl_hits, pgs.hits, 0)::INTEGER AS hits,
    COALESCE(pgs.nhl_pim, pgs.pim, 0)::INTEGER AS pim,
    COALESCE(pgs.nhl_ppp, pgs.ppp, 0)::INTEGER AS ppp,
    COALESCE(pgs.nhl_shp, pgs.shp, 0)::INTEGER AS shp,
    COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0)::INTEGER AS wins,
    COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0)::INTEGER AS saves,
    COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0)::INTEGER AS goals_against,
    COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0)::INTEGER AS shutouts,
    COALESCE(pd.is_goalie, pd.position_code = 'G', pgs.is_goalie, false) AS is_goalie
  FROM fantasy_daily_rosters fdr
  LEFT JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    AND pgs.game_date = p_date
  -- 0F-SCORE-2: pgs joined first so pd can key on the game's own season; calendar only as
  -- fallback for players with no game that day (display metadata, no points at stake).
  LEFT JOIN player_directory pd ON fdr.player_id = pd.player_id
    AND pd.season = COALESCE(substring(pgs.game_id::text from 1 for 4)::int,
                             get_current_season(p_date))
  WHERE fdr.team_id = p_team_id
    AND fdr.matchup_id = p_matchup_id
    AND fdr.roster_date = p_date
  ORDER BY
    CASE fdr.slot_type
      WHEN 'active' THEN 1
      WHEN 'bench' THEN 2
      WHEN 'ir' THEN 3
    END,
    fdr.slot_id;
END;
$$;


ALTER FUNCTION "public"."get_daily_lineup"("p_team_id" "uuid", "p_matchup_id" "uuid", "p_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_daily_lineup"("p_team_id" "uuid", "p_matchup_id" "uuid", "p_date" "date") IS 'Returns complete daily lineup with player data for display. FIXED: Now uses get_nhl_season_year() to correctly join with player_directory for any NHL season (works for 2025-2026, 2026-2027, etc.).';



CREATE OR REPLACE FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") RETURNS TABLE("player_id" integer, "game_id" integer, "projection_date" "date", "season" integer, "projected_goals" numeric, "projected_assists" numeric, "projected_sog" numeric, "projected_blocks" numeric, "projected_ppp" numeric, "projected_shp" numeric, "projected_hits" numeric, "projected_pim" numeric, "projected_xg" numeric, "total_projected_points" numeric, "base_ppg" numeric, "shrinkage_weight" numeric, "finishing_multiplier" numeric, "opponent_adjustment" numeric, "b2b_penalty" numeric, "home_away_adjustment" numeric, "confidence_score" numeric, "calculation_method" "text", "opponent_team_id" integer, "opponent_abbrev" character varying, "is_home_game" boolean, "matchup_difficulty" numeric, "injury_status" character varying, "game_start_time" timestamp with time zone, "projected_wins" numeric, "projected_saves" numeric, "projected_shutouts" numeric, "projected_goals_against" numeric, "projected_gaa" numeric, "projected_save_pct" numeric, "projected_gp" numeric, "starter_confirmed" boolean, "is_goalie" boolean, "projection_mean" numeric, "projection_std_dev" numeric, "projection_ci_lower" numeric, "projection_ci_upper" numeric, "projection_ci_50_lower" numeric, "projection_ci_50_upper" numeric, "projection_median" numeric, "dynamic_confidence" numeric, "likely_low" numeric, "likely_high" numeric, "confidence_label" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        pps.player_id,
        pps.game_id,
        pps.projection_date,
        pps.season,
        -- Core projections
        pps.projected_goals,
        pps.projected_assists,
        pps.projected_sog,
        pps.projected_blocks,
        COALESCE(pps.projected_ppp, 0::NUMERIC) as projected_ppp,
        COALESCE(pps.projected_shp, 0::NUMERIC) as projected_shp,
        COALESCE(pps.projected_hits, 0::NUMERIC) as projected_hits,
        COALESCE(pps.projected_pim, 0::NUMERIC) as projected_pim,
        pps.projected_xg,
        pps.total_projected_points,
        -- Model components
        pps.base_ppg,
        pps.shrinkage_weight,
        pps.finishing_multiplier,
        pps.opponent_adjustment,
        pps.b2b_penalty,
        pps.home_away_adjustment,
        pps.confidence_score,
        pps.calculation_method,
        -- Matchup context
        pps.opponent_team_id,
        pps.opponent_abbrev,
        pps.is_home_game,
        COALESCE(pps.matchup_difficulty, 1.0::NUMERIC) as matchup_difficulty,
        COALESCE(pps.injury_status, 'healthy'::VARCHAR(20)) as injury_status,
        pps.game_start_time,
        -- Goalie fields
        COALESCE(pps.projected_wins, 0::NUMERIC) as projected_wins,
        COALESCE(pps.projected_saves, 0::NUMERIC) as projected_saves,
        COALESCE(pps.projected_shutouts, 0::NUMERIC) as projected_shutouts,
        COALESCE(pps.projected_goals_against, 0::NUMERIC) as projected_goals_against,
        COALESCE(pps.projected_gaa, 0::NUMERIC) as projected_gaa,
        COALESCE(pps.projected_save_pct, 0::NUMERIC) as projected_save_pct,
        COALESCE(pps.projected_gp, 0::NUMERIC) as projected_gp,
        COALESCE(pps.starter_confirmed, false) as starter_confirmed,
        COALESCE(pps.is_goalie, false) as is_goalie,
        -- Monte Carlo uncertainty (Citrus 3.1)
        pps.projection_mean,
        pps.projection_std_dev,
        pps.projection_ci_lower,
        pps.projection_ci_upper,
        pps.projection_ci_50_lower,
        pps.projection_ci_50_upper,
        pps.projection_median,
        pps.dynamic_confidence,
        pps.likely_low,
        pps.likely_high,
        pps.confidence_label
    FROM public.player_projected_stats pps
    WHERE pps.player_id = ANY(p_player_ids)
    AND pps.projection_date = p_target_date;
END;
$$;


ALTER FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") IS 'Projection lookup with Monte Carlo uncertainty. Returns point estimates + confidence intervals, likely ranges, and confidence labels for UI display.';



CREATE OR REPLACE FUNCTION "public"."get_effective_scoring_rules"("p_league_id" "uuid") RETURNS TABLE("stat_key" "text", "multiplier" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.stat_key,
         coalesce(lr.multiplier, dr.multiplier, c.default_multiplier) as multiplier
    from stat_catalog c
    left join league_scoring_rules lr
      on lr.stat_key = c.stat_key and lr.league_id = p_league_id
    left join league_scoring_rules dr
      on dr.stat_key = c.stat_key
     and dr.league_id = '00000000-0000-0000-0000-000000000000'::uuid;
$$;


ALTER FUNCTION "public"."get_effective_scoring_rules"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_keeper_draft_costs"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) RETURNS TABLE("player_id" "text", "keeper_round" integer, "penalty_type" "text", "original_draft_round" integer, "years_kept" integer, "effective_round" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_keeper_draft_costs"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_backup_id"() RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_backup_id UUID;
BEGIN
  SELECT id INTO v_backup_id
  FROM team_lineups_backup_log
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_backup_id;
END;
$$;


ALTER FUNCTION "public"."get_latest_backup_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_league_teams"("p_league_id" "uuid") RETURNS TABLE("id" "uuid", "league_id" "uuid", "owner_id" "uuid", "team_name" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- CRITICAL SECURITY CHECK: User must be a member of this league
  -- Allow if user is commissioner OR if user owns a team in the league
  IF NOT (
    public.is_commissioner_of_league(p_league_id) OR 
    public.user_owns_team_in_league_simple(p_league_id)
  ) THEN
    RAISE EXCEPTION 'Access denied: You are not a member of this league'
      USING HINT = 'You must own a team in this league or be the commissioner';
  END IF;
  
  -- If we get here, user is authorized - return all teams in the league
  -- SECURITY DEFINER ensures this bypasses RLS on the teams table
  RETURN QUERY
  SELECT 
    t.id,
    t.league_id,
    t.owner_id,
    t.team_name,
    t.created_at,
    t.updated_at
  FROM public.teams t
  WHERE t.league_id = p_league_id
  ORDER BY t.created_at;
END;
$$;


ALTER FUNCTION "public"."get_league_teams"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_matchup_stats"("p_player_ids" integer[], "p_start_date" "date", "p_end_date" "date") RETURNS TABLE("player_id" integer, "goals" bigint, "assists" bigint, "points" bigint, "shots_on_goal" bigint, "hits" bigint, "blocks" bigint, "pim" bigint, "ppp" bigint, "shp" bigint, "plus_minus" bigint, "goalie_gp" bigint, "wins" bigint, "saves" bigint, "goals_against" bigint, "shots_faced" bigint, "shutouts" bigint, "x_goals" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH player_list AS (SELECT unnest(p_player_ids) AS player_id),
  filtered_games AS (
    SELECT game_id, game_date FROM public.nhl_games
     WHERE game_date >= p_start_date AND game_date <= p_end_date AND game_type = 'regular'
  )
  SELECT
    pl.player_id,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_goals, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_assists, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_points, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_shots_on_goal, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_hits, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_blocks, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_pim, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(NULLIF(pgs.nhl_ppp, 0), (COALESCE(pgs.nhl_ppg, 0) + COALESCE(pgs.nhl_ppa, 0)))
      ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(NULLIF(pgs.nhl_shp, 0), (COALESCE(pgs.nhl_shg, 0) + COALESCE(pgs.nhl_sha, 0)))
      ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND (pgs.is_goalie = false OR pgs.is_goalie IS NULL)
      THEN COALESCE(pgs.nhl_plus_minus, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND pgs.is_goalie = true THEN pgs.goalie_gp ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND pgs.is_goalie = true
      THEN COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND pgs.is_goalie = true
      THEN COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND pgs.is_goalie = true
      THEN COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND pgs.is_goalie = true
      THEN COALESCE(NULLIF(pgs.nhl_shots_faced, 0), pgs.shots_faced, 0) ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL AND pgs.is_goalie = true
      THEN COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) ELSE 0 END), 0)::bigint,
    COALESCE((
      SELECT SUM(s.xg_sql)
      FROM public.nhl_shots s
      INNER JOIN filtered_games ng2 ON s.game_id = ng2.game_id
      WHERE s.shooter_id = pl.player_id
    ), 0)::numeric as x_goals
  FROM player_list pl
  LEFT JOIN public.player_game_stats pgs ON pl.player_id = pgs.player_id
  LEFT JOIN filtered_games ng ON pgs.game_id = ng.game_id
  GROUP BY pl.player_id;
$$;


ALTER FUNCTION "public"."get_matchup_stats"("p_player_ids" integer[], "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_matchup_stats"("p_player_ids" integer[], "p_start_date" "date", "p_end_date" "date") IS 'Returns weekly matchup stats by aggregating directly from player_game_stats (nhl_* columns) filtered by date range. 

SECURITY:
- Uses SECURITY DEFINER with search_path = public to prevent SQL injection
- Only grants execute to anon and authenticated roles

DATA SOURCE:
- Skater stats: ONLY nhl_* columns (official NHL.com data from boxscore scraper)
- No PBP fallback for skater stats - we have everything we need
- Goalie stats: nhl_* with fallback (goalies may not always have nhl_* populated)

CRITICAL FIXES:
- Filters by is_goalie to ensure defensemen (skaters) are included in skater stats
- Properly separates skater and goalie stats
- Includes all 8 skater stat categories: G, A, SOG, Hits, Blocks, PIM, PPP, SHP
- Calculates PPP/SHP from components (PPG+PPA, SHG+SHA) if totals are 0

Matches calculate_daily_matchup_scores logic exactly.';



CREATE OR REPLACE FUNCTION "public"."get_my_league_ids"() RETURNS "uuid"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- Returns array of league IDs where the user owns a team
  -- Runs with elevated privileges to bypass RLS
  SELECT ARRAY_AGG(DISTINCT league_id)
  FROM public.teams
  WHERE owner_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_league_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_nhl_season_year"("p_date" "date") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_year INTEGER;
  v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);
  v_month := EXTRACT(MONTH FROM p_date);
  
  -- NHL seasons run from October to June of the following year
  -- October-December (months 10-12): season year = current year
  -- January-September (months 1-9): season year = previous year
  IF v_month >= 10 THEN
    RETURN v_year;  -- Oct, Nov, Dec → current year (e.g., Oct 2025 → 2025)
  ELSE
    RETURN v_year - 1;  -- Jan-Sep → previous year (e.g., Jan 2026 → 2025)
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_nhl_season_year"("p_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_nhl_season_year"("p_date" "date") IS 'CALENDAR-ONLY season rule (Oct-Jun). Correct for historical dates but WRONG for a September opener -- it returns 2025 for 2026-09-29. Kept as the last-resort fallback inside get_current_season(); do not call it directly from product code. Use public.get_current_season(date), which resolves against the loaded schedule first.';



CREATE OR REPLACE FUNCTION "public"."get_player_waiver_clear_time"("p_league_id" "uuid", "p_player_id" integer) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_waiver_period_hours INT;
  v_dropped_at TIMESTAMPTZ;
  v_cleared_at TIMESTAMPTZ;
BEGIN
  SELECT waiver_period_hours INTO v_waiver_period_hours
  FROM public.leagues WHERE id = p_league_id;
  IF v_waiver_period_hours IS NULL THEN v_waiver_period_hours := 48; END IF;

  SELECT dropped_at, cleared_at INTO v_dropped_at, v_cleared_at
  FROM public.player_waiver_status
  WHERE league_id = p_league_id AND player_id = p_player_id
  ORDER BY dropped_at DESC LIMIT 1;

  IF v_dropped_at IS NULL OR v_cleared_at IS NOT NULL THEN RETURN NULL; END IF;
  RETURN v_dropped_at + (v_waiver_period_hours || ' hours')::INTERVAL;
END;
$$;


ALTER FUNCTION "public"."get_player_waiver_clear_time"("p_league_id" "uuid", "p_player_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_playoff_picture"("p_league_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_playoff_teams INT;
  v_total_teams INT;
  v_max_week INT;
  v_regular_season_weeks INT;
  v_remaining_weeks INT;
  v_result JSON;
BEGIN
  -- Get league config
  SELECT
    COALESCE((l.settings->>'playoffTeams')::INT, 6),
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0)
  INTO v_playoff_teams, v_regular_season_weeks
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  -- Count teams
  SELECT COUNT(*) INTO v_total_teams
  FROM public.teams WHERE league_id = p_league_id;

  -- Get current week progress
  SELECT COALESCE(MAX(week_number), 0) INTO v_max_week
  FROM public.matchups
  WHERE league_id = p_league_id AND status = 'completed';

  -- Calculate remaining weeks
  IF v_regular_season_weeks > 0 THEN
    v_remaining_weeks := GREATEST(v_regular_season_weeks - v_max_week, 0);
  ELSE
    v_remaining_weeks := 0;
  END IF;

  -- Build playoff picture with standings, clinch status, and magic numbers
  SELECT json_build_object(
    'playoff_teams', v_playoff_teams,
    'total_teams', v_total_teams,
    'weeks_completed', v_max_week,
    'remaining_weeks', v_remaining_weeks,
    'teams', COALESCE(json_agg(team_row ORDER BY rank), '[]'::json)
  ) INTO v_result
  FROM (
    SELECT
      t.id AS team_id,
      t.team_name,
      ROW_NUMBER() OVER (ORDER BY wins DESC, pf DESC) AS rank,
      wins, losses, ties, pf, pa,
      -- Clinch status
      CASE
        -- Clinched if wins > (total_teams - playoff_teams)th team's max possible wins
        WHEN wins > (v_remaining_weeks +
          (SELECT COALESCE(sub_wins, 0) FROM (
            SELECT SUM(CASE
              WHEN m2.team1_id = t2.id AND m2.team1_score > m2.team2_score THEN 1
              WHEN m2.team2_id = t2.id AND m2.team2_score > m2.team1_score THEN 1
              ELSE 0
            END) AS sub_wins
            FROM public.teams t2
            LEFT JOIN public.matchups m2 ON (m2.team1_id = t2.id OR m2.team2_id = t2.id)
              AND m2.league_id = p_league_id AND m2.week_number <= v_max_week
            WHERE t2.league_id = p_league_id AND t2.id != t.id
            GROUP BY t2.id
            ORDER BY sub_wins DESC
            OFFSET v_playoff_teams - 1 LIMIT 1
          ) sub))
        THEN 'clinched'
        -- Eliminated if max possible wins < current playoff cutoff
        WHEN (wins + v_remaining_weeks) < (
          SELECT COALESCE(MIN(sub_wins), 0) FROM (
            SELECT SUM(CASE
              WHEN m2.team1_id = t2.id AND m2.team1_score > m2.team2_score THEN 1
              WHEN m2.team2_id = t2.id AND m2.team2_score > m2.team1_score THEN 1
              ELSE 0
            END) AS sub_wins
            FROM public.teams t2
            LEFT JOIN public.matchups m2 ON (m2.team1_id = t2.id OR m2.team2_id = t2.id)
              AND m2.league_id = p_league_id AND m2.week_number <= v_max_week
            WHERE t2.league_id = p_league_id AND t2.id != t.id
            GROUP BY t2.id
            ORDER BY sub_wins DESC
            LIMIT v_playoff_teams
          ) sub
        )
        THEN 'eliminated'
        ELSE 'in_contention'
      END AS clinch_status,
      -- Magic number: wins needed to clinch (simplified: playoff_cutoff_wins - current_wins + 1)
      GREATEST(0,
        COALESCE((
          SELECT sub_wins + 1 FROM (
            SELECT SUM(CASE
              WHEN m2.team1_id = t2.id AND m2.team1_score > m2.team2_score THEN 1
              WHEN m2.team2_id = t2.id AND m2.team2_score > m2.team1_score THEN 1
              ELSE 0
            END) AS sub_wins
            FROM public.teams t2
            LEFT JOIN public.matchups m2 ON (m2.team1_id = t2.id OR m2.team2_id = t2.id)
              AND m2.league_id = p_league_id AND m2.week_number <= v_max_week
            WHERE t2.league_id = p_league_id AND t2.id != t.id
            GROUP BY t2.id
            ORDER BY sub_wins DESC
            OFFSET v_playoff_teams - 1 LIMIT 1
          ) sub
        ), 0) - wins
      ) AS magic_number
    FROM (
      SELECT
        t.id, t.team_name,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
          WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
          ELSE 0 END), 0) AS wins,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
          WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
          ELSE 0 END), 0) AS losses,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
          WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
          ELSE 0 END), 0) AS ties,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id THEN m.team1_score
          WHEN m.team2_id = t.id THEN m.team2_score ELSE 0 END), 0) AS pf,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id THEN m.team2_score
          WHEN m.team2_id = t.id THEN m.team1_score ELSE 0 END), 0) AS pa
      FROM public.teams t
      LEFT JOIN public.matchups m ON (m.team1_id = t.id OR m.team2_id = t.id)
        AND m.league_id = p_league_id AND m.week_number <= v_max_week
      WHERE t.league_id = p_league_id
      GROUP BY t.id, t.team_name
    ) standings
    CROSS JOIN LATERAL (SELECT standings.id AS t_id) helper
    JOIN public.teams t ON t.id = standings.id
  ) team_row;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_playoff_picture"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pool_week_dates"("p_week_number" integer, "p_season" integer DEFAULT NULL::integer) RETURNS TABLE("week_start" "date", "week_end" "date")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_season INT;
  v_first_game DATE;
  v_week1_sunday DATE;
BEGIN
  v_season := COALESCE(p_season, public.get_current_season());

  SELECT MIN(g.game_date) INTO v_first_game
  FROM nhl_games g WHERE g.season = v_season;

  IF v_first_game IS NULL THEN
    RAISE EXCEPTION 'get_pool_week_dates: no schedule loaded for season %', v_season;
  END IF;

  -- Sunday on or before the opener, so the opener is inside week 1.
  v_week1_sunday := v_first_game - (EXTRACT(DOW FROM v_first_game)::INT || ' days')::INTERVAL;

  week_start := v_week1_sunday + ((p_week_number - 1) * 7 || ' days')::INTERVAL;
  week_end   := week_start + INTERVAL '6 days';
  RETURN NEXT;
END $$;


ALTER FUNCTION "public"."get_pool_week_dates"("p_week_number" integer, "p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_projection_target_season"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select max(season)::int from nhl_games;
$$;


ALTER FUNCTION "public"."get_projection_target_season"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_projection_target_season"() IS 'The season projections are built for: the newest season with a loaded schedule. Deliberately NOT get_nhl_season_year(), which returns the season that just ended when called between January and September.';



CREATE OR REPLACE FUNCTION "public"."get_season_game_count"("p_season" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select max(cnt)::int from (
       select t.team, count(*) cnt
         from public.nhl_games g
         cross join lateral (values (g.home_team_id), (g.away_team_id)) as t(team)
        where g.season = p_season and g.game_type = 'regular' and t.team is not null
        group by t.team) z),
    (select max(cnt)::int from (
       select s.team_id, count(distinct s.game_id) cnt
         from public.nhl_shots s
        where s.season = p_season and s.game_type = 'regular'
        group by s.team_id) y)
  );
$$;


ALTER FUNCTION "public"."get_season_game_count"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_season_game_count"("p_season" integer) IS 'Regular-season games per team for a season, read from the loaded schedule. 2025 -> 82, 2026 -> 84. Never hardcode the season length.';



CREATE OR REPLACE FUNCTION "public"."get_trending_players"("days_back" integer DEFAULT 7, "limit_count" integer DEFAULT 25, "position_filter" "text" DEFAULT NULL::"text") RETURNS TABLE("player_id" integer, "add_count" bigint, "drop_count" bigint, "net_adds" bigint, "last_added" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_season int := public.get_current_season(current_date);
BEGIN
  RETURN QUERY
  SELECT tl.player_id::int,
         count(*) FILTER (WHERE upper(tl.type) = 'ADD')  AS add_count,
         count(*) FILTER (WHERE upper(tl.type) = 'DROP') AS drop_count,
         count(*) FILTER (WHERE upper(tl.type) = 'ADD')
           - count(*) FILTER (WHERE upper(tl.type) = 'DROP') AS net_adds,
         max(tl.created_at) FILTER (WHERE upper(tl.type) = 'ADD') AS last_added
    FROM public.transaction_ledger tl
    LEFT JOIN public.player_directory pd
      ON pd.player_id = tl.player_id::int AND pd.season = v_season
   WHERE tl.created_at >= now() - (days_back || ' days')::interval
     AND tl.player_id ~ '^[0-9]+$'
     AND (position_filter IS NULL OR pd.position_code = position_filter)
   GROUP BY tl.player_id
  HAVING count(*) FILTER (WHERE upper(tl.type) = 'ADD') > 0
   ORDER BY add_count DESC, last_added DESC
   LIMIT limit_count;
END;
$_$;


ALTER FUNCTION "public"."get_trending_players"("days_back" integer, "limit_count" integer, "position_filter" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_trending_players"("days_back" integer, "limit_count" integer, "position_filter" "text") IS 'Most-added players over a rolling window, read from transaction_ledger -- the table process_roster_move actually writes. It previously read player_transactions, which has never had a row because its only writer, record_player_transaction(), is called by nothing. Position filtering joins player_directory for the current season.';



CREATE OR REPLACE FUNCTION "public"."get_user_consent_status"() RETURNS TABLE("policy_type" "text", "required_version" "text", "consented_version" "text", "status" "text", "consented_at" timestamp with time zone, "withdrawn_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'get_user_consent_status requires an authenticated caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT pv.policy_type,
         pv.version,
         live.version,
         CASE WHEN live.id IS NOT NULL           THEN 'current'
              WHEN withdrawn.id IS NOT NULL      THEN 'withdrawn'
              WHEN stale.id IS NOT NULL          THEN 'outdated'
              ELSE 'never_given' END,
         coalesce(live.consented_at, stale.consented_at, withdrawn.consented_at),
         withdrawn.withdrawn_at
    FROM public.policy_versions pv
    LEFT JOIN LATERAL (
      SELECT c.id, c.version, c.consented_at FROM public.user_privacy_consent c
       WHERE c.user_id = v_user AND c.policy_type = pv.policy_type
         AND c.version = pv.version AND c.granted AND c.withdrawn_at IS NULL
       LIMIT 1) live ON true
    LEFT JOIN LATERAL (
      SELECT c.id, c.consented_at FROM public.user_privacy_consent c
       WHERE c.user_id = v_user AND c.policy_type = pv.policy_type
         AND c.version <> pv.version AND c.granted AND c.withdrawn_at IS NULL
       ORDER BY c.consented_at DESC LIMIT 1) stale ON true
    LEFT JOIN LATERAL (
      SELECT c.id, c.consented_at, c.withdrawn_at FROM public.user_privacy_consent c
       WHERE c.user_id = v_user AND c.policy_type = pv.policy_type
         AND NOT c.granted
       ORDER BY c.withdrawn_at DESC LIMIT 1) withdrawn ON true
   WHERE pv.requires_consent
   ORDER BY pv.policy_type;
END;
$$;


ALTER FUNCTION "public"."get_user_consent_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_consent_status"() IS 'What the calling user still owes. Returns one row per policy in force with status current | outdated | withdrawn | never_given. The 72 accounts that signed up while record_user_consent did not exist read as never_given, which is the honest answer -- backfilling them would fabricate the evidence the ledger exists to provide.';



CREATE OR REPLACE FUNCTION "public"."get_waiver_processing_status"() RETURNS TABLE("league_id" "uuid", "league_name" "text", "pending_claims" integer, "last_processed" timestamp with time zone, "next_process_time" time without time zone)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_waiver_processing_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (new.id, 'user_' || substr(new.id::text, 1, 8));
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."heal_directory_for_rostered_players"("p_season" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_added int;
BEGIN
  WITH rostered AS (
    SELECT DISTINCT ra.player_id::int AS pid
      FROM public.roster_assignments ra WHERE ra.player_id ~ '^[0-9]+$'
    UNION
    SELECT DISTINCT (jsonb_array_elements_text(tl.starters))::int
      FROM public.team_lineups tl WHERE jsonb_typeof(tl.starters) = 'array'
  ),
  missing AS (
    SELECT r.pid FROM rostered r
     WHERE NOT EXISTS (SELECT 1 FROM public.player_directory d
                        WHERE d.player_id = r.pid AND d.season = p_season)
  ),
  source AS (
    SELECT DISTINCT ON (d.player_id) d.*
      FROM public.player_directory d JOIN missing m ON m.pid = d.player_id
     WHERE d.season < p_season
     ORDER BY d.player_id, d.season DESC
  )
  INSERT INTO public.player_directory (
    season, player_id, full_name, team_abbrev, position_code, is_goalie, jersey_number,
    headshot_url, shoots_catches, created_at, updated_at, height_in, weight_lb, birthdate,
    nationality, college_team, prior_team, bio_summary, notes, source_last_fetched_at,
    eligible_positions)
  SELECT p_season, s.player_id, s.full_name, NULL, s.position_code, s.is_goalie,
         s.jersey_number, s.headshot_url, s.shoots_catches, now(), now(), s.height_in,
         s.weight_lb, s.birthdate, s.nationality, s.college_team,
         coalesce(s.team_abbrev, s.prior_team), s.bio_summary,
         'carried forward from season ' || s.season ||
           ': rostered in a fantasy league but absent from the NHL roster feed. Overwritten by the next real roster refresh.',
         s.source_last_fetched_at, s.eligible_positions
    FROM source s
  ON CONFLICT (season, player_id) DO NOTHING;

  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$_$;


ALTER FUNCTION "public"."heal_directory_for_rostered_players"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."heal_directory_for_rostered_players"("p_season" integer) IS 'Carries the most recent prior-season directory row forward for any player held on a fantasy roster who has no row for the target season. Clears team_abbrev (they are on no NHL club) and records where they last played in prior_team. Idempotent; a real roster refresh overwrites the carried row via the (season, player_id) upsert key.';



CREATE OR REPLACE FUNCTION "public"."is_commissioner_of_league"("p_league_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT commissioner_id = auth.uid()
  FROM public.leagues
  WHERE id = p_league_id;
$$;


ALTER FUNCTION "public"."is_commissioner_of_league"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_player_on_waivers"("p_league_id" "uuid", "p_player_id" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_waiver_period_hours INT;
  v_dropped_at TIMESTAMPTZ;
  v_cleared_at TIMESTAMPTZ;
BEGIN
  SELECT waiver_period_hours INTO v_waiver_period_hours
  FROM public.leagues WHERE id = p_league_id;
  IF v_waiver_period_hours IS NULL THEN v_waiver_period_hours := 48; END IF;

  SELECT dropped_at, cleared_at INTO v_dropped_at, v_cleared_at
  FROM public.player_waiver_status
  WHERE league_id = p_league_id AND player_id = p_player_id
  ORDER BY dropped_at DESC LIMIT 1;

  IF v_dropped_at IS NULL THEN RETURN FALSE; END IF;
  IF v_cleared_at IS NOT NULL THEN RETURN FALSE; END IF;
  IF v_dropped_at + (v_waiver_period_hours || ' hours')::INTERVAL < NOW() THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."is_player_on_waivers"("p_league_id" "uuid", "p_player_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_league_with_code"("p_join_code" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_team_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_league RECORD;
  v_existing_team RECORD;
  v_team_count INT;
  v_max_teams INT;
  v_final_team_name TEXT;
  v_new_team RECORD;
  v_is_pool BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated.');
  END IF;

  SELECT l.* INTO v_league FROM public.leagues l WHERE l.join_code = p_join_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid join code. Please check and try again.');
  END IF;

  -- IDEMPOTENT PATH: if user already has a team here, return success
  -- with the existing team. This keeps retries / double-taps safe.
  SELECT t.* INTO v_existing_team FROM public.teams t
  WHERE t.league_id = v_league.id AND t.owner_id = v_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'league_id', v_league.id,
      'league_name', v_league.name,
      'settings', v_league.settings,
      'team_id', v_existing_team.id,
      'team_name', v_existing_team.team_name,
      'already_member', true
    );
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = v_league.id;
  v_max_teams := COALESCE(
    (v_league.settings->>'teamsCount')::INT,
    (v_league.settings->>'teamCount')::INT,
    (v_league.settings->>'numberOfTeams')::INT,
    12
  );
  IF v_team_count >= v_max_teams THEN
    RETURN jsonb_build_object('success', false, 'error', 'This league is full.');
  END IF;

  -- Pool leagues don't have drafts; skip the draft-status block.
  v_is_pool := (v_league.settings->>'leagueType') IS NOT NULL
               AND (v_league.settings->>'leagueType') <> 'fantasy';

  IF NOT v_is_pool THEN
    IF v_league.draft_status = 'in_progress' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot join — the draft is currently in progress.');
    END IF;
    IF v_league.draft_status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot join — the draft has already been completed.');
    END IF;
  END IF;

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

  INSERT INTO public.teams (league_id, owner_id, team_name)
  VALUES (v_league.id, v_user_id, v_final_team_name)
  RETURNING * INTO v_new_team;

  RETURN jsonb_build_object(
    'success', true,
    'league_id', v_league.id,
    'league_name', v_league.name,
    'settings', v_league.settings,
    'team_id', v_new_team.id,
    'team_name', v_new_team.team_name,
    'already_member', false
  );
END;
$$;


ALTER FUNCTION "public"."join_league_with_code"("p_join_code" "text", "p_user_id" "uuid", "p_team_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_team_lineups_backups"() RETURNS TABLE("backup_id" "uuid", "backup_name" "text", "created_at" timestamp with time zone, "teams" integer, "players" integer, "notes" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    id,
    backup_name,
    created_at,
    team_count,
    player_count,
    notes
  FROM team_lineups_backup_log
  ORDER BY created_at DESC
  LIMIT 50;
END;
$$;


ALTER FUNCTION "public"."list_team_lineups_backups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."load_player_names_season"("p_season" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_n int;
BEGIN
  WITH spots AS (
    SELECT (rs->>'playerId')::int AS player_id,
           rs->'firstName'->>'default' AS first_name,
           rs->'lastName'->>'default'  AS last_name,
           nullif(rs->>'headshot','')  AS headshot_url,
           nullif(rs->>'positionCode','') AS position_code,
           d.game_id
      FROM public.raw_nhl_data d
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.raw_json->'rosterSpots','[]'::jsonb)) AS rs
     WHERE substring(d.game_id::text from 1 for 4)::int = p_season
       AND d.raw_json IS NOT NULL
  ), agg AS (
    SELECT player_id,
           (array_agg(first_name ORDER BY game_id DESC))[1] AS first_name,
           (array_agg(last_name  ORDER BY game_id DESC))[1] AS last_name,
           (array_agg(headshot_url ORDER BY game_id DESC) FILTER (WHERE headshot_url IS NOT NULL))[1] AS headshot_url,
           (array_agg(position_code ORDER BY game_id DESC))[1] AS position_code
      FROM spots WHERE player_id IS NOT NULL GROUP BY player_id
  )
  INSERT INTO public.nhl_player_names AS t
    (player_id, first_name, last_name, headshot_url, position_code, last_seen_season, updated_at)
  SELECT player_id, first_name, last_name, headshot_url, position_code, p_season, now() FROM agg
  ON CONFLICT (player_id) DO UPDATE SET
    first_name = coalesce(EXCLUDED.first_name, t.first_name),
    last_name  = coalesce(EXCLUDED.last_name,  t.last_name),
    headshot_url = coalesce(EXCLUDED.headshot_url, t.headshot_url),
    position_code = coalesce(EXCLUDED.position_code, t.position_code),
    last_seen_season = greatest(t.last_seen_season, EXCLUDED.last_seen_season),
    updated_at = now()
  WHERE EXCLUDED.last_seen_season >= t.last_seen_season;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


ALTER FUNCTION "public"."load_player_names_season"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_keepers_for_season"("p_league_id" "uuid", "p_season_year" integer) RETURNS TABLE("team_id" "uuid", "keepers_locked" integer, "rounds_consumed" integer[])
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team RECORD; v_count INT; v_rounds INT[]; v_bad TEXT;
BEGIN
  -- Validate every team first; refuse the whole lock if any team is invalid.
  FOR v_team IN SELECT t.id AS tid FROM teams t WHERE t.league_id = p_league_id
  LOOP
    SELECT v.error_message INTO v_bad
    FROM public.validate_keeper_selections(p_league_id, v_team.tid, p_season_year) v
    WHERE v.is_valid = false
    LIMIT 1;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Team % has invalid keeper selections: %', v_team.tid, v_bad;
    END IF;
  END LOOP;

  FOR v_team IN SELECT t.id AS tid FROM teams t WHERE t.league_id = p_league_id
  LOOP
    UPDATE keeper_designations kd
       SET status = 'locked', updated_at = NOW()
     WHERE kd.league_id = p_league_id
       AND kd.team_id = v_team.tid
       AND kd.season_year = p_season_year
       AND kd.status IN ('designated', 'approved');
    GET DIAGNOSTICS v_count = ROW_COUNT;

    SELECT ARRAY_AGG(c.effective_round ORDER BY c.effective_round) INTO v_rounds
    FROM public.get_keeper_draft_costs(p_league_id, v_team.tid, p_season_year) c
    WHERE c.effective_round IS NOT NULL;

    team_id := v_team.tid;
    keepers_locked := v_count;
    rounds_consumed := COALESCE(v_rounds, ARRAY[]::INT[]);
    RETURN NEXT;
  END LOOP;

  RETURN;
END $$;


ALTER FUNCTION "public"."lock_keepers_for_season"("p_league_id" "uuid", "p_season_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_trail_integrity"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_err int; v_warn int; v_detail text;
BEGIN
  SELECT count(*) FILTER (WHERE severity = 'ERROR'),
         count(*) FILTER (WHERE severity = 'WARN'),
         coalesce(string_agg(severity || ' ' || problem || ': ' || detail, '; '), '')
    INTO v_err, v_warn, v_detail
    FROM public.check_audit_trail_integrity(7);

  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'audit_trail_integrity',
          CASE WHEN v_err > 0 THEN 'fail' WHEN v_warn > 0 THEN 'warning' ELSE 'pass' END,
          CASE WHEN v_detail <> '' THEN left(v_detail, 900)
               ELSE 'audit trail live: login capture within tolerance, writer canary passed, grants correct both ways' END,
          false);
END;
$$;


ALTER FUNCTION "public"."log_audit_trail_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_audit_trail_integrity"() IS 'Cron wrapper for check_audit_trail_integrity. Job: audit-trail-integrity, 40 4 * * *.';



CREATE OR REPLACE FUNCTION "public"."log_boxscore_reconciliation"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_season int;
  v_bad    bigint;
  v_cmp    bigint;
  v_detail text;
begin
  select max(season) into v_season from player_game_stats;

  select sum(rows_disagreeing), sum(rows_compared),
         coalesce(string_agg(stat||'='||rows_disagreeing, '; ')
                  filter (where rows_disagreeing > 0), '')
    into v_bad, v_cmp, v_detail
    from public.check_boxscore_reconciliation(v_season);

  insert into integrity_check_results(check_time, check_name, status, details, auto_fixed)
  values (now(), 'boxscore_reconciliation',
          case when coalesce(v_bad,0) > 0 then 'fail' else 'pass' end,
          'season '||v_season||': '||coalesce(v_cmp,0)||' field comparisons vs archived official boxscore, '
            ||coalesce(v_bad,0)||' disagreeing'
            ||case when v_detail <> '' then ' ['||v_detail||']' else '' end,
          false);
end;
$$;


ALTER FUNCTION "public"."log_boxscore_reconciliation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_cron_job_health"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_err int; v_warn int; v_detail text;
BEGIN
  INSERT INTO public.cron_job_registry (jobid, jobname)
  SELECT j.jobid, j.jobname FROM cron.job j
  ON CONFLICT (jobid) DO NOTHING;

  DELETE FROM public.cron_job_registry r
   WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid = r.jobid);

  SELECT count(*) FILTER (WHERE severity='ERROR'),
         count(*) FILTER (WHERE severity='WARN'),
         coalesce(string_agg(jobname || ': ' || issue, '; '), '')
    INTO v_err, v_warn, v_detail
    FROM public.check_cron_job_health(48);

  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'cron_job_health',
          CASE WHEN v_err > 0 THEN 'fail' WHEN v_warn > 0 THEN 'warning' ELSE 'pass' END,
          CASE WHEN v_err > 0 OR v_warn > 0 THEN left(v_detail, 900)
               ELSE 'every active cron job has run and none failed in the last 48h' END,
          false);
END;
$$;


ALTER FUNCTION "public"."log_cron_job_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_function_error"("p_fn" "text", "p_sqlstate" "text", "p_message" "text", "p_context" "text" DEFAULT NULL::"text", "p_details" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE WARNING '[citrus] % failed (%): % | ctx=% | %',
    p_fn, coalesce(p_sqlstate,'?'), coalesce(p_message,'?'),
    coalesce(p_context,'-'), coalesce(p_details::text,'{}');
  BEGIN
    INSERT INTO public.function_error_log(fn, sqlstate, message, context, details, user_id)
    VALUES (p_fn, p_sqlstate, left(coalesce(p_message,''), 2000), p_context, p_details, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    -- best effort only; the WARNING above has already landed, so this is the
    -- one swallow in the codebase that is not a silent failure
    NULL;
  END;
END;
$$;


ALTER FUNCTION "public"."log_function_error"("p_fn" "text", "p_sqlstate" "text", "p_message" "text", "p_context" "text", "p_details" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_function_error"("p_fn" "text", "p_sqlstate" "text", "p_message" "text", "p_context" "text", "p_details" "jsonb") IS 'Records an exception caught by a blanket WHEN OTHERS handler. Emits RAISE WARNING (survives rollback) and best-effort inserts into function_error_log.';



CREATE OR REPLACE FUNCTION "public"."log_league_scoring_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  old_scoring jsonb;
  new_scoring jsonb;
begin
  old_scoring := coalesce(
    old.settings->'scoring',
    jsonb_build_object('stats', old.settings->'stats')
  );
  new_scoring := coalesce(
    new.settings->'scoring',
    jsonb_build_object('stats', new.settings->'stats')
  );

  if old_scoring is distinct from new_scoring then
    insert into public.league_scoring_audit(league_id, actor_id, old_scoring, new_scoring)
    values (new.id, auth.uid(), old_scoring, new_scoring);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."log_league_scoring_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_matchup_score_calibration"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into integrity_check_results(check_time, check_name, status, details, auto_fixed)
  select now(), 'matchup_score_calibration',
         case when count(*) > 0 then 'fail' else 'pass' end,
         case when count(*) > 0
              then count(*)||' matchups where the stored score does not equal the sum of its line items'
              else 'every matchup score equals the sum of its own line items' end,
         false
    from public.check_matchup_score_calibration();
$$;


ALTER FUNCTION "public"."log_matchup_score_calibration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_monitor_liveness"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into integrity_check_results(check_time, check_name, status, details, auto_fixed)
  select now(), 'monitor_liveness',
         case when count(*) filter (where severity='ERROR') > 0 then 'fail' else 'pass' end,
         coalesce(string_agg(monitor||' quiet '||hours_quiet||'h', '; ')
                  filter (where severity='ERROR'), 'all monitors reporting'),
         false
    from public.check_monitor_liveness();
$$;


ALTER FUNCTION "public"."log_monitor_liveness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_pipeline_coverage"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
  SELECT now(), 'pipeline_coverage',
         CASE c.severity WHEN 'ERROR' THEN 'fail' ELSE 'warning' END,
         c.game_type || ' / ' || c.layer || ' (' || c.games_affected || ' games): ' || c.detail,
         false
    FROM public.check_pipeline_coverage() c;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
    VALUES (now(), 'pipeline_coverage', 'pass', 'every scheduled game accounted for in every layer', false);
  END IF;
  RETURN v_n;
END
$$;


ALTER FUNCTION "public"."log_pipeline_coverage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_player_directory_freshness"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_err int; v_warn int; v_detail text; v_healed int; v_season int;
BEGIN
  SELECT coalesce(max(season), extract(year from now())::int) INTO v_season
    FROM public.player_directory;
  v_healed := public.heal_directory_for_rostered_players(v_season);

  SELECT count(*) FILTER (WHERE severity = 'ERROR'),
         count(*) FILTER (WHERE severity = 'WARN'),
         coalesce(string_agg(problem || ': ' || detail, '; '), '')
    INTO v_err, v_warn, v_detail
    FROM public.check_player_directory_freshness();

  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'player_directory_target_season',
          CASE WHEN v_err > 0 THEN 'fail' WHEN v_warn > 0 THEN 'warning' ELSE 'pass' END,
          left(CASE WHEN v_err > 0 OR v_warn > 0 THEN v_detail
                    ELSE 'target-season directory is fresh, correctly sized, and covers every rostered player' END
               || CASE WHEN v_healed > 0
                       THEN ' | auto-healed ' || v_healed || ' rostered player(s) carried forward from a prior season'
                       ELSE '' END, 900),
          v_healed > 0);
END;
$$;


ALTER FUNCTION "public"."log_player_directory_freshness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_pool_scoring_integrity"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_err INT; v_warn INT; v_detail TEXT; v_ctx TEXT;
BEGIN
  SELECT count(*) FILTER (WHERE severity='ERROR'),
         count(*) FILTER (WHERE severity='WARN'),
         coalesce(string_agg(scope||' '||metric||'='||value::int, '; ') FILTER (WHERE severity IN ('ERROR','WARN')), ''),
         coalesce(string_agg(scope||' '||issue, '; ') FILTER (WHERE severity='INFO'), '')
    INTO v_err, v_warn, v_detail, v_ctx
  FROM public.check_pool_scoring_integrity();

  -- Status is decided by ERROR/WARN only. The INFO rows are input cardinality and
  -- ride along in the details -- counting them would paint this permanently amber,
  -- which just trains people to scroll past it.
  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'pool_scoring',
          CASE WHEN v_err>0 THEN 'fail' WHEN v_warn>0 THEN 'warning' ELSE 'pass' END,
          left(CASE WHEN v_detail <> '' THEN v_detail || ' | ' ELSE 'all settled picks scored | ' END || v_ctx, 900),
          false);
END $$;


ALTER FUNCTION "public"."log_pool_scoring_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_scoring_config_divergence"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer;
begin
  select count(*) into n from public.check_scoring_config_divergence();
  insert into public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  values (now(), 'scoring_config_divergence',
          case when n = 0 then 'pass' else 'fail' end,
          'divergent league/stat pairs: ' || n
            || ' -- leagues.scoring_settings (what the client displays, and what '
            || 'DraftRoom and the playoff-pool scorer compute with) disagrees with '
            || 'league_scoring_rules (what the matchup engine applies)',
          false);
end;
$$;


ALTER FUNCTION "public"."log_scoring_config_divergence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_season_boundary"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_err int; v_warn int; v_detail text;
BEGIN
  SELECT count(*) FILTER (WHERE severity='ERROR'), count(*) FILTER (WHERE severity='WARN'),
         coalesce(string_agg(problem||': '||detail, '; '), '')
    INTO v_err, v_warn, v_detail FROM public.check_season_boundary(180);
  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'season_boundary',
          CASE WHEN v_err>0 THEN 'fail' WHEN v_warn>0 THEN 'warning' ELSE 'pass' END,
          CASE WHEN v_detail <> '' THEN left(v_detail,900)
               ELSE 'schedule-aware season resolution intact; no product function calls the calendar rule directly' END,
          false);
END;
$$;


ALTER FUNCTION "public"."log_season_boundary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_security_anomalies"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_crit int; v_err int; v_warn int; v_detail text;
BEGIN
  SELECT count(*) FILTER (WHERE severity = 'CRITICAL'),
         count(*) FILTER (WHERE severity = 'ERROR'),
         count(*) FILTER (WHERE severity = 'WARN'),
         coalesce(string_agg(DISTINCT anomaly_type || ': ' || details, '; ')
                  FILTER (WHERE severity IN ('CRITICAL','ERROR')), '')
    INTO v_crit, v_err, v_warn, v_detail
    FROM public.detect_security_anomalies();

  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (
    now(),
    'security_anomalies',
    CASE WHEN v_crit > 0 OR v_err > 0 THEN 'fail' ELSE 'pass' END,
    CASE WHEN v_crit > 0 OR v_err > 0
         THEN 'CRITICAL=' || v_crit || ' ERROR=' || v_err || ' :: ' || left(v_detail, 800)
         ELSE 'no CRITICAL or ERROR anomalies. ' || v_warn ||
              ' ORPHANED_TEAM warnings are unowned AI teams and are by design.'
    END,
    false);
END;
$$;


ALTER FUNCTION "public"."log_security_anomalies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_security_drift"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
  SELECT now(), 'security_drift',
         CASE d.severity WHEN 'ERROR' THEN 'fail' WHEN 'WARN' THEN 'warning' ELSE 'warning' END,
         d.object_type || ' ' || d.object_name || ': ' || d.issue, false
    FROM public.check_security_drift() d;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
    VALUES (now(), 'security_drift', 'pass', 'no drift detected', false);
  END IF;
  RETURN v_n;
END
$$;


ALTER FUNCTION "public"."log_security_drift"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_security_event"("p_event_type" "text", "p_league_id" "uuid" DEFAULT NULL::"uuid", "p_details" "jsonb" DEFAULT '{}'::"jsonb", "p_severity" "text" DEFAULT 'INFO'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.security_audit_log (
    event_type,
    user_id,
    league_id,
    details,
    severity
  ) VALUES (
    p_event_type,
    auth.uid(),
    p_league_id,
    p_details,
    p_severity
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."log_security_event"("p_event_type" "text", "p_league_id" "uuid", "p_details" "jsonb", "p_severity" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_security_event"("p_event_type" "text", "p_league_id" "uuid", "p_details" "jsonb", "p_severity" "text") IS 'SOC 2 CC7.2: Log a security event to the audit trail. Called by application layer.';



CREATE OR REPLACE FUNCTION "public"."log_settings_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_changes TEXT[];
BEGIN
  -- Only log if this is an UPDATE by the commissioner
  IF TG_OP = 'UPDATE' AND NEW.commissioner_id = auth.uid() THEN
    -- Track which settings groups changed
    IF OLD.waiver_type IS DISTINCT FROM NEW.waiver_type
       OR OLD.waiver_process_time IS DISTINCT FROM NEW.waiver_process_time
       OR OLD.waiver_period_hours IS DISTINCT FROM NEW.waiver_period_hours
       OR OLD.waiver_game_lock IS DISTINCT FROM NEW.waiver_game_lock
       OR OLD.allow_trades_during_games IS DISTINCT FROM NEW.allow_trades_during_games THEN
      v_changes := array_append(v_changes, 'waiver_settings');
    END IF;

    IF OLD.scoring_settings::text IS DISTINCT FROM NEW.scoring_settings::text THEN
      v_changes := array_append(v_changes, 'scoring_settings');
    END IF;

    IF OLD.draft_rounds IS DISTINCT FROM NEW.draft_rounds THEN
      v_changes := array_append(v_changes, 'draft_settings');
    END IF;

    IF OLD.trade_review_type IS DISTINCT FROM NEW.trade_review_type
       OR OLD.trade_review_period_hours IS DISTINCT FROM NEW.trade_review_period_hours
       OR OLD.trade_veto_threshold IS DISTINCT FROM NEW.trade_veto_threshold THEN
      v_changes := array_append(v_changes, 'trade_review_settings');
    END IF;

    IF OLD.settings::text IS DISTINCT FROM NEW.settings::text THEN
      v_changes := array_append(v_changes, 'league_settings');
    END IF;

    -- Log to audit trail if any changes were detected
    IF v_changes IS NOT NULL AND array_length(v_changes, 1) > 0 THEN
      -- Insert into security_audit_log if the table exists
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'security_audit_log' AND table_schema = 'public') THEN
        INSERT INTO public.security_audit_log (
          event_type, league_id, user_id, details, created_at
        ) VALUES (
          'ADMIN_ACTION',
          NEW.id,
          auth.uid(),
          jsonb_build_object(
            'action', 'settings_changed',
            'changed_groups', to_jsonb(v_changes),
            'timestamp', NOW()
          ),
          NOW()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_settings_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_stat_column_parity"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into integrity_check_results(check_time, check_name, status, details, auto_fixed)
  select now(), 'stat_column_parity',
         case when count(*) > 0 then 'fail' else 'pass' end,
         coalesce(string_agg(stat||': '||rows_disagreeing||' rows, net '||net_delta, '; '),
                  'all paired stat columns agree'),
         false
    from public.check_stat_column_parity();
$$;


ALTER FUNCTION "public"."log_stat_column_parity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_waiver_priority_integrity"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE n INT; miss INT; frag INT;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE problem = 'MISSING_ROW'),
         count(*) FILTER (WHERE problem = 'NOT_CONTIGUOUS')
    INTO n, miss, frag
    FROM public.check_waiver_priority_integrity();

  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'waiver_priority_integrity',
          CASE WHEN n = 0 THEN 'pass' ELSE 'fail' END,
          'leagues with missing waiver_priority rows: ' || miss
            || '; leagues whose priorities are not 1..N: ' || frag
            || ' -- an unseeded team is invisible to process_waiver_claims ORDER BY, '
            || 'so competing claims silently resolve first-come-first-served',
          false);
END $$;


ALTER FUNCTION "public"."log_waiver_priority_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_weekly_stats_vs_source"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into integrity_check_results(check_time, check_name, status, details, auto_fixed)
  select now(), 'weekly_stats_vs_source',
         case when count(*) > 0 then 'fail' else 'pass' end,
         coalesce(string_agg(stat||' wk'||week_number||': stored '||stored||' vs source '||source, '; '),
                  'weekly cache matches source on every stat'),
         false
    from public.check_weekly_stats_vs_source();
$$;


ALTER FUNCTION "public"."log_weekly_stats_vs_source"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_xg_chain_integrity"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_err int; v_warn int; v_detail text;
BEGIN
  SELECT count(*) FILTER (WHERE severity='ERROR'), count(*) FILTER (WHERE severity='WARN'),
         coalesce(string_agg(severity||' '||season||' '||metric||'='||value, '; '), '')
    INTO v_err, v_warn, v_detail FROM public.check_xg_chain_integrity();
  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'xg_chain_integrity',
          CASE WHEN v_err>0 THEN 'fail' WHEN v_warn>0 THEN 'warning' ELSE 'pass' END,
          CASE WHEN v_detail <> '' THEN left(v_detail,900)
               ELSE 'event chain sound in every season: no negative inter-event times, rebound detection in band' END,
          false);
END; $$;


ALTER FUNCTION "public"."log_xg_chain_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_xg_integrity"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
  SELECT now(), 'xg_integrity',
         CASE d.severity WHEN 'ERROR' THEN 'fail' WHEN 'WARN' THEN 'warning' ELSE 'warning' END,
         'season ' || d.season || ' ' || d.metric || '=' || d.value ||
         ' (expected ' || d.expected || '): ' || d.issue, false
    FROM public.check_xg_integrity() d;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
    VALUES (now(), 'xg_integrity', 'pass', 'all seasons within tolerance', false);
  END IF;
  RETURN v_n;
END
$$;


ALTER FUNCTION "public"."log_xg_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_xg_integrity"() IS 'DEPRECATED -- wrapper for the retired-import gate check_xg_integrity(). Uncalled by design. See that function''s comment.';



CREATE OR REPLACE FUNCTION "public"."log_xg_integrity_v2"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  select now(), 'xg_integrity_v2',
         case when count(*) filter (where severity = 'ERROR') > 0 then 'fail'
              when count(*) filter (where severity = 'WARN')  > 0 then 'warning'
              else 'pass' end,
         left(coalesce(
           nullif(string_agg(severity||' '||season||' '||metric||'='||value, '; ')
                    filter (where severity <> 'INFO'), ''),
           'clean -- calibration residual after GSAx within tolerance in every season'
         ) || ' || INFO: ' || coalesce(string_agg(season||' '||metric||'='||value, '; ')
                                         filter (where severity = 'INFO'), 'none'), 900),
         false
    from public.check_xg_integrity_v2();
$$;


ALTER FUNCTION "public"."log_xg_integrity_v2"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_xg_integrity_v2"() IS 'Cron wrapper for check_xg_integrity_v2 (job 23, 05:45 UTC). Status is decided by ERROR/WARN only -- INFO rows are informational by construction and must never colour the gate.';



CREATE OR REPLACE FUNCTION "public"."make_draft_pick"("p_league_id" "uuid", "p_team_id" "uuid", "p_player_id" "text", "p_round_number" integer, "p_pick_number" integer, "p_draft_session_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."make_draft_pick"("p_league_id" "uuid", "p_team_id" "uuid", "p_player_id" "text", "p_round_number" integer, "p_pick_number" integer, "p_draft_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manual_recover_team"("p_team_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result RECORD;
  v_team_name TEXT;
BEGIN
  SELECT team_name INTO v_team_name FROM teams WHERE id = p_team_id;
  
  IF v_team_name IS NULL THEN
    RETURN 'Team not found';
  END IF;
  
  RAISE NOTICE '[MANUAL_RECOVERY] Recovering team: %', v_team_name;
  
  -- Run smart restore
  SELECT * INTO v_result FROM smart_restore_team_lineups(p_team_id);
  
  -- Log recovery
  INSERT INTO auto_recovery_log (
    trigger_reason,
    teams_affected,
    players_restored,
    recovery_method,
    success,
    details
  )
  VALUES (
    'Manual recovery requested',
    ARRAY[v_team_name],
    v_result.starters_count + v_result.bench_count + v_result.ir_count,
    'manual_recover_team',
    v_result.success,
    v_result.message
  );
  
  RETURN 'Recovery complete: ' || v_result.message;
END;
$$;


ALTER FUNCTION "public"."manual_recover_team"("p_team_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."manual_recover_team"("p_team_id" "uuid") IS 'Manually trigger recovery for a specific team.
Usage: SELECT manual_recover_team(''team-uuid'');';



CREATE OR REPLACE FUNCTION "public"."materialize_scoring_settings"("p_league_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer;
begin
  update public.leagues l
     set scoring_settings = jsonb_build_object(
           'skater', coalesce(l.scoring_settings->'skater','{}'::jsonb)
                     || (public.scoring_rules_to_jsonb(l.id)->'skater'),
           'goalie', coalesce(l.scoring_settings->'goalie','{}'::jsonb)
                     || (public.scoring_rules_to_jsonb(l.id)->'goalie'))
   where l.id = p_league_id
     and l.scoring_settings is distinct from jsonb_build_object(
           'skater', coalesce(l.scoring_settings->'skater','{}'::jsonb)
                     || (public.scoring_rules_to_jsonb(l.id)->'skater'),
           'goalie', coalesce(l.scoring_settings->'goalie','{}'::jsonb)
                     || (public.scoring_rules_to_jsonb(l.id)->'goalie'));
  get diagnostics n = row_count;
  return n;
end;
$$;


ALTER FUNCTION "public"."materialize_scoring_settings"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."nightly_xg_pipeline"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_season int; v_new_arena bigint; v_adj bigint; v_scored bigint; v_unscored bigint;
        v_gsax bigint; v_msg text;
begin
  select max(season) into v_season from nhl_shots;
  if v_season is null then return 'no shots'; end if;

  insert into nhl_game_arena(game_id, season, home_team)
  select game_id, max(season), max(team_id) filter (where is_home)
  from nhl_shots where season = v_season group by game_id
  having max(team_id) filter (where is_home) is not null
  on conflict (game_id) do update set season=excluded.season, home_team=excluded.home_team;
  get diagnostics v_new_arena = row_count;

  v_adj    := public.apply_rink_adjustment_live(v_season);
  v_scored := public.score_xg_sql_v2(v_season);
  perform public.refresh_xg_season_layer(v_season);

  select o_count into v_gsax
    from public.rebuild_goalie_gsax_primary() where o_metric = 'goalies_written';

  select count(*) into v_unscored from nhl_shots
   where season = v_season and distance is not null and xg_sql is null;

  perform public.record_rebuild_audit(v_season, 'nightly_xg_unscored', 0, v_unscored,
    'nightly_xg_pipeline: arena rows '||v_new_arena||', rink-adjusted '||v_adj||
    ', scored '||v_scored||', goalie_gsax_primary rows '||v_gsax||'.');

  v_msg := format('season=%s arena=%s adjusted=%s scored=%s gsax=%s unscored=%s',
                  v_season, v_new_arena, v_adj, v_scored, v_gsax, v_unscored);
  return v_msg;
end $$;


ALTER FUNCTION "public"."nightly_xg_pipeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_league_members"("p_league_id" "uuid", "p_title" "text", "p_message" "text", "p_notification_type" "text" DEFAULT 'SYSTEM'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id UUID;
  v_league_member_id UUID;
  v_notifications_created INTEGER := 0;
BEGIN
  -- Get authenticated user
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- Verify caller is the commissioner of the league
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
    AND commissioner_id = v_caller_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only commissioners can send system notifications');
  END IF;

  -- Validate notification type
  IF p_notification_type NOT IN ('ADD', 'DROP', 'WAIVER', 'TRADE', 'CHAT', 'SYSTEM') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid notification type');
  END IF;

  -- Validate message
  IF p_message IS NULL OR trim(p_message) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Message cannot be empty');
  END IF;

  -- Create notifications for ALL league members (including commissioner)
  FOR v_league_member_id IN
    SELECT DISTINCT t.owner_id
    FROM public.teams t
    WHERE t.league_id = p_league_id
      AND t.owner_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata,
      read_status,
      read_at
    ) VALUES (
      p_league_id,
      v_league_member_id,
      p_notification_type,
      COALESCE(p_title, 'League Update'),
      trim(p_message),
      jsonb_build_object(
        'source', 'commissioner',
        'commissioner_id', v_caller_id
      ),
      -- Mark as read for the commissioner (they initiated the action)
      v_league_member_id = v_caller_id,
      CASE WHEN v_league_member_id = v_caller_id THEN now() ELSE NULL END
    );
    v_notifications_created := v_notifications_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'notifications_created', v_notifications_created,
    'message', format('Notified %s league members', v_notifications_created)
  );
END;
$$;


ALTER FUNCTION "public"."notify_league_members"("p_league_id" "uuid", "p_title" "text", "p_message" "text", "p_notification_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_league_on_transaction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_name TEXT;
  v_player_name TEXT;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
BEGIN
  IF NEW.type NOT IN ('ADD', 'DROP') THEN
    RETURN NEW;
  END IF;

  SELECT team_name INTO v_team_name FROM public.teams WHERE id = NEW.team_id;
  v_team_name := COALESCE(v_team_name, 'A team');

  BEGIN
    SELECT full_name INTO v_player_name
    FROM public.player_directory
    WHERE player_id = NEW.player_id::INT
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_player_name := NULL;
  END;
  v_player_name := COALESCE(v_player_name, 'Player ' || NEW.player_id);

  IF NEW.type = 'ADD' THEN
    v_type := 'ADD';
    IF NEW.source = 'Waiver Processing' THEN
      v_title := 'Waiver Claim Awarded';
      v_message := v_team_name || ' was awarded ' || v_player_name || ' off waivers.';
    ELSE
      v_title := 'Free Agent Added';
      v_message := v_team_name || ' added ' || v_player_name || '.';
    END IF;
  ELSE
    v_type := 'DROP';
    v_title := 'Player Dropped';
    v_message := v_team_name || ' dropped ' || v_player_name || '.';
  END IF;

  INSERT INTO public.notifications (user_id, league_id, type, title, message, metadata, created_at)
  SELECT t.owner_id, NEW.league_id, v_type, v_title, v_message,
    jsonb_build_object(
      'team_id', NEW.team_id,
      'team_name', v_team_name,
      'player_id', NEW.player_id,
      'player_name', v_player_name,
      'source', NEW.source
    ),
    NOW()
  FROM public.teams t
  WHERE t.league_id = NEW.league_id AND t.owner_id IS NOT NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM public.log_function_error('notify_league_on_transaction', SQLSTATE, SQLERRM, 'league notification dropped', jsonb_build_object('league_id', NEW.league_id, 'team_id', NEW.team_id, 'player_id', NEW.player_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_league_on_transaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."nuclear_reset_draft"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_commissioner_id UUID;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id
  FROM public.leagues
  WHERE id = p_league_id;

  IF v_commissioner_id IS NULL OR v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can reset the draft';
  END IF;

  DELETE FROM public.draft_picks WHERE league_id = p_league_id;
  DELETE FROM public.draft_order WHERE league_id = p_league_id;
  DELETE FROM public.team_lineups
    WHERE team_id IN (SELECT id FROM public.teams WHERE league_id = p_league_id);
  DELETE FROM public.roster_assignments WHERE league_id = p_league_id;

  UPDATE public.leagues
  SET draft_status = 'not_started',
      scheduled_draft_time = NULL,
      settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{timerStartedAt}', 'null'::jsonb)
  WHERE id = p_league_id;
END;
$$;


ALTER FUNCTION "public"."nuclear_reset_draft"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."optimize_best_ball_daily_rosters"("p_league_id" "uuid", "p_roster_date" "date") RETURNS TABLE("team_id" "uuid", "players_optimized" integer, "total_points" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team RECORD; v_matchup_id UUID; v_player RECORD;
  v_slot_counts JSONB; v_slots_remaining JSONB;
  v_inserted INT; v_total NUMERIC; v_slot TEXT;
  v_league_settings JSONB; v_scoring JSONB; v_season INT;
  w_goals NUMERIC; w_assists NUMERIC; w_sog NUMERIC; w_blocks NUMERIC; w_hits NUMERIC;
  w_ppp NUMERIC; w_shp NUMERIC; w_pim NUMERIC;
  w_goalie_wins NUMERIC; w_goalie_saves NUMERIC; w_goalie_shutouts NUMERIC; w_goalie_ga NUMERIC;
BEGIN
  SELECT l.settings, l.scoring_settings INTO v_league_settings, v_scoring
  FROM leagues l WHERE l.id = p_league_id;

  v_slot_counts := COALESCE(v_league_settings->'rosterSlots',
    '{"C":2,"LW":2,"RW":2,"D":4,"G":2,"UTIL":2}'::JSONB);

  w_goals   := COALESCE((v_scoring->'skater'->>'goals')::NUMERIC, 3.0);
  w_assists := COALESCE((v_scoring->'skater'->>'assists')::NUMERIC, 2.0);
  w_sog     := COALESCE((v_scoring->'skater'->>'shots_on_goal')::NUMERIC, 0.4);
  w_blocks  := COALESCE((v_scoring->'skater'->>'blocks')::NUMERIC, 0.5);
  w_hits    := COALESCE((v_scoring->'skater'->>'hits')::NUMERIC, 0.2);
  w_ppp     := COALESCE((v_scoring->'skater'->>'power_play_points')::NUMERIC, 1.0);
  w_shp     := COALESCE((v_scoring->'skater'->>'short_handed_points')::NUMERIC, 2.0);
  w_pim     := COALESCE((v_scoring->'skater'->>'penalty_minutes')::NUMERIC, 0.5);
  w_goalie_wins     := COALESCE((v_scoring->'goalie'->>'wins')::NUMERIC, 4.0);
  w_goalie_saves    := COALESCE((v_scoring->'goalie'->>'saves')::NUMERIC, 0.2);
  w_goalie_shutouts := COALESCE((v_scoring->'goalie'->>'shutouts')::NUMERIC, 3.0);
  w_goalie_ga       := COALESCE((v_scoring->'goalie'->>'goals_against')::NUMERIC, -1.0);

  -- Season of the games actually played on this date. Schedule-driven, so it
  -- does not care that the 2026-27 season opens in September.
  SELECT g.season INTO v_season FROM nhl_games g WHERE g.game_date = p_roster_date LIMIT 1;
  IF v_season IS NULL THEN v_season := public.get_current_season(); END IF;

  FOR v_team IN SELECT t.id AS tid FROM teams t WHERE t.league_id = p_league_id
  LOOP
    v_inserted := 0; v_total := 0; v_slots_remaining := v_slot_counts;

    SELECT m.id INTO v_matchup_id
    FROM matchups m
    WHERE m.league_id = p_league_id
      AND (m.team1_id = v_team.tid OR m.team2_id = v_team.tid)
      AND m.week_start_date <= p_roster_date
      AND m.week_end_date >= p_roster_date
    LIMIT 1;

    -- fantasy_daily_rosters.matchup_id is NOT NULL. No covering matchup means
    -- there is nothing to attribute this day to; skip rather than abort.
    IF v_matchup_id IS NULL THEN
      RAISE NOTICE 'best ball: no matchup covers % for team %, skipping', p_roster_date, v_team.tid;
      team_id := v_team.tid; players_optimized := 0; total_points := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    DELETE FROM fantasy_daily_rosters fdr
     WHERE fdr.league_id = p_league_id
       AND fdr.team_id = v_team.tid
       AND fdr.roster_date = p_roster_date;

    FOR v_player IN
      SELECT ra.player_id AS pid, pd.position_code AS pos,
        COALESCE(SUM(
          CASE WHEN pgs.is_goalie = false THEN
            (pgs.nhl_goals * w_goals) + (pgs.nhl_assists * w_assists) +
            (pgs.nhl_shots_on_goal * w_sog) + (pgs.nhl_blocks * w_blocks) +
            (COALESCE(pgs.nhl_hits, 0) * w_hits) + (COALESCE(pgs.nhl_ppp, 0) * w_ppp) +
            (COALESCE(pgs.nhl_shp, 0) * w_shp) + (COALESCE(pgs.nhl_pim, 0) * w_pim)
          ELSE
            (pgs.nhl_wins * w_goalie_wins) + (pgs.nhl_saves * w_goalie_saves) +
            (pgs.nhl_shutouts * w_goalie_shutouts) + (pgs.nhl_goals_against * w_goalie_ga)
          END), 0) AS day_points
      FROM roster_assignments ra
      LEFT JOIN player_directory pd
        ON pd.player_id = ra.player_id::INT AND pd.season = v_season
      -- The date must constrain the STATS, not merely decide whether ng is
      -- NULL. EXISTS keeps the outer-join semantics: a player who did not play
      -- that day still appears, with 0.
      LEFT JOIN player_game_stats pgs
        ON pgs.player_id = ra.player_id::INT
       AND EXISTS (SELECT 1 FROM nhl_games ng
                    WHERE ng.game_id = pgs.game_id AND ng.game_date = p_roster_date)
      WHERE ra.league_id = p_league_id AND ra.team_id = v_team.tid
      GROUP BY ra.player_id, pd.position_code
      ORDER BY day_points DESC
    LOOP
      v_slot := NULL;

      IF v_player.pos IN ('C','Centre') AND COALESCE((v_slots_remaining->>'C')::INT,0) > 0 THEN
        v_slot := 'C';
      ELSIF v_player.pos IN ('LW','L','Left Wing') AND COALESCE((v_slots_remaining->>'LW')::INT,0) > 0 THEN
        v_slot := 'LW';
      ELSIF v_player.pos IN ('RW','R','Right Wing') AND COALESCE((v_slots_remaining->>'RW')::INT,0) > 0 THEN
        v_slot := 'RW';
      ELSIF v_player.pos IN ('D','Defence','Defense') AND COALESCE((v_slots_remaining->>'D')::INT,0) > 0 THEN
        v_slot := 'D';
      ELSIF v_player.pos IN ('G','Goalie') AND COALESCE((v_slots_remaining->>'G')::INT,0) > 0 THEN
        v_slot := 'G';
      ELSIF v_player.pos IS NOT NULL AND v_player.pos NOT IN ('G','Goalie')
            AND COALESCE((v_slots_remaining->>'UTIL')::INT,0) > 0 THEN
        v_slot := 'UTIL';
      END IF;

      IF v_slot IS NOT NULL THEN
        INSERT INTO fantasy_daily_rosters (league_id, team_id, matchup_id, player_id, roster_date, slot_type)
        VALUES (p_league_id, v_team.tid, v_matchup_id, v_player.pid::INT, p_roster_date, 'active')
        ON CONFLICT DO NOTHING;
        v_slots_remaining := jsonb_set(v_slots_remaining, ARRAY[v_slot],
          to_jsonb(GREATEST(0, COALESCE((v_slots_remaining->>v_slot)::INT,0) - 1)));
        v_inserted := v_inserted + 1;
        v_total := v_total + v_player.day_points;
      ELSE
        INSERT INTO fantasy_daily_rosters (league_id, team_id, matchup_id, player_id, roster_date, slot_type)
        VALUES (p_league_id, v_team.tid, v_matchup_id, v_player.pid::INT, p_roster_date, 'bench')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    team_id := v_team.tid; players_optimized := v_inserted; total_points := ROUND(v_total, 3);
    RETURN NEXT;
  END LOOP;

  RETURN;
END $$;


ALTER FUNCTION "public"."optimize_best_ball_daily_rosters"("p_league_id" "uuid", "p_roster_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."persist_matchup_lines"("p_matchup_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_rows int := 0;
  m record;
begin
  select id, league_id, team1_id, team2_id, week_start_date, week_end_date
    into m from matchups where id = p_matchup_id;
  if not found then
    raise exception 'matchup % not found', p_matchup_id;
  end if;

  delete from fantasy_matchup_lines where matchup_id = p_matchup_id;

  with teams as (
    select m.team1_id as team_id where m.team1_id is not null
    union all
    select m.team2_id where m.team2_id is not null
  ),
  rules as (
    select r.stat_key, r.multiplier
      from public.get_effective_scoring_rules(m.league_id) r
  ),
  detail as (
    select t.team_id,
           l.player_id,
           l.stat_key,
           sum(l.value)                       as total_value,
           max(rules.multiplier)              as multiplier,
           sum(l.value * rules.multiplier)    as points,
           count(distinct fdr.roster_date)    as dates
      from teams t
      join fantasy_daily_rosters fdr
        on fdr.matchup_id = m.id
       and fdr.team_id    = t.team_id
       and fdr.slot_type  = 'active'
       and fdr.roster_date between m.week_start_date and m.week_end_date
      join player_game_stats pgs
        on pgs.player_id = fdr.player_id
       and pgs.game_date = fdr.roster_date
      join nhl_games g
        on g.game_id = pgs.game_id and g.game_type = 'regular'
      join public.v_player_game_stat_long l
        on l.game_id = pgs.game_id and l.player_id = pgs.player_id
      join rules on rules.stat_key = l.stat_key
     group by t.team_id, l.player_id, l.stat_key
  ),
  rolled as (
    select team_id, player_id,
           round(sum(points),3) as total_points,
           max(dates)           as games_played,
           coalesce(
             jsonb_object_agg(stat_key,
               jsonb_build_object('value', total_value,
                                  'multiplier', multiplier,
                                  'points', round(points,3)))
             filter (where total_value <> 0),
             '{}'::jsonb) as breakdown
      from detail group by team_id, player_id
  )
  insert into fantasy_matchup_lines
    (matchup_id, player_id, team_id, total_points, stats_breakdown, games_played)
  select p_matchup_id, r.player_id, r.team_id, r.total_points, r.breakdown, r.games_played
    from rolled r;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;


ALTER FUNCTION "public"."persist_matchup_lines"("p_matchup_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."persist_matchup_lines"("p_matchup_id" "uuid") IS 'Writes the per-player audit trail for a matchup, including the per-stat arithmetic in stats_breakdown. Sum of total_points must equal the matchup score - that is what verify_matchup_scores checks.';



CREATE OR REPLACE FUNCTION "public"."populate_league_averages"("p_season" integer) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rows_affected INTEGER := 0;
  v_position TEXT;
  v_avg_ppg NUMERIC;
  v_avg_goals NUMERIC;
  v_avg_assists NUMERIC;
  v_avg_sog NUMERIC;
  v_avg_blocks NUMERIC;
  v_avg_ppp NUMERIC;
  v_avg_shp NUMERIC;
  v_avg_hits NUMERIC;
  v_avg_pim NUMERIC;
  v_sample_size INTEGER;
BEGIN
  -- Loop through each position from player_directory (not player_season_stats)
  FOR v_position IN 
    SELECT DISTINCT pd.position_code 
    FROM public.player_directory pd
    INNER JOIN public.player_season_stats pss ON pd.player_id = pss.player_id AND pd.season = pss.season
    WHERE pd.season = p_season 
      AND pd.position_code IS NOT NULL
      AND pss.games_played > 0
  LOOP
    -- Calculate averages for this position (join with player_directory to get position)
    -- NOW INCLUDES ALL 8 STATS: goals, assists, SOG, blocks, PPP, SHP, hits, PIM
    SELECT 
      COUNT(*)::INTEGER,
      COALESCE(AVG(
        CASE 
          WHEN pss.games_played > 0 THEN 
            (pss.goals * 3.0 + pss.primary_assists * 2.0 + pss.secondary_assists * 2.0 + 
             pss.shots_on_goal * 0.4 + pss.blocks * 0.5 + 
             pss.ppp * 1.0 + pss.shp * 2.0 + pss.hits * 0.2 + pss.pim * 0.5) / pss.games_played::NUMERIC
          ELSE 0
        END
      ), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.goals::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN (pss.primary_assists + pss.secondary_assists)::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.shots_on_goal::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.blocks::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      -- NEW: Calculate PPP, SHP, hits, PIM averages
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.ppp::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.shp::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.hits::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.pim::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3)
    INTO 
      v_sample_size,
      v_avg_ppg,
      v_avg_goals,
      v_avg_assists,
      v_avg_sog,
      v_avg_blocks,
      v_avg_ppp,
      v_avg_shp,
      v_avg_hits,
      v_avg_pim
    FROM public.player_season_stats pss
    INNER JOIN public.player_directory pd ON pss.player_id = pd.player_id AND pss.season = pd.season
    WHERE pss.season = p_season 
      AND pd.position_code = v_position
      AND pss.games_played > 0; -- Only include players who have played
    
    -- Skip if no data
    IF v_sample_size = 0 THEN
      CONTINUE;
    END IF;
    
    -- Upsert league average for this position (NOW INCLUDES ALL 8 STATS)
    INSERT INTO public.league_averages (
      position,
      season,
      avg_ppg,
      avg_goals_per_game,
      avg_assists_per_game,
      avg_sog_per_game,
      avg_blocks_per_game,
      avg_ppp_per_game,
      avg_shp_per_game,
      avg_hits_per_game,
      avg_pim_per_game,
      sample_size
    )
    VALUES (
      v_position,
      p_season,
      v_avg_ppg,
      v_avg_goals,
      v_avg_assists,
      v_avg_sog,
      v_avg_blocks,
      v_avg_ppp,
      v_avg_shp,
      v_avg_hits,
      v_avg_pim,
      v_sample_size
    )
    ON CONFLICT (position, season)
    DO UPDATE SET
      avg_ppg = EXCLUDED.avg_ppg,
      avg_goals_per_game = EXCLUDED.avg_goals_per_game,
      avg_assists_per_game = EXCLUDED.avg_assists_per_game,
      avg_sog_per_game = EXCLUDED.avg_sog_per_game,
      avg_blocks_per_game = EXCLUDED.avg_blocks_per_game,
      avg_ppp_per_game = EXCLUDED.avg_ppp_per_game,
      avg_shp_per_game = EXCLUDED.avg_shp_per_game,
      avg_hits_per_game = EXCLUDED.avg_hits_per_game,
      avg_pim_per_game = EXCLUDED.avg_pim_per_game,
      sample_size = EXCLUDED.sample_size,
      updated_at = NOW();
    
    v_rows_affected := v_rows_affected + 1;
  END LOOP;
  
  RETURN v_rows_affected;
END;
$$;


ALTER FUNCTION "public"."populate_league_averages"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."populate_league_averages"("p_season" integer) IS 'Populates league_averages table from player_season_stats for a given season. Calculates position-specific averages for ALL 8 fantasy stats (goals, assists, SOG, blocks, PPP, SHP, hits, PIM) for Bayesian shrinkage.';



CREATE OR REPLACE FUNCTION "public"."populate_player_weekly_stats"("p_week_number" integer, "p_week_start_date" "date", "p_week_end_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.player_weekly_stats (
    player_id, week_number, week_start_date, week_end_date,
    goals, primary_assists, secondary_assists, shots_on_goal, hits, blocks, pim, ppp, shp,
    plus_minus, goalie_gp, wins, saves, goals_against, shots_faced, shutouts,
    nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim,
    nhl_ppp, nhl_shp, nhl_plus_minus, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves,
    nhl_shots_faced, nhl_goals_against, nhl_shutouts,
    x_goals, games_played
  )
  SELECT
    pgs.player_id, p_week_number, p_week_start_date, p_week_end_date,
    COALESCE(SUM(pgs.goals), 0)::INTEGER,
    COALESCE(SUM(pgs.primary_assists), 0)::INTEGER,
    COALESCE(SUM(pgs.secondary_assists), 0)::INTEGER,
    COALESCE(SUM(pgs.shots_on_goal), 0)::INTEGER,
    COALESCE(SUM(pgs.hits), 0)::INTEGER,
    COALESCE(SUM(pgs.blocks), 0)::INTEGER,
    COALESCE(SUM(pgs.pim), 0)::INTEGER,
    COALESCE(SUM(pgs.ppp), 0)::INTEGER,
    COALESCE(SUM(pgs.shp), 0)::INTEGER,
    COALESCE(SUM(pgs.plus_minus), 0)::INTEGER,
    COALESCE(SUM(pgs.goalie_gp), 0)::INTEGER,
    COALESCE(SUM(pgs.wins), 0)::INTEGER,
    COALESCE(SUM(pgs.saves), 0)::INTEGER,
    COALESCE(SUM(pgs.goals_against), 0)::INTEGER,
    COALESCE(SUM(pgs.shots_faced), 0)::INTEGER,
    COALESCE(SUM(pgs.shutouts), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_goals), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_assists), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_goals + pgs.nhl_assists), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_shots_on_goal), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_hits), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_blocks), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_pim), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_ppp), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_shp), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_plus_minus), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_wins), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_losses), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_ot_losses), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_saves), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_shots_faced), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_goals_against), 0)::INTEGER,
    COALESCE(SUM(pgs.nhl_shutouts), 0)::INTEGER,
    COALESCE((
      SELECT SUM(s.xg_sql)
      FROM public.nhl_shots s
      INNER JOIN public.nhl_games ng2 ON s.game_id = ng2.game_id
      WHERE s.shooter_id = pgs.player_id
        AND ng2.game_date >= p_week_start_date
        AND ng2.game_date <= p_week_end_date
        AND ng2.game_type = 'regular'
    ), 0)::NUMERIC(10, 3),
    COUNT(DISTINCT pgs.game_id)::INTEGER
  FROM public.player_game_stats pgs
  INNER JOIN public.nhl_games ng ON pgs.game_id = ng.game_id
  WHERE ng.game_date >= p_week_start_date
    AND ng.game_date <= p_week_end_date
    AND ng.game_type = 'regular'
  GROUP BY pgs.player_id
  ON CONFLICT (player_id, week_number, week_start_date)
  DO UPDATE SET
    goals = EXCLUDED.goals, primary_assists = EXCLUDED.primary_assists,
    secondary_assists = EXCLUDED.secondary_assists, shots_on_goal = EXCLUDED.shots_on_goal,
    hits = EXCLUDED.hits, blocks = EXCLUDED.blocks, pim = EXCLUDED.pim,
    ppp = EXCLUDED.ppp, shp = EXCLUDED.shp, plus_minus = EXCLUDED.plus_minus,
    goalie_gp = EXCLUDED.goalie_gp, wins = EXCLUDED.wins, saves = EXCLUDED.saves,
    goals_against = EXCLUDED.goals_against, shots_faced = EXCLUDED.shots_faced,
    shutouts = EXCLUDED.shutouts, nhl_goals = EXCLUDED.nhl_goals,
    nhl_assists = EXCLUDED.nhl_assists, nhl_points = EXCLUDED.nhl_points,
    nhl_shots_on_goal = EXCLUDED.nhl_shots_on_goal, nhl_hits = EXCLUDED.nhl_hits,
    nhl_blocks = EXCLUDED.nhl_blocks, nhl_pim = EXCLUDED.nhl_pim,
    nhl_ppp = EXCLUDED.nhl_ppp, nhl_shp = EXCLUDED.nhl_shp,
    nhl_plus_minus = EXCLUDED.nhl_plus_minus, nhl_wins = EXCLUDED.nhl_wins,
    nhl_losses = EXCLUDED.nhl_losses, nhl_ot_losses = EXCLUDED.nhl_ot_losses,
    nhl_saves = EXCLUDED.nhl_saves, nhl_shots_faced = EXCLUDED.nhl_shots_faced,
    nhl_goals_against = EXCLUDED.nhl_goals_against, nhl_shutouts = EXCLUDED.nhl_shutouts,
    x_goals = EXCLUDED.x_goals, games_played = EXCLUDED.games_played,
    updated_at = now();
END;
$$;


ALTER FUNCTION "public"."populate_player_weekly_stats"("p_week_number" integer, "p_week_start_date" "date", "p_week_end_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."populate_player_weekly_stats"("p_week_number" integer, "p_week_start_date" "date", "p_week_end_date" "date") IS 'Populates weekly stats for a specific week from player_game_stats, using PBP-calculated stats for matchup weeks. NHL stats columns exist but will remain 0 until per-game NHL stats are populated (future enhancement).';



CREATE OR REPLACE FUNCTION "public"."process_all_faab_waivers"() RETURNS TABLE("league_id" "uuid", "league_name" "text", "claims_processed" integer, "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_league RECORD;
  v_count INT;
BEGIN
  FOR v_league IN
    SELECT l.id, l.name, l.waiver_process_time
    FROM leagues l
    WHERE l.waiver_type = 'faab'
      AND EXISTS (
        SELECT 1 FROM waiver_claims wc
        WHERE wc.league_id = l.id AND wc.status = 'pending'
      )
      -- Process if current EST time is within 30 min of waiver_process_time
      -- This allows the hourly cron to catch all leagues
      AND (
        l.waiver_process_time IS NULL  -- No specific time = process at any cron run
        OR ABS(EXTRACT(EPOCH FROM (
          l.waiver_process_time - (NOW() AT TIME ZONE 'America/New_York')::TIME
        ))) < 1800  -- 30-minute window
      )
  LOOP
    -- Process this league's FAAB waivers
    SELECT COUNT(*) INTO v_count
    FROM process_faab_waivers_for_league(v_league.id);

    league_id := v_league.id;
    league_name := v_league.name;
    claims_processed := v_count;
    status := 'completed';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;


ALTER FUNCTION "public"."process_all_faab_waivers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_all_pending_waivers"() RETURNS TABLE("league_id" "uuid", "league_name" "text", "total_processed" integer, "successful" integer, "failed" integer, "details" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_league RECORD;
  v_result RECORD;
  v_processed INT := 0;
  v_successful INT := 0;
  v_failed INT := 0;
  v_details JSONB := '[]'::JSONB;
BEGIN
  FOR v_league IN
    SELECT DISTINCT wc.league_id, l.name AS league_name
    FROM waiver_claims wc
    JOIN leagues l ON l.id = wc.league_id
    WHERE wc.status = 'pending'
      AND COALESCE(l.waiver_type, 'rolling') <> 'faab'
  LOOP
    v_processed := 0;
    v_successful := 0;
    v_failed := 0;
    v_details := '[]'::JSONB;

    FOR v_result IN
      SELECT * FROM public.process_waiver_claims(v_league.league_id)
    LOOP
      v_processed := v_processed + 1;
      IF v_result.out_status = 'successful' THEN
        v_successful := v_successful + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

      v_details := v_details || jsonb_build_object(
        'claim_id', v_result.out_claim_id,
        'player_id', v_result.out_player_id,
        'team_id', v_result.out_team_id,
        'status', v_result.out_status,
        'failure_reason', v_result.out_failure_reason
      );
    END LOOP;

    league_id := v_league.league_id;
    league_name := v_league.league_name;
    total_processed := v_processed;
    successful := v_successful;
    failed := v_failed;
    details := v_details;
    RETURN NEXT;
  END LOOP;

  -- Mark expired player_waiver_status rows as cleared. Previously this
  -- UPDATE referenced waiver_period_hours as a column on player_waiver_status
  -- (it's on leagues), which raised "column does not exist" and rolled
  -- back every claim the cron had just processed.
  BEGIN
    UPDATE public.player_waiver_status pws
    SET cleared_at = NOW()
    FROM public.leagues l
    WHERE pws.league_id = l.id
      AND pws.cleared_at IS NULL
      AND NOW() > pws.dropped_at + (COALESCE(l.waiver_period_hours, 48) || ' hours')::INTERVAL;
  EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM public.log_function_error('process_all_pending_waivers', SQLSTATE, SQLERRM, 'expiry housekeeping', NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
    -- Never let housekeeping abort the whole cron run.
    NULL;
  END;

  RETURN;
END;
$$;


ALTER FUNCTION "public"."process_all_pending_waivers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_expired_trade_reviews"() RETURNS TABLE("trade_id" "uuid", "league_id" "uuid", "action" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_trade RECORD; v_league RECORD; v_total_teams INT; v_veto_count INT;
  v_threshold INT; v_res JSONB;
BEGIN
  FOR v_trade IN
    SELECT * FROM trade_offers
    WHERE status = 'under_review' AND review_ends_at IS NOT NULL AND NOW() > review_ends_at
  LOOP
    SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;
    SELECT COUNT(*) INTO v_total_teams FROM teams t WHERE t.league_id = v_trade.league_id;
    SELECT COUNT(*) INTO v_veto_count FROM trade_votes
     WHERE trade_offer_id = v_trade.id AND vote = 'veto';

    -- GREATEST(...,1): with 2 teams the threshold computes to 0 and `0 >= 0`
    -- auto-vetoed every trade with no votes cast. A veto needs a veto.
    v_threshold := GREATEST(CEIL((v_total_teams - 2) * COALESCE(v_league.trade_veto_threshold, 0.5)), 1);

    IF v_veto_count >= v_threshold THEN
      UPDATE trade_offers SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
       WHERE id = v_trade.id;
      trade_id := v_trade.id; league_id := v_trade.league_id; action := 'vetoed';
      RETURN NEXT;
    ELSE
      -- Approved. Actually move the players -- this is what was missing.
      SELECT public.execute_trade(
        v_trade.id, v_trade.league_id, v_trade.from_team_id, v_trade.to_team_id,
        ARRAY(SELECT x::text FROM unnest(COALESCE(v_trade.offered_player_ids, ARRAY[]::int[])) x),
        ARRAY(SELECT x::text FROM unnest(COALESCE(v_trade.requested_player_ids, ARRAY[]::int[])) x)
      ) INTO v_res;

      IF COALESCE((v_res->>'success')::boolean, false) THEN
        UPDATE trade_offers SET status = 'accepted', processed_at = NOW() WHERE id = v_trade.id;
        trade_id := v_trade.id; league_id := v_trade.league_id; action := 'approved';
      ELSE
        -- Do NOT report an accepted trade that did not happen.
        UPDATE trade_offers SET status = 'failed', processed_at = NOW() WHERE id = v_trade.id;
        trade_id := v_trade.id; league_id := v_trade.league_id;
        action := 'failed: ' || COALESCE(v_res->>'error', 'unknown');
      END IF;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END $$;


ALTER FUNCTION "public"."process_expired_trade_reviews"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_faab_waivers_for_league"("p_league_id" "uuid") RETURNS TABLE("claim_id" "uuid", "team_id" "uuid", "player_id" integer, "bid_amount" numeric, "status" "text", "failure_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
DECLARE
  v_lock_acquired BOOLEAN; v_player_record RECORD; v_bid RECORD; v_winner RECORD;
  v_have_winner BOOLEAN; v_budget NUMERIC; v_move_result JSONB; v_user_id UUID;
  v_processed INT := 0; v_move_ok BOOLEAN;
BEGIN
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('faab_' || p_league_id::TEXT));
  IF NOT v_lock_acquired THEN
    RAISE NOTICE 'FAAB processing already in progress for league %', p_league_id;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND waiver_type = 'faab') THEN
    RAISE NOTICE 'League % does not use FAAB waivers, skipping', p_league_id;
    RETURN;
  END IF;

  FOR v_player_record IN
    SELECT DISTINCT wc.player_id AS pid FROM waiver_claims wc
    WHERE wc.league_id = p_league_id AND wc.status = 'pending'
  LOOP
    v_have_winner := false;

    FOR v_bid IN
      SELECT wc.id AS claim_id, wc.team_id AS team_id, wc.player_id AS player_id,
             COALESCE(wc.bid_amount, 0)::NUMERIC AS bid_amount,
             wc.drop_player_id, wc.is_conditional_drop, wc.created_at,
             COALESCE(standings.wins, 0)::NUMERIC /
               GREATEST(1, COALESCE(standings.wins, 0) + COALESCE(standings.losses, 0)) AS win_pct
      FROM waiver_claims wc
      JOIN teams t ON t.id = wc.team_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE (m.team1_id = t.id AND m.team1_score > m.team2_score)
                                   OR (m.team2_id = t.id AND m.team2_score > m.team1_score)) AS wins,
               COUNT(*) FILTER (WHERE (m.team1_id = t.id AND m.team1_score < m.team2_score)
                                   OR (m.team2_id = t.id AND m.team2_score < m.team1_score)) AS losses
        FROM matchups m
        WHERE m.league_id = p_league_id AND m.status = 'completed'
          AND (m.team1_id = t.id OR m.team2_id = t.id)
      ) standings ON true
      WHERE wc.league_id = p_league_id
        AND wc.player_id = v_player_record.pid
        AND wc.status = 'pending'
      ORDER BY COALESCE(wc.bid_amount, 0) DESC, win_pct ASC, wc.created_at ASC, wc.id ASC
    LOOP
      SELECT fb.remaining_budget INTO v_budget
      FROM faab_budgets fb
      WHERE fb.league_id = p_league_id AND fb.team_id = v_bid.team_id;

      IF v_budget IS NULL THEN
        SELECT COALESCE((SELECT COALESCE((l.settings->>'faabBudget')::NUMERIC, 100)
                           FROM leagues l WHERE l.id = p_league_id), 100)
             - COALESCE((SELECT SUM(COALESCE(wc2.bid_amount, 0))
                           FROM waiver_claims wc2
                          WHERE wc2.league_id = p_league_id
                            AND wc2.team_id = v_bid.team_id
                            AND wc2.status = 'successful'), 0)
          INTO v_budget;
      END IF;

      IF v_budget >= v_bid.bid_amount THEN
        v_winner := v_bid; v_have_winner := true; EXIT;
      END IF;
    END LOOP;

    IF v_have_winner THEN
      SELECT t.owner_id INTO v_user_id FROM teams t WHERE t.id = v_winner.team_id LIMIT 1;
      v_move_ok := false;

      IF v_user_id IS NULL THEN
        UPDATE waiver_claims wc SET status='failed', failure_reason='Team has no owner', processed_at=NOW()
        WHERE wc.id = v_winner.claim_id;
        RETURN QUERY SELECT v_winner.claim_id, v_winner.team_id, v_winner.player_id,
                            v_winner.bid_amount::NUMERIC, 'failed'::TEXT, 'Team has no owner'::TEXT;
      ELSE
        BEGIN
          SELECT public.process_roster_move(p_league_id, v_user_id,
            CASE WHEN v_winner.drop_player_id IS NOT NULL THEN v_winner.drop_player_id::TEXT ELSE NULL END,
            v_winner.player_id::TEXT, 'FAAB Waiver') INTO v_move_result;
        EXCEPTION WHEN OTHERS THEN
          IF v_winner.is_conditional_drop AND v_winner.drop_player_id IS NOT NULL THEN
            BEGIN
              SELECT public.process_roster_move(p_league_id, v_user_id, NULL,
                v_winner.player_id::TEXT, 'FAAB Waiver (conditional drop skipped)') INTO v_move_result;
            EXCEPTION WHEN OTHERS THEN
              v_move_result := jsonb_build_object('success', false, 'error', SQLERRM);
            END;
          ELSE
            v_move_result := jsonb_build_object('success', false, 'error', SQLERRM);
          END IF;
        END;

        v_move_ok := COALESCE((v_move_result->>'success')::boolean, false);

        IF v_move_ok THEN
          UPDATE waiver_claims wc SET status='successful', processed_at=NOW() WHERE wc.id = v_winner.claim_id;

          UPDATE faab_budgets fb
             SET remaining_budget = GREATEST(0, fb.remaining_budget - v_winner.bid_amount), updated_at = NOW()
           WHERE fb.league_id = p_league_id AND fb.team_id = v_winner.team_id;

          IF NOT FOUND THEN
            INSERT INTO faab_budgets AS fbt (league_id, team_id, initial_budget, remaining_budget)
            SELECT p_league_id, v_winner.team_id,
                   COALESCE((l.settings->>'faabBudget')::NUMERIC, 100),
                   GREATEST(0, COALESCE((l.settings->>'faabBudget')::NUMERIC, 100) - v_winner.bid_amount)
              FROM leagues l WHERE l.id = p_league_id
            ON CONFLICT ON CONSTRAINT faab_budgets_league_id_team_id_key DO UPDATE
              SET remaining_budget = GREATEST(0, fbt.remaining_budget - v_winner.bid_amount),
                  updated_at = NOW();
          END IF;

          v_processed := v_processed + 1;
          RETURN QUERY SELECT v_winner.claim_id, v_winner.team_id, v_winner.player_id,
                              v_winner.bid_amount::NUMERIC, 'successful'::TEXT, NULL::TEXT;
        ELSE
          UPDATE waiver_claims wc
             SET status='failed',
                 failure_reason = 'Roster move failed: ' || COALESCE(v_move_result->>'error','unknown'),
                 processed_at = NOW()
           WHERE wc.id = v_winner.claim_id;
          RETURN QUERY SELECT v_winner.claim_id, v_winner.team_id, v_winner.player_id,
                              v_winner.bid_amount::NUMERIC, 'failed'::TEXT,
                              ('Roster move failed: ' || COALESCE(v_move_result->>'error','unknown'))::TEXT;
        END IF;
      END IF;

      IF v_move_ok THEN
        -- A losing bid ABOVE the winning bid did not lose the auction; it was
        -- skipped because the team could not cover it. Say so.
        UPDATE waiver_claims wc
           SET status='failed',
               failure_reason = CASE WHEN COALESCE(wc.bid_amount,0) > v_winner.bid_amount
                                     THEN 'Insufficient budget' ELSE 'Outbid' END,
               processed_at = NOW()
         WHERE wc.league_id = p_league_id
           AND wc.player_id = v_player_record.pid
           AND wc.status = 'pending'
           AND wc.id <> v_winner.claim_id;
      END IF;
    ELSE
      UPDATE waiver_claims wc SET status='failed', failure_reason='Insufficient budget', processed_at=NOW()
      WHERE wc.league_id = p_league_id
        AND wc.player_id = v_player_record.pid
        AND wc.status = 'pending';
    END IF;
  END LOOP;

  RAISE NOTICE 'Processed % FAAB claims for league %', v_processed, p_league_id;
  RETURN;
END $$;


ALTER FUNCTION "public"."process_faab_waivers_for_league"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_roster_move"("p_league_id" "uuid", "p_user_id" "uuid", "p_drop_player_id" "text" DEFAULT NULL::"text", "p_add_player_id" "text" DEFAULT NULL::"text", "p_transaction_source" "text" DEFAULT 'Roster Tab'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_id UUID;
  v_current_roster_size INT;
  v_max_roster_size INT;
  v_dropped_assignment_id UUID;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
  v_claims TEXT;
BEGIN
  v_claims := current_setting('request.jwt.claims', true);
  IF COALESCE(v_claims, '') = '' THEN
    NULL;  -- trusted context: pg_cron / direct SQL, no JWT present
  ELSIF (v_claims::jsonb->>'role') = 'service_role' THEN
    NULL;  -- trusted context: server-side service_role
  ELSIF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  ELSIF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: user_id mismatch');
  END IF;

  SELECT COALESCE(l.roster_size, 22) INTO v_max_roster_size FROM public.leagues l WHERE l.id = p_league_id;
  IF v_max_roster_size IS NULL THEN v_max_roster_size := 22; END IF;

  SELECT id INTO v_team_id FROM public.teams WHERE league_id = p_league_id AND owner_id = p_user_id LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'User does not have a team in this league'; END IF;

  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;

  BEGIN
    IF p_drop_player_id IS NOT NULL THEN
      SELECT id INTO v_dropped_assignment_id FROM public.roster_assignments
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id LIMIT 1;
      IF v_dropped_assignment_id IS NULL THEN RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id; END IF;
      DELETE FROM public.roster_assignments WHERE id = v_dropped_assignment_id;
      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'DROP', p_drop_player_id, p_transaction_source, NOW());

      INSERT INTO public.player_waiver_status (league_id, player_id, dropped_at, dropped_by_team_id)
      VALUES (p_league_id, p_drop_player_id::INT, NOW(), v_team_id)
      ON CONFLICT (league_id, player_id, dropped_at) DO NOTHING;

      UPDATE public.team_lineups SET
        starters = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        bench = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        ir = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem WHERE elem <> p_drop_player_id),
        slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_drop_player_id,
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;
      UPDATE public.draft_picks SET deleted_at = NOW()
      WHERE league_id = p_league_id AND team_id = v_team_id AND player_id = p_drop_player_id AND deleted_at IS NULL;
    END IF;

    IF p_add_player_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_roster_size FROM public.roster_assignments
      WHERE team_id = v_team_id AND league_id = p_league_id;
      IF p_drop_player_id IS NULL AND v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / %)', v_current_roster_size, v_max_roster_size;
      END IF;

      DECLARE
        v_is_goalie BOOLEAN;
        v_goalie_limit INT;
        v_current_goalies INT;
        v_starting_g INT;
        v_league_settings JSONB;
      BEGIN
        SELECT bool_or(pd.is_goalie) INTO v_is_goalie
        FROM public.player_directory pd WHERE pd.player_id = p_add_player_id::INT;

        IF COALESCE(v_is_goalie, FALSE) THEN
          SELECT COALESCE(l.settings, '{}'::jsonb) INTO v_league_settings FROM public.leagues l WHERE l.id = p_league_id;
          v_starting_g := COALESCE((v_league_settings->'rosterSlots'->>'G')::INT, 2);
          v_goalie_limit := GREATEST(v_starting_g + 2, 4);

          SELECT COUNT(*) INTO v_current_goalies
          FROM public.roster_assignments ra
          WHERE ra.team_id = v_team_id AND ra.league_id = p_league_id
            AND EXISTS (SELECT 1 FROM public.player_directory pd WHERE pd.player_id = ra.player_id::INT AND pd.is_goalie = TRUE);

          IF v_current_goalies >= v_goalie_limit THEN
            RAISE EXCEPTION 'Goalie limit reached (% / %). Drop a goalie first.', v_current_goalies, v_goalie_limit;
          END IF;
        END IF;
      END;

      INSERT INTO public.roster_assignments (league_id, team_id, player_id, acquired_at, created_at)
      VALUES (p_league_id, v_team_id, p_add_player_id, NOW(), NOW());
      INSERT INTO public.transaction_ledger (league_id, user_id, team_id, type, player_id, source, created_at)
      VALUES (p_league_id, p_user_id, v_team_id, 'ADD', p_add_player_id, p_transaction_source, NOW());

      UPDATE public.player_waiver_status
      SET cleared_at = NOW()
      WHERE league_id = p_league_id AND player_id = p_add_player_id::INT AND cleared_at IS NULL;

      UPDATE public.team_lineups SET
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id AND league_id = p_league_id;
      INSERT INTO public.team_lineups (league_id, team_id, bench, starters, ir, slot_assignments, updated_at)
      VALUES (p_league_id, v_team_id, jsonb_build_array(p_add_player_id), '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW())
      ON CONFLICT (league_id, team_id) DO NOTHING;

      UPDATE public.draft_picks SET deleted_at = NULL, picked_at = NOW(), team_id = v_team_id
      WHERE league_id = p_league_id AND player_id = p_add_player_id AND deleted_at IS NOT NULL;

      IF NOT FOUND THEN
        INSERT INTO public.draft_picks (league_id, team_id, player_id, round_number, pick_number, picked_at, deleted_at)
        SELECT p_league_id, v_team_id, p_add_player_id, 999,
          (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
          NOW(), NULL
        WHERE NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE league_id = p_league_id AND player_id = p_add_player_id AND deleted_at IS NULL);
      END IF;
    END IF;

    v_operation_duration := NOW() - v_operation_start;
    RETURN jsonb_build_object(
      'success', true, 'team_id', v_team_id, 'dropped', p_drop_player_id, 'added', p_add_player_id,
      'roster_size', (SELECT COUNT(*) FROM public.roster_assignments WHERE team_id = v_team_id AND league_id = p_league_id),
      'max_roster_size', v_max_roster_size,
      'duration_ms', EXTRACT(MILLISECOND FROM v_operation_duration)::int
    );
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, 'ADD', p_add_player_id, 'DUPLICATE_PLAYER', SQLERRM);
      RETURN jsonb_build_object('success', false, 'error', 'Player is already on a team in this league', 'code', 'DUPLICATE_PLAYER');
    WHEN OTHERS THEN
      INSERT INTO public.failed_transactions (league_id, team_id, user_id, operation_type, player_id, error_message, error_detail)
      VALUES (p_league_id, v_team_id, p_user_id, CASE WHEN p_add_player_id IS NOT NULL THEN 'ADD' ELSE 'DROP' END,
        COALESCE(p_add_player_id, p_drop_player_id), SQLERRM, SQLSTATE);
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;


ALTER FUNCTION "public"."process_roster_move"("p_league_id" "uuid", "p_user_id" "uuid", "p_drop_player_id" "text", "p_add_player_id" "text", "p_transaction_source" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_roster_move"("p_league_id" "uuid", "p_user_id" "uuid", "p_drop_player_id" "text", "p_add_player_id" "text", "p_transaction_source" "text") IS 'Atomic roster transaction engine. Goalie cap = GREATEST(starting_G + 2, 4) — matches Yahoo/ESPN/Sleeper.';



CREATE OR REPLACE FUNCTION "public"."process_waiver_claims"("p_league_id" "uuid") RETURNS TABLE("out_claim_id" "uuid", "out_team_id" "uuid", "out_player_id" integer, "out_status" "text", "out_failure_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_claim RECORD; v_league RECORD; v_waiver_type TEXT;
  v_player_id_str TEXT; v_drop_player_id_str TEXT;
  v_lock_acquired BOOLEAN; v_move_result JSONB; v_user_id UUID;
  v_max_priority NUMERIC; v_owner_team_count INT; v_owner_team_id UUID; v_reason TEXT;
BEGIN
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_league_id::TEXT));
  IF NOT v_lock_acquired THEN RETURN; END IF;

  SELECT waiver_type INTO v_league FROM leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'League % not found', p_league_id; END IF;
  v_waiver_type := COALESCE(v_league.waiver_type, 'rolling');
  IF v_waiver_type = 'faab' THEN RETURN; END IF;

  PERFORM public.seed_waiver_priority_for_league(p_league_id);

  IF v_waiver_type = 'reverse_standings' THEN
    BEGIN PERFORM public.recalculate_reverse_standings_priority(p_league_id);
    EXCEPTION WHEN OTHERS THEN
      BEGIN PERFORM public.log_function_error('process_waiver_claims', SQLSTATE, SQLERRM, 'pre-pass', jsonb_build_object('league_id', p_league_id)); EXCEPTION WHEN OTHERS THEN NULL; END; NULL; END;
  END IF;

  SELECT COALESCE(MAX(priority), 0) + 1 INTO v_max_priority
  FROM waiver_priority WHERE league_id = p_league_id;

  FOR v_claim IN
    SELECT wc.id, wc.team_id, wc.player_id, wc.drop_player_id,
           COALESCE(wp.priority, v_max_priority) AS priority, wc.created_at
    FROM waiver_claims wc
    LEFT JOIN waiver_priority wp ON wp.team_id = wc.team_id AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id AND wc.status = 'pending'
      AND NOT public.is_player_on_waivers(wc.league_id, wc.player_id)
    ORDER BY COALESCE(wp.priority, v_max_priority) ASC, wc.created_at ASC
    LIMIT 100 FOR UPDATE OF wc SKIP LOCKED
  LOOP
    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE WHEN v_claim.drop_player_id IS NOT NULL
      THEN v_claim.drop_player_id::TEXT ELSE NULL END;

    SELECT owner_id INTO v_user_id FROM teams WHERE id = v_claim.team_id LIMIT 1;

    v_reason := NULL;
    IF v_user_id IS NULL THEN
      v_reason := 'Team has no owner; a waiver claim cannot be executed on its behalf';
    ELSE
      SELECT COUNT(*), MIN(id::TEXT)::UUID INTO v_owner_team_count, v_owner_team_id
      FROM teams WHERE league_id = p_league_id AND owner_id = v_user_id;
      IF v_owner_team_count <> 1 OR v_owner_team_id IS DISTINCT FROM v_claim.team_id THEN
        v_reason := 'Roster move would not resolve to the claiming team; claim refused';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE waiver_claims SET status='failed', failure_reason=v_reason, processed_at=NOW()
      WHERE id = v_claim.id;
      out_claim_id := v_claim.id; out_team_id := v_claim.team_id; out_player_id := v_claim.player_id;
      out_status := 'failed'; out_failure_reason := v_reason;
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT public.process_roster_move(
      p_league_id, v_user_id, v_drop_player_id_str, v_player_id_str, 'Waiver Processing'
    ) INTO v_move_result;

    IF (v_move_result->>'success')::BOOLEAN IS TRUE THEN
      UPDATE waiver_claims SET status='successful', processed_at=NOW() WHERE id = v_claim.id;
      IF v_waiver_type = 'rolling' THEN
        UPDATE waiver_priority
           SET priority = (SELECT COALESCE(MAX(wp2.priority), 0) + 1
                             FROM waiver_priority wp2 WHERE wp2.league_id = p_league_id),
               updated_at = NOW()
         WHERE league_id = p_league_id AND team_id = v_claim.team_id;
        PERFORM public.renumber_waiver_priority(p_league_id);
      END IF;
      out_claim_id := v_claim.id; out_team_id := v_claim.team_id; out_player_id := v_claim.player_id;
      out_status := 'successful'; out_failure_reason := NULL;
      RETURN NEXT;
    ELSE
      UPDATE waiver_claims SET status='failed',
        failure_reason = COALESCE(v_move_result->>'error', v_move_result->>'message', 'Unknown error'),
        processed_at = NOW()
      WHERE id = v_claim.id;
      out_claim_id := v_claim.id; out_team_id := v_claim.team_id; out_player_id := v_claim.player_id;
      out_status := 'failed';
      out_failure_reason := COALESCE(v_move_result->>'error', v_move_result->>'message', 'Unknown error');
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END $$;


ALTER FUNCTION "public"."process_waiver_claims"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_ros"("p_season" integer) RETURNS TABLE("player_id" integer, "is_goalie" boolean, "position_code" "text", "age" integer, "exp_gp" integer, "exp_starts" integer, "r_goal" numeric, "r_a" numeric, "r_sog" numeric, "r_blk" numeric, "r_ppp" numeric, "r_shp" numeric, "r_hits" numeric, "r_pim" numeric, "r_pm" numeric, "r_wins" numeric, "r_saves" numeric, "r_so" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with hist as (
    select pgs.player_id,
           substring(pgs.game_id::text,1,4)::int as season,
           bool_or(pgs.is_goalie) as is_goalie,
           count(*)::numeric gp,
           sum(pgs.nhl_goals)::numeric g,           sum(pgs.nhl_assists)::numeric a,
           sum(pgs.nhl_shots_on_goal)::numeric sog, sum(pgs.nhl_blocks)::numeric blk,
           sum(pgs.nhl_ppp)::numeric ppp,           sum(pgs.nhl_shp)::numeric shp,
           sum(pgs.nhl_hits)::numeric hits,         sum(pgs.nhl_pim)::numeric pim,
           sum(pgs.nhl_plus_minus)::numeric pm,
           sum(pgs.nhl_wins)::numeric wins,         sum(pgs.nhl_saves)::numeric saves,
           sum(pgs.nhl_shutouts)::numeric so,
           sum(coalesce(pgs.goalie_gp,0))::numeric ggp
      from player_game_stats pgs
     where substring(pgs.game_id::text,5,2) = '02'
       and substring(pgs.game_id::text,1,4)::int between p_season-3 and p_season
     group by 1,2
  ),
  xg as (select player_id, season, sum(xg)::numeric xg from player_xg_season
          where game_type='regular' group by 1,2),
  w as (select h.*, coalesce(x.xg,0)::numeric xg,
              (case p_season-h.season
                 when 0 then 15.0   -- measured; see header
                 when 1 then 5.0 when 2 then 3.0 else 2.0 end)::numeric wt
         from hist h left join xg x on x.player_id=h.player_id and x.season=h.season),
  agg as (
    select player_id, bool_or(is_goalie) is_goalie,
           sum(wt*gp) wgp, sum(wt*g) wg, sum(wt*xg) wxg, sum(wt*a) wa,
           sum(wt*sog) wsog, sum(wt*blk) wblk, sum(wt*ppp) wppp, sum(wt*shp) wshp,
           sum(wt*hits) whits, sum(wt*pim) wpim, sum(wt*pm) wpm,
           sum(wt*wins) wwins, sum(wt*saves) wsaves, sum(wt*so) wso, sum(wt*ggp) wggp,
           sum(gp) raw_gp,
           max(case when season=p_season-1 then gp else 0 end) gp_last,
           max(case when season=p_season-1 then ggp else 0 end) ggp_last
      from w group by 1),
  bd as (select distinct on (player_id) player_id, birthdate
           from player_directory where birthdate is not null order by player_id, season desc),
  grp as (
    select a.*,
           coalesce((select pd.position_code from player_directory pd
                      where pd.player_id=a.player_id order by pd.season desc limit 1),
                    case when a.is_goalie then 'G' else 'C' end) as position_code,
           extract(year from age(make_date(p_season,10,1), bd.birthdate))::int as age
      from agg a left join bd on bd.player_id=a.player_id),
  grp2 as (
    select g.*, case when g.is_goalie then 'G'
                     when g.position_code='D' then 'D' else 'F' end as pos_group,
           case when g.is_goalie then 1.00
                else public.get_age_multiplier(g.age) end as am
      from grp g),
  means as (
    select pos_group,
           sum(0.30*wg + 0.70*wxg)/nullif(sum(wgp),0) m_goal,
           sum(wa)/nullif(sum(wgp),0) m_a,     sum(wsog)/nullif(sum(wgp),0) m_sog,
           sum(wblk)/nullif(sum(wgp),0) m_blk, sum(wppp)/nullif(sum(wgp),0) m_ppp,
           sum(wshp)/nullif(sum(wgp),0) m_shp, sum(whits)/nullif(sum(wgp),0) m_hits,
           sum(wpim)/nullif(sum(wgp),0) m_pim, sum(wpm)/nullif(sum(wgp),0) m_pm,
           sum(wwins)/nullif(sum(wggp),0) m_wins,
           sum(wsaves)/nullif(sum(wggp),0) m_saves,
           sum(wso)/nullif(sum(wggp),0) m_so
      from grp2 where raw_gp >= 20 group by 1)
  select g.player_id, g.is_goalie, g.position_code, g.age,
         least(public.get_season_game_count(p_season), greatest(0,
           round(((g.gp_last + 0.25*0.80*82)/(82.0 + 0.25*82)) * public.get_season_game_count(p_season))))::int,
         least(public.get_season_game_count(p_season), greatest(0,
           round(((g.ggp_last + 0.25*0.45*82)/(82.0 + 0.25*82)) * public.get_season_game_count(p_season))))::int,
         (((0.30*g.wg + 0.70*g.wxg) + 20*m.m_goal)/(g.wgp+20) * g.am)::numeric,
         ((g.wa    +  10*m.m_a)   /(g.wgp+10)  * g.am)::numeric,
         ((g.wsog  +  10*m.m_sog) /(g.wgp+10)  * g.am)::numeric,
         ((g.wblk  +  15*m.m_blk) /(g.wgp+15)  * g.am)::numeric,
         ((g.wppp  +  10*m.m_ppp) /(g.wgp+10)  * g.am)::numeric,
         ((g.wshp  +  10*m.m_shp) /(g.wgp+10)  * g.am)::numeric,
         ((g.whits +   8*m.m_hits)/(g.wgp+8)   * g.am)::numeric,
         ((g.wpim  +  20*m.m_pim) /(g.wgp+20)  * g.am)::numeric,
         ((g.wpm   + 150*m.m_pm)  /(g.wgp+150) * g.am)::numeric,
         ((g.wwins  + 10*coalesce(m.m_wins,0)) /(g.wggp+10))::numeric,
         ((g.wsaves + 10*coalesce(m.m_saves,0))/(g.wggp+10))::numeric,
         ((g.wso    + 10*coalesce(m.m_so,0))   /(g.wggp+10))::numeric
    from grp2 g join means m on m.pos_group=g.pos_group
   where g.raw_gp >= 1;
$$;


ALTER FUNCTION "public"."project_ros"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propagate_playoff_series_winner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.winner_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.nhl_playoff_series
  SET high_seed_team_id = NEW.winner_team_id,
      updated_at = NOW()
  WHERE season = NEW.season
    AND parent_slot_a = NEW.bracket_slot
    AND high_seed_team_id IS NULL;

  UPDATE public.nhl_playoff_series
  SET low_seed_team_id = NEW.winner_team_id,
      updated_at = NOW()
  WHERE season = NEW.season
    AND parent_slot_b = NEW.bracket_slot
    AND low_seed_team_id IS NULL;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."propagate_playoff_series_winner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_goalie_gsax_primary"("p_season" integer DEFAULT NULL::integer) RETURNS TABLE("o_metric" "text", "o_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_season int; r bigint; v_svpct numeric;
begin
  v_season := coalesce(p_season, (select max(season) from goalie_xg_season where game_type='regular'));

  select round((1 - sum(goals_allowed)::numeric / nullif(sum(sog_faced),0))::numeric, 4)
    into v_svpct
    from goalie_xg_season where season = v_season and game_type = 'regular';

  delete from goalie_gsax_primary;
  insert into goalie_gsax_primary
    (goalie_id, total_shots_faced, total_xga, total_ga, raw_gsax, regressed_gsax,
     league_sv_pct, calculated_at, updated_at, season)
  select g.goalie_id,
         sum(g.shots_faced)::int,
         round(sum(g.xg_faced)::numeric, 4),
         sum(g.goals_allowed)::int,
         round(sum(g.gsax)::numeric, 4),
         round((sum(g.gsax) * sum(g.shots_faced) / (sum(g.shots_faced) + 500.0))::numeric, 4),
         v_svpct, now(), now(), v_season
  from goalie_xg_season g
  where g.season = v_season and g.game_type = 'regular'
  group by g.goalie_id;
  get diagnostics r = row_count;
  o_metric := 'goalies_written'; o_count := r; return next;

  -- behavioural gate: the rebuilt table must reconcile to its source
  select count(*) into r from (
    select p.goalie_id
      from goalie_gsax_primary p
      join (select goalie_id, sum(goals_allowed) ga, sum(shots_faced) sf
              from goalie_xg_season where season = v_season and game_type='regular'
             group by goalie_id) s using (goalie_id)
     where p.total_ga <> s.ga or p.total_shots_faced <> s.sf) z;
  o_metric := 'rows_disagreeing_with_source'; o_count := r; return next;

  o_metric := 'season'; o_count := v_season; return next;
end $$;


ALTER FUNCTION "public"."rebuild_goalie_gsax_primary"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_player_identity"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_n int;
BEGIN
  WITH bx AS (
    SELECT substring(d.game_id::text from 1 for 4)::int AS season, d.game_id,
           (d.boxscore_json->side.k->>'abbrev') AS team, grp.k AS grp, p AS pj
      FROM public.raw_nhl_data d
      CROSS JOIN LATERAL (VALUES ('homeTeam'),('awayTeam')) AS side(k)
      CROSS JOIN LATERAL (VALUES ('forwards'),('defense'),('goalies')) AS grp(k)
      CROSS JOIN LATERAL jsonb_array_elements(
        coalesce(d.boxscore_json->'playerByGameStats'->side.k->grp.k,'[]'::jsonb)) AS p
     WHERE d.boxscore_json IS NOT NULL
  ), flat AS (
    SELECT (pj->>'playerId')::int AS player_id,
           coalesce(pj->'name'->>'default','Unknown') AS short_name,
           nullif(pj->>'position','') AS position_code,
           (grp='goalies') AS is_goalie,
           nullif(pj->>'sweaterNumber','')::int AS sweater,
           season, game_id, team
      FROM bx WHERE (pj->>'playerId') IS NOT NULL
  ), agg AS (
    SELECT player_id,
           mode() WITHIN GROUP (ORDER BY short_name) AS short_name,
           mode() WITHIN GROUP (ORDER BY position_code) AS primary_position,
           bool_or(is_goalie) AS is_goalie,
           min(season) AS first_season, max(season) AS last_season,
           count(DISTINCT season)::int AS seasons_played,
           count(DISTINCT game_id)::int AS games_played,
           array_agg(DISTINCT team) FILTER (WHERE team IS NOT NULL) AS teams,
           (array_agg(team ORDER BY season DESC, game_id DESC))[1] AS last_team,
           (array_agg(sweater ORDER BY season DESC, game_id DESC))[1] AS last_sweater,
           (array_agg(position_code ORDER BY season DESC, game_id DESC))[1] AS position_code
      FROM flat GROUP BY player_id
  ), spots AS (
    SELECT (rs->>'playerId')::int AS player_id,
           rs->'firstName'->>'default' AS first_name,
           rs->'lastName'->>'default'  AS last_name,
           nullif(rs->>'headshot','')  AS headshot_url,
           substring(d.game_id::text from 1 for 4)::int AS season,
           d.game_id
      FROM public.raw_nhl_data d
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.raw_json->'rosterSpots','[]'::jsonb)) AS rs
     WHERE d.raw_json IS NOT NULL
  ), names AS (
    SELECT player_id,
           (array_agg(first_name ORDER BY season DESC, game_id DESC))[1] AS first_name,
           (array_agg(last_name  ORDER BY season DESC, game_id DESC))[1] AS last_name,
           (array_agg(headshot_url ORDER BY season DESC, game_id DESC)
              FILTER (WHERE headshot_url IS NOT NULL))[1] AS headshot_url
      FROM spots GROUP BY player_id
  )
  INSERT INTO public.nhl_player_identity AS t (
    player_id, full_name, short_name, first_name, last_name, headshot_url,
    position_code, primary_position, first_season, last_season,
    seasons_played, games_played, teams, last_team, last_sweater, is_goalie, updated_at)
  SELECT a.player_id,
         coalesce(nullif(trim(coalesce(n.first_name,'') || ' ' || coalesce(n.last_name,'')), ''),
                  d.full_name, a.short_name) AS full_name,
         a.short_name, n.first_name, n.last_name, n.headshot_url,
         a.position_code, a.primary_position, a.first_season, a.last_season,
         a.seasons_played, a.games_played, a.teams, a.last_team, a.last_sweater,
         a.is_goalie, now()
    FROM agg a
    LEFT JOIN names n ON n.player_id = a.player_id
    LEFT JOIN LATERAL (
      SELECT full_name FROM public.player_directory pd
       WHERE pd.player_id = a.player_id AND pd.full_name IS NOT NULL
       ORDER BY season DESC LIMIT 1) d ON true
  ON CONFLICT (player_id) DO UPDATE SET
    full_name=EXCLUDED.full_name, short_name=EXCLUDED.short_name,
    first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
    headshot_url=EXCLUDED.headshot_url,
    position_code=EXCLUDED.position_code, primary_position=EXCLUDED.primary_position,
    first_season=EXCLUDED.first_season, last_season=EXCLUDED.last_season,
    seasons_played=EXCLUDED.seasons_played, games_played=EXCLUDED.games_played,
    teams=EXCLUDED.teams, last_team=EXCLUDED.last_team, last_sweater=EXCLUDED.last_sweater,
    is_goalie=EXCLUDED.is_goalie, updated_at=now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


ALTER FUNCTION "public"."rebuild_player_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_player_projected_stats"("p_season" integer) RETURNS TABLE("rows_written" integer, "players" integer, "games" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_rows int; v_pl int; v_gm int;
begin
  delete from player_projected_stats where season = p_season;

  insert into player_projected_stats (
    player_id, game_id, projection_date, season, is_goalie,
    projected_goals, projected_assists, projected_sog, projected_blocks,
    projected_ppp, projected_shp, projected_hits, projected_pim,
    projected_wins, projected_saves, projected_shutouts, projected_goals_against,
    projected_gp, total_projected_points, base_ppg,
    home_away_adjustment, b2b_penalty, calculation_method,
    opponent_team_id, opponent_abbrev, is_home_game,
    projection_mean, projection_std_dev,
    projection_ci_lower, projection_ci_upper,
    projection_ci_50_lower, projection_ci_50_upper,
    confidence_label, created_at, updated_at)
  select
    x.player_id, x.game_id, x.game_date, p_season, x.is_goalie,
    round(x.r_goal * x.adj, 4), round(x.r_a   * x.adj, 4),
    round(x.r_sog  * x.adj, 4), round(x.r_blk * x.adj, 4),
    round(x.r_ppp  * x.adj, 4), round(x.r_shp * x.adj, 4),
    round(x.r_hits * x.adj, 4), round(x.r_pim * x.adj, 4),
    case when x.is_goalie then round(x.r_wins  * x.adj, 4) else 0 end,
    case when x.is_goalie then round(x.r_saves * x.adj, 4) else 0 end,
    case when x.is_goalie then round(x.r_so    * x.adj, 4) else 0 end,
    0,
    1,
    round(x.mu, 4), round(x.base_mu, 4),
    round(x.home_adj, 4), round(x.b2b_adj, 4),
    'v2_rates_age_home_b2b',
    x.opp_id, x.opp_abbrev, x.is_home,
    round(x.mu, 4),
    round(x.sd, 4),
    round(greatest(0, x.mu - 1.96*x.sd), 4),
    round(x.mu + 1.96*x.sd, 4),
    round(greatest(0, x.mu - 0.6745*x.sd), 4),
    round(x.mu + 0.6745*x.sd, 4),
    case when x.mu <= 0 then 'unknown'
         when x.sd / nullif(x.mu,0) < 0.65 then 'high'
         when x.sd / nullif(x.mu,0) < 0.85 then 'medium'
         else 'low' end,
    now(), now()
  from (
    select
      pr.player_id, pr.is_goalie, g.game_id, g.game_date,
      (g.home_team = pd.team_abbrev) as is_home,
      case when g.home_team = pd.team_abbrev then g.away_team_id else g.home_team_id end as opp_id,
      case when g.home_team = pd.team_abbrev then g.away_team    else g.home_team    end as opp_abbrev,
      case when g.home_team = pd.team_abbrev then 1.048 else 0.968 end::numeric as home_adj,
      case when exists (
             select 1 from nhl_games g2
              where g2.season = p_season
                and g2.game_date = g.game_date - 1
                and (g2.home_team = pd.team_abbrev or g2.away_team = pd.team_abbrev)
           ) then 0.950 else 1.000 end::numeric as b2b_adj,
      (case when g.home_team = pd.team_abbrev then 1.048 else 0.968 end
       * case when exists (
             select 1 from nhl_games g2
              where g2.season = p_season
                and g2.game_date = g.game_date - 1
                and (g2.home_team = pd.team_abbrev or g2.away_team = pd.team_abbrev)
           ) then 0.950 else 1.000 end)::numeric as adj,
      pr.r_goal, pr.r_a, pr.r_sog, pr.r_blk, pr.r_ppp, pr.r_shp,
      pr.r_hits, pr.r_pim, pr.r_wins, pr.r_saves, pr.r_so,
      (case when pr.is_goalie
            then pr.r_wins*4.0 + pr.r_saves*0.2 + pr.r_so*3.0
            else pr.r_goal*3.0 + pr.r_a*2.0 + pr.r_ppp*1.0 + pr.r_shp*2.0
               + pr.r_sog*0.4 + pr.r_blk*0.5 + pr.r_hits*0.2 + pr.r_pim*0.5
       end)::numeric as base_mu,
      ((case when pr.is_goalie
            then pr.r_wins*4.0 + pr.r_saves*0.2 + pr.r_so*3.0
            else pr.r_goal*3.0 + pr.r_a*2.0 + pr.r_ppp*1.0 + pr.r_shp*2.0
               + pr.r_sog*0.4 + pr.r_blk*0.5 + pr.r_hits*0.2 + pr.r_pim*0.5 end)
       * (case when g.home_team = pd.team_abbrev then 1.048 else 0.968 end
          * case when exists (
                select 1 from nhl_games g2
                 where g2.season = p_season
                   and g2.game_date = g.game_date - 1
                   and (g2.home_team = pd.team_abbrev or g2.away_team = pd.team_abbrev)
              ) then 0.950 else 1.000 end))::numeric as mu,
      -- measured spread law: sd = 1.08 * mean^0.66
      (1.08 * power(greatest(0.05,
         (case when pr.is_goalie
               then pr.r_wins*4.0 + pr.r_saves*0.2 + pr.r_so*3.0
               else pr.r_goal*3.0 + pr.r_a*2.0 + pr.r_ppp*1.0 + pr.r_shp*2.0
                  + pr.r_sog*0.4 + pr.r_blk*0.5 + pr.r_hits*0.2 + pr.r_pim*0.5 end)
       )::numeric, 0.66))::numeric as sd
    from public.project_ros(p_season) pr
    join player_directory pd
      on pd.player_id = pr.player_id and pd.season = p_season
    join nhl_games g
      on g.season = p_season
     and (g.home_team = pd.team_abbrev or g.away_team = pd.team_abbrev)
     and g.game_type = 'regular'
  ) x
  on conflict (player_id, game_id, projection_date) do nothing;

  get diagnostics v_rows = row_count;
  select count(distinct player_id), count(distinct game_id)
    into v_pl, v_gm from player_projected_stats where season = p_season;
  return query select v_rows, v_pl, v_gm;
end;
$$;


ALTER FUNCTION "public"."rebuild_player_projected_stats"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_player_season_stats"("p_season" integer) RETURNS TABLE("rows_written" integer, "skaters" integer, "goalies" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_rows int; v_sk int; v_go int;
begin
  delete from player_season_stats where season = p_season;

  insert into player_season_stats (
    season, player_id, team_abbrev, position_code, is_goalie,
    games_played, icetime_seconds,
    goals, primary_assists, secondary_assists, points, shots_on_goal,
    hits, blocks, pim, ppp, shp, plus_minus, x_goals, x_assists,
    goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct,
    nhl_toi_seconds, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points,
    nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp,
    nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced,
    nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa,
    created_at, updated_at)
  select
    p_season,
    a.player_id,
    (select pd.team_abbrev from player_directory pd
      where pd.player_id=a.player_id and pd.season=p_season limit 1),
    (select pd.position_code from player_directory pd
      where pd.player_id=a.player_id order by pd.season desc limit 1),
    a.is_goalie,
    a.gp, a.toi,
    a.goals, a.pa, a.sa, a.goals + a.assists, a.sog,
    a.hits, a.blocks, a.pim, a.ppp, a.shp, a.plus_minus,
    coalesce(x.xg, 0),
    0,                                    -- x_assists: see comment above
    a.ggp, a.wins, a.saves, a.shots_faced, a.ga, a.so,
    case when a.shots_faced > 0 then round(a.saves::numeric / a.shots_faced, 5) end,
    a.toi, a.plus_minus, a.goals, a.assists, a.goals + a.assists,
    a.sog, a.hits, a.blocks, a.pim, a.ppp, a.shp,
    a.wins, a.losses, a.otl, a.saves, a.shots_faced, a.ga, a.so,
    case when a.shots_faced > 0 then round(a.saves::numeric / a.shots_faced, 5) end,
    case when a.toi > 0 then round(a.ga * 3600.0 / a.toi, 5) end,
    now(), now()
  from (
    select pgs.player_id,
           bool_or(pgs.is_goalie)                    as is_goalie,
           count(*)                                  as gp,
           sum(coalesce(pgs.nhl_toi_seconds,0))      as toi,
           sum(pgs.nhl_goals)                        as goals,
           sum(pgs.nhl_assists)                      as assists,
           sum(coalesce(pgs.primary_assists,0))      as pa,
           sum(coalesce(pgs.secondary_assists,0))    as sa,
           sum(pgs.nhl_shots_on_goal)                as sog,
           sum(pgs.nhl_hits)                         as hits,
           sum(pgs.nhl_blocks)                       as blocks,
           sum(pgs.nhl_pim)                          as pim,
           sum(pgs.nhl_ppp)                          as ppp,
           sum(pgs.nhl_shp)                          as shp,
           sum(pgs.nhl_plus_minus)                   as plus_minus,
           sum(coalesce(pgs.goalie_gp,0))            as ggp,
           sum(pgs.nhl_wins)                         as wins,
           sum(coalesce(pgs.nhl_losses,0))           as losses,
           sum(coalesce(pgs.nhl_ot_losses,0))        as otl,
           sum(pgs.nhl_saves)                        as saves,
           sum(pgs.nhl_shots_faced)                  as shots_faced,
           sum(pgs.nhl_goals_against)                as ga,
           sum(pgs.nhl_shutouts)                     as so
      from player_game_stats pgs
     where substring(pgs.game_id::text,1,4)::int = p_season
       and substring(pgs.game_id::text,5,2) = '02'   -- REGULAR SEASON ONLY
     group by pgs.player_id
  ) a
  left join (
    select player_id, sum(xg) as xg from player_xg_season
     where season = p_season and game_type = 'regular' group by player_id
  ) x on x.player_id = a.player_id;

  get diagnostics v_rows = row_count;
  select count(*) filter (where not is_goalie), count(*) filter (where is_goalie)
    into v_sk, v_go from player_season_stats where season = p_season;
  return query select v_rows, v_sk, v_go;
end;
$$;


ALTER FUNCTION "public"."rebuild_player_season_stats"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_player_talent_metrics"("p_season" integer) RETURNS TABLE("rows_written" integer, "rated" integer, "below_toi_floor" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_rows int; v_rated int; v_floor int;
begin
  create temp table _tm on commit drop as
  with toi as (
    select pgs.player_id,
           sum(coalesce(pgs.nhl_toi_seconds,0))::numeric as toi_sec
      from player_game_stats pgs
     where substring(pgs.game_id::text,1,4)::int = p_season
       and substring(pgs.game_id::text,5,2) = '02'
       and not pgs.is_goalie
     group by 1
  ),
  xg as (
    select player_id, sum(xg)::numeric as xg
      from player_xg_season
     where season = p_season and game_type = 'regular'
     group by 1
  )
  select t.player_id,
         round(t.toi_sec/60.0, 2) as toi_minutes,
         case when t.toi_sec > 0
              then round(coalesce(x.xg,0) * 3600.0 / t.toi_sec, 4)
              else 0 end as xg_per_60
    from toi t left join xg x on x.player_id = t.player_id
   where t.toi_sec > 0;

  update _tm set xg_per_60 = 0 where xg_per_60 < 0;

  delete from player_talent_metrics where season = p_season;

  insert into player_talent_metrics (season, player_id, xg_per_60, xg_rating,
                                     roster_status, is_ir_eligible,
                                     updated_at, last_updated)
  select p_season, m.player_id, m.xg_per_60,
         case when m.toi_minutes < 200 then null
              when m.xg_per_60 <  0.30 then 'Low'
              when m.xg_per_60 <  0.60 then 'Below Avg'
              when m.xg_per_60 <  0.90 then 'Average'
              when m.xg_per_60 <  1.20 then 'Above Avg'
              else 'Elite' end,
         (select t.roster_status from player_talent_metrics t
           where t.player_id = m.player_id order by t.season desc limit 1),
         coalesce((select t.is_ir_eligible from player_talent_metrics t
                    where t.player_id = m.player_id order by t.season desc limit 1), false),
         now(), now()          -- last_updated is what the freshness SLA watches
    from _tm m;

  get diagnostics v_rows = row_count;
  select count(*) filter (where xg_rating is not null),
         count(*) filter (where xg_rating is null)
    into v_rated, v_floor
    from player_talent_metrics where season = p_season;
  return query select v_rows, v_rated, v_floor;
end;
$$;


ALTER FUNCTION "public"."rebuild_player_talent_metrics"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_pp_sh_points"("p_season" integer) RETURNS TABLE("o_metric" "text", "o_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r bigint;
begin
  drop table if exists _pts;
  create temp table _pts as
  select game_id, pid,
         sum(ppg) ppg, sum(ppa) ppa, sum(shg) shg, sum(sha) sha
  from (
    select game_id, shooter_id pid, is_power_play::int ppg, 0 ppa, is_shorthanded::int shg, 0 sha
      from nhl_shots where season=p_season and is_goal and shooter_id is not null
    union all
    select game_id, assist1_id, 0, is_power_play::int, 0, is_shorthanded::int
      from nhl_shots where season=p_season and is_goal and assist1_id is not null
    union all
    select game_id, assist2_id, 0, is_power_play::int, 0, is_shorthanded::int
      from nhl_shots where season=p_season and is_goal and assist2_id is not null
  ) u group by 1,2;
  create index on _pts (game_id, pid);

  update player_game_stats p
     set ppp = coalesce(t.ppg,0) + coalesce(t.ppa,0),
         shp = coalesce(t.shg,0) + coalesce(t.sha,0),
         updated_at = now()
    from _pts t
   where p.game_id = t.game_id and p.player_id = t.pid and not p.is_goalie
     and (coalesce(p.ppp,0) <> coalesce(t.ppg,0)+coalesce(t.ppa,0)
       or coalesce(p.shp,0) <> coalesce(t.shg,0)+coalesce(t.sha,0));
  get diagnostics r = row_count;
  o_metric := 'rows_updated'; o_count := r; return next;

  -- players with no PP/SH involvement in a game must read zero, not stale
  update player_game_stats p set ppp = 0, shp = 0, updated_at = now()
   where p.season = p_season and not p.is_goalie
     and (coalesce(p.ppp,0) <> 0 or coalesce(p.shp,0) <> 0)
     and not exists (select 1 from _pts t where t.game_id=p.game_id and t.pid=p.player_id);
  get diagnostics r = row_count;
  o_metric := 'rows_zeroed'; o_count := r; return next;

  select count(*) into r from player_game_stats p
   where p.season = p_season and not p.is_goalie and coalesce(p.ppp,0) < coalesce(p.nhl_ppg,0);
  o_metric := 'residual_ppp_below_boxscore_ppg'; o_count := r; return next;
end $$;


ALTER FUNCTION "public"."rebuild_pp_sh_points"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_ros_projections"("p_season" integer) RETURNS TABLE("rows_written" integer, "skaters" integer, "goalies" integer, "target_games" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_games int; v_rows int; v_sk int; v_go int;
begin
  v_games := public.get_season_game_count(p_season);
  if v_games is null or v_games < 1 then
    raise exception 'get_season_game_count(%) returned %', p_season, v_games;
  end if;

  delete from player_ros_projections;   -- single-season table by primary key

  insert into player_ros_projections (
    player_id, season, games_remaining, games_played,
    projected_goals, projected_assists, projected_sog, projected_blocks,
    projected_ppp, projected_shp, projected_hits, projected_pim,
    projected_wins_ros, projected_saves_ros, projected_shutouts_ros,
    total_projected_points, avg_points_per_game, avg_goals_per_game, avg_assists_per_game,
    player_name, team_abbrev, position, is_goalie, updated_at, created_at)
  with played as (
    select pgs.player_id, count(*)::int gp
      from player_game_stats pgs
     where substring(pgs.game_id::text,1,4)::int = p_season
       and substring(pgs.game_id::text,5,2) = '02'
     group by 1
  ),
  team_rem as (
    select s.abbrev, count(*)::int games_left
      from (
        select home_team as abbrev, game_date from nhl_games
         where season = p_season and game_type = 'regular'
        union all
        select away_team, game_date from nhl_games
         where season = p_season and game_type = 'regular'
      ) s
     where s.game_date >= current_date
     group by s.abbrev
  ),
  pt as (
    select distinct on (pd.player_id) pd.player_id, pd.team_abbrev
      from player_directory pd
     where pd.team_abbrev is not null
     order by pd.player_id, pd.season desc
  ),
  r as (
    select p.*,
           coalesce(pl.gp, 0) as gp_actual,
           coalesce(tr.games_left, v_games) as team_left,
           -- the player's own remaining games, not his team's
           greatest(0, least(v_games, round(
             (p.exp_gp::numeric / v_games) * coalesce(tr.games_left, v_games))))::int as rem_gp,
           greatest(0, least(v_games, round(
             (p.exp_starts::numeric / v_games) * coalesce(tr.games_left, v_games))))::int as rem_starts
      from public.project_ros(p_season) p
      left join played pl on pl.player_id = p.player_id
      left join pt     on pt.player_id = p.player_id
      left join team_rem tr on tr.abbrev = pt.team_abbrev
  )
  select r.player_id, p_season,
         case when r.is_goalie then r.rem_starts else r.rem_gp end,
         r.gp_actual,
         case when r.is_goalie then 0 else round(r.r_goal*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_a*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_sog*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_blk*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_ppp*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_shp*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_hits*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_pim*r.rem_gp,2) end,
         case when r.is_goalie then round(r.r_wins*r.rem_starts,2) else 0 end,
         case when r.is_goalie then round(r.r_saves*r.rem_starts,2) else 0 end,
         case when r.is_goalie then round(r.r_so*r.rem_starts,2) else 0 end,
         case when r.is_goalie then
           round(r.r_wins*r.rem_starts*4.0 + r.r_saves*r.rem_starts*0.2 + r.r_so*r.rem_starts*3.0,2)
         else
           round(r.r_goal*r.rem_gp*3.0 + r.r_a*r.rem_gp*2.0 + r.r_ppp*r.rem_gp*1.0
               + r.r_shp*r.rem_gp*2.0 + r.r_sog*r.rem_gp*0.4 + r.r_blk*r.rem_gp*0.5
               + r.r_hits*r.rem_gp*0.2 + r.r_pim*r.rem_gp*0.5,2) end,
         -- per-game rates are rates: unchanged by how many games remain
         case when r.is_goalie then round(r.r_wins*4.0+r.r_saves*0.2+r.r_so*3.0,3)
         else round(r.r_goal*3.0+r.r_a*2.0+r.r_ppp*1.0+r.r_shp*2.0
                  +r.r_sog*0.4+r.r_blk*0.5+r.r_hits*0.2+r.r_pim*0.5,3) end,
         case when r.is_goalie then 0 else round(r.r_goal,3) end,
         case when r.is_goalie then 0 else round(r.r_a,3) end,
         i.full_name,
         pt2.team_abbrev,
         r.position_code, r.is_goalie, now(), now()
    from r
    left join nhl_player_identity i on i.player_id = r.player_id
    left join lateral (
      select pd.team_abbrev from player_directory pd
       where pd.player_id = r.player_id order by pd.season desc limit 1
    ) pt2 on true;

  get diagnostics v_rows = row_count;
  select count(*) filter (where not is_goalie), count(*) filter (where is_goalie)
    into v_sk, v_go from player_ros_projections where season=p_season;
  return query select v_rows, v_sk, v_go, v_games;
end;
$$;


ALTER FUNCTION "public"."rebuild_ros_projections"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_reverse_standings_priority"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_waiver_type TEXT; v_off INT;
BEGIN
  SELECT waiver_type INTO v_waiver_type FROM leagues WHERE id = p_league_id;
  IF v_waiver_type IS DISTINCT FROM 'reverse_standings' THEN RETURN; END IF;

  PERFORM public.seed_waiver_priority_for_league(p_league_id);

  SELECT COALESCE(MAX(priority), 0) + 1000000 INTO v_off
  FROM waiver_priority WHERE league_id = p_league_id;
  UPDATE waiver_priority SET priority = priority + v_off WHERE league_id = p_league_id;

  WITH team_records AS (
    SELECT t.id AS tid,
      COALESCE(SUM(CASE WHEN (m.team1_id = t.id AND m.team1_score > m.team2_score)
                          OR (m.team2_id = t.id AND m.team2_score > m.team1_score)
                        THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN (m.team1_id = t.id AND m.team1_score < m.team2_score)
                          OR (m.team2_id = t.id AND m.team2_score < m.team1_score)
                        THEN 1 ELSE 0 END), 0) AS losses
    FROM teams t
    LEFT JOIN matchups m ON m.league_id = p_league_id AND m.status = 'completed'
      AND (m.team1_id = t.id OR m.team2_id = t.id)
    WHERE t.league_id = p_league_id
    GROUP BY t.id
  ),
  ranked AS (
    SELECT tid, ROW_NUMBER() OVER (
      ORDER BY wins::NUMERIC / GREATEST(1, wins + losses) ASC, losses DESC, tid ASC
    ) AS new_priority
    FROM team_records
  )
  UPDATE waiver_priority wp SET priority = r.new_priority, updated_at = NOW()
  FROM ranked r WHERE wp.team_id = r.tid AND wp.league_id = p_league_id;
END $$;


ALTER FUNCTION "public"."recalculate_reverse_standings_priority"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_pp_goals_with_boxscore"() RETURNS TABLE("o_metric" "text", "o_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r bigint;
begin
  -- start clean so the function is idempotent and re-runnable
  update nhl_shots set is_power_play = not is_power_play, strength_source = 'pbp_situation_code'
   where strength_source = 'boxscore_reconciled';
  get diagnostics r = row_count;
  o_metric := 'reverted_previous_reconciliation'; o_count := r; return next;

  drop table if exists _cmp;
  create temp table _cmp as
  with bx as (select game_id, player_id, coalesce(nhl_ppg,0) bppg
              from player_game_stats where not is_goalie),
  pb as (select game_id, shooter_id player_id,
                count(*) filter (where is_power_play) ppb, count(*) tot
         from nhl_shots where is_goal group by 1,2)
  select pb.game_id, pb.player_id, coalesce(bx.bppg,0) bppg, pb.ppb, pb.tot
  from pb left join bx using (game_id, player_id)
  where coalesce(bx.bppg,0) <> pb.ppb;
  create index on _cmp (game_id, player_id);

  select count(*) into r from _cmp; o_metric := 'player_games_disagreeing'; o_count := r; return next;

  -- PROMOTE: boxscore says more PP goals than the PBP found, and every one of the
  -- player's remaining non-PP goals in that game must be it (no choice to make)
  update nhl_shots s set is_power_play = true, strength_source = 'boxscore_reconciled'
    from _cmp c
   where s.game_id=c.game_id and s.shooter_id=c.player_id and s.is_goal and not s.is_power_play
     and c.bppg > c.ppb and (c.tot - c.ppb) = (c.bppg - c.ppb);
  get diagnostics r = row_count; o_metric := 'promoted'; o_count := r; return next;

  -- DEMOTE: PBP flagged power-play goals the boxscore does not credit. Only
  -- unambiguous when the boxscore says the player had ZERO that game, so all of
  -- his PBP power-play goals in it are wrong.
  update nhl_shots s set is_power_play = false, strength_source = 'boxscore_reconciled'
    from _cmp c
   where s.game_id=c.game_id and s.shooter_id=c.player_id and s.is_goal and s.is_power_play
     and c.ppb > c.bppg and c.bppg = 0;
  get diagnostics r = row_count; o_metric := 'demoted'; o_count := r; return next;

  select count(*) into r from _cmp
   where (bppg > ppb and (tot - ppb) <> (bppg - ppb))
      or (ppb > bppg and bppg > 0);
  o_metric := 'left_ambiguous_unchanged'; o_count := r; return next;
end $$;


ALTER FUNCTION "public"."reconcile_pp_goals_with_boxscore"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_player_transaction"("p_player_id" integer, "p_league_id" "uuid", "p_team_id" "uuid", "p_transaction_type" "text", "p_source" "text" DEFAULT 'free_agent'::"text", "p_player_name" "text" DEFAULT NULL::"text", "p_player_team" "text" DEFAULT NULL::"text", "p_player_position" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."record_player_transaction"("p_player_id" integer, "p_league_id" "uuid", "p_team_id" "uuid", "p_transaction_type" "text", "p_source" "text", "p_player_name" "text", "p_player_team" "text", "p_player_position" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_player_transaction"("p_player_id" integer, "p_league_id" "uuid", "p_team_id" "uuid", "p_transaction_type" "text", "p_source" "text", "p_player_name" "text", "p_player_team" "text", "p_player_position" "text") IS 'ORPHANED as of 2026-08-12 -- writes public.player_transactions, which nothing reads any more. The live add/drop trail is transaction_ledger, written by process_roster_move().';



CREATE OR REPLACE FUNCTION "public"."record_rebuild_audit"("p_season" integer, "p_gate_name" "text", "p_expected" bigint, "p_actual" bigint, "p_note" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_status text;
BEGIN
  v_status := CASE WHEN p_expected IS NULL THEN 'info'
                   WHEN p_expected = p_actual THEN 'pass'
                   ELSE 'fail' END;
  INSERT INTO xg_rebuild_audit(season, layer, expected, actual, status, detail)
  VALUES (p_season, p_gate_name, p_expected, p_actual, v_status, NULLIF(p_note, ''));
  RETURN v_status;
END $$;


ALTER FUNCTION "public"."record_rebuild_audit"("p_season" integer, "p_gate_name" "text", "p_expected" bigint, "p_actual" bigint, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_rebuild_band"("p_season" integer, "p_gate_name" "text", "p_lo" bigint, "p_hi" bigint, "p_actual" bigint, "p_note" "text" DEFAULT NULL::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v text;
begin
  v := case when p_actual between p_lo and p_hi then 'pass' else 'fail' end;
  insert into xg_rebuild_audit(season, layer, expected, actual, status, detail)
  values (p_season, p_gate_name, p_lo, p_actual, v,
          coalesce(p_note,'') || ' [band '||p_lo||'..'||p_hi||']');
  return v;
end $$;


ALTER FUNCTION "public"."record_rebuild_band"("p_season" integer, "p_gate_name" "text", "p_lo" bigint, "p_hi" bigint, "p_actual" bigint, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_user_consent"("p_policy_type" "text", "p_version" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_id      uuid;
BEGIN
  IF v_user_id IS NULL THEN
    -- Never record a consent that cannot be attributed to a person. A
    -- service-role client reaching here is a bug, not a consent.
    RAISE EXCEPTION 'record_user_consent requires an authenticated caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.user_privacy_consent (user_id, policy_type, version, granted, source)
  VALUES (v_user_id, p_policy_type, btrim(p_version), true, 'app')
  ON CONFLICT (user_id, policy_type, version) WHERE granted AND withdrawn_at IS NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Already on file for this exact policy+version. Idempotent by design:
    -- React StrictMode double-invokes effects, and a repeated signup submit
    -- must not create a second grant.
    SELECT id INTO v_id
      FROM public.user_privacy_consent
     WHERE user_id = v_user_id
       AND policy_type = p_policy_type
       AND version = btrim(p_version)
       AND granted AND withdrawn_at IS NULL
     LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."record_user_consent"("p_policy_type" "text", "p_version" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_user_consent"("p_policy_type" "text", "p_version" "text") IS 'Records a GDPR consent grant for auth.uid(). Idempotent per (user, policy_type, version). Refuses to run without an authenticated caller so no unattributed consent can be created. Called by POST /api/account/consent, which fires on signup for terms_of_service and privacy_policy.';



CREATE OR REPLACE FUNCTION "public"."refresh_player_rollups"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_season int; v_career int;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.player_season_totals;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.player_career_totals;
  SELECT count(*) INTO v_season FROM public.player_season_totals;
  SELECT count(*) INTO v_career FROM public.player_career_totals;
  IF v_season = 0 OR v_career = 0 THEN
    RAISE EXCEPTION 'rollup refresh produced empty views (season=%, career=%)', v_season, v_career;
  END IF;
  PERFORM public.record_rebuild_audit(
    extract(year from current_date)::int, 'nightly_rollup_refresh', NULL,
    v_season + v_career, format('season_rows=%s career_rows=%s', v_season, v_career));
  RETURN format('refreshed: %s season rows, %s career rows', v_season, v_career);
END $$;


ALTER FUNCTION "public"."refresh_player_rollups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_reverse_standings_waiver_order"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE r record; n int := 0; skipped int := 0; v_res jsonb;
BEGIN
  FOR r IN SELECT id FROM public.leagues WHERE coalesce(waiver_type,'rolling') = 'reverse_standings'
  LOOP
    v_res := public.reseed_waiver_priority_for_league(r.id);
    IF (v_res->>'success')::boolean THEN n := n + 1; ELSE skipped := skipped + 1; END IF;
  END LOOP;

  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'reverse_standings_waiver_refresh',
          CASE WHEN skipped > 0 THEN 'warning' ELSE 'pass' END,
          'reordered '||n||' league(s); skipped '||skipped||' with pending claims', true);

  RETURN jsonb_build_object('reordered', n, 'skipped', skipped);
END;
$$;


ALTER FUNCTION "public"."refresh_reverse_standings_waiver_order"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_reverse_standings_waiver_order"() IS 'Weekly recompute of waiver order for every league on reverse_standings. Cron: reverse-standings-waiver-order, Tuesdays 08:20 UTC, after the week rolls over.';



CREATE OR REPLACE FUNCTION "public"."refresh_xg_season_layer"("p_season" integer) RETURNS TABLE("o_layer" "text", "o_rows" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r bigint;
begin
  drop table if exists _sides;
  create temp table _sides on commit drop as
  select g.game_id,
         max(g.team_id) filter (where g.is_home)     as home_team,
         max(g.team_id) filter (where not g.is_home) as away_team
  from nhl_shots g where g.season = p_season group by g.game_id;

  delete from player_xg_season where season = p_season;
  insert into player_xg_season
  select s.season, s.game_type, s.shooter_id, s.team_id,
    count(*), count(*) filter (where s.event_type in ('shot-on-goal','goal')), count(*) filter (where s.is_goal),
    sum(s.xg_sql), sum(s.is_goal::int) - sum(s.xg_sql),
    count(*) filter (where not s.is_power_play and not s.is_shorthanded and not s.is_empty_net),
    count(*) filter (where s.is_power_play), count(*) filter (where s.is_shorthanded),
    count(*) filter (where s.is_goal and not s.is_power_play and not s.is_shorthanded),
    count(*) filter (where s.is_goal and s.is_power_play),
    count(*) filter (where s.is_goal and s.is_shorthanded),
    coalesce(sum(s.xg_sql) filter (where not s.is_power_play and not s.is_shorthanded and not s.is_empty_net),0),
    coalesce(sum(s.xg_sql) filter (where s.is_power_play),0),
    coalesce(sum(s.xg_sql) filter (where s.is_shorthanded),0),
    count(*) filter (where s.is_goal and s.is_empty_net),
    coalesce(sum(s.xg_sql) filter (where s.is_empty_net),0),
    avg(s.distance_adj), avg(s.xg_sql),
    count(*) filter (where s.prev_event_type in ('shot-on-goal','missed-shot','blocked-shot') and s.seconds_since_prev <= 3),
    count(*) filter (where s.is_rush), now()
  from nhl_shots s
  where s.season = p_season and s.xg_sql is not null and s.shooter_id is not null
  group by 1,2,3,4;
  get diagnostics r = row_count; o_layer := 'player_xg_season'; o_rows := r; return next;

  delete from goalie_xg_season where season = p_season;
  insert into goalie_xg_season
  select s.season, s.game_type, s.goalie_id,
    max(case when s.is_home then a.away_team else a.home_team end),
    count(*), count(*) filter (where s.event_type in ('shot-on-goal','goal')), count(*) filter (where s.is_goal),
    sum(s.xg_sql), sum(s.xg_sql) - sum(s.is_goal::int),
    coalesce(sum(s.xg_sql) filter (where not s.is_power_play and not s.is_shorthanded),0),
    count(*) filter (where s.is_goal and not s.is_power_play and not s.is_shorthanded),
    coalesce(sum(s.xg_sql) filter (where s.is_power_play),0),
    count(*) filter (where s.is_goal and s.is_power_play),
    avg(s.distance_adj), now()
  from nhl_shots s join _sides a on a.game_id = s.game_id
  where s.season = p_season and s.xg_sql is not null and s.goalie_id is not null and not s.is_empty_net
  group by 1,2,3;
  get diagnostics r = row_count; o_layer := 'goalie_xg_season'; o_rows := r; return next;

  delete from team_xg_season where season = p_season;
  insert into team_xg_season
  select season, game_type, team_id, sum(sf), sum(gf), sum(xf), sum(sa), sum(ga), sum(xa), now()
  from (
    select s.season, s.game_type, s.team_id, count(*) sf, count(*) filter (where s.is_goal) gf, sum(s.xg_sql) xf,
           0 sa, 0 ga, 0::double precision xa
    from nhl_shots s where s.season = p_season and s.xg_sql is not null group by 1,2,3
    union all
    select s.season, s.game_type, case when s.is_home then a.away_team else a.home_team end,
           0,0,0::double precision, count(*), count(*) filter (where s.is_goal), sum(s.xg_sql)
    from nhl_shots s join _sides a on a.game_id = s.game_id
    where s.season = p_season and s.xg_sql is not null group by 1,2,3
  ) u where team_id is not null group by 1,2,3;
  get diagnostics r = row_count; o_layer := 'team_xg_season'; o_rows := r; return next;
end $$;


ALTER FUNCTION "public"."refresh_xg_season_layer"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renumber_waiver_priority"("p_league_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_off INT;
BEGIN
  SELECT COALESCE(MAX(priority), 0) + 1000000 INTO v_off
  FROM waiver_priority WHERE league_id = p_league_id;

  UPDATE waiver_priority SET priority = priority + v_off WHERE league_id = p_league_id;

  WITH ranked AS (
    SELECT team_id AS t_id,
           ROW_NUMBER() OVER (ORDER BY priority ASC, team_id ASC) AS np
    FROM waiver_priority WHERE league_id = p_league_id
  )
  UPDATE waiver_priority w SET priority = ranked.np, updated_at = NOW()
  FROM ranked WHERE w.league_id = p_league_id AND w.team_id = ranked.t_id;
END $$;


ALTER FUNCTION "public"."renumber_waiver_priority"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reseed_waiver_priority_for_league"("p_league_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_mode      text;
  v_commish   uuid;
  v_caller    uuid := auth.uid();
  v_pending   int;
  v_offset    int;
  v_teams     int;
  v_ordered   int;
  v_basis     text;
BEGIN
  SELECT coalesce(l.waiver_type,'rolling'), l.commissioner_id
    INTO v_mode, v_commish
    FROM public.leagues l WHERE l.id = p_league_id;

  IF v_mode IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'league not found');
  END IF;

  -- When invoked by a person, only the commissioner may reorder waivers.
  -- v_caller IS NULL means a trigger, a cron, or service_role.
  IF v_caller IS NOT NULL AND v_caller <> v_commish THEN
    RETURN jsonb_build_object('success', false, 'error', 'only the commissioner can reseed waiver order');
  END IF;

  SELECT count(*) INTO v_pending
    FROM public.waiver_claims wc
   WHERE wc.league_id = p_league_id AND wc.status = 'pending';
  IF v_pending > 0 THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'pending_claims', v_pending,
      'error', 'waiver order not reseeded: '||v_pending||' claim(s) are pending and would resolve differently. Process or cancel them first.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('waiver_priority:' || p_league_id::text));

  -- make sure every team has a row before reordering
  PERFORM public.seed_waiver_priority_for_league(p_league_id);

  SELECT count(*) INTO v_teams FROM public.teams WHERE league_id = p_league_id;

  -- UNIQUE (league_id, priority) means the whole set has to move out of the way
  -- before it can be renumbered.
  SELECT coalesce(max(priority),0) + 1000000 INTO v_offset
    FROM public.waiver_priority WHERE league_id = p_league_id;
  UPDATE public.waiver_priority SET priority = priority + v_offset WHERE league_id = p_league_id;

  IF v_mode = 'reverse_draft_order' THEN
    -- Round one's declared order, reversed: last pick gets priority 1. Teams
    -- with no draft slot fall in behind, in join order.
    WITH round1 AS (
      SELECT (elem.value #>> '{}')::uuid AS team_id, elem.ordinality AS slot
        FROM public.draft_order d
        CROSS JOIN LATERAL jsonb_array_elements(d.team_order) WITH ORDINALITY AS elem(value, ordinality)
       WHERE d.league_id = p_league_id AND d.round_number = 1
    ),
    ranked AS (
      SELECT t.id AS tid,
             ROW_NUMBER() OVER (
               ORDER BY (r.slot IS NULL),           -- drafted teams first
                        r.slot DESC NULLS LAST,     -- last pick -> priority 1
                        t.created_at ASC, t.id ASC  -- undrafted: join order
             ) AS new_priority
        FROM public.teams t
        LEFT JOIN round1 r ON r.team_id = t.id
       WHERE t.league_id = p_league_id
    )
    UPDATE public.waiver_priority wp
       SET priority = rk.new_priority, updated_at = now()
      FROM ranked rk
     WHERE wp.league_id = p_league_id AND wp.team_id = rk.tid;
    GET DIAGNOSTICS v_ordered = ROW_COUNT;

    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.draft_order
                              WHERE league_id = p_league_id AND round_number = 1)
                THEN 'draft_order round 1, reversed'
                ELSE 'NO round-1 draft order exists yet -- fell back to join order' END
      INTO v_basis;

  ELSIF v_mode = 'reverse_standings' THEN
    WITH team_records AS (
      SELECT t.id AS tid,
             coalesce(sum(CASE WHEN (m.team1_id = t.id AND m.team1_score > m.team2_score)
                                 OR (m.team2_id = t.id AND m.team2_score > m.team1_score)
                               THEN 1 ELSE 0 END), 0) AS wins,
             coalesce(sum(CASE WHEN (m.team1_id = t.id AND m.team1_score < m.team2_score)
                                 OR (m.team2_id = t.id AND m.team2_score < m.team1_score)
                               THEN 1 ELSE 0 END), 0) AS losses
        FROM public.teams t
        LEFT JOIN public.matchups m ON m.league_id = p_league_id AND m.status = 'completed'
                                   AND (m.team1_id = t.id OR m.team2_id = t.id)
       WHERE t.league_id = p_league_id
       GROUP BY t.id
    ),
    ranked AS (
      SELECT tid, ROW_NUMBER() OVER (
               ORDER BY wins::numeric / greatest(1, wins + losses) ASC, losses DESC, tid ASC
             ) AS new_priority
        FROM team_records
    )
    UPDATE public.waiver_priority wp
       SET priority = rk.new_priority, updated_at = now()
      FROM ranked rk
     WHERE wp.league_id = p_league_id AND wp.team_id = rk.tid;
    GET DIAGNOSTICS v_ordered = ROW_COUNT;
    v_basis := 'completed matchups, worst win pct first';

  ELSE
    -- rolling and faab: join order
    WITH ranked AS (
      SELECT t.id AS tid,
             ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.id ASC) AS new_priority
        FROM public.teams t WHERE t.league_id = p_league_id
    )
    UPDATE public.waiver_priority wp
       SET priority = rk.new_priority, updated_at = now()
      FROM ranked rk
     WHERE wp.league_id = p_league_id AND wp.team_id = rk.tid;
    GET DIAGNOSTICS v_ordered = ROW_COUNT;
    v_basis := 'teams.created_at, join order';
  END IF;

  PERFORM public.renumber_waiver_priority(p_league_id);

  RETURN jsonb_build_object('success', true, 'league_id', p_league_id, 'mode', v_mode,
                            'teams', v_teams, 'reordered', v_ordered, 'basis', v_basis);
END;
$$;


ALTER FUNCTION "public"."reseed_waiver_priority_for_league"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reseed_waiver_priority_for_league"("p_league_id" "uuid") IS 'Rebuilds waiver_priority for a league according to leagues.waiver_type. Refuses while claims are pending, because reordering mid-flight silently changes who wins them. Callable by the league commissioner, by triggers, and by cron.';



CREATE OR REPLACE FUNCTION "public"."reserve_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_user_id" "uuid", "p_duration_seconds" integer DEFAULT 30) RETURNS TABLE("success" boolean, "message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing_pick UUID;
  v_existing_reservation UUID;
BEGIN
  -- Check if player is already drafted (permanent pick)
  SELECT id INTO v_existing_pick
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND deleted_at IS NULL
    AND reserved_by IS NULL;  -- Only check confirmed picks
  
  IF v_existing_pick IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Player already drafted'::TEXT;
    RETURN;
  END IF;
  
  -- Check if player is reserved by someone else (and reservation hasn't expired)
  SELECT id INTO v_existing_reservation
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by IS NOT NULL
    AND reserved_by != p_user_id
    AND reservation_expires_at > NOW()
    AND deleted_at IS NULL;
  
  IF v_existing_reservation IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Player is reserved by another user'::TEXT;
    RETURN;
  END IF;
  
  -- Clean up expired reservations for this player
  DELETE FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by IS NOT NULL
    AND reservation_expires_at <= NOW()
    AND deleted_at IS NULL;
  
  -- Create reservation
  INSERT INTO draft_picks (
    league_id,
    player_id,
    reserved_by,
    reserved_at,
    reservation_expires_at,
    team_id,
    round_number,
    pick_number
  ) VALUES (
    p_league_id,
    p_player_id,
    p_user_id,
    NOW(),
    NOW() + (p_duration_seconds || ' seconds')::INTERVAL,
    '00000000-0000-0000-0000-000000000000'::UUID,  -- Placeholder, will be set on confirm
    0,  -- Placeholder
    0   -- Placeholder
  )
  ON CONFLICT (league_id, player_id) 
  DO UPDATE SET
    reserved_by = EXCLUDED.reserved_by,
    reserved_at = EXCLUDED.reserved_at,
    reservation_expires_at = EXCLUDED.reservation_expires_at;
  
  RETURN QUERY SELECT TRUE, 'Player reserved for 30 seconds'::TEXT;
END;
$$;


ALTER FUNCTION "public"."reserve_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_user_id" "uuid", "p_duration_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reserve_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_user_id" "uuid", "p_duration_seconds" integer) IS 'Reserve a player for 30 seconds to prevent race conditions during draft. Used for optimistic UI updates.';



CREATE OR REPLACE FUNCTION "public"."reset_playoff_bracket"("p_league_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bracket_id UUID;
BEGIN
  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = p_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can reset playoff brackets');
  END IF;

  -- Get current bracket
  SELECT id INTO v_bracket_id
  FROM public.playoff_brackets
  WHERE league_id = p_league_id
  AND season = EXTRACT(YEAR FROM NOW());

  IF v_bracket_id IS NULL THEN
    RETURN json_build_object('error', 'No bracket found for this season');
  END IF;

  -- Delete bracket and cascade (seeds and series auto-deleted via CASCADE)
  DELETE FROM public.playoff_brackets WHERE id = v_bracket_id;

  -- Clean up playoff matchups (week_number > regular season)
  DELETE FROM public.matchups
  WHERE league_id = p_league_id
  AND week_number > COALESCE(
    (SELECT (settings->>'regularSeasonWeeks')::INT FROM public.leagues WHERE id = p_league_id),
    (SELECT COALESCE(MAX(m2.week_number), 0) FROM public.matchups m2 WHERE m2.league_id = p_league_id)
  );

  RETURN json_build_object('success', true, 'bracket_id', v_bracket_id);
END;
$$;


ALTER FUNCTION "public"."reset_playoff_bracket"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_pp_goals_by_penalty_window"() RETURNS TABLE("o_metric" "text", "o_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r bigint;
begin
  drop table if exists _cand;
  create temp table _cand as
  with bx as (select game_id, player_id, coalesce(nhl_ppg,0) bppg
              from player_game_stats where not is_goalie),
  pb as (select game_id, shooter_id player_id,
                count(*) filter (where is_power_play) ppb from nhl_shots where is_goal group by 1,2)
  select pb.game_id, pb.player_id, coalesce(bx.bppg,0) bppg, pb.ppb
  from pb left join bx using (game_id, player_id) where coalesce(bx.bppg,0) <> pb.ppb;

  drop table if exists _pen;
  create temp table _pen as
  select r2.game_id,
    ((pl->'periodDescriptor'->>'number')::int - 1)*1200
      + split_part(pl->>'timeInPeriod',':',1)::int*60 + split_part(pl->>'timeInPeriod',':',2)::int as t,
    (pl->'details'->>'eventOwnerTeamId')::int pen_team,
    (pl->'details'->>'duration')::int dur
  from raw_nhl_data r2
  join (select distinct game_id from _cand) g using (game_id),
  lateral jsonb_array_elements(r2.raw_json->'plays') pl
  where pl->>'typeDescKey' = 'penalty' and (pl->'details'->>'duration') is not null;
  create index on _pen (game_id);

  drop table if exists _goal;
  create temp table _goal as
  select s.game_id, s.event_id, s.shooter_id, s.is_power_play, s.seconds_elapsed,
         (select count(*) from _pen p where p.game_id=s.game_id and p.pen_team <> s.team_id
            and s.seconds_elapsed >= p.t and s.seconds_elapsed < p.t + p.dur*60) as opp_pen
  from nhl_shots s join _cand c on c.game_id=s.game_id and c.player_id=s.shooter_id
  where s.is_goal;
  create index on _goal (game_id, shooter_id);

  -- PROMOTE where the penalty windows pick exactly the required number
  update nhl_shots s set is_power_play = true, strength_source = 'penalty_window_resolved'
    from _cand c, _goal g
   where c.bppg > c.ppb
     and g.game_id=c.game_id and g.shooter_id=c.player_id and not g.is_power_play and g.opp_pen > 0
     and s.game_id=g.game_id and s.event_id=g.event_id
     and (select count(*) from _goal x where x.game_id=c.game_id and x.shooter_id=c.player_id
            and not x.is_power_play and x.opp_pen > 0) = (c.bppg - c.ppb);
  get diagnostics r = row_count; o_metric := 'promoted_by_penalty_window'; o_count := r; return next;

  -- DEMOTE where the PBP calls it a power play but no opposing penalty was running
  update nhl_shots s set is_power_play = false, strength_source = 'penalty_window_resolved'
    from _cand c, _goal g
   where c.ppb > c.bppg
     and g.game_id=c.game_id and g.shooter_id=c.player_id and g.is_power_play and g.opp_pen = 0
     and s.game_id=g.game_id and s.event_id=g.event_id
     and (select count(*) from _goal x where x.game_id=c.game_id and x.shooter_id=c.player_id
            and x.is_power_play and x.opp_pen = 0) = (c.ppb - c.bppg);
  get diagnostics r = row_count; o_metric := 'demoted_by_penalty_window'; o_count := r; return next;
end $$;


ALTER FUNCTION "public"."resolve_pp_goals_by_penalty_window"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_team_lineups"("p_backup_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_backup_record RECORD;
  v_team_record JSONB;
  v_restored_count INTEGER := 0;
  v_current_count INTEGER;
  v_current_backup_id UUID;
BEGIN
  -- Get the backup
  SELECT * INTO v_backup_record
  FROM team_lineups_backup_log
  WHERE id = p_backup_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup ID % not found', p_backup_id;
  END IF;
  
  RAISE NOTICE 'Restoring from backup: % (created %)', 
    v_backup_record.backup_name, 
    v_backup_record.created_at;
  
  -- Create backup of current state before restore
  SELECT COUNT(*) INTO v_current_count FROM team_lineups;
  IF v_current_count > 0 THEN
    v_current_backup_id := backup_team_lineups(
      'before_restore_' || to_char(NOW(), 'YYYY-MM-DD_HH24:MI:SS'),
      'Auto-backup before restoring from: ' || v_backup_record.backup_name
    );
    RAISE NOTICE 'Created safety backup: %', v_current_backup_id;
  END IF;
  
  -- Clear current data
  DELETE FROM team_lineups;
  RAISE NOTICE 'Cleared existing team_lineups (% rows)', v_current_count;
  
  -- Restore from backup
  FOR v_team_record IN
    SELECT * FROM jsonb_array_elements(v_backup_record.backup_data)
  LOOP
    INSERT INTO team_lineups (
      league_id,
      team_id,
      starters,
      bench,
      ir,
      slot_assignments,
      updated_at
    )
    VALUES (
      (v_team_record->>'league_id')::UUID,
      (v_team_record->>'team_id')::UUID,
      (v_team_record->>'starters')::JSONB,
      (v_team_record->>'bench')::JSONB,
      (v_team_record->>'ir')::JSONB,
      (v_team_record->>'slot_assignments')::JSONB,
      NOW()
    );
    
    v_restored_count := v_restored_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Restore complete: % teams restored', v_restored_count;
  RAISE NOTICE 'Backup data had: % teams, % players', 
    v_backup_record.team_count,
    v_backup_record.player_count;
  
  -- Validate restoration
  IF v_restored_count != v_backup_record.team_count THEN
    RAISE WARNING 'Mismatch: Restored % teams but backup had %', 
      v_restored_count, v_backup_record.team_count;
  END IF;
  
  RETURN v_restored_count;
END;
$$;


ALTER FUNCTION "public"."restore_team_lineups"("p_backup_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restore_team_lineups"("p_backup_id" "uuid") IS 'Restores team_lineups from a backup. Creates safety backup before restore.
Usage: SELECT restore_team_lineups(''backup-uuid-here'');
List backups: SELECT id, backup_name, created_at, team_count FROM team_lineups_backup_log ORDER BY created_at DESC;';



CREATE OR REPLACE FUNCTION "public"."rink_cdf_season_for"("p_home_team" integer, "p_season" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select c.season from nhl_rink_cdf c
      where c.coord='x' and c.home_team=p_home_team and c.season=p_season and c.n_group>=1500 limit 1),
    (select max(c.season) from nhl_rink_cdf c
      where c.coord='x' and c.home_team=p_home_team and c.season<p_season and c.n_group>=1500)
  );
$$;


ALTER FUNCTION "public"."rink_cdf_season_for"("p_home_team" integer, "p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_data_retention"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  d_audit     bigint := 0;
  d_integrity bigint := 0;
  c_integrity bigint := 0;
  d_cron      bigint := 0;
  d_fnerr     bigint := 0;
  v_result    jsonb;
BEGIN
  -- SOC 2 evidence. Small, irreplaceable, kept for two years.
  DELETE FROM public.security_audit_log WHERE created_at < now() - interval '730 days';
  GET DIAGNOSTICS d_audit = ROW_COUNT;

  -- Beyond 365 days: gone.
  DELETE FROM public.integrity_check_results WHERE check_time < now() - interval '365 days';
  GET DIAGNOSTICS d_integrity = ROW_COUNT;

  -- 30 to 365 days: collapse to one row per check per status per day, keeping
  -- the LAST of each day so the surviving row carries the freshest detail.
  WITH keep AS (
    SELECT DISTINCT ON (check_name, status, check_time::date) id
      FROM public.integrity_check_results
     WHERE check_time < now() - interval '30 days'
     ORDER BY check_name, status, check_time::date, check_time DESC
  )
  DELETE FROM public.integrity_check_results r
   WHERE r.check_time < now() - interval '30 days'
     AND r.id NOT IN (SELECT id FROM keep);
  GET DIAGNOSTICS c_integrity = ROW_COUNT;

  DELETE FROM public.function_error_log WHERE occurred_at < now() - interval '365 days';
  GET DIAGNOSTICS d_fnerr = ROW_COUNT;

  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '90 days';
  GET DIAGNOSTICS d_cron = ROW_COUNT;

  v_result := jsonb_build_object(
    'ran_at', now(),
    'security_audit_log_deleted_over_730d', d_audit,
    'integrity_check_results_deleted_over_365d', d_integrity,
    'integrity_check_results_collapsed_over_30d', c_integrity,
    'function_error_log_deleted_over_365d', d_fnerr,
    'cron_job_run_details_deleted_over_90d', d_cron,
    'integrity_check_results_remaining', (SELECT count(*) FROM public.integrity_check_results),
    'security_audit_log_remaining', (SELECT count(*) FROM public.security_audit_log));

  -- the retention run reports on itself, so a silent failure is not possible
  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'data_retention', 'pass', left(v_result::text, 900), true);

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."run_data_retention"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."run_data_retention"() IS 'Monthly retention. security_audit_log 730d (SOC 2 evidence, tiny). integrity_check_results: full fidelity 30d, then collapsed to one row per check/status/day, hard delete at 365d. function_error_log 365d. cron.job_run_details 90d. Replaces raw SQL that lived only inside cron.job.command and had been failing since 2026-08-01 with "relation public.audit_logs does not exist".';



CREATE OR REPLACE FUNCTION "public"."run_full_autopick_draft"("p_league_id" "uuid") RETURNS TABLE("round_number" integer, "pick_number" integer, "team_id" "uuid", "player_id" integer, "player_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."run_full_autopick_draft"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_weekly_stats_populate"("p_anchor" "date") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_week_start date;
  v_week_end   date;
  v_season     int;
  v_opener     date;
  v_last_reg   date;
  v_week1_sun  date;
  v_week_no    int;
BEGIN
  v_week_start := p_anchor - EXTRACT(DOW FROM p_anchor)::int;  -- Sunday of anchor's week
  v_week_end   := v_week_start + 6;                            -- Saturday

  -- Which season does THIS WEEK belong to? Ask the fixtures in the week, not
  -- the calendar. Ties broken toward the season contributing more games, which
  -- matters only for a straddling week.
  SELECT g.season INTO v_season
    FROM public.nhl_games g
   WHERE g.game_type = 'regular'
     AND g.game_date BETWEEN v_week_start AND v_week_end
   GROUP BY g.season
   ORDER BY count(*) DESC, g.season DESC
   LIMIT 1;

  -- No games in the week (all-star break, offseason): fall back to the
  -- schedule-derived current season rather than the calendar rule.
  IF v_season IS NULL THEN
    v_season := public.get_current_season(v_week_end);
  END IF;

  SELECT min(g.game_date), max(g.game_date) INTO v_opener, v_last_reg
    FROM public.nhl_games g
   WHERE substring(g.game_id::text FROM 1 FOR 4)::int = v_season
     AND g.game_type = 'regular';

  IF v_opener IS NULL THEN
    RETURN 0;  -- season schedule not ingested yet: honest no-op
  END IF;

  IF v_week_end < v_opener OR v_week_start > v_last_reg THEN
    RETURN 0;  -- outside the regular season (offseason or playoff window): refuse
  END IF;

  v_week1_sun := v_opener - EXTRACT(DOW FROM v_opener)::int;
  v_week_no   := ((v_week_start - v_week1_sun) / 7) + 1;

  PERFORM public.populate_player_weekly_stats(v_week_no, v_week_start, v_week_end);
  RETURN v_week_no;
END;
$$;


ALTER FUNCTION "public"."run_weekly_stats_populate"("p_anchor" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."run_weekly_stats_populate"("p_anchor" "date") IS 'Cron entry for weekly stats. Computes the Sun-Sat week containing p_anchor, derives the season-relative week number from the season opener (game_id prefix, never the calendar), refuses weeks outside the regular season, and upserts via populate_player_weekly_stats. Returns the week number written, or 0 for an honest no-op. Registered as populate-weekly-stats-monday (0 7 * * 1, anchor today-7) and populate-weekly-stats-daily (30 6 * * *, anchor today) by 0G-WEEKLY-1.';



CREATE OR REPLACE FUNCTION "public"."score_all_playoff_roster_pools"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE r RECORD; v_total INT := 0;
BEGIN
  FOR r IN SELECT id FROM leagues WHERE settings->>'leagueType' = 'playoff-roster-pool' LOOP
    v_total := v_total + COALESCE(public.score_playoff_roster_pool(r.id), 0);
  END LOOP;
  RETURN v_total;
END $$;


ALTER FUNCTION "public"."score_all_playoff_roster_pools"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_all_pools_for_week"("p_week_number" integer) RETURNS TABLE("league_id" "uuid", "league_name" "text", "pool_type" "text", "scored_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_league RECORD; v_count INT;
BEGIN
  FOR v_league IN SELECT DISTINCT ss.league_id, l.name FROM survivor_selections ss JOIN leagues l ON l.id = ss.league_id WHERE ss.week_number = p_week_number AND ss.is_correct IS NULL
  LOOP SELECT COUNT(*) INTO v_count FROM score_survivor_week(v_league.league_id, p_week_number);
    IF v_count > 0 THEN league_id := v_league.league_id; league_name := v_league.name; pool_type := 'survivor'; scored_count := v_count; RETURN NEXT; END IF;
  END LOOP;
  FOR v_league IN SELECT DISTINCT pp.league_id, l.name FROM pool_picks pp JOIN leagues l ON l.id = pp.league_id WHERE pp.week_number = p_week_number AND pp.is_correct IS NULL
  LOOP SELECT COUNT(*) INTO v_count FROM score_pickem_week(v_league.league_id, p_week_number);
    IF v_count > 0 THEN league_id := v_league.league_id; league_name := v_league.name; pool_type := 'pickem'; scored_count := v_count; RETURN NEXT; END IF;
  END LOOP;
  FOR v_league IN SELECT DISTINCT cp.league_id, l.name FROM confidence_picks cp JOIN leagues l ON l.id = cp.league_id WHERE cp.week_number = p_week_number AND cp.is_correct IS NULL
  LOOP SELECT COUNT(*) INTO v_count FROM score_confidence_week(v_league.league_id, p_week_number);
    IF v_count > 0 THEN league_id := v_league.league_id; league_name := v_league.name; pool_type := 'confidence'; scored_count := v_count; RETURN NEXT; END IF;
  END LOOP;
  RETURN;
END;
$$;


ALTER FUNCTION "public"."score_all_pools_for_week"("p_week_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_confidence_week"("p_league_id" "uuid", "p_week_number" integer) RETURNS TABLE("pick_id" "uuid", "user_id" "uuid", "game_id" "text", "picked_team" "text", "confidence_points" integer, "is_correct" boolean, "points_earned" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pick RECORD; v_game RECORD; v_correct BOOLEAN; v_winner TEXT; v_earned INT;
BEGIN
  FOR v_pick IN
    SELECT cp.id, cp.user_id, cp.game_id, cp.picked_team, cp.confidence_points
    FROM confidence_picks cp
    WHERE cp.league_id = p_league_id AND cp.week_number = p_week_number
      AND cp.is_correct IS NULL
  LOOP
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id AND ng.status = 'final'
      AND ng.home_score IS NOT NULL AND ng.away_score IS NOT NULL;

    IF FOUND THEN
      IF v_game.home_score > v_game.away_score THEN v_winner := v_game.home_team;
      ELSIF v_game.away_score > v_game.home_score THEN v_winner := v_game.away_team;
      ELSE v_winner := 'TIE'; END IF;

      v_correct := (v_pick.picked_team = v_winner) AND v_winner <> 'TIE';
      v_earned := CASE WHEN v_correct THEN v_pick.confidence_points ELSE 0 END;

      UPDATE confidence_picks
         SET is_correct = v_correct, points_earned = v_earned
       WHERE id = v_pick.id;

      pick_id := v_pick.id; user_id := v_pick.user_id; game_id := v_pick.game_id;
      picked_team := v_pick.picked_team; confidence_points := v_pick.confidence_points;
      is_correct := v_correct; points_earned := v_earned;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END $$;


ALTER FUNCTION "public"."score_confidence_week"("p_league_id" "uuid", "p_week_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_matchup_lines"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") RETURNS TABLE("roster_date" "date", "player_id" integer, "is_goalie" boolean, "points" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with lg as (
    select m.league_id from matchups m where m.id = p_matchup_id
  ),
  rules as (
    select r.stat_key, r.multiplier
      from lg, lateral public.get_effective_scoring_rules(lg.league_id) r
  )
  select fdr.roster_date,
         l.player_id,
         l.is_goalie,
         round(sum(l.value * rules.multiplier), 3) as points
    from fantasy_daily_rosters fdr
    join player_game_stats pgs
      on pgs.player_id = fdr.player_id
     and pgs.game_date = fdr.roster_date
    join nhl_games g_reg
      on g_reg.game_id = pgs.game_id
     and g_reg.game_type = 'regular'
    join public.v_player_game_stat_long l
      on l.game_id = pgs.game_id
     and l.player_id = pgs.player_id
    join rules on rules.stat_key = l.stat_key
   where fdr.matchup_id = p_matchup_id
     and fdr.team_id    = p_team_id
     and fdr.slot_type  = 'active'
     and fdr.roster_date >= p_week_start
     and fdr.roster_date <= p_week_end
   group by fdr.roster_date, l.player_id, l.is_goalie;
$$;


ALTER FUNCTION "public"."score_matchup_lines"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."score_matchup_lines"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") IS 'Per-player per-date fantasy points. The audit trail behind every score.';



CREATE OR REPLACE FUNCTION "public"."score_pickem_week"("p_league_id" "uuid", "p_week_number" integer) RETURNS TABLE("pick_id" "uuid", "user_id" "uuid", "game_id" "text", "picked_team" "text", "is_correct" boolean, "winning_team" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_pick RECORD; v_game RECORD; v_correct BOOLEAN; v_winner TEXT;
BEGIN
  FOR v_pick IN
    SELECT pp.id, pp.user_id, pp.game_id, pp.picked_team, pp.spread_value
    FROM pool_picks pp
    WHERE pp.league_id = p_league_id AND pp.week_number = p_week_number
      AND pp.is_correct IS NULL
  LOOP
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id AND ng.status = 'final'
      AND ng.home_score IS NOT NULL AND ng.away_score IS NOT NULL;

    IF FOUND THEN
      IF v_game.home_score > v_game.away_score THEN v_winner := v_game.home_team;
      ELSIF v_game.away_score > v_game.home_score THEN v_winner := v_game.away_team;
      ELSE v_winner := 'TIE'; END IF;

      IF v_pick.spread_value IS NOT NULL AND v_pick.spread_value <> 0 THEN
        IF v_pick.picked_team = v_game.home_team THEN
          v_correct := (v_game.home_score + v_pick.spread_value) > v_game.away_score;
        ELSE
          v_correct := (v_game.away_score + v_pick.spread_value) > v_game.home_score;
        END IF;
      ELSE
        v_correct := (v_pick.picked_team = v_winner);
      END IF;

      UPDATE pool_picks SET is_correct = v_correct WHERE id = v_pick.id;

      pick_id := v_pick.id; user_id := v_pick.user_id; game_id := v_pick.game_id;
      picked_team := v_pick.picked_team; is_correct := v_correct; winning_team := v_winner;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END $$;


ALTER FUNCTION "public"."score_pickem_week"("p_league_id" "uuid", "p_week_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_playoff_roster_pool"("p_league_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_settings JSONB; v_league_floor DATE; v_updated INTEGER; v_season INT;
BEGIN
  v_season := public.get_current_season();

  SELECT scoring_settings INTO v_settings FROM leagues WHERE id = p_league_id;
  IF v_settings IS NULL THEN v_settings := '{}'::jsonb; END IF;

  SELECT COALESCE((settings->>'playoffScoringStartDate')::DATE, '1900-01-01'::DATE)
    INTO v_league_floor FROM leagues WHERE id = p_league_id;

  WITH playoff_games AS (
    SELECT pgs.player_id, pgs.is_goalie,
           pgs.nhl_goals, pgs.goals, pgs.nhl_assists, pgs.primary_assists, pgs.secondary_assists,
           pgs.nhl_ppp, pgs.ppp, pgs.nhl_shp, pgs.shp,
           pgs.nhl_shots_on_goal, pgs.shots_on_goal, pgs.nhl_blocks, pgs.blocks,
           pgs.nhl_hits, pgs.hits, pgs.nhl_pim, pgs.pim, pgs.nhl_plus_minus, pgs.plus_minus,
           pgs.nhl_wins, pgs.wins, pgs.nhl_saves, pgs.saves,
           pgs.nhl_shutouts, pgs.shutouts, pgs.nhl_goals_against, pgs.goals_against,
           g.game_date AS pg_date
    FROM player_game_stats pgs
    JOIN nhl_games g ON g.game_id = pgs.game_id
    WHERE g.game_type = 'playoff'
      AND g.season = v_season
      AND g.status IN ('live', 'in_progress', 'final')
  ),
  user_totals AS (
    SELECT rp.user_id,
      COALESCE(SUM(
        CASE WHEN COALESCE(pg.is_goalie, false) THEN
          COALESCE(COALESCE(pg.nhl_wins, pg.wins), 0) * COALESCE((v_settings->'goalie'->>'wins')::NUMERIC, 4) +
          COALESCE(COALESCE(pg.nhl_saves, pg.saves), 0) * COALESCE((v_settings->'goalie'->>'saves')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_shutouts, pg.shutouts), 0) * COALESCE((v_settings->'goalie'->>'shutouts')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_goals_against, pg.goals_against), 0) * COALESCE((v_settings->'goalie'->>'goals_against')::NUMERIC, -1)
        ELSE
          COALESCE(COALESCE(pg.nhl_goals, pg.goals), 0) * COALESCE((v_settings->'skater'->>'goals')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_assists, COALESCE(pg.primary_assists,0)+COALESCE(pg.secondary_assists,0)), 0)
            * COALESCE((v_settings->'skater'->>'assists')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_ppp, pg.ppp), 0) * COALESCE((v_settings->'skater'->>'power_play_points')::NUMERIC, 1) +
          COALESCE(COALESCE(pg.nhl_shp, pg.shp), 0) * COALESCE((v_settings->'skater'->>'short_handed_points')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_shots_on_goal, pg.shots_on_goal), 0) * COALESCE((v_settings->'skater'->>'shots_on_goal')::NUMERIC, 0.4) +
          COALESCE(COALESCE(pg.nhl_blocks, pg.blocks), 0) * COALESCE((v_settings->'skater'->>'blocks')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_hits, pg.hits), 0) * COALESCE((v_settings->'skater'->>'hits')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_pim, pg.pim), 0) * COALESCE((v_settings->'skater'->>'penalty_minutes')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_plus_minus, pg.plus_minus), 0) * COALESCE((v_settings->'skater'->>'plus_minus')::NUMERIC, 0)
        END), 0) AS total_points
    FROM playoff_roster_picks rp
    LEFT JOIN playoff_games pg
      ON pg.player_id = rp.player_id
     AND pg.pg_date >= GREATEST(rp.created_at::date, v_league_floor)
    WHERE rp.league_id = p_league_id
    GROUP BY rp.user_id
  ),
  ranked AS (
    SELECT user_id, total_points, RANK() OVER (ORDER BY total_points DESC) AS rnk FROM user_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT p_league_id, user_id, total_points, 0, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END $$;


ALTER FUNCTION "public"."score_playoff_roster_pool"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."score_playoff_roster_pool"("p_league_id" "uuid") IS 'Scores a playoff roster pool with a per-pick date floor. Each pick contributes stats only from games on/after that pick''s created_at date. Honors leagues.scoring_settings JSONB weights. Optional settings.playoffScoringStartDate league-wide floor via GREATEST. Idempotent.';



CREATE OR REPLACE FUNCTION "public"."score_playoff_series_picks"("p_series_id" "uuid") RETURNS TABLE("picks_scored" integer, "standings_updated" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_series RECORD;
  v_picks_scored INTEGER := 0;
  v_standings_updated INTEGER := 0;
  v_round_points NUMERIC;
  v_rowcount INTEGER;
BEGIN
  -- 1. Load the series + verify it's final
  SELECT * INTO v_series
  FROM nhl_playoff_series
  WHERE series_id = p_series_id
    AND series_status = 'final'
    AND winner_team_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- 2. BRACKET PICKEM scoring
  -- Default per-round points: R1=2, R2=4, R3=8, SCF=16 (Yahoo-standard).
  -- Commissioner can override via leagues.settings.playoffBracketPointsPerRound.
  -- +1 bonus if predicted_games matches actual games_played.
  UPDATE playoff_bracket_picks bp
  SET
    is_correct = (bp.picked_team_id = v_series.winner_team_id),
    points_earned = CASE
      WHEN bp.picked_team_id = v_series.winner_team_id THEN
        COALESCE(
          (l.settings->'playoffBracketPointsPerRound'->>(
            CASE v_series.round
              WHEN 1 THEN 'r1'
              WHEN 2 THEN 'r2'
              WHEN 3 THEN 'r3'
              WHEN 4 THEN 'scf'
            END
          ))::NUMERIC,
          CASE v_series.round WHEN 1 THEN 2 WHEN 2 THEN 4 WHEN 3 THEN 8 WHEN 4 THEN 16 ELSE 0 END
        )
        + CASE WHEN bp.predicted_games = v_series.games_played
               THEN COALESCE((l.settings->>'playoffGamesPickBonus')::NUMERIC, 1)
               ELSE 0 END
      ELSE 0
    END,
    locked_at = COALESCE(bp.locked_at, NOW()),
    updated_at = NOW()
  FROM leagues l
  WHERE bp.league_id = l.id
    AND bp.series_slot = v_series.bracket_slot
    AND (l.settings->>'leagueType') = 'playoff-bracket-pickem';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_picks_scored := v_picks_scored + v_rowcount;

  -- 3. CONFIDENCE POOL scoring
  -- Points awarded = confidence_value IF correct, 0 otherwise.
  UPDATE playoff_confidence_picks cp
  SET
    is_correct = (cp.picked_team_id = v_series.winner_team_id),
    points_earned = CASE
      WHEN cp.picked_team_id = v_series.winner_team_id THEN cp.confidence_value::NUMERIC
      ELSE 0
    END,
    locked_at = COALESCE(cp.locked_at, NOW()),
    updated_at = NOW()
  FROM leagues l
  WHERE cp.league_id = l.id
    AND cp.series_slot = v_series.bracket_slot
    AND (l.settings->>'leagueType') = 'playoff-confidence-pool';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_picks_scored := v_picks_scored + v_rowcount;

  -- 4. Recompute standings for every league that had picks on this series
  WITH league_totals AS (
    SELECT
      league_id,
      user_id,
      SUM(points_earned) AS total,
      COUNT(*) FILTER (WHERE is_correct) AS correct_count
    FROM (
      SELECT league_id, user_id, points_earned, is_correct FROM playoff_bracket_picks
      UNION ALL
      SELECT league_id, user_id, points_earned, is_correct FROM playoff_confidence_picks
    ) all_picks
    WHERE points_earned IS NOT NULL
    GROUP BY league_id, user_id
  ),
  ranked AS (
    SELECT
      league_id, user_id, total, correct_count,
      RANK() OVER (PARTITION BY league_id ORDER BY total DESC) AS rnk
    FROM league_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT league_id, user_id, total, correct_count, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        correct_picks = EXCLUDED.correct_picks,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_standings_updated := v_rowcount;

  RETURN QUERY SELECT v_picks_scored, v_standings_updated;
END;
$$;


ALTER FUNCTION "public"."score_playoff_series_picks"("p_series_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."score_playoff_series_picks"("p_series_id" "uuid") IS 'Awards points to all bracket/confidence picks for a finalized series and recomputes league standings. Idempotent.';



CREATE OR REPLACE FUNCTION "public"."score_pools_pending"("p_max_weeks" integer DEFAULT 12) RETURNS TABLE("week_number" integer, "league_id" "uuid", "league_name" "text", "pool_type" "text", "scored_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_weeks INT[]; v_total INT; w INT;
BEGIN
  -- Nothing scored regular-season pools before this. score_all_pools_for_week was
  -- correct but no cron job and no route ever called it, so picks stayed
  -- is_correct = NULL forever and every pool standing read empty.
  --
  -- Scoring every week that still has unscored picks -- rather than just the current
  -- one -- makes this self-healing: a week missed while the job was down is picked up
  -- on the next run instead of being stranded. The per-week scorers skip games that
  -- are not final, so scanning an open week is cheap and safe.
  --
  -- Columns are alias-qualified: week_number is also an OUT parameter here.
  SELECT array_agg(z.wk ORDER BY z.wk DESC) INTO v_weeks
  FROM (
    SELECT cp.week_number AS wk FROM confidence_picks cp    WHERE cp.is_correct IS NULL
    UNION SELECT pp.week_number FROM pool_picks pp          WHERE pp.is_correct IS NULL
    UNION SELECT ss.week_number FROM survivor_selections ss WHERE ss.is_correct IS NULL
  ) z;

  v_total := COALESCE(array_length(v_weeks, 1), 0);
  IF v_total = 0 THEN RETURN; END IF;

  -- Bound the work, but never silently: if the cap bites, say so.
  IF v_total > p_max_weeks THEN
    RAISE WARNING 'score_pools_pending: % week(s) pending, scoring the % most recent; % deferred to the next run',
      v_total, p_max_weeks, v_total - p_max_weeks;
    v_weeks := v_weeks[1:p_max_weeks];
  END IF;

  FOREACH w IN ARRAY v_weeks LOOP
    RETURN QUERY
      SELECT w, a.league_id, a.league_name, a.pool_type, a.scored_count
      FROM public.score_all_pools_for_week(w) a;
  END LOOP;
  RETURN;
END $$;


ALTER FUNCTION "public"."score_pools_pending"("p_max_weeks" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."score_pools_pending"("p_max_weeks" integer) IS 'Nightly pool scorer. Scores every week that still holds unscored picks, so a missed night self-heals. Winners derive from nhl_games; results are never supplied by a caller.';



CREATE OR REPLACE FUNCTION "public"."score_survivor_week"("p_league_id" "uuid", "p_week_number" integer) RETURNS TABLE("selection_id" "uuid", "user_id" "uuid", "picked_team" "text", "is_correct" boolean, "record" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sel RECORD; v_won BOOLEAN; v_scored INT := 0; v_week_start DATE; v_week_end DATE; v_wins INT; v_losses INT; v_total INT;
BEGIN
  SELECT wd.week_start, wd.week_end INTO v_week_start, v_week_end FROM get_pool_week_dates(p_week_number) wd;
  FOR v_sel IN
    SELECT ss.id, ss.user_id, ss.picked_team FROM survivor_selections ss
    WHERE ss.league_id = p_league_id AND ss.week_number = p_week_number AND ss.is_correct IS NULL
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE (ng.home_team = v_sel.picked_team AND ng.home_score > ng.away_score) OR (ng.away_team = v_sel.picked_team AND ng.away_score > ng.home_score)),
      COUNT(*) FILTER (WHERE (ng.home_team = v_sel.picked_team AND ng.home_score < ng.away_score) OR (ng.away_team = v_sel.picked_team AND ng.away_score < ng.home_score)),
      COUNT(*)
    INTO v_wins, v_losses, v_total
    FROM nhl_games ng WHERE ng.game_date >= v_week_start AND ng.game_date <= v_week_end AND ng.status = 'final'
      AND (ng.home_team = v_sel.picked_team OR ng.away_team = v_sel.picked_team);
    IF v_total > 0 THEN
      v_won := v_wins >= v_losses;
      UPDATE survivor_selections SET is_correct = v_won WHERE id = v_sel.id;
      v_scored := v_scored + 1;
      RETURN QUERY SELECT v_sel.id, v_sel.user_id, v_sel.picked_team, v_won, (v_wins || '-' || v_losses)::TEXT;
    END IF;
  END LOOP;
  RETURN;
END;
$$;


ALTER FUNCTION "public"."score_survivor_week"("p_league_id" "uuid", "p_week_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_xg_sql"("p_season" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n bigint;
begin
  with q as (
    select game_id, event_id, fold_id,
      case when f_en_for then 'E|'||dbc else 'G|'||db||'|'||ab end as k1,
      case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type end as k2,
      case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type||'|'||ctx end as k3,
      case when f_en_for then 'E|'||dbc||'|'||ctx else 'G|'||db||'|'||ab||'|'||f_type||'|'||ctx||'|'||strc end as k4
    from nhl_xg_sql_keys where season = p_season
  ),
  m as (
    select q.game_id, q.event_id,
      coalesce(c4.rate, c3.rate, c2.rate, c1.rate, c0.rate) as xg
    from q
    join      nhl_xg_sql_cells c0 on c0.fold=q.fold_id and c0.lvl=0 and c0.ckey='ALL'
    left join nhl_xg_sql_cells c1 on c1.fold=q.fold_id and c1.lvl=1 and c1.ckey=q.k1
    left join nhl_xg_sql_cells c2 on c2.fold=q.fold_id and c2.lvl=2 and c2.ckey=q.k2
    left join nhl_xg_sql_cells c3 on c3.fold=q.fold_id and c3.lvl=3 and c3.ckey=q.k3
    left join nhl_xg_sql_cells c4 on c4.fold=q.fold_id and c4.lvl=4 and c4.ckey=q.k4
  )
  update nhl_shots t set xg_sql = m.xg
  from m where t.game_id=m.game_id and t.event_id=m.event_id;
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."score_xg_sql"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_xg_sql_v2"("p_season" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n bigint; use_prod boolean := (p_season < 2017 or p_season > 2025);
begin
  with q as (
    select k.game_id, k.event_id, case when use_prod then 20 else coalesce(fo.fold_id,20) end as slot,
           k.k1, k.k2, k.k3, k.k4, k.k5
    from nhl_xg_sql_keys k
    left join nhl_shot_fold fo on fo.game_id=k.game_id and fo.event_id=k.event_id
    where k.season = p_season
  ),
  m as (
    select q.game_id, q.event_id, coalesce(c5.rate,c4.rate,c3.rate,c2.rate,c1.rate,c0.rate) xg
    from q
    join      nhl_xg_sql_cells c0 on c0.fold=q.slot and c0.lvl=0 and c0.ckey='ALL'
    left join nhl_xg_sql_cells c1 on c1.fold=q.slot and c1.lvl=1 and c1.ckey=q.k1
    left join nhl_xg_sql_cells c2 on c2.fold=q.slot and c2.lvl=2 and c2.ckey=q.k2
    left join nhl_xg_sql_cells c3 on c3.fold=q.slot and c3.lvl=3 and c3.ckey=q.k3
    left join nhl_xg_sql_cells c4 on c4.fold=q.slot and c4.lvl=4 and c4.ckey=q.k4
    left join nhl_xg_sql_cells c5 on c5.fold=q.slot and c5.lvl=5 and c5.ckey=q.k5
  )
  update nhl_shots t set xg_sql = m.xg
  from m where t.game_id=m.game_id and t.event_id=m.event_id and t.xg_sql is distinct from m.xg;
  get diagnostics n = row_count; return n;
end $$;


ALTER FUNCTION "public"."score_xg_sql_v2"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scoring_rules_to_jsonb"("p_league_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'skater', coalesce(jsonb_object_agg(c.stat_key, r.multiplier)
                       filter (where c.applies_to = 'skater'), '{}'::jsonb),
    'goalie', coalesce(jsonb_object_agg(c.stat_key, r.multiplier)
                       filter (where c.applies_to = 'goalie'), '{}'::jsonb))
    from public.get_effective_scoring_rules(p_league_id) r
    join public.stat_catalog c on c.stat_key = r.stat_key;
$$;


ALTER FUNCTION "public"."scoring_rules_to_jsonb"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_faab_budgets_for_league"("p_league_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_budget numeric; v_added int;
BEGIN
  SELECT coalesce((l.settings->>'faabBudget')::numeric, 100) INTO v_budget
    FROM public.leagues l WHERE l.id = p_league_id;
  IF v_budget IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.faab_budgets (league_id, team_id, initial_budget, remaining_budget, updated_at)
  SELECT p_league_id, t.id, v_budget,
         -- respect money already spent on successful claims
         greatest(0, v_budget - coalesce((
           SELECT sum(coalesce(wc.bid_amount,0)) FROM public.waiver_claims wc
            WHERE wc.league_id = p_league_id AND wc.team_id = t.id AND wc.status = 'successful'), 0)),
         now()
    FROM public.teams t
   WHERE t.league_id = p_league_id
     AND NOT EXISTS (SELECT 1 FROM public.faab_budgets fb
                      WHERE fb.league_id = p_league_id AND fb.team_id = t.id);
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$$;


ALTER FUNCTION "public"."seed_faab_budgets_for_league"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."seed_faab_budgets_for_league"("p_league_id" "uuid") IS 'Creates a faab_budgets row for every team in a league that lacks one, at the league''s configured faabBudget less anything already spent on successful claims. Idempotent; never lowers an existing budget row.';



CREATE OR REPLACE FUNCTION "public"."seed_waiver_priority_for_league"("p_league_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_added INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('waiver_priority:' || p_league_id::TEXT));

  INSERT INTO waiver_priority (league_id, team_id, priority, updated_at)
  SELECT p_league_id, t.id,
         (SELECT COALESCE(MAX(wp.priority), 0)
            FROM waiver_priority wp WHERE wp.league_id = p_league_id)
         + ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.id ASC),
         NOW()
  FROM teams t
  WHERE t.league_id = p_league_id
    AND NOT EXISTS (SELECT 1 FROM waiver_priority wp
                     WHERE wp.league_id = p_league_id AND wp.team_id = t.id);
  GET DIAGNOSTICS v_added = ROW_COUNT;

  IF v_added > 0 THEN PERFORM public.renumber_waiver_priority(p_league_id); END IF;
  RETURN v_added;
END $$;


ALTER FUNCTION "public"."seed_waiver_priority_for_league"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_league_chat_message"("p_league_id" "uuid", "p_message" "text", "p_sender_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_sender_id uuid;
  v_sender_username text;
  v_team_name text;
  v_league_member_id uuid;
  v_notifications_created integer := 0;
  v_result jsonb;
begin
  -- Get authenticated user
  v_sender_id := auth.uid();
  if v_sender_id is null then
    return jsonb_build_object('success', false, 'error', 'Authentication required');
  end if;

  -- Verify sender is a member of the league
  if not exists (
    select 1 from public.leagues
    where id = p_league_id
    and (
      commissioner_id = v_sender_id or
      exists (
        select 1 from public.teams
        where league_id = p_league_id
        and owner_id = v_sender_id
      )
    )
  ) then
    return jsonb_build_object('success', false, 'error', 'You are not a member of this league');
  end if;

  -- Get sender name
  if p_sender_name is null or p_sender_name = '' then
    -- Try to get username from profile
    select username, default_team_name into v_sender_username, v_team_name
    from public.profiles
    where id = v_sender_id;
    
    v_sender_username := coalesce(v_sender_username, v_team_name, 'Someone');
  else
    v_sender_username := p_sender_name;
  end if;

  -- Validate message
  if p_message is null or trim(p_message) = '' then
    return jsonb_build_object('success', false, 'error', 'Message cannot be empty');
  end if;

  -- Create notifications for all league members
  for v_league_member_id in
    select distinct t.owner_id
    from public.teams t
    where t.league_id = p_league_id
      and t.owner_id is not null
  loop
    insert into public.notifications (
      league_id,
      user_id,
      type,
      title,
      message,
      metadata,
      read_status,
      read_at
    ) values (
      p_league_id,
      v_league_member_id,
      'CHAT',
      v_sender_username || ' sent a message',
      trim(p_message),
      jsonb_build_object(
        'sender_id', v_sender_id,
        'sender_name', v_sender_username
      ),
      v_league_member_id = v_sender_id, -- Mark as read for sender
      case when v_league_member_id = v_sender_id then now() else null end
    );
    v_notifications_created := v_notifications_created + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'notifications_created', v_notifications_created,
    'message', 'Chat message sent successfully'
  );
end;
$$;


ALTER FUNCTION "public"."send_league_chat_message"("p_league_id" "uuid", "p_message" "text", "p_sender_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shares_league_with"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t1
      JOIN public.teams t2 ON t1.league_id = t2.league_id
     WHERE t1.owner_id = auth.uid() AND t2.owner_id = p_user
  ) OR EXISTS (
    SELECT 1 FROM public.leagues l
      JOIN public.teams t ON t.league_id = l.id
     WHERE t.owner_id = auth.uid() AND l.commissioner_id = p_user
  );
$$;


ALTER FUNCTION "public"."shares_league_with"("p_user" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."shares_league_with"("p_user" "uuid") IS 'SECURITY DEFINER so the membership lookup escapes RLS on teams/leagues. Required by the profiles league-scoped SELECT policy: a raw subquery there is filtered by the caller''s own visibility of teams and silently hides leaguemates in leagues they do not commission.';



CREATE OR REPLACE FUNCTION "public"."should_process_waivers_now"() RETURNS TABLE("league_id" "uuid", "league_name" "text", "waiver_process_time" time without time zone, "current_time_est" time without time zone, "should_process" boolean)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."should_process_waivers_now"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("team_name" "text", "starters_count" integer, "bench_count" integer, "ir_count" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_team_record RECORD;
  v_result RECORD;
BEGIN
  RAISE NOTICE '[SMART_RESTORE_ALL] Starting batch restore for league %', 
    COALESCE(p_league_id::TEXT, 'ALL leagues');
  
  FOR v_team_record IN
    SELECT t.id, t.team_name, t.league_id
    FROM teams t
    WHERE (p_league_id IS NULL OR t.league_id = p_league_id)
    ORDER BY t.team_name
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE 'Processing: %', v_team_record.team_name;
    
    -- Run smart restore for this team
    SELECT * INTO v_result
    FROM smart_restore_team_lineups(v_team_record.id);
    
    RETURN QUERY
    SELECT 
      v_team_record.team_name,
      v_result.starters_count,
      v_result.bench_count,
      v_result.ir_count;
    
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '[SMART_RESTORE_ALL] Batch restore complete';
  
END;
$$;


ALTER FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid") IS 'Runs smart_restore on all teams in a league (or all teams if league_id is NULL).
Usage: SELECT * FROM smart_restore_all_teams(''league-uuid'');
       SELECT * FROM smart_restore_all_teams(); -- All leagues';



CREATE OR REPLACE FUNCTION "public"."smart_restore_team_lineups"("p_team_id" "uuid") RETURNS TABLE("starters_count" integer, "bench_count" integer, "ir_count" integer, "success" boolean, "message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_player_record RECORD;
  v_starters INTEGER[] := ARRAY[]::INTEGER[];
  v_bench INTEGER[] := ARRAY[]::INTEGER[];
  v_ir INTEGER[] := ARRAY[]::INTEGER[];
  v_slot_assignments JSONB := '{}'::JSONB;
  v_c_count INT := 0;
  v_lw_count INT := 0;
  v_rw_count INT := 0;
  v_d_count INT := 0;
  v_g_count INT := 0;
  v_util_count INT := 0;
  v_ir_count INT := 0;
  v_league_id UUID;
BEGIN
  RAISE NOTICE '[SMART_RESTORE] Starting smart restore for team %', p_team_id;
  
  -- Get league_id for this team
  SELECT t.league_id INTO v_league_id
  FROM teams t
  WHERE t.id = p_team_id;
  
  IF v_league_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, false, 'Team not found';
    RETURN;
  END IF;
  
  -- ========================================================================
  -- STEP 1: Get all owned players with stats, sorted by fantasy points
  -- ========================================================================
  FOR v_player_record IN
    SELECT 
      dp.player_id::INTEGER as player_id,
      p.full_name,
      p.position,
      p.status,
      p.points as fantasy_points,
      CASE 
        WHEN p.position IN ('C', 'Centre', 'Center') THEN 'C'
        WHEN p.position IN ('LW', 'L', 'Left Wing') THEN 'LW'
        WHEN p.position IN ('RW', 'R', 'Right Wing') THEN 'RW'
        WHEN p.position IN ('D', 'Defence', 'Defense') THEN 'D'
        WHEN p.position IN ('G', 'Goalie') THEN 'G'
        ELSE 'UTIL'
      END as mapped_position
    FROM draft_picks dp
    JOIN players p ON p.id = dp.player_id::INTEGER
    WHERE dp.team_id = p_team_id
      AND dp.deleted_at IS NULL
    ORDER BY p.points DESC NULLS LAST, dp.pick_number ASC
  LOOP
    -- ======================================================================
    -- STEP 2: Smart slot assignment
    -- ======================================================================
    
    -- IR/SUSP players go to IR (if room)
    IF (v_player_record.status = 'IR' OR v_player_record.status = 'SUSP') AND v_ir_count < 3 THEN
      v_ir := array_append(v_ir, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'ir-slot-' || (v_ir_count + 1));
      v_ir_count := v_ir_count + 1;
      RAISE NOTICE '  [IR] % (%) → IR slot %', 
        v_player_record.full_name, v_player_record.player_id, v_ir_count;
    
    -- Centers (fill position-specific slots first)
    ELSIF v_player_record.mapped_position = 'C' AND v_c_count < 2 THEN
      v_starters := array_append(v_starters, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'slot-C-' || (v_c_count + 1));
      v_c_count := v_c_count + 1;
      RAISE NOTICE '  [STARTER] % (%) → C slot %, pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_c_count, v_player_record.fantasy_points;
    
    -- Left Wings
    ELSIF v_player_record.mapped_position = 'LW' AND v_lw_count < 2 THEN
      v_starters := array_append(v_starters, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'slot-LW-' || (v_lw_count + 1));
      v_lw_count := v_lw_count + 1;
      RAISE NOTICE '  [STARTER] % (%) → LW slot %, pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_lw_count, v_player_record.fantasy_points;
    
    -- Right Wings
    ELSIF v_player_record.mapped_position = 'RW' AND v_rw_count < 2 THEN
      v_starters := array_append(v_starters, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'slot-RW-' || (v_rw_count + 1));
      v_rw_count := v_rw_count + 1;
      RAISE NOTICE '  [STARTER] % (%) → RW slot %, pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_rw_count, v_player_record.fantasy_points;
    
    -- Defensemen
    ELSIF v_player_record.mapped_position = 'D' AND v_d_count < 4 THEN
      v_starters := array_append(v_starters, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'slot-D-' || (v_d_count + 1));
      v_d_count := v_d_count + 1;
      RAISE NOTICE '  [STARTER] % (%) → D slot %, pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_d_count, v_player_record.fantasy_points;
    
    -- Goalies
    ELSIF v_player_record.mapped_position = 'G' AND v_g_count < 2 THEN
      v_starters := array_append(v_starters, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'slot-G-' || (v_g_count + 1));
      v_g_count := v_g_count + 1;
      RAISE NOTICE '  [STARTER] % (%) → G slot %, pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_g_count, v_player_record.fantasy_points;
    
    -- UTIL slot (non-goalies only, best remaining player)
    ELSIF v_player_record.mapped_position != 'G' AND v_util_count < 1 THEN
      v_starters := array_append(v_starters, v_player_record.player_id);
      v_slot_assignments := v_slot_assignments || 
        jsonb_build_object(v_player_record.player_id::text, 'slot-UTIL');
      v_util_count := v_util_count + 1;
      RAISE NOTICE '  [STARTER] % (%) → UTIL, pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_player_record.fantasy_points;
    
    -- Bench (everyone else)
    ELSE
      v_bench := array_append(v_bench, v_player_record.player_id);
      RAISE NOTICE '  [BENCH] % (%), pts:%', 
        v_player_record.full_name, v_player_record.player_id, v_player_record.fantasy_points;
    END IF;
    
  END LOOP;
  
  -- ========================================================================
  -- STEP 3: Save the organized lineup
  -- ========================================================================
  INSERT INTO team_lineups (
    league_id,
    team_id,
    starters,
    bench,
    ir,
    slot_assignments,
    updated_at
  )
  VALUES (
    v_league_id,
    p_team_id,
    to_jsonb(v_starters),
    to_jsonb(v_bench),
    to_jsonb(v_ir),
    v_slot_assignments,
    NOW()
  )
  ON CONFLICT (team_id) DO UPDATE
  SET
    starters = EXCLUDED.starters,
    bench = EXCLUDED.bench,
    ir = EXCLUDED.ir,
    slot_assignments = EXCLUDED.slot_assignments,
    updated_at = NOW();
  
  -- ========================================================================
  -- RETURN RESULTS
  -- ========================================================================
  RETURN QUERY
  SELECT 
    array_length(v_starters, 1)::INTEGER,
    array_length(v_bench, 1)::INTEGER,
    array_length(v_ir, 1)::INTEGER,
    true,
    'Smart restore complete: ' || 
      array_length(v_starters, 1)::TEXT || ' starters, ' ||
      array_length(v_bench, 1)::TEXT || ' bench, ' ||
      array_length(v_ir, 1)::TEXT || ' IR'::TEXT;
  
END;
$$;


ALTER FUNCTION "public"."smart_restore_team_lineups"("p_team_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."smart_restore_team_lineups"("p_team_id" "uuid") IS 'Intelligently organizes a team''s roster from draft_picks.
Auto-fills position slots based on player stats and positions.
Priority: highest fantasy points → starters.
Usage: SELECT * FROM smart_restore_team_lineups(''team-uuid'');';



CREATE OR REPLACE FUNCTION "public"."submit_trade_vote"("p_trade_offer_id" "uuid", "p_voter_team_id" "uuid", "p_vote" "text") RETURNS TABLE("success" boolean, "message" "text", "veto_count" integer, "approve_count" integer, "votes_needed" integer, "is_vetoed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."submit_trade_vote"("p_trade_offer_id" "uuid", "p_voter_team_id" "uuid", "p_vote" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_goalie_decisions"("p_season" integer) RETURNS TABLE("o_metric" "text", "o_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r bigint;
begin
  drop table if exists _dec;
  create temp table _dec as
  select rr.game_id, (g->>'playerId')::int as pid, g->>'decision' as dec
  from raw_nhl_data rr,
       lateral (values ('away'),('home')) s(side),
       lateral jsonb_array_elements(rr.boxscore_json->'playerByGameStats'->(s.side||'Team')->'goalies') g
  where substr(rr.game_id::text,1,4)::int = p_season;
  create index on _dec (game_id, pid);

  update player_game_stats p
     set nhl_wins      = case when d.dec='W' then 1 else 0 end,
         nhl_losses    = case when d.dec='L' then 1 else 0 end,
         nhl_ot_losses = case when d.dec='O' then 1 else 0 end,
         wins          = case when d.dec='W' then 1 else 0 end,
         updated_at    = now()
    from _dec d
   where p.game_id = d.game_id and p.player_id = d.pid and p.is_goalie
     and (coalesce(p.nhl_wins,0)      <> case when d.dec='W' then 1 else 0 end
       or coalesce(p.nhl_losses,0)    <> case when d.dec='L' then 1 else 0 end
       or coalesce(p.nhl_ot_losses,0) <> case when d.dec='O' then 1 else 0 end
       or coalesce(p.wins,0)          <> case when d.dec='W' then 1 else 0 end);
  get diagnostics r = row_count;
  o_metric := 'rows_corrected'; o_count := r; return next;

  select count(*) into r from _dec d
    join player_game_stats p on p.game_id=d.game_id and p.player_id=d.pid and p.is_goalie
   where coalesce(p.nhl_wins,0)      <> case when d.dec='W' then 1 else 0 end
      or coalesce(p.nhl_losses,0)    <> case when d.dec='L' then 1 else 0 end
      or coalesce(p.nhl_ot_losses,0) <> case when d.dec='O' then 1 else 0 end;
  o_metric := 'residual_mismatches_after'; o_count := r; return next;

  select count(*) into r from _dec where dec is not null;
  o_metric := 'boxscore_decisions_seen'; o_count := r; return next;
end $$;


ALTER FUNCTION "public"."sync_goalie_decisions"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_goalie_shutouts"("p_season" integer) RETURNS TABLE("o_metric" "text", "o_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r bigint;
begin
  drop table if exists _so;
  create temp table _so as
  select p.game_id, p.player_id,
         case when coalesce(p.nhl_goals_against,0) = 0
               and coalesce(p.nhl_toi_seconds,0) > 0
               and (select count(*) from player_game_stats q
                     where q.game_id = p.game_id and q.is_goalie
                       and q.team_abbrev = p.team_abbrev
                       and coalesce(q.nhl_toi_seconds,0) > 0) = 1
              then 1 else 0 end as so
  from player_game_stats p
  where p.season = p_season and p.is_goalie;
  create index on _so (game_id, player_id);

  update player_game_stats p set nhl_shutouts = s.so, shutouts = s.so, updated_at = now()
    from _so s
   where p.game_id = s.game_id and p.player_id = s.player_id
     and (coalesce(p.nhl_shutouts,0) <> s.so or coalesce(p.shutouts,0) <> s.so);
  get diagnostics r = row_count;
  o_metric := 'rows_corrected'; o_count := r; return next;

  select count(*) into r from player_game_stats p
   where p.season = p_season and p.is_goalie and coalesce(p.nhl_shutouts,0) = 1;
  o_metric := 'shutouts_after'; o_count := r; return next;
end $$;


ALTER FUNCTION "public"."sync_goalie_shutouts"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_new_team_lineup_to_daily_rosters"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
BEGIN
  IF NEW.league_id IS NULL OR NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find current or most recent in-progress matchup for this team
  SELECT m.id, m.week_start_date, m.week_end_date
  INTO v_matchup_id, v_week_start, v_week_end
  FROM matchups m
  WHERE m.league_id = NEW.league_id
    AND (m.team1_id = NEW.team_id OR m.team2_id = NEW.team_id)
    AND m.week_end_date >= v_today
  ORDER BY m.week_start_date ASC
  LIMIT 1;

  IF v_matchup_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- INSERT starters for ALL dates in the week (including past)
  INSERT INTO fantasy_daily_rosters (
    league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
  )
  SELECT
    NEW.league_id,
    NEW.team_id,
    v_matchup_id,
    (jsonb_array_elements_text(NEW.starters)::integer),
    d.roster_date,
    'active',
    NEW.slot_assignments->>(jsonb_array_elements_text(NEW.starters)::text),
    d.roster_date < v_today  -- Lock past dates
  FROM generate_series(v_week_start, v_week_end, '1 day'::interval) AS d(roster_date)
  WHERE NEW.starters IS NOT NULL
    AND jsonb_array_length(NEW.starters) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

  -- INSERT bench for ALL dates
  INSERT INTO fantasy_daily_rosters (
    league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
  )
  SELECT
    NEW.league_id,
    NEW.team_id,
    v_matchup_id,
    (jsonb_array_elements_text(NEW.bench)::integer),
    d.roster_date,
    'bench',
    NULL,
    d.roster_date < v_today
  FROM generate_series(v_week_start, v_week_end, '1 day'::interval) AS d(roster_date)
  WHERE NEW.bench IS NOT NULL
    AND jsonb_array_length(NEW.bench) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

  -- INSERT IR for ALL dates
  INSERT INTO fantasy_daily_rosters (
    league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
  )
  SELECT
    NEW.league_id,
    NEW.team_id,
    v_matchup_id,
    (jsonb_array_elements_text(NEW.ir)::integer),
    d.roster_date,
    'ir',
    NEW.slot_assignments->>(jsonb_array_elements_text(NEW.ir)::text),
    d.roster_date < v_today
  FROM generate_series(v_week_start, v_week_end, '1 day'::interval) AS d(roster_date)
  WHERE NEW.ir IS NOT NULL
    AND jsonb_array_length(NEW.ir) > 0
  ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_new_team_lineup_to_daily_rosters"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_playoff_scores"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_series RECORD;
BEGIN
  -- Only sync if scores actually changed
  IF OLD.team1_score = NEW.team1_score AND OLD.team2_score = NEW.team2_score THEN
    RETURN NEW;
  END IF;

  -- Find any playoff series that reference this matchup's week
  FOR v_series IN
    SELECT ps.id, ps.home_team_id, ps.away_team_id,
           ps.matchup_week_1, ps.matchup_week_2
    FROM public.playoff_series ps
    JOIN public.playoff_brackets pb ON pb.id = ps.bracket_id
    WHERE pb.league_id = NEW.league_id
      AND pb.status = 'active'
      AND ps.status = 'active'
      AND (ps.matchup_week_1 = NEW.week_number OR ps.matchup_week_2 = NEW.week_number)
      AND ps.home_team_id IS NOT NULL
      AND ps.away_team_id IS NOT NULL
  LOOP
    -- Check if this matchup involves the playoff teams
    IF (NEW.team1_id = v_series.home_team_id AND NEW.team2_id = v_series.away_team_id) THEN
      -- For two-week matchups, aggregate both weeks
      IF v_series.matchup_week_2 IS NOT NULL THEN
        UPDATE public.playoff_series
        SET home_score = COALESCE((
          SELECT SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                         WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END)
          FROM matchups m
          WHERE m.league_id = NEW.league_id
            AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
            AND (m.team1_id = v_series.home_team_id OR m.team2_id = v_series.home_team_id)
        ), 0),
        away_score = COALESCE((
          SELECT SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                         WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END)
          FROM matchups m
          WHERE m.league_id = NEW.league_id
            AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
            AND (m.team1_id = v_series.away_team_id OR m.team2_id = v_series.away_team_id)
        ), 0),
        updated_at = NOW()
        WHERE id = v_series.id;
      ELSE
        -- Single-week matchup: direct score copy
        UPDATE public.playoff_series
        SET home_score = NEW.team1_score,
            away_score = NEW.team2_score,
            updated_at = NOW()
        WHERE id = v_series.id;
      END IF;
    ELSIF (NEW.team1_id = v_series.away_team_id AND NEW.team2_id = v_series.home_team_id) THEN
      -- Teams reversed in matchup vs playoff series
      IF v_series.matchup_week_2 IS NOT NULL THEN
        UPDATE public.playoff_series
        SET home_score = COALESCE((
          SELECT SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                         WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END)
          FROM matchups m
          WHERE m.league_id = NEW.league_id
            AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
            AND (m.team1_id = v_series.home_team_id OR m.team2_id = v_series.home_team_id)
        ), 0),
        away_score = COALESCE((
          SELECT SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                         WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END)
          FROM matchups m
          WHERE m.league_id = NEW.league_id
            AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
            AND (m.team1_id = v_series.away_team_id OR m.team2_id = v_series.away_team_id)
        ), 0),
        updated_at = NOW()
        WHERE id = v_series.id;
      ELSE
        UPDATE public.playoff_series
        SET home_score = NEW.team2_score,
            away_score = NEW.team1_score,
            updated_at = NOW()
        WHERE id = v_series.id;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_playoff_scores"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_roster_assignments_for_league"("p_league_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sync_roster_assignments_for_league"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_roster_assignments_for_league"("p_league_id" "uuid") IS 'Syncs roster_assignments from draft_picks for a specific league. Call after draft completion.';



CREATE OR REPLACE FUNCTION "public"."sync_rules_to_scoring_settings"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_league uuid := coalesce(new.league_id, old.league_id);
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if v_league = '00000000-0000-0000-0000-000000000000'::uuid then
    -- the global default row is inherited by every league without an override
    perform public.materialize_scoring_settings(l.id) from public.leagues l;
  else
    perform public.materialize_scoring_settings(v_league);
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."sync_rules_to_scoring_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_scoring_settings_to_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
begin
  if new.scoring_settings is null
     or new.scoring_settings is not distinct from old.scoring_settings then
    return new;
  end if;

  insert into public.league_scoring_rules (league_id, stat_key, multiplier, updated_at)
  select new.id, c.stat_key,
         (new.scoring_settings->c.applies_to->>c.stat_key)::numeric, now()
    from public.stat_catalog c
   where new.scoring_settings->c.applies_to ? c.stat_key
     and (new.scoring_settings->c.applies_to->>c.stat_key) ~ '^-?[0-9]+(\.[0-9]+)?$'
  on conflict (league_id, stat_key)
    do update set multiplier = excluded.multiplier, updated_at = now();

  return new;
end;
$_$;


ALTER FUNCTION "public"."sync_scoring_settings_to_rules"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_scoring_settings_to_rules"() IS 'Keeps league_scoring_rules in step with the legacy leagues.scoring_settings JSONB, so the existing commissioner Scoring tab still affects scoring after the engine moved to the rules table.';



CREATE OR REPLACE FUNCTION "public"."tg_reseed_waiver_priority_on_setting_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_res jsonb;
BEGIN
  IF coalesce(OLD.waiver_type,'rolling') IS DISTINCT FROM coalesce(NEW.waiver_type,'rolling') THEN
    v_res := public.reseed_waiver_priority_for_league(NEW.id);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
      -- Do not fail the settings save; make the skip visible instead.
      INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
      VALUES (now(), 'waiver_order_reseed', 'warning',
              left('league '||NEW.id::text||' switched '||coalesce(OLD.waiver_type,'rolling')
                   ||' -> '||coalesce(NEW.waiver_type,'rolling')||' but the order was NOT reseeded: '
                   ||coalesce(v_res->>'error','unknown'), 900), false);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_reseed_waiver_priority_on_setting_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_seed_faab_budgets"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'leagues' THEN
    IF coalesce(NEW.waiver_type,'') = 'faab'
       AND coalesce(OLD.waiver_type,'') IS DISTINCT FROM 'faab' THEN
      PERFORM public.seed_faab_budgets_for_league(NEW.id);
    END IF;
  ELSE  -- teams
    IF EXISTS (SELECT 1 FROM public.leagues l
                WHERE l.id = NEW.league_id AND coalesce(l.waiver_type,'') = 'faab') THEN
      PERFORM public.seed_faab_budgets_for_league(NEW.league_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_seed_faab_budgets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_seed_waiver_priority_for_new_team"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Serialise concurrent joins in the same league so two teams cannot compute
  -- the same MAX+1 and collide on UNIQUE (league_id, priority).
  PERFORM pg_advisory_xact_lock(hashtext('waiver_priority:' || NEW.league_id::TEXT));

  INSERT INTO waiver_priority (league_id, team_id, priority, updated_at)
  VALUES (NEW.league_id, NEW.id,
          (SELECT COALESCE(MAX(priority), 0) + 1
             FROM waiver_priority WHERE league_id = NEW.league_id),
          NOW())
  ON CONFLICT (league_id, team_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  -- Never fail a league join over waiver bookkeeping. process_waiver_claims
  -- self-heals before every run, so a missed row is recoverable; a failed
  -- team INSERT is not. Only the priority-collision case is swallowed --
  -- anything else still propagates.
  WHEN unique_violation THEN RETURN NEW;
END $$;


ALTER FUNCTION "public"."tg_seed_waiver_priority_for_new_team"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_move_player_lineup"("p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_pid" "text", "p_now" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.team_lineups SET
    starters = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                  FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem WHERE elem <> p_pid),
    bench    = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                  FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem WHERE elem <> p_pid),
    ir       = (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                  FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem WHERE elem <> p_pid),
    slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_pid,
    updated_at = p_now
  WHERE league_id = p_league_id AND team_id = p_from_team_id;

  -- Arrives on the bench; the manager sets lineups.
  UPDATE public.team_lineups
     SET bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_pid), updated_at = p_now
   WHERE league_id = p_league_id AND team_id = p_to_team_id;

  INSERT INTO public.team_lineups (league_id, team_id, bench, starters, ir, slot_assignments, updated_at)
  VALUES (p_league_id, p_to_team_id, jsonb_build_array(p_pid), '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, p_now)
  ON CONFLICT (league_id, team_id) DO NOTHING;

  UPDATE public.draft_picks SET team_id = p_to_team_id
   WHERE league_id = p_league_id AND team_id = p_from_team_id
     AND player_id = p_pid AND deleted_at IS NULL;
END $$;


ALTER FUNCTION "public"."trade_move_player_lineup"("p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_pid" "text", "p_now" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unpack_and_gate_season"("p_season" integer) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_g int; v_r int; v_box int; v_pbp int; v_pts int; v_ga int;
        v_bad text; v_nbad int; v_tol numeric;
BEGIN
  SELECT games_done, rows_written INTO v_g, v_r FROM public.unpack_boxscore_season(p_season);

  SELECT sum(nhl_goals), sum(nhl_points), sum(nhl_goals)+sum(nhl_assists)
    INTO v_box, v_pts, v_ga
    FROM public.player_game_stats WHERE season = p_season;

  SELECT coalesce(sum(jsonb_array_length(jsonb_path_query_array(raw_json,
      '$.plays[*] ? (@.typeCode == 505 && @.periodDescriptor.periodType != "SO")'))),0)
    INTO v_pbp FROM public.raw_nhl_data
   WHERE substring(game_id::text from 1 for 4)::int = p_season;

  -- points identity is OURS and must be exact
  IF v_pts <> v_ga THEN
    RAISE EXCEPTION 'season % points identity FAILED: points=% goals+assists=%',
      p_season, v_pts, v_ga;
  END IF;

  -- enumerate every game where the two official documents disagree
  WITH pbp AS (
    SELECT game_id, jsonb_array_length(jsonb_path_query_array(raw_json,
      '$.plays[*] ? (@.typeCode == 505 && @.periodDescriptor.periodType != "SO")')) AS g
      FROM public.raw_nhl_data
     WHERE substring(game_id::text from 1 for 4)::int = p_season
  ), box AS (
    SELECT game_id, sum(nhl_goals)::int AS g FROM public.player_game_stats
     WHERE season = p_season GROUP BY game_id
  ), diff AS (
    SELECT p.game_id, p.g AS pbp_g, coalesce(b.g,0) AS box_g
      FROM pbp p LEFT JOIN box b USING (game_id)
     WHERE p.g <> coalesce(b.g,0)
  )
  SELECT count(*), string_agg(game_id || '(pbp' || pbp_g || '/box' || box_g || ')', ',' ORDER BY game_id)
    INTO v_nbad, v_bad FROM diff;

  v_tol := greatest(3, ceil(v_pbp * 0.0005));
  IF abs(v_box - v_pbp) > v_tol THEN
    PERFORM public.record_rebuild_audit(p_season, 'boxscore_goal_parity', v_pbp, v_box,
      format('FAIL delta=%s over tol=%s; discrepant games: %s',
             v_box - v_pbp, v_tol, left(coalesce(v_bad,'none'), 600)));
    RAISE EXCEPTION 'season % goal parity FAILED beyond tolerance: box=% pbp=% games=%',
      p_season, v_box, v_pbp, left(coalesce(v_bad,'none'), 300);
  END IF;

  PERFORM public.record_rebuild_audit(p_season, 'boxscore_goal_parity', v_pbp, v_box,
    format('%s games, %s player rows; delta=%s within tol=%s; upstream-discrepant games (%s): %s',
           v_g, v_r, v_box - v_pbp, v_tol, v_nbad, left(coalesce(v_bad,'none'), 500)));

  RETURN format('season %s OK: %s games, %s rows, box=%s pbp=%s (delta %s, %s discrepant games), %s points',
                p_season, v_g, v_r, v_box, v_pbp, v_box - v_pbp, v_nbad, v_pts);
END $_$;


ALTER FUNCTION "public"."unpack_and_gate_season"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unpack_boxscore_season"("p_season" integer) RETURNS TABLE("games_done" integer, "rows_written" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_games int; v_rows int;
BEGIN
  WITH src AS (
    SELECT d.game_id, d.boxscore_json AS bx,
           (d.boxscore_json->>'gameDate')::date AS gdate,
           coalesce((d.boxscore_json->'gameOutcome'->>'lastPeriodType'),'REG') AS last_period,
           (d.boxscore_json->'homeTeam'->>'score')::int AS h_score,
           (d.boxscore_json->'awayTeam'->>'score')::int AS a_score
      FROM public.raw_nhl_data d
     WHERE substring(d.game_id::text from 1 for 4)::int = p_season
       AND d.boxscore_json IS NOT NULL
  ), sides AS (
    SELECT s.*, side.k AS side, (s.bx->side.k->>'abbrev') AS team_abbrev,
           CASE WHEN side.k='homeTeam' THEN s.h_score > s.a_score
                ELSE s.a_score > s.h_score END AS team_won
      FROM src s CROSS JOIN LATERAL (VALUES ('homeTeam'),('awayTeam')) AS side(k)
  ), players AS (
    SELECT sd.game_id, sd.gdate, sd.team_abbrev, sd.team_won, sd.last_period,
           grp.k AS grp, p AS pj
      FROM sides sd
      CROSS JOIN LATERAL (VALUES ('forwards'),('defense'),('goalies')) AS grp(k)
      CROSS JOIN LATERAL jsonb_array_elements(
             coalesce(sd.bx->'playerByGameStats'->sd.side->grp.k, '[]'::jsonb)) AS p
  ), typed AS (
    SELECT game_id, gdate, team_abbrev, team_won, last_period,
           (grp = 'goalies') AS is_goalie,
           (pj->>'playerId')::int AS player_id,
           nullif(pj->>'position','') AS position_code,
           coalesce((pj->>'goals')::int,0) AS goals,
           coalesce((pj->>'assists')::int,0) AS assists,
           coalesce((pj->>'points')::int,0) AS points,
           coalesce((pj->>'sog')::int,0) AS sog,
           coalesce((pj->>'hits')::int,0) AS hits,
           coalesce((pj->>'blockedShots')::int,0) AS blocks,
           coalesce((pj->>'pim')::int,0) AS pim,
           coalesce((pj->>'powerPlayGoals')::int,0) AS ppg,
           coalesce((pj->>'plusMinus')::int,0) AS plus_minus,
           coalesce((pj->>'shifts')::int,0) AS shifts,
           coalesce((pj->>'giveaways')::int,0) AS giveaways,
           coalesce((pj->>'takeaways')::int,0) AS takeaways,
           coalesce(split_part(pj->>'toi',':',1)::int * 60
                  + split_part(pj->>'toi',':',2)::int, 0) AS toi_sec,
           coalesce((pj->>'saves')::int,0) AS saves,
           coalesce((pj->>'goalsAgainst')::int,0) AS ga,
           coalesce((pj->>'shotsAgainst')::int,0) AS sa,
           coalesce(split_part(pj->>'evenStrengthShotsAgainst','/',1)::int,0) AS ev_saves,
           coalesce(split_part(pj->>'evenStrengthShotsAgainst','/',2)::int,0) AS ev_sa,
           coalesce(split_part(pj->>'powerPlayShotsAgainst','/',1)::int,0) AS pp_saves,
           coalesce(split_part(pj->>'powerPlayShotsAgainst','/',2)::int,0) AS pp_sa,
           coalesce(split_part(pj->>'shorthandedShotsAgainst','/',1)::int,0) AS sh_saves,
           coalesce(split_part(pj->>'shorthandedShotsAgainst','/',2)::int,0) AS sh_sa
      FROM players
  ), dedup AS (
    SELECT DISTINCT ON (game_id, player_id) *
      FROM typed ORDER BY game_id, player_id, toi_sec DESC, is_goalie ASC
  ), decided AS (
    SELECT t.*,
           CASE WHEN t.is_goalie AND t.toi_sec > 0
                 AND t.toi_sec = max(t.toi_sec) FILTER (WHERE t.is_goalie)
                     OVER (PARTITION BY t.game_id, t.team_abbrev)
                THEN true ELSE false END AS is_record
      FROM dedup t
  ), ins AS (
    INSERT INTO public.player_game_stats AS pgs (
      season, game_id, game_date, player_id, team_abbrev, position_code, is_goalie,
      goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks,
      pim, ppp, shp, plus_minus, icetime_seconds,
      goalie_gp, wins, saves, shots_faced, goals_against, shutouts,
      nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks,
      nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds,
      nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced,
      nhl_goals_against, nhl_shutouts, nhl_faceoff_wins, nhl_faceoff_losses,
      nhl_takeaways, nhl_giveaways, nhl_ppg, nhl_ppa, nhl_shg, nhl_sha,
      nhl_shots_missed, nhl_shots_attempted, nhl_shifts, nhl_gwg, nhl_save_pct,
      nhl_pp_saves, nhl_sh_saves, nhl_faceoff_taken, nhl_shots_blocked,
      nhl_shot_attempts, nhl_otg, nhl_even_saves, nhl_even_shots_against,
      nhl_pp_shots_against, nhl_sh_shots_against, created_at, updated_at)
    SELECT p_season, d.game_id, d.gdate, d.player_id, d.team_abbrev, d.position_code, d.is_goalie,
      d.goals, 0, 0, d.points, d.sog, d.hits, d.blocks,
      d.pim, d.ppg, 0, d.plus_minus, d.toi_sec,
      CASE WHEN d.is_goalie AND d.toi_sec > 0 THEN 1 ELSE 0 END,
      CASE WHEN d.is_record AND d.team_won THEN 1 ELSE 0 END,
      d.saves, d.sa, d.ga,
      CASE WHEN d.is_record AND d.ga = 0 AND d.toi_sec >= 3000 THEN 1 ELSE 0 END,
      d.goals, d.assists, d.points, d.sog, d.hits, d.blocks,
      d.pim, d.ppg, 0, d.plus_minus, d.toi_sec,
      CASE WHEN d.is_record AND d.team_won THEN 1 ELSE 0 END,
      CASE WHEN d.is_record AND NOT d.team_won AND d.last_period='REG' THEN 1 ELSE 0 END,
      CASE WHEN d.is_record AND NOT d.team_won AND d.last_period<>'REG' THEN 1 ELSE 0 END,
      d.saves, d.sa, d.ga,
      CASE WHEN d.is_record AND d.ga = 0 AND d.toi_sec >= 3000 THEN 1 ELSE 0 END,
      0, 0, d.takeaways, d.giveaways, d.ppg, 0, 0, 0,
      0, d.sog, d.shifts, 0,
      CASE WHEN d.sa > 0 THEN round(d.saves::numeric / d.sa, 4) ELSE 0 END,
      d.pp_saves, d.sh_saves, 0, d.blocks, d.sog, 0,
      d.ev_saves, d.ev_sa, d.pp_sa, d.sh_sa, now(), now()
      FROM decided d
    ON CONFLICT (season, game_id, player_id) DO UPDATE SET
      game_date=EXCLUDED.game_date, team_abbrev=EXCLUDED.team_abbrev,
      position_code=EXCLUDED.position_code, is_goalie=EXCLUDED.is_goalie,
      goals=EXCLUDED.goals, points=EXCLUDED.points, shots_on_goal=EXCLUDED.shots_on_goal,
      hits=EXCLUDED.hits, blocks=EXCLUDED.blocks, pim=EXCLUDED.pim, ppp=EXCLUDED.ppp,
      plus_minus=EXCLUDED.plus_minus, icetime_seconds=EXCLUDED.icetime_seconds,
      goalie_gp=EXCLUDED.goalie_gp, wins=EXCLUDED.wins, saves=EXCLUDED.saves,
      shots_faced=EXCLUDED.shots_faced, goals_against=EXCLUDED.goals_against,
      shutouts=EXCLUDED.shutouts,
      nhl_goals=EXCLUDED.nhl_goals, nhl_assists=EXCLUDED.nhl_assists,
      nhl_points=EXCLUDED.nhl_points, nhl_shots_on_goal=EXCLUDED.nhl_shots_on_goal,
      nhl_hits=EXCLUDED.nhl_hits, nhl_blocks=EXCLUDED.nhl_blocks, nhl_pim=EXCLUDED.nhl_pim,
      nhl_ppp=EXCLUDED.nhl_ppp, nhl_plus_minus=EXCLUDED.nhl_plus_minus,
      nhl_toi_seconds=EXCLUDED.nhl_toi_seconds, nhl_wins=EXCLUDED.nhl_wins,
      nhl_losses=EXCLUDED.nhl_losses, nhl_ot_losses=EXCLUDED.nhl_ot_losses,
      nhl_saves=EXCLUDED.nhl_saves, nhl_shots_faced=EXCLUDED.nhl_shots_faced,
      nhl_goals_against=EXCLUDED.nhl_goals_against, nhl_shutouts=EXCLUDED.nhl_shutouts,
      nhl_takeaways=EXCLUDED.nhl_takeaways, nhl_giveaways=EXCLUDED.nhl_giveaways,
      nhl_ppg=EXCLUDED.nhl_ppg, nhl_shifts=EXCLUDED.nhl_shifts,
      nhl_save_pct=EXCLUDED.nhl_save_pct, nhl_pp_saves=EXCLUDED.nhl_pp_saves,
      nhl_sh_saves=EXCLUDED.nhl_sh_saves, nhl_shots_blocked=EXCLUDED.nhl_shots_blocked,
      nhl_even_saves=EXCLUDED.nhl_even_saves,
      nhl_even_shots_against=EXCLUDED.nhl_even_shots_against,
      nhl_pp_shots_against=EXCLUDED.nhl_pp_shots_against,
      nhl_sh_shots_against=EXCLUDED.nhl_sh_shots_against,
      updated_at=now()
    RETURNING 1)
  SELECT count(*)::int INTO v_rows FROM ins;

  SELECT count(*)::int INTO v_games FROM public.raw_nhl_data
   WHERE substring(game_id::text from 1 for 4)::int = p_season AND boxscore_json IS NOT NULL;

  games_done := v_games; rows_written := v_rows;
  RETURN NEXT;
END $$;


ALTER FUNCTION "public"."unpack_boxscore_season"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_all_matchup_scores"("p_league_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("matchup_id" "uuid", "team1_id" "uuid", "team2_id" "uuid", "team1_score" numeric, "team2_score" numeric, "updated" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_matchup RECORD;
  v_team1_score NUMERIC(10, 3);
  v_team2_score NUMERIC(10, 3);
  v_error_count INTEGER := 0;
BEGIN
  -- Input validation
  IF p_league_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
    RAISE EXCEPTION 'League % does not exist', p_league_id;
  END IF;

  -- Loop through all matchups that have STARTED (completed + in-progress)
  -- FIX: Changed from week_end_date <= CURRENT_DATE to week_start_date <= CURRENT_DATE
  -- so that the current in-progress week is also updated.
  FOR v_matchup IN
    SELECT m.id, m.league_id, m.team1_id, m.team2_id, m.week_start_date, m.week_end_date
    FROM matchups m
    WHERE (p_league_id IS NULL OR m.league_id = p_league_id)
      AND m.week_start_date <= CURRENT_DATE  -- Include any week that has started
    ORDER BY m.week_end_date DESC, m.id
  LOOP
    BEGIN
      -- Calculate team1 score
      SELECT calculate_matchup_total_score(
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.week_start_date,
        v_matchup.week_end_date
      ) INTO v_team1_score;

      IF v_team1_score IS NULL THEN
        v_team1_score := 0;
      END IF;

      -- Calculate team2 score (if not a bye week)
      IF v_matchup.team2_id IS NOT NULL THEN
        SELECT calculate_matchup_total_score(
          v_matchup.id,
          v_matchup.team2_id,
          v_matchup.week_start_date,
          v_matchup.week_end_date
        ) INTO v_team2_score;

        IF v_team2_score IS NULL THEN
          v_team2_score := 0;
        END IF;
      ELSE
        v_team2_score := 0;
      END IF;

      -- Update matchups table with calculated scores
      UPDATE matchups
      SET team1_score = v_team1_score,
          team2_score = v_team2_score,
          updated_at = NOW()
      WHERE id = v_matchup.id;

      RETURN QUERY SELECT
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.team2_id,
        v_team1_score,
        v_team2_score,
        true;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      RAISE WARNING 'Error updating matchup %: %', v_matchup.id, SQLERRM;

      RETURN QUERY SELECT
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.team2_id,
        0::NUMERIC(10, 3),
        0::NUMERIC(10, 3),
        false;
    END;
  END LOOP;

  IF v_error_count > 0 THEN
    RAISE WARNING 'update_all_matchup_scores completed with % errors', v_error_count;
  END IF;
END;
$$;


ALTER FUNCTION "public"."update_all_matchup_scores"("p_league_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_all_matchup_scores"("p_league_id" "uuid") IS 'Updates team1_score and team2_score for all started matchups (completed + in-progress). FIX: Changed filter from week_end_date <= CURRENT_DATE to week_start_date <= CURRENT_DATE so the current in-progress week is no longer skipped. Uses calculate_matchup_total_score which calls calculate_daily_matchup_scores for each day in the week.';



CREATE OR REPLACE FUNCTION "public"."update_implied_probabilities"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.moneyline_home IS NOT NULL THEN
    NEW.implied_win_probability_home := public.calculate_implied_probability(NEW.moneyline_home);
  END IF;
  
  IF NEW.moneyline_away IS NOT NULL THEN
    NEW.implied_win_probability_away := public.calculate_implied_probability(NEW.moneyline_away);
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_implied_probabilities"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_projected_stats_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_player_projected_stats_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_projections_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_player_projections_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_player_talent_metrics_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_player_talent_metrics_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_playoff_series_from_games"("p_season" integer DEFAULT 2025) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count INTEGER := 0;
  v_series RECORD;
  v_high_wins INTEGER;
  v_low_wins INTEGER;
  v_new_status TEXT;
  v_winner INTEGER;
  v_was_final BOOLEAN;
  v_newly_finalized UUID[];
BEGIN
  v_newly_finalized := ARRAY[]::UUID[];

  -- Iterate each series; derive wins from nhl_games finalized between the two teams.
  FOR v_series IN
    SELECT series_id, bracket_slot, high_seed_team_id, low_seed_team_id,
           series_status AS old_status
    FROM nhl_playoff_series
    WHERE high_seed_team_id IS NOT NULL AND low_seed_team_id IS NOT NULL
  LOOP
    -- Count wins for each team across all finalized games between them this season
    SELECT
      COALESCE(SUM(CASE
        WHEN (g.home_team_id = v_series.high_seed_team_id AND g.home_score > g.away_score)
          OR (g.away_team_id = v_series.high_seed_team_id AND g.away_score > g.home_score)
        THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE
        WHEN (g.home_team_id = v_series.low_seed_team_id AND g.home_score > g.away_score)
          OR (g.away_team_id = v_series.low_seed_team_id AND g.away_score > g.home_score)
        THEN 1 ELSE 0 END), 0)
    INTO v_high_wins, v_low_wins
    FROM nhl_games g
    WHERE g.game_type = 'playoff'
      AND g.season = p_season
      AND g.status = 'final'
      AND (
        (g.home_team_id = v_series.high_seed_team_id AND g.away_team_id = v_series.low_seed_team_id)
        OR (g.home_team_id = v_series.low_seed_team_id AND g.away_team_id = v_series.high_seed_team_id)
      );

    -- Determine status
    IF v_high_wins >= 4 THEN
      v_new_status := 'final';
      v_winner := v_series.high_seed_team_id;
    ELSIF v_low_wins >= 4 THEN
      v_new_status := 'final';
      v_winner := v_series.low_seed_team_id;
    ELSIF v_high_wins + v_low_wins > 0 THEN
      v_new_status := 'active';
      v_winner := NULL;
    ELSE
      -- No finalized games yet — but check if any are live/in_progress
      IF EXISTS (
        SELECT 1 FROM nhl_games g
        WHERE g.game_type = 'playoff' AND g.season = p_season
          AND g.status IN ('live', 'in_progress')
          AND (
            (g.home_team_id = v_series.high_seed_team_id AND g.away_team_id = v_series.low_seed_team_id)
            OR (g.home_team_id = v_series.low_seed_team_id AND g.away_team_id = v_series.high_seed_team_id)
          )
      ) THEN
        v_new_status := 'active';
      ELSE
        v_new_status := 'pending';
      END IF;
      v_winner := NULL;
    END IF;

    v_was_final := v_series.old_status = 'final';

    UPDATE nhl_playoff_series
    SET high_seed_wins = v_high_wins,
        low_seed_wins = v_low_wins,
        games_played = v_high_wins + v_low_wins,
        series_status = v_new_status,
        winner_team_id = v_winner,
        updated_at = NOW()
    WHERE series_id = v_series.series_id;

    v_count := v_count + 1;

    -- Collect newly-finalized series IDs for downstream pick scoring
    IF v_new_status = 'final' AND NOT v_was_final THEN
      v_newly_finalized := array_append(v_newly_finalized, v_series.series_id);
    END IF;
  END LOOP;

  -- Score picks for any series that just finalized this run.
  -- score_playoff_series_picks handles both bracket_picks + confidence_picks.
  IF array_length(v_newly_finalized, 1) > 0 THEN
    DECLARE
      v_sid UUID;
    BEGIN
      FOREACH v_sid IN ARRAY v_newly_finalized LOOP
        BEGIN
          PERFORM score_playoff_series_picks(v_sid);
        EXCEPTION WHEN OTHERS THEN
          BEGIN PERFORM public.log_function_error('update_playoff_series_from_games', SQLSTATE, SQLERRM, 'per-series recompute', jsonb_build_object('season', p_season)); EXCEPTION WHEN OTHERS THEN NULL; END;
          NULL;  -- next cycle will retry
        END;
      END LOOP;
    END;
  END IF;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."update_playoff_series_from_games"("p_season" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_roster_assignments_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_roster_assignments_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_owns_team_in_league_simple"("p_league_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams
    WHERE league_id = p_league_id
      AND owner_id = auth.uid()
    LIMIT 1
  );
$$;


ALTER FUNCTION "public"."user_owns_team_in_league_simple"("p_league_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_keeper_selections"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) RETURNS TABLE("is_valid" boolean, "error_message" "text", "keepers_count" integer, "max_keepers" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."validate_keeper_selections"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_league_settings"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_teams_count INT;
  v_playoff_teams INT;
  v_waiver_type TEXT;
  v_faab_budget INT;
BEGIN
  -- Extract settings values
  v_teams_count := COALESCE((NEW.settings->>'teamsCount')::INT, 12);
  v_playoff_teams := COALESCE((NEW.settings->>'playoffTeams')::INT, 0);
  v_waiver_type := COALESCE(NEW.waiver_type, 'rolling');
  v_faab_budget := COALESCE((NEW.settings->>'faabBudget')::INT, 100);

  -- Validation 1: Playoff teams must not exceed total teams
  IF v_playoff_teams > v_teams_count THEN
    RAISE EXCEPTION 'Playoff teams (%) cannot exceed total teams (%)', v_playoff_teams, v_teams_count;
  END IF;

  -- Validation 2: FAAB budget must be > 0 when waiver type is FAAB
  IF v_waiver_type = 'faab' AND v_faab_budget <= 0 THEN
    RAISE EXCEPTION 'FAAB budget must be greater than 0 when FAAB waivers are enabled';
  END IF;

  -- Validation 3: Scoring settings numeric range (prevent extreme values)
  IF NEW.scoring_settings IS NOT NULL THEN
    -- Check skater scoring values are within reasonable range (-100 to 100)
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.scoring_settings->'skater', '{}'::jsonb))
      WHERE value::numeric < -100 OR value::numeric > 100
    ) THEN
      RAISE EXCEPTION 'Scoring values must be between -100 and 100';
    END IF;

    -- Check goalie scoring values are within reasonable range
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(NEW.scoring_settings->'goalie', '{}'::jsonb))
      WHERE value::numeric < -100 OR value::numeric > 100
    ) THEN
      RAISE EXCEPTION 'Scoring values must be between -100 and 100';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_league_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_matchup_score"("p_score" numeric) RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Matchup scores should be 0-200 range (typical: 20-80 per week)
  -- Scores >500 are almost certainly season totals, not matchup totals
  IF p_score > 500 THEN
    RAISE WARNING 'Suspiciously high matchup score detected: %. This may be a season total, not a matchup total. Expected range: 0-200.', p_score;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."validate_matchup_score"("p_score" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_matchup_score"("p_score" numeric) IS 'Validates that matchup scores are in expected range (0-200). Scores >500 are flagged as suspicious (likely season totals, not matchup totals).';



CREATE OR REPLACE FUNCTION "public"."validate_matchup_scores_before_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Validate team1_score
  IF NEW.team1_score IS NOT NULL AND NOT validate_matchup_score(NEW.team1_score) THEN
    RAISE WARNING 'team1_score validation failed for matchup %: %. This may be a season total instead of a matchup total.', NEW.id, NEW.team1_score;
    -- Don't block update, but log warning for debugging
  END IF;
  
  -- Validate team2_score
  IF NEW.team2_score IS NOT NULL AND NOT validate_matchup_score(NEW.team2_score) THEN
    RAISE WARNING 'team2_score validation failed for matchup %: %. This may be a season total instead of a matchup total.', NEW.id, NEW.team2_score;
    -- Don't block update, but log warning for debugging
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_matchup_scores_before_update"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_matchup_scores_before_update"() IS 'Trigger function that validates matchup scores before update. Logs warnings for suspicious scores but does not block updates.';



CREATE OR REPLACE FUNCTION "public"."validate_team_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  league_commissioner_id UUID;
BEGIN
  -- Validate league exists
  SELECT commissioner_id INTO league_commissioner_id
  FROM public.leagues
  WHERE id = NEW.league_id;
  
  IF league_commissioner_id IS NULL THEN
    RAISE EXCEPTION 'League does not exist';
  END IF;
  
  -- Allow team creation if:
  -- 1. User is the commissioner (can create teams for others), OR
  -- 2. User is creating their own team (owner_id = auth.uid())
  IF league_commissioner_id != auth.uid() AND NEW.owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the league commissioner can create teams for others. Users can only create their own teams.';
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_team_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_team_lineups_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_valid_ids TEXT[];
  v_filtered_starters JSONB;
  v_filtered_bench JSONB;
  v_filtered_ir JSONB;
  v_filtered_slots JSONB;
  v_key TEXT;
  v_removed_count INTEGER := 0;
BEGIN
  SELECT ARRAY_AGG(ra.player_id)
  INTO v_valid_ids
  FROM roster_assignments ra
  WHERE ra.team_id = NEW.team_id
    AND ra.league_id = NEW.league_id;

  v_valid_ids := COALESCE(v_valid_ids, ARRAY[]::TEXT[]);

  IF array_length(v_valid_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_filtered_starters
  FROM jsonb_array_elements_text(COALESCE(NEW.starters, '[]'::jsonb)) AS elem
  WHERE elem = ANY(v_valid_ids);

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_filtered_bench
  FROM jsonb_array_elements_text(COALESCE(NEW.bench, '[]'::jsonb)) AS elem
  WHERE elem = ANY(v_valid_ids);

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_filtered_ir
  FROM jsonb_array_elements_text(COALESCE(NEW.ir, '[]'::jsonb)) AS elem
  WHERE elem = ANY(v_valid_ids);

  v_filtered_slots := '{}'::jsonb;
  IF NEW.slot_assignments IS NOT NULL AND NEW.slot_assignments != '{}'::jsonb THEN
    FOR v_key IN SELECT key FROM jsonb_each_text(NEW.slot_assignments) LOOP
      IF v_key = ANY(v_valid_ids) AND (
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_filtered_starters) AS s WHERE s = v_key)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_filtered_ir) AS i WHERE i = v_key)
      ) THEN
        v_filtered_slots := v_filtered_slots || jsonb_build_object(
          v_key, NEW.slot_assignments ->> v_key
        );
      ELSE
        v_removed_count := v_removed_count + 1;
      END IF;
    END LOOP;
  END IF;

  NEW.starters := v_filtered_starters;
  NEW.bench := v_filtered_bench;
  NEW.ir := v_filtered_ir;
  NEW.slot_assignments := v_filtered_slots;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_team_lineups_integrity"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_team_lineups_integrity"() IS 'Integrity trigger: auto-filters stale player IDs from team_lineups before write.';



CREATE OR REPLACE FUNCTION "public"."verify_matchup_scores"("p_matchup_id" "uuid") RETURNS TABLE("team1_calculated" numeric, "team1_stored" numeric, "team2_calculated" numeric, "team2_stored" numeric, "is_calibrated" boolean, "discrepancy_team1" numeric, "discrepancy_team2" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH team_totals AS (
        SELECT 
            fml.team_id,
            SUM(fml.total_points) as calculated_total
        FROM public.fantasy_matchup_lines fml
        WHERE fml.matchup_id = p_matchup_id
        GROUP BY fml.team_id
    ),
    matchup_data AS (
        SELECT team1_id, team2_id, team1_score, team2_score
        FROM public.matchups
        WHERE id = p_matchup_id
    )
    SELECT 
        COALESCE(tt1.calculated_total, 0)::NUMERIC as team1_calculated,
        md.team1_score as team1_stored,
        COALESCE(tt2.calculated_total, 0)::NUMERIC as team2_calculated,
        md.team2_score as team2_stored,
        (ABS(COALESCE(tt1.calculated_total, 0) - md.team1_score) < 0.01 
         AND ABS(COALESCE(tt2.calculated_total, 0) - md.team2_score) < 0.01) as is_calibrated,
        (COALESCE(tt1.calculated_total, 0) - md.team1_score)::NUMERIC as discrepancy_team1,
        (COALESCE(tt2.calculated_total, 0) - md.team2_score)::NUMERIC as discrepancy_team2
    FROM matchup_data md
    LEFT JOIN team_totals tt1 ON tt1.team_id = md.team1_id
    LEFT JOIN team_totals tt2 ON tt2.team_id = md.team2_id;
END;
$$;


ALTER FUNCTION "public"."verify_matchup_scores"("p_matchup_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verify_matchup_scores"("p_matchup_id" "uuid") IS 'Verifies that sum of fantasy_matchup_lines.total_points equals matchups.team_score. Returns calibration status and any discrepancies.';



CREATE OR REPLACE FUNCTION "public"."withdraw_user_consent"("p_policy_type" "text", "p_version" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_user uuid := auth.uid(); v_n int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'withdraw_user_consent requires an authenticated caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.user_privacy_consent
     SET granted = false, withdrawn_at = now()
   WHERE user_id = v_user
     AND policy_type = p_policy_type
     AND (p_version IS NULL OR version = btrim(p_version))
     AND granted AND withdrawn_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'withdrawn', v_n,
                            'policy_type', p_policy_type,
                            'version', coalesce(p_version, 'all live versions'));
END;
$$;


ALTER FUNCTION "public"."withdraw_user_consent"("p_policy_type" "text", "p_version" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."withdraw_user_consent"("p_policy_type" "text", "p_version" "text") IS 'GDPR Art. 7(3). Marks the caller''s live grant(s) for a policy withdrawn, preserving consented_at alongside withdrawn_at. Refuses without an authenticated caller. Omit p_version to withdraw every live version of that policy.';



CREATE OR REPLACE FUNCTION "public"."xg_scorecard"("p_season" integer DEFAULT NULL::integer) RETURNS TABLE("season" integer, "shots" bigint, "goals" bigint, "auc" numeric, "calibration" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with sc as (
    select case when p_season is null then 0 else n.season end as grp,
           n.is_goal, n.xg_sql as xg
      from public.nhl_shots n
     where n.xg_sql is not null
       and (p_season is null or n.season = p_season)
  ),
  g as (
    select grp, xg s,
           count(*) filter (where is_goal)::numeric p,
           count(*) filter (where not is_goal)::numeric qq
      from sc group by grp, xg
  ),
  c as (
    select *, sum(qq) over (partition by grp order by s
                            rows between unbounded preceding and 1 preceding) qb
      from g
  ),
  a as (
    select grp, round(sum(p*(coalesce(qb,0)+0.5*qq))/(sum(p)*sum(qq)),4) auc from c group by grp
  ),
  t as (
    select grp, count(*)::bigint shots, sum(is_goal::int)::bigint goals,
           round((sum(xg)/nullif(sum(is_goal::int),0))::numeric,4) cal
      from sc group by grp
  )
  select case when t.grp = 0 then null else t.grp end::integer,
         t.shots, t.goals, a.auc, t.cal
    from t join a on a.grp = t.grp;
$$;


ALTER FUNCTION "public"."xg_scorecard"("p_season" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."xg_scorecard"("p_season" integer) IS 'AUC and calibration of the shipped nhl_shots.xg_sql column. Pass a season for that season, or NULL for the whole corpus pooled. Use it as the accept test either side of any model retrain.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_backup_matchup_scores_20260811" (
    "id" "uuid",
    "team1_score" numeric,
    "team2_score" numeric,
    "status" "public"."matchup_status",
    "snapshot_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_matchup_scores_20260811" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_ros_projections_20260811" (
    "player_id" integer,
    "season" integer,
    "games_remaining" integer,
    "games_played" integer,
    "total_projected_points" numeric(8,2),
    "projected_goals" numeric(6,2),
    "projected_assists" numeric(6,2),
    "projected_sog" numeric(6,2),
    "projected_blocks" numeric(6,2),
    "projected_ppp" numeric(6,2),
    "projected_shp" numeric(6,2),
    "projected_hits" numeric(6,2),
    "projected_pim" numeric(6,2),
    "avg_points_per_game" numeric(4,2),
    "avg_goals_per_game" numeric(4,3),
    "avg_assists_per_game" numeric(4,3),
    "playoff_games" integer,
    "playoff_week_projection" numeric(6,2),
    "projected_wins_ros" numeric(5,2),
    "projected_saves_ros" numeric(7,2),
    "projected_shutouts_ros" numeric(4,2),
    "player_name" character varying(100),
    "team_abbrev" character varying(3),
    "position" character varying(5),
    "is_goalie" boolean,
    "updated_at" timestamp with time zone,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_ros_projections_20260811" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_deprecated_2025_Skaters" (
    "playerId" bigint,
    "season" bigint,
    "name" "text",
    "team" "text",
    "position" "text",
    "situation" "text",
    "games_played" bigint,
    "icetime" bigint,
    "shifts" bigint,
    "gameScore" double precision,
    "onIce_xGoalsPercentage" double precision,
    "offIce_xGoalsPercentage" double precision,
    "onIce_corsiPercentage" double precision,
    "offIce_corsiPercentage" double precision,
    "onIce_fenwickPercentage" double precision,
    "offIce_fenwickPercentage" double precision,
    "iceTimeRank" bigint,
    "I_F_xOnGoal" "text",
    "I_F_xGoals" "text",
    "I_F_xRebounds" "text",
    "I_F_xFreeze" "text",
    "I_F_xPlayStopped" "text",
    "I_F_xPlayContinuedInZone" "text",
    "I_F_xPlayContinuedOutsideZone" "text",
    "I_F_flurryAdjustedxGoals" "text",
    "I_F_scoreVenueAdjustedxGoals" "text",
    "I_F_flurryScoreVenueAdjustedxGoals" "text",
    "I_F_primaryAssists" "text",
    "I_F_secondaryAssists" "text",
    "I_F_shotsOnGoal" "text",
    "I_F_missedShots" "text",
    "I_F_blockedShotAttempts" "text",
    "I_F_shotAttempts" "text",
    "I_F_points" "text",
    "I_F_goals" "text",
    "I_F_rebounds" "text",
    "I_F_reboundGoals" "text",
    "I_F_freeze" "text",
    "I_F_playStopped" "text",
    "I_F_playContinuedInZone" "text",
    "I_F_playContinuedOutsideZone" "text",
    "I_F_savedShotsOnGoal" "text",
    "I_F_savedUnblockedShotAttempts" "text",
    "penalties" "text",
    "I_F_penalityMinutes" "text",
    "I_F_faceOffsWon" "text",
    "I_F_hits" "text",
    "I_F_takeaways" "text",
    "I_F_giveaways" "text",
    "I_F_lowDangerShots" "text",
    "I_F_mediumDangerShots" "text",
    "I_F_highDangerShots" "text",
    "I_F_lowDangerxGoals" "text",
    "I_F_mediumDangerxGoals" "text",
    "I_F_highDangerxGoals" "text",
    "I_F_lowDangerGoals" "text",
    "I_F_mediumDangerGoals" "text",
    "I_F_highDangerGoals" "text",
    "I_F_scoreAdjustedShotsAttempts" "text",
    "I_F_unblockedShotAttempts" "text",
    "I_F_scoreAdjustedUnblockedShotAttempts" "text",
    "I_F_dZoneGiveaways" "text",
    "I_F_xGoalsFromxReboundsOfShots" "text",
    "I_F_xGoalsFromActualReboundsOfShots" "text",
    "I_F_reboundxGoals" "text",
    "I_F_xGoals_with_earned_rebounds" "text",
    "I_F_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "I_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "I_F_shifts" bigint,
    "I_F_oZoneShiftStarts" "text",
    "I_F_dZoneShiftStarts" "text",
    "I_F_neutralZoneShiftStarts" bigint,
    "I_F_flyShiftStarts" bigint,
    "I_F_oZoneShiftEnds" "text",
    "I_F_dZoneShiftEnds" "text",
    "I_F_neutralZoneShiftEnds" bigint,
    "I_F_flyShiftEnds" bigint,
    "faceoffsWon" "text",
    "faceoffsLost" "text",
    "timeOnBench" bigint,
    "penalityMinutes" "text",
    "penalityMinutesDrawn" "text",
    "penaltiesDrawn" "text",
    "shotsBlockedByPlayer" "text",
    "OnIce_F_xOnGoal" double precision,
    "OnIce_F_xGoals" double precision,
    "OnIce_F_flurryAdjustedxGoals" double precision,
    "OnIce_F_scoreVenueAdjustedxGoals" double precision,
    "OnIce_F_flurryScoreVenueAdjustedxGoals" double precision,
    "OnIce_F_shotsOnGoal" bigint,
    "OnIce_F_missedShots" "text",
    "OnIce_F_blockedShotAttempts" "text",
    "OnIce_F_shotAttempts" bigint,
    "OnIce_F_goals" "text",
    "OnIce_F_rebounds" "text",
    "OnIce_F_reboundGoals" "text",
    "OnIce_F_lowDangerShots" bigint,
    "OnIce_F_mediumDangerShots" "text",
    "OnIce_F_highDangerShots" "text",
    "OnIce_F_lowDangerxGoals" double precision,
    "OnIce_F_mediumDangerxGoals" "text",
    "OnIce_F_highDangerxGoals" "text",
    "OnIce_F_lowDangerGoals" "text",
    "OnIce_F_mediumDangerGoals" "text",
    "OnIce_F_highDangerGoals" "text",
    "OnIce_F_scoreAdjustedShotsAttempts" double precision,
    "OnIce_F_unblockedShotAttempts" bigint,
    "OnIce_F_scoreAdjustedUnblockedShotAttempts" double precision,
    "OnIce_F_xGoalsFromxReboundsOfShots" double precision,
    "OnIce_F_xGoalsFromActualReboundsOfShots" "text",
    "OnIce_F_reboundxGoals" "text",
    "OnIce_F_xGoals_with_earned_rebounds" double precision,
    "OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted" double precision,
    "OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted" double precision,
    "OnIce_A_xOnGoal" "text",
    "OnIce_A_xGoals" "text",
    "OnIce_A_flurryAdjustedxGoals" "text",
    "OnIce_A_scoreVenueAdjustedxGoals" "text",
    "OnIce_A_flurryScoreVenueAdjustedxGoals" "text",
    "OnIce_A_shotsOnGoal" "text",
    "OnIce_A_missedShots" "text",
    "OnIce_A_blockedShotAttempts" "text",
    "OnIce_A_shotAttempts" bigint,
    "OnIce_A_goals" "text",
    "OnIce_A_rebounds" "text",
    "OnIce_A_reboundGoals" "text",
    "OnIce_A_lowDangerShots" "text",
    "OnIce_A_mediumDangerShots" "text",
    "OnIce_A_highDangerShots" "text",
    "OnIce_A_lowDangerxGoals" "text",
    "OnIce_A_mediumDangerxGoals" "text",
    "OnIce_A_highDangerxGoals" "text",
    "OnIce_A_lowDangerGoals" "text",
    "OnIce_A_mediumDangerGoals" "text",
    "OnIce_A_highDangerGoals" "text",
    "OnIce_A_scoreAdjustedShotsAttempts" double precision,
    "OnIce_A_unblockedShotAttempts" "text",
    "OnIce_A_scoreAdjustedUnblockedShotAttempts" "text",
    "OnIce_A_xGoalsFromxReboundsOfShots" "text",
    "OnIce_A_xGoalsFromActualReboundsOfShots" "text",
    "OnIce_A_reboundxGoals" "text",
    "OnIce_A_xGoals_with_earned_rebounds" "text",
    "OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "OffIce_F_xGoals" double precision,
    "OffIce_A_xGoals" double precision,
    "OffIce_F_shotAttempts" bigint,
    "OffIce_A_shotAttempts" bigint,
    "xGoalsForAfterShifts" "text",
    "xGoalsAgainstAfterShifts" "text",
    "corsiForAfterShifts" "text",
    "corsiAgainstAfterShifts" "text",
    "fenwickForAfterShifts" "text",
    "fenwickAgainstAfterShifts" "text"
);


ALTER TABLE "public"."_deprecated_2025_Skaters" OWNER TO "postgres";


COMMENT ON TABLE "public"."_deprecated_2025_Skaters" IS 'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero view refs, zero recorded writes. Data intact. Restore by renaming back to "2025_Skaters". Drop for real only after a clean soak period.';



CREATE TABLE IF NOT EXISTS "public"."_deprecated_public.players" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."_deprecated_public.players" OWNER TO "postgres";


COMMENT ON TABLE "public"."_deprecated_public.players" IS 'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero view refs, zero recorded writes. Data intact. Restore by renaming back to "public.players". Drop for real only after a clean soak period.';



CREATE TABLE IF NOT EXISTS "public"."_deprecated_staging_2024_goalies" (
    "playerId" "text",
    "season" "text",
    "name" "text",
    "team" "text",
    "position" "text",
    "situation" "text",
    "games_played" "text",
    "icetime" "text",
    "xGoals" "text",
    "goals" "text",
    "unblocked_shot_attempts" "text",
    "xRebounds" "text",
    "rebounds" "text",
    "xFreeze" "text",
    "freeze" "text",
    "xOnGoal" "text",
    "ongoal" "text",
    "xPlayStopped" "text",
    "playStopped" "text",
    "xPlayContinuedInZone" "text",
    "playContinuedInZone" "text",
    "xPlayContinuedOutsideZone" "text",
    "playContinuedOutsideZone" "text",
    "flurryAdjustedxGoals" "text",
    "lowDangerShots" "text",
    "mediumDangerShots" "text",
    "highDangerShots" "text",
    "lowDangerxGoals" "text",
    "mediumDangerxGoals" "text",
    "highDangerxGoals" "text",
    "lowDangerGoals" "text",
    "mediumDangerGoals" "text",
    "highDangerGoals" "text",
    "blocked_shot_attempts" "text",
    "penalityMinutes" "text",
    "penalties" "text"
);


ALTER TABLE "public"."_deprecated_staging_2024_goalies" OWNER TO "postgres";


COMMENT ON TABLE "public"."_deprecated_staging_2024_goalies" IS 'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero view refs, zero recorded writes. Data intact. Restore by renaming back to "staging_2024_goalies". Drop for real only after a clean soak period.';



CREATE TABLE IF NOT EXISTS "public"."_deprecated_staging_2024_skaters" (
    "playerId" "text",
    "season" "text",
    "name" "text",
    "team" "text",
    "position" "text",
    "situation" "text",
    "games_played" "text",
    "icetime" "text",
    "shifts" "text",
    "gameScore" "text",
    "onIce_xGoalsPercentage" "text",
    "offIce_xGoalsPercentage" "text",
    "onIce_corsiPercentage" "text",
    "offIce_corsiPercentage" "text",
    "onIce_fenwickPercentage" "text",
    "offIce_fenwickPercentage" "text",
    "iceTimeRank" "text",
    "I_F_xOnGoal" "text",
    "I_F_xGoals" "text",
    "I_F_xRebounds" "text",
    "I_F_xFreeze" "text",
    "I_F_xPlayStopped" "text",
    "I_F_xPlayContinuedInZone" "text",
    "I_F_xPlayContinuedOutsideZone" "text",
    "I_F_flurryAdjustedxGoals" "text",
    "I_F_scoreVenueAdjustedxGoals" "text",
    "I_F_flurryScoreVenueAdjustedxGoals" "text",
    "I_F_primaryAssists" "text",
    "I_F_secondaryAssists" "text",
    "I_F_shotsOnGoal" "text",
    "I_F_missedShots" "text",
    "I_F_blockedShotAttempts" "text",
    "I_F_shotAttempts" "text",
    "I_F_points" "text",
    "I_F_goals" "text",
    "I_F_rebounds" "text",
    "I_F_reboundGoals" "text",
    "I_F_freeze" "text",
    "I_F_playStopped" "text",
    "I_F_playContinuedInZone" "text",
    "I_F_playContinuedOutsideZone" "text",
    "I_F_savedShotsOnGoal" "text",
    "I_F_savedUnblockedShotAttempts" "text",
    "penalties" "text",
    "I_F_penalityMinutes" "text",
    "I_F_faceOffsWon" "text",
    "I_F_hits" "text",
    "I_F_takeaways" "text",
    "I_F_giveaways" "text",
    "I_F_lowDangerShots" "text",
    "I_F_mediumDangerShots" "text",
    "I_F_highDangerShots" "text",
    "I_F_lowDangerxGoals" "text",
    "I_F_mediumDangerxGoals" "text",
    "I_F_highDangerxGoals" "text",
    "I_F_lowDangerGoals" "text",
    "I_F_mediumDangerGoals" "text",
    "I_F_highDangerGoals" "text",
    "I_F_scoreAdjustedShotsAttempts" "text",
    "I_F_unblockedShotAttempts" "text",
    "I_F_scoreAdjustedUnblockedShotAttempts" "text",
    "I_F_dZoneGiveaways" "text",
    "I_F_xGoalsFromxReboundsOfShots" "text",
    "I_F_xGoalsFromActualReboundsOfShots" "text",
    "I_F_reboundxGoals" "text",
    "I_F_xGoals_with_earned_rebounds" "text",
    "I_F_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "I_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "I_F_shifts" "text",
    "I_F_oZoneShiftStarts" "text",
    "I_F_dZoneShiftStarts" "text",
    "I_F_neutralZoneShiftStarts" "text",
    "I_F_flyShiftStarts" "text",
    "I_F_oZoneShiftEnds" "text",
    "I_F_dZoneShiftEnds" "text",
    "I_F_neutralZoneShiftEnds" "text",
    "I_F_flyShiftEnds" "text",
    "faceoffsWon" "text",
    "faceoffsLost" "text",
    "timeOnBench" "text",
    "penalityMinutes" "text",
    "penalityMinutesDrawn" "text",
    "penaltiesDrawn" "text",
    "shotsBlockedByPlayer" "text",
    "OnIce_F_xOnGoal" "text",
    "OnIce_F_xGoals" "text",
    "OnIce_F_flurryAdjustedxGoals" "text",
    "OnIce_F_scoreVenueAdjustedxGoals" "text",
    "OnIce_F_flurryScoreVenueAdjustedxGoals" "text",
    "OnIce_F_shotsOnGoal" "text",
    "OnIce_F_missedShots" "text",
    "OnIce_F_blockedShotAttempts" "text",
    "OnIce_F_shotAttempts" "text",
    "OnIce_F_goals" "text",
    "OnIce_F_rebounds" "text",
    "OnIce_F_reboundGoals" "text",
    "OnIce_F_lowDangerShots" "text",
    "OnIce_F_mediumDangerShots" "text",
    "OnIce_F_highDangerShots" "text",
    "OnIce_F_lowDangerxGoals" "text",
    "OnIce_F_mediumDangerxGoals" "text",
    "OnIce_F_highDangerxGoals" "text",
    "OnIce_F_lowDangerGoals" "text",
    "OnIce_F_mediumDangerGoals" "text",
    "OnIce_F_highDangerGoals" "text",
    "OnIce_F_scoreAdjustedShotsAttempts" "text",
    "OnIce_F_unblockedShotAttempts" "text",
    "OnIce_F_scoreAdjustedUnblockedShotAttempts" "text",
    "OnIce_F_xGoalsFromxReboundsOfShots" "text",
    "OnIce_F_xGoalsFromActualReboundsOfShots" "text",
    "OnIce_F_reboundxGoals" "text",
    "OnIce_F_xGoals_with_earned_rebounds" "text",
    "OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "OnIce_A_xOnGoal" "text",
    "OnIce_A_xGoals" "text",
    "OnIce_A_flurryAdjustedxGoals" "text",
    "OnIce_A_scoreVenueAdjustedxGoals" "text",
    "OnIce_A_flurryScoreVenueAdjustedxGoals" "text",
    "OnIce_A_shotsOnGoal" "text",
    "OnIce_A_missedShots" "text",
    "OnIce_A_blockedShotAttempts" "text",
    "OnIce_A_shotAttempts" "text",
    "OnIce_A_goals" "text",
    "OnIce_A_rebounds" "text",
    "OnIce_A_reboundGoals" "text",
    "OnIce_A_lowDangerShots" "text",
    "OnIce_A_mediumDangerShots" "text",
    "OnIce_A_highDangerShots" "text",
    "OnIce_A_lowDangerxGoals" "text",
    "OnIce_A_mediumDangerxGoals" "text",
    "OnIce_A_highDangerxGoals" "text",
    "OnIce_A_lowDangerGoals" "text",
    "OnIce_A_mediumDangerGoals" "text",
    "OnIce_A_highDangerGoals" "text",
    "OnIce_A_scoreAdjustedShotsAttempts" "text",
    "OnIce_A_unblockedShotAttempts" "text",
    "OnIce_A_scoreAdjustedUnblockedShotAttempts" "text",
    "OnIce_A_xGoalsFromxReboundsOfShots" "text",
    "OnIce_A_xGoalsFromActualReboundsOfShots" "text",
    "OnIce_A_reboundxGoals" "text",
    "OnIce_A_xGoals_with_earned_rebounds" "text",
    "OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "OffIce_F_xGoals" "text",
    "OffIce_A_xGoals" "text",
    "OffIce_F_shotAttempts" "text",
    "OffIce_A_shotAttempts" "text",
    "xGoalsForAfterShifts" "text",
    "xGoalsAgainstAfterShifts" "text",
    "corsiForAfterShifts" "text",
    "corsiAgainstAfterShifts" "text",
    "fenwickForAfterShifts" "text",
    "fenwickAgainstAfterShifts" "text"
);


ALTER TABLE "public"."_deprecated_staging_2024_skaters" OWNER TO "postgres";


COMMENT ON TABLE "public"."_deprecated_staging_2024_skaters" IS 'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero view refs, zero recorded writes. Data intact. Restore by renaming back to "staging_2024_skaters". Drop for real only after a clean soak period.';



CREATE TABLE IF NOT EXISTS "public"."_deprecated_staging_2025_goalies" (
    "playerId" "text",
    "season" "text",
    "name" "text",
    "team" "text",
    "position" "text",
    "situation" "text",
    "games_played" "text",
    "icetime" "text",
    "xGoals" "text",
    "goals" "text",
    "unblocked_shot_attempts" "text",
    "xRebounds" "text",
    "rebounds" "text",
    "xFreeze" "text",
    "freeze" "text",
    "xOnGoal" "text",
    "ongoal" "text",
    "xPlayStopped" "text",
    "playStopped" "text",
    "xPlayContinuedInZone" "text",
    "playContinuedInZone" "text",
    "xPlayContinuedOutsideZone" "text",
    "playContinuedOutsideZone" "text",
    "flurryAdjustedxGoals" "text",
    "lowDangerShots" "text",
    "mediumDangerShots" "text",
    "highDangerShots" "text",
    "lowDangerxGoals" "text",
    "mediumDangerxGoals" "text",
    "highDangerxGoals" "text",
    "lowDangerGoals" "text",
    "mediumDangerGoals" "text",
    "highDangerGoals" "text",
    "blocked_shot_attempts" "text",
    "penalityMinutes" "text",
    "penalties" "text"
);


ALTER TABLE "public"."_deprecated_staging_2025_goalies" OWNER TO "postgres";


COMMENT ON TABLE "public"."_deprecated_staging_2025_goalies" IS 'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero view refs, zero recorded writes. Data intact. Restore by renaming back to "staging_2025_goalies". Drop for real only after a clean soak period.';



CREATE TABLE IF NOT EXISTS "public"."_deprecated_staging_2025_skaters" (
    "playerId" "text",
    "season" "text",
    "name" "text",
    "team" "text",
    "position" "text",
    "situation" "text",
    "games_played" "text",
    "icetime" "text",
    "shifts" "text",
    "gameScore" "text",
    "onIce_xGoalsPercentage" "text",
    "offIce_xGoalsPercentage" "text",
    "onIce_corsiPercentage" "text",
    "offIce_corsiPercentage" "text",
    "onIce_fenwickPercentage" "text",
    "offIce_fenwickPercentage" "text",
    "iceTimeRank" "text",
    "I_F_xOnGoal" "text",
    "I_F_xGoals" "text",
    "I_F_xRebounds" "text",
    "I_F_xFreeze" "text",
    "I_F_xPlayStopped" "text",
    "I_F_xPlayContinuedInZone" "text",
    "I_F_xPlayContinuedOutsideZone" "text",
    "I_F_flurryAdjustedxGoals" "text",
    "I_F_scoreVenueAdjustedxGoals" "text",
    "I_F_flurryScoreVenueAdjustedxGoals" "text",
    "I_F_primaryAssists" "text",
    "I_F_secondaryAssists" "text",
    "I_F_shotsOnGoal" "text",
    "I_F_missedShots" "text",
    "I_F_blockedShotAttempts" "text",
    "I_F_shotAttempts" "text",
    "I_F_points" "text",
    "I_F_goals" "text",
    "I_F_rebounds" "text",
    "I_F_reboundGoals" "text",
    "I_F_freeze" "text",
    "I_F_playStopped" "text",
    "I_F_playContinuedInZone" "text",
    "I_F_playContinuedOutsideZone" "text",
    "I_F_savedShotsOnGoal" "text",
    "I_F_savedUnblockedShotAttempts" "text",
    "penalties" "text",
    "I_F_penalityMinutes" "text",
    "I_F_faceOffsWon" "text",
    "I_F_hits" "text",
    "I_F_takeaways" "text",
    "I_F_giveaways" "text",
    "I_F_lowDangerShots" "text",
    "I_F_mediumDangerShots" "text",
    "I_F_highDangerShots" "text",
    "I_F_lowDangerxGoals" "text",
    "I_F_mediumDangerxGoals" "text",
    "I_F_highDangerxGoals" "text",
    "I_F_lowDangerGoals" "text",
    "I_F_mediumDangerGoals" "text",
    "I_F_highDangerGoals" "text",
    "I_F_scoreAdjustedShotsAttempts" "text",
    "I_F_unblockedShotAttempts" "text",
    "I_F_scoreAdjustedUnblockedShotAttempts" "text",
    "I_F_dZoneGiveaways" "text",
    "I_F_xGoalsFromxReboundsOfShots" "text",
    "I_F_xGoalsFromActualReboundsOfShots" "text",
    "I_F_reboundxGoals" "text",
    "I_F_xGoals_with_earned_rebounds" "text",
    "I_F_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "I_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "I_F_shifts" "text",
    "I_F_oZoneShiftStarts" "text",
    "I_F_dZoneShiftStarts" "text",
    "I_F_neutralZoneShiftStarts" "text",
    "I_F_flyShiftStarts" "text",
    "I_F_oZoneShiftEnds" "text",
    "I_F_dZoneShiftEnds" "text",
    "I_F_neutralZoneShiftEnds" "text",
    "I_F_flyShiftEnds" "text",
    "faceoffsWon" "text",
    "faceoffsLost" "text",
    "timeOnBench" "text",
    "penalityMinutes" "text",
    "penalityMinutesDrawn" "text",
    "penaltiesDrawn" "text",
    "shotsBlockedByPlayer" "text",
    "OnIce_F_xOnGoal" "text",
    "OnIce_F_xGoals" "text",
    "OnIce_F_flurryAdjustedxGoals" "text",
    "OnIce_F_scoreVenueAdjustedxGoals" "text",
    "OnIce_F_flurryScoreVenueAdjustedxGoals" "text",
    "OnIce_F_shotsOnGoal" "text",
    "OnIce_F_missedShots" "text",
    "OnIce_F_blockedShotAttempts" "text",
    "OnIce_F_shotAttempts" "text",
    "OnIce_F_goals" "text",
    "OnIce_F_rebounds" "text",
    "OnIce_F_reboundGoals" "text",
    "OnIce_F_lowDangerShots" "text",
    "OnIce_F_mediumDangerShots" "text",
    "OnIce_F_highDangerShots" "text",
    "OnIce_F_lowDangerxGoals" "text",
    "OnIce_F_mediumDangerxGoals" "text",
    "OnIce_F_highDangerxGoals" "text",
    "OnIce_F_lowDangerGoals" "text",
    "OnIce_F_mediumDangerGoals" "text",
    "OnIce_F_highDangerGoals" "text",
    "OnIce_F_scoreAdjustedShotsAttempts" "text",
    "OnIce_F_unblockedShotAttempts" "text",
    "OnIce_F_scoreAdjustedUnblockedShotAttempts" "text",
    "OnIce_F_xGoalsFromxReboundsOfShots" "text",
    "OnIce_F_xGoalsFromActualReboundsOfShots" "text",
    "OnIce_F_reboundxGoals" "text",
    "OnIce_F_xGoals_with_earned_rebounds" "text",
    "OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "OnIce_A_xOnGoal" "text",
    "OnIce_A_xGoals" "text",
    "OnIce_A_flurryAdjustedxGoals" "text",
    "OnIce_A_scoreVenueAdjustedxGoals" "text",
    "OnIce_A_flurryScoreVenueAdjustedxGoals" "text",
    "OnIce_A_shotsOnGoal" "text",
    "OnIce_A_missedShots" "text",
    "OnIce_A_blockedShotAttempts" "text",
    "OnIce_A_shotAttempts" "text",
    "OnIce_A_goals" "text",
    "OnIce_A_rebounds" "text",
    "OnIce_A_reboundGoals" "text",
    "OnIce_A_lowDangerShots" "text",
    "OnIce_A_mediumDangerShots" "text",
    "OnIce_A_highDangerShots" "text",
    "OnIce_A_lowDangerxGoals" "text",
    "OnIce_A_mediumDangerxGoals" "text",
    "OnIce_A_highDangerxGoals" "text",
    "OnIce_A_lowDangerGoals" "text",
    "OnIce_A_mediumDangerGoals" "text",
    "OnIce_A_highDangerGoals" "text",
    "OnIce_A_scoreAdjustedShotsAttempts" "text",
    "OnIce_A_unblockedShotAttempts" "text",
    "OnIce_A_scoreAdjustedUnblockedShotAttempts" "text",
    "OnIce_A_xGoalsFromxReboundsOfShots" "text",
    "OnIce_A_xGoalsFromActualReboundsOfShots" "text",
    "OnIce_A_reboundxGoals" "text",
    "OnIce_A_xGoals_with_earned_rebounds" "text",
    "OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted" "text",
    "OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted" "text",
    "OffIce_F_xGoals" "text",
    "OffIce_A_xGoals" "text",
    "OffIce_F_shotAttempts" "text",
    "OffIce_A_shotAttempts" "text",
    "xGoalsForAfterShifts" "text",
    "xGoalsAgainstAfterShifts" "text",
    "corsiForAfterShifts" "text",
    "corsiAgainstAfterShifts" "text",
    "fenwickForAfterShifts" "text",
    "fenwickAgainstAfterShifts" "text"
);


ALTER TABLE "public"."_deprecated_staging_2025_skaters" OWNER TO "postgres";


COMMENT ON TABLE "public"."_deprecated_staging_2025_skaters" IS 'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero view refs, zero recorded writes. Data intact. Restore by renaming back to "staging_2025_skaters". Drop for real only after a clean soak period.';



CREATE TABLE IF NOT EXISTS "public"."_preshot_rebuild_baseline" (
    "season" integer,
    "games" bigint,
    "shots" bigint,
    "goals" bigint,
    "neg_sec_prev" bigint,
    "rebounds" bigint,
    "rushes" bigint,
    "sum_xg" numeric,
    "captured_at" timestamp with time zone
);


ALTER TABLE "public"."_preshot_rebuild_baseline" OWNER TO "postgres";


COMMENT ON TABLE "public"."_preshot_rebuild_baseline" IS 'Pre-rebuild shot/xG counts captured 2026-08-12 so the event-chain rebuild stays auditable. Internal: RLS on with no policy = service_role only.';



CREATE TABLE IF NOT EXISTS "public"."_xg_recompute_2025" (
    "game_id" integer NOT NULL,
    "event_id" integer NOT NULL,
    "xg_new" numeric NOT NULL
);


ALTER TABLE "public"."_xg_recompute_2025" OWNER TO "postgres";


COMMENT ON TABLE "public"."_xg_recompute_2025" IS 'STAGING, temporary. Holds v3-geometry-fix xG predictions for 2025-26 (117,672 rows across 1,369 of the season''s 1,394 games -- the 25-game shortfall is the fetch-truncation defect tracked in 0E-XG-11). Locked down by 0E-OPS-2: RLS on, no anon/authenticated access. DO NOT DROP until train_xg_v4.py stage [3/5] enumerates games from raw_nhl_data rather than from this table -- dropping it before then breaks the retrain path.';



CREATE TABLE IF NOT EXISTS "public"."auction_bids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "nomination_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "bid_amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auction_bids_bid_amount_check" CHECK (("bid_amount" > (0)::numeric))
);


ALTER TABLE "public"."auction_bids" OWNER TO "postgres";


COMMENT ON TABLE "public"."auction_bids" IS 'Individual bids against an auction nomination.';



CREATE TABLE IF NOT EXISTS "public"."auction_budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "initial_budget" numeric DEFAULT 200 NOT NULL,
    "remaining_budget" numeric DEFAULT 200 NOT NULL,
    "players_won" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auction_budgets_initial_budget_check" CHECK (("initial_budget" > (0)::numeric)),
    CONSTRAINT "auction_budgets_players_won_check" CHECK (("players_won" >= 0)),
    CONSTRAINT "auction_budgets_remaining_budget_check" CHECK (("remaining_budget" >= (0)::numeric))
);


ALTER TABLE "public"."auction_budgets" OWNER TO "postgres";


COMMENT ON TABLE "public"."auction_budgets" IS 'Per-team auction budget and spend tracking.';



CREATE TABLE IF NOT EXISTS "public"."auction_nominations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "draft_session_id" "uuid" NOT NULL,
    "nominated_by_team_id" "uuid" NOT NULL,
    "player_id" "text" NOT NULL,
    "player_name" "text" NOT NULL,
    "minimum_bid" numeric DEFAULT 1 NOT NULL,
    "current_high_bid" numeric DEFAULT 1 NOT NULL,
    "current_high_bidder_team_id" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "nomination_number" integer NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auction_nominations_current_high_bid_check" CHECK (("current_high_bid" > (0)::numeric)),
    CONSTRAINT "auction_nominations_minimum_bid_check" CHECK (("minimum_bid" > (0)::numeric)),
    CONSTRAINT "auction_nominations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'sold'::"text", 'no_sale'::"text"])))
);


ALTER TABLE "public"."auction_nominations" OWNER TO "postgres";


COMMENT ON TABLE "public"."auction_nominations" IS 'Players nominated in an auction draft, with running high bid. Quiet outside auction drafts.';



CREATE TABLE IF NOT EXISTS "public"."auto_recovery_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recovery_time" timestamp with time zone DEFAULT "now"(),
    "trigger_reason" "text" NOT NULL,
    "teams_affected" "text"[],
    "players_restored" integer,
    "recovery_method" "text",
    "success" boolean,
    "details" "text"
);


ALTER TABLE "public"."auto_recovery_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."auto_recovery_log" IS 'Record of automated roster-recovery runs: what triggered them, teams affected, players restored, and whether the recovery succeeded.';



CREATE TABLE IF NOT EXISTS "public"."confidence_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_number" integer NOT NULL,
    "game_id" "text" NOT NULL,
    "picked_team" "text" NOT NULL,
    "confidence_points" integer NOT NULL,
    "is_correct" boolean,
    "points_earned" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "confidence_picks_confidence_points_check" CHECK (("confidence_points" > 0)),
    CONSTRAINT "confidence_picks_week_number_check" CHECK (("week_number" > 0))
);


ALTER TABLE "public"."confidence_picks" OWNER TO "postgres";


COMMENT ON TABLE "public"."confidence_picks" IS 'Confidence-pool picks: each weekly pick carries a confidence_points weight. Quiet outside season.';



CREATE TABLE IF NOT EXISTS "public"."cron_job_registry" (
    "jobid" bigint NOT NULL,
    "jobname" "text" NOT NULL,
    "first_seen" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cron_job_registry" OWNER TO "postgres";


COMMENT ON TABLE "public"."cron_job_registry" IS 'First time check_cron_job_health saw each pg_cron job. pg_cron itself stores no creation timestamp, so without this a brand-new job is indistinguishable from a job that has been silently failing to fire.';



CREATE TABLE IF NOT EXISTS "public"."leagues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "commissioner_id" "uuid" NOT NULL,
    "draft_status" "public"."draft_status" DEFAULT 'not_started'::"public"."draft_status" NOT NULL,
    "join_code" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "roster_size" integer DEFAULT 21 NOT NULL,
    "draft_rounds" integer DEFAULT 21 NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scoring_settings" "jsonb" DEFAULT '{"goalie": {"wins": 4, "saves": 0.2, "shutouts": 3, "goals_against": -1}, "skater": {"hits": 0.2, "goals": 3, "blocks": 0.5, "assists": 2, "shots_on_goal": 0.4, "penalty_minutes": 0.5, "power_play_points": 1, "short_handed_points": 2}, "advanced": {"assist_per_goal_ratio": 0.0, "use_fractional_scoring": false, "shooting_percentage_bonus": 0.0}}'::"jsonb",
    "league_size" integer,
    "roster_slots" "jsonb" DEFAULT '{"C": 2, "D": 4, "G": 2, "LW": 2, "RW": 2}'::"jsonb",
    "waiver_process_time" time without time zone DEFAULT '03:00:00'::time without time zone,
    "waiver_period_hours" integer DEFAULT 48,
    "waiver_game_lock" boolean DEFAULT true,
    "waiver_type" "text" DEFAULT 'rolling'::"text",
    "allow_trades_during_games" boolean DEFAULT true,
    "scheduled_draft_time" timestamp with time zone,
    "trade_review_type" "text" DEFAULT 'none'::"text",
    "trade_review_period_hours" integer DEFAULT 48,
    "trade_veto_threshold" numeric DEFAULT 0.5,
    "pool_status" "text" DEFAULT 'active'::"text",
    "pool_winner_id" "uuid",
    "pool_winner_declared_at" timestamp with time zone,
    CONSTRAINT "leagues_pool_status_check" CHECK (("pool_status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"]))),
    CONSTRAINT "leagues_trade_review_type_check" CHECK (("trade_review_type" = ANY (ARRAY['none'::"text", 'commissioner'::"text", 'league_vote'::"text"]))),
    CONSTRAINT "leagues_trade_veto_threshold_check" CHECK ((("trade_veto_threshold" > (0)::numeric) AND ("trade_veto_threshold" <= (1)::numeric))),
    CONSTRAINT "leagues_waiver_type_check" CHECK (("waiver_type" = ANY (ARRAY['rolling'::"text", 'reverse_draft_order'::"text", 'reverse_standings'::"text", 'faab'::"text"])))
);


ALTER TABLE "public"."leagues" OWNER TO "postgres";


COMMENT ON TABLE "public"."leagues" IS 'A league is visible to its commissioner (league_select_commissioner), to anyone holding a team in it (league_select_team_owner), and to everyone for the single demo league. Joining by code does NOT require visibility: join_league_with_code() is SECURITY DEFINER and resolves the code as the owner.';



COMMENT ON COLUMN "public"."leagues"."settings" IS 'JSONB league configuration. Includes: leagueType, scoringFormat, draftType, teamsCount, stats, rosterSlots, faabBudget, keeperEnabled, keeperCount, bestBallEnabled, tradeReviewType, tradeExpirationDays, tradeVetoThreshold, weeklyAddLimit (0=unlimited), seasonAddLimit (0=unlimited), and more. See LeagueFormatSettings type in src/types/leagueTypes.ts for full schema.';



COMMENT ON COLUMN "public"."leagues"."scoring_settings" IS 'Flexible scoring configuration per league. Supports skater/goalie distinction and advanced fractional scoring options.';



COMMENT ON COLUMN "public"."leagues"."league_size" IS 'Number of teams in the league. Used for dynamic replacement level calculation: replacement_index = (league_size × roster_slots[position]) + 1';



COMMENT ON COLUMN "public"."leagues"."roster_slots" IS 'JSONB object mapping positions to roster slot counts. Example: {"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 2}. Used with league_size to calculate dynamic replacement levels for VOPA.';



COMMENT ON COLUMN "public"."leagues"."waiver_process_time" IS 'Time of day (EST) when waiver claims are processed';



COMMENT ON COLUMN "public"."leagues"."waiver_period_hours" IS 'Hours a dropped player remains on waivers (default 48 = 2 days)';



COMMENT ON COLUMN "public"."leagues"."waiver_game_lock" IS 'If true, players cannot be picked up while their game is in progress or just finished';



COMMENT ON COLUMN "public"."leagues"."waiver_type" IS 'Commissioner-chosen waiver model. rolling = priority list seeded in join order; reverse_draft_order = priority list seeded so the last round-one pick holds priority 1; reverse_standings = recomputed weekly from the standings, worst record first; faab = budget bidding. Changing it reseeds the league via tg_reseed_waiver_priority_on_setting_change, provided no claims are pending.';



COMMENT ON COLUMN "public"."leagues"."allow_trades_during_games" IS 'If true, trades can involve locked players (default: trades bypass game lock)';



CREATE TABLE IF NOT EXISTS "public"."roster_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "player_id" "text" NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roster_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."roster_assignments" IS 'Single source of truth for roster membership. Replaces deleted_at=NULL queries on draft_picks.';



CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "owner_id" "uuid",
    "team_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


COMMENT ON TABLE "public"."teams" IS 'A fantasy roster within a league. owner_id NULL means an AI-managed team, which is why roster paths that look teams up by owner_id must handle NULL explicitly.';



CREATE OR REPLACE VIEW "public"."current_rosters" WITH ("security_invoker"='on') AS
 SELECT "ra"."id" AS "assignment_id",
    "ra"."league_id",
    "l"."name" AS "league_name",
    "ra"."team_id",
    "t"."team_name",
    "t"."owner_id",
    "ra"."player_id",
    "ra"."acquired_at",
    "ra"."created_at"
   FROM (("public"."roster_assignments" "ra"
     JOIN "public"."leagues" "l" ON (("l"."id" = "ra"."league_id")))
     JOIN "public"."teams" "t" ON (("t"."id" = "ra"."team_id")))
  ORDER BY "l"."name", "t"."team_name", "ra"."acquired_at";


ALTER VIEW "public"."current_rosters" OWNER TO "postgres";


COMMENT ON VIEW "public"."current_rosters" IS 'Convenience view for querying current roster state with league/team names.';



CREATE TABLE IF NOT EXISTS "public"."draft_order" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "round_number" integer NOT NULL,
    "team_order" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "draft_session_id" "uuid",
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."draft_order" OWNER TO "postgres";


COMMENT ON TABLE "public"."draft_order" IS 'Per-round pick order for a draft session. deleted_at supports soft reset without destroying history.';



CREATE TABLE IF NOT EXISTS "public"."draft_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "round_number" integer NOT NULL,
    "pick_number" integer NOT NULL,
    "team_id" "uuid" NOT NULL,
    "player_id" "text" NOT NULL,
    "picked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "draft_session_id" "uuid",
    "deleted_at" timestamp with time zone,
    "reserved_by" "uuid",
    "reserved_at" timestamp with time zone,
    "reservation_expires_at" timestamp with time zone
);


ALTER TABLE "public"."draft_picks" OWNER TO "postgres";


COMMENT ON TABLE "public"."draft_picks" IS 'Completed draft selections. draft_session_id scopes a run so a league can be re-drafted; deleted_at soft-deletes a reset session rather than erasing it.';



CREATE TABLE IF NOT EXISTS "public"."faab_budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "initial_budget" numeric DEFAULT 100 NOT NULL,
    "remaining_budget" numeric DEFAULT 100 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "faab_budgets_initial_budget_check" CHECK (("initial_budget" > (0)::numeric)),
    CONSTRAINT "faab_budgets_remaining_budget_check" CHECK (("remaining_budget" >= (0)::numeric))
);


ALTER TABLE "public"."faab_budgets" OWNER TO "postgres";


COMMENT ON TABLE "public"."faab_budgets" IS 'Free-agent acquisition budget per team for FAAB leagues. NOTE: no pg_cron job is currently registered for process_all_faab_waivers(), so FAAB waivers do not process automatically.';



CREATE TABLE IF NOT EXISTS "public"."failed_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid",
    "team_id" "uuid",
    "user_id" "uuid",
    "operation_type" "text",
    "player_id" "text",
    "error_message" "text",
    "error_detail" "text",
    "attempted_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."failed_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."failed_transactions" IS 'Logs all failed roster transactions for debugging and audit purposes.';



CREATE TABLE IF NOT EXISTS "public"."fantasy_daily_rosters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "matchup_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "roster_date" "date" NOT NULL,
    "slot_type" "text" NOT NULL,
    "slot_id" "text",
    "is_locked" boolean DEFAULT false NOT NULL,
    "locked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'reconstructed'::"text" NOT NULL,
    CONSTRAINT "fantasy_daily_rosters_slot_type_check" CHECK (("slot_type" = ANY (ARRAY['active'::"text", 'bench'::"text", 'ir'::"text"]))),
    CONSTRAINT "fantasy_daily_rosters_source_check" CHECK (("source" = ANY (ARRAY['scheduled_snapshot'::"text", 'user_edit'::"text", 'reconstructed'::"text"])))
);


ALTER TABLE "public"."fantasy_daily_rosters" OWNER TO "postgres";


COMMENT ON TABLE "public"."fantasy_daily_rosters" IS 'Per-day roster snapshots consumed by calculate_daily_matchup_scores (INNER JOIN, no fallback). WARNING: as of 2026-08-05 there is NO scheduled writer. Rows are lazily materialised by MatchupService.backfillDailyRostersIfMissing() when a user opens the Matchup page, which fabricates past dates from the CURRENT team_lineups. Check the source column before trusting any row. Tracked in 0F-ROSTER-2.';



COMMENT ON COLUMN "public"."fantasy_daily_rosters"."roster_date" IS 'Date of the roster snapshot (Sunday-Saturday of matchup week)';



COMMENT ON COLUMN "public"."fantasy_daily_rosters"."slot_type" IS 'Where player was on this date: active (in starting lineup), bench, or ir';



COMMENT ON COLUMN "public"."fantasy_daily_rosters"."is_locked" IS 'True once player''s game has started - prevents roster changes for that day';



COMMENT ON COLUMN "public"."fantasy_daily_rosters"."locked_at" IS 'Timestamp when the lock was applied (when game started)';



COMMENT ON COLUMN "public"."fantasy_daily_rosters"."source" IS 'Provenance of this roster row. scheduled_snapshot = captured on the day it applies, from the lineup then in force (trustworthy). user_edit = written by an explicit per-date lineup edit (trustworthy). reconstructed = built retroactively from a later lineup; the roster actually fielded on this date is NOT known and any score derived from it is unreliable. Added by 0F-ROSTER-3 after all 9,353 rows were proven to be retroactive bulk backfills -- 7,560 of them written in a single 2-minute burst covering 35 past game dates, with every team showing exactly one roster across all of them.';



CREATE TABLE IF NOT EXISTS "public"."fantasy_matchup_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "matchup_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "team_id" "uuid" NOT NULL,
    "total_points" numeric(10,3) DEFAULT 0 NOT NULL,
    "stats_breakdown" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "games_played" integer DEFAULT 0 NOT NULL,
    "games_remaining_total" integer DEFAULT 0 NOT NULL,
    "games_remaining_active" integer DEFAULT 0 NOT NULL,
    "has_live_game" boolean DEFAULT false NOT NULL,
    "live_game_locked" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fantasy_matchup_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."fantasy_matchup_lines" IS 'Pre-calculated fantasy points for each player in each matchup. Enables high-performance reads and detailed traceability.';



COMMENT ON COLUMN "public"."fantasy_matchup_lines"."total_points" IS 'Total fantasy points (NUMERIC(10,3) supports fractional scoring)';



COMMENT ON COLUMN "public"."fantasy_matchup_lines"."stats_breakdown" IS 'Detailed JSONB breakdown showing how points were calculated for traceability';



COMMENT ON COLUMN "public"."fantasy_matchup_lines"."games_remaining_total" IS 'Total games remaining for all rostered players';



COMMENT ON COLUMN "public"."fantasy_matchup_lines"."games_remaining_active" IS 'Games remaining for players in starting lineup only';



COMMENT ON COLUMN "public"."fantasy_matchup_lines"."live_game_locked" IS 'Prevents updates during live games to avoid user confusion';



CREATE TABLE IF NOT EXISTS "public"."function_error_log" (
    "id" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fn" "text" NOT NULL,
    "sqlstate" "text",
    "message" "text",
    "context" "text",
    "details" "jsonb",
    "user_id" "uuid"
);


ALTER TABLE "public"."function_error_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."function_error_log" IS 'Durable record of exceptions caught by blanket WHEN OTHERS handlers in plpgsql. Written by log_function_error(); watched by check_function_errors(). Exists because eight handlers used to swallow failures with no trace at all.';



ALTER TABLE "public"."function_error_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."function_error_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."goalie_gar" (
    "goalie_id" integer NOT NULL,
    "rebound_control_score" numeric,
    "primary_gsax_score" numeric,
    "total_gar" numeric NOT NULL,
    "calculated_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."goalie_gar" OWNER TO "postgres";


COMMENT ON TABLE "public"."goalie_gar" IS 'Combined G-GAR (Goals Above Replacement) metric for goalies. Combines Rebound Control and Primary Shots GSAx components.';



COMMENT ON COLUMN "public"."goalie_gar"."goalie_id" IS 'NHL player ID of goalie';



COMMENT ON COLUMN "public"."goalie_gar"."rebound_control_score" IS 'Standardized rebound control score (inverted z-score of AdjRP, higher is better)';



COMMENT ON COLUMN "public"."goalie_gar"."primary_gsax_score" IS 'Primary shots GSAx score (regressed GSAx for non-rebound shots)';



COMMENT ON COLUMN "public"."goalie_gar"."total_gar" IS 'Combined G-GAR = 0.3 × rebound_control_score + 0.7 × primary_gsax_score';



CREATE TABLE IF NOT EXISTS "public"."goalie_gsax" (
    "goalie_id" integer NOT NULL,
    "total_shots_faced" integer NOT NULL,
    "total_xga" numeric NOT NULL,
    "total_ga" integer NOT NULL,
    "raw_gsax" numeric NOT NULL,
    "regressed_gsax" numeric NOT NULL,
    "league_sv_pct" numeric,
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "season" integer DEFAULT 2025 NOT NULL
);


ALTER TABLE "public"."goalie_gsax" OWNER TO "postgres";


COMMENT ON TABLE "public"."goalie_gsax" IS 'Goals Saved Above Expected (GSAx) metrics for goaltenders. Includes both raw and Bayesian regressed values.';



COMMENT ON COLUMN "public"."goalie_gsax"."goalie_id" IS 'NHL goalie ID (opposing goalie who faced the shots)';



COMMENT ON COLUMN "public"."goalie_gsax"."total_shots_faced" IS 'Total number of shots faced (excluding empty-net shots)';



COMMENT ON COLUMN "public"."goalie_gsax"."total_xga" IS 'Total expected goals against (sum of shooting_talent_adjusted_xg)';



COMMENT ON COLUMN "public"."goalie_gsax"."total_ga" IS 'Total actual goals allowed';



COMMENT ON COLUMN "public"."goalie_gsax"."raw_gsax" IS 'Raw GSAx = total_xGA - total_GA (unadjusted for sample size)';



COMMENT ON COLUMN "public"."goalie_gsax"."regressed_gsax" IS 'Bayesian regressed GSAx (adjusted for sample size, shrinks low-sample goalies toward league average)';



COMMENT ON COLUMN "public"."goalie_gsax"."league_sv_pct" IS 'League average save percentage at time of calculation';



COMMENT ON COLUMN "public"."goalie_gsax"."season" IS 'NHL season year (e.g., 2024 for 2024-25 season).';



CREATE TABLE IF NOT EXISTS "public"."goalie_gsax_primary" (
    "goalie_id" integer NOT NULL,
    "total_shots_faced" integer NOT NULL,
    "total_xga" numeric NOT NULL,
    "total_ga" integer NOT NULL,
    "raw_gsax" numeric NOT NULL,
    "regressed_gsax" numeric NOT NULL,
    "league_sv_pct" numeric,
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "season" integer
);


ALTER TABLE "public"."goalie_gsax_primary" OWNER TO "postgres";


COMMENT ON TABLE "public"."goalie_gsax_primary" IS 'GSAx metrics for PRIMARY SHOTS ONLY (excludes rebounds). Component 2 of G-GAR model.';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."goalie_id" IS 'NHL goalie ID';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."total_shots_faced" IS 'Total primary shots faced (non-rebounds, excluding empty-net)';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."total_xga" IS 'Total expected goals against (primary shots only)';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."total_ga" IS 'Total actual goals allowed (primary shots only)';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."raw_gsax" IS 'Raw GSAx for primary shots = total_xGA - total_GA';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."regressed_gsax" IS 'Bayesian regressed GSAx for primary shots (C=500)';



COMMENT ON COLUMN "public"."goalie_gsax_primary"."league_sv_pct" IS 'League average save percentage (primary shots only)';



CREATE TABLE IF NOT EXISTS "public"."goalie_rebound_control" (
    "goalie_id" integer NOT NULL,
    "total_saves" integer DEFAULT 0 NOT NULL,
    "puck_freezes" integer DEFAULT 0 NOT NULL,
    "rebound_shots_allowed" integer DEFAULT 0 NOT NULL,
    "effective_saves" integer DEFAULT 0 NOT NULL,
    "adj_rebound_pct" numeric,
    "rebound_shots_per_60_saves" numeric,
    "calculated_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."goalie_rebound_control" OWNER TO "postgres";


COMMENT ON TABLE "public"."goalie_rebound_control" IS 'Goalie rebound control component (AdjRP) for G-GAR model. Lower AdjRP = better rebound control.';



COMMENT ON COLUMN "public"."goalie_rebound_control"."goalie_id" IS 'NHL player ID of goalie';



COMMENT ON COLUMN "public"."goalie_rebound_control"."total_saves" IS 'Total number of saves (shots on goal that did not score)';



COMMENT ON COLUMN "public"."goalie_rebound_control"."puck_freezes" IS 'Number of times goalie froze puck after save';



COMMENT ON COLUMN "public"."goalie_rebound_control"."rebound_shots_allowed" IS 'Number of rebound shots allowed within 2 seconds of a save';



COMMENT ON COLUMN "public"."goalie_rebound_control"."effective_saves" IS 'Total saves minus puck freezes (denominator for AdjRP)';



COMMENT ON COLUMN "public"."goalie_rebound_control"."adj_rebound_pct" IS 'Adjusted Rebound Percentage = rebound_shots_allowed / effective_saves. Lower is better.';



COMMENT ON COLUMN "public"."goalie_rebound_control"."rebound_shots_per_60_saves" IS 'Rebound shots allowed per 60 saves (normalized rate)';



CREATE TABLE IF NOT EXISTS "public"."goalie_xg_season" (
    "season" integer NOT NULL,
    "game_type" "text" NOT NULL,
    "goalie_id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "shots_faced" integer NOT NULL,
    "sog_faced" integer NOT NULL,
    "goals_allowed" integer NOT NULL,
    "xg_faced" double precision NOT NULL,
    "gsax" double precision NOT NULL,
    "xg_faced_ev" double precision NOT NULL,
    "goals_allowed_ev" integer NOT NULL,
    "xg_faced_pk" double precision NOT NULL,
    "goals_allowed_pk" integer NOT NULL,
    "avg_shot_dist_faced" double precision,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."goalie_xg_season" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrity_check_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_time" timestamp with time zone DEFAULT "now"(),
    "check_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "details" "text",
    "affected_teams" "text"[],
    "auto_fixed" boolean DEFAULT false,
    CONSTRAINT "integrity_check_results_status_check" CHECK (("status" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'warning'::"text"])))
);


ALTER TABLE "public"."integrity_check_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."integrity_check_results" IS 'Output of the data-integrity cron (job 3, every 6h) and auto-fix cron (job 4, daily). Operational telemetry only — no business data. Retained 90 days by the audit-log-retention job.';



CREATE TABLE IF NOT EXISTS "public"."join_code_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "attempt_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "join_code" "text" NOT NULL,
    "success" boolean DEFAULT false NOT NULL,
    "ip_address" "inet",
    "user_agent" "text"
);


ALTER TABLE "public"."join_code_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."join_code_attempts" IS 'Audit trail of league join-code attempts, successful and failed, with IP and user agent. Abuse/brute-force forensics for leagues.join_code.';



CREATE TABLE IF NOT EXISTS "public"."keeper_designations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "player_id" "text" NOT NULL,
    "season_year" integer NOT NULL,
    "keeper_round" integer,
    "keeper_penalty_type" "text" DEFAULT 'none'::"text",
    "original_draft_round" integer,
    "years_kept" integer DEFAULT 1 NOT NULL,
    "designated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_by" "uuid",
    "status" "text" DEFAULT 'designated'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "keeper_designations_keeper_penalty_type_check" CHECK (("keeper_penalty_type" = ANY (ARRAY['none'::"text", 'round-cost'::"text", 'round-escalation'::"text"]))),
    CONSTRAINT "keeper_designations_status_check" CHECK (("status" = ANY (ARRAY['designated'::"text", 'approved'::"text", 'released'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."keeper_designations" OWNER TO "postgres";


COMMENT ON TABLE "public"."keeper_designations" IS 'Players designated as keepers into the next season, with the round/penalty cost of keeping them. Quiet outside the keeper window.';



CREATE TABLE IF NOT EXISTS "public"."league_averages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position" "text" NOT NULL,
    "season" integer NOT NULL,
    "avg_ppg" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_goals_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_assists_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_sog_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_blocks_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "sample_size" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "league_avg_sv_pct" numeric(5,3),
    "league_avg_xga_per_60" numeric(5,3),
    "league_avg_shots_for_per_60" numeric(5,3),
    "replacement_fpts_per_60" numeric(5,3),
    "std_dev_fpts_per_60" numeric(5,3),
    "replacement_goals_per_game" numeric(5,3),
    "replacement_assists_per_game" numeric(5,3),
    "replacement_sog_per_game" numeric(5,3),
    "replacement_blocks_per_game" numeric(5,3),
    "std_dev_goals_per_game" numeric(5,3),
    "std_dev_assists_per_game" numeric(5,3),
    "std_dev_sog_per_game" numeric(5,3),
    "std_dev_blocks_per_game" numeric(5,3),
    "avg_ppp_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_shp_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_hits_per_game" numeric(5,3) DEFAULT 0 NOT NULL,
    "avg_pim_per_game" numeric(5,3) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."league_averages" OWNER TO "postgres";


COMMENT ON TABLE "public"."league_averages" IS 'Position-specific league averages for Bayesian shrinkage in Citrus Projections 2.0. Used as baseline when player sample size is small.';



COMMENT ON COLUMN "public"."league_averages"."avg_ppg" IS 'Average fantasy points per game for this position (calculated from player_season_stats)';



COMMENT ON COLUMN "public"."league_averages"."sample_size" IS 'Number of players used in calculation (for transparency and confidence scoring)';



COMMENT ON COLUMN "public"."league_averages"."league_avg_sv_pct" IS 'League-wide goalie save percentage (weighted by shots_faced). Used for goalie SV% shrinkage and DDR calculations.';



COMMENT ON COLUMN "public"."league_averages"."league_avg_xga_per_60" IS 'League-wide expected goals against per 60 minutes (average across all teams). Used for DDR opponent strength calculations.';



COMMENT ON COLUMN "public"."league_averages"."league_avg_shots_for_per_60" IS 'League-wide shots for per 60 minutes (optional, for future goalie saves projection).';



COMMENT ON COLUMN "public"."league_averages"."replacement_fpts_per_60" IS '25th percentile fantasy points per 60 minutes (replacement level baseline)';



COMMENT ON COLUMN "public"."league_averages"."std_dev_fpts_per_60" IS 'Standard deviation of fantasy points per 60 minutes (for Z-Score normalization)';



COMMENT ON COLUMN "public"."league_averages"."replacement_goals_per_game" IS '25th percentile goals per game (replacement level)';



COMMENT ON COLUMN "public"."league_averages"."replacement_assists_per_game" IS '25th percentile assists per game (replacement level)';



COMMENT ON COLUMN "public"."league_averages"."replacement_sog_per_game" IS '25th percentile shots on goal per game (replacement level)';



COMMENT ON COLUMN "public"."league_averages"."replacement_blocks_per_game" IS '25th percentile blocks per game (replacement level)';



COMMENT ON COLUMN "public"."league_averages"."avg_ppp_per_game" IS 'Average powerplay points per game for this position (calculated from player_season_stats.ppp)';



COMMENT ON COLUMN "public"."league_averages"."avg_shp_per_game" IS 'Average shorthanded points per game for this position (calculated from player_season_stats.shp)';



COMMENT ON COLUMN "public"."league_averages"."avg_hits_per_game" IS 'Average hits per game for this position (calculated from player_season_stats.hits)';



COMMENT ON COLUMN "public"."league_averages"."avg_pim_per_game" IS 'Average penalty minutes per game for this position (calculated from player_season_stats.pim)';



CREATE TABLE IF NOT EXISTS "public"."league_scoring_audit" (
    "id" bigint NOT NULL,
    "league_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "old_scoring" "jsonb",
    "new_scoring" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."league_scoring_audit" OWNER TO "postgres";


COMMENT ON TABLE "public"."league_scoring_audit" IS 'Change log of league scoring settings: who changed them, old and new jsonb.';



CREATE SEQUENCE IF NOT EXISTS "public"."league_scoring_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."league_scoring_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."league_scoring_audit_id_seq" OWNED BY "public"."league_scoring_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."league_scoring_rules" (
    "league_id" "uuid" NOT NULL,
    "stat_key" "text" NOT NULL,
    "multiplier" numeric NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."league_scoring_rules" OWNER TO "postgres";


COMMENT ON TABLE "public"."league_scoring_rules" IS 'Per-league scoring weights. league_id 00000000-0000-0000-0000-000000000000 is the explicit global default, replacing defaults that were previously hardcoded in calculate_daily_matchup_scores.';



CREATE TABLE IF NOT EXISTS "public"."matchup_scoring_snapshots" (
    "matchup_id" "uuid" NOT NULL,
    "league_id" "uuid" NOT NULL,
    "rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."matchup_scoring_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."matchup_scoring_snapshots" IS 'Immutable copy of a league scoring ruleset captured at matchup creation, so historical matchups keep scoring under the rules in force at the time even if the league later changes settings.';



CREATE TABLE IF NOT EXISTS "public"."matchups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "week_number" integer NOT NULL,
    "team1_id" "uuid" NOT NULL,
    "team2_id" "uuid",
    "team1_score" numeric DEFAULT 0 NOT NULL,
    "team2_score" numeric DEFAULT 0 NOT NULL,
    "status" "public"."matchup_status" DEFAULT 'scheduled'::"public"."matchup_status" NOT NULL,
    "week_start_date" "date" NOT NULL,
    "week_end_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "matchups_check" CHECK ((("team1_id" <> "team2_id") OR ("team2_id" IS NULL)))
);


ALTER TABLE "public"."matchups" OWNER TO "postgres";


COMMENT ON TABLE "public"."matchups" IS 'Weekly head-to-head pairings and their scores. Auto-completed and rescored by database functions rather than the application.';



CREATE TABLE IF NOT EXISTS "public"."nhl_game_arena" (
    "game_id" bigint NOT NULL,
    "season" integer NOT NULL,
    "home_team" integer NOT NULL
);


ALTER TABLE "public"."nhl_game_arena" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nhl_games" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" integer NOT NULL,
    "game_date" "date" NOT NULL,
    "game_time" timestamp with time zone,
    "home_team" "text" NOT NULL,
    "away_team" "text" NOT NULL,
    "home_score" integer DEFAULT 0,
    "away_score" integer DEFAULT 0,
    "status" "text" DEFAULT 'scheduled'::"text",
    "period" "text",
    "period_time" "text",
    "venue" "text",
    "season" integer NOT NULL,
    "game_type" "text" DEFAULT 'regular'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "home_team_id" integer,
    "away_team_id" integer,
    "moneyline_home" integer,
    "moneyline_away" integer,
    "implied_win_probability_home" numeric(4,3),
    "implied_win_probability_away" numeric(4,3),
    "playoff_round" smallint,
    "series_id" "uuid",
    "series_game_number" smallint
);


ALTER TABLE "public"."nhl_games" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_games" IS 'NHL game schedule and results, including Vegas odds columns. Source of truth for game_date used by scoring.';



COMMENT ON COLUMN "public"."nhl_games"."moneyline_home" IS 'Vegas moneyline for home team (e.g., -150 for favorite, +130 for underdog)';



COMMENT ON COLUMN "public"."nhl_games"."moneyline_away" IS 'Vegas moneyline for away team';



COMMENT ON COLUMN "public"."nhl_games"."implied_win_probability_home" IS 'Calculated win probability from moneyline_home (0.0 to 1.0)';



COMMENT ON COLUMN "public"."nhl_games"."implied_win_probability_away" IS 'Calculated win probability from moneyline_away (0.0 to 1.0)';



CREATE TABLE IF NOT EXISTS "public"."nhl_games_retired_phantoms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" integer NOT NULL,
    "game_date" "date" NOT NULL,
    "game_time" timestamp with time zone,
    "home_team" "text" NOT NULL,
    "away_team" "text" NOT NULL,
    "home_score" integer DEFAULT 0,
    "away_score" integer DEFAULT 0,
    "status" "text" DEFAULT 'scheduled'::"text",
    "period" "text",
    "period_time" "text",
    "venue" "text",
    "season" integer NOT NULL,
    "game_type" "text" DEFAULT 'regular'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "home_team_id" integer,
    "away_team_id" integer,
    "moneyline_home" integer,
    "moneyline_away" integer,
    "implied_win_probability_home" numeric(4,3),
    "implied_win_probability_away" numeric(4,3),
    "playoff_round" smallint,
    "series_id" "uuid",
    "series_game_number" smallint
);


ALTER TABLE "public"."nhl_games_retired_phantoms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."nhl_games_retired_phantoms"."moneyline_home" IS 'Vegas moneyline for home team (e.g., -150 for favorite, +130 for underdog)';



COMMENT ON COLUMN "public"."nhl_games_retired_phantoms"."moneyline_away" IS 'Vegas moneyline for away team';



COMMENT ON COLUMN "public"."nhl_games_retired_phantoms"."implied_win_probability_home" IS 'Calculated win probability from moneyline_home (0.0 to 1.0)';



COMMENT ON COLUMN "public"."nhl_games_retired_phantoms"."implied_win_probability_away" IS 'Calculated win probability from moneyline_away (0.0 to 1.0)';



CREATE TABLE IF NOT EXISTS "public"."nhl_pipeline_meta" (
    "key" "text" NOT NULL,
    "last_refresh" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nhl_pipeline_meta" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_pipeline_meta" IS 'Key/last_refresh watermarks for pipeline freshness checks. Four rows.';



CREATE TABLE IF NOT EXISTS "public"."nhl_player_identity" (
    "player_id" integer NOT NULL,
    "full_name" "text" NOT NULL,
    "position_code" "text",
    "primary_position" "text",
    "first_season" integer NOT NULL,
    "last_season" integer NOT NULL,
    "seasons_played" integer NOT NULL,
    "games_played" integer NOT NULL,
    "teams" "text"[] NOT NULL,
    "last_team" "text",
    "last_sweater" integer,
    "is_goalie" boolean NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "headshot_url" "text",
    "short_name" "text"
);


ALTER TABLE "public"."nhl_player_identity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nhl_player_names" (
    "player_id" integer NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "headshot_url" "text",
    "position_code" "text",
    "last_seen_season" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nhl_player_names" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nhl_playoff_seeds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season" integer NOT NULL,
    "conference" "text" NOT NULL,
    "division" "text" NOT NULL,
    "seed" smallint NOT NULL,
    "team_id" integer NOT NULL,
    "team_abbrev" "text",
    "wins" smallint,
    "losses" smallint,
    "ot_losses" smallint,
    "points" smallint,
    "row_wins" smallint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "nhl_playoff_seeds_conference_check" CHECK (("conference" = ANY (ARRAY['Eastern'::"text", 'Western'::"text"]))),
    CONSTRAINT "nhl_playoff_seeds_division_check" CHECK (("division" = ANY (ARRAY['Atlantic'::"text", 'Metropolitan'::"text", 'Central'::"text", 'Pacific'::"text", 'WildCard'::"text"]))),
    CONSTRAINT "nhl_playoff_seeds_seed_check" CHECK ((("seed" >= 1) AND ("seed" <= 8)))
);


ALTER TABLE "public"."nhl_playoff_seeds" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_playoff_seeds" IS 'REAL NHL playoff seeding by conference/division. Distinct from playoff_seeds, which is fantasy-league bracket seeding.';



CREATE TABLE IF NOT EXISTS "public"."nhl_playoff_series" (
    "series_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season" integer NOT NULL,
    "round" smallint NOT NULL,
    "conference" "text",
    "bracket_slot" smallint NOT NULL,
    "parent_slot_a" smallint,
    "parent_slot_b" smallint,
    "high_seed_team_id" integer,
    "low_seed_team_id" integer,
    "high_seed_wins" smallint DEFAULT 0 NOT NULL,
    "low_seed_wins" smallint DEFAULT 0 NOT NULL,
    "winner_team_id" integer,
    "games_played" smallint DEFAULT 0 NOT NULL,
    "series_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "starts_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "nhl_playoff_series_conference_check" CHECK (("conference" = ANY (ARRAY['Eastern'::"text", 'Western'::"text"]))),
    CONSTRAINT "nhl_playoff_series_round_check" CHECK ((("round" >= 1) AND ("round" <= 4))),
    CONSTRAINT "nhl_playoff_series_series_status_check" CHECK (("series_status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'final'::"text"])))
);


ALTER TABLE "public"."nhl_playoff_series" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_playoff_series" IS 'REAL NHL playoff series with bracket slot wiring (parent_slot_a/b). Distinct from playoff_series, which is fantasy.';



CREATE TABLE IF NOT EXISTS "public"."nhl_rink_cdf" (
    "coord" "text" NOT NULL,
    "home_team" integer NOT NULL,
    "season" integer NOT NULL,
    "v" integer NOT NULL,
    "cdf_mid" double precision NOT NULL,
    "n_group" integer NOT NULL
);


ALTER TABLE "public"."nhl_rink_cdf" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_rink_cdf" IS 'Per arena-season empirical mid-rank CDF of x_norm/y_norm. Input to rink bias adjustment; auditable by construction.';



CREATE TABLE IF NOT EXISTS "public"."nhl_rink_ref_knots" (
    "coord" "text" NOT NULL,
    "k" integer NOT NULL,
    "v" double precision NOT NULL
);


ALTER TABLE "public"."nhl_rink_ref_knots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nhl_shots" (
    "game_id" integer NOT NULL,
    "event_id" integer NOT NULL,
    "season" integer NOT NULL,
    "game_date" "date",
    "game_type" "text" NOT NULL,
    "period" integer,
    "period_type" "text",
    "seconds_elapsed" integer,
    "shooter_id" integer,
    "goalie_id" integer,
    "team_id" integer,
    "is_home" boolean,
    "x_raw" numeric,
    "y_raw" numeric,
    "x_norm" numeric,
    "y_norm" numeric,
    "distance" numeric,
    "angle" numeric,
    "shot_type" "text",
    "event_type" "text" NOT NULL,
    "is_goal" boolean NOT NULL,
    "own_skaters" integer,
    "opp_skaters" integer,
    "own_goalie" integer,
    "opp_goalie" integer,
    "strength_state" "text",
    "is_power_play" boolean,
    "is_shorthanded" boolean,
    "is_empty_net" boolean,
    "score_diff" integer,
    "assist1_id" integer,
    "assist2_id" integer,
    "prev_event_type" "text",
    "prev_x" numeric,
    "prev_y" numeric,
    "seconds_since_prev" numeric,
    "distance_from_prev" numeric,
    "is_rebound" boolean,
    "is_rush" boolean,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "x_adj" double precision,
    "y_adj" double precision,
    "distance_adj" double precision,
    "angle_adj" double precision,
    "xg_sql" double precision,
    "strength_source" "text" DEFAULT 'pbp_situation_code'::"text" NOT NULL,
    "is_penalty_shot" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."nhl_shots" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_shots" IS 'Shot-level source of truth for the shipped xG model (xg_sql). RLS is enabled with NO policy, so it is deny-all to end-user roles by design, and the SELECT grant has been revoked so an attempt errors instead of silently returning []. Reach it through SECURITY DEFINER functions (get_matchup_stats, populate_player_weekly_stats) or service_role.';



CREATE OR REPLACE VIEW "public"."nhl_shot_features" AS
 SELECT "game_id",
    "event_id",
    "season",
    "game_date",
    "game_type",
    "shooter_id",
    "goalie_id",
    "team_id",
    "is_home",
    "is_goal",
    COALESCE("distance_adj", ("distance")::double precision) AS "f_dist",
    "abs"(COALESCE("angle_adj", ("angle")::double precision)) AS "f_ang",
    "x_adj" AS "f_x",
    "abs"("y_adj") AS "f_yabs",
    ("x_adj" > (89)::double precision) AS "f_behind_net",
        CASE
            WHEN ("shot_type" IS NULL) THEN 'wrist'::"text"
            WHEN ("shot_type" = ANY (ARRAY['bat'::"text", 'poke'::"text", 'cradle'::"text", 'between-legs'::"text"])) THEN 'tip-in'::"text"
            ELSE "shot_type"
        END AS "f_type",
        CASE
            WHEN (("prev_event_type" IS NULL) OR ("prev_event_type" = ANY (ARRAY['stoppage'::"text", 'period-end'::"text", 'period-start'::"text", 'game-end'::"text", 'goal'::"text"]))) THEN 'faceoff'::"text"
            WHEN ("prev_event_type" = 'delayed-penalty'::"text") THEN 'penalty'::"text"
            ELSE "prev_event_type"
        END AS "f_prev",
    LEAST(COALESCE("seconds_since_prev", (120)::numeric), (120)::numeric) AS "f_sec_prev",
    LEAST(COALESCE("distance_from_prev", (200)::numeric), (200)::numeric) AS "f_dist_prev",
    (("prev_event_type" = ANY (ARRAY['shot-on-goal'::"text", 'missed-shot'::"text", 'blocked-shot'::"text"])) AND ("seconds_since_prev" <= (3)::numeric)) AS "f_rebound",
    COALESCE("is_rush", false) AS "f_rush",
    COALESCE((("seconds_since_prev" <= (4)::numeric) AND ("prev_x" IS NOT NULL) AND ("x_raw" IS NOT NULL) AND ("y_raw" IS NOT NULL) AND ("sign"("prev_x") = "sign"(NULLIF("x_raw", (0)::numeric))) AND ("abs"("prev_x") >= (25)::numeric) AND ("sign"("prev_y") = (- "sign"(NULLIF("y_raw", (0)::numeric)))) AND ("abs"("prev_y") >= (3)::numeric) AND ("abs"("y_raw") >= (3)::numeric)), false) AS "f_royal_road",
    "is_penalty_shot" AS "f_penalty_shot",
    "own_skaters",
    "opp_skaters",
    "own_goalie",
    "opp_goalie",
    ("opp_goalie" = 0) AS "f_en_for",
    (("own_goalie" = 0) AND (NOT "is_penalty_shot")) AS "f_en_against",
        CASE
            WHEN "is_penalty_shot" THEN 'PS'::"text"
            WHEN ("opp_goalie" = 0) THEN 'EN_for'::"text"
            WHEN ("own_goalie" = 0) THEN 'EN_against'::"text"
            WHEN "is_power_play" THEN 'PP'::"text"
            WHEN "is_shorthanded" THEN 'PK'::"text"
            WHEN ("own_skaters" = 3) THEN '3v3'::"text"
            WHEN ("own_skaters" = 4) THEN '4v4'::"text"
            ELSE 'EV'::"text"
        END AS "f_strength",
    "strength_source",
    GREATEST('-3'::integer, LEAST(3, "score_diff")) AS "f_score_diff",
    LEAST(4, "period") AS "f_period",
    "seconds_elapsed" AS "f_sec_elapsed",
    ("game_type" = 'playoff'::"text") AS "f_playoff"
   FROM "public"."nhl_shots" "s"
  WHERE (("distance" IS NOT NULL) AND ("angle" IS NOT NULL) AND ("strength_source" <> 'phantom_pbp_goal_excluded'::"text"));


ALTER VIEW "public"."nhl_shot_features" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."nhl_shot_fold" AS
 SELECT "game_id",
    "event_id",
    ((((('x'::"text" || "substr"("md5"(((("game_id")::"text" || ':'::"text") || ("event_id")::"text")), 1, 8)))::bit(32))::integer & 2147483647) % 5) AS "fold_id"
   FROM "public"."nhl_shots";


ALTER VIEW "public"."nhl_shot_fold" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nhl_teams" (
    "team_id" integer NOT NULL,
    "name" "text" NOT NULL,
    "abbreviation" "text" NOT NULL,
    "city" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nhl_teams" OWNER TO "postgres";


COMMENT ON TABLE "public"."nhl_teams" IS 'NHL franchise reference: id, name, abbreviation, city. Join key for team_abbrev across stats tables.';



CREATE TABLE IF NOT EXISTS "public"."nhl_xg_sql_cells" (
    "fold" smallint NOT NULL,
    "lvl" smallint NOT NULL,
    "ckey" "text" NOT NULL,
    "n" integer NOT NULL,
    "k" integer NOT NULL,
    "rate" double precision NOT NULL
);


ALTER TABLE "public"."nhl_xg_sql_cells" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."nhl_xg_sql_keys" AS
 SELECT "game_id",
    "event_id",
    "season",
    "game_date",
    "game_type",
    "shooter_id",
    "goalie_id",
    "team_id",
    "is_home",
    "is_goal",
    "f_dist",
    "f_ang",
    "f_x",
    "f_yabs",
    "f_behind_net",
    "f_type",
    "f_prev",
    "f_sec_prev",
    "f_dist_prev",
    "f_rebound",
    "f_rush",
    "f_royal_road",
    "f_penalty_shot",
    "own_skaters",
    "opp_skaters",
    "own_goalie",
    "opp_goalie",
    "f_en_for",
    "f_en_against",
    "f_strength",
    "strength_source",
    "f_score_diff",
    "f_period",
    "f_sec_elapsed",
    "f_playoff",
    "db",
    "ab",
    "ctx",
    "rr",
    "strc",
    "dbc",
    "psb",
    "t3d",
    "t3a",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ('E|'::"text" || "dbc")
            WHEN ("f_strength" = '3v3'::"text") THEN ((('T|'::"text" || "t3d") || '|'::"text") || "t3a")
            ELSE ((('G|'::"text" || "db") || '|'::"text") || "ab")
        END AS "k1",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx")
            ELSE ((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type")
        END AS "k2",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx")
            ELSE ((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx")
        END AS "k3",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx") || '|'::"text") || "rr")
            ELSE ((((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx") || '|'::"text") || "rr")
        END AS "k4",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx") || '|'::"text") || "rr")
            ELSE ((((((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx") || '|'::"text") || "rr") || '|'::"text") || "strc")
        END AS "k5"
   FROM ( SELECT "f"."game_id",
            "f"."event_id",
            "f"."season",
            "f"."game_date",
            "f"."game_type",
            "f"."shooter_id",
            "f"."goalie_id",
            "f"."team_id",
            "f"."is_home",
            "f"."is_goal",
            "f"."f_dist",
            "f"."f_ang",
            "f"."f_x",
            "f"."f_yabs",
            "f"."f_behind_net",
            "f"."f_type",
            "f"."f_prev",
            "f"."f_sec_prev",
            "f"."f_dist_prev",
            "f"."f_rebound",
            "f"."f_rush",
            "f"."f_royal_road",
            "f"."f_penalty_shot",
            "f"."own_skaters",
            "f"."opp_skaters",
            "f"."own_goalie",
            "f"."opp_goalie",
            "f"."f_en_for",
            "f"."f_en_against",
            "f"."f_strength",
            "f"."strength_source",
            "f"."f_score_diff",
            "f"."f_period",
            "f"."f_sec_elapsed",
            "f"."f_playoff",
                CASE
                    WHEN ("f"."f_dist" < (20)::double precision) THEN ("floor"("f"."f_dist"))::integer
                    WHEN ("f"."f_dist" < (40)::double precision) THEN (20 + ("floor"((("f"."f_dist" - (20)::double precision) / (2)::double precision)))::integer)
                    WHEN ("f"."f_dist" < (70)::double precision) THEN (30 + ("floor"((("f"."f_dist" - (40)::double precision) / (5)::double precision)))::integer)
                    WHEN ("f"."f_dist" < (100)::double precision) THEN (36 + ("floor"((("f"."f_dist" - (70)::double precision) / (10)::double precision)))::integer)
                    ELSE 39
                END AS "db",
            LEAST(18, ("floor"(("f"."f_ang" / (5)::double precision)))::integer) AS "ab",
                CASE
                    WHEN ("f"."f_rebound" AND ("f"."f_sec_prev" <= (1)::numeric)) THEN 1
                    WHEN "f"."f_rebound" THEN 2
                    WHEN "f"."f_rush" THEN 3
                    ELSE 0
                END AS "ctx",
                CASE
                    WHEN "f"."f_royal_road" THEN 1
                    ELSE 0
                END AS "rr",
                CASE "f"."f_strength"
                    WHEN 'EV'::"text" THEN 0
                    WHEN 'PP'::"text" THEN 1
                    WHEN 'PK'::"text" THEN 2
                    WHEN '3v3'::"text" THEN 3
                    WHEN '4v4'::"text" THEN 4
                    WHEN 'EN_against'::"text" THEN 5
                    ELSE 6
                END AS "strc",
            LEAST(5, ("floor"(("f"."f_dist" / (20)::double precision)))::integer) AS "dbc",
            LEAST(2, ("floor"(("f"."f_dist" / (15)::double precision)))::integer) AS "psb",
            LEAST(7, ("floor"(("f"."f_dist" / (8)::double precision)))::integer) AS "t3d",
            LEAST(5, ("floor"(("f"."f_ang" / (15)::double precision)))::integer) AS "t3a"
           FROM "public"."nhl_shot_features" "f") "b";


ALTER VIEW "public"."nhl_xg_sql_keys" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."nhl_xg_sql_keys_exp" WITH ("security_invoker"='true') AS
 WITH "b" AS (
         SELECT "k"."game_id",
            "k"."event_id",
            "k"."season",
            "k"."game_date",
            "k"."game_type",
            "k"."shooter_id",
            "k"."goalie_id",
            "k"."team_id",
            "k"."is_home",
            "k"."is_goal",
            "k"."f_dist",
            "k"."f_ang",
            "k"."f_x",
            "k"."f_yabs",
            "k"."f_behind_net",
            "k"."f_type",
            "k"."f_prev",
            "k"."f_sec_prev",
            "k"."f_dist_prev",
            "k"."f_rebound",
            "k"."f_rush",
            "k"."f_royal_road",
            "k"."f_penalty_shot",
            "k"."own_skaters",
            "k"."opp_skaters",
            "k"."own_goalie",
            "k"."opp_goalie",
            "k"."f_en_for",
            "k"."f_en_against",
            "k"."f_strength",
            "k"."strength_source",
            "k"."f_score_diff",
            "k"."f_period",
            "k"."f_sec_elapsed",
            "k"."f_playoff",
            "k"."db",
            "k"."ab",
            "k"."ctx",
            "k"."rr",
            "k"."strc",
            "k"."dbc",
            "k"."psb",
            "k"."t3d",
            "k"."t3a",
            "k"."k1",
            "k"."k2",
            "k"."k3",
            "k"."k4",
            "k"."k5",
                CASE
                    WHEN (("k"."f_sec_prev" IS NULL) OR ("k"."f_sec_prev" <= (0)::numeric) OR ("k"."f_dist_prev" IS NULL)) THEN NULL::numeric
                    ELSE ("k"."f_dist_prev" / "k"."f_sec_prev")
                END AS "spd_fps"
           FROM "public"."nhl_xg_sql_keys" "k"
        ), "c" AS (
         SELECT "b"."game_id",
            "b"."event_id",
            "b"."season",
            "b"."game_date",
            "b"."game_type",
            "b"."shooter_id",
            "b"."goalie_id",
            "b"."team_id",
            "b"."is_home",
            "b"."is_goal",
            "b"."f_dist",
            "b"."f_ang",
            "b"."f_x",
            "b"."f_yabs",
            "b"."f_behind_net",
            "b"."f_type",
            "b"."f_prev",
            "b"."f_sec_prev",
            "b"."f_dist_prev",
            "b"."f_rebound",
            "b"."f_rush",
            "b"."f_royal_road",
            "b"."f_penalty_shot",
            "b"."own_skaters",
            "b"."opp_skaters",
            "b"."own_goalie",
            "b"."opp_goalie",
            "b"."f_en_for",
            "b"."f_en_against",
            "b"."f_strength",
            "b"."strength_source",
            "b"."f_score_diff",
            "b"."f_period",
            "b"."f_sec_elapsed",
            "b"."f_playoff",
            "b"."db",
            "b"."ab",
            "b"."ctx",
            "b"."rr",
            "b"."strc",
            "b"."dbc",
            "b"."psb",
            "b"."t3d",
            "b"."t3a",
            "b"."k1",
            "b"."k2",
            "b"."k3",
            "b"."k4",
            "b"."k5",
            "b"."spd_fps",
                CASE
                    WHEN ("b"."ctx" <> 0) THEN "b"."ctx"
                    WHEN ("b"."spd_fps" IS NULL) THEN 8
                    WHEN ("b"."spd_fps" < (2)::numeric) THEN 4
                    WHEN ("b"."spd_fps" < (20)::numeric) THEN 5
                    ELSE 6
                END AS "ctx3",
                CASE
                    WHEN ("b"."ctx" <> 0) THEN "b"."ctx"
                    WHEN ("b"."spd_fps" IS NULL) THEN 8
                    WHEN ("b"."spd_fps" < (10)::numeric) THEN 4
                    ELSE 5
                END AS "ctx2"
           FROM "b"
        )
 SELECT "game_id",
    "event_id",
    "season",
    "game_date",
    "game_type",
    "shooter_id",
    "goalie_id",
    "team_id",
    "is_home",
    "is_goal",
    "f_dist",
    "f_ang",
    "f_x",
    "f_yabs",
    "f_behind_net",
    "f_type",
    "f_prev",
    "f_sec_prev",
    "f_dist_prev",
    "f_rebound",
    "f_rush",
    "f_royal_road",
    "f_penalty_shot",
    "own_skaters",
    "opp_skaters",
    "own_goalie",
    "opp_goalie",
    "f_en_for",
    "f_en_against",
    "f_strength",
    "strength_source",
    "f_score_diff",
    "f_period",
    "f_sec_elapsed",
    "f_playoff",
    "db",
    "ab",
    "ctx",
    "rr",
    "strc",
    "dbc",
    "psb",
    "t3d",
    "t3a",
    "k1",
    "k2",
    "k3",
    "k4",
    "k5",
    "spd_fps",
    "ctx3",
    "ctx2",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ('E|'::"text" || "dbc")
            WHEN ("f_strength" = '3v3'::"text") THEN ((('T|'::"text" || "t3d") || '|'::"text") || "t3a")
            ELSE ((('G|'::"text" || "db") || '|'::"text") || "ab")
        END AS "a1",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx3")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx3")
            ELSE ((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type")
        END AS "a2",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx3")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx3")
            ELSE ((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx3")
        END AS "a3",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx3")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx3") || '|'::"text") || "rr")
            ELSE ((((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx3") || '|'::"text") || "rr")
        END AS "a4",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx3")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx3") || '|'::"text") || "rr")
            ELSE ((((((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx3") || '|'::"text") || "rr") || '|'::"text") || "strc")
        END AS "a5",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ('E|'::"text" || "dbc")
            WHEN ("f_strength" = '3v3'::"text") THEN ((('T|'::"text" || "t3d") || '|'::"text") || "t3a")
            ELSE ((('G|'::"text" || "db") || '|'::"text") || "ab")
        END AS "b1",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx2")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx2")
            ELSE ((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type")
        END AS "b2",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx2")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx2")
            ELSE ((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx2")
        END AS "b3",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx2")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx2") || '|'::"text") || "rr")
            ELSE ((((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx2") || '|'::"text") || "rr")
        END AS "b4",
        CASE
            WHEN "f_penalty_shot" THEN ('P|'::"text" || "psb")
            WHEN "f_en_for" THEN ((('E|'::"text" || "dbc") || '|'::"text") || "ctx2")
            WHEN ("f_strength" = '3v3'::"text") THEN ((((((('T|'::"text" || "t3d") || '|'::"text") || "t3a") || '|'::"text") || "ctx2") || '|'::"text") || "rr")
            ELSE ((((((((((('G|'::"text" || "db") || '|'::"text") || "ab") || '|'::"text") || "f_type") || '|'::"text") || "ctx2") || '|'::"text") || "rr") || '|'::"text") || "strc")
        END AS "b5",
    "k1" AS "x1",
    "k2" AS "x2",
    "k3" AS "x3",
    "k4" AS "x4",
    "k5" AS "x5"
   FROM "c";


ALTER VIEW "public"."nhl_xg_sql_keys_exp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nightly_job_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_name" "text" NOT NULL,
    "run_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "details" "jsonb",
    CONSTRAINT "nightly_job_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."nightly_job_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."nightly_job_runs" IS 'Per-run status of nightly batch jobs. Primary place to check whether last night''s pipeline actually completed.';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "read_status" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['ADD'::"text", 'DROP'::"text", 'WAIVER'::"text", 'TRADE'::"text", 'CHAT'::"text", 'SYSTEM'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'In-app user notifications. Generated by triggers on transactions rather than by the application layer.';



CREATE TABLE IF NOT EXISTS "public"."phase0c_progress" (
    "game_id" bigint NOT NULL,
    "season" integer NOT NULL,
    "status" "text" NOT NULL,
    "rows_matched" integer,
    "rows_updated" integer,
    "nhl_unmatched" integer,
    "db_unmatched" integer,
    "has_pass_count" integer,
    "error_detail" "text",
    "attempted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "coord_warn_count" integer,
    CONSTRAINT "phase0c_progress_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'complete'::"text", 'match_integrity_fail'::"text", 'ambiguous_unresolvable'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."phase0c_progress" OWNER TO "postgres";


COMMENT ON TABLE "public"."phase0c_progress" IS 'Phase 0c per-game checkpoint / provenance record. RLS enabled with no policies: service-role access only. See apps/web/docs/PHASE_0_EXECUTION_PLAN.md § 0c.';



COMMENT ON COLUMN "public"."phase0c_progress"."status" IS 'pending | in_progress | complete | match_integrity_fail | ambiguous_unresolvable | error';



COMMENT ON COLUMN "public"."phase0c_progress"."rows_matched" IS 'Rows successfully order-matched AND coord-verified against staging raw_shots.';



COMMENT ON COLUMN "public"."phase0c_progress"."nhl_unmatched" IS 'NHL events extracted but with no DB peer (508 blocks + dedupe-seconds + unexplained).';



COMMENT ON COLUMN "public"."phase0c_progress"."coord_warn_count" IS 'Count of matched pairs with abs-coord delta in (10, tolerance]. Games with high counts warrant a look but are not fails.';



CREATE TABLE IF NOT EXISTS "public"."pipeline_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_name" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" NOT NULL,
    "rows_ingested" integer,
    "error_message" "text",
    "metadata" "jsonb",
    CONSTRAINT "pipeline_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'success'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."pipeline_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."pipeline_runs" IS 'Data-pipeline execution records: service_name, row counts ingested, and error text on failure.';



CREATE TABLE IF NOT EXISTS "public"."player_autopick_rankings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid",
    "team_id" "uuid",
    "player_id" integer NOT NULL,
    "rank_position" integer NOT NULL,
    "position_code" "text",
    "tier" integer DEFAULT 1,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_autopick_rankings" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_autopick_rankings" IS 'Per-team autopick preference list used when a manager is absent or the clock expires. Quiet outside draft season.';



CREATE TABLE IF NOT EXISTS "public"."player_game_stats" (
    "season" integer NOT NULL,
    "game_id" integer NOT NULL,
    "game_date" "date" NOT NULL,
    "player_id" integer NOT NULL,
    "team_abbrev" "text",
    "position_code" "text",
    "is_goalie" boolean DEFAULT false NOT NULL,
    "goals" integer DEFAULT 0 NOT NULL,
    "primary_assists" integer DEFAULT 0 NOT NULL,
    "secondary_assists" integer DEFAULT 0 NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "shots_on_goal" integer DEFAULT 0 NOT NULL,
    "hits" integer DEFAULT 0 NOT NULL,
    "blocks" integer DEFAULT 0 NOT NULL,
    "pim" integer DEFAULT 0 NOT NULL,
    "ppp" integer DEFAULT 0 NOT NULL,
    "shp" integer DEFAULT 0 NOT NULL,
    "plus_minus" integer DEFAULT 0 NOT NULL,
    "icetime_seconds" integer DEFAULT 0 NOT NULL,
    "goalie_gp" integer DEFAULT 0 NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "saves" integer DEFAULT 0 NOT NULL,
    "shots_faced" integer DEFAULT 0 NOT NULL,
    "goals_against" integer DEFAULT 0 NOT NULL,
    "shutouts" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nhl_goals" integer DEFAULT 0 NOT NULL,
    "nhl_assists" integer DEFAULT 0 NOT NULL,
    "nhl_points" integer DEFAULT 0 NOT NULL,
    "nhl_shots_on_goal" integer DEFAULT 0 NOT NULL,
    "nhl_hits" integer DEFAULT 0 NOT NULL,
    "nhl_blocks" integer DEFAULT 0 NOT NULL,
    "nhl_pim" integer DEFAULT 0 NOT NULL,
    "nhl_ppp" integer DEFAULT 0 NOT NULL,
    "nhl_shp" integer DEFAULT 0 NOT NULL,
    "nhl_plus_minus" integer DEFAULT 0 NOT NULL,
    "nhl_toi_seconds" integer DEFAULT 0 NOT NULL,
    "nhl_wins" integer DEFAULT 0 NOT NULL,
    "nhl_losses" integer DEFAULT 0 NOT NULL,
    "nhl_ot_losses" integer DEFAULT 0 NOT NULL,
    "nhl_saves" integer DEFAULT 0 NOT NULL,
    "nhl_shots_faced" integer DEFAULT 0 NOT NULL,
    "nhl_goals_against" integer DEFAULT 0 NOT NULL,
    "nhl_shutouts" integer DEFAULT 0 NOT NULL,
    "nhl_faceoff_wins" integer DEFAULT 0 NOT NULL,
    "nhl_faceoff_losses" integer DEFAULT 0 NOT NULL,
    "nhl_takeaways" integer DEFAULT 0 NOT NULL,
    "nhl_giveaways" integer DEFAULT 0 NOT NULL,
    "nhl_ppg" integer DEFAULT 0 NOT NULL,
    "nhl_ppa" integer DEFAULT 0 NOT NULL,
    "nhl_shg" integer DEFAULT 0 NOT NULL,
    "nhl_sha" integer DEFAULT 0 NOT NULL,
    "nhl_shots_missed" integer DEFAULT 0 NOT NULL,
    "nhl_shots_attempted" integer DEFAULT 0 NOT NULL,
    "nhl_shifts" integer DEFAULT 0 NOT NULL,
    "nhl_gwg" integer DEFAULT 0 NOT NULL,
    "nhl_save_pct" numeric(5,3) DEFAULT 0 NOT NULL,
    "nhl_pp_saves" integer DEFAULT 0 NOT NULL,
    "nhl_sh_saves" integer DEFAULT 0 NOT NULL,
    "nhl_faceoff_taken" integer DEFAULT 0 NOT NULL,
    "nhl_shots_blocked" integer DEFAULT 0 NOT NULL,
    "nhl_shot_attempts" integer DEFAULT 0 NOT NULL,
    "nhl_otg" integer DEFAULT 0 NOT NULL,
    "nhl_even_saves" integer DEFAULT 0 NOT NULL,
    "nhl_even_shots_against" integer DEFAULT 0 NOT NULL,
    "nhl_pp_shots_against" integer DEFAULT 0 NOT NULL,
    "nhl_sh_shots_against" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."player_game_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_game_stats" IS 'Per-game player statistics. NHL official stats (nhl_* columns) are the source of truth for fantasy scoring. Expanded Dec 2025 to support comprehensive league scoring categories including faceoffs, possession, PP/SH breakdown, Corsi components, and goalie advanced metrics.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_goals" IS 'Official NHL.com goals for this game (for display and fantasy scoring). PBP-calculated goals kept in goals column for internal use.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_assists" IS 'Official NHL.com assists for this game. PBP-calculated assists kept in primary_assists/secondary_assists for internal use.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_points" IS 'Official NHL.com points for this game (goals + assists).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shots_on_goal" IS 'Official NHL.com shots on goal for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_hits" IS 'Official NHL.com hits for this game. May require StatsAPI fallback.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_blocks" IS 'Official NHL.com blocked shots for this game. May require StatsAPI fallback.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_pim" IS 'Official NHL.com penalty minutes for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_ppp" IS 'Official NHL.com power play points for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shp" IS 'Official NHL.com short-handed points for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_plus_minus" IS 'Official NHL.com plus/minus for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_toi_seconds" IS 'Official NHL.com time on ice for this game (in seconds).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_wins" IS 'Official NHL.com goalie win for this game (1 if win, 0 otherwise).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_losses" IS 'Official NHL.com goalie loss for this game (1 if loss, 0 otherwise).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_ot_losses" IS 'Official NHL.com goalie OT loss for this game (1 if OT loss, 0 otherwise).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_saves" IS 'Official NHL.com goalie saves for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shots_faced" IS 'Official NHL.com shots faced for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_goals_against" IS 'Official NHL.com goals against for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shutouts" IS 'Official NHL.com shutout for this game (1 if shutout, 0 otherwise).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_faceoff_wins" IS 'Official NHL faceoffs won for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_faceoff_losses" IS 'Official NHL faceoffs lost for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_takeaways" IS 'Official NHL takeaways for this game. Positive possession indicator.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_giveaways" IS 'Official NHL giveaways for this game. Used for possession ratios.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_ppg" IS 'Official NHL power play goals for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_ppa" IS 'Official NHL power play assists for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shg" IS 'Official NHL shorthanded goals for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_sha" IS 'Official NHL shorthanded assists for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shots_missed" IS 'Shots that missed the net. Fenwick = SOG + Missed.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shifts" IS 'Number of shifts taken in this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_gwg" IS 'Game-winning goals for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_save_pct" IS 'Save percentage for this game. Calculated: saves/shots_faced (0.000 if no shots).';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_pp_saves" IS 'Saves on power play (opponent PP) for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_sh_saves" IS 'Saves while shorthanded (own PP) for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_faceoff_taken" IS 'Total faceoffs taken (wins + losses) for verification.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shots_blocked" IS 'Player shots that were blocked by opponent. Corsi = SOG + Missed + Blocked.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_shot_attempts" IS 'Total shot attempts (Corsi). API may provide directly or calculate.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_otg" IS 'Overtime goals for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_even_saves" IS 'Even-strength saves for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_even_shots_against" IS 'Even-strength shots against for this game.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_pp_shots_against" IS 'Shots against on opponent power play.';



COMMENT ON COLUMN "public"."player_game_stats"."nhl_sh_shots_against" IS 'Shots against while own team on power play.';



CREATE MATERIALIZED VIEW "public"."player_season_totals" AS
 SELECT "s"."player_id",
    "s"."season",
        CASE
            WHEN ("substr"(("s"."game_id")::"text", 5, 2) = '03'::"text") THEN 'playoff'::"text"
            ELSE 'regular'::"text"
        END AS "game_type",
    "max"("i"."full_name") AS "full_name",
    "max"("i"."primary_position") AS "position_code",
    "max"("i"."headshot_url") AS "headshot_url",
    "bool_or"("s"."is_goalie") AS "is_goalie",
    ("array_agg"("s"."team_abbrev" ORDER BY "s"."game_date" DESC))[1] AS "team_abbrev",
    ("count"(*))::integer AS "games_played",
    ("sum"("s"."nhl_goals"))::integer AS "goals",
    ("sum"("s"."nhl_assists"))::integer AS "assists",
    ("sum"("s"."primary_assists"))::integer AS "primary_assists",
    ("sum"("s"."secondary_assists"))::integer AS "secondary_assists",
    ("sum"("s"."nhl_points"))::integer AS "points",
    ("sum"("s"."nhl_plus_minus"))::integer AS "plus_minus",
    ("sum"("s"."nhl_pim"))::integer AS "pim",
    ("sum"("s"."nhl_shots_on_goal"))::integer AS "shots_on_goal",
    ("sum"("s"."nhl_hits"))::integer AS "hits",
    ("sum"("s"."nhl_blocks"))::integer AS "blocks",
    ("sum"("s"."nhl_ppg"))::integer AS "pp_goals",
    ("sum"("s"."nhl_ppp"))::integer AS "pp_points",
    ("sum"("s"."nhl_shg"))::integer AS "sh_goals",
    ("sum"("s"."nhl_shp"))::integer AS "sh_points",
    ("sum"("s"."nhl_gwg"))::integer AS "gw_goals",
    ("sum"("s"."nhl_otg"))::integer AS "ot_goals",
    ("sum"("s"."nhl_takeaways"))::integer AS "takeaways",
    ("sum"("s"."nhl_giveaways"))::integer AS "giveaways",
    ("sum"("s"."nhl_shifts"))::integer AS "shifts",
    "sum"("s"."nhl_toi_seconds") AS "toi_seconds",
    "round"(((("sum"("s"."nhl_toi_seconds"))::numeric / (NULLIF("count"(*), 0))::numeric) / (60)::numeric), 2) AS "toi_per_game_min",
    "round"(((100.0 * ("sum"("s"."nhl_goals"))::numeric) / (NULLIF("sum"("s"."nhl_shots_on_goal"), 0))::numeric), 2) AS "shooting_pct",
    ("sum"("s"."goalie_gp"))::integer AS "goalie_games",
    ("sum"("s"."nhl_wins"))::integer AS "wins",
    ("sum"("s"."nhl_losses"))::integer AS "losses",
    ("sum"("s"."nhl_ot_losses"))::integer AS "ot_losses",
    ("sum"("s"."nhl_saves"))::integer AS "saves",
    ("sum"("s"."nhl_shots_faced"))::integer AS "shots_faced",
    ("sum"("s"."nhl_goals_against"))::integer AS "goals_against",
    ("sum"("s"."nhl_shutouts"))::integer AS "shutouts",
    "round"((("sum"("s"."nhl_saves"))::numeric / (NULLIF("sum"("s"."nhl_shots_faced"), 0))::numeric), 4) AS "save_pct",
    "round"(((("sum"("s"."nhl_goals_against"))::numeric * (3600)::numeric) / (NULLIF("sum"("s"."nhl_toi_seconds") FILTER (WHERE "s"."is_goalie"), 0))::numeric), 2) AS "gaa",
    "max"("s"."game_date") AS "last_game_date"
   FROM ("public"."player_game_stats" "s"
     LEFT JOIN "public"."nhl_player_identity" "i" ON (("i"."player_id" = "s"."player_id")))
  GROUP BY "s"."player_id", "s"."season",
        CASE
            WHEN ("substr"(("s"."game_id")::"text", 5, 2) = '03'::"text") THEN 'playoff'::"text"
            ELSE 'regular'::"text"
        END
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."player_season_totals" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."player_career_totals" AS
 SELECT "player_id",
    "game_type",
    "max"("full_name") AS "full_name",
    "max"("position_code") AS "position_code",
    "max"("headshot_url") AS "headshot_url",
    "bool_or"("is_goalie") AS "is_goalie",
    ("array_agg"("team_abbrev" ORDER BY "season" DESC))[1] AS "last_team",
    "min"("season") AS "first_season",
    "max"("season") AS "last_season",
    ("count"(DISTINCT "season"))::integer AS "seasons",
    ("sum"("games_played"))::integer AS "games_played",
    ("sum"("goals"))::integer AS "goals",
    ("sum"("assists"))::integer AS "assists",
    ("sum"("primary_assists"))::integer AS "primary_assists",
    ("sum"("secondary_assists"))::integer AS "secondary_assists",
    ("sum"("points"))::integer AS "points",
    ("sum"("plus_minus"))::integer AS "plus_minus",
    ("sum"("pim"))::integer AS "pim",
    ("sum"("shots_on_goal"))::integer AS "shots_on_goal",
    ("sum"("hits"))::integer AS "hits",
    ("sum"("blocks"))::integer AS "blocks",
    ("sum"("pp_goals"))::integer AS "pp_goals",
    ("sum"("pp_points"))::integer AS "pp_points",
    ("sum"("sh_goals"))::integer AS "sh_goals",
    ("sum"("sh_points"))::integer AS "sh_points",
    ("sum"("gw_goals"))::integer AS "gw_goals",
    ("sum"("ot_goals"))::integer AS "ot_goals",
    ("sum"("takeaways"))::integer AS "takeaways",
    ("sum"("giveaways"))::integer AS "giveaways",
    ("sum"("toi_seconds"))::bigint AS "toi_seconds",
    "round"((("sum"("points"))::numeric / (NULLIF("sum"("games_played"), 0))::numeric), 3) AS "points_per_game",
    "round"(((100.0 * ("sum"("goals"))::numeric) / (NULLIF("sum"("shots_on_goal"), 0))::numeric), 2) AS "shooting_pct",
    ("sum"("goalie_games"))::integer AS "goalie_games",
    ("sum"("wins"))::integer AS "wins",
    ("sum"("losses"))::integer AS "losses",
    ("sum"("ot_losses"))::integer AS "ot_losses",
    ("sum"("saves"))::integer AS "saves",
    ("sum"("shots_faced"))::integer AS "shots_faced",
    ("sum"("goals_against"))::integer AS "goals_against",
    ("sum"("shutouts"))::integer AS "shutouts",
    "round"((("sum"("saves"))::numeric / (NULLIF("sum"("shots_faced"), 0))::numeric), 4) AS "save_pct"
   FROM "public"."player_season_totals" "t"
  GROUP BY "player_id", "game_type"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."player_career_totals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_directory" (
    "season" integer NOT NULL,
    "player_id" integer NOT NULL,
    "full_name" "text" NOT NULL,
    "team_abbrev" "text",
    "position_code" "text",
    "is_goalie" boolean DEFAULT false NOT NULL,
    "jersey_number" "text",
    "headshot_url" "text",
    "shoots_catches" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "height_in" integer,
    "weight_lb" integer,
    "birthdate" "date",
    "nationality" "text",
    "college_team" "text",
    "prior_team" "text",
    "bio_summary" "text",
    "notes" "text",
    "source_last_fetched_at" timestamp with time zone,
    "eligible_positions" "text"
);


ALTER TABLE "public"."player_directory" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_directory" IS 'Canonical player identity + metadata per season. Source of truth for app player names/teams/positions (no staging).';



COMMENT ON COLUMN "public"."player_directory"."height_in" IS 'Player height in inches (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."weight_lb" IS 'Player weight in pounds (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."birthdate" IS 'Player birth date (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."nationality" IS 'Player nationality/country (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."college_team" IS 'College/university team name (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."prior_team" IS 'Previous NHL team abbreviation (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."bio_summary" IS 'Player biography/writeup for player cards (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."notes" IS 'Manual annotations/notes (preserved from manual edits)';



COMMENT ON COLUMN "public"."player_directory"."source_last_fetched_at" IS 'Timestamp when NHL API was last queried for this player';



COMMENT ON COLUMN "public"."player_directory"."eligible_positions" IS 'Comma-separated eligible positions derived from game stats (e.g., "C,LW"). Primary position listed first. Updated by sync_rosters.py.';



CREATE TABLE IF NOT EXISTS "public"."player_gar_components" (
    "player_id" integer NOT NULL,
    "season" integer NOT NULL,
    "evo_rate_raw" numeric,
    "evd_rate_raw" numeric,
    "ppo_rate_raw" numeric,
    "ppd_rate_raw" numeric,
    "penalty_component_raw" numeric,
    "evo_rate_regressed" numeric,
    "evd_rate_regressed" numeric,
    "ppo_rate_regressed" numeric,
    "ppd_rate_regressed" numeric,
    "penalty_component_regressed" numeric,
    "rp_evo_rate" numeric,
    "rp_evd_rate" numeric,
    "rp_ppo_rate" numeric,
    "rp_ppd_rate" numeric,
    "rp_penalty_rate" numeric,
    "toi_5v5_minutes" numeric,
    "toi_pp_minutes" numeric,
    "toi_pk_minutes" numeric,
    "toi_total_minutes" numeric,
    "evo_gar_per_60" numeric,
    "evd_gar_per_60" numeric,
    "ppo_gar_per_60" numeric,
    "ppd_gar_per_60" numeric,
    "penalty_gar_per_60" numeric,
    "total_gar_per_60" numeric,
    "calculated_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."player_gar_components" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_gar_components" IS 'Goals Above Replacement (GAR) component rates and final GAR values for all skaters';



CREATE TABLE IF NOT EXISTS "public"."player_identity_bridge" (
    "players_uuid" "uuid" NOT NULL,
    "nhl_player_id" integer,
    "full_name" "text" NOT NULL,
    "match_method" "text" NOT NULL,
    "is_ambiguous" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_identity_bridge" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_identity_bridge" IS 'Maps public.players.id (UUID) to the NHL integer player_id used everywhere else. Needed because draft_picks.player_id is polymorphic across both identity systems.';



CREATE TABLE IF NOT EXISTS "public"."player_playoff_stats" (
    "player_id" integer NOT NULL,
    "season" integer NOT NULL,
    "games_played" smallint DEFAULT 0,
    "goals" smallint DEFAULT 0,
    "assists" smallint DEFAULT 0,
    "points" smallint DEFAULT 0,
    "ppp" smallint DEFAULT 0,
    "shp" smallint DEFAULT 0,
    "shots" smallint DEFAULT 0,
    "hits" smallint DEFAULT 0,
    "blocks" smallint DEFAULT 0,
    "pim" smallint DEFAULT 0,
    "plus_minus" smallint DEFAULT 0,
    "wins" smallint DEFAULT 0,
    "saves" integer DEFAULT 0,
    "shutouts" smallint DEFAULT 0,
    "goals_against" smallint DEFAULT 0,
    "is_goalie" boolean DEFAULT false,
    "team_abbrev" "text",
    "last_game_id" integer,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."player_playoff_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_playoff_stats" IS 'Aggregated NHL playoff statistics per player and season, used for playoff pool scoring.';



CREATE TABLE IF NOT EXISTS "public"."player_projected_stats" (
    "projection_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" integer NOT NULL,
    "game_id" integer NOT NULL,
    "projection_date" "date" NOT NULL,
    "projected_goals" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_assists" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_sog" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_blocks" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_xg" numeric(5,3) DEFAULT 0 NOT NULL,
    "total_projected_points" numeric(10,3) DEFAULT 0 NOT NULL,
    "base_ppg" numeric(5,3),
    "shrinkage_weight" numeric(4,3),
    "finishing_multiplier" numeric(4,3),
    "opponent_adjustment" numeric(4,3),
    "b2b_penalty" numeric(4,3),
    "home_away_adjustment" numeric(4,3),
    "calculation_method" "text" DEFAULT 'hybrid_bayesian'::"text",
    "confidence_score" numeric(3,2),
    "season" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_goalie" boolean DEFAULT false NOT NULL,
    "projected_wins" numeric(5,3) DEFAULT 0,
    "projected_saves" numeric(7,2) DEFAULT 0,
    "projected_shutouts" numeric(5,3) DEFAULT 0,
    "projected_goals_against" numeric(5,3) DEFAULT 0,
    "projected_gaa" numeric(4,2) DEFAULT 0,
    "projected_save_pct" numeric(4,3) DEFAULT 0,
    "projected_gp" numeric(3,2) DEFAULT 0,
    "starter_confirmed" boolean DEFAULT false,
    "projected_ppp" numeric(5,3) DEFAULT 0,
    "projected_shp" numeric(5,3) DEFAULT 0,
    "projected_hits" numeric(5,3) DEFAULT 0,
    "projected_pim" numeric(5,3) DEFAULT 0,
    "projected_vopa" numeric(10,3),
    "opponent_team_id" integer,
    "opponent_abbrev" character varying(3),
    "is_home_game" boolean DEFAULT false,
    "matchup_difficulty" numeric(3,2) DEFAULT 1.00,
    "injury_status" character varying(20) DEFAULT 'healthy'::character varying,
    "game_start_time" timestamp with time zone,
    "projection_mean" numeric(10,3),
    "projection_std_dev" numeric(10,3),
    "projection_ci_lower" numeric(10,3),
    "projection_ci_upper" numeric(10,3),
    "projection_ci_50_lower" numeric(10,3),
    "projection_ci_50_upper" numeric(10,3),
    "projection_median" numeric(10,3),
    "projection_skewness" numeric(6,3),
    "upside_probability" numeric(5,4),
    "floor_probability" numeric(5,4),
    "dynamic_confidence" numeric(4,3),
    "likely_low" numeric(6,1),
    "likely_high" numeric(6,1),
    "confidence_label" "text"
);


ALTER TABLE "public"."player_projected_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_projected_stats" IS 'Daily fantasy point projections with full model transparency. Stores Citrus Projections 2.0 calculations with Bayesian shrinkage, finishing talent, and contextual adjustments.';



COMMENT ON COLUMN "public"."player_projected_stats"."base_ppg" IS 'Historical points per game from Bayesian shrinkage calculation';



COMMENT ON COLUMN "public"."player_projected_stats"."shrinkage_weight" IS 'Bayesian weight applied (0.0 = 100% league average, 1.0 = 100% player history)';



COMMENT ON COLUMN "public"."player_projected_stats"."finishing_multiplier" IS 'xG adjustment factor based on player finishing talent (actual goals / xG)';



COMMENT ON COLUMN "public"."player_projected_stats"."opponent_adjustment" IS 'Multiplier based on opponent defensive strength (league avg / opponent avg)';



COMMENT ON COLUMN "public"."player_projected_stats"."b2b_penalty" IS 'Back-to-back penalty multiplier (0.95 if team played yesterday, 1.0 otherwise)';



COMMENT ON COLUMN "public"."player_projected_stats"."home_away_adjustment" IS 'Home/away advantage multiplier (1.05 for home, 1.0 for away)';



COMMENT ON COLUMN "public"."player_projected_stats"."confidence_score" IS 'Confidence in projection (0.0 to 1.0) based on sample size, data quality, player consistency';



COMMENT ON COLUMN "public"."player_projected_stats"."is_goalie" IS 'Flag to distinguish goalie projections from skater projections';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_wins" IS 'Projected win probability (0.0 to 1.0) based on Vegas implied probability or team win rate';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_saves" IS 'Projected saves based on opponent shots for/60 × goalie SV%';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_shutouts" IS 'Projected shutout probability (0.0 to 1.0) based on GSAx and opponent offense';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_goals_against" IS 'Projected goals against based on opponent shots × (1 - goalie SV%)';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_gaa" IS 'Projected Goals Against Average (projected_goals_against / (projected_gp × 60))';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_save_pct" IS 'Projected save percentage (with Bayesian shrinkage for low-sample goalies)';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_gp" IS 'Projected games played (typically 1.0 for confirmed starter, 0.0 for backup)';



COMMENT ON COLUMN "public"."player_projected_stats"."starter_confirmed" IS 'True if goalie is confirmed starter, false if probable/unconfirmed (shows Probable badge in UI)';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_ppp" IS 'Projected powerplay points per game (PPG + PPA)';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_shp" IS 'Projected shorthanded points per game (SHG + SHA)';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_hits" IS 'Projected hits per game';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_pim" IS 'Projected penalty minutes per game';



COMMENT ON COLUMN "public"."player_projected_stats"."projected_vopa" IS 'Value Over Positional Average (VOPA). Calculated as: Projected Points - (Position Avg Points/60 × Projected TOI). Positive values indicate above-average performance for the position. Used for player ranking and value assessment.';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_mean" IS 'Monte Carlo mean of fantasy point distribution (may differ slightly from point estimate due to non-linear interactions)';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_std_dev" IS 'Standard deviation of fantasy point distribution — measures projection uncertainty';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_ci_lower" IS '5th percentile of fantasy point distribution (90% CI lower bound)';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_ci_upper" IS '95th percentile of fantasy point distribution (90% CI upper bound)';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_ci_50_lower" IS '25th percentile of fantasy point distribution (50% CI lower bound)';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_ci_50_upper" IS '75th percentile of fantasy point distribution (50% CI upper bound)';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_median" IS 'Median of fantasy point distribution (robust central estimate)';



COMMENT ON COLUMN "public"."player_projected_stats"."projection_skewness" IS 'Skewness of fantasy point distribution (positive = upside tail, typical for elite players)';



COMMENT ON COLUMN "public"."player_projected_stats"."upside_probability" IS 'Probability of exceeding 1.5x the point estimate (boom potential)';



COMMENT ON COLUMN "public"."player_projected_stats"."floor_probability" IS 'Probability of falling below 0.5x the point estimate (bust risk)';



COMMENT ON COLUMN "public"."player_projected_stats"."dynamic_confidence" IS 'MC-derived confidence score based on distribution coefficient of variation (replaces static formula)';



COMMENT ON COLUMN "public"."player_projected_stats"."likely_low" IS '25th percentile of fantasy points, rounded to 1 decimal — primary "likely range" lower bound shown to users';



COMMENT ON COLUMN "public"."player_projected_stats"."likely_high" IS '75th percentile of fantasy points, rounded to 1 decimal — primary "likely range" upper bound shown to users';



COMMENT ON COLUMN "public"."player_projected_stats"."confidence_label" IS 'Plain-English confidence badge: High (>=0.60), Medium (>=0.35), or Low (<0.35)';



CREATE TABLE IF NOT EXISTS "public"."player_projected_stats_retired_phantoms" (
    "projection_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" integer NOT NULL,
    "game_id" integer NOT NULL,
    "projection_date" "date" NOT NULL,
    "projected_goals" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_assists" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_sog" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_blocks" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_xg" numeric(5,3) DEFAULT 0 NOT NULL,
    "total_projected_points" numeric(10,3) DEFAULT 0 NOT NULL,
    "base_ppg" numeric(5,3),
    "shrinkage_weight" numeric(4,3),
    "finishing_multiplier" numeric(4,3),
    "opponent_adjustment" numeric(4,3),
    "b2b_penalty" numeric(4,3),
    "home_away_adjustment" numeric(4,3),
    "calculation_method" "text" DEFAULT 'hybrid_bayesian'::"text",
    "confidence_score" numeric(3,2),
    "season" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_goalie" boolean DEFAULT false NOT NULL,
    "projected_wins" numeric(5,3) DEFAULT 0,
    "projected_saves" numeric(7,2) DEFAULT 0,
    "projected_shutouts" numeric(5,3) DEFAULT 0,
    "projected_goals_against" numeric(5,3) DEFAULT 0,
    "projected_gaa" numeric(4,2) DEFAULT 0,
    "projected_save_pct" numeric(4,3) DEFAULT 0,
    "projected_gp" numeric(3,2) DEFAULT 0,
    "starter_confirmed" boolean DEFAULT false,
    "projected_ppp" numeric(5,3) DEFAULT 0,
    "projected_shp" numeric(5,3) DEFAULT 0,
    "projected_hits" numeric(5,3) DEFAULT 0,
    "projected_pim" numeric(5,3) DEFAULT 0,
    "projected_vopa" numeric(10,3),
    "opponent_team_id" integer,
    "opponent_abbrev" character varying(3),
    "is_home_game" boolean DEFAULT false,
    "matchup_difficulty" numeric(3,2) DEFAULT 1.00,
    "injury_status" character varying(20) DEFAULT 'healthy'::character varying,
    "game_start_time" timestamp with time zone,
    "projection_mean" numeric(10,3),
    "projection_std_dev" numeric(10,3),
    "projection_ci_lower" numeric(10,3),
    "projection_ci_upper" numeric(10,3),
    "projection_ci_50_lower" numeric(10,3),
    "projection_ci_50_upper" numeric(10,3),
    "projection_median" numeric(10,3),
    "projection_skewness" numeric(6,3),
    "upside_probability" numeric(5,4),
    "floor_probability" numeric(5,4),
    "dynamic_confidence" numeric(4,3),
    "likely_low" numeric(6,1),
    "likely_high" numeric(6,1),
    "confidence_label" "text"
);


ALTER TABLE "public"."player_projected_stats_retired_phantoms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."base_ppg" IS 'Historical points per game from Bayesian shrinkage calculation';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."shrinkage_weight" IS 'Bayesian weight applied (0.0 = 100% league average, 1.0 = 100% player history)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."finishing_multiplier" IS 'xG adjustment factor based on player finishing talent (actual goals / xG)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."opponent_adjustment" IS 'Multiplier based on opponent defensive strength (league avg / opponent avg)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."b2b_penalty" IS 'Back-to-back penalty multiplier (0.95 if team played yesterday, 1.0 otherwise)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."home_away_adjustment" IS 'Home/away advantage multiplier (1.05 for home, 1.0 for away)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."confidence_score" IS 'Confidence in projection (0.0 to 1.0) based on sample size, data quality, player consistency';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."is_goalie" IS 'Flag to distinguish goalie projections from skater projections';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_wins" IS 'Projected win probability (0.0 to 1.0) based on Vegas implied probability or team win rate';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_saves" IS 'Projected saves based on opponent shots for/60 × goalie SV%';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_shutouts" IS 'Projected shutout probability (0.0 to 1.0) based on GSAx and opponent offense';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_goals_against" IS 'Projected goals against based on opponent shots × (1 - goalie SV%)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_gaa" IS 'Projected Goals Against Average (projected_goals_against / (projected_gp × 60))';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_save_pct" IS 'Projected save percentage (with Bayesian shrinkage for low-sample goalies)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_gp" IS 'Projected games played (typically 1.0 for confirmed starter, 0.0 for backup)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."starter_confirmed" IS 'True if goalie is confirmed starter, false if probable/unconfirmed (shows Probable badge in UI)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_ppp" IS 'Projected powerplay points per game (PPG + PPA)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_shp" IS 'Projected shorthanded points per game (SHG + SHA)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_hits" IS 'Projected hits per game';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_pim" IS 'Projected penalty minutes per game';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projected_vopa" IS 'Value Over Positional Average (VOPA). Calculated as: Projected Points - (Position Avg Points/60 × Projected TOI). Positive values indicate above-average performance for the position. Used for player ranking and value assessment.';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_mean" IS 'Monte Carlo mean of fantasy point distribution (may differ slightly from point estimate due to non-linear interactions)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_std_dev" IS 'Standard deviation of fantasy point distribution — measures projection uncertainty';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_ci_lower" IS '5th percentile of fantasy point distribution (90% CI lower bound)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_ci_upper" IS '95th percentile of fantasy point distribution (90% CI upper bound)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_ci_50_lower" IS '25th percentile of fantasy point distribution (50% CI lower bound)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_ci_50_upper" IS '75th percentile of fantasy point distribution (50% CI upper bound)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_median" IS 'Median of fantasy point distribution (robust central estimate)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."projection_skewness" IS 'Skewness of fantasy point distribution (positive = upside tail, typical for elite players)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."upside_probability" IS 'Probability of exceeding 1.5x the point estimate (boom potential)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."floor_probability" IS 'Probability of falling below 0.5x the point estimate (bust risk)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."dynamic_confidence" IS 'MC-derived confidence score based on distribution coefficient of variation (replaces static formula)';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."likely_low" IS '25th percentile of fantasy points, rounded to 1 decimal — primary "likely range" lower bound shown to users';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."likely_high" IS '75th percentile of fantasy points, rounded to 1 decimal — primary "likely range" upper bound shown to users';



COMMENT ON COLUMN "public"."player_projected_stats_retired_phantoms"."confidence_label" IS 'Plain-English confidence badge: High (>=0.60), Medium (>=0.35), or Low (<0.35)';



CREATE TABLE IF NOT EXISTS "public"."player_projections" (
    "player_id" integer NOT NULL,
    "game_id" integer NOT NULL,
    "season" integer DEFAULT 2025 NOT NULL,
    "base_xg" numeric(10,4) NOT NULL,
    "gsax_adjusted_xg" numeric(10,4) NOT NULL,
    "qoc_adjusted_xg" numeric(10,4) NOT NULL,
    "final_projected_xg" numeric(10,4) NOT NULL,
    "gsax_factor_pct" numeric(5,4) DEFAULT 0.0 NOT NULL,
    "qoc_factor_pct" numeric(5,4) DEFAULT 0.0 NOT NULL,
    "goalie_factor" numeric(10,4) DEFAULT 0.0 NOT NULL,
    "opponent_team_id" integer,
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_projections" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_projections" IS 'Stores matchup-specific player projections with explainability factors (GSAx and QoC adjustments)';



COMMENT ON COLUMN "public"."player_projections"."base_xg" IS 'Base talent-adjusted xG before adjustments';



COMMENT ON COLUMN "public"."player_projections"."gsax_adjusted_xg" IS 'xG after GSAx (goalie) adjustment';



COMMENT ON COLUMN "public"."player_projections"."qoc_adjusted_xg" IS 'xG after QoC (quality of competition) adjustment';



COMMENT ON COLUMN "public"."player_projections"."final_projected_xg" IS 'Final projection (Base + GSAx + QoC)';



COMMENT ON COLUMN "public"."player_projections"."gsax_factor_pct" IS 'GSAx adjustment percentage (e.g., -0.05 = -5%)';



COMMENT ON COLUMN "public"."player_projections"."qoc_factor_pct" IS 'QoC adjustment percentage (e.g., 0.08 = +8%)';



COMMENT ON COLUMN "public"."player_projections"."goalie_factor" IS 'Opponent goalie GSAx factor used in adjustment';



COMMENT ON COLUMN "public"."player_projections"."opponent_team_id" IS 'Opponent team ID for QoC calculation';



CREATE TABLE IF NOT EXISTS "public"."player_ros_projections" (
    "player_id" integer NOT NULL,
    "season" integer NOT NULL,
    "games_remaining" integer DEFAULT 0,
    "games_played" integer DEFAULT 0,
    "total_projected_points" numeric(8,2) DEFAULT 0,
    "projected_goals" numeric(6,2) DEFAULT 0,
    "projected_assists" numeric(6,2) DEFAULT 0,
    "projected_sog" numeric(6,2) DEFAULT 0,
    "projected_blocks" numeric(6,2) DEFAULT 0,
    "projected_ppp" numeric(6,2) DEFAULT 0,
    "projected_shp" numeric(6,2) DEFAULT 0,
    "projected_hits" numeric(6,2) DEFAULT 0,
    "projected_pim" numeric(6,2) DEFAULT 0,
    "avg_points_per_game" numeric(4,2) DEFAULT 0,
    "avg_goals_per_game" numeric(4,3) DEFAULT 0,
    "avg_assists_per_game" numeric(4,3) DEFAULT 0,
    "playoff_games" integer DEFAULT 0,
    "playoff_week_projection" numeric(6,2) DEFAULT 0,
    "projected_wins_ros" numeric(5,2) DEFAULT 0,
    "projected_saves_ros" numeric(7,2) DEFAULT 0,
    "projected_shutouts_ros" numeric(4,2) DEFAULT 0,
    "player_name" character varying(100),
    "team_abbrev" character varying(3),
    "position" character varying(5),
    "is_goalie" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_ros_projections" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_ros_projections" IS 'Rest-of-season projections per player: games_remaining plus projected counting stats. The richest projection table (27 columns); prefer it over the legacy projections table.';



CREATE TABLE IF NOT EXISTS "public"."player_season_stats" (
    "season" integer NOT NULL,
    "player_id" integer NOT NULL,
    "team_abbrev" "text",
    "position_code" "text",
    "is_goalie" boolean DEFAULT false NOT NULL,
    "games_played" integer DEFAULT 0 NOT NULL,
    "icetime_seconds" integer DEFAULT 0 NOT NULL,
    "goals" integer DEFAULT 0 NOT NULL,
    "primary_assists" integer DEFAULT 0 NOT NULL,
    "secondary_assists" integer DEFAULT 0 NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "shots_on_goal" integer DEFAULT 0 NOT NULL,
    "hits" integer DEFAULT 0 NOT NULL,
    "blocks" integer DEFAULT 0 NOT NULL,
    "pim" integer DEFAULT 0 NOT NULL,
    "ppp" integer DEFAULT 0 NOT NULL,
    "shp" integer DEFAULT 0 NOT NULL,
    "plus_minus" integer DEFAULT 0 NOT NULL,
    "x_goals" numeric DEFAULT 0 NOT NULL,
    "x_assists" numeric DEFAULT 0 NOT NULL,
    "goalie_gp" integer DEFAULT 0 NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "saves" integer DEFAULT 0 NOT NULL,
    "shots_faced" integer DEFAULT 0 NOT NULL,
    "goals_against" integer DEFAULT 0 NOT NULL,
    "shutouts" integer DEFAULT 0 NOT NULL,
    "save_pct" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nhl_toi_seconds" integer DEFAULT 0 NOT NULL,
    "nhl_plus_minus" integer DEFAULT 0 NOT NULL,
    "nhl_goals" integer DEFAULT 0 NOT NULL,
    "nhl_assists" integer DEFAULT 0 NOT NULL,
    "nhl_points" integer DEFAULT 0 NOT NULL,
    "nhl_shots_on_goal" integer DEFAULT 0 NOT NULL,
    "nhl_hits" integer DEFAULT 0 NOT NULL,
    "nhl_blocks" integer DEFAULT 0 NOT NULL,
    "nhl_pim" integer DEFAULT 0 NOT NULL,
    "nhl_ppp" integer DEFAULT 0 NOT NULL,
    "nhl_shp" integer DEFAULT 0 NOT NULL,
    "nhl_wins" integer DEFAULT 0 NOT NULL,
    "nhl_losses" integer DEFAULT 0 NOT NULL,
    "nhl_ot_losses" integer DEFAULT 0 NOT NULL,
    "nhl_saves" integer DEFAULT 0 NOT NULL,
    "nhl_shots_faced" integer DEFAULT 0 NOT NULL,
    "nhl_goals_against" integer DEFAULT 0 NOT NULL,
    "nhl_shutouts" integer DEFAULT 0 NOT NULL,
    "nhl_save_pct" numeric,
    "nhl_gaa" numeric
);


ALTER TABLE "public"."player_season_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_season_stats" IS 'Season rollup of player_game_stats. Primary UI source for season totals (no staging).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_toi_seconds" IS 'Official NHL.com TOI in seconds (for display on player cards). GAR uses player_toi_by_situation instead.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_plus_minus" IS 'Official NHL.com plus/minus (for display on player cards). Our calculated plus_minus is kept for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_goals" IS 'Official NHL.com goals (for display and fantasy scoring). PBP-calculated goals kept in goals column for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_assists" IS 'Official NHL.com assists (for display and fantasy scoring). PBP-calculated assists kept in primary_assists/secondary_assists for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_points" IS 'Official NHL.com points (goals + assists). Calculated from nhl_goals + nhl_assists.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_shots_on_goal" IS 'Official NHL.com shots on goal (for display and fantasy scoring). PBP-calculated shots_on_goal kept for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_hits" IS 'Official NHL.com hits (for display and fantasy scoring). May require StatsAPI fallback if landing endpoint unavailable.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_blocks" IS 'Official NHL.com blocked shots (for display and fantasy scoring). May require StatsAPI fallback if landing endpoint unavailable.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_pim" IS 'Official NHL.com penalty minutes (for display and fantasy scoring). PBP-calculated pim kept for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_ppp" IS 'Official NHL.com power play points (for display and fantasy scoring). PBP-calculated ppp kept for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_shp" IS 'Official NHL.com short-handed points (for display and fantasy scoring). PBP-calculated shp kept for internal use.';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_wins" IS 'Official NHL.com goalie wins (for display and fantasy scoring).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_losses" IS 'Official NHL.com goalie losses (for display and fantasy scoring).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_ot_losses" IS 'Official NHL.com goalie OT losses (for display and fantasy scoring).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_saves" IS 'Official NHL.com goalie saves (calculated: shots_faced - goals_against).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_shots_faced" IS 'Official NHL.com shots against (for display and fantasy scoring).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_goals_against" IS 'Official NHL.com goals against (for display and fantasy scoring).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_shutouts" IS 'Official NHL.com shutouts (for display and fantasy scoring).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_save_pct" IS 'Official NHL.com save percentage (decimal format, e.g., 0.925).';



COMMENT ON COLUMN "public"."player_season_stats"."nhl_gaa" IS 'Official NHL.com goals against average (already calculated by NHL, e.g., 2.54).';



CREATE TABLE IF NOT EXISTS "public"."player_shifts" (
    "id" bigint NOT NULL,
    "player_id" integer NOT NULL,
    "game_id" integer NOT NULL,
    "period" integer NOT NULL,
    "shift_start_time_seconds" numeric NOT NULL,
    "shift_end_time_seconds" numeric,
    "situation" character varying(10) NOT NULL,
    "team_id" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "season" integer
);


ALTER TABLE "public"."player_shifts" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_shifts" IS 'Individual shift data tracking which players were on ice at any given time';



COMMENT ON COLUMN "public"."player_shifts"."season" IS 'NHL season year (e.g., 2024 for 2024-25 season).';



CREATE SEQUENCE IF NOT EXISTS "public"."player_shifts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."player_shifts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."player_shifts_id_seq" OWNED BY "public"."player_shifts"."id";



CREATE TABLE IF NOT EXISTS "public"."player_shifts_official" (
    "shift_id" bigint NOT NULL,
    "game_id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "team_abbrev" "text",
    "period" integer NOT NULL,
    "shift_number" integer NOT NULL,
    "start_time" "text",
    "end_time" "text",
    "duration" "text",
    "shift_start_time_seconds" integer DEFAULT 0 NOT NULL,
    "shift_end_time_seconds" integer DEFAULT 0 NOT NULL,
    "duration_seconds" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_shifts_official" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_shifts_official" IS 'Official shift intervals per player from NHL shiftcharts endpoint (used for accurate +/-).';



CREATE TABLE IF NOT EXISTS "public"."player_talent_metrics" (
    "player_id" integer NOT NULL,
    "season" integer DEFAULT 2025 NOT NULL,
    "ros_projection_xg" numeric(10,4),
    "talent_adjusted_xg_per_60" numeric(10,4),
    "avg_toi_per_game" numeric(6,2),
    "calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gp_last_10" integer DEFAULT 0,
    "is_likely_to_play" boolean DEFAULT false,
    "last_updated" "date",
    "positional_replacement_level" numeric(10,3),
    "positional_std_dev" numeric(10,3),
    "vopa_score" numeric(10,3),
    "vopa_calculation_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "roster_status" "text",
    "is_ir_eligible" boolean DEFAULT false,
    "roster_status_updated_at" timestamp with time zone,
    "xg_per_60" numeric(6,2),
    "xg_rating" "text"
);


ALTER TABLE "public"."player_talent_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_talent_metrics" IS 'Pre-calculated player metrics for fast filtering and VOPA calculations. Updated daily by populate_gp_last_10_metric.py';



COMMENT ON COLUMN "public"."player_talent_metrics"."ros_projection_xg" IS 'Matchup-neutral predictive value: (Talent-Adjusted xG/60) × (Average TOI per game / 60)';



COMMENT ON COLUMN "public"."player_talent_metrics"."talent_adjusted_xg_per_60" IS 'Player talent-adjusted xG per 60 minutes';



COMMENT ON COLUMN "public"."player_talent_metrics"."avg_toi_per_game" IS 'Average Time On Ice per game in minutes';



COMMENT ON COLUMN "public"."player_talent_metrics"."gp_last_10" IS 'Games played in last 10 games (calculated over 14-day window). Used for "Likely-to-Play" filtering.';



COMMENT ON COLUMN "public"."player_talent_metrics"."is_likely_to_play" IS 'Derived from gp_last_10 > 0. Players with FALSE should have VOPA and TOI set to zero.';



COMMENT ON COLUMN "public"."player_talent_metrics"."last_updated" IS 'Date when metrics were last calculated. Used for cache invalidation.';



COMMENT ON COLUMN "public"."player_talent_metrics"."positional_replacement_level" IS 'Replacement level (baseline) for player position. Calculated dynamically based on league_size × roster_slots[position].';



COMMENT ON COLUMN "public"."player_talent_metrics"."positional_std_dev" IS 'Standard deviation for player position. Used for Z-Score normalization in VOPA calculation.';



COMMENT ON COLUMN "public"."player_talent_metrics"."vopa_score" IS 'Most recent VOPA (Value Over Positional Average) score. Formula: (player_points - replacement_level) / std_dev';



COMMENT ON COLUMN "public"."player_talent_metrics"."vopa_calculation_date" IS 'Date when VOPA was calculated. Enables historical tracking and diagnostic verification.';



COMMENT ON COLUMN "public"."player_talent_metrics"."roster_status" IS 'Official NHL roster status from API: ACT, IR, LTIR, etc.';



COMMENT ON COLUMN "public"."player_talent_metrics"."is_ir_eligible" IS 'True if player is on IR or LTIR and can be placed in IR slot';



COMMENT ON COLUMN "public"."player_talent_metrics"."roster_status_updated_at" IS 'Timestamp when roster status was last fetched from NHL API';



CREATE TABLE IF NOT EXISTS "public"."player_toi_by_situation" (
    "id" bigint NOT NULL,
    "player_id" integer NOT NULL,
    "game_id" integer NOT NULL,
    "situation" character varying(10) NOT NULL,
    "toi_seconds" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "season" integer
);


ALTER TABLE "public"."player_toi_by_situation" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_toi_by_situation" IS 'Time On Ice (TOI) for each player by game situation (5v5, PP, PK)';



COMMENT ON COLUMN "public"."player_toi_by_situation"."season" IS 'NHL season year (e.g., 2024 for 2024-25 season).';



CREATE SEQUENCE IF NOT EXISTS "public"."player_toi_by_situation_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."player_toi_by_situation_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."player_toi_by_situation_id_seq" OWNED BY "public"."player_toi_by_situation"."id";



CREATE TABLE IF NOT EXISTS "public"."player_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" integer NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "transaction_type" "text" NOT NULL,
    "source" "text" DEFAULT 'free_agent'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "player_name" "text",
    "player_team" "text",
    "player_position" "text",
    CONSTRAINT "player_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['add'::"text", 'drop'::"text"])))
);


ALTER TABLE "public"."player_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_transactions" IS 'ORPHANED as of 2026-08-12. Zero rows, ever. Its only writer record_player_transaction() is called by nothing (verified against cron.job, pg_proc and the repo), and its only reader get_trending_players() was repointed at transaction_ledger, which the real add/drop path writes. Retained pending a decision to drop it; do not build on it.';



CREATE TABLE IF NOT EXISTS "public"."player_waiver_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "dropped_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cleared_at" timestamp with time zone,
    "dropped_by_team_id" "uuid"
);


ALTER TABLE "public"."player_waiver_status" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_waiver_status" IS 'Tracks players sitting on waivers after a drop. cleared_at is stamped once the waiver period (leagues.waiver_period_hours, default 48) elapses.';



CREATE TABLE IF NOT EXISTS "public"."player_weekly_stats" (
    "id" bigint NOT NULL,
    "player_id" integer NOT NULL,
    "week_number" integer NOT NULL,
    "week_start_date" "date" NOT NULL,
    "week_end_date" "date" NOT NULL,
    "goals" integer DEFAULT 0,
    "primary_assists" integer DEFAULT 0,
    "secondary_assists" integer DEFAULT 0,
    "assists" integer GENERATED ALWAYS AS (("primary_assists" + "secondary_assists")) STORED,
    "points" integer GENERATED ALWAYS AS ((("goals" + "primary_assists") + "secondary_assists")) STORED,
    "shots_on_goal" integer DEFAULT 0,
    "hits" integer DEFAULT 0,
    "blocks" integer DEFAULT 0,
    "pim" integer DEFAULT 0,
    "ppp" integer DEFAULT 0,
    "shp" integer DEFAULT 0,
    "plus_minus" integer DEFAULT 0,
    "goalie_gp" integer DEFAULT 0,
    "wins" integer DEFAULT 0,
    "saves" integer DEFAULT 0,
    "goals_against" integer DEFAULT 0,
    "shots_faced" integer DEFAULT 0,
    "shutouts" integer DEFAULT 0,
    "x_goals" numeric(10,3) DEFAULT 0,
    "games_played" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "nhl_goals" integer DEFAULT 0 NOT NULL,
    "nhl_assists" integer DEFAULT 0 NOT NULL,
    "nhl_points" integer DEFAULT 0 NOT NULL,
    "nhl_shots_on_goal" integer DEFAULT 0 NOT NULL,
    "nhl_hits" integer DEFAULT 0 NOT NULL,
    "nhl_blocks" integer DEFAULT 0 NOT NULL,
    "nhl_pim" integer DEFAULT 0 NOT NULL,
    "nhl_ppp" integer DEFAULT 0 NOT NULL,
    "nhl_shp" integer DEFAULT 0 NOT NULL,
    "nhl_plus_minus" integer DEFAULT 0 NOT NULL,
    "nhl_wins" integer DEFAULT 0 NOT NULL,
    "nhl_losses" integer DEFAULT 0 NOT NULL,
    "nhl_ot_losses" integer DEFAULT 0 NOT NULL,
    "nhl_saves" integer DEFAULT 0 NOT NULL,
    "nhl_shots_faced" integer DEFAULT 0 NOT NULL,
    "nhl_goals_against" integer DEFAULT 0 NOT NULL,
    "nhl_shutouts" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."player_weekly_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."player_weekly_stats" IS 'Pre-aggregated weekly player statistics (Sunday-Saturday weeks)';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_goals" IS 'Aggregated NHL.com goals for this week (sum of nhl_goals from player_game_stats).';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_assists" IS 'Aggregated NHL.com assists for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_points" IS 'Aggregated NHL.com points for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_shots_on_goal" IS 'Aggregated NHL.com shots on goal for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_hits" IS 'Aggregated NHL.com hits for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_blocks" IS 'Aggregated NHL.com blocked shots for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_pim" IS 'Aggregated NHL.com penalty minutes for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_ppp" IS 'Aggregated NHL.com power play points for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_shp" IS 'Aggregated NHL.com short-handed points for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_plus_minus" IS 'Aggregated NHL.com plus/minus for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_wins" IS 'Aggregated NHL.com goalie wins for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_losses" IS 'Aggregated NHL.com goalie losses for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_ot_losses" IS 'Aggregated NHL.com goalie OT losses for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_saves" IS 'Aggregated NHL.com goalie saves for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_shots_faced" IS 'Aggregated NHL.com shots faced for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_goals_against" IS 'Aggregated NHL.com goals against for this week.';



COMMENT ON COLUMN "public"."player_weekly_stats"."nhl_shutouts" IS 'Aggregated NHL.com shutouts for this week.';



CREATE SEQUENCE IF NOT EXISTS "public"."player_weekly_stats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."player_weekly_stats_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."player_weekly_stats_id_seq" OWNED BY "public"."player_weekly_stats"."id";



CREATE TABLE IF NOT EXISTS "public"."player_xg_season" (
    "season" integer NOT NULL,
    "game_type" "text" NOT NULL,
    "player_id" integer NOT NULL,
    "team_id" integer NOT NULL,
    "shots" integer NOT NULL,
    "sog" integer NOT NULL,
    "goals" integer NOT NULL,
    "xg" double precision NOT NULL,
    "finishing" double precision NOT NULL,
    "shots_ev" integer NOT NULL,
    "shots_pp" integer NOT NULL,
    "shots_pk" integer NOT NULL,
    "goals_ev" integer NOT NULL,
    "goals_pp" integer NOT NULL,
    "goals_sh" integer NOT NULL,
    "xg_ev" double precision NOT NULL,
    "xg_pp" double precision NOT NULL,
    "xg_pk" double precision NOT NULL,
    "goals_en" integer NOT NULL,
    "xg_en" double precision NOT NULL,
    "avg_dist" double precision,
    "avg_xg_per_shot" double precision,
    "rebounds_shot" integer NOT NULL,
    "rush_shots" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."player_xg_season" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "position" "text" NOT NULL,
    "team" "text" NOT NULL,
    "jersey_number" "text",
    "status" "text",
    "goals" integer DEFAULT 0,
    "assists" integer DEFAULT 0,
    "points" integer DEFAULT 0,
    "plus_minus" integer DEFAULT 0,
    "shots" integer DEFAULT 0,
    "hits" integer DEFAULT 0,
    "blocks" integer DEFAULT 0,
    "wins" integer,
    "losses" integer,
    "ot_losses" integer,
    "saves" integer,
    "goals_against_average" numeric,
    "save_percentage" numeric,
    "headshot_url" "text",
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "team_id" integer
);


ALTER TABLE "public"."players" OWNER TO "postgres";


COMMENT ON TABLE "public"."players" IS 'LEGACY player table, superseded by player_directory (which serves ~468M reads to this table''s ~19K). Repo migration 20260505200000_drop_legacy_public_players_table.sql drops it but has never been applied to this database. Retained only because one inbound FK and several function bodies still reference it — resolve those before dropping.';



CREATE TABLE IF NOT EXISTS "public"."playoff_bracket_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "series_slot" smallint NOT NULL,
    "picked_team_id" integer NOT NULL,
    "predicted_games" smallint,
    "is_correct" boolean,
    "points_earned" numeric(10,2) DEFAULT 0,
    "locked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "playoff_bracket_picks_predicted_games_check" CHECK ((("predicted_games" >= 4) AND ("predicted_games" <= 7)))
);


ALTER TABLE "public"."playoff_bracket_picks" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_bracket_picks" IS 'NHL playoff bracket predictions, one pick per series slot, locked at locked_at.';



CREATE TABLE IF NOT EXISTS "public"."playoff_brackets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "season" integer DEFAULT EXTRACT(year FROM "now"()) NOT NULL,
    "bracket_size" integer NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "current_round" integer DEFAULT 0 NOT NULL,
    "total_rounds" integer NOT NULL,
    "seeding_method" "text" DEFAULT 'standings'::"text" NOT NULL,
    "reseed_each_round" boolean DEFAULT false NOT NULL,
    "consolation_enabled" boolean DEFAULT false NOT NULL,
    "two_week_matchups" boolean DEFAULT false NOT NULL,
    "champion_team_id" "uuid",
    "runner_up_team_id" "uuid",
    "third_place_team_id" "uuid",
    "generated_by" "uuid",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "playoff_brackets_bracket_size_check" CHECK (("bracket_size" = ANY (ARRAY[4, 6, 8]))),
    CONSTRAINT "playoff_brackets_seeding_method_check" CHECK (("seeding_method" = ANY (ARRAY['standings'::"text", 'manual'::"text"]))),
    CONSTRAINT "playoff_brackets_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."playoff_brackets" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_brackets" IS 'FANTASY league playoff bracket configuration. Not NHL playoffs — see nhl_playoff_series for the real thing.';



CREATE TABLE IF NOT EXISTS "public"."playoff_confidence_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "series_slot" smallint NOT NULL,
    "picked_team_id" integer NOT NULL,
    "confidence_value" smallint NOT NULL,
    "is_correct" boolean,
    "points_earned" numeric(10,2) DEFAULT 0,
    "locked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "playoff_confidence_picks_confidence_value_check" CHECK (("confidence_value" >= 1))
);


ALTER TABLE "public"."playoff_confidence_picks" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_confidence_picks" IS 'NHL playoff series picks weighted by confidence_value.';



CREATE TABLE IF NOT EXISTS "public"."playoff_pool_standings" (
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "total_points" numeric(10,2) DEFAULT 0 NOT NULL,
    "correct_picks" integer DEFAULT 0 NOT NULL,
    "current_rank" integer,
    "last_updated" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."playoff_pool_standings" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_pool_standings" IS 'Materialised leaderboard for NHL playoff pools. Refreshed by scoring RPCs rather than maintained transactionally.';



CREATE TABLE IF NOT EXISTS "public"."playoff_roster_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "position_slot" "text" NOT NULL,
    "locked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."playoff_roster_picks" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_roster_picks" IS 'NHL playoff fantasy roster selections by position slot.';



CREATE TABLE IF NOT EXISTS "public"."playoff_seeds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bracket_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "seed_number" integer NOT NULL,
    "regular_season_wins" integer DEFAULT 0 NOT NULL,
    "regular_season_losses" integer DEFAULT 0 NOT NULL,
    "regular_season_ties" integer DEFAULT 0 NOT NULL,
    "regular_season_points_for" numeric DEFAULT 0 NOT NULL,
    "source" "text" DEFAULT 'standings'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "playoff_seeds_seed_number_check" CHECK ((("seed_number" >= 1) AND ("seed_number" <= 16))),
    CONSTRAINT "playoff_seeds_source_check" CHECK (("source" = ANY (ARRAY['standings'::"text", 'commissioner_override'::"text"])))
);


ALTER TABLE "public"."playoff_seeds" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_seeds" IS 'FANTASY playoff seeding for a bracket, derived from regular-season record. Distinct from nhl_playoff_seeds, which holds real NHL seeding.';



CREATE TABLE IF NOT EXISTS "public"."playoff_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bracket_id" "uuid" NOT NULL,
    "round_number" integer NOT NULL,
    "match_number" integer NOT NULL,
    "bracket_position" "text" DEFAULT 'winners'::"text" NOT NULL,
    "home_seed" integer,
    "away_seed" integer,
    "home_team_id" "uuid",
    "away_team_id" "uuid",
    "home_score" numeric DEFAULT 0 NOT NULL,
    "away_score" numeric DEFAULT 0 NOT NULL,
    "winner_team_id" "uuid",
    "loser_team_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "matchup_week_1" integer,
    "matchup_week_2" integer,
    "winner_advances_to" "uuid",
    "winner_slot" "text",
    "loser_drops_to" "uuid",
    "loser_slot" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "playoff_series_loser_slot_check" CHECK (("loser_slot" = ANY (ARRAY['home'::"text", 'away'::"text"]))),
    CONSTRAINT "playoff_series_match_number_check" CHECK (("match_number" >= 1)),
    CONSTRAINT "playoff_series_round_number_check" CHECK (("round_number" >= 1)),
    CONSTRAINT "playoff_series_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'bye'::"text", 'active'::"text", 'completed'::"text"]))),
    CONSTRAINT "playoff_series_winner_slot_check" CHECK (("winner_slot" = ANY (ARRAY['home'::"text", 'away'::"text"])))
);


ALTER TABLE "public"."playoff_series" OWNER TO "postgres";


COMMENT ON TABLE "public"."playoff_series" IS 'FANTASY playoff series within a bracket. Winner propagation to the next round is trigger-driven. Distinct from nhl_playoff_series.';



CREATE TABLE IF NOT EXISTS "public"."policy_versions" (
    "policy_type" "text" NOT NULL,
    "version" "text" NOT NULL,
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "requires_consent" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "policy_versions_policy_type_check" CHECK (("policy_type" = ANY (ARRAY['terms_of_service'::"text", 'privacy_policy'::"text", 'cookie_policy'::"text", 'marketing_email'::"text", 'data_processing'::"text", 'age_confirmation'::"text"]))),
    CONSTRAINT "policy_versions_version_check" CHECK (("length"("btrim"("version")) > 0))
);


ALTER TABLE "public"."policy_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."policy_versions" IS 'The version of each policy currently in force. Compared against user_privacy_consent by get_user_consent_status() to decide who must be re-prompted. Bumping a version here is what triggers a re-consent campaign.';



CREATE TABLE IF NOT EXISTS "public"."pool_picks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_number" integer NOT NULL,
    "game_id" "text" NOT NULL,
    "picked_team" "text" NOT NULL,
    "is_correct" boolean,
    "spread_value" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pool_picks_week_number_check" CHECK (("week_number" > 0))
);


ALTER TABLE "public"."pool_picks" OWNER TO "postgres";


COMMENT ON TABLE "public"."pool_picks" IS 'Weekly pick-em selections against the spread. Participants are also team owners in the same league — the profiles league-scoped read policy relies on that coupling.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "location" "text",
    "bio" "text",
    "default_team_name" "text",
    "Email" "text",
    "timezone" "text" DEFAULT 'America/Denver'::"text",
    "is_admin" boolean DEFAULT false NOT NULL,
    "display_name" "text",
    "avatar_url" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'One row per authenticated user. Contains PII (first_name, last_name, phone, Email, location) — read access is league-scoped via the "League members can view each other profiles" policy backed by shares_league_with(). is_admin gates the /api/admin/* routes.';



COMMENT ON COLUMN "public"."profiles"."Email" IS 'Users Email';



CREATE TABLE IF NOT EXISTS "public"."projection_cache" (
    "cache_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "player_id" integer NOT NULL,
    "game_id" integer NOT NULL,
    "projection_date" "date" NOT NULL,
    "season" integer NOT NULL,
    "projected_goals" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_assists" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_shots" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_blocks" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_saves" numeric(5,3) DEFAULT 0 NOT NULL,
    "projected_toi_seconds" integer DEFAULT 0 NOT NULL,
    "base_goals" numeric(5,3),
    "base_assists" numeric(5,3),
    "base_shots" numeric(5,3),
    "base_blocks" numeric(5,3),
    "opponent_xga_suppression" numeric(5,3),
    "goalie_gsax_factor" numeric(5,3),
    "finishing_multiplier" numeric(4,3),
    "opponent_adjustment" numeric(4,3),
    "calculation_timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_source_hash" "text",
    CONSTRAINT "projection_date_not_future" CHECK (("projection_date" <= ("calculation_timestamp")::"date"))
);


ALTER TABLE "public"."projection_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."projection_cache" IS 'Stores physical (score-blind) projections before fantasy scoring. Enables reactive recalculation when league settings change without re-running physical projection layer.';



COMMENT ON COLUMN "public"."projection_cache"."projected_goals" IS 'Raw projected goals (physical event, not fantasy points)';



COMMENT ON COLUMN "public"."projection_cache"."projected_assists" IS 'Raw projected assists (physical event, not fantasy points)';



COMMENT ON COLUMN "public"."projection_cache"."projected_shots" IS 'Raw projected shots on goal (physical event, not fantasy points)';



COMMENT ON COLUMN "public"."projection_cache"."projected_blocks" IS 'Raw projected blocks (physical event, not fantasy points)';



COMMENT ON COLUMN "public"."projection_cache"."projected_saves" IS 'Raw projected saves for goalies (physical event, not fantasy points)';



COMMENT ON COLUMN "public"."projection_cache"."projected_toi_seconds" IS 'Projected time on ice in seconds';



COMMENT ON COLUMN "public"."projection_cache"."opponent_xga_suppression" IS 'Opponent team xGA suppression factor (used for matchup adjustment)';



COMMENT ON COLUMN "public"."projection_cache"."goalie_gsax_factor" IS 'Opposing goalie GSAx factor (used for matchup adjustment)';



COMMENT ON COLUMN "public"."projection_cache"."data_source_hash" IS 'Hash of input parameters (player_id, game_id, date, season) for integrity checking';



COMMENT ON CONSTRAINT "projection_date_not_future" ON "public"."projection_cache" IS 'Prevents future projections from being stored (data leak protection)';



CREATE TABLE IF NOT EXISTS "public"."projections" (
    "projection_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" integer NOT NULL,
    "player_id" "uuid" NOT NULL,
    "projected_points" numeric,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."projections" OWNER TO "postgres";


COMMENT ON TABLE "public"."projections" IS 'LEGACY thin projection table (7 columns, per game_id/player_id). Superseded by player_projected_stats and player_ros_projections. Retained pending call-site cleanup — do not build new consumers on it.';



ALTER TABLE "public"."_deprecated_public.players" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."public.players_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."raw_nhl_data" (
    "id" bigint NOT NULL,
    "game_id" integer NOT NULL,
    "game_date" "date" NOT NULL,
    "raw_json" "jsonb" NOT NULL,
    "scraped_at" timestamp with time zone DEFAULT "now"(),
    "processed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "stats_extracted" boolean DEFAULT false,
    "stats_extracted_at" timestamp with time zone,
    "boxscore_json" "jsonb",
    "source_url" "text",
    "content_sha256" "text",
    "fetched_at" timestamp with time zone
);


ALTER TABLE "public"."raw_nhl_data" OWNER TO "postgres";


COMMENT ON TABLE "public"."raw_nhl_data" IS 'Raw JSON play-by-play data from NHL API. Phase 1 stores data here, Phase 2 processes it into raw_shots table.';



COMMENT ON COLUMN "public"."raw_nhl_data"."raw_json" IS 'Full play-by-play JSON response from NHL API play-by-play endpoint';



COMMENT ON COLUMN "public"."raw_nhl_data"."processed" IS 'True if this game has been processed and shots saved to raw_shots table';



COMMENT ON COLUMN "public"."raw_nhl_data"."stats_extracted" IS 'True when fantasy stat extraction (player_game_stats) has been performed for the final game payload.';



COMMENT ON COLUMN "public"."raw_nhl_data"."stats_extracted_at" IS 'Timestamp when stats_extracted was set true.';



COMMENT ON COLUMN "public"."raw_nhl_data"."boxscore_json" IS 'Full boxscore JSON response from NHL API boxscore endpoint. Contains player stats organized by position groups (forwards, defense, goalies) for proper defencemen handling.';



CREATE SEQUENCE IF NOT EXISTS "public"."raw_nhl_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."raw_nhl_data_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."raw_nhl_data_id_seq" OWNED BY "public"."raw_nhl_data"."id";



CREATE TABLE IF NOT EXISTS "public"."raw_player_stats" (
    "id" bigint NOT NULL,
    "playerId" integer NOT NULL,
    "game_id" integer NOT NULL,
    "season" integer,
    "I_F_xGoals" numeric,
    "OnIce_xGoalsPercentage" numeric,
    "I_F_lowDangerxGoals" numeric,
    "I_F_highDangerxGoals" numeric,
    "goals_saved_above_expected" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."raw_player_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."raw_player_stats" IS 'MoneyPuck-derived per-player expected-goals metrics. WRITE-ONLY IN PRACTICE: written by data-pipeline/acquisition/data_acquisition.py:4302,4324 but read by nothing in the application (9 lifetime reads). Also note the camelCase "playerId" column, which breaks the snake_case convention used everywhere else.';



ALTER TABLE "public"."raw_player_stats" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."raw_player_stats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."raw_shots" (
    "id" bigint NOT NULL,
    "game_id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "passer_id" integer,
    "shot_x" numeric NOT NULL,
    "shot_y" numeric NOT NULL,
    "pass_x" numeric,
    "pass_y" numeric,
    "shot_type_code" integer,
    "shot_type" character varying(50),
    "is_goal" boolean DEFAULT false,
    "distance" numeric NOT NULL,
    "angle" numeric NOT NULL,
    "is_rebound" boolean DEFAULT false,
    "is_power_play" boolean DEFAULT false,
    "score_differential" integer,
    "has_pass_before_shot" boolean DEFAULT false,
    "pass_lateral_distance" numeric,
    "pass_to_net_distance" numeric,
    "pass_zone" character varying(50),
    "pass_immediacy_score" numeric,
    "goalie_movement_score" numeric,
    "pass_quality_score" numeric,
    "time_before_shot" numeric,
    "pass_angle" numeric,
    "normalized_lateral_distance" numeric,
    "zone_relative_distance" numeric,
    "xg_value" numeric NOT NULL,
    "xa_value" numeric,
    "shot_type_encoded" integer,
    "pass_zone_encoded" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "home_skaters_on_ice" integer,
    "away_skaters_on_ice" integer,
    "is_empty_net" boolean DEFAULT false,
    "penalty_length" integer,
    "penalty_time_left" integer,
    "last_event_category" character varying(50),
    "last_event_x" numeric,
    "last_event_y" numeric,
    "last_event_team" character varying(10),
    "distance_from_last_event" numeric,
    "time_since_last_event" numeric,
    "speed_from_last_event" numeric,
    "goalie_id" integer,
    "goalie_name" character varying(100),
    "period" integer,
    "time_in_period" character varying(10),
    "time_remaining_seconds" integer,
    "time_since_faceoff" numeric,
    "team_code" character varying(10),
    "is_home_team" boolean,
    "zone" character varying(20),
    "home_score" integer,
    "away_score" integer,
    "shot_was_on_goal" boolean DEFAULT false,
    "shot_goalie_froze" boolean DEFAULT false,
    "shot_generated_rebound" boolean DEFAULT false,
    "shot_play_stopped" boolean DEFAULT false,
    "shot_play_continued_in_zone" boolean DEFAULT false,
    "shot_play_continued_outside_zone" boolean DEFAULT false,
    "is_rush" boolean DEFAULT false,
    "event_id" integer,
    "sort_order" integer,
    "type_desc" character varying(100),
    "period_type" character varying(20),
    "time_remaining" character varying(10),
    "situation_code" character varying(20),
    "home_team_defending_side" character varying(10),
    "zone_code" character varying(10),
    "shooting_player_id" integer,
    "scoring_player_id" integer,
    "assist1_player_id" integer,
    "assist2_player_id" integer,
    "goalie_in_net_id" integer,
    "event_owner_team_id" integer,
    "home_team_id" integer,
    "away_team_id" integer,
    "home_team_abbrev" character varying(10),
    "away_team_abbrev" character varying(10),
    "away_sog" integer,
    "home_sog" integer,
    "shot_type_raw" character varying(50),
    "miss_reason" character varying(100),
    "arena_adjusted_x" numeric,
    "arena_adjusted_y" numeric,
    "arena_adjusted_x_abs" numeric,
    "arena_adjusted_y_abs" numeric,
    "arena_adjusted_shot_distance" numeric,
    "shot_angle_plus_rebound" numeric,
    "shot_angle_plus_rebound_speed" numeric,
    "last_event_shot_angle" numeric,
    "last_event_shot_distance" numeric,
    "player_num_that_did_last_event" integer,
    "shot_angle_adjusted" numeric,
    "home_empty_net" boolean DEFAULT false,
    "away_empty_net" boolean DEFAULT false,
    "shooting_team_code" character varying(10),
    "defending_team_code" character varying(10),
    "defending_team_skaters_on_ice" integer,
    "east_west_location_of_last_event" numeric,
    "east_west_location_of_shot" numeric,
    "north_south_location_of_shot" numeric,
    "time_since_powerplay_started" numeric,
    "flurry_adjusted_xg" numeric,
    "shooter_time_on_ice" numeric,
    "shooter_time_on_ice_since_faceoff" numeric,
    "shooting_team_average_time_on_ice" numeric,
    "shooting_team_max_time_on_ice" numeric,
    "shooting_team_min_time_on_ice" numeric,
    "shooting_team_average_time_on_ice_of_forwards" numeric,
    "shooting_team_max_time_on_ice_of_forwards" numeric,
    "shooting_team_min_time_on_ice_of_forwards" numeric,
    "shooting_team_average_time_on_ice_of_defencemen" numeric,
    "shooting_team_max_time_on_ice_of_defencemen" numeric,
    "shooting_team_min_time_on_ice_of_defencemen" numeric,
    "shooting_team_average_time_on_ice_since_faceoff" numeric,
    "shooting_team_max_time_on_ice_since_faceoff" numeric,
    "shooting_team_min_time_on_ice_since_faceoff" numeric,
    "shooting_team_average_time_on_ice_of_forwards_since_faceoff" numeric,
    "shooting_team_max_time_on_ice_of_forwards_since_faceoff" numeric,
    "shooting_team_min_time_on_ice_of_forwards_since_faceoff" numeric,
    "shooting_team_average_time_on_ice_of_defencemen_since_faceoff" numeric,
    "shooting_team_max_time_on_ice_of_defencemen_since_faceoff" numeric,
    "shooting_team_min_time_on_ice_of_defencemen_since_faceoff" numeric,
    "defending_team_average_time_on_ice" numeric,
    "defending_team_max_time_on_ice" numeric,
    "defending_team_min_time_on_ice" numeric,
    "defending_team_average_time_on_ice_of_forwards" numeric,
    "defending_team_max_time_on_ice_of_forwards" numeric,
    "defending_team_min_time_on_ice_of_forwards" numeric,
    "defending_team_average_time_on_ice_of_defencemen" numeric,
    "defending_team_max_time_on_ice_of_defencemen" numeric,
    "defending_team_min_time_on_ice_of_defencemen" numeric,
    "defending_team_average_time_on_ice_since_faceoff" numeric,
    "defending_team_max_time_on_ice_since_faceoff" numeric,
    "defending_team_min_time_on_ice_since_faceoff" numeric,
    "defending_team_average_time_on_ice_of_forwards_since_faceoff" numeric,
    "defending_team_max_time_on_ice_of_forwards_since_faceoff" numeric,
    "defending_team_min_time_on_ice_of_forwards_since_faceoff" numeric,
    "defending_team_average_time_on_ice_of_defencemen_since_faceoff" numeric,
    "defending_team_max_time_on_ice_of_defencemen_since_faceoff" numeric,
    "defending_team_min_time_on_ice_of_defencemen_since_faceoff" numeric,
    "time_difference_since_change" numeric,
    "average_rest_difference" numeric,
    "shooting_team_forwards_on_ice" integer,
    "shooting_team_defencemen_on_ice" integer,
    "defending_team_forwards_on_ice" integer,
    "defending_team_defencemen_on_ice" integer,
    "angle_change_from_last_event" numeric,
    "angle_change_squared" numeric,
    "distance_change_from_last_event" numeric,
    "shot_angle_rebound_royal_road" integer DEFAULT 0,
    "player_position" character varying(1),
    "expected_rebound_probability" numeric DEFAULT 0.0,
    "expected_goals_of_expected_rebounds" numeric DEFAULT 0.0,
    "shooting_talent_adjusted_xg" numeric,
    "shooting_talent_multiplier" numeric DEFAULT 1.0,
    "created_expected_goals" numeric DEFAULT 0.0,
    "season" integer,
    "distance_to_nearest_defender" numeric,
    "nearest_defender_to_net_distance" numeric,
    "skaters_in_screening_box" integer,
    "xg_value_recomputed" numeric,
    "source" "text" DEFAULT 'citrus_pbp_extract'::"text" NOT NULL
);


ALTER TABLE "public"."raw_shots" OWNER TO "postgres";


COMMENT ON TABLE "public"."raw_shots" IS 'Individual shot records with coordinates and all calculated features for visualization and analysis';



COMMENT ON COLUMN "public"."raw_shots"."passer_id" IS 'Phase 0c. NHL player id of the passer on the reconstructed pre-shot pass.';



COMMENT ON COLUMN "public"."raw_shots"."shot_x" IS 'X coordinate of shot location (NHL coordinates, net at x=89)';



COMMENT ON COLUMN "public"."raw_shots"."shot_y" IS 'Y coordinate of shot location (NHL coordinates, net at y=0)';



COMMENT ON COLUMN "public"."raw_shots"."pass_x" IS 'Phase 0c. Pass origin x in NHL RAW rink coordinates. NOT arena-adjusted — matching against MoneyPuck adjusted coordinates was the cause of the arena-adjust ambiguity storm and is fixed at commit 7c4b7026.';



COMMENT ON COLUMN "public"."raw_shots"."pass_y" IS 'Phase 0c. Pass origin y in NHL RAW rink coordinates. See pass_x on the raw-vs-adjusted distinction.';



COMMENT ON COLUMN "public"."raw_shots"."has_pass_before_shot" IS 'Phase 0c moat feature. TRUE when a pass was reconstructed immediately before this shot from the NHL play-by-play event stream. NULL means genuinely unknown, not false — bounded honest-NULL is intended.';



COMMENT ON COLUMN "public"."raw_shots"."pass_lateral_distance" IS 'Phase 0c. Lateral (cross-ice) distance covered by the pass — the raw driver of goalie displacement.';



COMMENT ON COLUMN "public"."raw_shots"."pass_to_net_distance" IS 'Phase 0c. Distance from pass origin to the net.';



COMMENT ON COLUMN "public"."raw_shots"."pass_zone" IS 'Phase 0c. Textual zone the pass originated from; pass_zone_encoded is its numeric encoding for modelling.';



COMMENT ON COLUMN "public"."raw_shots"."pass_immediacy_score" IS 'Phase 0c moat feature. How immediately the shot followed the pass — lower elapsed time means less goalie reset opportunity.';



COMMENT ON COLUMN "public"."raw_shots"."goalie_movement_score" IS 'Phase 0c moat feature. Estimated goalie lateral displacement forced by the pre-shot pass. The core of the pass-context moat.';



COMMENT ON COLUMN "public"."raw_shots"."pass_quality_score" IS 'Phase 0c moat feature. Composite quality of the pre-shot pass.';



COMMENT ON COLUMN "public"."raw_shots"."time_before_shot" IS 'Phase 0c. Elapsed time from pass to shot. INTEGER SECONDS — not milliseconds, and not fractional.';



COMMENT ON COLUMN "public"."raw_shots"."pass_angle" IS 'Phase 0c. Angle of the pass relative to the attacking net.';



COMMENT ON COLUMN "public"."raw_shots"."normalized_lateral_distance" IS 'Phase 0c. pass_lateral_distance normalised for rink geometry.';



COMMENT ON COLUMN "public"."raw_shots"."zone_relative_distance" IS 'Phase 0c. Pass distance expressed relative to the originating zone.';



COMMENT ON COLUMN "public"."raw_shots"."pass_zone_encoded" IS 'Phase 0c. Numeric encoding of pass_zone for model input.';



COMMENT ON COLUMN "public"."raw_shots"."home_skaters_on_ice" IS 'Number of home team skaters on ice (typically 5, 6 for empty net)';



COMMENT ON COLUMN "public"."raw_shots"."away_skaters_on_ice" IS 'Number of away team skaters on ice (typically 5, 6 for empty net)';



COMMENT ON COLUMN "public"."raw_shots"."is_empty_net" IS 'True if goalie was pulled (empty net situation)';



COMMENT ON COLUMN "public"."raw_shots"."last_event_category" IS 'Category of previous event (FAC, SHOT, GOAL, etc.)';



COMMENT ON COLUMN "public"."raw_shots"."distance_from_last_event" IS 'Distance in feet from last event location to shot location';



COMMENT ON COLUMN "public"."raw_shots"."time_since_last_event" IS 'Seconds between last event and shot';



COMMENT ON COLUMN "public"."raw_shots"."speed_from_last_event" IS 'Speed in feet per second from last event to shot';



COMMENT ON COLUMN "public"."raw_shots"."goalie_id" IS 'NHL player ID of goalie in net for this shot';



COMMENT ON COLUMN "public"."raw_shots"."period" IS 'Period number (1, 2, 3, or 4+ for overtime)';



COMMENT ON COLUMN "public"."raw_shots"."zone" IS 'Zone where shot occurred: HOMEZONE, AWAYZONE, or NEUTRALZONE';



COMMENT ON COLUMN "public"."raw_shots"."shot_goalie_froze" IS 'True if goalie froze the puck after this shot';



COMMENT ON COLUMN "public"."raw_shots"."shot_generated_rebound" IS 'True if this shot created a rebound opportunity';



COMMENT ON COLUMN "public"."raw_shots"."is_rush" IS 'True if shot came from a rush (fast break from neutral/defensive zone)';



COMMENT ON COLUMN "public"."raw_shots"."event_id" IS 'Phase 0c companion. NHL play-by-play event id this shot was matched to. Valid only within its own provenance lineage — do not join across providers.';



COMMENT ON COLUMN "public"."raw_shots"."sort_order" IS 'Phase 0c companion. NHL play-by-play sort order, used to sequence events within a game when game-seconds tie.';



COMMENT ON COLUMN "public"."raw_shots"."shot_angle_adjusted" IS 'Absolute value of shot angle (MoneyPuck feature: shotAngleAdjusted, 8.9% importance)';



COMMENT ON COLUMN "public"."raw_shots"."home_empty_net" IS 'True if home team has empty net (goalie pulled)';



COMMENT ON COLUMN "public"."raw_shots"."away_empty_net" IS 'True if away team has empty net (goalie pulled)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_team_code" IS 'Team code of shooting team (MoneyPuck feature: shootingTeamCode)';



COMMENT ON COLUMN "public"."raw_shots"."defending_team_code" IS 'Team code of defending team (MoneyPuck feature: defendingTeamCode)';



COMMENT ON COLUMN "public"."raw_shots"."defending_team_skaters_on_ice" IS 'Number of skaters on ice for defending team (MoneyPuck Variable 9: Other team''s # of skaters)';



COMMENT ON COLUMN "public"."raw_shots"."east_west_location_of_last_event" IS 'East-West (Y) coordinate of last event before shot (MoneyPuck Variable 6)';



COMMENT ON COLUMN "public"."raw_shots"."east_west_location_of_shot" IS 'East-West (Y) coordinate of shot location (MoneyPuck Variable 10)';



COMMENT ON COLUMN "public"."raw_shots"."north_south_location_of_shot" IS 'North-South (X) coordinate of shot location (MoneyPuck Variable 14)';



COMMENT ON COLUMN "public"."raw_shots"."time_since_powerplay_started" IS 'Time in seconds since current powerplay started (MoneyPuck Variable 12)';



COMMENT ON COLUMN "public"."raw_shots"."flurry_adjusted_xg" IS 'Flurry adjusted expected goals (post-processing adjustment for shot sequences)';



COMMENT ON COLUMN "public"."raw_shots"."shooter_time_on_ice" IS 'Time on ice in seconds for shooter since shift start (MoneyPuck: shooterTimeOnIce)';



COMMENT ON COLUMN "public"."raw_shots"."shooter_time_on_ice_since_faceoff" IS 'Time on ice since last faceoff for shooter (MoneyPuck: shooterTimeOnIceSinceFaceoff)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_team_average_time_on_ice" IS 'Average TOI for all shooting team skaters (MoneyPuck: shootingTeamAverageTimeOnIce)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_team_max_time_on_ice" IS 'Maximum TOI for shooting team (0 if missing, MoneyPuck standard)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_team_min_time_on_ice" IS 'Minimum TOI for shooting team (999 if missing, MoneyPuck standard)';



COMMENT ON COLUMN "public"."raw_shots"."time_difference_since_change" IS 'Shooting team min TOI - defending team min TOI (MoneyPuck: timeDifferenceSinceChange)';



COMMENT ON COLUMN "public"."raw_shots"."average_rest_difference" IS 'Shooting team avg TOI since faceoff - defending team avg TOI since faceoff (MoneyPuck: averageRestDifference)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_team_forwards_on_ice" IS 'Number of forwards on ice for shooting team (MoneyPuck: shootingTeamForwardsOnIce)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_team_defencemen_on_ice" IS 'Number of defencemen on ice for shooting team (MoneyPuck: shootingTeamDefencemenOnIce)';



COMMENT ON COLUMN "public"."raw_shots"."angle_change_from_last_event" IS 'Change in shot angle from last event (degrees)';



COMMENT ON COLUMN "public"."raw_shots"."shot_angle_rebound_royal_road" IS '1 if rebound and puck crossed middle (y changed sign), else 0 (MoneyPuck: shotAngleReboundRoyalRoad)';



COMMENT ON COLUMN "public"."raw_shots"."player_position" IS 'Player position: L=Left Wing, R=Right Wing, D=Defenceman, C=Centre (MoneyPuck: playerPositionThatDidEvent)';



COMMENT ON COLUMN "public"."raw_shots"."expected_rebound_probability" IS 'Probability (0-1) that this shot will generate a rebound, predicted by rebound model';



COMMENT ON COLUMN "public"."raw_shots"."expected_goals_of_expected_rebounds" IS 'Expected goals value of potential rebound shot = rebound_probability × estimated_rebound_shot_xG';



COMMENT ON COLUMN "public"."raw_shots"."shooting_talent_adjusted_xg" IS 'xG value adjusted for player shooting talent (Bayesian estimation)';



COMMENT ON COLUMN "public"."raw_shots"."shooting_talent_multiplier" IS 'Multiplier applied to base xG based on player historical shooting performance (1.0 = average, >1.0 = above average, <1.0 = below average)';



COMMENT ON COLUMN "public"."raw_shots"."created_expected_goals" IS 'Created Expected Goals = xG from non-rebound shots + xGoals of xRebounds (credits players for generating rebound opportunities)';



COMMENT ON COLUMN "public"."raw_shots"."season" IS 'NHL season year (e.g., 2024 for 2024-25 season). Derived from game_id or game_date.';



COMMENT ON COLUMN "public"."raw_shots"."skaters_in_screening_box" IS 'Placeholder for future tracking-era screening feature. NULL in all rows as of Phase 0c; added for staging/prod schema parity.';



COMMENT ON COLUMN "public"."raw_shots"."source" IS 'Ingestion provenance. bulk_import_20260730 = third-party shot dataset loaded 2026-07-30 covering seasons 2017-2024; column vocabulary and several model outputs (expected_rebound_probability, shot_angle_plus_rebound, the 24-column TOI block) originate there and are NOT reproducible by our extractor. citrus_pbp_extract = our own extraction from raw_nhl_data, season 2025+. The two are NOT distributionally comparable: score_differential, time_remaining_seconds, situation_code, shot_type_encoded and defending_team_skaters_on_ice are 100% NULL in the bulk import and 100% populated in ours; is_rush, time_difference_since_change, average_rest_difference and expected_rebound_probability are the reverse. Never pool the two in a training set without first passing an adversarial era-detection test (AUC <= 0.55) on the exact production feature vector.';



CREATE SEQUENCE IF NOT EXISTS "public"."raw_shots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."raw_shots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."raw_shots_id_seq" OWNED BY "public"."raw_shots"."id";



CREATE TABLE IF NOT EXISTS "public"."raw_shots_rebuild" (
    "id" bigint DEFAULT "nextval"('"public"."raw_shots_id_seq"'::"regclass") NOT NULL,
    "game_id" integer NOT NULL,
    "player_id" integer NOT NULL,
    "passer_id" integer,
    "shot_x" numeric NOT NULL,
    "shot_y" numeric NOT NULL,
    "pass_x" numeric,
    "pass_y" numeric,
    "shot_type_code" integer,
    "shot_type" character varying(50),
    "is_goal" boolean DEFAULT false,
    "distance" numeric NOT NULL,
    "angle" numeric NOT NULL,
    "is_rebound" boolean DEFAULT false,
    "is_power_play" boolean DEFAULT false,
    "score_differential" integer,
    "has_pass_before_shot" boolean DEFAULT false,
    "pass_lateral_distance" numeric,
    "pass_to_net_distance" numeric,
    "pass_zone" character varying(50),
    "pass_immediacy_score" numeric,
    "goalie_movement_score" numeric,
    "pass_quality_score" numeric,
    "time_before_shot" numeric,
    "pass_angle" numeric,
    "normalized_lateral_distance" numeric,
    "zone_relative_distance" numeric,
    "xg_value" numeric NOT NULL,
    "xa_value" numeric,
    "shot_type_encoded" integer,
    "pass_zone_encoded" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "home_skaters_on_ice" integer,
    "away_skaters_on_ice" integer,
    "is_empty_net" boolean DEFAULT false,
    "penalty_length" integer,
    "penalty_time_left" integer,
    "last_event_category" character varying(50),
    "last_event_x" numeric,
    "last_event_y" numeric,
    "last_event_team" character varying(10),
    "distance_from_last_event" numeric,
    "time_since_last_event" numeric,
    "speed_from_last_event" numeric,
    "goalie_id" integer,
    "goalie_name" character varying(100),
    "period" integer,
    "time_in_period" character varying(10),
    "time_remaining_seconds" integer,
    "time_since_faceoff" numeric,
    "team_code" character varying(10),
    "is_home_team" boolean,
    "zone" character varying(20),
    "home_score" integer,
    "away_score" integer,
    "shot_was_on_goal" boolean DEFAULT false,
    "shot_goalie_froze" boolean DEFAULT false,
    "shot_generated_rebound" boolean DEFAULT false,
    "shot_play_stopped" boolean DEFAULT false,
    "shot_play_continued_in_zone" boolean DEFAULT false,
    "shot_play_continued_outside_zone" boolean DEFAULT false,
    "is_rush" boolean DEFAULT false,
    "event_id" integer,
    "sort_order" integer,
    "type_desc" character varying(100),
    "period_type" character varying(20),
    "time_remaining" character varying(10),
    "situation_code" character varying(20),
    "home_team_defending_side" character varying(10),
    "zone_code" character varying(10),
    "shooting_player_id" integer,
    "scoring_player_id" integer,
    "assist1_player_id" integer,
    "assist2_player_id" integer,
    "goalie_in_net_id" integer,
    "event_owner_team_id" integer,
    "home_team_id" integer,
    "away_team_id" integer,
    "home_team_abbrev" character varying(10),
    "away_team_abbrev" character varying(10),
    "away_sog" integer,
    "home_sog" integer,
    "shot_type_raw" character varying(50),
    "miss_reason" character varying(100),
    "arena_adjusted_x" numeric,
    "arena_adjusted_y" numeric,
    "arena_adjusted_x_abs" numeric,
    "arena_adjusted_y_abs" numeric,
    "arena_adjusted_shot_distance" numeric,
    "shot_angle_plus_rebound" numeric,
    "shot_angle_plus_rebound_speed" numeric,
    "last_event_shot_angle" numeric,
    "last_event_shot_distance" numeric,
    "player_num_that_did_last_event" integer,
    "shot_angle_adjusted" numeric,
    "home_empty_net" boolean DEFAULT false,
    "away_empty_net" boolean DEFAULT false,
    "shooting_team_code" character varying(10),
    "defending_team_code" character varying(10),
    "defending_team_skaters_on_ice" integer,
    "east_west_location_of_last_event" numeric,
    "east_west_location_of_shot" numeric,
    "north_south_location_of_shot" numeric,
    "time_since_powerplay_started" numeric,
    "flurry_adjusted_xg" numeric,
    "shooter_time_on_ice" numeric,
    "shooter_time_on_ice_since_faceoff" numeric,
    "shooting_team_average_time_on_ice" numeric,
    "shooting_team_max_time_on_ice" numeric,
    "shooting_team_min_time_on_ice" numeric,
    "shooting_team_average_time_on_ice_of_forwards" numeric,
    "shooting_team_max_time_on_ice_of_forwards" numeric,
    "shooting_team_min_time_on_ice_of_forwards" numeric,
    "shooting_team_average_time_on_ice_of_defencemen" numeric,
    "shooting_team_max_time_on_ice_of_defencemen" numeric,
    "shooting_team_min_time_on_ice_of_defencemen" numeric,
    "shooting_team_average_time_on_ice_since_faceoff" numeric,
    "shooting_team_max_time_on_ice_since_faceoff" numeric,
    "shooting_team_min_time_on_ice_since_faceoff" numeric,
    "shooting_team_average_time_on_ice_of_forwards_since_faceoff" numeric,
    "shooting_team_max_time_on_ice_of_forwards_since_faceoff" numeric,
    "shooting_team_min_time_on_ice_of_forwards_since_faceoff" numeric,
    "shooting_team_average_time_on_ice_of_defencemen_since_faceoff" numeric,
    "shooting_team_max_time_on_ice_of_defencemen_since_faceoff" numeric,
    "shooting_team_min_time_on_ice_of_defencemen_since_faceoff" numeric,
    "defending_team_average_time_on_ice" numeric,
    "defending_team_max_time_on_ice" numeric,
    "defending_team_min_time_on_ice" numeric,
    "defending_team_average_time_on_ice_of_forwards" numeric,
    "defending_team_max_time_on_ice_of_forwards" numeric,
    "defending_team_min_time_on_ice_of_forwards" numeric,
    "defending_team_average_time_on_ice_of_defencemen" numeric,
    "defending_team_max_time_on_ice_of_defencemen" numeric,
    "defending_team_min_time_on_ice_of_defencemen" numeric,
    "defending_team_average_time_on_ice_since_faceoff" numeric,
    "defending_team_max_time_on_ice_since_faceoff" numeric,
    "defending_team_min_time_on_ice_since_faceoff" numeric,
    "defending_team_average_time_on_ice_of_forwards_since_faceoff" numeric,
    "defending_team_max_time_on_ice_of_forwards_since_faceoff" numeric,
    "defending_team_min_time_on_ice_of_forwards_since_faceoff" numeric,
    "defending_team_average_time_on_ice_of_defencemen_since_faceoff" numeric,
    "defending_team_max_time_on_ice_of_defencemen_since_faceoff" numeric,
    "defending_team_min_time_on_ice_of_defencemen_since_faceoff" numeric,
    "time_difference_since_change" numeric,
    "average_rest_difference" numeric,
    "shooting_team_forwards_on_ice" integer,
    "shooting_team_defencemen_on_ice" integer,
    "defending_team_forwards_on_ice" integer,
    "defending_team_defencemen_on_ice" integer,
    "angle_change_from_last_event" numeric,
    "angle_change_squared" numeric,
    "distance_change_from_last_event" numeric,
    "shot_angle_rebound_royal_road" integer DEFAULT 0,
    "player_position" character varying(1),
    "expected_rebound_probability" numeric DEFAULT 0.0,
    "expected_goals_of_expected_rebounds" numeric DEFAULT 0.0,
    "shooting_talent_adjusted_xg" numeric,
    "shooting_talent_multiplier" numeric DEFAULT 1.0,
    "created_expected_goals" numeric DEFAULT 0.0,
    "season" integer,
    "distance_to_nearest_defender" numeric,
    "nearest_defender_to_net_distance" numeric,
    "skaters_in_screening_box" integer,
    "xg_value_recomputed" numeric,
    "source" "text" DEFAULT 'citrus_pbp_extract'::"text" NOT NULL
);


ALTER TABLE "public"."raw_shots_rebuild" OWNER TO "postgres";


COMMENT ON COLUMN "public"."raw_shots_rebuild"."passer_id" IS 'Phase 0c. NHL player id of the passer on the reconstructed pre-shot pass.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shot_x" IS 'X coordinate of shot location (NHL coordinates, net at x=89)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shot_y" IS 'Y coordinate of shot location (NHL coordinates, net at y=0)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_x" IS 'Phase 0c. Pass origin x in NHL RAW rink coordinates. NOT arena-adjusted — matching against MoneyPuck adjusted coordinates was the cause of the arena-adjust ambiguity storm and is fixed at commit 7c4b7026.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_y" IS 'Phase 0c. Pass origin y in NHL RAW rink coordinates. See pass_x on the raw-vs-adjusted distinction.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."has_pass_before_shot" IS 'Phase 0c moat feature. TRUE when a pass was reconstructed immediately before this shot from the NHL play-by-play event stream. NULL means genuinely unknown, not false — bounded honest-NULL is intended.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_lateral_distance" IS 'Phase 0c. Lateral (cross-ice) distance covered by the pass — the raw driver of goalie displacement.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_to_net_distance" IS 'Phase 0c. Distance from pass origin to the net.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_zone" IS 'Phase 0c. Textual zone the pass originated from; pass_zone_encoded is its numeric encoding for modelling.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_immediacy_score" IS 'Phase 0c moat feature. How immediately the shot followed the pass — lower elapsed time means less goalie reset opportunity.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."goalie_movement_score" IS 'Phase 0c moat feature. Estimated goalie lateral displacement forced by the pre-shot pass. The core of the pass-context moat.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_quality_score" IS 'Phase 0c moat feature. Composite quality of the pre-shot pass.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."time_before_shot" IS 'Phase 0c. Elapsed time from pass to shot. INTEGER SECONDS — not milliseconds, and not fractional.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_angle" IS 'Phase 0c. Angle of the pass relative to the attacking net.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."normalized_lateral_distance" IS 'Phase 0c. pass_lateral_distance normalised for rink geometry.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."zone_relative_distance" IS 'Phase 0c. Pass distance expressed relative to the originating zone.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."pass_zone_encoded" IS 'Phase 0c. Numeric encoding of pass_zone for model input.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."home_skaters_on_ice" IS 'Number of home team skaters on ice (typically 5, 6 for empty net)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."away_skaters_on_ice" IS 'Number of away team skaters on ice (typically 5, 6 for empty net)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."is_empty_net" IS 'True if goalie was pulled (empty net situation)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."last_event_category" IS 'Category of previous event (FAC, SHOT, GOAL, etc.)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."distance_from_last_event" IS 'Distance in feet from last event location to shot location';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."time_since_last_event" IS 'Seconds between last event and shot';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."speed_from_last_event" IS 'Speed in feet per second from last event to shot';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."goalie_id" IS 'NHL player ID of goalie in net for this shot';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."period" IS 'Period number (1, 2, 3, or 4+ for overtime)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."zone" IS 'Zone where shot occurred: HOMEZONE, AWAYZONE, or NEUTRALZONE';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shot_goalie_froze" IS 'True if goalie froze the puck after this shot';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shot_generated_rebound" IS 'True if this shot created a rebound opportunity';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."is_rush" IS 'True if shot came from a rush (fast break from neutral/defensive zone)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."event_id" IS 'Phase 0c companion. NHL play-by-play event id this shot was matched to. Valid only within its own provenance lineage — do not join across providers.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."sort_order" IS 'Phase 0c companion. NHL play-by-play sort order, used to sequence events within a game when game-seconds tie.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shot_angle_adjusted" IS 'Absolute value of shot angle (MoneyPuck feature: shotAngleAdjusted, 8.9% importance)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."home_empty_net" IS 'True if home team has empty net (goalie pulled)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."away_empty_net" IS 'True if away team has empty net (goalie pulled)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_team_code" IS 'Team code of shooting team (MoneyPuck feature: shootingTeamCode)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."defending_team_code" IS 'Team code of defending team (MoneyPuck feature: defendingTeamCode)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."defending_team_skaters_on_ice" IS 'Number of skaters on ice for defending team (MoneyPuck Variable 9: Other team''s # of skaters)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."east_west_location_of_last_event" IS 'East-West (Y) coordinate of last event before shot (MoneyPuck Variable 6)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."east_west_location_of_shot" IS 'East-West (Y) coordinate of shot location (MoneyPuck Variable 10)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."north_south_location_of_shot" IS 'North-South (X) coordinate of shot location (MoneyPuck Variable 14)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."time_since_powerplay_started" IS 'Time in seconds since current powerplay started (MoneyPuck Variable 12)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."flurry_adjusted_xg" IS 'Flurry adjusted expected goals (post-processing adjustment for shot sequences)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooter_time_on_ice" IS 'Time on ice in seconds for shooter since shift start (MoneyPuck: shooterTimeOnIce)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooter_time_on_ice_since_faceoff" IS 'Time on ice since last faceoff for shooter (MoneyPuck: shooterTimeOnIceSinceFaceoff)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_team_average_time_on_ice" IS 'Average TOI for all shooting team skaters (MoneyPuck: shootingTeamAverageTimeOnIce)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_team_max_time_on_ice" IS 'Maximum TOI for shooting team (0 if missing, MoneyPuck standard)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_team_min_time_on_ice" IS 'Minimum TOI for shooting team (999 if missing, MoneyPuck standard)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."time_difference_since_change" IS 'Shooting team min TOI - defending team min TOI (MoneyPuck: timeDifferenceSinceChange)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."average_rest_difference" IS 'Shooting team avg TOI since faceoff - defending team avg TOI since faceoff (MoneyPuck: averageRestDifference)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_team_forwards_on_ice" IS 'Number of forwards on ice for shooting team (MoneyPuck: shootingTeamForwardsOnIce)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_team_defencemen_on_ice" IS 'Number of defencemen on ice for shooting team (MoneyPuck: shootingTeamDefencemenOnIce)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."angle_change_from_last_event" IS 'Change in shot angle from last event (degrees)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shot_angle_rebound_royal_road" IS '1 if rebound and puck crossed middle (y changed sign), else 0 (MoneyPuck: shotAngleReboundRoyalRoad)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."player_position" IS 'Player position: L=Left Wing, R=Right Wing, D=Defenceman, C=Centre (MoneyPuck: playerPositionThatDidEvent)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."expected_rebound_probability" IS 'Probability (0-1) that this shot will generate a rebound, predicted by rebound model';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."expected_goals_of_expected_rebounds" IS 'Expected goals value of potential rebound shot = rebound_probability × estimated_rebound_shot_xG';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_talent_adjusted_xg" IS 'xG value adjusted for player shooting talent (Bayesian estimation)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."shooting_talent_multiplier" IS 'Multiplier applied to base xG based on player historical shooting performance (1.0 = average, >1.0 = above average, <1.0 = below average)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."created_expected_goals" IS 'Created Expected Goals = xG from non-rebound shots + xGoals of xRebounds (credits players for generating rebound opportunities)';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."season" IS 'NHL season year (e.g., 2024 for 2024-25 season). Derived from game_id or game_date.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."skaters_in_screening_box" IS 'Placeholder for future tracking-era screening feature. NULL in all rows as of Phase 0c; added for staging/prod schema parity.';



COMMENT ON COLUMN "public"."raw_shots_rebuild"."source" IS 'Ingestion provenance. bulk_import_20260730 = third-party shot dataset loaded 2026-07-30 covering seasons 2017-2024; column vocabulary and several model outputs (expected_rebound_probability, shot_angle_plus_rebound, the 24-column TOI block) originate there and are NOT reproducible by our extractor. citrus_pbp_extract = our own extraction from raw_nhl_data, season 2025+. The two are NOT distributionally comparable: score_differential, time_remaining_seconds, situation_code, shot_type_encoded and defending_team_skaters_on_ice are 100% NULL in the bulk import and 100% populated in ours; is_rush, time_difference_since_change, average_rest_difference and expected_rebound_probability are the reverse. Never pool the two in a training set without first passing an adversarial era-detection test (AUC <= 0.55) on the exact production feature vector.';



CREATE TABLE IF NOT EXISTS "public"."security_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "user_id" "uuid",
    "league_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "severity" "text" DEFAULT 'INFO'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "security_audit_log_event_type_check" CHECK (("event_type" = ANY (ARRAY['AUTH_LOGIN'::"text", 'AUTH_LOGOUT'::"text", 'AUTH_FAILED'::"text", 'LEAGUE_CREATE'::"text", 'LEAGUE_DELETE'::"text", 'LEAGUE_JOIN'::"text", 'LEAGUE_LEAVE'::"text", 'DRAFT_START'::"text", 'DRAFT_COMPLETE'::"text", 'DRAFT_RESET'::"text", 'ROSTER_MOVE'::"text", 'ROSTER_MOVE_FAILED'::"text", 'TRADE_OFFER'::"text", 'TRADE_ACCEPT'::"text", 'TRADE_REJECT'::"text", 'WAIVER_CLAIM'::"text", 'WAIVER_PROCESS'::"text", 'ADMIN_ACTION'::"text", 'SECURITY_VIOLATION'::"text", 'RLS_BYPASS_ATTEMPT'::"text", 'DATA_EXPORT'::"text"]))),
    CONSTRAINT "security_audit_log_severity_check" CHECK (("severity" = ANY (ARRAY['INFO'::"text", 'WARN'::"text", 'ERROR'::"text", 'CRITICAL'::"text"])))
);


ALTER TABLE "public"."security_audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."security_audit_log" IS 'SOC 2 CC7.2: Centralized security audit log. Retention: 1 year minimum per SOC 2 requirements.';



CREATE TABLE IF NOT EXISTS "public"."stat_catalog" (
    "stat_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "applies_to" "text" NOT NULL,
    "default_multiplier" numeric DEFAULT 0 NOT NULL,
    "is_core" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    CONSTRAINT "stat_catalog_applies_to_check" CHECK (("applies_to" = ANY (ARRAY['skater'::"text", 'goalie'::"text"])))
);


ALTER TABLE "public"."stat_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."stat_catalog" IS 'Canonical vocabulary of scoreable stats. is_core marks the twelve categories the legacy plpgsql scorer supported; everything else was already in the data and unreachable.';



CREATE TABLE IF NOT EXISTS "public"."stormy_chat_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tokens_used" integer DEFAULT 0,
    "message_preview" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stormy_chat_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."stormy_chat_log" IS 'Usage log for the Stormy AI assistant: user, tokens_used, and a truncated message_preview. Written by the stormy-chat edge function.';



CREATE TABLE IF NOT EXISTS "public"."survivor_selections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_number" integer NOT NULL,
    "picked_team" "text" NOT NULL,
    "is_correct" boolean,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "eliminated_at" timestamp with time zone,
    CONSTRAINT "survivor_selections_week_number_check" CHECK (("week_number" > 0))
);


ALTER TABLE "public"."survivor_selections" OWNER TO "postgres";


COMMENT ON TABLE "public"."survivor_selections" IS 'Survivor/eliminator pool picks. eliminated_at stamps the week a player was knocked out.';



CREATE TABLE IF NOT EXISTS "public"."team_lineups" (
    "starters" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "bench" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ir" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "slot_assignments" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "team_id" "uuid" NOT NULL,
    "league_id" "uuid" NOT NULL
);


ALTER TABLE "public"."team_lineups" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_lineups" IS 'Source of truth for team rosters. Uses JSONB arrays for starters/bench/ir.
NEVER use DELETE to remove players - use JSONB array manipulation:
  UPDATE team_lineups SET
    starters = starters - player_id_string,
    bench = bench - player_id_string,
    ir = ir - player_id_string
  WHERE team_id = ... AND league_id = ...
This ensures players are removed from arrays without deleting the team_lineups row.';



CREATE TABLE IF NOT EXISTS "public"."team_lineups_backup_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "backup_name" "text" NOT NULL,
    "backup_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "text",
    "team_count" integer,
    "player_count" integer,
    "notes" "text"
);


ALTER TABLE "public"."team_lineups_backup_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_lineups_backup_log" IS 'Stores backup snapshots of team_lineups table. Used for disaster recovery and rollback.';



CREATE TABLE IF NOT EXISTS "public"."team_mapping_config" (
    "mapping_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "canonical_team_code" "text" NOT NULL,
    "aliased_team_codes" "text"[] NOT NULL,
    "effective_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "canonical_in_aliases" CHECK (("canonical_team_code" = ANY ("aliased_team_codes")))
);


ALTER TABLE "public"."team_mapping_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_mapping_config" IS 'Maps relocated franchise team codes to canonical codes. Used by Hybrid Cache to ensure continuous rolling windows for team statistics.';



COMMENT ON COLUMN "public"."team_mapping_config"."canonical_team_code" IS 'The canonical team code (e.g., "ARI") used for cache lookups';



COMMENT ON COLUMN "public"."team_mapping_config"."aliased_team_codes" IS 'Array of all team codes that map to the canonical code (e.g., ["ARI", "UTA"])';



CREATE TABLE IF NOT EXISTS "public"."team_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_abbrev" "text" NOT NULL,
    "season" integer NOT NULL,
    "games_played" integer DEFAULT 0,
    "goals_against_avg" numeric(4,2) DEFAULT 3.0,
    "shots_against_avg" numeric(5,2) DEFAULT 30.0,
    "save_pct" numeric(4,3) DEFAULT 0.900,
    "goals_for_avg" numeric(4,2) DEFAULT 3.0,
    "shots_for_avg" numeric(5,2) DEFAULT 30.0,
    "goal_diff" numeric(4,2) DEFAULT 0.0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."team_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_stats" IS 'Team-level rate stats per season (goals against average, save percentage, shots for/against). Written by data-pipeline/acquisition/populate_team_stats.py and read by nightly_projection_batch.py, both as service_role.';



CREATE TABLE IF NOT EXISTS "public"."team_xg_season" (
    "season" integer NOT NULL,
    "game_type" "text" NOT NULL,
    "team_id" integer NOT NULL,
    "shots_for" integer NOT NULL,
    "goals_for" integer NOT NULL,
    "xg_for" double precision NOT NULL,
    "shots_against" integer NOT NULL,
    "goals_against" integer NOT NULL,
    "xg_against" double precision NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."team_xg_season" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "trade_offer_id" "uuid" NOT NULL,
    "team1_id" "uuid" NOT NULL,
    "team2_id" "uuid" NOT NULL,
    "team1_players" integer[] NOT NULL,
    "team2_players" integer[] NOT NULL,
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."trade_history" IS 'Executed trades, retained after the originating trade_offer is resolved.';



CREATE TABLE IF NOT EXISTS "public"."trade_offers" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "from_team_id" "uuid" NOT NULL,
    "to_team_id" "uuid" NOT NULL,
    "offered_player_ids" integer[] NOT NULL,
    "requested_player_ids" integer[] NOT NULL,
    "status" "text" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "counter_offer_id" "uuid",
    "review_started_at" timestamp with time zone,
    "review_ends_at" timestamp with time zone,
    "vetoed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "different_teams" CHECK (("from_team_id" <> "to_team_id")),
    CONSTRAINT "has_players" CHECK ((("array_length"("offered_player_ids", 1) > 0) AND ("array_length"("requested_player_ids", 1) > 0))),
    CONSTRAINT "trade_offers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'countered'::"text", 'cancelled'::"text", 'expired'::"text", 'under_review'::"text", 'vetoed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."trade_offers" OWNER TO "postgres";


COMMENT ON TABLE "public"."trade_offers" IS 'Proposed trades between two teams. offered_player_ids / requested_player_ids are id arrays, not join tables.';



CREATE TABLE IF NOT EXISTS "public"."trade_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trade_offer_id" "uuid" NOT NULL,
    "league_id" "uuid" NOT NULL,
    "voter_team_id" "uuid" NOT NULL,
    "vote" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_votes_vote_check" CHECK (("vote" = ANY (ARRAY['approve'::"text", 'veto'::"text"])))
);


ALTER TABLE "public"."trade_votes" OWNER TO "postgres";


COMMENT ON TABLE "public"."trade_votes" IS 'League-vote trade review ballots. Expired reviews are resolved by pg_cron job "process-trade-reviews" (*/15 * * * *).';



CREATE TABLE IF NOT EXISTS "public"."transaction_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "team_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "player_id" "text" NOT NULL,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transaction_ledger_type_check" CHECK (("type" = ANY (ARRAY['ADD'::"text", 'DROP'::"text", 'TRADE'::"text", 'DRAFT'::"text"])))
);


ALTER TABLE "public"."transaction_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."transaction_ledger" IS 'Append-only record of roster adds and drops. source distinguishes origin ("Roster Tab", "Waiver Processing", …). Written by process_roster_move().';



CREATE TABLE IF NOT EXISTS "public"."user_privacy_consent" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "policy_type" "text" NOT NULL,
    "version" "text" NOT NULL,
    "granted" boolean DEFAULT true NOT NULL,
    "consented_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "withdrawn_at" timestamp with time zone,
    "source" "text" DEFAULT 'app'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_privacy_consent_policy_type_check" CHECK (("policy_type" = ANY (ARRAY['terms_of_service'::"text", 'privacy_policy'::"text", 'cookie_policy'::"text", 'marketing_email'::"text", 'data_processing'::"text", 'age_confirmation'::"text"]))),
    CONSTRAINT "user_privacy_consent_source_check" CHECK (("source" = ANY (ARRAY['app'::"text", 'api'::"text", 'import'::"text", 'admin'::"text"]))),
    CONSTRAINT "user_privacy_consent_version_check" CHECK (("length"("btrim"("version")) > 0)),
    CONSTRAINT "user_privacy_consent_withdrawal_coherent" CHECK ((("granted" AND ("withdrawn_at" IS NULL)) OR ((NOT "granted") AND ("withdrawn_at" IS NOT NULL))))
);


ALTER TABLE "public"."user_privacy_consent" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_privacy_consent" IS 'GDPR Art. 7 consent ledger. A grant is a row; withdrawing sets granted=false and stamps withdrawn_at on that row, so both the grant date and the withdrawal date survive (the withdrawal_coherent CHECK enforces it). Rows are never deleted except by delete_user_account. Written exclusively through record_user_consent() / withdraw_user_consent() so consent cannot be forged or backdated by a client.';



CREATE OR REPLACE VIEW "public"."v_player_game_stat_long" WITH ("security_invoker"='true') AS
 SELECT "pgs"."game_id",
    "pgs"."player_id",
    "pgs"."game_date",
    "pgs"."is_goalie",
    "v"."stat_key",
    "v"."value"
   FROM ("public"."player_game_stats" "pgs"
     CROSS JOIN LATERAL ( VALUES ('goals'::"text",'skater'::"text",(COALESCE("pgs"."nhl_goals", 0))::numeric), ('assists'::"text",'skater'::"text",(COALESCE("pgs"."nhl_assists", 0))::numeric), ('power_play_points'::"text",'skater'::"text",(COALESCE("pgs"."nhl_ppp", 0))::numeric), ('short_handed_points'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shp", 0))::numeric), ('shots_on_goal'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shots_on_goal", 0))::numeric), ('blocks'::"text",'skater'::"text",(COALESCE("pgs"."nhl_blocks", 0))::numeric), ('hits'::"text",'skater'::"text",(COALESCE("pgs"."nhl_hits", 0))::numeric), ('penalty_minutes'::"text",'skater'::"text",(COALESCE("pgs"."nhl_pim", 0))::numeric), ('plus_minus'::"text",'skater'::"text",(COALESCE("pgs"."nhl_plus_minus", 0))::numeric), ('power_play_goals'::"text",'skater'::"text",(COALESCE("pgs"."nhl_ppg", 0))::numeric), ('power_play_assists'::"text",'skater'::"text",(COALESCE("pgs"."nhl_ppa", 0))::numeric), ('short_handed_goals'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shg", 0))::numeric), ('short_handed_assists'::"text",'skater'::"text",(COALESCE("pgs"."nhl_sha", 0))::numeric), ('game_winning_goals'::"text",'skater'::"text",(COALESCE("pgs"."nhl_gwg", 0))::numeric), ('overtime_goals'::"text",'skater'::"text",(COALESCE("pgs"."nhl_otg", 0))::numeric), ('faceoff_wins'::"text",'skater'::"text",(COALESCE("pgs"."nhl_faceoff_wins", 0))::numeric), ('faceoff_losses'::"text",'skater'::"text",(COALESCE("pgs"."nhl_faceoff_losses", 0))::numeric), ('takeaways'::"text",'skater'::"text",(COALESCE("pgs"."nhl_takeaways", 0))::numeric), ('giveaways'::"text",'skater'::"text",(COALESCE("pgs"."nhl_giveaways", 0))::numeric), ('shot_attempts'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shot_attempts", 0))::numeric), ('shots_missed'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shots_missed", 0))::numeric), ('shots_blocked_by_opp'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shots_blocked", 0))::numeric), ('shifts'::"text",'skater'::"text",(COALESCE("pgs"."nhl_shifts", 0))::numeric), ('toi_minutes'::"text",'skater'::"text","round"(((COALESCE("pgs"."nhl_toi_seconds", 0))::numeric / 60.0), 4)), ('wins'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_wins", 0))::numeric), ('saves'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_saves", 0))::numeric), ('shutouts'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_shutouts", 0))::numeric), ('goals_against'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_goals_against", 0))::numeric), ('losses'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_losses", 0))::numeric), ('ot_losses'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_ot_losses", 0))::numeric), ('shots_faced'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_shots_faced", 0))::numeric), ('even_saves'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_even_saves", 0))::numeric), ('pp_saves'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_pp_saves", 0))::numeric), ('sh_saves'::"text",'goalie'::"text",(COALESCE("pgs"."nhl_sh_saves", 0))::numeric), ('goalie_toi_minutes'::"text",'goalie'::"text","round"(((COALESCE("pgs"."nhl_toi_seconds", 0))::numeric / 60.0), 4))) "v"("stat_key", "applies_to", "value"))
  WHERE (("v"."applies_to" = 'goalie'::"text") = COALESCE("pgs"."is_goalie", false));


ALTER VIEW "public"."v_player_game_stat_long" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_player_game_stat_long" IS 'Long-form per-player-per-game stat lines in the same vocabulary as stat_catalog. Scoring is a join against league_scoring_rules, not a CASE statement.';



CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text",
    "user_agent" "text",
    "ip_address" "text"
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


COMMENT ON TABLE "public"."waitlist" IS 'Public pre-launch email signups. Deliberately accepts anonymous INSERT — this is the one table anon can write to, and it is unbounded, so rate limiting belongs at the application edge.';



CREATE TABLE IF NOT EXISTS "public"."waiver_claims" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "player_id" integer NOT NULL,
    "drop_player_id" integer,
    "priority" integer,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "failure_reason" "text",
    "bid_amount" numeric(10,2),
    "is_conditional_drop" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_priority" CHECK (("priority" >= 0)),
    CONSTRAINT "waiver_claims_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'successful'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."waiver_claims" OWNER TO "postgres";


COMMENT ON TABLE "public"."waiver_claims" IS 'Pending and resolved waiver claims. Processed nightly by pg_cron job "process-pending-waivers" (0 3 * * *) via process_all_pending_waivers(); status moves pending -> successful/failed with failure_reason.';



CREATE TABLE IF NOT EXISTS "public"."waiver_priority" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "league_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "priority" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."waiver_priority" OWNER TO "postgres";


COMMENT ON TABLE "public"."waiver_priority" IS 'Rolling waiver priority order per team. Rotated after a successful claim in rolling leagues.';



CREATE TABLE IF NOT EXISTS "public"."xg_rebuild_audit" (
    "id" bigint NOT NULL,
    "season" integer NOT NULL,
    "layer" "text" NOT NULL,
    "expected" bigint,
    "actual" bigint,
    "status" "text" NOT NULL,
    "detail" "text",
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "xg_rebuild_audit_status_check" CHECK (("status" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."xg_rebuild_audit" OWNER TO "postgres";


ALTER TABLE "public"."xg_rebuild_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."xg_rebuild_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."xg_retrain_log" (
    "id" bigint NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phase" "text" NOT NULL,
    "season" integer,
    "shots" bigint,
    "goals" bigint,
    "auc" numeric,
    "calibration" numeric,
    "note" "text"
);


ALTER TABLE "public"."xg_retrain_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."xg_retrain_log" IS 'Before/after scorecards for every xG model retrain. A retrain that cannot show its numbers did not happen.';



ALTER TABLE "public"."xg_retrain_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."xg_retrain_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."league_scoring_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."league_scoring_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."player_shifts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."player_shifts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."player_toi_by_situation" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."player_toi_by_situation_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."player_weekly_stats" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."player_weekly_stats_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."raw_nhl_data" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."raw_nhl_data_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."raw_shots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."raw_shots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auction_budgets"
    ADD CONSTRAINT "auction_budgets_league_id_team_id_key" UNIQUE ("league_id", "team_id");



ALTER TABLE ONLY "public"."auction_budgets"
    ADD CONSTRAINT "auction_budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auction_nominations"
    ADD CONSTRAINT "auction_nominations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auto_recovery_log"
    ADD CONSTRAINT "auto_recovery_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."confidence_picks"
    ADD CONSTRAINT "confidence_picks_league_id_user_id_week_number_game_id_key" UNIQUE ("league_id", "user_id", "week_number", "game_id");



ALTER TABLE ONLY "public"."confidence_picks"
    ADD CONSTRAINT "confidence_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."confidence_picks"
    ADD CONSTRAINT "confidence_points_unique_per_user_week" UNIQUE ("league_id", "user_id", "week_number", "confidence_points");



ALTER TABLE ONLY "public"."cron_job_registry"
    ADD CONSTRAINT "cron_job_registry_pkey" PRIMARY KEY ("jobid");



ALTER TABLE ONLY "public"."draft_order"
    ADD CONSTRAINT "draft_order_league_id_round_number_key" UNIQUE ("league_id", "round_number");



ALTER TABLE ONLY "public"."draft_order"
    ADD CONSTRAINT "draft_order_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faab_budgets"
    ADD CONSTRAINT "faab_budgets_league_id_team_id_key" UNIQUE ("league_id", "team_id");



ALTER TABLE ONLY "public"."faab_budgets"
    ADD CONSTRAINT "faab_budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."failed_transactions"
    ADD CONSTRAINT "failed_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fantasy_daily_rosters"
    ADD CONSTRAINT "fantasy_daily_rosters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fantasy_daily_rosters"
    ADD CONSTRAINT "fantasy_daily_rosters_team_id_matchup_id_player_id_roster_d_key" UNIQUE ("team_id", "matchup_id", "player_id", "roster_date");



ALTER TABLE ONLY "public"."fantasy_matchup_lines"
    ADD CONSTRAINT "fantasy_matchup_lines_matchup_id_player_id_key" UNIQUE ("matchup_id", "player_id");



ALTER TABLE ONLY "public"."fantasy_matchup_lines"
    ADD CONSTRAINT "fantasy_matchup_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."function_error_log"
    ADD CONSTRAINT "function_error_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goalie_gar"
    ADD CONSTRAINT "goalie_gar_pkey" PRIMARY KEY ("goalie_id");



ALTER TABLE ONLY "public"."goalie_gsax"
    ADD CONSTRAINT "goalie_gsax_pkey" PRIMARY KEY ("goalie_id", "season");



ALTER TABLE ONLY "public"."goalie_gsax_primary"
    ADD CONSTRAINT "goalie_gsax_primary_pkey" PRIMARY KEY ("goalie_id");



ALTER TABLE ONLY "public"."goalie_rebound_control"
    ADD CONSTRAINT "goalie_rebound_control_pkey" PRIMARY KEY ("goalie_id");



ALTER TABLE ONLY "public"."goalie_xg_season"
    ADD CONSTRAINT "goalie_xg_season_pkey" PRIMARY KEY ("season", "game_type", "goalie_id", "team_id");



ALTER TABLE ONLY "public"."integrity_check_results"
    ADD CONSTRAINT "integrity_check_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."join_code_attempts"
    ADD CONSTRAINT "join_code_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."keeper_designations"
    ADD CONSTRAINT "keeper_designations_league_id_player_id_season_year_key" UNIQUE ("league_id", "player_id", "season_year");



ALTER TABLE ONLY "public"."keeper_designations"
    ADD CONSTRAINT "keeper_designations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."keeper_designations"
    ADD CONSTRAINT "keeper_team_season" UNIQUE ("league_id", "team_id", "player_id", "season_year");



ALTER TABLE ONLY "public"."league_averages"
    ADD CONSTRAINT "league_averages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."league_averages"
    ADD CONSTRAINT "league_averages_position_season_key" UNIQUE ("position", "season");



ALTER TABLE ONLY "public"."league_scoring_audit"
    ADD CONSTRAINT "league_scoring_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."league_scoring_rules"
    ADD CONSTRAINT "league_scoring_rules_pkey" PRIMARY KEY ("league_id", "stat_key");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_join_code_key" UNIQUE ("join_code");



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matchup_scoring_snapshots"
    ADD CONSTRAINT "matchup_scoring_snapshots_pkey" PRIMARY KEY ("matchup_id");



ALTER TABLE ONLY "public"."matchups"
    ADD CONSTRAINT "matchups_league_id_week_number_team1_id_key" UNIQUE ("league_id", "week_number", "team1_id");



ALTER TABLE ONLY "public"."matchups"
    ADD CONSTRAINT "matchups_league_id_week_number_team2_id_key" UNIQUE ("league_id", "week_number", "team2_id");



ALTER TABLE ONLY "public"."matchups"
    ADD CONSTRAINT "matchups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nhl_game_arena"
    ADD CONSTRAINT "nhl_game_arena_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."nhl_games"
    ADD CONSTRAINT "nhl_games_game_id_key" UNIQUE ("game_id");



ALTER TABLE ONLY "public"."nhl_games"
    ADD CONSTRAINT "nhl_games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nhl_games_retired_phantoms"
    ADD CONSTRAINT "nhl_games_retired_phantoms_game_id_key" UNIQUE ("game_id");



ALTER TABLE ONLY "public"."nhl_games_retired_phantoms"
    ADD CONSTRAINT "nhl_games_retired_phantoms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nhl_pipeline_meta"
    ADD CONSTRAINT "nhl_pipeline_meta_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."nhl_player_identity"
    ADD CONSTRAINT "nhl_player_identity_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."nhl_player_names"
    ADD CONSTRAINT "nhl_player_names_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."nhl_playoff_seeds"
    ADD CONSTRAINT "nhl_playoff_seeds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nhl_playoff_seeds"
    ADD CONSTRAINT "nhl_playoff_seeds_season_conference_seed_key" UNIQUE ("season", "conference", "seed");



ALTER TABLE ONLY "public"."nhl_playoff_series"
    ADD CONSTRAINT "nhl_playoff_series_pkey" PRIMARY KEY ("series_id");



ALTER TABLE ONLY "public"."nhl_playoff_series"
    ADD CONSTRAINT "nhl_playoff_series_season_round_bracket_slot_key" UNIQUE ("season", "round", "bracket_slot");



ALTER TABLE ONLY "public"."nhl_rink_cdf"
    ADD CONSTRAINT "nhl_rink_cdf_pkey" PRIMARY KEY ("coord", "home_team", "season", "v");



ALTER TABLE ONLY "public"."nhl_rink_ref_knots"
    ADD CONSTRAINT "nhl_rink_ref_knots_pkey" PRIMARY KEY ("coord", "k");



ALTER TABLE ONLY "public"."nhl_shots"
    ADD CONSTRAINT "nhl_shots_pkey" PRIMARY KEY ("game_id", "event_id");



ALTER TABLE ONLY "public"."nhl_teams"
    ADD CONSTRAINT "nhl_teams_abbreviation_key" UNIQUE ("abbreviation");



ALTER TABLE ONLY "public"."nhl_teams"
    ADD CONSTRAINT "nhl_teams_pkey" PRIMARY KEY ("team_id");



ALTER TABLE ONLY "public"."nhl_xg_sql_cells"
    ADD CONSTRAINT "nhl_xg_sql_cells_pkey" PRIMARY KEY ("fold", "lvl", "ckey");



ALTER TABLE ONLY "public"."nightly_job_runs"
    ADD CONSTRAINT "nightly_job_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phase0c_progress"
    ADD CONSTRAINT "phase0c_progress_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."pipeline_runs"
    ADD CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_autopick_rankings"
    ADD CONSTRAINT "player_autopick_rankings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_directory"
    ADD CONSTRAINT "player_directory_pkey" PRIMARY KEY ("season", "player_id");



ALTER TABLE ONLY "public"."player_game_stats"
    ADD CONSTRAINT "player_game_stats_pkey" PRIMARY KEY ("season", "game_id", "player_id");



ALTER TABLE ONLY "public"."player_gar_components"
    ADD CONSTRAINT "player_gar_components_pkey" PRIMARY KEY ("player_id", "season");



ALTER TABLE ONLY "public"."player_identity_bridge"
    ADD CONSTRAINT "player_identity_bridge_pkey" PRIMARY KEY ("players_uuid");



ALTER TABLE ONLY "public"."player_playoff_stats"
    ADD CONSTRAINT "player_playoff_stats_pkey" PRIMARY KEY ("player_id", "season");



ALTER TABLE ONLY "public"."player_projected_stats"
    ADD CONSTRAINT "player_projected_stats_pkey" PRIMARY KEY ("projection_id");



ALTER TABLE ONLY "public"."player_projected_stats"
    ADD CONSTRAINT "player_projected_stats_player_id_game_id_projection_date_key" UNIQUE ("player_id", "game_id", "projection_date");



ALTER TABLE ONLY "public"."player_projected_stats_retired_phantoms"
    ADD CONSTRAINT "player_projected_stats_retire_player_id_game_id_projection__key" UNIQUE ("player_id", "game_id", "projection_date");



ALTER TABLE ONLY "public"."player_projected_stats_retired_phantoms"
    ADD CONSTRAINT "player_projected_stats_retired_phantoms_pkey" PRIMARY KEY ("projection_id");



ALTER TABLE ONLY "public"."player_projections"
    ADD CONSTRAINT "player_projections_pkey" PRIMARY KEY ("player_id", "game_id", "season");



ALTER TABLE ONLY "public"."player_ros_projections"
    ADD CONSTRAINT "player_ros_projections_pkey" PRIMARY KEY ("player_id");



ALTER TABLE ONLY "public"."player_season_stats"
    ADD CONSTRAINT "player_season_stats_pkey" PRIMARY KEY ("season", "player_id");



ALTER TABLE ONLY "public"."player_shifts_official"
    ADD CONSTRAINT "player_shifts_official_pkey" PRIMARY KEY ("shift_id");



ALTER TABLE ONLY "public"."player_shifts"
    ADD CONSTRAINT "player_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_talent_metrics"
    ADD CONSTRAINT "player_talent_metrics_pkey" PRIMARY KEY ("player_id", "season");



ALTER TABLE ONLY "public"."player_toi_by_situation"
    ADD CONSTRAINT "player_toi_by_situation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_toi_by_situation"
    ADD CONSTRAINT "player_toi_by_situation_player_id_game_id_situation_key" UNIQUE ("player_id", "game_id", "situation");



ALTER TABLE ONLY "public"."player_transactions"
    ADD CONSTRAINT "player_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_waiver_status"
    ADD CONSTRAINT "player_waiver_status_league_id_player_id_dropped_at_key" UNIQUE ("league_id", "player_id", "dropped_at");



ALTER TABLE ONLY "public"."player_waiver_status"
    ADD CONSTRAINT "player_waiver_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_weekly_stats"
    ADD CONSTRAINT "player_weekly_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_weekly_stats"
    ADD CONSTRAINT "player_weekly_stats_player_id_week_number_week_start_date_key" UNIQUE ("player_id", "week_number", "week_start_date");



ALTER TABLE ONLY "public"."player_xg_season"
    ADD CONSTRAINT "player_xg_season_pkey" PRIMARY KEY ("season", "game_type", "player_id", "team_id");



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playoff_bracket_picks"
    ADD CONSTRAINT "playoff_bracket_picks_league_id_user_id_series_slot_key" UNIQUE ("league_id", "user_id", "series_slot");



ALTER TABLE ONLY "public"."playoff_bracket_picks"
    ADD CONSTRAINT "playoff_bracket_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_league_id_season_key" UNIQUE ("league_id", "season");



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playoff_confidence_picks"
    ADD CONSTRAINT "playoff_confidence_picks_league_id_user_id_confidence_value_key" UNIQUE ("league_id", "user_id", "confidence_value");



ALTER TABLE ONLY "public"."playoff_confidence_picks"
    ADD CONSTRAINT "playoff_confidence_picks_league_id_user_id_series_slot_key" UNIQUE ("league_id", "user_id", "series_slot");



ALTER TABLE ONLY "public"."playoff_confidence_picks"
    ADD CONSTRAINT "playoff_confidence_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playoff_pool_standings"
    ADD CONSTRAINT "playoff_pool_standings_pkey" PRIMARY KEY ("league_id", "user_id");



ALTER TABLE ONLY "public"."playoff_roster_picks"
    ADD CONSTRAINT "playoff_roster_picks_league_id_user_id_player_id_key" UNIQUE ("league_id", "user_id", "player_id");



ALTER TABLE ONLY "public"."playoff_roster_picks"
    ADD CONSTRAINT "playoff_roster_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playoff_seeds"
    ADD CONSTRAINT "playoff_seeds_bracket_id_seed_number_key" UNIQUE ("bracket_id", "seed_number");



ALTER TABLE ONLY "public"."playoff_seeds"
    ADD CONSTRAINT "playoff_seeds_bracket_id_team_id_key" UNIQUE ("bracket_id", "team_id");



ALTER TABLE ONLY "public"."playoff_seeds"
    ADD CONSTRAINT "playoff_seeds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_bracket_id_round_number_match_number_bracket_key" UNIQUE ("bracket_id", "round_number", "match_number", "bracket_position");



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."policy_versions"
    ADD CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("policy_type");



ALTER TABLE ONLY "public"."pool_picks"
    ADD CONSTRAINT "pool_picks_league_id_user_id_week_number_game_id_key" UNIQUE ("league_id", "user_id", "week_number", "game_id");



ALTER TABLE ONLY "public"."pool_picks"
    ADD CONSTRAINT "pool_picks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."projection_cache"
    ADD CONSTRAINT "projection_cache_pkey" PRIMARY KEY ("cache_id");



ALTER TABLE ONLY "public"."projections"
    ADD CONSTRAINT "projections_game_id_player_id_key" UNIQUE ("game_id", "player_id");



ALTER TABLE ONLY "public"."projections"
    ADD CONSTRAINT "projections_pkey" PRIMARY KEY ("projection_id");



ALTER TABLE ONLY "public"."_deprecated_public.players"
    ADD CONSTRAINT "public.players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_nhl_data"
    ADD CONSTRAINT "raw_nhl_data_game_id_key" UNIQUE ("game_id");



ALTER TABLE ONLY "public"."raw_nhl_data"
    ADD CONSTRAINT "raw_nhl_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_player_stats"
    ADD CONSTRAINT "raw_player_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_player_stats"
    ADD CONSTRAINT "raw_player_stats_playerId_game_id_key" UNIQUE ("playerId", "game_id");



ALTER TABLE ONLY "public"."raw_shots"
    ADD CONSTRAINT "raw_shots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_shots_rebuild"
    ADD CONSTRAINT "raw_shots_rebuild_game_event_key" UNIQUE ("game_id", "event_id");



ALTER TABLE ONLY "public"."raw_shots_rebuild"
    ADD CONSTRAINT "raw_shots_rebuild_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_shots"
    ADD CONSTRAINT "raw_shots_unique_shot" UNIQUE ("game_id", "player_id", "shot_x", "shot_y", "shot_type_code");



COMMENT ON CONSTRAINT "raw_shots_unique_shot" ON "public"."raw_shots" IS 'Unique constraint to prevent duplicate shot records. Enables upsert operations for safe re-processing of games. A shot is uniquely identified by game_id, player_id, shot coordinates (x, y), and shot_type_code.';



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_audit_log"
    ADD CONSTRAINT "security_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stat_catalog"
    ADD CONSTRAINT "stat_catalog_pkey" PRIMARY KEY ("stat_key");



ALTER TABLE ONLY "public"."stormy_chat_log"
    ADD CONSTRAINT "stormy_chat_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survivor_selections"
    ADD CONSTRAINT "survivor_selections_league_id_user_id_picked_team_key" UNIQUE ("league_id", "user_id", "picked_team");



ALTER TABLE ONLY "public"."survivor_selections"
    ADD CONSTRAINT "survivor_selections_league_id_user_id_week_number_key" UNIQUE ("league_id", "user_id", "week_number");



ALTER TABLE ONLY "public"."survivor_selections"
    ADD CONSTRAINT "survivor_selections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_lineups_backup_log"
    ADD CONSTRAINT "team_lineups_backup_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_lineups"
    ADD CONSTRAINT "team_lineups_pkey" PRIMARY KEY ("league_id", "team_id");



ALTER TABLE ONLY "public"."team_mapping_config"
    ADD CONSTRAINT "team_mapping_config_pkey" PRIMARY KEY ("mapping_id");



ALTER TABLE ONLY "public"."team_stats"
    ADD CONSTRAINT "team_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_stats"
    ADD CONSTRAINT "team_stats_team_abbrev_season_key" UNIQUE ("team_abbrev", "season");



ALTER TABLE ONLY "public"."team_xg_season"
    ADD CONSTRAINT "team_xg_season_pkey" PRIMARY KEY ("season", "game_type", "team_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_league_id_owner_id_key" UNIQUE ("league_id", "owner_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_history"
    ADD CONSTRAINT "trade_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_offers"
    ADD CONSTRAINT "trade_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_votes"
    ADD CONSTRAINT "trade_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_votes"
    ADD CONSTRAINT "trade_votes_trade_offer_id_voter_team_id_key" UNIQUE ("trade_offer_id", "voter_team_id");



ALTER TABLE ONLY "public"."transaction_ledger"
    ADD CONSTRAINT "transaction_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nightly_job_runs"
    ADD CONSTRAINT "unique_job_per_date" UNIQUE ("job_name", "run_date");



ALTER TABLE ONLY "public"."projection_cache"
    ADD CONSTRAINT "unique_player_game_date" UNIQUE ("player_id", "game_id", "projection_date");



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "unique_player_per_league" UNIQUE ("league_id", "player_id");



COMMENT ON CONSTRAINT "unique_player_per_league" ON "public"."roster_assignments" IS 'THE GOALIE: Prevents a player from being on multiple teams in the same league. Hardware-enforced integrity.';



ALTER TABLE ONLY "public"."user_privacy_consent"
    ADD CONSTRAINT "user_privacy_consent_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_claims"
    ADD CONSTRAINT "waiver_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waiver_priority"
    ADD CONSTRAINT "waiver_priority_league_id_priority_key" UNIQUE ("league_id", "priority");



ALTER TABLE ONLY "public"."waiver_priority"
    ADD CONSTRAINT "waiver_priority_league_id_team_id_key" UNIQUE ("league_id", "team_id");



ALTER TABLE ONLY "public"."waiver_priority"
    ADD CONSTRAINT "waiver_priority_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xg_rebuild_audit"
    ADD CONSTRAINT "xg_rebuild_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xg_retrain_log"
    ADD CONSTRAINT "xg_retrain_log_pkey" PRIMARY KEY ("id");



CREATE INDEX "goalie_xg_season_goalie_id_season_idx" ON "public"."goalie_xg_season" USING "btree" ("goalie_id", "season");



CREATE INDEX "idx_auction_bids_league" ON "public"."auction_bids" USING "btree" ("league_id");



CREATE INDEX "idx_auction_bids_nomination" ON "public"."auction_bids" USING "btree" ("nomination_id");



CREATE INDEX "idx_auction_bids_team_id" ON "public"."auction_bids" USING "btree" ("team_id");



CREATE INDEX "idx_auction_budgets_league" ON "public"."auction_budgets" USING "btree" ("league_id");



CREATE INDEX "idx_auction_budgets_team_id" ON "public"."auction_budgets" USING "btree" ("team_id");



CREATE INDEX "idx_auction_nominations_current_high_bidder_team_id" ON "public"."auction_nominations" USING "btree" ("current_high_bidder_team_id");



CREATE INDEX "idx_auction_nominations_nominated_by_team_id" ON "public"."auction_nominations" USING "btree" ("nominated_by_team_id");



CREATE INDEX "idx_auction_noms_league_session" ON "public"."auction_nominations" USING "btree" ("league_id", "draft_session_id");



CREATE INDEX "idx_auction_noms_status" ON "public"."auction_nominations" USING "btree" ("league_id", "status");



CREATE INDEX "idx_autopick_rankings_global" ON "public"."player_autopick_rankings" USING "btree" ("rank_position") WHERE ("league_id" IS NULL);



CREATE INDEX "idx_autopick_rankings_league" ON "public"."player_autopick_rankings" USING "btree" ("league_id", "rank_position");



CREATE UNIQUE INDEX "idx_autopick_rankings_unique" ON "public"."player_autopick_rankings" USING "btree" (COALESCE("league_id", '00000000-0000-0000-0000-000000000000'::"uuid"), COALESCE("team_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "player_id");



CREATE INDEX "idx_backup_log_created_at" ON "public"."team_lineups_backup_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_confidence_league_week" ON "public"."confidence_picks" USING "btree" ("league_id", "week_number");



CREATE INDEX "idx_confidence_picks_user_id" ON "public"."confidence_picks" USING "btree" ("user_id");



CREATE INDEX "idx_confidence_user" ON "public"."confidence_picks" USING "btree" ("league_id", "user_id");



CREATE INDEX "idx_draft_order_league_round" ON "public"."draft_order" USING "btree" ("league_id", "round_number");



CREATE INDEX "idx_draft_order_session" ON "public"."draft_order" USING "btree" ("league_id", "draft_session_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_draft_picks_league_active" ON "public"."draft_picks" USING "btree" ("league_id", "picked_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_draft_picks_league_id" ON "public"."draft_picks" USING "btree" ("league_id");



CREATE INDEX "idx_draft_picks_league_session" ON "public"."draft_picks" USING "btree" ("league_id", "draft_session_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_draft_picks_player_league" ON "public"."draft_picks" USING "btree" ("player_id", "league_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_draft_picks_reservation" ON "public"."draft_picks" USING "btree" ("league_id", "reserved_by", "reservation_expires_at") WHERE ("reserved_by" IS NOT NULL);



CREATE INDEX "idx_draft_picks_reserved_by" ON "public"."draft_picks" USING "btree" ("reserved_by");



CREATE INDEX "idx_draft_picks_round_pick" ON "public"."draft_picks" USING "btree" ("league_id", "round_number", "pick_number");



CREATE INDEX "idx_draft_picks_team_id" ON "public"."draft_picks" USING "btree" ("team_id");



CREATE UNIQUE INDEX "idx_draft_picks_unique_pick_per_session" ON "public"."draft_picks" USING "btree" ("league_id", "draft_session_id", "round_number", "pick_number") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_draft_picks_unique_player_per_league" ON "public"."draft_picks" USING "btree" ("league_id", "player_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_faab_budgets_league" ON "public"."faab_budgets" USING "btree" ("league_id");



CREATE INDEX "idx_faab_budgets_team_id" ON "public"."faab_budgets" USING "btree" ("team_id");



CREATE INDEX "idx_failed_transactions_attempted_at" ON "public"."failed_transactions" USING "btree" ("attempted_at" DESC);



CREATE INDEX "idx_fantasy_daily_rosters_active" ON "public"."fantasy_daily_rosters" USING "btree" ("matchup_id", "roster_date", "slot_type") WHERE ("slot_type" = 'active'::"text");



CREATE INDEX "idx_fantasy_daily_rosters_league_team_date" ON "public"."fantasy_daily_rosters" USING "btree" ("league_id", "team_id", "roster_date");



COMMENT ON INDEX "public"."idx_fantasy_daily_rosters_league_team_date" IS 'Optimizes league-wide daily roster snapshot queries';



CREATE INDEX "idx_fantasy_daily_rosters_locked" ON "public"."fantasy_daily_rosters" USING "btree" ("is_locked", "roster_date");



CREATE INDEX "idx_fantasy_daily_rosters_matchup" ON "public"."fantasy_daily_rosters" USING "btree" ("matchup_id", "team_id", "roster_date");



CREATE INDEX "idx_fantasy_daily_rosters_matchup_date" ON "public"."fantasy_daily_rosters" USING "btree" ("matchup_id", "roster_date");



CREATE INDEX "idx_fantasy_daily_rosters_player_date" ON "public"."fantasy_daily_rosters" USING "btree" ("player_id", "roster_date");



CREATE INDEX "idx_fantasy_daily_rosters_team_date" ON "public"."fantasy_daily_rosters" USING "btree" ("team_id", "roster_date");



CREATE INDEX "idx_fantasy_daily_rosters_team_matchup_date" ON "public"."fantasy_daily_rosters" USING "btree" ("team_id", "matchup_id", "roster_date");



CREATE INDEX "idx_fantasy_matchup_lines_live" ON "public"."fantasy_matchup_lines" USING "btree" ("has_live_game", "live_game_locked");



CREATE INDEX "idx_fantasy_matchup_lines_matchup_id" ON "public"."fantasy_matchup_lines" USING "btree" ("matchup_id");



CREATE INDEX "idx_fantasy_matchup_lines_player_id" ON "public"."fantasy_matchup_lines" USING "btree" ("player_id");



CREATE INDEX "idx_fantasy_matchup_lines_team_id" ON "public"."fantasy_matchup_lines" USING "btree" ("team_id");



CREATE INDEX "idx_fantasy_matchup_lines_updated_at" ON "public"."fantasy_matchup_lines" USING "btree" ("updated_at");



CREATE INDEX "idx_function_error_log_fn" ON "public"."function_error_log" USING "btree" ("fn", "occurred_at" DESC);



CREATE INDEX "idx_function_error_log_time" ON "public"."function_error_log" USING "btree" ("occurred_at" DESC);



CREATE INDEX "idx_gar_evd" ON "public"."player_gar_components" USING "btree" ("evd_rate_regressed");



CREATE INDEX "idx_gar_evo" ON "public"."player_gar_components" USING "btree" ("evo_rate_regressed");



CREATE INDEX "idx_gar_player_season" ON "public"."player_gar_components" USING "btree" ("player_id", "season");



CREATE INDEX "idx_gar_ppd" ON "public"."player_gar_components" USING "btree" ("ppd_rate_regressed");



CREATE INDEX "idx_gar_ppo" ON "public"."player_gar_components" USING "btree" ("ppo_rate_regressed");



CREATE INDEX "idx_gar_total" ON "public"."player_gar_components" USING "btree" ("total_gar_per_60");



CREATE INDEX "idx_goalie_gar_calculated_at" ON "public"."goalie_gar" USING "btree" ("calculated_at");



CREATE INDEX "idx_goalie_gar_total_gar" ON "public"."goalie_gar" USING "btree" ("total_gar");



CREATE INDEX "idx_goalie_gsax_goalie_id" ON "public"."goalie_gsax" USING "btree" ("goalie_id");



CREATE INDEX "idx_goalie_gsax_primary_goalie_id" ON "public"."goalie_gsax_primary" USING "btree" ("goalie_id");



CREATE INDEX "idx_goalie_gsax_primary_regressed_gsax" ON "public"."goalie_gsax_primary" USING "btree" ("regressed_gsax");



CREATE INDEX "idx_goalie_gsax_regressed_gsax" ON "public"."goalie_gsax" USING "btree" ("regressed_gsax");



CREATE INDEX "idx_goalie_gsax_season" ON "public"."goalie_gsax" USING "btree" ("season");



CREATE INDEX "idx_goalie_rebound_control_adj_rebound_pct" ON "public"."goalie_rebound_control" USING "btree" ("adj_rebound_pct");



CREATE INDEX "idx_goalie_rebound_control_calculated_at" ON "public"."goalie_rebound_control" USING "btree" ("calculated_at");



CREATE INDEX "idx_integrity_check_status" ON "public"."integrity_check_results" USING "btree" ("status") WHERE ("status" = 'fail'::"text");



CREATE INDEX "idx_integrity_check_time" ON "public"."integrity_check_results" USING "btree" ("check_time" DESC);



CREATE INDEX "idx_join_code_attempts_cleanup" ON "public"."join_code_attempts" USING "btree" ("attempt_time");



CREATE INDEX "idx_join_code_attempts_user_time" ON "public"."join_code_attempts" USING "btree" ("user_id", "attempt_time" DESC);



CREATE INDEX "idx_keeper_designations_approved_by" ON "public"."keeper_designations" USING "btree" ("approved_by");



CREATE INDEX "idx_keeper_league_season" ON "public"."keeper_designations" USING "btree" ("league_id", "season_year");



CREATE INDEX "idx_keeper_team" ON "public"."keeper_designations" USING "btree" ("team_id", "season_year");



CREATE INDEX "idx_league_averages_position_season" ON "public"."league_averages" USING "btree" ("position", "season");



CREATE INDEX "idx_league_averages_season" ON "public"."league_averages" USING "btree" ("season");



CREATE INDEX "idx_league_scoring_audit_league" ON "public"."league_scoring_audit" USING "btree" ("league_id", "created_at" DESC);



CREATE INDEX "idx_league_scoring_rules_stat_key" ON "public"."league_scoring_rules" USING "btree" ("stat_key");



CREATE INDEX "idx_leagues_commissioner" ON "public"."leagues" USING "btree" ("commissioner_id");



CREATE INDEX "idx_leagues_commissioner_id_covering" ON "public"."leagues" USING "btree" ("commissioner_id", "id");



CREATE INDEX "idx_leagues_draft_status" ON "public"."leagues" USING "btree" ("draft_status") WHERE ("draft_status" = ANY (ARRAY['not_started'::"public"."draft_status", 'in_progress'::"public"."draft_status"]));



CREATE INDEX "idx_leagues_join_code" ON "public"."leagues" USING "btree" ("join_code");



CREATE INDEX "idx_leagues_league_size" ON "public"."leagues" USING "btree" ("league_size") WHERE ("league_size" IS NOT NULL);



CREATE INDEX "idx_leagues_pool_status" ON "public"."leagues" USING "btree" ("pool_status") WHERE ("pool_status" IS NOT NULL);



CREATE INDEX "idx_leagues_pool_winner_id" ON "public"."leagues" USING "btree" ("pool_winner_id");



CREATE INDEX "idx_leagues_scoring_settings" ON "public"."leagues" USING "gin" ("scoring_settings");



CREATE INDEX "idx_matchup_scoring_snapshots_league" ON "public"."matchup_scoring_snapshots" USING "btree" ("league_id");



CREATE INDEX "idx_matchups_league_id" ON "public"."matchups" USING "btree" ("league_id");



CREATE INDEX "idx_matchups_team1_id" ON "public"."matchups" USING "btree" ("team1_id");



CREATE INDEX "idx_matchups_team2_id" ON "public"."matchups" USING "btree" ("team2_id");



CREATE INDEX "idx_matchups_week_dates" ON "public"."matchups" USING "btree" ("week_start_date", "week_end_date");



CREATE INDEX "idx_matchups_week_number" ON "public"."matchups" USING "btree" ("league_id", "week_number");



CREATE INDEX "idx_nhl_games_away_team" ON "public"."nhl_games" USING "btree" ("away_team", "game_date");



CREATE INDEX "idx_nhl_games_away_team_id" ON "public"."nhl_games" USING "btree" ("away_team_id", "game_date");



CREATE INDEX "idx_nhl_games_date" ON "public"."nhl_games" USING "btree" ("game_date");



CREATE INDEX "idx_nhl_games_game_date_desc" ON "public"."nhl_games" USING "btree" ("game_date" DESC);



COMMENT ON INDEX "public"."idx_nhl_games_game_date_desc" IS 'Optimizes recent games lookups sorted by date descending';



CREATE INDEX "idx_nhl_games_game_id" ON "public"."nhl_games" USING "btree" ("game_id");



CREATE INDEX "idx_nhl_games_home_team" ON "public"."nhl_games" USING "btree" ("home_team", "game_date");



CREATE INDEX "idx_nhl_games_home_team_id" ON "public"."nhl_games" USING "btree" ("home_team_id", "game_date");



CREATE INDEX "idx_nhl_games_moneyline" ON "public"."nhl_games" USING "btree" ("moneyline_home", "moneyline_away") WHERE ("moneyline_home" IS NOT NULL);



CREATE INDEX "idx_nhl_games_season" ON "public"."nhl_games" USING "btree" ("season");



CREATE INDEX "idx_nhl_games_status" ON "public"."nhl_games" USING "btree" ("status");



CREATE INDEX "idx_nhl_games_teams_date" ON "public"."nhl_games" USING "btree" ("home_team", "away_team", "game_date");



CREATE INDEX "idx_nhl_playoff_seeds_season" ON "public"."nhl_playoff_seeds" USING "btree" ("season");



CREATE INDEX "idx_nhl_playoff_seeds_team_id" ON "public"."nhl_playoff_seeds" USING "btree" ("team_id");



CREATE INDEX "idx_nhl_playoff_series_active" ON "public"."nhl_playoff_series" USING "btree" ("series_status") WHERE ("series_status" = 'active'::"text");



CREATE INDEX "idx_nhl_playoff_series_high_seed_team_id" ON "public"."nhl_playoff_series" USING "btree" ("high_seed_team_id");



CREATE INDEX "idx_nhl_playoff_series_low_seed_team_id" ON "public"."nhl_playoff_series" USING "btree" ("low_seed_team_id");



CREATE INDEX "idx_nhl_playoff_series_season_round" ON "public"."nhl_playoff_series" USING "btree" ("season", "round");



CREATE INDEX "idx_nhl_playoff_series_winner_team_id" ON "public"."nhl_playoff_series" USING "btree" ("winner_team_id");



CREATE INDEX "idx_nhl_shots_goal" ON "public"."nhl_shots" USING "btree" ("is_goal");



CREATE INDEX "idx_nhl_shots_goalie" ON "public"."nhl_shots" USING "btree" ("goalie_id");



CREATE INDEX "idx_nhl_shots_season" ON "public"."nhl_shots" USING "btree" ("season");



CREATE INDEX "idx_nhl_shots_shooter" ON "public"."nhl_shots" USING "btree" ("shooter_id");



CREATE INDEX "idx_nhl_teams_abbreviation" ON "public"."nhl_teams" USING "btree" ("abbreviation");



CREATE INDEX "idx_nightly_job_runs_date" ON "public"."nightly_job_runs" USING "btree" ("run_date");



CREATE INDEX "idx_notifications_league_created" ON "public"."notifications" USING "btree" ("league_id", "created_at" DESC);



CREATE INDEX "idx_notifications_league_type" ON "public"."notifications" USING "btree" ("league_id", "type", "created_at" DESC);



CREATE INDEX "idx_notifications_user_league" ON "public"."notifications" USING "btree" ("user_id", "league_id", "read_status", "created_at" DESC);



CREATE INDEX "idx_notifications_user_read_status" ON "public"."notifications" USING "btree" ("user_id", "read_status") WHERE ("read_status" = false);



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "league_id", "created_at" DESC) WHERE ("read_status" = false);



CREATE INDEX "idx_npi_goalie" ON "public"."nhl_player_identity" USING "btree" ("is_goalie");



CREATE INDEX "idx_npi_last_season" ON "public"."nhl_player_identity" USING "btree" ("last_season" DESC);



CREATE INDEX "idx_npi_name" ON "public"."nhl_player_identity" USING "gin" ("to_tsvector"('"simple"'::"regconfig", "full_name"));



CREATE INDEX "idx_phase0c_progress_season_status" ON "public"."phase0c_progress" USING "btree" ("season", "status");



CREATE INDEX "idx_player_autopick_rankings_team_id" ON "public"."player_autopick_rankings" USING "btree" ("team_id");



CREATE INDEX "idx_player_directory_eligible_positions" ON "public"."player_directory" USING "btree" ("eligible_positions");



CREATE INDEX "idx_player_directory_player_id" ON "public"."player_directory" USING "btree" ("player_id");



CREATE INDEX "idx_player_directory_season" ON "public"."player_directory" USING "btree" ("season");



CREATE INDEX "idx_player_directory_team_abbrev" ON "public"."player_directory" USING "btree" ("team_abbrev");



CREATE INDEX "idx_player_game_stats_fantasy_scoring" ON "public"."player_game_stats" USING "btree" ("season", "game_id") INCLUDE ("player_id", "nhl_goals", "nhl_assists", "nhl_shots_on_goal", "nhl_hits", "nhl_blocks", "nhl_pim", "nhl_ppg", "nhl_ppa", "nhl_shg", "nhl_sha");



CREATE INDEX "idx_player_game_stats_game_date" ON "public"."player_game_stats" USING "btree" ("game_date");



CREATE INDEX "idx_player_game_stats_nhl_expanded" ON "public"."player_game_stats" USING "btree" ("game_id", "player_id", "is_goalie");



CREATE INDEX "idx_player_game_stats_player_id" ON "public"."player_game_stats" USING "btree" ("player_id");



CREATE INDEX "idx_player_game_stats_season" ON "public"."player_game_stats" USING "btree" ("season");



CREATE INDEX "idx_player_playoff_stats_updated" ON "public"."player_playoff_stats" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_player_projections_calculated_at" ON "public"."player_projections" USING "btree" ("calculated_at");



CREATE INDEX "idx_player_projections_game_id" ON "public"."player_projections" USING "btree" ("game_id");



CREATE INDEX "idx_player_projections_opponent_team" ON "public"."player_projections" USING "btree" ("opponent_team_id");



CREATE INDEX "idx_player_projections_player_id" ON "public"."player_projections" USING "btree" ("player_id");



CREATE INDEX "idx_player_projections_season" ON "public"."player_projections" USING "btree" ("season");



CREATE INDEX "idx_player_season_stats_nhl_goals" ON "public"."player_season_stats" USING "btree" ("nhl_goals") WHERE ("nhl_goals" > 0);



CREATE INDEX "idx_player_season_stats_nhl_points" ON "public"."player_season_stats" USING "btree" ("nhl_points") WHERE ("nhl_points" > 0);



CREATE INDEX "idx_player_season_stats_nhl_wins" ON "public"."player_season_stats" USING "btree" ("nhl_wins") WHERE (("is_goalie" = true) AND ("nhl_wins" > 0));



CREATE INDEX "idx_player_season_stats_player_id" ON "public"."player_season_stats" USING "btree" ("player_id");



CREATE INDEX "idx_player_season_stats_season" ON "public"."player_season_stats" USING "btree" ("season");



CREATE INDEX "idx_player_season_stats_team_abbrev" ON "public"."player_season_stats" USING "btree" ("team_abbrev");



CREATE INDEX "idx_player_shifts_official_game_period" ON "public"."player_shifts_official" USING "btree" ("game_id", "period");



CREATE INDEX "idx_player_shifts_official_player" ON "public"."player_shifts_official" USING "btree" ("player_id");



CREATE INDEX "idx_player_shifts_official_team" ON "public"."player_shifts_official" USING "btree" ("team_id");



CREATE INDEX "idx_player_talent_metrics_calculated_at" ON "public"."player_talent_metrics" USING "btree" ("calculated_at");



CREATE INDEX "idx_player_talent_metrics_ir_eligible" ON "public"."player_talent_metrics" USING "btree" ("is_ir_eligible") WHERE ("is_ir_eligible" = true);



CREATE INDEX "idx_player_talent_metrics_likely_to_play" ON "public"."player_talent_metrics" USING "btree" ("is_likely_to_play") WHERE ("is_likely_to_play" = true);



CREATE INDEX "idx_player_talent_metrics_player_id" ON "public"."player_talent_metrics" USING "btree" ("player_id");



CREATE INDEX "idx_player_talent_metrics_ros_projection" ON "public"."player_talent_metrics" USING "btree" ("ros_projection_xg" DESC);



CREATE INDEX "idx_player_talent_metrics_season" ON "public"."player_talent_metrics" USING "btree" ("season");



CREATE INDEX "idx_player_talent_metrics_vopa_date" ON "public"."player_talent_metrics" USING "btree" ("player_id", "vopa_calculation_date");



CREATE INDEX "idx_player_transactions_created_at" ON "public"."player_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_player_transactions_league" ON "public"."player_transactions" USING "btree" ("league_id");



CREATE INDEX "idx_player_transactions_player_id" ON "public"."player_transactions" USING "btree" ("player_id");



CREATE INDEX "idx_player_transactions_team" ON "public"."player_transactions" USING "btree" ("team_id");



CREATE INDEX "idx_player_transactions_trending" ON "public"."player_transactions" USING "btree" ("player_id", "transaction_type", "created_at" DESC) WHERE ("transaction_type" = 'add'::"text");



CREATE INDEX "idx_player_transactions_type" ON "public"."player_transactions" USING "btree" ("transaction_type");



CREATE INDEX "idx_player_transactions_user_id" ON "public"."player_transactions" USING "btree" ("user_id");



CREATE INDEX "idx_player_waiver_status_cleared" ON "public"."player_waiver_status" USING "btree" ("league_id", "cleared_at") WHERE ("cleared_at" IS NULL);



CREATE INDEX "idx_player_waiver_status_dropped_at" ON "public"."player_waiver_status" USING "btree" ("dropped_at" DESC);



CREATE INDEX "idx_player_waiver_status_dropped_by_team_id" ON "public"."player_waiver_status" USING "btree" ("dropped_by_team_id");



CREATE INDEX "idx_player_waiver_status_league_player" ON "public"."player_waiver_status" USING "btree" ("league_id", "player_id");



CREATE INDEX "idx_player_weekly_stats_date_range" ON "public"."player_weekly_stats" USING "btree" ("week_start_date", "week_end_date");



CREATE INDEX "idx_player_weekly_stats_player_dates" ON "public"."player_weekly_stats" USING "btree" ("player_id", "week_start_date", "week_end_date");



CREATE INDEX "idx_player_weekly_stats_player_week" ON "public"."player_weekly_stats" USING "btree" ("player_id", "week_number");



CREATE INDEX "idx_players_team_id" ON "public"."players" USING "btree" ("team_id");



CREATE INDEX "idx_playoff_bracket_picks_league" ON "public"."playoff_bracket_picks" USING "btree" ("league_id", "user_id");



CREATE INDEX "idx_playoff_bracket_picks_picked_team_id" ON "public"."playoff_bracket_picks" USING "btree" ("picked_team_id");



CREATE INDEX "idx_playoff_bracket_picks_slot" ON "public"."playoff_bracket_picks" USING "btree" ("series_slot", "picked_team_id");



CREATE INDEX "idx_playoff_bracket_picks_user_id" ON "public"."playoff_bracket_picks" USING "btree" ("user_id");



CREATE INDEX "idx_playoff_brackets_champion_team_id" ON "public"."playoff_brackets" USING "btree" ("champion_team_id");



CREATE INDEX "idx_playoff_brackets_generated_by" ON "public"."playoff_brackets" USING "btree" ("generated_by");



CREATE INDEX "idx_playoff_brackets_league" ON "public"."playoff_brackets" USING "btree" ("league_id");



CREATE INDEX "idx_playoff_brackets_runner_up_team_id" ON "public"."playoff_brackets" USING "btree" ("runner_up_team_id");



CREATE INDEX "idx_playoff_brackets_status" ON "public"."playoff_brackets" USING "btree" ("status");



CREATE INDEX "idx_playoff_brackets_third_place_team_id" ON "public"."playoff_brackets" USING "btree" ("third_place_team_id");



CREATE INDEX "idx_playoff_confidence_picks_league" ON "public"."playoff_confidence_picks" USING "btree" ("league_id", "user_id");



CREATE INDEX "idx_playoff_confidence_picks_picked_team_id" ON "public"."playoff_confidence_picks" USING "btree" ("picked_team_id");



CREATE INDEX "idx_playoff_confidence_picks_user_id" ON "public"."playoff_confidence_picks" USING "btree" ("user_id");



CREATE INDEX "idx_playoff_pool_standings_rank" ON "public"."playoff_pool_standings" USING "btree" ("league_id", "current_rank");



CREATE INDEX "idx_playoff_pool_standings_user_id" ON "public"."playoff_pool_standings" USING "btree" ("user_id");



CREATE INDEX "idx_playoff_roster_picks_league" ON "public"."playoff_roster_picks" USING "btree" ("league_id", "user_id");



CREATE INDEX "idx_playoff_roster_picks_user_id" ON "public"."playoff_roster_picks" USING "btree" ("user_id");



CREATE INDEX "idx_playoff_seeds_bracket" ON "public"."playoff_seeds" USING "btree" ("bracket_id");



CREATE INDEX "idx_playoff_seeds_team" ON "public"."playoff_seeds" USING "btree" ("team_id");



CREATE INDEX "idx_playoff_series_away_team_id" ON "public"."playoff_series" USING "btree" ("away_team_id");



CREATE INDEX "idx_playoff_series_bracket" ON "public"."playoff_series" USING "btree" ("bracket_id");



CREATE INDEX "idx_playoff_series_loser_drops_to" ON "public"."playoff_series" USING "btree" ("loser_drops_to");



CREATE INDEX "idx_playoff_series_loser_team_id" ON "public"."playoff_series" USING "btree" ("loser_team_id");



CREATE INDEX "idx_playoff_series_round" ON "public"."playoff_series" USING "btree" ("bracket_id", "round_number");



CREATE INDEX "idx_playoff_series_status" ON "public"."playoff_series" USING "btree" ("status");



CREATE INDEX "idx_playoff_series_teams" ON "public"."playoff_series" USING "btree" ("home_team_id", "away_team_id");



CREATE INDEX "idx_playoff_series_winner_advances_to" ON "public"."playoff_series" USING "btree" ("winner_advances_to");



CREATE INDEX "idx_playoff_series_winner_team_id" ON "public"."playoff_series" USING "btree" ("winner_team_id");



CREATE INDEX "idx_pool_picks_league_week" ON "public"."pool_picks" USING "btree" ("league_id", "week_number");



CREATE INDEX "idx_pool_picks_user" ON "public"."pool_picks" USING "btree" ("league_id", "user_id");



CREATE INDEX "idx_pool_picks_user_id" ON "public"."pool_picks" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_timezone" ON "public"."profiles" USING "btree" ("timezone");



CREATE INDEX "idx_profiles_username" ON "public"."profiles" USING "btree" ("username");



CREATE INDEX "idx_proj_date_fast" ON "public"."player_projected_stats" USING "btree" ("projection_date");



CREATE INDEX "idx_proj_opponent" ON "public"."player_projected_stats" USING "btree" ("opponent_team_id", "projection_date");



CREATE INDEX "idx_proj_player_date_fast" ON "public"."player_projected_stats" USING "btree" ("player_id", "projection_date");



CREATE INDEX "idx_proj_season_date" ON "public"."player_projected_stats" USING "btree" ("season", "projection_date");



CREATE INDEX "idx_projected_stats_game" ON "public"."player_projected_stats" USING "btree" ("game_id");



CREATE INDEX "idx_projected_stats_is_goalie" ON "public"."player_projected_stats" USING "btree" ("is_goalie", "projection_date");



CREATE INDEX "idx_projected_stats_player_game" ON "public"."player_projected_stats" USING "btree" ("player_id", "game_id");



CREATE INDEX "idx_projected_stats_player_vopa" ON "public"."player_projected_stats" USING "btree" ("player_id", "projected_vopa") WHERE ("projected_vopa" IS NOT NULL);



CREATE INDEX "idx_projected_stats_season" ON "public"."player_projected_stats" USING "btree" ("season");



CREATE INDEX "idx_projected_stats_starter_confirmed" ON "public"."player_projected_stats" USING "btree" ("starter_confirmed", "projection_date");



CREATE INDEX "idx_projected_stats_vopa" ON "public"."player_projected_stats" USING "btree" ("projected_vopa") WHERE ("projected_vopa" IS NOT NULL);



CREATE INDEX "idx_projection_cache_date" ON "public"."projection_cache" USING "btree" ("projection_date");



CREATE INDEX "idx_projection_cache_game_id" ON "public"."projection_cache" USING "btree" ("game_id");



CREATE INDEX "idx_projection_cache_player_game_date" ON "public"."projection_cache" USING "btree" ("player_id", "game_id", "projection_date");



CREATE INDEX "idx_projection_cache_season" ON "public"."projection_cache" USING "btree" ("season");



CREATE INDEX "idx_projections_game_id" ON "public"."projections" USING "btree" ("game_id");



CREATE INDEX "idx_projections_game_player" ON "public"."projections" USING "btree" ("game_id", "player_id");



CREATE INDEX "idx_projections_player_id" ON "public"."projections" USING "btree" ("player_id");



CREATE INDEX "idx_raw_nhl_data_boxscore_json" ON "public"."raw_nhl_data" USING "gin" ("boxscore_json");



CREATE INDEX "idx_raw_nhl_data_game_date" ON "public"."raw_nhl_data" USING "btree" ("game_date");



CREATE INDEX "idx_raw_nhl_data_game_id" ON "public"."raw_nhl_data" USING "btree" ("game_id");



CREATE INDEX "idx_raw_nhl_data_processed" ON "public"."raw_nhl_data" USING "btree" ("processed");



CREATE INDEX "idx_raw_nhl_data_stats_extracted" ON "public"."raw_nhl_data" USING "btree" ("stats_extracted");



CREATE INDEX "idx_raw_player_stats_player_id" ON "public"."raw_player_stats" USING "btree" ("playerId");



CREATE INDEX "idx_raw_shots_created_at" ON "public"."raw_shots" USING "btree" ("created_at");



CREATE INDEX "idx_raw_shots_game_id" ON "public"."raw_shots" USING "btree" ("game_id");



CREATE INDEX "idx_raw_shots_goalie_id" ON "public"."raw_shots" USING "btree" ("goalie_id");



CREATE INDEX "idx_raw_shots_has_pass" ON "public"."raw_shots" USING "btree" ("has_pass_before_shot");



CREATE INDEX "idx_raw_shots_is_goal" ON "public"."raw_shots" USING "btree" ("is_goal");



CREATE INDEX "idx_raw_shots_is_rush" ON "public"."raw_shots" USING "btree" ("is_rush");



CREATE INDEX "idx_raw_shots_last_event_category" ON "public"."raw_shots" USING "btree" ("last_event_category");



CREATE INDEX "idx_raw_shots_pass_zone" ON "public"."raw_shots" USING "btree" ("pass_zone");



CREATE INDEX "idx_raw_shots_passer_id" ON "public"."raw_shots" USING "btree" ("passer_id");



CREATE INDEX "idx_raw_shots_period" ON "public"."raw_shots" USING "btree" ("period");



CREATE INDEX "idx_raw_shots_player_id" ON "public"."raw_shots" USING "btree" ("player_id");



CREATE INDEX "idx_raw_shots_season" ON "public"."raw_shots" USING "btree" ("season");



CREATE INDEX "idx_raw_shots_zone" ON "public"."raw_shots" USING "btree" ("zone");



CREATE INDEX "idx_recovery_log_time" ON "public"."auto_recovery_log" USING "btree" ("recovery_time" DESC);



CREATE INDEX "idx_ros_player" ON "public"."player_ros_projections" USING "btree" ("player_id");



CREATE INDEX "idx_ros_season" ON "public"."player_ros_projections" USING "btree" ("season");



CREATE INDEX "idx_ros_total_points" ON "public"."player_ros_projections" USING "btree" ("total_projected_points" DESC);



CREATE INDEX "idx_roster_assignments_league" ON "public"."roster_assignments" USING "btree" ("league_id");



CREATE INDEX "idx_roster_assignments_league_player" ON "public"."roster_assignments" USING "btree" ("league_id", "player_id");



CREATE INDEX "idx_roster_assignments_player" ON "public"."roster_assignments" USING "btree" ("player_id");



CREATE INDEX "idx_roster_assignments_team" ON "public"."roster_assignments" USING "btree" ("team_id");



CREATE INDEX "idx_roster_assignments_team_league" ON "public"."roster_assignments" USING "btree" ("team_id", "league_id");



CREATE INDEX "idx_roster_assignments_team_league_player" ON "public"."roster_assignments" USING "btree" ("team_id", "league_id", "player_id");



CREATE INDEX "idx_roster_transactions_league_id" ON "public"."transaction_ledger" USING "btree" ("league_id");



CREATE INDEX "idx_roster_transactions_player_id" ON "public"."transaction_ledger" USING "btree" ("player_id");



CREATE INDEX "idx_roster_transactions_team_id" ON "public"."transaction_ledger" USING "btree" ("team_id");



CREATE INDEX "idx_roster_transactions_user_id" ON "public"."transaction_ledger" USING "btree" ("user_id");



CREATE INDEX "idx_security_audit_log_created" ON "public"."security_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_security_audit_log_league" ON "public"."security_audit_log" USING "btree" ("league_id", "created_at" DESC);



CREATE INDEX "idx_security_audit_log_severity" ON "public"."security_audit_log" USING "btree" ("severity", "created_at" DESC) WHERE ("severity" = ANY (ARRAY['WARN'::"text", 'ERROR'::"text", 'CRITICAL'::"text"]));



CREATE INDEX "idx_security_audit_log_type" ON "public"."security_audit_log" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_security_audit_log_user" ON "public"."security_audit_log" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_shifts_game_period" ON "public"."player_shifts" USING "btree" ("game_id", "period");



CREATE INDEX "idx_shifts_player_game" ON "public"."player_shifts" USING "btree" ("player_id", "game_id");



CREATE INDEX "idx_shifts_season" ON "public"."player_shifts" USING "btree" ("season");



CREATE INDEX "idx_shifts_time_range" ON "public"."player_shifts" USING "btree" ("game_id", "period", "shift_start_time_seconds", "shift_end_time_seconds");



CREATE INDEX "idx_stormy_chat_log_user_created" ON "public"."stormy_chat_log" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_survivor_league_week" ON "public"."survivor_selections" USING "btree" ("league_id", "week_number");



CREATE INDEX "idx_survivor_selections_user_id" ON "public"."survivor_selections" USING "btree" ("user_id");



CREATE INDEX "idx_survivor_user" ON "public"."survivor_selections" USING "btree" ("league_id", "user_id");



CREATE INDEX "idx_team_lineups_league_id" ON "public"."team_lineups" USING "btree" ("league_id");



CREATE INDEX "idx_team_lineups_team_id" ON "public"."team_lineups" USING "btree" ("team_id");



CREATE INDEX "idx_team_lineups_team_league" ON "public"."team_lineups" USING "btree" ("team_id", "league_id");



CREATE INDEX "idx_team_lineups_team_league_updated" ON "public"."team_lineups" USING "btree" ("team_id", "league_id", "updated_at" DESC);



CREATE INDEX "idx_team_lineups_updated_at" ON "public"."team_lineups" USING "btree" ("updated_at");



CREATE INDEX "idx_team_mapping_aliases" ON "public"."team_mapping_config" USING "gin" ("aliased_team_codes");



CREATE INDEX "idx_team_mapping_canonical" ON "public"."team_mapping_config" USING "btree" ("canonical_team_code");



CREATE INDEX "idx_teams_league_id" ON "public"."teams" USING "btree" ("league_id");



CREATE INDEX "idx_teams_owner_id" ON "public"."teams" USING "btree" ("owner_id");



CREATE INDEX "idx_teams_owner_league_composite" ON "public"."teams" USING "btree" ("owner_id", "league_id");



CREATE INDEX "idx_toi_player_game" ON "public"."player_toi_by_situation" USING "btree" ("player_id", "game_id");



CREATE INDEX "idx_toi_player_situation" ON "public"."player_toi_by_situation" USING "btree" ("player_id", "situation");



CREATE INDEX "idx_toi_season" ON "public"."player_toi_by_situation" USING "btree" ("season");



CREATE INDEX "idx_toi_situation" ON "public"."player_toi_by_situation" USING "btree" ("situation");



CREATE INDEX "idx_trade_history_executed_at" ON "public"."trade_history" USING "btree" ("executed_at");



CREATE INDEX "idx_trade_history_league" ON "public"."trade_history" USING "btree" ("league_id");



CREATE INDEX "idx_trade_history_team1" ON "public"."trade_history" USING "btree" ("team1_id");



CREATE INDEX "idx_trade_history_team2" ON "public"."trade_history" USING "btree" ("team2_id");



CREATE INDEX "idx_trade_history_trade_offer_id" ON "public"."trade_history" USING "btree" ("trade_offer_id");



CREATE INDEX "idx_trade_offers_counter_offer_id" ON "public"."trade_offers" USING "btree" ("counter_offer_id");



CREATE INDEX "idx_trade_offers_created_at" ON "public"."trade_offers" USING "btree" ("created_at");



CREATE INDEX "idx_trade_offers_from_team" ON "public"."trade_offers" USING "btree" ("from_team_id");



CREATE INDEX "idx_trade_offers_league" ON "public"."trade_offers" USING "btree" ("league_id");



CREATE INDEX "idx_trade_offers_league_status" ON "public"."trade_offers" USING "btree" ("league_id", "status");



CREATE INDEX "idx_trade_offers_league_status_created" ON "public"."trade_offers" USING "btree" ("league_id", "status", "created_at" DESC);



COMMENT ON INDEX "public"."idx_trade_offers_league_status_created" IS 'Optimizes "active trades in league" queries sorted by newest first';



CREATE INDEX "idx_trade_offers_status" ON "public"."trade_offers" USING "btree" ("status");



CREATE INDEX "idx_trade_offers_status_expires" ON "public"."trade_offers" USING "btree" ("status", "expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_trade_offers_to_team" ON "public"."trade_offers" USING "btree" ("to_team_id");



CREATE INDEX "idx_trade_votes_league" ON "public"."trade_votes" USING "btree" ("league_id");



CREATE INDEX "idx_trade_votes_offer" ON "public"."trade_votes" USING "btree" ("trade_offer_id");



CREATE INDEX "idx_trade_votes_voter_team_id" ON "public"."trade_votes" USING "btree" ("voter_team_id");



CREATE INDEX "idx_transaction_ledger_add_limits" ON "public"."transaction_ledger" USING "btree" ("league_id", "team_id", "type", "created_at" DESC) WHERE ("type" = 'ADD'::"text");



CREATE INDEX "idx_transaction_ledger_created_at" ON "public"."transaction_ledger" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_waitlist_created_at" ON "public"."waitlist" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_waitlist_email" ON "public"."waitlist" USING "btree" ("email");



CREATE INDEX "idx_waiver_claims_created_at" ON "public"."waiver_claims" USING "btree" ("created_at");



CREATE INDEX "idx_waiver_claims_league" ON "public"."waiver_claims" USING "btree" ("league_id");



CREATE INDEX "idx_waiver_claims_league_status" ON "public"."waiver_claims" USING "btree" ("league_id", "status");



CREATE INDEX "idx_waiver_claims_pending" ON "public"."waiver_claims" USING "btree" ("league_id", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_waiver_claims_player" ON "public"."waiver_claims" USING "btree" ("player_id");



CREATE INDEX "idx_waiver_claims_status" ON "public"."waiver_claims" USING "btree" ("status");



CREATE INDEX "idx_waiver_claims_team" ON "public"."waiver_claims" USING "btree" ("team_id");



CREATE INDEX "idx_waiver_claims_team_status" ON "public"."waiver_claims" USING "btree" ("team_id", "status");



COMMENT ON INDEX "public"."idx_waiver_claims_team_status" IS 'Optimizes "my pending claims" queries filtering by team + status';



CREATE INDEX "idx_waiver_priority_league" ON "public"."waiver_priority" USING "btree" ("league_id");



CREATE INDEX "idx_waiver_priority_league_priority" ON "public"."waiver_priority" USING "btree" ("league_id", "priority");



CREATE INDEX "idx_waiver_priority_team_id" ON "public"."waiver_priority" USING "btree" ("team_id");



CREATE INDEX "idx_xg_recompute_2025_gid_eid" ON "public"."_xg_recompute_2025" USING "btree" ("game_id", "event_id");



CREATE INDEX "nhl_games_retired_phantoms_away_team_game_date_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("away_team", "game_date");



CREATE INDEX "nhl_games_retired_phantoms_away_team_id_game_date_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("away_team_id", "game_date");



CREATE INDEX "nhl_games_retired_phantoms_game_date_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("game_date");



CREATE INDEX "nhl_games_retired_phantoms_game_date_idx1" ON "public"."nhl_games_retired_phantoms" USING "btree" ("game_date" DESC);



COMMENT ON INDEX "public"."nhl_games_retired_phantoms_game_date_idx1" IS 'Optimizes recent games lookups sorted by date descending';



CREATE INDEX "nhl_games_retired_phantoms_game_id_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("game_id");



CREATE INDEX "nhl_games_retired_phantoms_home_team_away_team_game_date_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("home_team", "away_team", "game_date");



CREATE INDEX "nhl_games_retired_phantoms_home_team_game_date_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("home_team", "game_date");



CREATE INDEX "nhl_games_retired_phantoms_home_team_id_game_date_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("home_team_id", "game_date");



CREATE INDEX "nhl_games_retired_phantoms_moneyline_home_moneyline_away_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("moneyline_home", "moneyline_away") WHERE ("moneyline_home" IS NOT NULL);



CREATE INDEX "nhl_games_retired_phantoms_season_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("season");



CREATE INDEX "nhl_games_retired_phantoms_status_idx" ON "public"."nhl_games_retired_phantoms" USING "btree" ("status");



CREATE INDEX "pct_name" ON "public"."player_career_totals" USING "gin" ("to_tsvector"('"simple"'::"regconfig", COALESCE("full_name", ''::"text")));



CREATE UNIQUE INDEX "pct_pk" ON "public"."player_career_totals" USING "btree" ("player_id", "game_type");



CREATE INDEX "pct_points" ON "public"."player_career_totals" USING "btree" ("game_type", "points" DESC);



CREATE INDEX "pipeline_runs_service_started_idx" ON "public"."pipeline_runs" USING "btree" ("service_name", "started_at" DESC);



CREATE INDEX "player_projected_stats_retire_opponent_team_id_projection_d_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("opponent_team_id", "projection_date");



CREATE INDEX "player_projected_stats_retire_starter_confirmed_projection__idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("starter_confirmed", "projection_date");



CREATE INDEX "player_projected_stats_retired_ph_is_goalie_projection_date_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("is_goalie", "projection_date");



CREATE INDEX "player_projected_stats_retired_ph_player_id_projection_date_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("player_id", "projection_date");



CREATE INDEX "player_projected_stats_retired_pha_player_id_projected_vopa_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("player_id", "projected_vopa") WHERE ("projected_vopa" IS NOT NULL);



CREATE INDEX "player_projected_stats_retired_phant_season_projection_date_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("season", "projection_date");



CREATE INDEX "player_projected_stats_retired_phantoms_game_id_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("game_id");



CREATE INDEX "player_projected_stats_retired_phantoms_player_id_game_id_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("player_id", "game_id");



CREATE INDEX "player_projected_stats_retired_phantoms_projected_vopa_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("projected_vopa") WHERE ("projected_vopa" IS NOT NULL);



CREATE INDEX "player_projected_stats_retired_phantoms_projection_date_idx1" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("projection_date");



CREATE INDEX "player_projected_stats_retired_phantoms_season_idx" ON "public"."player_projected_stats_retired_phantoms" USING "btree" ("season");



CREATE INDEX "player_xg_season_player_id_season_idx" ON "public"."player_xg_season" USING "btree" ("player_id", "season");



CREATE INDEX "pst_name" ON "public"."player_season_totals" USING "gin" ("to_tsvector"('"simple"'::"regconfig", COALESCE("full_name", ''::"text")));



CREATE UNIQUE INDEX "pst_pk" ON "public"."player_season_totals" USING "btree" ("player_id", "season", "game_type");



CREATE INDEX "pst_player" ON "public"."player_season_totals" USING "btree" ("player_id");



CREATE INDEX "pst_season_points" ON "public"."player_season_totals" USING "btree" ("season", "game_type", "points" DESC);



CREATE INDEX "raw_shots_rebuild_created_at_idx" ON "public"."raw_shots_rebuild" USING "btree" ("created_at");



CREATE INDEX "raw_shots_rebuild_game_id_idx" ON "public"."raw_shots_rebuild" USING "btree" ("game_id");



CREATE INDEX "raw_shots_rebuild_goalie_id_idx" ON "public"."raw_shots_rebuild" USING "btree" ("goalie_id");



CREATE INDEX "raw_shots_rebuild_has_pass_before_shot_idx" ON "public"."raw_shots_rebuild" USING "btree" ("has_pass_before_shot");



CREATE INDEX "raw_shots_rebuild_is_goal_idx" ON "public"."raw_shots_rebuild" USING "btree" ("is_goal");



CREATE INDEX "raw_shots_rebuild_is_rush_idx" ON "public"."raw_shots_rebuild" USING "btree" ("is_rush");



CREATE INDEX "raw_shots_rebuild_last_event_category_idx" ON "public"."raw_shots_rebuild" USING "btree" ("last_event_category");



CREATE INDEX "raw_shots_rebuild_pass_zone_idx" ON "public"."raw_shots_rebuild" USING "btree" ("pass_zone");



CREATE INDEX "raw_shots_rebuild_passer_id_idx" ON "public"."raw_shots_rebuild" USING "btree" ("passer_id");



CREATE INDEX "raw_shots_rebuild_period_idx" ON "public"."raw_shots_rebuild" USING "btree" ("period");



CREATE INDEX "raw_shots_rebuild_player_id_idx" ON "public"."raw_shots_rebuild" USING "btree" ("player_id");



CREATE INDEX "raw_shots_rebuild_season_idx" ON "public"."raw_shots_rebuild" USING "btree" ("season");



CREATE INDEX "raw_shots_rebuild_zone_idx" ON "public"."raw_shots_rebuild" USING "btree" ("zone");



CREATE UNIQUE INDEX "user_privacy_consent_live_grant_uniq" ON "public"."user_privacy_consent" USING "btree" ("user_id", "policy_type", "version") WHERE ("granted" AND ("withdrawn_at" IS NULL));



CREATE INDEX "user_privacy_consent_user_idx" ON "public"."user_privacy_consent" USING "btree" ("user_id", "policy_type", "consented_at" DESC);



CREATE OR REPLACE TRIGGER "create_matchup_scoring_snapshot_on_insert" AFTER INSERT ON "public"."matchups" FOR EACH ROW EXECUTE FUNCTION "public"."create_matchup_scoring_snapshot"();



CREATE OR REPLACE TRIGGER "enforce_trade_deadline_trigger" BEFORE INSERT ON "public"."trade_offers" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_trade_deadline"();



CREATE OR REPLACE TRIGGER "log_league_scoring_change_on_update" AFTER UPDATE OF "settings" ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."log_league_scoring_change"();



CREATE OR REPLACE TRIGGER "log_settings_change_trigger" AFTER UPDATE ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."log_settings_change"();



CREATE OR REPLACE TRIGGER "notify_league_on_transaction_trigger" AFTER INSERT ON "public"."transaction_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."notify_league_on_transaction"();



CREATE OR REPLACE TRIGGER "reseed_waiver_priority_on_setting_change" AFTER UPDATE OF "waiver_type" ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."tg_reseed_waiver_priority_on_setting_change"();



CREATE OR REPLACE TRIGGER "seed_faab_budgets_on_team_insert" AFTER INSERT ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."tg_seed_faab_budgets"();



CREATE OR REPLACE TRIGGER "seed_faab_budgets_on_waiver_type_change" AFTER UPDATE OF "waiver_type" ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."tg_seed_faab_budgets"();



CREATE OR REPLACE TRIGGER "seed_waiver_priority_on_team_insert" AFTER INSERT ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."tg_seed_waiver_priority_for_new_team"();



CREATE OR REPLACE TRIGGER "sync_playoff_scores_trigger" AFTER UPDATE ON "public"."matchups" FOR EACH ROW EXECUTE FUNCTION "public"."sync_playoff_scores"();



CREATE OR REPLACE TRIGGER "sync_rules_to_scoring_settings_trg" AFTER INSERT OR DELETE OR UPDATE ON "public"."league_scoring_rules" FOR EACH ROW EXECUTE FUNCTION "public"."sync_rules_to_scoring_settings"();



CREATE OR REPLACE TRIGGER "sync_scoring_settings_to_rules_trg" AFTER UPDATE OF "scoring_settings" ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."sync_scoring_settings_to_rules"();



CREATE OR REPLACE TRIGGER "trg_propagate_playoff_winner" AFTER UPDATE OF "winner_team_id" ON "public"."nhl_playoff_series" FOR EACH ROW WHEN (("new"."winner_team_id" IS NOT NULL)) EXECUTE FUNCTION "public"."propagate_playoff_series_winner"();



CREATE OR REPLACE TRIGGER "trigger_create_notifications_from_transaction" AFTER INSERT ON "public"."transaction_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."create_notifications_from_transaction"();



CREATE OR REPLACE TRIGGER "trigger_update_implied_probabilities" BEFORE INSERT OR UPDATE OF "moneyline_home", "moneyline_away" ON "public"."nhl_games" FOR EACH ROW EXECUTE FUNCTION "public"."update_implied_probabilities"();



CREATE OR REPLACE TRIGGER "trigger_update_player_projections_updated_at" BEFORE UPDATE ON "public"."player_projections" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_projections_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_player_talent_metrics_updated_at" BEFORE UPDATE ON "public"."player_talent_metrics" FOR EACH ROW EXECUTE FUNCTION "public"."update_player_talent_metrics_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_roster_assignments_updated_at" BEFORE UPDATE ON "public"."roster_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_roster_assignments_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_validate_team_lineups_integrity" BEFORE INSERT OR UPDATE ON "public"."team_lineups" FOR EACH ROW EXECUTE FUNCTION "public"."validate_team_lineups_integrity"();



CREATE OR REPLACE TRIGGER "update_fantasy_daily_rosters_updated_at" BEFORE UPDATE ON "public"."fantasy_daily_rosters" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_fantasy_matchup_lines_updated_at" BEFORE UPDATE ON "public"."fantasy_matchup_lines" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_goalie_gsax_primary_updated_at" BEFORE UPDATE ON "public"."goalie_gsax_primary" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_goalie_gsax_updated_at" BEFORE UPDATE ON "public"."goalie_gsax" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_keeper_designations_updated_at" BEFORE UPDATE ON "public"."keeper_designations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_league_averages_updated_at" BEFORE UPDATE ON "public"."league_averages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_leagues_updated_at" BEFORE UPDATE ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_matchups_updated_at" BEFORE UPDATE ON "public"."matchups" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_nhl_games_updated_at" BEFORE UPDATE ON "public"."nhl_games" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_nhl_teams_updated_at" BEFORE UPDATE ON "public"."nhl_teams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_player_autopick_rankings_updated_at" BEFORE UPDATE ON "public"."player_autopick_rankings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_player_projected_stats_updated_at" BEFORE UPDATE ON "public"."player_projected_stats" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_playoff_brackets_updated_at" BEFORE UPDATE ON "public"."playoff_brackets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_playoff_series_updated_at" BEFORE UPDATE ON "public"."playoff_series" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_projections_updated_at" BEFORE UPDATE ON "public"."projections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_team_lineups_updated_at" BEFORE UPDATE ON "public"."team_lineups" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_teams_updated_at" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_trade_offers_updated_at" BEFORE UPDATE ON "public"."trade_offers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_trade_votes_updated_at" BEFORE UPDATE ON "public"."trade_votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_waiver_claims_updated_at" BEFORE UPDATE ON "public"."waiver_claims" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "validate_league_settings_trigger" BEFORE INSERT OR UPDATE ON "public"."leagues" FOR EACH ROW EXECUTE FUNCTION "public"."validate_league_settings"();



CREATE OR REPLACE TRIGGER "validate_matchup_scores_trigger" BEFORE UPDATE OF "team1_score", "team2_score" ON "public"."matchups" FOR EACH ROW EXECUTE FUNCTION "public"."validate_matchup_scores_before_update"();



COMMENT ON TRIGGER "validate_matchup_scores_trigger" ON "public"."matchups" IS 'Validates matchup scores before update to prevent season totals (2000+) from being written. Logs warnings for suspicious scores.';



CREATE OR REPLACE TRIGGER "validate_team_commissioner" BEFORE INSERT ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."validate_team_insert"();



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_nomination_id_fkey" FOREIGN KEY ("nomination_id") REFERENCES "public"."auction_nominations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_budgets"
    ADD CONSTRAINT "auction_budgets_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_budgets"
    ADD CONSTRAINT "auction_budgets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_nominations"
    ADD CONSTRAINT "auction_nominations_current_high_bidder_team_id_fkey" FOREIGN KEY ("current_high_bidder_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."auction_nominations"
    ADD CONSTRAINT "auction_nominations_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auction_nominations"
    ADD CONSTRAINT "auction_nominations_nominated_by_team_id_fkey" FOREIGN KEY ("nominated_by_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."confidence_picks"
    ADD CONSTRAINT "confidence_picks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."confidence_picks"
    ADD CONSTRAINT "confidence_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."draft_order"
    ADD CONSTRAINT "draft_order_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_reserved_by_fkey" FOREIGN KEY ("reserved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."draft_picks"
    ADD CONSTRAINT "draft_picks_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faab_budgets"
    ADD CONSTRAINT "faab_budgets_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faab_budgets"
    ADD CONSTRAINT "faab_budgets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fantasy_daily_rosters"
    ADD CONSTRAINT "fantasy_daily_rosters_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fantasy_daily_rosters"
    ADD CONSTRAINT "fantasy_daily_rosters_matchup_id_fkey" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fantasy_daily_rosters"
    ADD CONSTRAINT "fantasy_daily_rosters_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fantasy_matchup_lines"
    ADD CONSTRAINT "fantasy_matchup_lines_matchup_id_fkey" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fantasy_matchup_lines"
    ADD CONSTRAINT "fantasy_matchup_lines_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_projections"
    ADD CONSTRAINT "fk_player_projections_game" FOREIGN KEY ("game_id") REFERENCES "public"."nhl_games"("game_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."join_code_attempts"
    ADD CONSTRAINT "join_code_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."keeper_designations"
    ADD CONSTRAINT "keeper_designations_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."keeper_designations"
    ADD CONSTRAINT "keeper_designations_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."keeper_designations"
    ADD CONSTRAINT "keeper_designations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."league_scoring_audit"
    ADD CONSTRAINT "league_scoring_audit_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."league_scoring_rules"
    ADD CONSTRAINT "league_scoring_rules_stat_key_fkey" FOREIGN KEY ("stat_key") REFERENCES "public"."stat_catalog"("stat_key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_commissioner_id_fkey" FOREIGN KEY ("commissioner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leagues"
    ADD CONSTRAINT "leagues_pool_winner_id_fkey" FOREIGN KEY ("pool_winner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."matchup_scoring_snapshots"
    ADD CONSTRAINT "matchup_scoring_snapshots_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matchup_scoring_snapshots"
    ADD CONSTRAINT "matchup_scoring_snapshots_matchup_id_fkey" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matchups"
    ADD CONSTRAINT "matchups_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matchups"
    ADD CONSTRAINT "matchups_team1_id_fkey" FOREIGN KEY ("team1_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matchups"
    ADD CONSTRAINT "matchups_team2_id_fkey" FOREIGN KEY ("team2_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nhl_games"
    ADD CONSTRAINT "nhl_games_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "public"."nhl_teams"("team_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."nhl_games"
    ADD CONSTRAINT "nhl_games_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "public"."nhl_teams"("team_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."nhl_playoff_seeds"
    ADD CONSTRAINT "nhl_playoff_seeds_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."nhl_teams"("team_id");



ALTER TABLE ONLY "public"."nhl_playoff_series"
    ADD CONSTRAINT "nhl_playoff_series_high_seed_team_id_fkey" FOREIGN KEY ("high_seed_team_id") REFERENCES "public"."nhl_teams"("team_id");



ALTER TABLE ONLY "public"."nhl_playoff_series"
    ADD CONSTRAINT "nhl_playoff_series_low_seed_team_id_fkey" FOREIGN KEY ("low_seed_team_id") REFERENCES "public"."nhl_teams"("team_id");



ALTER TABLE ONLY "public"."nhl_playoff_series"
    ADD CONSTRAINT "nhl_playoff_series_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "public"."nhl_teams"("team_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_autopick_rankings"
    ADD CONSTRAINT "player_autopick_rankings_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_autopick_rankings"
    ADD CONSTRAINT "player_autopick_rankings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_identity_bridge"
    ADD CONSTRAINT "player_identity_bridge_players_uuid_fkey" FOREIGN KEY ("players_uuid") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_projected_stats"
    ADD CONSTRAINT "player_projected_stats_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."nhl_games"("game_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_transactions"
    ADD CONSTRAINT "player_transactions_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_transactions"
    ADD CONSTRAINT "player_transactions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_transactions"
    ADD CONSTRAINT "player_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_waiver_status"
    ADD CONSTRAINT "player_waiver_status_dropped_by_team_id_fkey" FOREIGN KEY ("dropped_by_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."player_waiver_status"
    ADD CONSTRAINT "player_waiver_status_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."players"
    ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."nhl_teams"("team_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_bracket_picks"
    ADD CONSTRAINT "playoff_bracket_picks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_bracket_picks"
    ADD CONSTRAINT "playoff_bracket_picks_picked_team_id_fkey" FOREIGN KEY ("picked_team_id") REFERENCES "public"."nhl_teams"("team_id");



ALTER TABLE ONLY "public"."playoff_bracket_picks"
    ADD CONSTRAINT "playoff_bracket_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_champion_team_id_fkey" FOREIGN KEY ("champion_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_runner_up_team_id_fkey" FOREIGN KEY ("runner_up_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_brackets"
    ADD CONSTRAINT "playoff_brackets_third_place_team_id_fkey" FOREIGN KEY ("third_place_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_confidence_picks"
    ADD CONSTRAINT "playoff_confidence_picks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_confidence_picks"
    ADD CONSTRAINT "playoff_confidence_picks_picked_team_id_fkey" FOREIGN KEY ("picked_team_id") REFERENCES "public"."nhl_teams"("team_id");



ALTER TABLE ONLY "public"."playoff_confidence_picks"
    ADD CONSTRAINT "playoff_confidence_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."playoff_pool_standings"
    ADD CONSTRAINT "playoff_pool_standings_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_pool_standings"
    ADD CONSTRAINT "playoff_pool_standings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."playoff_roster_picks"
    ADD CONSTRAINT "playoff_roster_picks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_roster_picks"
    ADD CONSTRAINT "playoff_roster_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."playoff_seeds"
    ADD CONSTRAINT "playoff_seeds_bracket_id_fkey" FOREIGN KEY ("bracket_id") REFERENCES "public"."playoff_brackets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_seeds"
    ADD CONSTRAINT "playoff_seeds_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_bracket_id_fkey" FOREIGN KEY ("bracket_id") REFERENCES "public"."playoff_brackets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_loser_drops_to_fkey" FOREIGN KEY ("loser_drops_to") REFERENCES "public"."playoff_series"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_loser_team_id_fkey" FOREIGN KEY ("loser_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_winner_advances_to_fkey" FOREIGN KEY ("winner_advances_to") REFERENCES "public"."playoff_series"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."playoff_series"
    ADD CONSTRAINT "playoff_series_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pool_picks"
    ADD CONSTRAINT "pool_picks_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pool_picks"
    ADD CONSTRAINT "pool_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projection_cache"
    ADD CONSTRAINT "projection_cache_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."nhl_games"("game_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projections"
    ADD CONSTRAINT "projections_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."nhl_games"("game_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projections"
    ADD CONSTRAINT "projections_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roster_assignments"
    ADD CONSTRAINT "roster_assignments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_ledger"
    ADD CONSTRAINT "roster_transactions_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_ledger"
    ADD CONSTRAINT "roster_transactions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_ledger"
    ADD CONSTRAINT "roster_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."security_audit_log"
    ADD CONSTRAINT "security_audit_log_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."security_audit_log"
    ADD CONSTRAINT "security_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stormy_chat_log"
    ADD CONSTRAINT "stormy_chat_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survivor_selections"
    ADD CONSTRAINT "survivor_selections_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survivor_selections"
    ADD CONSTRAINT "survivor_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_lineups"
    ADD CONSTRAINT "team_lineups_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_history"
    ADD CONSTRAINT "trade_history_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_history"
    ADD CONSTRAINT "trade_history_team1_id_fkey" FOREIGN KEY ("team1_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_history"
    ADD CONSTRAINT "trade_history_team2_id_fkey" FOREIGN KEY ("team2_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_history"
    ADD CONSTRAINT "trade_history_trade_offer_id_fkey" FOREIGN KEY ("trade_offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_offers"
    ADD CONSTRAINT "trade_offers_counter_offer_id_fkey" FOREIGN KEY ("counter_offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_offers"
    ADD CONSTRAINT "trade_offers_from_team_id_fkey" FOREIGN KEY ("from_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_offers"
    ADD CONSTRAINT "trade_offers_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_offers"
    ADD CONSTRAINT "trade_offers_to_team_id_fkey" FOREIGN KEY ("to_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_votes"
    ADD CONSTRAINT "trade_votes_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_votes"
    ADD CONSTRAINT "trade_votes_trade_offer_id_fkey" FOREIGN KEY ("trade_offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_votes"
    ADD CONSTRAINT "trade_votes_voter_team_id_fkey" FOREIGN KEY ("voter_team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_privacy_consent"
    ADD CONSTRAINT "user_privacy_consent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_claims"
    ADD CONSTRAINT "waiver_claims_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_claims"
    ADD CONSTRAINT "waiver_claims_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_priority"
    ADD CONSTRAINT "waiver_priority_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."waiver_priority"
    ADD CONSTRAINT "waiver_priority_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



CREATE POLICY "Allow authenticated users to read goalie_gar" ON "public"."goalie_gar" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read goalie_rebound_control" ON "public"."goalie_rebound_control" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read projections" ON "public"."player_projections" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read talent metrics" ON "public"."player_talent_metrics" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow service role full access" ON "public"."player_projections" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow service role full access" ON "public"."player_talent_metrics" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Anyone can join waitlist" ON "public"."waitlist" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read pipeline meta" ON "public"."nhl_pipeline_meta" FOR SELECT USING (true);



CREATE POLICY "Anyone can read player playoff stats" ON "public"."player_playoff_stats" FOR SELECT USING (true);



CREATE POLICY "Anyone can read player transactions" ON "public"."player_transactions" FOR SELECT USING (true);



CREATE POLICY "Anyone can read player weekly stats" ON "public"."player_weekly_stats" FOR SELECT USING (true);



CREATE POLICY "Anyone can read playoff seeds" ON "public"."nhl_playoff_seeds" FOR SELECT USING (true);



CREATE POLICY "Anyone can read playoff series" ON "public"."nhl_playoff_series" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can manage goalie GSAx" ON "public"."goalie_gsax" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage goalie primary shots GSAx" ON "public"."goalie_gsax_primary" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage league averages" ON "public"."league_averages" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage player projected stats" ON "public"."player_projected_stats" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can manage projections" ON "public"."projections" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read backup logs" ON "public"."team_lineups_backup_log" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read player GAR" ON "public"."player_gar_components" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read player TOI" ON "public"."player_toi_by_situation" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read player shifts" ON "public"."player_shifts" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read projections" ON "public"."projection_cache" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read raw shots" ON "public"."raw_shots" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read recovery logs" ON "public"."auto_recovery_log" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read team mapping" ON "public"."team_mapping_config" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Bypass RLS for INSERT - trigger validates" ON "public"."teams" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Commissioners can delete picks in their leagues" ON "public"."draft_picks" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_picks"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can delete teams in their leagues" ON "public"."teams" FOR DELETE USING ("public"."is_commissioner_of_league"("league_id"));



CREATE POLICY "Commissioners can delete their leagues" ON "public"."leagues" FOR DELETE USING (("commissioner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Commissioners can delete trade votes in their leagues" ON "public"."trade_votes" FOR DELETE USING ("public"."is_commissioner_of_league"("league_id"));



CREATE POLICY "Commissioners can insert SYSTEM notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((("type" = 'SYSTEM'::"text") AND (( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "notifications"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "notifications"."league_id") AND ("teams"."owner_id" = "notifications"."user_id"))))));



CREATE POLICY "Commissioners can make picks for any team" ON "public"."draft_picks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_picks"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can manage all lineups in their leagues" ON "public"."team_lineups" USING ((EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "team_lineups"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "team_lineups"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can manage draft order" ON "public"."draft_order" USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_order"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_order"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can manage matchups" ON "public"."matchups" USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "matchups"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "matchups"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can manage playoff brackets" ON "public"."playoff_brackets" USING ((EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "playoff_brackets"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "playoff_brackets"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can manage playoff seeds" ON "public"."playoff_seeds" USING ((EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."leagues" "l" ON (("l"."id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_seeds"."bracket_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."leagues" "l" ON (("l"."id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_seeds"."bracket_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can manage playoff series" ON "public"."playoff_series" USING ((EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."leagues" "l" ON (("l"."id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_series"."bracket_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."leagues" "l" ON (("l"."id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_series"."bracket_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can update picks in their leagues" ON "public"."draft_picks" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_picks"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Commissioners can update their leagues" ON "public"."leagues" FOR UPDATE USING (("commissioner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Commissioners can view all keeper designations" ON "public"."keeper_designations" FOR SELECT USING ("public"."is_commissioner_of_league"("league_id"));



CREATE POLICY "Commissioners can view audit logs for their leagues" ON "public"."security_audit_log" FOR SELECT USING ((("league_id" IN ( SELECT "l"."id"
   FROM "public"."leagues" "l"
  WHERE ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))) OR (("league_id" IS NULL) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Commissioners can view autopick rankings in their leagues" ON "public"."player_autopick_rankings" FOR SELECT USING ("public"."is_commissioner_of_league"("league_id"));



CREATE POLICY "Commissioners can view failed transactions in their leagues" ON "public"."failed_transactions" FOR SELECT USING (("league_id" IN ( SELECT "l"."id"
   FROM "public"."leagues" "l"
  WHERE ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Commissioners can view integrity results" ON "public"."integrity_check_results" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "League members can view each other profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."shares_league_with"("id")));



CREATE POLICY "League members can view playoff brackets" ON "public"."playoff_brackets" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."league_id" = "playoff_brackets"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "playoff_brackets"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "League members can view playoff seeds" ON "public"."playoff_seeds" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."teams" "t" ON (("t"."league_id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_seeds"."bracket_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."leagues" "l" ON (("l"."id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_seeds"."bracket_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "League members can view playoff series" ON "public"."playoff_series" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."teams" "t" ON (("t"."league_id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_series"."bracket_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM ("public"."playoff_brackets" "pb"
     JOIN "public"."leagues" "l" ON (("l"."id" = "pb"."league_id")))
  WHERE (("pb"."id" = "playoff_series"."bracket_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "League members read bracket picks" ON "public"."playoff_bracket_picks" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."league_id" = "playoff_bracket_picks"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "League members read confidence picks" ON "public"."playoff_confidence_picks" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."league_id" = "playoff_confidence_picks"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "League members read roster picks" ON "public"."playoff_roster_picks" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."league_id" = "playoff_roster_picks"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "League members read standings" ON "public"."playoff_pool_standings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."league_id" = "playoff_pool_standings"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Only system can insert attempts" ON "public"."join_code_attempts" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "Public can view NHL games" ON "public"."nhl_games" FOR SELECT USING (true);



CREATE POLICY "Public can view NHL teams" ON "public"."nhl_teams" FOR SELECT USING (true);



CREATE POLICY "Public can view ROS projections" ON "public"."player_ros_projections" FOR SELECT USING (true);



CREATE POLICY "Public can view demo league" ON "public"."leagues" FOR SELECT USING (("id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid"));



COMMENT ON POLICY "Public can view demo league" ON "public"."leagues" IS 'Allows anonymous users to read the demo league for demonstration purposes';



CREATE POLICY "Public can view demo league draft picks" ON "public"."draft_picks" FOR SELECT USING ((("league_id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid") AND ("deleted_at" IS NULL)));



COMMENT ON POLICY "Public can view demo league draft picks" ON "public"."draft_picks" IS 'Allows anonymous users to read rosters (draft picks) in the demo league';



CREATE POLICY "Public can view demo league lineups" ON "public"."team_lineups" FOR SELECT USING (("league_id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid"));



COMMENT ON POLICY "Public can view demo league lineups" ON "public"."team_lineups" IS 'Allows anonymous users to read lineups in the demo league';



CREATE POLICY "Public can view demo league matchups" ON "public"."matchups" FOR SELECT USING (("league_id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid"));



COMMENT ON POLICY "Public can view demo league matchups" ON "public"."matchups" IS 'Allows anonymous users to read matchups in the demo league';



CREATE POLICY "Public can view demo league teams" ON "public"."teams" FOR SELECT USING (("league_id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid"));



COMMENT ON POLICY "Public can view demo league teams" ON "public"."teams" IS 'Allows anonymous users to read teams in the demo league';



CREATE POLICY "Public can view goalie GSAx" ON "public"."goalie_gsax" FOR SELECT USING (true);



CREATE POLICY "Public can view goalie primary shots GSAx" ON "public"."goalie_gsax_primary" FOR SELECT USING (true);



CREATE POLICY "Public can view league averages" ON "public"."league_averages" FOR SELECT USING (true);



CREATE POLICY "Public can view official player shifts" ON "public"."player_shifts_official" FOR SELECT USING (true);



CREATE POLICY "Public can view player directory" ON "public"."player_directory" FOR SELECT USING (true);



CREATE POLICY "Public can view player game stats" ON "public"."player_game_stats" FOR SELECT USING (true);



CREATE POLICY "Public can view player projected stats" ON "public"."player_projected_stats" FOR SELECT USING (true);



CREATE POLICY "Public can view player season stats" ON "public"."player_season_stats" FOR SELECT USING (true);



CREATE POLICY "Public can view projections" ON "public"."projections" FOR SELECT USING (true);



CREATE POLICY "Public can view raw NHL data" ON "public"."raw_nhl_data" FOR SELECT USING (true);



CREATE POLICY "Service role can insert NHL games" ON "public"."nhl_games" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can insert NHL teams" ON "public"."nhl_teams" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can insert chat logs" ON "public"."stormy_chat_log" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can insert players" ON "public"."players" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can manage player directory" ON "public"."player_directory" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can manage player game stats" ON "public"."player_game_stats" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can manage player weekly stats" ON "public"."player_weekly_stats" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can manage raw shots" ON "public"."raw_shots" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can read waitlist" ON "public"."waitlist" FOR SELECT USING (false);



CREATE POLICY "Service role can update NHL games" ON "public"."nhl_games" FOR UPDATE USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can update NHL teams" ON "public"."nhl_teams" FOR UPDATE USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role can update players" ON "public"."players" FOR UPDATE USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role full access" ON "public"."nightly_job_runs" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role writes pipeline meta" ON "public"."nhl_pipeline_meta" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role writes player playoff stats" ON "public"."player_playoff_stats" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role writes playoff seeds" ON "public"."nhl_playoff_seeds" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role writes playoff series" ON "public"."nhl_playoff_series" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "Service role writes standings" ON "public"."playoff_pool_standings" USING ((( SELECT "auth"."role"() AS "role") = 'service_role'::"text"));



CREATE POLICY "System can create roster snapshots" ON "public"."fantasy_daily_rosters" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "fantasy_daily_rosters"."team_id") AND ("teams"."league_id" = "fantasy_daily_rosters"."league_id")))));



CREATE POLICY "Team owners can delete their keeper designations" ON "public"."keeper_designations" FOR DELETE USING (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Team owners can make picks" ON "public"."draft_picks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "draft_picks"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Team owners can view their keeper designations" ON "public"."keeper_designations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "keeper_designations"."team_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can add players to their own roster" ON "public"."roster_assignments" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "roster_assignments"."team_id") AND ("t"."league_id" = "roster_assignments"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "roster_assignments"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can cancel their own pending trade offers" ON "public"."trade_offers" FOR UPDATE USING ((("status" = 'pending'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "trade_offers"."from_team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((("status" = ANY (ARRAY['pending'::"text", 'cancelled'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "trade_offers"."from_team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can cancel their own pending waiver claims" ON "public"."waiver_claims" FOR UPDATE USING ((("status" = 'pending'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "waiver_claims"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((("status" = ANY (ARRAY['pending'::"text", 'cancelled'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "waiver_claims"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can create leagues" ON "public"."leagues" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "commissioner_id"));



CREATE POLICY "Users can create trade offers from their teams" ON "public"."trade_offers" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "trade_offers"."from_team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can create waiver claims for their teams" ON "public"."waiver_claims" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "waiver_claims"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can create waiver priority for their own team" ON "public"."waiver_priority" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "waiver_priority"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("teams"."league_id" = "waiver_priority"."league_id")))));



CREATE POLICY "Users can delete their own team roster entries" ON "public"."fantasy_daily_rosters" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "fantasy_daily_rosters"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("teams"."league_id" = "fantasy_daily_rosters"."league_id")))));



CREATE POLICY "Users can insert CHAT notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((("type" = 'CHAT'::"text") AND (( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "notifications"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))) AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "notifications"."league_id") AND ("teams"."owner_id" = "notifications"."user_id"))))));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can insert their own team lineups" ON "public"."team_lineups" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."teams" "t"
     JOIN "public"."leagues" "l" ON (("t"."league_id" = "l"."id")))
  WHERE (("t"."id" = "team_lineups"."team_id") AND ("t"."league_id" = "team_lineups"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert their own transactions" ON "public"."player_transactions" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert their own transactions" ON "public"."transaction_ledger" FOR INSERT WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "transaction_ledger"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can remove players from their own roster" ON "public"."roster_assignments" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "roster_assignments"."team_id") AND ("t"."league_id" = "roster_assignments"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "roster_assignments"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can respond to trade offers sent to their teams" ON "public"."trade_offers" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "trade_offers"."to_team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'countered'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "trade_offers"."to_team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can update only their own team rosters" ON "public"."fantasy_daily_rosters" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "fantasy_daily_rosters"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("teams"."league_id" = "fantasy_daily_rosters"."league_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."id" = "fantasy_daily_rosters"."team_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("teams"."league_id" = "fantasy_daily_rosters"."league_id")))));



COMMENT ON POLICY "Users can update only their own team rosters" ON "public"."fantasy_daily_rosters" IS 'CRITICAL SECURITY: Users can only modify roster entries for their own teams, not other teams in the league.';



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own roster assignments" ON "public"."roster_assignments" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "roster_assignments"."team_id") AND ("t"."league_id" = "roster_assignments"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "roster_assignments"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "roster_assignments"."team_id") AND ("t"."league_id" = "roster_assignments"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "roster_assignments"."league_id") AND ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can update their own team lineups" ON "public"."team_lineups" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."teams" "t"
     JOIN "public"."leagues" "l" ON (("t"."league_id" = "l"."id")))
  WHERE (("t"."id" = "team_lineups"."team_id") AND ("t"."league_id" = "team_lineups"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."teams" "t"
     JOIN "public"."leagues" "l" ON (("t"."league_id" = "l"."id")))
  WHERE (("t"."id" = "team_lineups"."team_id") AND ("t"."league_id" = "team_lineups"."league_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update their own teams" ON "public"."teams" FOR UPDATE USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view draft order in their leagues" ON "public"."draft_order" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_order"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view lineups in their leagues" ON "public"."team_lineups" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues" "l"
  WHERE (("l"."id" = "team_lineups"."league_id") AND (("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams" "t"
          WHERE (("t"."league_id" = "l"."id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view matchup lines in their leagues" ON "public"."fantasy_matchup_lines" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."matchups" "m"
     JOIN "public"."leagues" "l" ON (("l"."id" = "m"."league_id")))
  WHERE (("m"."id" = "fantasy_matchup_lines"."matchup_id") AND (("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams" "t"
          WHERE (("t"."league_id" = "l"."id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view matchup scoring snapshots in their leagues" ON "public"."matchup_scoring_snapshots" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "matchup_scoring_snapshots"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view matchups in their leagues" ON "public"."matchups" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "matchups"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view own chat logs" ON "public"."stormy_chat_log" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can view picks in their leagues" ON "public"."draft_picks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "draft_picks"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view rosters in their leagues" ON "public"."fantasy_daily_rosters" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "fantasy_daily_rosters"."league_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ("league_id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid")));



COMMENT ON POLICY "Users can view rosters in their leagues" ON "public"."fantasy_daily_rosters" IS 'Users can view roster snapshots for any team in leagues they belong to (including opponents).';



CREATE POLICY "Users can view rosters in their leagues" ON "public"."roster_assignments" FOR SELECT USING ((("league_id" IN ( SELECT "t"."league_id"
   FROM "public"."teams" "t"
  WHERE ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("league_id" IN ( SELECT "l"."id"
   FROM "public"."leagues" "l"
  WHERE ("l"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("league_id" = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::"uuid")));



CREATE POLICY "Users can view scoring audit in their leagues" ON "public"."league_scoring_audit" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "league_scoring_audit"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view their own attempts" ON "public"."join_code_attempts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view their own autopick rankings" ON "public"."player_autopick_rankings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams" "t"
  WHERE (("t"."id" = "player_autopick_rankings"."team_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "notifications"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))))))));



CREATE POLICY "Users can view trade history in their leagues" ON "public"."trade_history" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "trade_history"."league_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view trade offers involving their teams" ON "public"."trade_offers" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE ((("teams"."id" = "trade_offers"."from_team_id") OR ("teams"."id" = "trade_offers"."to_team_id")) AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view transactions in their leagues" ON "public"."transaction_ledger" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "transaction_ledger"."league_id") AND (("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."teams"
          WHERE (("teams"."league_id" = "leagues"."id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Users can view waiver claims in their leagues" ON "public"."waiver_claims" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "waiver_claims"."league_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view waiver priorities in their leagues" ON "public"."waiver_priority" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "waiver_priority"."league_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view waiver status in their leagues" ON "public"."player_waiver_status" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teams"
  WHERE (("teams"."league_id" = "player_waiver_status"."league_id") AND ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users manage own bracket picks" ON "public"."playoff_bracket_picks" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users manage own confidence picks" ON "public"."playoff_confidence_picks" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users manage own roster picks" ON "public"."playoff_roster_picks" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."_backup_matchup_scores_20260811" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_ros_projections_20260811" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_deprecated_2025_Skaters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_deprecated_public.players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_deprecated_staging_2024_goalies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_deprecated_staging_2024_skaters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_deprecated_staging_2025_goalies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_deprecated_staging_2025_skaters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_preshot_rebuild_baseline" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_xg_recompute_2025" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auction_bids" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auction_bids_insert" ON "public"."auction_bids" FOR INSERT WITH CHECK (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "auction_bids_select" ON "public"."auction_bids" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."auction_budgets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auction_budgets_all" ON "public"."auction_budgets" USING (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "auction_budgets_select" ON "public"."auction_budgets" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."auction_nominations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auction_noms_insert" ON "public"."auction_nominations" FOR INSERT WITH CHECK (("nominated_by_team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "auction_noms_select" ON "public"."auction_nominations" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."auto_recovery_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "autopick_rankings_delete" ON "public"."player_autopick_rankings" FOR DELETE USING ((("team_id" IS NULL) OR ("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "autopick_rankings_insert" ON "public"."player_autopick_rankings" FOR INSERT WITH CHECK ((("team_id" IS NULL) OR ("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "autopick_rankings_select_scoped" ON "public"."player_autopick_rankings" FOR SELECT USING ((("league_id" IS NULL) OR ("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "autopick_rankings_update" ON "public"."player_autopick_rankings" FOR UPDATE USING ((("team_id" IS NULL) OR ("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "confidence_insert" ON "public"."confidence_picks" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."confidence_picks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "confidence_select" ON "public"."confidence_picks" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "confidence_update" ON "public"."confidence_picks" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."cron_job_registry" ENABLE ROW LEVEL SECURITY;





ALTER TABLE "public"."draft_order" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."draft_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."faab_budgets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "faab_budgets_all" ON "public"."faab_budgets" USING (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "faab_budgets_select" ON "public"."faab_budgets" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."failed_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fantasy_daily_rosters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fantasy_matchup_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."function_error_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "function_error_log_service_only" ON "public"."function_error_log" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."goalie_gar" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goalie_gsax" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goalie_gsax_primary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goalie_rebound_control" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goalie_xg_season" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integrity_check_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."join_code_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."keeper_designations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "keeper_insert" ON "public"."keeper_designations" FOR INSERT WITH CHECK (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "keeper_update" ON "public"."keeper_designations" FOR UPDATE USING ((("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("league_id" IN ( SELECT "leagues"."id"
   FROM "public"."leagues"
  WHERE ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."league_averages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."league_scoring_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."league_scoring_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "league_scoring_rules_read" ON "public"."league_scoring_rules" FOR SELECT USING (true);



CREATE POLICY "league_select_commissioner" ON "public"."leagues" FOR SELECT USING (("commissioner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "league_select_team_owner" ON "public"."leagues" FOR SELECT USING ("public"."user_owns_team_in_league_simple"("id"));



ALTER TABLE "public"."leagues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matchup_scoring_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matchups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_game_arena" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_games_retired_phantoms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_pipeline_meta" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_player_identity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_player_names" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_playoff_seeds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_playoff_series" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_rink_cdf" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_rink_ref_knots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_shots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nhl_xg_sql_cells" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nightly_job_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phase0c_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pipeline_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pipeline_runs_service_role_all" ON "public"."pipeline_runs" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."player_autopick_rankings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_directory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_game_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_gar_components" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_identity_bridge" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_identity_bridge_read" ON "public"."player_identity_bridge" FOR SELECT USING (true);



ALTER TABLE "public"."player_playoff_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_projected_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_projected_stats_retired_phantoms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_projections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_ros_projections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_season_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_shifts_official" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_talent_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_toi_by_situation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_waiver_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_weekly_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_xg_season" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_bracket_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_brackets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_confidence_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_pool_standings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_roster_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_seeds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."playoff_series" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."policy_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "policy_versions_read_all" ON "public"."policy_versions" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "policy_versions_service_write" ON "public"."policy_versions" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."pool_picks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pool_picks_insert" ON "public"."pool_picks" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "pool_picks_select" ON "public"."pool_picks" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "pool_picks_update" ON "public"."pool_picks" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projection_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_nhl_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_player_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_shots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_shots_rebuild" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read goalie_xg_season" ON "public"."goalie_xg_season" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read player_xg_season" ON "public"."player_xg_season" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read team_xg_season" ON "public"."team_xg_season" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."roster_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stat_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stat_catalog_read" ON "public"."stat_catalog" FOR SELECT USING (true);



ALTER TABLE "public"."stormy_chat_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survivor_insert" ON "public"."survivor_selections" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "survivor_select" ON "public"."survivor_selections" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."survivor_selections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survivor_update" ON "public"."survivor_selections" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."team_lineups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_lineups_backup_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_mapping_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_xg_season" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_select_commissioner" ON "public"."teams" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."leagues"
  WHERE (("leagues"."id" = "teams"."league_id") AND ("leagues"."commissioner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "teams_select_own" ON "public"."teams" FOR SELECT USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."trade_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_votes_insert" ON "public"."trade_votes" FOR INSERT WITH CHECK (("voter_team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "trade_votes_select" ON "public"."trade_votes" FOR SELECT USING (("league_id" IN ( SELECT "teams"."league_id"
   FROM "public"."teams"
  WHERE ("teams"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."transaction_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_privacy_consent" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_privacy_consent_select_own" ON "public"."user_privacy_consent" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "user_privacy_consent_service_all" ON "public"."user_privacy_consent" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waiver_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waiver_priority" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xg_rebuild_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xg_retrain_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "xg_retrain_log_service" ON "public"."xg_retrain_log" TO "service_role" USING (true) WITH CHECK (true);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_playoff_round"("p_bracket_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_playoff_round"("p_bracket_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_playoff_round"("p_bracket_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."aggregate_player_playoff_stats"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aggregate_player_playoff_stats"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."aggregate_player_playoff_stats_live"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aggregate_player_playoff_stats_live"("p_season" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."aggregate_player_playoff_stats_live"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_rink_adjustment"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_rink_adjustment"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_rink_adjustment_live"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_rink_adjustment_live"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_backup_before_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_backup_before_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_backup_before_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_backup_before_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_complete_matchups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_complete_matchups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_complete_matchups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_fix_integrity_issues"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_fix_integrity_issues"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_fix_integrity_issues"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_generate_playoff_bracket"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_generate_playoff_bracket"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_generate_playoff_bracket"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."autopick_next_player"("p_league_id" "uuid", "p_team_id" "uuid", "p_draft_session_id" "uuid", "p_round_number" integer, "p_pick_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."autopick_next_player"("p_league_id" "uuid", "p_team_id" "uuid", "p_draft_session_id" "uuid", "p_round_number" integer, "p_pick_number" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."autopick_next_player"("p_league_id" "uuid", "p_team_id" "uuid", "p_draft_session_id" "uuid", "p_round_number" integer, "p_pick_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."backtest_inseason_weight"("p_season" integer, "p_asof" "date", "p_w" numeric, "p_min_holdout_gp" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backtest_inseason_weight"("p_season" integer, "p_asof" "date", "p_w" numeric, "p_min_holdout_gp" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."backtest_inseason_weight"("p_season" integer, "p_asof" "date", "p_w" numeric, "p_min_holdout_gp" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."backup_team_lineups"("p_backup_name" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backup_team_lineups"("p_backup_name" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."backup_team_lineups"("p_backup_name" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_xg_sql_fold"("p_score_fold" integer, "p_m" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_xg_sql_fold"("p_score_fold" integer, "p_m" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_xg_sql_slot"("p_slot" integer, "p_mode" "text", "p_lo" integer, "p_hi" integer, "p_m" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_xg_sql_slot"("p_slot" integer, "p_mode" "text", "p_lo" integer, "p_hi" integer, "p_m" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."build_xg_sql_variant"("p_slot" integer, "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."build_xg_sql_variant"("p_slot" integer, "p_season_lo" integer, "p_season_hi" integer, "p_m" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() TO "anon";
GRANT ALL ON FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulletproof_auto_sync_team_lineup_to_daily_rosters"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_daily_matchup_scores"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_daily_matchup_scores"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_daily_matchup_scores_v2"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_daily_matchup_scores_v2"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_daily_matchup_scores_v2"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_h2h_category_matchup"("p_league_id" "uuid", "p_matchup_id" "uuid", "p_team1_id" "uuid", "p_team2_id" "uuid", "p_week_start" "date", "p_week_end" "date", "p_categories" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_h2h_category_matchup"("p_league_id" "uuid", "p_matchup_id" "uuid", "p_team1_id" "uuid", "p_team2_id" "uuid", "p_week_start" "date", "p_week_end" "date", "p_categories" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_h2h_category_matchup"("p_league_id" "uuid", "p_matchup_id" "uuid", "p_team1_id" "uuid", "p_team2_id" "uuid", "p_week_start" "date", "p_week_end" "date", "p_categories" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_implied_probability"("moneyline" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_implied_probability"("moneyline" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_implied_probability"("moneyline" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_implied_probability"("moneyline" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_matchup_total_score"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_matchup_total_score"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_ppg_standings"("p_league_id" "uuid", "p_through_week" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_ppg_standings"("p_league_id" "uuid", "p_through_week" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_ppg_standings"("p_league_id" "uuid", "p_through_week" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_roto_standings"("p_league_id" "uuid", "p_categories" "text"[], "p_through_week" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_roto_standings"("p_league_id" "uuid", "p_categories" "text"[], "p_through_week" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_roto_standings"("p_league_id" "uuid", "p_categories" "text"[], "p_through_week" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_insert_team"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_insert_team"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_audit_trail_integrity"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_audit_trail_integrity"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_boxscore_reconciliation"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_boxscore_reconciliation"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_cron_job_health"("p_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_cron_job_health"("p_hours" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_data_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_data_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_data_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_data_integrity_check1_scope"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_data_integrity_check1_scope"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_data_integrity_check1_scope"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_data_integrity_check2_scope"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_data_integrity_check2_scope"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_data_integrity_check2_scope"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_matchup_score_calibration"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_matchup_score_calibration"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_monitor_liveness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_monitor_liveness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_pipeline_coverage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_pipeline_coverage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_player_directory_freshness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_player_directory_freshness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_pool_scoring_integrity"("p_grace_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_pool_scoring_integrity"("p_grace_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_scoring_config_divergence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_scoring_config_divergence"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_season_boundary"("p_horizon_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_season_boundary"("p_horizon_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_security_drift"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_security_drift"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_stat_column_parity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_stat_column_parity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_stats_layer_freshness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_stats_layer_freshness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_waiver_priority_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_waiver_priority_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_weekly_stats_vs_source"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_weekly_stats_vs_source"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_xg_chain_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_xg_chain_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_xg_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_xg_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_xg_integrity_v2"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_xg_integrity_v2"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_expired_draft_reservations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_expired_draft_reservations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_draft_reservations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_old_audit_logs"("p_retention_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_old_audit_logs"("p_retention_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_old_backups"("p_days_to_keep" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_old_backups"("p_days_to_keep" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_backups"("p_days_to_keep" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_old_join_attempts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_old_join_attempts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_draft_and_sync"("p_league_id" "uuid", "p_draft_session_id" "uuid", "p_teams_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_draft_and_sync"("p_league_id" "uuid", "p_draft_session_id" "uuid", "p_teams_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_team_id" "uuid", "p_round_number" integer, "p_pick_number" integer, "p_user_id" "uuid", "p_draft_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_team_id" "uuid", "p_round_number" integer, "p_pick_number" integer, "p_user_id" "uuid", "p_draft_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_team_id" "uuid", "p_round_number" integer, "p_pick_number" integer, "p_user_id" "uuid", "p_draft_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_matchup_scoring_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_matchup_scoring_snapshot"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_notifications_from_transaction"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_notifications_from_transaction"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_waiver_priority_for_team"("p_league_id" "uuid", "p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_waiver_priority_for_team"("p_league_id" "uuid", "p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_waiver_priority_for_team"("p_league_id" "uuid", "p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cron_schedule_grace"("p_schedule" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cron_schedule_grace"("p_schedule" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_account"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."derive_season_from_date"("game_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."derive_season_from_date"("game_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."derive_season_from_date"("game_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_season_from_date"("game_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."derive_season_from_game_id"("game_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."derive_season_from_game_id"("game_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."derive_season_from_game_id"("game_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_season_from_game_id"("game_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."detect_and_recover_data_loss"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."detect_and_recover_data_loss"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_and_recover_data_loss"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."detect_security_anomalies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."detect_security_anomalies"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."draft_freeze_blockers"("p_upcoming_hours" integer, "p_live_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."draft_freeze_blockers"("p_upcoming_hours" integer, "p_live_hours" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_trade_deadline"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_trade_deadline"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enrich_pbp_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enrich_pbp_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."eval_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."eval_xg_exp2"("p_slot" integer, "p_pfx" "text", "p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."eval_xg_slot"("p_slot" integer, "p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."eval_xg_slot"("p_slot" integer, "p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."execute_trade"("p_trade_id" "uuid", "p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_offered_player_ids" "text"[], "p_requested_player_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."execute_trade"("p_trade_id" "uuid", "p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_offered_player_ids" "text"[], "p_requested_player_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_trade"("p_trade_id" "uuid", "p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_offered_player_ids" "text"[], "p_requested_player_ids" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_trade_offers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_trade_offers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."export_user_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."export_user_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."export_user_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."extract_shots_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."extract_shots_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fix_goalie_assists_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fix_goalie_assists_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fix_goalie_decisions_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fix_goalie_decisions_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."gate_assist_split"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."gate_assist_split"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_playoff_bracket"("p_league_id" "uuid", "p_consolation_enabled" boolean, "p_two_week_matchups" boolean, "p_reseed_each_round" boolean, "p_seeding_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_playoff_bracket"("p_league_id" "uuid", "p_consolation_enabled" boolean, "p_two_week_matchups" boolean, "p_reseed_each_round" boolean, "p_seeding_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_playoff_bracket"("p_league_id" "uuid", "p_consolation_enabled" boolean, "p_two_week_matchups" boolean, "p_reseed_each_round" boolean, "p_seeding_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_age_multiplier"("p_age" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_age_multiplier"("p_age" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_age_multiplier"("p_age" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_canonical_team_code"("p_team_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_current_pool_week"("p_on" "date", "p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_pool_week"("p_on" "date", "p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_current_season"("p_on" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_season"("p_on" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_season"("p_on" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_daily_game_stats"("p_player_ids" integer[], "p_game_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_daily_game_stats"("p_player_ids" integer[], "p_game_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_game_stats"("p_player_ids" integer[], "p_game_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_daily_lineup"("p_team_id" "uuid", "p_matchup_id" "uuid", "p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_daily_lineup"("p_team_id" "uuid", "p_matchup_id" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_lineup"("p_team_id" "uuid", "p_matchup_id" "uuid", "p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_projections"("p_player_ids" integer[], "p_target_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_effective_scoring_rules"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_effective_scoring_rules"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_effective_scoring_rules"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_keeper_draft_costs"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_keeper_draft_costs"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_keeper_draft_costs"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_latest_backup_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_latest_backup_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_backup_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_backup_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_league_teams"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_league_teams"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_league_teams"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_matchup_stats"("p_player_ids" integer[], "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_matchup_stats"("p_player_ids" integer[], "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_matchup_stats"("p_player_ids" integer[], "p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_league_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_league_ids"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_nhl_season_year"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_nhl_season_year"("p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_nhl_season_year"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_nhl_season_year"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_player_waiver_clear_time"("p_league_id" "uuid", "p_player_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_player_waiver_clear_time"("p_league_id" "uuid", "p_player_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_player_waiver_clear_time"("p_league_id" "uuid", "p_player_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_player_waiver_clear_time"("p_league_id" "uuid", "p_player_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_playoff_picture"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_playoff_picture"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_playoff_picture"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_pool_week_dates"("p_week_number" integer, "p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_pool_week_dates"("p_week_number" integer, "p_season" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pool_week_dates"("p_week_number" integer, "p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_projection_target_season"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_projection_target_season"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_season_game_count"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_season_game_count"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_trending_players"("days_back" integer, "limit_count" integer, "position_filter" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_trending_players"("days_back" integer, "limit_count" integer, "position_filter" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_trending_players"("days_back" integer, "limit_count" integer, "position_filter" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_consent_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_consent_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_consent_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_waiver_processing_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_waiver_processing_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_waiver_processing_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_waiver_processing_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."heal_directory_for_rostered_players"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."heal_directory_for_rostered_players"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_commissioner_of_league"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_commissioner_of_league"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_commissioner_of_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_commissioner_of_league"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_player_on_waivers"("p_league_id" "uuid", "p_player_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_player_on_waivers"("p_league_id" "uuid", "p_player_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_player_on_waivers"("p_league_id" "uuid", "p_player_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_player_on_waivers"("p_league_id" "uuid", "p_player_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_league_with_code"("p_join_code" "text", "p_user_id" "uuid", "p_team_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_league_with_code"("p_join_code" "text", "p_user_id" "uuid", "p_team_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_league_with_code"("p_join_code" "text", "p_user_id" "uuid", "p_team_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_team_lineups_backups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_team_lineups_backups"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_team_lineups_backups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_team_lineups_backups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."load_player_names_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."load_player_names_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_keepers_for_season"("p_league_id" "uuid", "p_season_year" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_keepers_for_season"("p_league_id" "uuid", "p_season_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_keepers_for_season"("p_league_id" "uuid", "p_season_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_audit_trail_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_audit_trail_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_boxscore_reconciliation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_boxscore_reconciliation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_cron_job_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_cron_job_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_function_error"("p_fn" "text", "p_sqlstate" "text", "p_message" "text", "p_context" "text", "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_function_error"("p_fn" "text", "p_sqlstate" "text", "p_message" "text", "p_context" "text", "p_details" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_function_error"("p_fn" "text", "p_sqlstate" "text", "p_message" "text", "p_context" "text", "p_details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_league_scoring_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_league_scoring_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_matchup_score_calibration"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_matchup_score_calibration"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_monitor_liveness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_monitor_liveness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_pipeline_coverage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_pipeline_coverage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_player_directory_freshness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_player_directory_freshness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_pool_scoring_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_pool_scoring_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_scoring_config_divergence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_scoring_config_divergence"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_season_boundary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_season_boundary"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_security_anomalies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_security_anomalies"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_security_drift"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_security_drift"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_security_event"("p_event_type" "text", "p_league_id" "uuid", "p_details" "jsonb", "p_severity" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_security_event"("p_event_type" "text", "p_league_id" "uuid", "p_details" "jsonb", "p_severity" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_security_event"("p_event_type" "text", "p_league_id" "uuid", "p_details" "jsonb", "p_severity" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_settings_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_settings_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_stat_column_parity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_stat_column_parity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_waiver_priority_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_waiver_priority_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_weekly_stats_vs_source"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_weekly_stats_vs_source"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_xg_chain_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_xg_chain_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_xg_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_xg_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_xg_integrity_v2"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_xg_integrity_v2"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."make_draft_pick"("p_league_id" "uuid", "p_team_id" "uuid", "p_player_id" "text", "p_round_number" integer, "p_pick_number" integer, "p_draft_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."make_draft_pick"("p_league_id" "uuid", "p_team_id" "uuid", "p_player_id" "text", "p_round_number" integer, "p_pick_number" integer, "p_draft_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."make_draft_pick"("p_league_id" "uuid", "p_team_id" "uuid", "p_player_id" "text", "p_round_number" integer, "p_pick_number" integer, "p_draft_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."manual_recover_team"("p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."manual_recover_team"("p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."manual_recover_team"("p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."materialize_scoring_settings"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."materialize_scoring_settings"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."nightly_xg_pipeline"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."nightly_xg_pipeline"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_league_members"("p_league_id" "uuid", "p_title" "text", "p_message" "text", "p_notification_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_league_members"("p_league_id" "uuid", "p_title" "text", "p_message" "text", "p_notification_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_league_members"("p_league_id" "uuid", "p_title" "text", "p_message" "text", "p_notification_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_league_on_transaction"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_league_on_transaction"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."nuclear_reset_draft"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."nuclear_reset_draft"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."nuclear_reset_draft"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."optimize_best_ball_daily_rosters"("p_league_id" "uuid", "p_roster_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."optimize_best_ball_daily_rosters"("p_league_id" "uuid", "p_roster_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."optimize_best_ball_daily_rosters"("p_league_id" "uuid", "p_roster_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_matchup_lines"("p_matchup_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_matchup_lines"("p_matchup_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."populate_league_averages"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."populate_league_averages"("p_season" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_league_averages"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."populate_player_weekly_stats"("p_week_number" integer, "p_week_start_date" "date", "p_week_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."populate_player_weekly_stats"("p_week_number" integer, "p_week_start_date" "date", "p_week_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_player_weekly_stats"("p_week_number" integer, "p_week_start_date" "date", "p_week_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_all_faab_waivers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_all_faab_waivers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_all_pending_waivers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_all_pending_waivers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_expired_trade_reviews"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_expired_trade_reviews"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_faab_waivers_for_league"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_faab_waivers_for_league"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_roster_move"("p_league_id" "uuid", "p_user_id" "uuid", "p_drop_player_id" "text", "p_add_player_id" "text", "p_transaction_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_roster_move"("p_league_id" "uuid", "p_user_id" "uuid", "p_drop_player_id" "text", "p_add_player_id" "text", "p_transaction_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_roster_move"("p_league_id" "uuid", "p_user_id" "uuid", "p_drop_player_id" "text", "p_add_player_id" "text", "p_transaction_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_waiver_claims"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_waiver_claims"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_ros"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_ros"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."propagate_playoff_series_winner"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."propagate_playoff_series_winner"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_goalie_gsax_primary"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_goalie_gsax_primary"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_player_identity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_player_identity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_player_projected_stats"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_player_projected_stats"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_player_season_stats"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_player_season_stats"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_player_talent_metrics"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_player_talent_metrics"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_pp_sh_points"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_pp_sh_points"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_ros_projections"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_ros_projections"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalculate_reverse_standings_priority"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_reverse_standings_priority"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_reverse_standings_priority"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_pp_goals_with_boxscore"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_pp_goals_with_boxscore"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_player_transaction"("p_player_id" integer, "p_league_id" "uuid", "p_team_id" "uuid", "p_transaction_type" "text", "p_source" "text", "p_player_name" "text", "p_player_team" "text", "p_player_position" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_player_transaction"("p_player_id" integer, "p_league_id" "uuid", "p_team_id" "uuid", "p_transaction_type" "text", "p_source" "text", "p_player_name" "text", "p_player_team" "text", "p_player_position" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_rebuild_audit"("p_season" integer, "p_gate_name" "text", "p_expected" bigint, "p_actual" bigint, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_rebuild_audit"("p_season" integer, "p_gate_name" "text", "p_expected" bigint, "p_actual" bigint, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_rebuild_band"("p_season" integer, "p_gate_name" "text", "p_lo" bigint, "p_hi" bigint, "p_actual" bigint, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_rebuild_band"("p_season" integer, "p_gate_name" "text", "p_lo" bigint, "p_hi" bigint, "p_actual" bigint, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_user_consent"("p_policy_type" "text", "p_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_user_consent"("p_policy_type" "text", "p_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_user_consent"("p_policy_type" "text", "p_version" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_player_rollups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_player_rollups"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_reverse_standings_waiver_order"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_reverse_standings_waiver_order"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_xg_season_layer"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_xg_season_layer"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."renumber_waiver_priority"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."renumber_waiver_priority"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reseed_waiver_priority_for_league"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reseed_waiver_priority_for_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reseed_waiver_priority_for_league"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_user_id" "uuid", "p_duration_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_user_id" "uuid", "p_duration_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_draft_pick"("p_league_id" "uuid", "p_player_id" "text", "p_user_id" "uuid", "p_duration_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_playoff_bracket"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_playoff_bracket"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_playoff_bracket"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_pp_goals_by_penalty_window"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_pp_goals_by_penalty_window"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_team_lineups"("p_backup_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_team_lineups"("p_backup_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_team_lineups"("p_backup_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rink_cdf_season_for"("p_home_team" integer, "p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rink_cdf_season_for"("p_home_team" integer, "p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_data_retention"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_data_retention"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_full_autopick_draft"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_full_autopick_draft"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_full_autopick_draft"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_weekly_stats_populate"("p_anchor" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_weekly_stats_populate"("p_anchor" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_all_playoff_roster_pools"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_all_playoff_roster_pools"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."score_all_playoff_roster_pools"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_all_pools_for_week"("p_week_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_all_pools_for_week"("p_week_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_confidence_week"("p_league_id" "uuid", "p_week_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_confidence_week"("p_league_id" "uuid", "p_week_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_matchup_lines"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_matchup_lines"("p_matchup_id" "uuid", "p_team_id" "uuid", "p_week_start" "date", "p_week_end" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_pickem_week"("p_league_id" "uuid", "p_week_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_pickem_week"("p_league_id" "uuid", "p_week_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_playoff_roster_pool"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_playoff_roster_pool"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_playoff_series_picks"("p_series_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_playoff_series_picks"("p_series_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."score_playoff_series_picks"("p_series_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_pools_pending"("p_max_weeks" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_pools_pending"("p_max_weeks" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_survivor_week"("p_league_id" "uuid", "p_week_number" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_survivor_week"("p_league_id" "uuid", "p_week_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_xg_sql"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_xg_sql"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."score_xg_sql_v2"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."score_xg_sql_v2"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."scoring_rules_to_jsonb"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scoring_rules_to_jsonb"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_faab_budgets_for_league"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_faab_budgets_for_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_faab_budgets_for_league"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_waiver_priority_for_league"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_waiver_priority_for_league"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_league_chat_message"("p_league_id" "uuid", "p_message" "text", "p_sender_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_league_chat_message"("p_league_id" "uuid", "p_message" "text", "p_sender_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_league_chat_message"("p_league_id" "uuid", "p_message" "text", "p_sender_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."shares_league_with"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shares_league_with"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shares_league_with"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."should_process_waivers_now"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."should_process_waivers_now"() TO "anon";
GRANT ALL ON FUNCTION "public"."should_process_waivers_now"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."should_process_waivers_now"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."smart_restore_all_teams"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."smart_restore_team_lineups"("p_team_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."smart_restore_team_lineups"("p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."smart_restore_team_lineups"("p_team_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_trade_vote"("p_trade_offer_id" "uuid", "p_voter_team_id" "uuid", "p_vote" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_trade_vote"("p_trade_offer_id" "uuid", "p_voter_team_id" "uuid", "p_vote" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_trade_vote"("p_trade_offer_id" "uuid", "p_voter_team_id" "uuid", "p_vote" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_goalie_decisions"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_goalie_decisions"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_goalie_shutouts"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_goalie_shutouts"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_new_team_lineup_to_daily_rosters"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_new_team_lineup_to_daily_rosters"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_new_team_lineup_to_daily_rosters"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_new_team_lineup_to_daily_rosters"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_playoff_scores"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_playoff_scores"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_roster_assignments_for_league"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_roster_assignments_for_league"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_roster_assignments_for_league"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_rules_to_scoring_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_rules_to_scoring_settings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_scoring_settings_to_rules"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_scoring_settings_to_rules"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_reseed_waiver_priority_on_setting_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_reseed_waiver_priority_on_setting_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_seed_faab_budgets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_seed_faab_budgets"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_seed_waiver_priority_for_new_team"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_seed_waiver_priority_for_new_team"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trade_move_player_lineup"("p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_pid" "text", "p_now" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trade_move_player_lineup"("p_league_id" "uuid", "p_from_team_id" "uuid", "p_to_team_id" "uuid", "p_pid" "text", "p_now" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."unpack_and_gate_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unpack_and_gate_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."unpack_boxscore_season"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unpack_boxscore_season"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_all_matchup_scores"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_all_matchup_scores"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_all_matchup_scores"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_implied_probabilities"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_implied_probabilities"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_implied_probabilities"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_implied_probabilities"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_player_projected_stats_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_player_projected_stats_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_projected_stats_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_projected_stats_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_player_projections_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_player_projections_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_projections_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_projections_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_player_talent_metrics_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_player_talent_metrics_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_player_talent_metrics_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_player_talent_metrics_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_playoff_series_from_games"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_playoff_series_from_games"("p_season" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_playoff_series_from_games"("p_season" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_roster_assignments_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_roster_assignments_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_roster_assignments_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_roster_assignments_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_owns_team_in_league_simple"("p_league_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_owns_team_in_league_simple"("p_league_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_owns_team_in_league_simple"("p_league_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_owns_team_in_league_simple"("p_league_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_keeper_selections"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_keeper_selections"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_keeper_selections"("p_league_id" "uuid", "p_team_id" "uuid", "p_season_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_league_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_league_settings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_matchup_score"("p_score" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_matchup_score"("p_score" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."validate_matchup_score"("p_score" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_matchup_score"("p_score" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_matchup_scores_before_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_matchup_scores_before_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_matchup_scores_before_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_matchup_scores_before_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_team_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_team_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_team_lineups_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_team_lineups_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_team_lineups_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_team_lineups_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_matchup_scores"("p_matchup_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_matchup_scores"("p_matchup_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_matchup_scores"("p_matchup_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."withdraw_user_consent"("p_policy_type" "text", "p_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_user_consent"("p_policy_type" "text", "p_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."withdraw_user_consent"("p_policy_type" "text", "p_version" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."xg_scorecard"("p_season" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."xg_scorecard"("p_season" integer) TO "service_role";



GRANT ALL ON TABLE "public"."_backup_matchup_scores_20260811" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_ros_projections_20260811" TO "service_role";



GRANT ALL ON TABLE "public"."_deprecated_2025_Skaters" TO "service_role";



GRANT ALL ON TABLE "public"."_deprecated_public.players" TO "service_role";



GRANT ALL ON TABLE "public"."_deprecated_staging_2024_goalies" TO "service_role";



GRANT ALL ON TABLE "public"."_deprecated_staging_2024_skaters" TO "service_role";



GRANT ALL ON TABLE "public"."_deprecated_staging_2025_goalies" TO "service_role";



GRANT ALL ON TABLE "public"."_deprecated_staging_2025_skaters" TO "service_role";



GRANT ALL ON TABLE "public"."_preshot_rebuild_baseline" TO "service_role";



GRANT ALL ON TABLE "public"."_xg_recompute_2025" TO "service_role";



GRANT SELECT ON TABLE "public"."auction_bids" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auction_bids" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_bids" TO "service_role";



GRANT SELECT ON TABLE "public"."auction_budgets" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auction_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_budgets" TO "service_role";



GRANT SELECT ON TABLE "public"."auction_nominations" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auction_nominations" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_nominations" TO "service_role";



GRANT SELECT ON TABLE "public"."auto_recovery_log" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."auto_recovery_log" TO "authenticated";
GRANT ALL ON TABLE "public"."auto_recovery_log" TO "service_role";



GRANT SELECT ON TABLE "public"."confidence_picks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."confidence_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."confidence_picks" TO "service_role";



GRANT ALL ON TABLE "public"."cron_job_registry" TO "service_role";



GRANT SELECT ON TABLE "public"."leagues" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."leagues" TO "authenticated";
GRANT ALL ON TABLE "public"."leagues" TO "service_role";



GRANT SELECT ON TABLE "public"."roster_assignments" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."roster_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."roster_assignments" TO "service_role";



GRANT SELECT ON TABLE "public"."teams" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."current_rosters" TO "anon";
GRANT ALL ON TABLE "public"."current_rosters" TO "authenticated";
GRANT ALL ON TABLE "public"."current_rosters" TO "service_role";



GRANT SELECT ON TABLE "public"."draft_order" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."draft_order" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_order" TO "service_role";



GRANT SELECT ON TABLE "public"."draft_picks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."draft_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."draft_picks" TO "service_role";



GRANT SELECT ON TABLE "public"."faab_budgets" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."faab_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."faab_budgets" TO "service_role";



GRANT SELECT ON TABLE "public"."failed_transactions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."failed_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."failed_transactions" TO "service_role";



GRANT SELECT ON TABLE "public"."fantasy_daily_rosters" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."fantasy_daily_rosters" TO "authenticated";
GRANT ALL ON TABLE "public"."fantasy_daily_rosters" TO "service_role";



GRANT SELECT ON TABLE "public"."fantasy_matchup_lines" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."fantasy_matchup_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."fantasy_matchup_lines" TO "service_role";



GRANT ALL ON TABLE "public"."function_error_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."function_error_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."function_error_log_id_seq" TO "service_role";



GRANT SELECT ON TABLE "public"."goalie_gar" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."goalie_gar" TO "authenticated";
GRANT ALL ON TABLE "public"."goalie_gar" TO "service_role";



GRANT SELECT ON TABLE "public"."goalie_gsax" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."goalie_gsax" TO "authenticated";
GRANT ALL ON TABLE "public"."goalie_gsax" TO "service_role";



GRANT SELECT ON TABLE "public"."goalie_gsax_primary" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."goalie_gsax_primary" TO "authenticated";
GRANT ALL ON TABLE "public"."goalie_gsax_primary" TO "service_role";



GRANT SELECT ON TABLE "public"."goalie_rebound_control" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."goalie_rebound_control" TO "authenticated";
GRANT ALL ON TABLE "public"."goalie_rebound_control" TO "service_role";



GRANT ALL ON TABLE "public"."goalie_xg_season" TO "service_role";
GRANT SELECT ON TABLE "public"."goalie_xg_season" TO "authenticated";



GRANT SELECT ON TABLE "public"."integrity_check_results" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."integrity_check_results" TO "authenticated";
GRANT ALL ON TABLE "public"."integrity_check_results" TO "service_role";



GRANT SELECT ON TABLE "public"."join_code_attempts" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."join_code_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."join_code_attempts" TO "service_role";



GRANT SELECT ON TABLE "public"."keeper_designations" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."keeper_designations" TO "authenticated";
GRANT ALL ON TABLE "public"."keeper_designations" TO "service_role";



GRANT SELECT ON TABLE "public"."league_averages" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."league_averages" TO "authenticated";
GRANT ALL ON TABLE "public"."league_averages" TO "service_role";



GRANT SELECT ON TABLE "public"."league_scoring_audit" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."league_scoring_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."league_scoring_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."league_scoring_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."league_scoring_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."league_scoring_audit_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."league_scoring_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."league_scoring_rules" TO "service_role";



GRANT SELECT ON TABLE "public"."matchup_scoring_snapshots" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."matchup_scoring_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."matchup_scoring_snapshots" TO "service_role";



GRANT SELECT ON TABLE "public"."matchups" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."matchups" TO "authenticated";
GRANT ALL ON TABLE "public"."matchups" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_game_arena" TO "service_role";



GRANT SELECT ON TABLE "public"."nhl_games" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."nhl_games" TO "authenticated";
GRANT ALL ON TABLE "public"."nhl_games" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_games_retired_phantoms" TO "service_role";



GRANT SELECT ON TABLE "public"."nhl_pipeline_meta" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."nhl_pipeline_meta" TO "authenticated";
GRANT ALL ON TABLE "public"."nhl_pipeline_meta" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_player_identity" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_player_names" TO "service_role";



GRANT SELECT ON TABLE "public"."nhl_playoff_seeds" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."nhl_playoff_seeds" TO "authenticated";
GRANT ALL ON TABLE "public"."nhl_playoff_seeds" TO "service_role";



GRANT SELECT ON TABLE "public"."nhl_playoff_series" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."nhl_playoff_series" TO "authenticated";
GRANT ALL ON TABLE "public"."nhl_playoff_series" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_rink_cdf" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_rink_ref_knots" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_shots" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_shot_features" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_shot_fold" TO "service_role";



GRANT SELECT ON TABLE "public"."nhl_teams" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."nhl_teams" TO "authenticated";
GRANT ALL ON TABLE "public"."nhl_teams" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_xg_sql_cells" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_xg_sql_keys" TO "service_role";



GRANT ALL ON TABLE "public"."nhl_xg_sql_keys_exp" TO "service_role";



GRANT SELECT ON TABLE "public"."nightly_job_runs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."nightly_job_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."nightly_job_runs" TO "service_role";



GRANT SELECT ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT INSERT,DELETE,UPDATE ON TABLE "public"."phase0c_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."phase0c_progress" TO "service_role";



GRANT SELECT ON TABLE "public"."pipeline_runs" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."pipeline_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_runs" TO "service_role";



GRANT SELECT ON TABLE "public"."player_autopick_rankings" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_autopick_rankings" TO "authenticated";
GRANT ALL ON TABLE "public"."player_autopick_rankings" TO "service_role";



GRANT SELECT ON TABLE "public"."player_game_stats" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_game_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."player_game_stats" TO "service_role";



GRANT INSERT,DELETE,UPDATE ON TABLE "public"."player_season_totals" TO "authenticated";
GRANT ALL ON TABLE "public"."player_season_totals" TO "service_role";



GRANT INSERT,DELETE,UPDATE ON TABLE "public"."player_career_totals" TO "authenticated";
GRANT ALL ON TABLE "public"."player_career_totals" TO "service_role";



GRANT SELECT ON TABLE "public"."player_directory" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_directory" TO "authenticated";
GRANT ALL ON TABLE "public"."player_directory" TO "service_role";



GRANT SELECT ON TABLE "public"."player_gar_components" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_gar_components" TO "authenticated";
GRANT ALL ON TABLE "public"."player_gar_components" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_identity_bridge" TO "authenticated";
GRANT ALL ON TABLE "public"."player_identity_bridge" TO "service_role";



GRANT SELECT ON TABLE "public"."player_playoff_stats" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_playoff_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."player_playoff_stats" TO "service_role";



GRANT SELECT ON TABLE "public"."player_projected_stats" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_projected_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."player_projected_stats" TO "service_role";



GRANT ALL ON TABLE "public"."player_projected_stats_retired_phantoms" TO "service_role";



GRANT SELECT ON TABLE "public"."player_projections" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_projections" TO "authenticated";
GRANT ALL ON TABLE "public"."player_projections" TO "service_role";



GRANT SELECT ON TABLE "public"."player_ros_projections" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_ros_projections" TO "authenticated";
GRANT ALL ON TABLE "public"."player_ros_projections" TO "service_role";



GRANT SELECT ON TABLE "public"."player_season_stats" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_season_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."player_season_stats" TO "service_role";



GRANT SELECT ON TABLE "public"."player_shifts" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."player_shifts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."player_shifts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."player_shifts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."player_shifts_id_seq" TO "service_role";



GRANT SELECT ON TABLE "public"."player_shifts_official" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_shifts_official" TO "authenticated";
GRANT ALL ON TABLE "public"."player_shifts_official" TO "service_role";



GRANT SELECT ON TABLE "public"."player_talent_metrics" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_talent_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."player_talent_metrics" TO "service_role";



GRANT SELECT ON TABLE "public"."player_toi_by_situation" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_toi_by_situation" TO "authenticated";
GRANT ALL ON TABLE "public"."player_toi_by_situation" TO "service_role";



GRANT ALL ON SEQUENCE "public"."player_toi_by_situation_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."player_toi_by_situation_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."player_toi_by_situation_id_seq" TO "service_role";



GRANT SELECT ON TABLE "public"."player_transactions" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."player_transactions" TO "service_role";



GRANT SELECT ON TABLE "public"."player_waiver_status" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."player_waiver_status" TO "authenticated";
GRANT ALL ON TABLE "public"."player_waiver_status" TO "service_role";



GRANT SELECT ON TABLE "public"."player_weekly_stats" TO "anon";
GRANT SELECT ON TABLE "public"."player_weekly_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."player_weekly_stats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."player_weekly_stats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."player_weekly_stats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."player_weekly_stats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."player_xg_season" TO "service_role";
GRANT SELECT ON TABLE "public"."player_xg_season" TO "authenticated";



GRANT ALL ON TABLE "public"."players" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_bracket_picks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_bracket_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_bracket_picks" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_brackets" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_brackets" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_brackets" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_confidence_picks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_confidence_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_confidence_picks" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_pool_standings" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_pool_standings" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_pool_standings" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_roster_picks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_roster_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_roster_picks" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_seeds" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_seeds" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_seeds" TO "service_role";



GRANT SELECT ON TABLE "public"."playoff_series" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."playoff_series" TO "authenticated";
GRANT ALL ON TABLE "public"."playoff_series" TO "service_role";



GRANT ALL ON TABLE "public"."policy_versions" TO "service_role";
GRANT SELECT ON TABLE "public"."policy_versions" TO "anon";
GRANT SELECT ON TABLE "public"."policy_versions" TO "authenticated";



GRANT SELECT ON TABLE "public"."pool_picks" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."pool_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."pool_picks" TO "service_role";



GRANT SELECT ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT ON TABLE "public"."projection_cache" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."projection_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."projection_cache" TO "service_role";



GRANT SELECT ON TABLE "public"."projections" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."projections" TO "authenticated";
GRANT ALL ON TABLE "public"."projections" TO "service_role";



GRANT ALL ON SEQUENCE "public"."public.players_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."public.players_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."public.players_id_seq" TO "service_role";



GRANT SELECT ON TABLE "public"."raw_nhl_data" TO "anon";
GRANT SELECT ON TABLE "public"."raw_nhl_data" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_nhl_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."raw_nhl_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."raw_nhl_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."raw_nhl_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."raw_player_stats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."raw_player_stats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."raw_player_stats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."raw_player_stats_id_seq" TO "service_role";



GRANT SELECT ON TABLE "public"."raw_shots" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."raw_shots" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_shots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."raw_shots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."raw_shots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."raw_shots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."raw_shots_rebuild" TO "service_role";



GRANT SELECT ON TABLE "public"."security_audit_log" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."security_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."security_audit_log" TO "service_role";



GRANT SELECT ON TABLE "public"."stat_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."stat_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."stat_catalog" TO "anon";



GRANT SELECT ON TABLE "public"."stormy_chat_log" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."stormy_chat_log" TO "authenticated";
GRANT ALL ON TABLE "public"."stormy_chat_log" TO "service_role";



GRANT SELECT ON TABLE "public"."survivor_selections" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."survivor_selections" TO "authenticated";
GRANT ALL ON TABLE "public"."survivor_selections" TO "service_role";



GRANT SELECT ON TABLE "public"."team_lineups" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."team_lineups" TO "authenticated";
GRANT ALL ON TABLE "public"."team_lineups" TO "service_role";



GRANT SELECT ON TABLE "public"."team_lineups_backup_log" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."team_lineups_backup_log" TO "authenticated";
GRANT ALL ON TABLE "public"."team_lineups_backup_log" TO "service_role";



GRANT SELECT ON TABLE "public"."team_mapping_config" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."team_mapping_config" TO "authenticated";
GRANT ALL ON TABLE "public"."team_mapping_config" TO "service_role";



GRANT ALL ON TABLE "public"."team_stats" TO "service_role";



GRANT ALL ON TABLE "public"."team_xg_season" TO "service_role";
GRANT SELECT ON TABLE "public"."team_xg_season" TO "authenticated";



GRANT SELECT ON TABLE "public"."trade_history" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."trade_history" TO "authenticated";
GRANT ALL ON TABLE "public"."trade_history" TO "service_role";



GRANT SELECT ON TABLE "public"."trade_offers" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."trade_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."trade_offers" TO "service_role";



GRANT SELECT ON TABLE "public"."trade_votes" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."trade_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."trade_votes" TO "service_role";



GRANT SELECT ON TABLE "public"."transaction_ledger" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."transaction_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."transaction_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."user_privacy_consent" TO "service_role";
GRANT SELECT ON TABLE "public"."user_privacy_consent" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."v_player_game_stat_long" TO "authenticated";
GRANT ALL ON TABLE "public"."v_player_game_stat_long" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."waitlist" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist" TO "service_role";



GRANT SELECT ON TABLE "public"."waiver_claims" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."waiver_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."waiver_claims" TO "service_role";



GRANT SELECT ON TABLE "public"."waiver_priority" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."waiver_priority" TO "authenticated";
GRANT ALL ON TABLE "public"."waiver_priority" TO "service_role";



GRANT ALL ON TABLE "public"."xg_rebuild_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."xg_rebuild_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."xg_rebuild_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."xg_retrain_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."xg_retrain_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."xg_retrain_log_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






