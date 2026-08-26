-- ═════════════════════════════════════════════════════════════════════════════
-- GAR moves into the database, and four things it was getting wrong stop being
-- wrong.
--
-- ─── WHY IT MOVES ────────────────────────────────────────────────────────────
--
-- The chain was: run calculate_gar_components.py, which writes a CSV; then run
-- calculate_gar_regression.py, which reads that CSV and writes
-- player_gar_components. Two manual scripts with a file between them.
--
-- player_gar_components was last written on 2025-12-18. Eight months stale, one
-- season, and still carrying the defect it was supposed to have fixed:
--
--     593 of 935 players    ppo_rate_raw = 0
--     930 of 935 players    ppd_rate_raw = 0
--     935 of 935 players    penalty_component_raw = 0
--
-- The inputs view had real numbers for all five components. The output table
-- never learned, because nobody re-ran the pair of scripts. A number that needs
-- two commands and a file hand-off will not stay true.
--
-- ─── FAULT 1: replacement level defined backwards for three components ───────
--
--     REPLACEMENT_LEVEL_PERCENTILE = 75.0     # for all five
--
-- Right for the two where lower is better — EVD and PPD are expected goals
-- AGAINST, so the 75th percentile of xGA is a bad defensive rate, which is what
-- replacement should be. Exactly backwards for the three where higher is
-- better: EVO, PPO and penalties drawn. Taking the 75th percentile of those
-- puts replacement at a GOOD rate, so three quarters of the league grades out
-- below replacement, and the stored table showed it — average total GAR/60 of
-- MINUS 0.0729, when an average NHL player is by construction well above a
-- replacement one.
--
-- Corrected: replacement level is the 25th percentile of VALUE — the 25th of a
-- for-rate, the 75th of an against-rate.
--
-- ─── FAULT 2: replacement level set by players who barely play ───────────────
--
-- rp_ppo took its percentile over everyone with ANY power-play time, including
-- a fourth-liner with four minutes across a season whose rate is noise:
--
--     season   rp_ppo (any PP)   rp_ppo (>= 20 min)   mean (>= 20 min)
--     2017         2.606              4.460               5.441
--     2019         2.152              3.444               4.471
--     2022         2.589              4.198               5.496
--
-- Two goals per sixty too low, so every power-play player scored two per sixty
-- better than he should. Twenty minutes — about ten appearances — is now the
-- floor for DEFINING the baseline. Everyone is still scored; a player below the
-- floor is simply shrunk hard toward replacement, which is what the
-- hundred-minute stabilisation threshold is for.
--
-- ─── FAULT 3: five rates over five different denominators, added together ────
--
--     total_gar_per_60 = evo + evd + ppo + ppd + penalty
--
-- EVO and EVD are per sixty minutes of five-on-five. PPO is per sixty of power
-- play. PPD is per sixty of penalty kill. Adding them treats a power-play
-- minute as interchangeable with a five-on-five one, when a player gets
-- fourteen of the latter per game against two of the former. The power play
-- came out at seventy percent of a skater's value.
--
-- Corrected by computing absolute goals above replacement first — each rate
-- times the minutes it was measured over — then dividing by total ice time.
-- Even strength now lands at 55-66% and the power play at 19-27%, which is
-- where the published frameworks put them.
--
-- ─── FAULT 4: penalties added as penalties, not goals ────────────────────────
--
-- The penalty component is minors drawn minus taken, per sixty. The other four
-- are expected GOALS. What a drawn minor is worth, measured here rather than
-- borrowed:
--
--     state   team xGF/60   team xGA/60
--     5v5        2.52          2.52
--     PP         6.09          0.87
--
--   net swing on the power play                      5.22 xG per 60
--   effective length of a minor (2 min, less the
--     ~20% that end early on a goal)                 ~1.80 min
--   value of one drawn minor    5.22 x 1.80 / 60  =  0.157 goals
--
-- citrus_goals_per_minor() recomputes that from player_toi_by_state and
-- player_onice_xg rather than hardcoding it. It reads 0.15531, which is where
-- the public literature independently puts it — a useful check on the whole xG
-- chain arriving at the right number by a different route.
--
-- ─── FAULT 5: goalies were outranking every skater ───────────────────────────
--
-- Eight of the ten highest GAR seasons in the table were goalies. A goalie is
-- on the ice for every second his team plays — three to five thousand minutes
-- against a forward's two thousand — so his team's entire on-ice differential
-- landed on him as though he had skated it. That is not a goalie rating; it is
-- his team's rating with his name on it. Goalie value is goals saved above
-- expected and has its own table. Skater GAR is for skaters.
--
-- With them out the board reads 8478402 in 2022-23 and again in 2021-22 at the
-- top, which is the right man in the right place.
--
-- ─── A NOTE ON SCALE, so nobody is surprised ─────────────────────────────────
--
-- The top skater season comes out near 70 goals above replacement where the
-- published frameworks put the same player nearer 35. That is a baseline
-- choice, not an error: replacement here is the 25th percentile of the qualified
-- population, where those frameworks use a stricter freely-available-player
-- level, and they convert to wins. The ORDERING is the product; the scale can
-- be re-based whenever there is a reason to.
--
-- ─── THE CALIBRATION GUARD, KEPT ─────────────────────────────────────────────
--
-- calculate_gar_components.py refused to emit for a season whose xG model did
-- not add up, because a GAR number quietly a fifth light is worse than no GAR
-- number. That guard travels: this skips any season calibrating outside
-- 0.95-1.05 and names it. Every season now reads exactly 1.0000, so it should
-- never fire — which is the point of leaving it in.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.player_gar_components
  add column if not exists total_gar numeric,
  add column if not exists goals_per_minor numeric;

comment on column public.player_gar_components.total_gar is
  'Absolute goals above replacement for the player-season: each component rate multiplied by the minutes it was measured over. This is the ranking number; total_gar_per_60 is it divided by total ice time.';
comment on column public.player_gar_components.goals_per_minor is
  'The conversion used to put the penalty component into goals, measured from this database by citrus_goals_per_minor().';

create or replace function public.citrus_goals_per_minor()
returns numeric language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with t as (
    select state, sum(toi_seconds)/3600.0 as player_hours
    from public.player_toi_by_state where state in ('5v5','PP') group by 1
  ),
  x as (
    select state, sum(xgf) xgf, sum(xga) xga, sum(gf) gf
    from public.player_onice_xg where state in ('5v5','PP') group by 1
  ),
  r as (
    select x.state,
           x.xgf / nullif(t.player_hours, 0) as team_xgf60,
           x.xga / nullif(t.player_hours, 0) as team_xga60,
           x.gf  / nullif(t.player_hours, 0) as team_gf60
    from x join t using (state)
  )
  select round(
    ( (select team_xgf60 - team_xga60 from r where state = 'PP')
    - (select team_xgf60 - team_xga60 from r where state = '5v5') )
    * greatest(0.5, 2.0 - (select team_gf60 from r where state = 'PP') * 2.0/60.0)
    / 60.0, 5)
$fn$;

create or replace function public.citrus_recompute_gar_totals()
returns table(out_season integer, out_players bigint, out_gpm numeric,
              out_avg_total_gar numeric, out_avg_total_gar60 numeric,
              out_pp_share_pct numeric)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare v_gpm numeric;
begin
  v_gpm := public.citrus_goals_per_minor();

  update public.player_gar_components c
     set goals_per_minor = v_gpm,
         total_gar =
             c.evo_gar_per_60 * coalesce(c.toi_5v5_minutes,0) / 60.0
           + c.evd_gar_per_60 * coalesce(c.toi_5v5_minutes,0) / 60.0
           + c.ppo_gar_per_60 * coalesce(c.toi_pp_minutes,0)  / 60.0
           + c.ppd_gar_per_60 * coalesce(c.toi_pk_minutes,0)  / 60.0
           + c.penalty_gar_per_60 * v_gpm * coalesce(c.toi_total_minutes,0) / 60.0,
         updated_at = now();

  update public.player_gar_components c
     set total_gar_per_60 = case when coalesce(c.toi_total_minutes,0) > 0
                                 then c.total_gar * 60.0 / c.toi_total_minutes else 0 end;

  return query
  select c.season, count(*)::bigint, v_gpm,
         round(avg(c.total_gar), 3), round(avg(c.total_gar_per_60), 4),
         round(100.0 * sum(c.ppo_gar_per_60 * coalesce(c.toi_pp_minutes,0)/60.0)
               / nullif(sum(abs(c.total_gar)), 0), 1)
  from public.player_gar_components c group by c.season order by c.season;
end;
$fn$;

-- The builder itself is long; it is applied to production and recorded in
-- supabase_migrations.schema_migrations under
-- 'gar_excludes_goalies', which is the authoritative text. Rebuild with:
--
--   select * from public.citrus_rebuild_gar_components(null, 100.0, 25.0, false, 20.0);
--
--   p_seasons     null for every season that has inputs
--   p_min_toi     5v5 minutes to be scored at all           (100)
--   p_rp_pct      replacement level as a percentile of VALUE  (25)
--   p_allow_uncalibrated  emit anyway for a season whose xG does not add up
--   p_min_st_toi  special-teams minutes needed to DEFINE the baseline (20)

grant execute on function public.citrus_goals_per_minor()      to anon, authenticated, service_role;
grant execute on function public.citrus_recompute_gar_totals() to service_role;
