-- ============================================================================
-- CONFIDENCE LABEL CASE (2026-09-01)
-- ============================================================================
-- rebuild_player_projected_stats wrote confidence_label as 'high' / 'medium'
-- / 'low' / 'unknown' while the Python nightly (projection_uncertainty.py
-- confidence_label_for) and every UI check (PlayerCard.tsx, ProjectionTooltip
-- .tsx: `=== 'High'`, `=== 'Medium'`) use 'High' / 'Medium' / 'Low'. Rows
-- produced by the SQL rebuild therefore rendered as the orange "Low" badge
-- regardless of confidence. Found during the confidence recalibration; the
-- 66,024 live rows from the 2026-09-01 rebuild were relabelled in place
-- (initcap) at 21:57Z, and this migration makes the function agree with the
-- rest of the system. 'unknown' (mu <= 0) becomes 'Low' — the vocabulary has
-- no fourth badge and the UI treats anything else as Low anyway.
--
-- Body is otherwise byte-identical to 20260901150000 §7.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rebuild_player_projected_stats(p_season integer)
 RETURNS TABLE(rows_written integer, players integer, games integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- GA is a rate, not fantasy production: the home/B2B multiplier is a
    -- points multiplier (applied to mu below), so the per-stat column
    -- carries the unadjusted rate — a home game must not project MORE GA.
    case when x.is_goalie then round(x.r_ga, 4) else 0 end,
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
    -- CONFIDENCE LABEL CASE (2026-09-01): the app's vocabulary is
    -- 'High' / 'Medium' / 'Low' (see projection_uncertainty.py
    -- confidence_label_for and PlayerCard.tsx). Lowercase here rendered
    -- every SQL-built row as the Low badge.
    case when x.mu <= 0 then 'Low'
         when x.sd / nullif(x.mu,0) < 0.65 then 'High'
         when x.sd / nullif(x.mu,0) < 0.85 then 'Medium'
         else 'Low' end,
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
      pr.r_hits, pr.r_pim, pr.r_wins, pr.r_saves, pr.r_so, pr.r_ga,
      -- INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned weights,
      -- GA included for goalies (previously omitted). Zero-weighted
      -- categories keep explicit *0.0 terms for greppability.
      (case when pr.is_goalie
            then pr.r_wins*5.0 + pr.r_saves*0.6 + pr.r_so*5.0 + pr.r_ga*(-3.0)
            else pr.r_goal*6.0 + pr.r_a*4.0 + pr.r_ppp*2.0 + pr.r_shp*0.0
               + pr.r_sog*0.9 + pr.r_blk*1.0 + pr.r_hits*0.0 + pr.r_pim*0.0
       end)::numeric as base_mu,
      ((case when pr.is_goalie
            then pr.r_wins*5.0 + pr.r_saves*0.6 + pr.r_so*5.0 + pr.r_ga*(-3.0)
            else pr.r_goal*6.0 + pr.r_a*4.0 + pr.r_ppp*2.0 + pr.r_shp*0.0
               + pr.r_sog*0.9 + pr.r_blk*1.0 + pr.r_hits*0.0 + pr.r_pim*0.0 end)
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
               then pr.r_wins*5.0 + pr.r_saves*0.6 + pr.r_so*5.0 + pr.r_ga*(-3.0)
               else pr.r_goal*6.0 + pr.r_a*4.0 + pr.r_ppp*2.0 + pr.r_shp*0.0
                  + pr.r_sog*0.9 + pr.r_blk*1.0 + pr.r_hits*0.0 + pr.r_pim*0.0 end)
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
$function$;

DO $verify$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rebuild_player_projected_stats';
  IF src LIKE '%''unknown''%' OR src LIKE '%then ''high''%' THEN
    RAISE EXCEPTION 'rebuild_player_projected_stats still writes lowercase confidence labels';
  END IF;
END
$verify$;
