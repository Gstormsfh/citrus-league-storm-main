-- ============================================================================
-- rebuild_ros_projections(): union project_rookies() into the writer of record
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   public.rebuild_ros_projections(integer) is REPLACED. Exactly one line
--   changes: the source of the `r` CTE goes from
--       from public.project_ros(p_season) p
--   to
--       from (select * from public.project_ros(p_season)
--             union all
--             select * from public.project_rookies(p_season)) p
--   Nothing else is touched -- the delete, the column list, the team-games
--   scaling, the Yahoo-aligned weights, the directory-membership filter and
--   the returned diagnostics are byte-identical.
--
-- (b) WHY
--   project_rookies (migration 20260911070000) is inert without this. It is
--   the function that gives the 320 players with no recent NHL history a
--   projection; rebuild_ros_projections is the only thing that writes
--   player_ros_projections, and nightly_projection_batch.py:546 is the only
--   thing that calls it. Without the union, the rookie class stays blank and
--   the new function is decoration.
--
-- (c) SAFETY -- verified on production 2026-09-11, read-only
--   The two functions are EXACTLY COMPLEMENTARY over the directory:
--     project_ros(2026)            1,361 rows
--     project_rookies(2026)          320 rows
--     overlap                          0
--     directory rows covered by neither 0
--   so UNION ALL cannot double-count and cannot leave a hole. This was not
--   true of the first cut of project_rookies, which excluded on "never
--   played an NHL game" and left 18 veterans -- last NHL game older than
--   project_ros's four-season window -- projected by nothing. That is why
--   20260911070000 excludes on the window instead.
--
--   Row counts are equal-arity and same-order by construction:
--   project_rookies declares the identical RETURNS TABLE list as
--   project_ros. If either signature ever changes, this UNION fails loudly
--   at rebuild time rather than silently mis-mapping columns.
--
--   The directory-membership filter at the bottom of the insert
--   (`where exists (select 1 from player_directory pd3 ...)`) still applies
--   to both branches. project_rookies only ever emits directory members, so
--   it is a no-op for that branch.
--
-- (d) ORDER OF APPLICATION
--   Apply 20260911070000 (project_rookies) BEFORE this file. This migration
--   references that function and will fail cleanly if it is absent.
--
-- (e) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11.
--
-- Reversibility: CREATE OR REPLACE with `from public.project_ros(p_season) p`
--   restored. No schema or data change; the next nightly rebuild repopulates.
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

BEGIN;

DO $require$
BEGIN
  IF to_regprocedure('public.project_rookies(integer)') IS NULL THEN
    RAISE EXCEPTION 'public.project_rookies(integer) is missing; apply 20260911070000_project_rookies.sql first';
  END IF;
END $require$;

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
      -- ROOKIES (2026-09-11): project_ros filters raw_gp >= 1 and so can never
      -- emit a player with no recent NHL history. project_rookies covers
      -- exactly that complement -- verified disjoint (overlap 0) and complete
      -- (directory rows covered by neither: 0) on 2026. Same RETURNS TABLE
      -- shape, so a future signature change fails here loudly rather than
      -- mis-mapping columns.
      from (select * from public.project_ros(p_season)
            union all
            select * from public.project_rookies(p_season)) p
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
         case when r.is_goalie then
           round(r.r_wins*r.rem_starts*5.0 + r.r_saves*r.rem_starts*0.6
               + r.r_so*r.rem_starts*5.0 + r.r_ga*r.rem_starts*(-3.0),2)
         else
           round(r.r_goal*r.rem_gp*6.0 + r.r_a*r.rem_gp*4.0 + r.r_ppp*r.rem_gp*2.0
               + r.r_shp*r.rem_gp*0.0 + r.r_sog*r.rem_gp*0.9 + r.r_blk*r.rem_gp*1.0
               + r.r_hits*r.rem_gp*0.0 + r.r_pim*r.rem_gp*0.0,2) end,
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
    where exists (
      select 1 from player_directory pd3 where pd3.player_id = r.player_id
    );

  get diagnostics v_rows = row_count;
  select count(*) filter (where not is_goalie), count(*) filter (where is_goalie)
    into v_sk, v_go from player_ros_projections where season=p_season;
  return query select v_rows, v_sk, v_go, v_games;
end;
$function$;

COMMIT;
