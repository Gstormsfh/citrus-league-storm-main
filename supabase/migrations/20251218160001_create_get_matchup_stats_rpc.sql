-- Fast matchup-week aggregation for a set of players.
-- This is used by the Matchup UI to avoid pulling thousands of player_game_stats rows client-side.

create or replace function public.get_matchup_stats(
  p_player_ids int[],
  p_start_date date,
  p_end_date date
)
returns table (
  player_id int,
  goals bigint,
  assists bigint,
  points bigint,
  shots_on_goal bigint,
  hits bigint,
  blocks bigint,
  pim bigint,
  ppp bigint,
  shp bigint,
  plus_minus bigint,
  goalie_gp bigint,
  wins bigint,
  saves bigint,
  goals_against bigint,
  shots_faced bigint,
  shutouts bigint,
  x_goals numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pgs.player_id,
    sum(pgs.goals)::bigint as goals,
    sum(pgs.primary_assists + pgs.secondary_assists)::bigint as assists,
    sum(pgs.points)::bigint as points,
    sum(pgs.shots_on_goal)::bigint as shots_on_goal,
    sum(pgs.hits)::bigint as hits,
    sum(pgs.blocks)::bigint as blocks,
    sum(pgs.pim)::bigint as pim,
    sum(pgs.ppp)::bigint as ppp,
    sum(pgs.shp)::bigint as shp,
    sum(pgs.plus_minus)::bigint as plus_minus,
    sum(pgs.goalie_gp)::bigint as goalie_gp,
    sum(pgs.wins)::bigint as wins,
    sum(pgs.saves)::bigint as saves,
    sum(pgs.goals_against)::bigint as goals_against,
    sum(pgs.shots_faced)::bigint as shots_faced,
    sum(pgs.shutouts)::bigint as shutouts,
    coalesce((
      select sum(coalesce(rs.shooting_talent_adjusted_xg, rs.flurry_adjusted_xg, rs.xg_value, 0))
      from public.raw_shots rs
      inner join public.player_game_stats pgs2 on rs.game_id = pgs2.game_id
      where rs.player_id = pgs.player_id
        and pgs2.game_date >= p_start_date
        and pgs2.game_date <= p_end_date
    ), 0)::numeric as x_goals
  from public.player_game_stats pgs
  where
    pgs.player_id = any(p_player_ids)
    and pgs.game_date >= p_start_date
    and pgs.game_date <= p_end_date
  group by pgs.player_id;
$$;

revoke all on function public.get_matchup_stats(int[], date, date) from public;
grant execute on function public.get_matchup_stats(int[], date, date) to anon, authenticated;


