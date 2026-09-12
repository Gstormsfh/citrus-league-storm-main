CREATE OR REPLACE FUNCTION public.calculate_daily_matchup_scores_v2(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS TABLE(roster_date date, daily_score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d::date as roster_date,
         coalesce((select round(sum(sl.points),3)
                     from public.score_matchup_lines(p_matchup_id,p_team_id,p_week_start,p_week_end) sl
                    where sl.roster_date = d::date), 0) as daily_score
    from generate_series(p_week_start, p_week_end, '1 day'::interval) d;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_h2h_category_matchup(p_league_id uuid, p_matchup_id uuid, p_team1_id uuid, p_team2_id uuid, p_week_start date, p_week_end date, p_categories text[])
 RETURNS TABLE(category text, team1_value numeric, team2_value numeric, winner text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.calculate_matchup_total_score(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_score NUMERIC(10, 3) := 0;
BEGIN
  -- Sum the daily scores from calculate_daily_matchup_scores_v2.
  --
  -- 2026-09-03: this used to read calculate_daily_matchup_scores, which
  -- hardcodes twelve categories in its DECLARE block. The matchup page and
  -- the persisted box-score lines both score through
  -- get_effective_scoring_rules, which serves all 35 rows of stat_catalog.
  -- Reading the legacy function here meant the stored scoreboard number and
  -- the line items behind it were produced by different engines, and the
  -- scoreboard could not see any of the 23 categories outside the twelve -
  -- plus_minus among them, which seven live leagues price at 0.5.
  --
  -- _v2 sums score_matchup_lines, the same relation persist_matchup_lines
  -- rolls up, so the scoreboard is now the sum of its own box score by
  -- construction rather than by coincidence.
  SELECT COALESCE(SUM(daily_score), 0) INTO v_total_score
  FROM calculate_daily_matchup_scores_v2(p_matchup_id, p_team_id, p_week_start, p_week_end);

  RETURN v_total_score;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_effective_scoring_rules(p_league_id uuid)
 RETURNS TABLE(stat_key text, multiplier numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.stat_key,
         coalesce(lr.multiplier, dr.multiplier, c.default_multiplier) as multiplier
    from stat_catalog c
    left join league_scoring_rules lr
      on lr.stat_key = c.stat_key and lr.league_id = p_league_id
    left join league_scoring_rules dr
      on dr.stat_key = c.stat_key
     and dr.league_id = '00000000-0000-0000-0000-000000000000'::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.persist_matchup_lines(p_matchup_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.score_matchup_lines(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS TABLE(roster_date date, player_id integer, is_goalie boolean, points numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_all_matchup_scores(p_league_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(matchup_id uuid, team1_id uuid, team2_id uuid, team1_score numeric, team2_score numeric, updated boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matchup RECORD;
  v_team1_score NUMERIC(10, 3);
  v_team2_score NUMERIC(10, 3);
  v_error_count INTEGER := 0;
  v_cats TEXT[];
BEGIN
  IF p_league_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
    RAISE EXCEPTION 'League % does not exist', p_league_id;
  END IF;

  -- Every matchup whose week has started (completed + in progress), with
  -- the league's format and category list alongside.
  FOR v_matchup IN
    SELECT m.id, m.league_id, m.team1_id, m.team2_id, m.week_start_date, m.week_end_date,
           l.settings->>'scoringFormat' AS scoring_format,
           l.settings->'categories'    AS categories
    FROM matchups m
    JOIN leagues l ON l.id = m.league_id
    WHERE (p_league_id IS NULL OR m.league_id = p_league_id)
      AND m.week_start_date <= CURRENT_DATE
    ORDER BY m.week_end_date DESC, m.id
  LOOP
    BEGIN
      IF v_matchup.scoring_format = 'h2h-categories' THEN
        -- CATEGORIES: the score is categories won, ties half each.
        v_cats := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_matchup.categories, '[]'::jsonb)));
        IF v_matchup.team2_id IS NULL OR v_cats IS NULL OR array_length(v_cats, 1) IS NULL THEN
          -- A bye week, or a league with no categories configured: nothing to
          -- compare. Zero, never a points total pretending to be a category.
          v_team1_score := 0;
          v_team2_score := 0;
        ELSE
          SELECT
            COALESCE(SUM(CASE r.winner WHEN 'team1' THEN 1 WHEN 'tie' THEN 0.5 ELSE 0 END), 0),
            COALESCE(SUM(CASE r.winner WHEN 'team2' THEN 1 WHEN 'tie' THEN 0.5 ELSE 0 END), 0)
          INTO v_team1_score, v_team2_score
          FROM calculate_h2h_category_matchup(
            v_matchup.league_id, v_matchup.id, v_matchup.team1_id, v_matchup.team2_id,
            v_matchup.week_start_date, v_matchup.week_end_date, v_cats
          ) r;
        END IF;
      ELSE
        -- POINTS (the previous body, verbatim).
        SELECT calculate_matchup_total_score(
          v_matchup.id, v_matchup.team1_id, v_matchup.week_start_date, v_matchup.week_end_date
        ) INTO v_team1_score;
        IF v_team1_score IS NULL THEN
          v_team1_score := 0;
        END IF;

        IF v_matchup.team2_id IS NOT NULL THEN
          SELECT calculate_matchup_total_score(
            v_matchup.id, v_matchup.team2_id, v_matchup.week_start_date, v_matchup.week_end_date
          ) INTO v_team2_score;
          IF v_team2_score IS NULL THEN
            v_team2_score := 0;
          END IF;
        ELSE
          v_team2_score := 0;
        END IF;
      END IF;

      UPDATE matchups
      SET team1_score = v_team1_score,
          team2_score = v_team2_score,
          updated_at = NOW()
      WHERE id = v_matchup.id;

      RETURN QUERY SELECT v_matchup.id, v_matchup.team1_id, v_matchup.team2_id, v_team1_score, v_team2_score, true;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      RAISE WARNING 'Error updating matchup %: %', v_matchup.id, SQLERRM;
      RETURN QUERY SELECT v_matchup.id, v_matchup.team1_id, v_matchup.team2_id, 0::NUMERIC(10, 3), 0::NUMERIC(10, 3), false;
    END;
  END LOOP;

  IF v_error_count > 0 THEN
    RAISE WARNING 'update_all_matchup_scores completed with % errors', v_error_count;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_matchup_scores(p_matchup_id uuid)
 RETURNS TABLE(team1_calculated numeric, team1_stored numeric, team2_calculated numeric, team2_stored numeric, is_calibrated boolean, discrepancy_team1 numeric, discrepancy_team2 numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
