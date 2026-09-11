-- ============================================================================
-- A goalie who is not on an NHL roster this season gets zero starts, and the
-- crease invariant is asserted instead of assumed
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   public.rebuild_ros_projections(integer) is REPLACED. Two changes, both
--   small: the goalie fallback in r2 becomes 0 instead of the model's own
--   per-goalie estimate, and two invariant checks run after the insert and
--   RAISE rather than return a wrong board. Every CTE, weight, share and
--   scoring expression is byte-identical to 20260911090000. Skaters are
--   untouched.
--
-- (b) WHY
--   VERIFIED ON PRODUCTION 2026-09-11 20:0x UTC, read-only. The crease
--   invariant that 20260911090000 established and that verified 32/32 exact
--   last night had broken by this evening:
--
--     team   crease starts   schedule
--     SEA        114            84
--     OTT        103            84
--     NYR         96            84
--     MIN         92            84
--     NYI         92            84
--     MTL         92            84
--     UTA         92            84
--
--     league total 2781 against 32 * 84 = 2688.
--
--   NOTHING IN THE FUNCTION CHANGED. The input did. player_directory was
--   refreshed at 12:50 UTC and the board rebuilt at 19:48 UTC, and that
--   refresh dropped nine goalies from their 2026 rosters -- camp cuts and
--   depth reassignments. Those nine are the entire discrepancy:
--
--     OTT James Reimer 19, SEA Matt Murray 12, NYR Spencer Martin 12,
--     SEA Nikke Kokko 10, NYI Marcus Hogberg 8, MIN Cal Petersen 8,
--     MTL Hunter Shepard 8, UTA Jaxson Stauber 8, SEA Victor Ostman 8
--
--     19+12+12+10+8+8+8+8+8 = 93.   2781 - 93 = 2688, exactly.
--
--   THE DEFECT. A goalie's board team comes from pt2 -- his most recent
--   directory row in ANY season. His allocation comes from pt_cur -- his row
--   in the season being projected. Those two CTEs disagreed for exactly the
--   goalies a roster refresh removes: still labelled with last season's club,
--   no longer in this season's crease. Missing from pt_cur, each fell through
--   `coalesce(gm.alloc_starts, r.rem_starts)` and kept an unallocated
--   per-goalie estimate, which then landed ON TOP of a crease the remaining
--   goalies had already divided to exactly 84.
--
--   20260911090000 wrote that fallback for goalies with no team ANYWHERE, and
--   at the time the two sets were the same ten rows. They are not the same
--   set. The fallback fires on the wider one.
--
--   WHY ZERO IS THE RIGHT ANSWER, not a smaller estimate. A goalie with no
--   row on any 2026 roster is unsigned or in the minors. Zero starts is what
--   the data says, it is what sorts him to the bottom of a draft board where
--   he belongs, and it is self-healing: the day he signs, the next directory
--   refresh puts him in pt_cur and the allocation gives him a real share. No
--   app release, no manual edit. Every goalie counting stat -- wins, saves,
--   shutouts, GA and therefore total points -- is already computed as a rate
--   times starts_final, so all of them follow to zero on their own. James
--   Reimer stops carrying 157.4 projected points for a team he is not on.
--
--   THE GUARDS, and why this class of bug does not ship again. The old
--   arithmetic was exact BY CONSTRUCTION and I trusted the construction. It
--   was still exact -- it just stopped covering every goalie on the board.
--   An invariant that is only true when its inputs behave is an assumption,
--   so it is now asserted:
--
--     1. ROSTER COVERAGE. Every team in this season's schedule must carry at
--        least two goalies in player_directory. A half-failed roster load
--        would otherwise silently zero real starters -- the exact failure the
--        zero fallback newly makes possible, so it is guarded at the source.
--     2. CREASE SUM. Every team's goalie starts must equal that team's
--        remaining scheduled games, counted the same way team_rem counts them.
--
--   Both RAISE. The insert and the delete above it are in the caller's
--   transaction, so a violation rolls back and production keeps the last good
--   board rather than serving a wrong one. Team count is read from nhl_games
--   rather than hardcoded to 32, so expansion does not turn a guard into an
--   outage.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11. Follow-up to 20260911090000, found by re-verifying
--   the crease invariant against production before the build-18 submission.
--
-- Reversibility: CREATE OR REPLACE from 20260911090000.
-- Idempotent: CREATE OR REPLACE. A second apply is a no-op.
--
-- AFTER APPLYING, the board must be rebuilt -- this replaces the function,
-- not the data:
--   select * from public.rebuild_ros_projections(public.get_projection_target_season());
-- ============================================================================

BEGIN;

DO $require$
BEGIN
  IF to_regprocedure('public.project_rookies(integer)') IS NULL THEN
    RAISE EXCEPTION 'public.project_rookies(integer) is missing; apply 20260911070000 first';
  END IF;
END $require$;

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
           -- schedule -- see header (b).
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

COMMIT;
