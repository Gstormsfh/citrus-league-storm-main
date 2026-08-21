-- 2026-08-20 — AUTOPICK-GHOSTS fix. Applied live to prod via MCP
-- apply_migration on 2026-08-20 (~15:15Z); this file is the repo's
-- source of truth for it. Staging has no rebuild_ros_projections (its
-- projections were seeded once by scripts/staging/04-load-stats-data.mjs
-- and carry 0 ghosts, which is why 139 staging drafts never hit this).
--
-- INCIDENT: the 08:50Z daily rebuild (pg_cron job "rebuild-ros-projections")
-- inserted projections for every player project_ros() has rates for,
-- including 310 players absent from player_directory (retired / AHL /
-- departed goalies - Matt Murray, Louis Domingue, Alex Stalock, Ilya
-- Samsonov...). Goalie scoring inflates their per-game rates above elite
-- skaters, and with no directory row they bypass the autopick
-- roster-shape guard (E118 reads positions FROM the directory; missing =
-- uncapped) and render as raw "#8475839"-style IDs in every client (the
-- player pool is directory-backed). Measured in prod: the first
-- production draft (league DACOSTA!, 2026-08-20 14:26Z) autopicked 22
-- ghosts in 28 picks.
--
-- FIX: membership filter (WHERE EXISTS against player_directory, ANY
-- season) at the single choke point before the table. 2026-only would
-- drop real players the smaller 2026 refresh (817 rows vs 1,901 union)
-- has not reached yet. Verified same day: the patched rebuild writes
-- 1,051 rows (946 skaters / 105 goalies), 0 ghosts. Everything else is
-- byte-identical to the prior version.

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
