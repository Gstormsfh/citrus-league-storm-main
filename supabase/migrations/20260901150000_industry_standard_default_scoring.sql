-- ============================================================================
-- INDUSTRY-STANDARD DEFAULT SCORING (2026-09-01)
-- ============================================================================
-- The founder's hankering, confirmed and fixed. Citrus's default point values
-- (G3 A2 PPP1 SHP2 SOG0.4 BLK0.5 HIT0.2 PIM+0.5 / W4 SO3 SV0.2 GA-1) matched
-- no major platform, undervalued goals relative to peripherals, and REWARDED
-- penalty minutes. New defaults align with Yahoo Fantasy Hockey's default
-- points scoring (help.yahoo.com/kb/SLN6815):
--
--   Skater: goals 6, assists 4, PPP 2, SOG 0.9, blocks 1
--           SHP 0, hits 0, PIM 0  (opt-in categories, not default scoring)
--   Goalie: wins 5, shutouts 5, saves 0.6, goals against -3
--
-- Documented deviation: Yahoo defaults plus/minus to 2; Citrus ships it at 0
-- because the projection engine cannot model +/- and a default category the
-- projections ignore would make every projected total quietly wrong.
--
-- Blast radius (verified against prod 2026-09-01 before writing this):
--   * Every existing fantasy league has a COMPLETE scoring_settings snapshot
--     (55 leagues: 51 complete, 4 NULL — all four are pool leagues that never
--     touch skater/goalie scoring) and its own league_scoring_rules rows.
--     Existing leagues are pinned; NOTHING about their scoring changes.
--   * Only the four pool leagues inherit the zero-UUID global rules → safe.
--   * The league-agnostic projection tables (player_ros_projections,
--     player_projected_stats) are rebuilt nightly by RPCs that HARDCODE the
--     default weights — those RPCs are updated below, and both rebuilds must
--     be fired after this migration applies so stored totals rescale at once.
--
-- GOALIE GA OMISSION FIX (same change, same reason): project_ros() carried no
-- goals-against rate, so rebuild_ros_projections and
-- rebuild_player_projected_stats scored goalies as W+SV+SO with GA silently
-- omitted — a ~55-start starter was overstated by ~137 pts even under GA-1.
-- Under GA-3 the omission would triple and put backup goalies above elite
-- wingers, which is exactly the autodraft-goalies-first failure mode. This
-- migration adds the GA rate to project_ros and the GA term (and a
-- projected_ga_ros column) to both rebuilds.
--
-- NOT touched here (verified unreachable, left for hygiene follow-up): the
-- COALESCE fallback literals inside calculate_daily_matchup_scores,
-- get_daily_lineup, optimize_best_ball_daily_rosters and
-- score_playoff_roster_pool still carry old values, but they only fire when a
-- league's scoring_settings jsonb is missing a key, and every scored league
-- has a complete snapshot (asserted above and enforced by all three creation
-- paths). Regenerating four scoring-critical functions for dead branches is
-- risk without benefit.
--
-- ADDENDUM 2026-09-03 (read before writing the hygiene migration): the
-- CURRENT production bodies of those four functions are not in this
-- directory. Production's schema_migrations shows they were last rewritten by
-- prod-only versions (20260806165042, 20260806182816, 20260812034614,
-- 20260812044603, 20260812161109) whose files never landed in the repo; the
-- latest repo versions (20260418230000, 20260514150000) are not in prod's
-- history table. A CREATE OR REPLACE authored from the repo bodies would
-- silently revert the 0F-SCORE LEFT JOIN / season-from-game_id fixes and the
-- best-ball date scoping. Staging is behind in the other direction: it has
-- not received this migration at all (stat_catalog still carries the old
-- multipliers). The only faithful text of the live functions is
-- supabase/schema/production_snapshot_20260813.sql. Author the literal swap
-- from a fresh pg_get_functiondef capture at apply time, per
-- docs/PROD_CHANGE_LEDGER.md Rules 1-2, after bringing staging to parity.
-- The "4 NULL" above was measured 2026-09-01; on 2026-09-03 it was 0 of 55.
-- ============================================================================

-- ── 1. stat_catalog: the authoritative default multipliers ──────────────────
UPDATE public.stat_catalog SET default_multiplier = v.m
FROM (VALUES
  ('goals',               6.0),
  ('assists',             4.0),
  ('power_play_points',   2.0),
  ('short_handed_points', 0.0),
  ('shots_on_goal',       0.9),
  ('blocks',              1.0),
  ('hits',                0.0),
  ('penalty_minutes',     0.0),
  ('wins',                5.0),
  ('shutouts',            5.0),
  ('saves',               0.6),
  ('goals_against',      -3.0)
) AS v(stat_key, m)
WHERE stat_catalog.stat_key = v.stat_key;

-- ── 2. Global default league_scoring_rules (zero-UUID league) ───────────────
-- Only the four pool leagues inherit these; every fantasy league has its own
-- pinned rows (verified 2026-09-01).
UPDATE public.league_scoring_rules SET multiplier = v.m, updated_at = now()
FROM (VALUES
  ('goals',               6.0),
  ('assists',             4.0),
  ('power_play_points',   2.0),
  ('short_handed_points', 0.0),
  ('shots_on_goal',       0.9),
  ('blocks',              1.0),
  ('hits',                0.0),
  ('penalty_minutes',     0.0),
  ('wins',                5.0),
  ('shutouts',            5.0),
  ('saves',               0.6),
  ('goals_against',      -3.0)
) AS v(stat_key, m)
WHERE league_scoring_rules.league_id = '00000000-0000-0000-0000-000000000000'
  AND league_scoring_rules.stat_key = v.stat_key;

-- ── 3. leagues.scoring_settings column default (new rows only) ──────────────
-- Existing rows keep their stored jsonb — a column default never rewrites
-- existing data. Mirrored verbatim by scoringDefaults.equivalence.test.ts.
ALTER TABLE public.leagues
  ALTER COLUMN scoring_settings SET DEFAULT '{
    "goalie": {"wins": 5, "saves": 0.6, "shutouts": 5, "goals_against": -3},
    "skater": {"hits": 0, "goals": 6, "blocks": 1, "assists": 4,
               "plus_minus": 0, "shots_on_goal": 0.9, "penalty_minutes": 0,
               "power_play_points": 2, "short_handed_points": 0},
    "advanced": {"assist_per_goal_ratio": 0.0, "use_fractional_scoring": false,
                 "shooting_percentage_bonus": 0.0}
  }'::jsonb;

-- ── 4. player_ros_projections gains the goalie GA projection ────────────────
ALTER TABLE public.player_ros_projections
  ADD COLUMN IF NOT EXISTS projected_ga_ros numeric DEFAULT 0;

COMMENT ON COLUMN public.player_ros_projections.projected_ga_ros IS
  'Projected goals against over remaining starts (goalies; 0 for skaters). Added 2026-09-01 — GA was previously omitted from goalie point totals entirely.';

-- ── 5. project_ros: add the goals-against rate (r_ga) ───────────────────────
-- Byte-identical to the prod definition except the four GA additions (hist,
-- agg, means, final select) and the appended r_ga output column. The return
-- type changes, so DROP first (CREATE OR REPLACE cannot alter OUT columns).
-- Verified 2026-09-01: no views or early-bound SQL functions depend on it —
-- both consumers (rebuild_ros_projections, rebuild_player_projected_stats)
-- are plpgsql and late-bound.
DROP FUNCTION IF EXISTS public.project_ros(integer);

CREATE OR REPLACE FUNCTION public.project_ros(p_season integer)
 RETURNS TABLE(player_id integer, is_goalie boolean, position_code text, age integer, exp_gp integer, exp_starts integer, r_goal numeric, r_a numeric, r_sog numeric, r_blk numeric, r_ppp numeric, r_shp numeric, r_hits numeric, r_pim numeric, r_pm numeric, r_wins numeric, r_saves numeric, r_so numeric, r_ga numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           sum(coalesce(pgs.nhl_goals_against,0))::numeric ga,
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
           sum(wt*wins) wwins, sum(wt*saves) wsaves, sum(wt*so) wso,
           sum(wt*ga) wga, sum(wt*ggp) wggp,
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
           sum(wso)/nullif(sum(wggp),0) m_so,
           sum(wga)/nullif(sum(wggp),0) m_ga
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
         ((g.wso    + 10*coalesce(m.m_so,0))   /(g.wggp+10))::numeric,
         ((g.wga    + 10*coalesce(m.m_ga,0))   /(g.wggp+10))::numeric
    from grp2 g join means m on m.pos_group=g.pos_group
   where g.raw_gp >= 1;
$function$;

-- DROP discarded the hardened ACL (prod: postgres + service_role only) and
-- CREATE hands a SECURITY DEFINER function to PUBLIC by default — which
-- would expose /rest/v1/rpc/project_ros to anon and trip
-- check_security_drift(). Restore the exact prod grants.
REVOKE ALL ON FUNCTION public.project_ros(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_ros(integer) TO service_role;

-- ── 6. rebuild_ros_projections: new weights + the GA term ───────────────────
-- Identical to 20260820151500 (AUTOPICK-GHOSTS filter retained) except:
-- industry-standard multipliers, GA included in goalie totals, and
-- projected_ga_ros written. Zero-weighted categories (SHP/hits/PIM) keep
-- explicit *0.0 terms so the weights stay greppable and guard-testable.
CREATE OR REPLACE FUNCTION public.rebuild_ros_projections(p_season integer)
 RETURNS TABLE(rows_written integer, skaters integer, goalies integer, target_games integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    projected_ga_ros,
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
         case when r.is_goalie then round(r.r_ga*r.rem_starts,2) else 0 end,
         -- INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned weights.
         -- GA now included — it was silently omitted before, overstating
         -- every goalie. SHP/hits/PIM are zero-weighted by default.
         case when r.is_goalie then
           round(r.r_wins*r.rem_starts*5.0 + r.r_saves*r.rem_starts*0.6
               + r.r_so*r.rem_starts*5.0 + r.r_ga*r.rem_starts*(-3.0),2)
         else
           round(r.r_goal*r.rem_gp*6.0 + r.r_a*r.rem_gp*4.0 + r.r_ppp*r.rem_gp*2.0
               + r.r_shp*r.rem_gp*0.0 + r.r_sog*r.rem_gp*0.9 + r.r_blk*r.rem_gp*1.0
               + r.r_hits*r.rem_gp*0.0 + r.r_pim*r.rem_gp*0.0,2) end,
         -- per-game rates are rates: unchanged by how many games remain
         case when r.is_goalie then
           round(r.r_wins*5.0 + r.r_saves*0.6 + r.r_so*5.0 + r.r_ga*(-3.0),3)
         else round(r.r_goal*6.0 + r.r_a*4.0 + r.r_ppp*2.0 + r.r_shp*0.0
                  + r.r_sog*0.9 + r.r_blk*1.0 + r.r_hits*0.0 + r.r_pim*0.0,3) end,
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
    ) pt2 on true
    -- AUTOPICK-GHOSTS (2026-08-20): draftable = known to the directory.
    where exists (
      select 1 from player_directory pd3 where pd3.player_id = r.player_id
    );

  get diagnostics v_rows = row_count;
  select count(*) filter (where not is_goalie), count(*) filter (where is_goalie)
    into v_sk, v_go from player_ros_projections where season=p_season;
  return query select v_rows, v_sk, v_go, v_games;
end;
$function$;

-- ── 7. rebuild_player_projected_stats: new weights + the GA term ────────────
-- Identical to the prod definition (pulled 2026-09-01) except: industry-
-- standard multipliers in base_mu/mu/sd, pr.r_ga threaded through, and
-- projected_goals_against now written from the GA rate instead of literal 0.
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

-- ── 8. populate_league_averages: rescale the avg_ppg baseline ───────────────
-- Identical to 20260105000000 except the avg_ppg weight line. The per-stat
-- rate columns are weight-free and unchanged. SHP/hits/PIM keep explicit
-- *0.0 terms.
CREATE OR REPLACE FUNCTION public.populate_league_averages(
  p_season INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path TO 'public'
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
    -- INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned weights.
    SELECT
      COUNT(*)::INTEGER,
      COALESCE(AVG(
        CASE
          WHEN pss.games_played > 0 THEN
            (pss.goals * 6.0 + pss.primary_assists * 4.0 + pss.secondary_assists * 4.0 +
             pss.shots_on_goal * 0.9 + pss.blocks * 1.0 +
             pss.ppp * 2.0 + pss.shp * 0.0 + pss.hits * 0.0 + pss.pim * 0.0) / pss.games_played::NUMERIC
          ELSE 0
        END
      ), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.goals::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN (pss.primary_assists + pss.secondary_assists)::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.shots_on_goal::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.blocks::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
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

    -- Upsert league average for this position
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

-- ── 9. backtest_inseason_weight: keep the research tool truthful ────────────
-- Prediction AND holdout-actual now both score with the new default weights
-- (the tool stays self-consistent; the measured in-season weight of 15 was
-- fit under the old weights and can be re-measured with this).
CREATE OR REPLACE FUNCTION public.backtest_inseason_weight(p_season integer, p_asof date, p_w numeric, p_min_holdout_gp integer DEFAULT 10)
 RETURNS TABLE(n_players integer, rmse numeric, mae numeric, corr numeric, mean_actual numeric, mean_pred numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
           ( ((g.wg   + 20*m.m_goal)/(g.wgp+20)  * g.am) * 6.0
           + ((g.wa   + 10*m.m_a)   /(g.wgp+10)  * g.am) * 4.0
           + ((g.wppp + 10*m.m_ppp) /(g.wgp+10)  * g.am) * 2.0
           + ((g.wshp + 10*m.m_shp) /(g.wgp+10)  * g.am) * 0.0
           + ((g.wsog + 10*m.m_sog) /(g.wgp+10)  * g.am) * 0.9
           + ((g.wblk + 15*m.m_blk) /(g.wgp+15)  * g.am) * 1.0
           + ((g.whits+  8*m.m_hits)/(g.wgp+8)   * g.am) * 0.0
           + ((g.wpim + 20*m.m_pim) /(g.wgp+20)  * g.am) * 0.0 ) AS pred_fppg
      FROM grp2 g JOIN means m ON m.pos_group=g.pos_group
     WHERE g.raw_gp >= 1
  ),
  actual AS (
    SELECT pgs.player_id, count(*)::numeric hold_gp,
           ( sum(pgs.nhl_goals)*6.0 + sum(pgs.nhl_assists)*4.0 + sum(pgs.nhl_ppp)*2.0
           + sum(pgs.nhl_shp)*0.0 + sum(pgs.nhl_shots_on_goal)*0.9 + sum(pgs.nhl_blocks)*1.0
           + sum(pgs.nhl_hits)*0.0 + sum(pgs.nhl_pim)*0.0 ) / count(*)::numeric AS act_fppg
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
$function$;

-- ── 10. Fail-loud verification ──────────────────────────────────────────────
-- A partial apply of this migration is worse than no apply. Assert every
-- home landed before committing.
DO $verify$
DECLARE
  bad int;
  src text;
BEGIN
  SELECT count(*) INTO bad FROM public.stat_catalog sc
   WHERE (sc.stat_key, sc.default_multiplier) NOT IN (
     ('goals',6.0),('assists',4.0),('power_play_points',2.0),
     ('short_handed_points',0.0),('shots_on_goal',0.9),('blocks',1.0),
     ('hits',0.0),('penalty_minutes',0.0),('wins',5.0),('shutouts',5.0),
     ('saves',0.6),('goals_against',-3.0))
     AND sc.stat_key IN ('goals','assists','power_play_points',
       'short_handed_points','shots_on_goal','blocks','hits',
       'penalty_minutes','wins','shutouts','saves','goals_against');
  IF bad > 0 THEN
    RAISE EXCEPTION 'stat_catalog defaults did not land (% rows off)', bad;
  END IF;

  SELECT count(*) INTO bad FROM public.league_scoring_rules r
   WHERE r.league_id = '00000000-0000-0000-0000-000000000000'
     AND r.stat_key IN ('goals','wins','saves','goals_against')
     AND (r.stat_key, r.multiplier) NOT IN
         (('goals',6.0),('wins',5.0),('saves',0.6),('goals_against',-3.0));
  IF bad > 0 THEN
    RAISE EXCEPTION 'global league_scoring_rules did not land (% rows off)', bad;
  END IF;

  SELECT prosrc INTO src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rebuild_ros_projections';
  IF src NOT LIKE '%r.r_ga%' OR src NOT LIKE '%(-3.0)%' OR src NOT LIKE '%*0.9%' THEN
    RAISE EXCEPTION 'rebuild_ros_projections is not the GA-aware industry-standard version';
  END IF;

  SELECT prosrc INTO src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='project_ros';
  IF src NOT LIKE '%m_ga%' THEN
    RAISE EXCEPTION 'project_ros does not expose the GA rate';
  END IF;

  SELECT prosrc INTO src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rebuild_player_projected_stats';
  IF src NOT LIKE '%pr.r_ga%' OR src NOT LIKE '%(-3.0)%' THEN
    RAISE EXCEPTION 'rebuild_player_projected_stats is not the GA-aware industry-standard version';
  END IF;
END
$verify$;

