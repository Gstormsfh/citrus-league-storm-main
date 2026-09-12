-- Production read-only definition: get_projection_target_season
CREATE OR REPLACE FUNCTION public.get_projection_target_season()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select max(season)::int from nhl_games;
$function$;

-- Production read-only definition: get_season_game_count
CREATE OR REPLACE FUNCTION public.get_season_game_count(p_season integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Production read-only definition: project_rookies
CREATE OR REPLACE FUNCTION public.project_rookies(p_season integer)
 RETURNS TABLE(player_id integer, is_goalie boolean, position_code text, age integer, exp_gp integer, exp_starts integer, r_goal numeric, r_a numeric, r_sog numeric, r_blk numeric, r_ppp numeric, r_shp numeric, r_hits numeric, r_pim numeric, r_pm numeric, r_wins numeric, r_saves numeric, r_so numeric, r_ga numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with scale as (select public.get_season_game_count(p_season)::numeric / 82.0 k),
  opportunity(slot, gp, starts) as (values
    (1, 23.9, 0.0),
    (2, 10.9, 0.0),
    (3,  4.3, 1.5)
  ),
  rate(pos_group, band, g, a, sog, blk, ppp, hits, pim) as (values
    ('F',1, 0.2703, 0.3871, 2.3050, 0.4150, 0.1636, 0.7000, 0.3290),
    ('F',2, 0.1772, 0.2778, 2.0830, 0.3330, 0.1231, 0.5080, 0.3240),
    ('F',3, 0.1538, 0.2185, 1.6050, 0.3920, 0.0385, 0.8890, 0.3290),
    ('F',4, 0.1429, 0.2185, 1.5710, 0.3780, 0.0287, 0.9440, 0.2890),
    ('F',5, 0.1027, 0.1428, 1.3330, 0.4180, 0.0000, 0.9760, 0.2500),
    ('F',6, 0.1027, 0.1428, 1.1790, 0.4430, 0.0000, 1.0000, 0.2780),
    ('F',7, 0.1027, 0.1067, 1.0000, 0.3700, 0.0000, 1.2380, 0.2860),
    ('D',1, 0.1098, 0.3333, 1.7140, 1.3540, 0.0999, 1.0250, 0.4440),
    ('D',2, 0.0838, 0.2470, 1.3400, 1.1110, 0.0999, 1.1260, 0.4960),
    ('D',3, 0.0732, 0.2286, 1.2441, 1.2650, 0.0294, 1.0000, 0.4180),
    ('D',4, 0.0450, 0.1865, 1.2441, 1.0000, 0.0169, 0.9840, 0.3140),
    ('D',5, 0.0328, 0.1707, 1.0983, 1.1040, 0.0000, 1.1710, 0.3750),
    ('D',6, 0.0000, 0.1707, 1.0983, 1.0990, 0.0000, 0.9380, 0.2180),
    ('D',7, 0.0000, 0.1250, 1.0000, 1.0000, 0.0000, 1.0000, 0.3230)
  ),
  cand as (
    select pd.player_id, pd.position_code, pd.is_goalie, pd.birthdate,
           (pd.career->'draft'->>'overall')::int overall
    from player_directory pd
    where pd.season = p_season
      and not exists (select 1 from player_game_stats pgs
                      where pgs.player_id = pd.player_id
                        and substring(pgs.game_id::text,5,2) = '02'
                        and substring(pgs.game_id::text,1,4)::int
                            between p_season - 3 and p_season)
  ),
  b as (
    select c.*,
      case when c.is_goalie or c.position_code='G' then 'G'
           when c.position_code='D' then 'D' else 'F' end pos_group,
      case when c.overall is null then 3
           when c.overall <= 15 then 1
           when c.overall <= 31 then 2
           else 3 end slot,
      case when c.overall is null then 7
           when c.overall <=   5 then 1
           when c.overall <=  10 then 2
           when c.overall <=  15 then 3
           when c.overall <=  31 then 4
           when c.overall <=  62 then 5
           when c.overall <= 100 then 6
           else 7 end rate_band
    from cand c
  )
  select
    b.player_id,
    (b.pos_group='G') as is_goalie,
    coalesce(b.position_code, case when b.pos_group='G' then 'G' else 'C' end),
    extract(year from age(make_date(p_season,10,1), b.birthdate))::int,
    greatest(0, round(o.gp * s.k))::int as exp_gp,
    case when b.pos_group='G' then greatest(0, round(o.starts * s.k))::int else 0 end as exp_starts,
    coalesce(r.g,   0)::numeric, coalesce(r.a,   0)::numeric,
    coalesce(r.sog, 0)::numeric, coalesce(r.blk, 0)::numeric,
    coalesce(r.ppp, 0)::numeric,
    case when b.pos_group='G' then 0.0004::numeric
         when b.pos_group='D' then 0.0040::numeric else 0.0082::numeric end,
    coalesce(r.hits,0)::numeric, coalesce(r.pim, 0)::numeric,
    case when b.pos_group='G' then 0::numeric
         when b.pos_group='D' then -0.0232::numeric else -0.0185::numeric end,
    case when b.pos_group='G' then 0.406::numeric  else 0::numeric end,
    case when b.pos_group='G' then 25.00::numeric  else 0::numeric end,
    case when b.pos_group='G' then 0.0574::numeric else 0::numeric end,
    case when b.pos_group='G' then 2.576::numeric  else 0::numeric end
  from b
  cross join scale s
  join opportunity o on o.slot = b.slot
  left join rate r on r.pos_group = b.pos_group and r.band = b.rate_band;
$function$;

-- Production read-only definition: project_ros
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
  -- GP FALLBACK (2026-09-11): on this season's roster? Only then may a
  -- missing prior season fall back to the last one actually played.
  cur as (select distinct pd.player_id from player_directory pd where pd.season = p_season),
  agg as (
    select player_id, bool_or(is_goalie) is_goalie,
           sum(wt*gp) wgp, sum(wt*g) wg, sum(wt*xg) wxg, sum(wt*a) wa,
           sum(wt*sog) wsog, sum(wt*blk) wblk, sum(wt*ppp) wppp, sum(wt*shp) wshp,
           sum(wt*hits) whits, sum(wt*pim) wpim, sum(wt*pm) wpm,
           sum(wt*wins) wwins, sum(wt*saves) wsaves, sum(wt*so) wso,
           sum(wt*ga) wga, sum(wt*ggp) wggp,
           sum(gp) raw_gp,
           max(case when season = p_season-1 then gp else 0 end) gp_prev,
           max(case when season = p_season-1 then ggp else 0 end) ggp_prev,
           (array_agg(gp  order by season desc) filter (where gp  > 0))[1] gp_recent,
           (array_agg(ggp order by season desc) filter (where ggp > 0))[1] ggp_recent
      from w group by 1),
  bd as (select distinct on (player_id) player_id, birthdate
           from player_directory where birthdate is not null order by player_id, season desc),
  grp as (
    select a.*,
           case when a.gp_prev > 0 then a.gp_prev
                when c.player_id is not null then coalesce(a.gp_recent, 0)
                else 0 end as gp_last,
           case when a.ggp_prev > 0 then a.ggp_prev
                when c.player_id is not null then coalesce(a.ggp_recent, 0)
                else 0 end as ggp_last,
           coalesce((select pd.position_code from player_directory pd
                      where pd.player_id=a.player_id order by pd.season desc limit 1),
                    case when a.is_goalie then 'G' else 'C' end) as position_code,
           extract(year from age(make_date(p_season,10,1), bd.birthdate))::int as age
      from agg a
      left join bd on bd.player_id=a.player_id
      left join cur c on c.player_id=a.player_id),
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

-- Production read-only definition: rebuild_player_projected_stats
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

-- Production read-only definition: rebuild_ros_projections
CREATE OR REPLACE FUNCTION public.rebuild_ros_projections(p_season integer)
 RETURNS TABLE(rows_written integer, skaters integer, goalies integer, target_games integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_games int; v_rows int; v_sk int; v_go int;
  v_sched_teams int; v_covered_teams int; v_bad text;
begin
  v_games := public.get_season_game_count(p_season);
  if v_games is null or v_games < 1 then
    raise exception 'get_season_game_count(%) returned %', p_season, v_games;
  end if;

  delete from player_ros_projections;

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
           greatest(0, least(v_games, round(
             (p.exp_gp::numeric / v_games) * coalesce(tr.games_left, v_games))))::int as rem_gp,
           greatest(0, least(v_games, round(
             (p.exp_starts::numeric / v_games) * coalesce(tr.games_left, v_games))))::int as rem_starts
      from (select * from public.project_ros(p_season)
            union all
            select * from public.project_rookies(p_season)) p
      left join played pl on pl.player_id = p.player_id
      left join pt     on pt.player_id = p.player_id
      left join team_rem tr on tr.abbrev = pt.team_abbrev
  ),
  -- CREASE ALLOCATION. Unchanged from 20260911090000; see that file's header
  -- for the measured shape, the depth-ordering backtest and the exact-
  -- telescoping argument.
  crease_shape(depth_rank, w) as (values
    (1, 0.5499::numeric), (2, 0.3300::numeric), (3, 0.0578::numeric), (4, 0.0190::numeric)
  ),
  goalie_history as (
    select pgs.player_id,
           sum(case substring(pgs.game_id::text,1,4)::int
                 when p_season     then 15.0
                 when p_season - 1 then  5.0
                 when p_season - 2 then  3.0
                 else                    2.0
               end)::numeric as w_ggp
      from player_game_stats pgs
     where substring(pgs.game_id::text,5,2) = '02'
       and substring(pgs.game_id::text,1,4)::int between p_season - 3 and p_season
       and coalesce(pgs.goalie_gp,0) > 0
     group by 1
  ),
  pt_cur as (
    select pd.player_id, pd.team_abbrev
      from player_directory pd
     where pd.season = p_season and pd.team_abbrev is not null
  ),
  goalie_depth as (
    select r.player_id,
           ptc.team_abbrev,
           coalesce(tr2.games_left, v_games) as budget,
           row_number() over (
             partition by ptc.team_abbrev
             order by coalesce(gh.w_ggp, 0) desc, r.exp_starts desc, r.player_id
           ) as depth_rank
      from r
      join pt_cur ptc on ptc.player_id = r.player_id
      left join team_rem tr2 on tr2.abbrev = ptc.team_abbrev
      left join goalie_history gh on gh.player_id = r.player_id
     where r.is_goalie
  ),
  goalie_weighted as (
    select gd.*,
           cs.w / sum(cs.w) over (partition by gd.team_abbrev) as norm_w
      from goalie_depth gd
      join crease_shape cs on cs.depth_rank = least(gd.depth_rank, 4)
  ),
  goalie_alloc as (
    select gw.player_id,
           greatest(0,
             round(gw.budget * sum(gw.norm_w) over (
               partition by gw.team_abbrev order by gw.depth_rank
               rows between unbounded preceding and current row))
             - round(gw.budget * coalesce(sum(gw.norm_w) over (
               partition by gw.team_abbrev order by gw.depth_rank
               rows between unbounded preceding and 1 preceding), 0))
           )::int as alloc_starts
      from goalie_weighted gw
  ),
  goalie_monotone as (
    select ga.player_id,
           (array_agg(ga.alloc_starts) over (
              partition by gw2.team_abbrev
              order by ga.alloc_starts desc
              rows between unbounded preceding and unbounded following
            ))[gw2.depth_rank] as alloc_starts
      from goalie_alloc ga
      join goalie_weighted gw2 on gw2.player_id = ga.player_id
  ),
  r2 as (
    select r.*,
           -- A goalie with no row on THIS season's roster is not on an NHL
           -- crease and gets no starts. He is still on the board, at zero, and
           -- the next directory refresh that signs him restores a real share
           -- with no release. The old fallback to r.rem_starts handed him an
           -- unallocated estimate on top of a crease already divided to its
           -- schedule.
           case when r.is_goalie then coalesce(gm.alloc_starts, 0)
                else r.rem_starts end as starts_final
      from r left join goalie_monotone gm on gm.player_id = r.player_id
  )
  select r.player_id, p_season,
         case when r.is_goalie then r.starts_final else r.rem_gp end,
         r.gp_actual,
         case when r.is_goalie then 0 else round(r.r_goal*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_a*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_sog*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_blk*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_ppp*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_shp*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_hits*r.rem_gp,2) end,
         case when r.is_goalie then 0 else round(r.r_pim*r.rem_gp,2) end,
         case when r.is_goalie then round(r.r_wins*r.starts_final,2) else 0 end,
         case when r.is_goalie then round(r.r_saves*r.starts_final,2) else 0 end,
         case when r.is_goalie then round(r.r_so*r.starts_final,2) else 0 end,
         case when r.is_goalie then round(r.r_ga*r.starts_final,2) else 0 end,
         case when r.is_goalie then
           round(r.r_wins*r.starts_final*5.0 + r.r_saves*r.starts_final*0.6
               + r.r_so*r.starts_final*5.0 + r.r_ga*r.starts_final*(-3.0),2)
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
         coalesce(i.full_name, pt2.full_name),
         pt2.team_abbrev,
         r.position_code, r.is_goalie, now(), now()
    from r2 r
    left join nhl_player_identity i on i.player_id = r.player_id
    left join lateral (
      select pd.team_abbrev, pd.full_name from player_directory pd
       where pd.player_id = r.player_id order by pd.season desc limit 1
    ) pt2 on true
    where exists (
      select 1 from player_directory pd3 where pd3.player_id = r.player_id
    );

  get diagnostics v_rows = row_count;

  -- ── INVARIANT 1: ROSTER COVERAGE ────────────────────────────────────────
  -- Every team that plays this season must carry at least two goalies in the
  -- directory. Without this, a roster load that half-failed would zero real
  -- starters through the fallback above and look like a quiet board.
  select count(distinct s.abbrev) into v_sched_teams
    from (
      select home_team as abbrev from nhl_games where season = p_season and game_type = 'regular'
      union all
      select away_team from nhl_games where season = p_season and game_type = 'regular'
    ) s;

  select count(*) into v_covered_teams
    from (
      select pd.team_abbrev
        from player_directory pd
       where pd.season = p_season and pd.is_goalie and pd.team_abbrev is not null
       group by pd.team_abbrev
      having count(*) >= 2
    ) t;

  if v_sched_teams > 0 and v_covered_teams < v_sched_teams then
    raise exception
      'roster coverage: only % of % scheduled teams carry 2+ goalies in player_directory for season %; refusing to rebuild on a partial roster load',
      v_covered_teams, v_sched_teams, p_season;
  end if;

  -- ── INVARIANT 2: EVERY CREASE EQUALS ITS SCHEDULE ───────────────────────
  -- Counted exactly the way team_rem counts it, so the guard and the
  -- allocation cannot drift apart.
  select string_agg(x.team_abbrev || ' ' || x.alloc || '/' || x.expected, ', ' order by x.team_abbrev)
    into v_bad
    from (
      select a.team_abbrev, a.alloc, coalesce(sch.games_left, v_games) as expected
        from (
          select r.team_abbrev, sum(r.games_remaining)::int as alloc
            from player_ros_projections r
           where r.season = p_season and r.is_goalie and r.team_abbrev is not null
           group by r.team_abbrev
        ) a
        left join (
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
        ) sch on sch.abbrev = a.team_abbrev
       where a.alloc <> coalesce(sch.games_left, v_games)
    ) x;

  if v_bad is not null then
    raise exception
      'crease invariant: goalie starts do not equal the schedule for season % (team alloc/expected): %',
      p_season, v_bad;
  end if;

  select count(*) filter (where not is_goalie), count(*) filter (where is_goalie)
    into v_sk, v_go from player_ros_projections where season=p_season;
  return query select v_rows, v_sk, v_go, v_games;
end;
$function$;

-- Production read-only definition: sync_scoring_settings_to_rules
CREATE OR REPLACE FUNCTION public.sync_scoring_settings_to_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.scoring_settings is null then
    return new;
  end if;

  -- On UPDATE, skip when unchanged. On INSERT there is no OLD — always sync.
  if TG_OP = 'UPDATE'
     and new.scoring_settings is not distinct from old.scoring_settings then
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
$function$;
