-- ============================================================================
-- Goalie starts are a TEAM BUDGET, allocated by depth, not an independent
-- per-goalie projection
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   public.rebuild_ros_projections(integer) is REPLACED. One CTE chain is
--   added and one expression changes: a goalie's `games_remaining` is now his
--   share of his team's scheduled games, not his own shrunken prior. Skaters
--   are untouched. project_ros, project_rookies, the scoring weights, the
--   name fallback and the union are all byte-identical.
--
-- (b) WHY
--   VERIFIED ON PRODUCTION 2026-09-11, read-only, after the rookie union
--   landed:
--
--     team   goalies   crease games projected
--     SJS       5              147
--     WPG       5              129
--     TBL       6              127
--     MIN       6              112
--
--   A season is 84. Nothing constrained a team's goalies to the number of
--   games that team actually plays, so every goalie on an over-committed
--   crease was inflated. The defect is structural: exp_starts is a
--   PER-PLAYER estimate of individual workload derived from last season's
--   goalie games, and summing it across a team's current roster is
--   meaningless -- those goalies mostly played for other teams last year.
--   Five goalies each independently "worth" 30 starts is five goalies on a
--   84-game team, which cannot happen.
--
--   WHY NOT SIMPLY SCALE EACH CREASE TO 84. Measured first: SJS's factor
--   would be 84/147 = 0.571, dropping Askarov from 46 starts to 26. Flat
--   scaling conserves the total and destroys the distribution -- it punishes
--   a starter for how many fringe goalies happen to sit behind him in
--   player_directory. A team with two goalies listed keeps a real starter; a
--   team with five does not. That is worse than the bug.
--
--   WHAT THIS DOES INSTEAD. A crease is a fixed budget split by depth:
--
--     BUDGET   that team's remaining games, counted from nhl_games. Derived,
--              never a constant -- 2026-27 is 84 under the new CBA, it was 82
--              before, and mid-season every team has a different number left.
--     ORDER    rank within the team by the model's own exp_starts, so a
--              goalie's individual history still decides who is the starter.
--     SHARES   MEASURED, not invented. Every 2025 team crease, goalies ranked
--              by games played, each rank's share of that team's goalie games:
--
--                rank   team-seasons   median share   median GP
--                  1         32           0.5499        50.5
--                  2         31           0.3300        30.0
--                  3         26           0.0578         4.5
--                  4+         9           0.0190         2.0
--
--              Medians, not means: rank 3 and 4 exist on only some teams, so
--              the mean of a conditional share overstates a depth slot that
--              is usually empty.
--
--   INDEPENDENT CHECK. Allocating SJS's 84 games by this shape gives Askarov
--   47 starts. A beat-reported depth chart compiled separately (Daily Faceoff
--   cross-checked against reporting, 10 Sep 2026) puts him at 46. Two
--   unrelated methods one game apart is the best evidence available that the
--   shape is right.
--
--   THE ARITHMETIC IS EXACT, NOT APPROXIMATE. Allocating each goalie
--   round(budget * share) independently leaves a team summing to 83 or 85
--   after rounding. This allocates on ROUNDED CUMULATIVE shares -- each
--   goalie receives round(budget * cum_share_through_him) minus
--   round(budget * cum_share_before_him) -- so the team total telescopes to
--   round(budget * 1.0) = budget, exactly, for every team, always.
--
--   WHAT THIS DOES NOT DO. It applies one league-median crease shape to all
--   32 teams. A genuine workhorse runs hotter than the median: Vasilevskiy
--   took 58 of Tampa's 82 last season (0.71) and lands near 46 here. That is
--   the honest cost of using a measured league shape instead of per-team beat
--   reporting, and it is the right default -- it is what the data says a #1
--   goalie typically gets, and it errs toward the middle rather than toward a
--   number nobody can source. Per-team refinement belongs in a
--   goalie_start_projections override table carrying source_url and
--   confidence, which is separate, additive, and not a launch-week change.
--
--   Goalies with no team_abbrev in player_directory (10 rows today) have no
--   budget to share and keep the model's own estimate.
--
--   THE DEPTH ORDERING IS ~65%% ACCURATE AND CANNOT BE TUNED BETTER FROM THIS
--   DATA. Backtested it rather than guessing: predict each team's 2025 games
--   leader from 2024/2023/2022 workload, 32 teams.
--
--     weighting            correct
--     last season only      20/32
--     5 / 3 / 2             21/32   <- used
--     10 / 3 / 1            20/32
--     20 / 3 / 1            19/32
--     3 / 1 / 0             20/32
--
--   Everything lands 19-21. The spread is noise. Note 20/3/1 in particular:
--   it is the weighting that fixes the two teams that motivated this change
--   (Askarov over Nedeljkovic in San Jose, Demko over Tolopilo in Vancouver),
--   and it is the WORST of the five across the league. Tuning to those two
--   creases would have traded a visible anecdote for a measurably worse
--   model. 5/3/2 is kept because it is marginally best AND is already
--   project_ros's own recency weighting, so nothing new is introduced.
--
--   WHAT THIS MEANS, STATED PLAINLY: roughly 11 of 32 creases will have the
--   wrong goalie at rank 1, and under allocation that is the difference
--   between ~46 starts and ~29. San Jose is a known one -- Askarov's
--   47/13/2 loses to Nedeljkovic's 40/38/38. That is the ceiling of a
--   history-only depth chart, not a bug to be fixed by better arithmetic.
--   Getting past it needs information this database does not contain: beat
--   reporting on who won the job in camp. That is exactly what a
--   goalie_start_projections override table carrying source_url and
--   confidence is for, and this change is the floor it sits on -- the
--   invariant now holds, so an override can only move starts between
--   goalies on one team, never break the team total.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11, projection-layer work order section 1.3.
--
-- Reversibility: CREATE OR REPLACE from 20260911080000.
-- Idempotent: CREATE OR REPLACE. A second apply is a no-op.
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
declare v_games int; v_rows int; v_sk int; v_go int;
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
  -- ── CREASE ALLOCATION (2026-09-11) ──────────────────────────────────────
  -- Measured crease shape: each depth rank's median share of a team's goalie
  -- games across all 32 team-seasons in 2025. See header (b).
  crease_shape(depth_rank, w) as (values
    (1, 0.5499::numeric), (2, 0.3300::numeric), (3, 0.0578::numeric), (4, 0.0190::numeric)
  ),
  -- DEPTH SIGNAL. Ordering by exp_starts alone ranks on LAST SEASON only,
  -- because exp_starts is a shrunk ggp_last. Vancouver showed why that
  -- fails: Tolopilo 21 games in 2025 and 2/0 before, Demko 20 in 2025 but
  -- 23 and 51 before. exp_starts put them 25 to 24, so a backup who got one
  -- run outranked a workhorse coming off two injury years -- and under
  -- allocation that gap is no longer one start, it is rank 2 (28 starts)
  -- versus rank 3 (5). Same single-season blindness 20260911060000 fixed
  -- for skaters, surfacing in the crease.
  --
  -- Rank on weighted multi-season goalie games instead, reusing the recency
  -- weights project_ros already applies to its own history window (15 for
  -- the current season, then 5, 3, 2 going back). Those are the model's
  -- established weights, not new ones. Demko scores 271 to Tolopilo's 111
  -- and takes rank 2; Vasilevskiy and Hellebuyck keep rank 1 unchanged.
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
  -- CURRENT-SEASON ROSTER ONLY. `pt` above filters out null teams and then
  -- takes the most recent row, so a goalie whose 2026 directory row has NO
  -- team falls back to his last known club. Four did on the first apply --
  -- Talbot to DET, Mrazek to ANA, Ingram to EDM, Quick to NYR -- and between
  -- them they consumed 87 starts from creases they are not in, leaving those
  -- four teams short by exactly that. A goalie with no team in the season
  -- being projected is not on an NHL roster and must not hold any team's
  -- starts. He keeps the model's own estimate and belongs to no crease.
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
    -- Rounded CUMULATIVE shares: the per-goalie allocation is the difference
    -- of two rounded running totals, so a team's starts telescope to exactly
    -- round(budget * 1.0) = budget. No drift, no residual to sweep up.
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
    -- MONOTONE IN DEPTH. Ranks 4 and beyond share one weight, so the
    -- cumulative rounding splits the tail arbitrarily and can hand the 5th
    -- goalie more starts than the 4th (SJS: 1 and 2 before this). Reassign so
    -- the k-th largest allocation goes to the k-th ranked goalie. This is a
    -- permutation within the team, so every team's total is unchanged and
    -- still exactly its schedule.
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
           -- A goalie with no team_abbrev has no budget to share; keep the
           -- model's own estimate rather than zeroing him.
           case when r.is_goalie then coalesce(gm.alloc_starts, r.rem_starts)
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
  select count(*) filter (where not is_goalie), count(*) filter (where is_goalie)
    into v_sk, v_go from player_ros_projections where season=p_season;
  return query select v_rows, v_sk, v_go, v_games;
end;
$function$;

COMMIT;
