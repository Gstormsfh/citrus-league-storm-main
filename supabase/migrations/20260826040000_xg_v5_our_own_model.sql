-- ─────────────────────────────────────────────────────────────────────────────
-- xG v5 — trained on OUR extraction, OUR features, OUR weights.
--
-- Follows 20260826030000_honest_xg.sql, which built the leak-free bridge model.
-- The bridge is fitted on MoneyPuck-labelled rows using only features that
-- exist in both eras, so it drops the seven moat features outright. It is the
-- right thing for the eight seasons we have never extracted ourselves. It is
-- not our model.
--
-- v3 made the same mistake from the other side. Its own README: the moat
-- features "DO NOT EXIST" in the MoneyPuck data and training "substitutes
-- 0 / 'no_pass' placeholders". Across 91% of the corpus the moat was a constant
-- zero, so the model learned to ignore it — and production then served it real
-- values. MoneyPuck was there to teach outcomes. It ended up defining our
-- feature space.
--
-- We never needed it for that. 2025-26 is 118,975 shots from our own pipeline,
-- carrying our own features, with 8,551 real outcomes.
--
-- TWO STAGES, so the moat is measured rather than assumed:
--   A  base   geometry and game state, our extraction, our conventions
--   B  moat   a shrunk multiplier per bucket: observed goals over what stage A
--             expected. 1.0 means the bucket adds nothing.
--
-- WHAT THE MOAT TURNED OUT TO BE WORTH — first time it has ever been measured:
--   no pass before the shot          87,264 shots   multiplier 1.000
--   pass, quality step 1                881        multiplier 1.468
--   pass, quality step 2              1,549        multiplier 1.622
--   pass, quality step 3              1,613        multiplier 0.906
--   pass q2, goalie moved             2,203        multiplier 0.913
--   pass q3, goalie moved             1,802        multiplier 0.669
--   The no-pass bucket landing on 1.000 across 87K shots says the base model is
--   unbiased. The spread across the rest says the features carry real signal.
--   It is not monotone in "quality step" and "goalie moved" points the wrong
--   way, which is worth chasing: those labels may not mean what they are named.
--
-- HELD OUT BY GAME — shots in one game share a goalie, a rink and a score
-- state, so splitting inside a game leaks all three. 23,595 shots across games
-- never trained on:
--
--                            AUC      calibration
--   v5 with moat            0.7513      0.9952
--   v5 base only            0.7474      0.9926
--   bridge (MoneyPuck fit)  0.7409      1.0108
--
--   Training on our own data buys +0.0065 AUC over the bridge. The moat buys a
--   further +0.0039 on top of that. Bucketed multipliers capture a fraction of
--   what the continuous features know — scripts/utilities/train_xg_v5.py fits
--   the same design as a gradient booster and should do better.
--
-- Applied across all nine seasons the chain now calibrates 0.962 to 1.012 with
-- AUC 0.758 to 0.776, and nothing reads raw_shots.xg_value any more.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.xg_v5_cells (
  shot_class text not null, dist_band smallint not null, angle_band smallint not null,
  is_rebound boolean not null, skater_edge smallint not null,
  n integer not null, goals integer not null, p numeric(9,6) not null,
  primary key (shot_class, dist_band, angle_band, is_rebound, skater_edge));
create table if not exists public.xg_v5_parent (
  shot_class text not null, dist_band smallint not null,
  n integer not null, goals integer not null, p numeric(9,6) not null,
  primary key (shot_class, dist_band));
create table if not exists public.xg_v5_en (
  dist_band smallint primary key, n integer not null, goals integer not null, p numeric(9,6) not null);
create table if not exists public.xg_v5_global (
  id integer primary key default 1, p numeric(9,6) not null, constraint one_row_v5 check (id = 1));
create table if not exists public.xg_v5_moat (
  bucket smallint primary key, label text not null, n integer not null,
  goals integer not null, expected numeric(12,4) not null, mult numeric(9,6) not null);

comment on table public.xg_v5_moat is
  'What the seven pre-shot moat features are actually worth: observed goals over what the geometry model expected, shrunk with a 50-goal pseudo-count. A multiplier of 1.0 means the bucket adds nothing.';

alter table public.raw_shots add column if not exists xg_v5 numeric(9,6);

-- Pre-shot only: a completed pass, how good it was, and whether the goalie had
-- to move. Nothing here is knowable after the shot.
create or replace function public.xg_v5_moat_bucket(
  p_has_pass boolean, p_pass_quality numeric, p_goalie_move numeric)
returns smallint language sql immutable parallel safe as $$
  select case when not coalesce(p_has_pass,false) then 0::smallint
              else (1 + least(3, floor(coalesce(p_pass_quality,0) * 4))
                      + case when coalesce(p_goalie_move,0) > 0.05 then 4 else 0 end)::smallint end
$$;

create or replace function public.xg_v5(
  p_shot_type text, p_distance numeric, p_angle numeric, p_rebound boolean,
  p_is_home boolean, p_home_sk integer, p_away_sk integer, p_empty_net boolean,
  p_has_pass boolean, p_pass_quality numeric, p_goalie_move numeric)
returns numeric language sql stable parallel safe
set search_path = public, pg_temp as $$
  with base as (
    select coalesce(
      case when coalesce(p_empty_net,false)
           then (select e.p from public.xg_v5_en e
                  where e.dist_band = public.xg_dist_band(p_distance)) end,
      (select c.p from public.xg_v5_cells c
        where c.shot_class  = public.xg_shot_class(p_shot_type)
          and c.dist_band   = public.xg_dist_band(p_distance)
          and c.angle_band  = public.xg_angle_band(p_angle)
          and c.is_rebound  = coalesce(p_rebound,false)
          and c.skater_edge = public.xg_skater_edge(p_is_home, p_home_sk, p_away_sk)),
      (select pa.p from public.xg_v5_parent pa
        where pa.shot_class = public.xg_shot_class(p_shot_type)
          and pa.dist_band  = public.xg_dist_band(p_distance)),
      (select g.p from public.xg_v5_global g), 0.07) b)
  select least(0.97, greatest(0.0005, b *
           coalesce((select m.mult from public.xg_v5_moat m
                      where m.bucket = public.xg_v5_moat_bucket(p_has_pass,p_pass_quality,p_goalie_move)),
                    1.0)))
  from base
$$;

-- The one line that matters: where we have our own model, use our own model.
create or replace function public.citrus_xg(p_v5 numeric, p_honest numeric, p_legacy numeric)
returns numeric language sql immutable parallel safe as $$
  select coalesce(p_v5, p_honest, 0)      -- p_legacy is never used: it leaks
$$;

comment on function public.citrus_xg(numeric,numeric,numeric) is
  'The expected-goals value anything downstream should read: our own model where it exists, the bridge otherwise, and never raw_shots.xg_value, which reads the outcome.';

create or replace view public.xg_model_coverage as
select season, count(*) shots,
       count(*) filter (where xg_v5 is not null) scored_by_v5,
       count(*) filter (where xg_v5 is null and xg_honest is not null) scored_by_bridge,
       count(*) filter (where xg_v5 is null and xg_honest is null) unscored,
       round((sum(public.citrus_xg(xg_v5, xg_honest, xg_value))
              / nullif(count(*) filter (where is_goal),0))::numeric, 4) calibration
from public.raw_shots where coalesce(period_type,'REG') <> 'SO'
group by 1 order by 1;

comment on view public.xg_model_coverage is
  'Which model scored which season, and whether the result adds up to the goals that were actually scored.';


-- ── THE FIT ─────────────────────────────────────────────────────────────────
-- Stage A on every Citrus-extracted game. The held-out numbers above come from
-- the same design fitted on 4 games in 5; this refits on all of them so the
-- stored score uses every shot we have.
with tr as (
  select public.xg_shot_class(shot_type) sc, public.xg_dist_band(distance) db,
         public.xg_angle_band(angle) ab, coalesce(is_rebound,false) rb,
         public.xg_skater_edge(is_home_team, home_skaters_on_ice, away_skaters_on_ice) se,
         is_goal::int g
  from public.raw_shots
  where source = 'citrus_pbp_extract' and coalesce(period_type,'REG') <> 'SO'
    and not (situation_code ~ '^[0-9]{4}$' and
             case when coalesce(is_home_team,true) then substr(situation_code,1,1)='0'
                  else substr(situation_code,4,1)='0' end)),
glob as (select avg(g)::numeric p from tr),
ins_g as (insert into public.xg_v5_global (id,p) select 1, round(p,6) from glob
          on conflict (id) do update set p=excluded.p returning 1),
par as (select sc, db, count(*) n, sum(g) k from tr group by 1,2),
ins_p as (insert into public.xg_v5_parent (shot_class,dist_band,n,goals,p)
  select p.sc,p.db,p.n,p.k, round(((p.k + 150*gl.p)/(p.n + 150.0))::numeric,6) from par p, glob gl
  on conflict (shot_class,dist_band) do update set n=excluded.n,goals=excluded.goals,p=excluded.p returning 1),
cell as (select sc,db,ab,rb,se,count(*) n,sum(g) k from tr group by 1,2,3,4,5),
parp as (select p.sc,p.db,((p.k + 150*gl.p)/(p.n + 150.0))::numeric pp from par p, glob gl),
ins_c as (insert into public.xg_v5_cells (shot_class,dist_band,angle_band,is_rebound,skater_edge,n,goals,p)
  select c.sc,c.db,c.ab,c.rb,c.se,c.n,c.k, round(((c.k + 40*pp.pp)/(c.n + 40.0))::numeric,6)
  from cell c join parp pp on pp.sc=c.sc and pp.db=c.db
  on conflict (shot_class,dist_band,angle_band,is_rebound,skater_edge) do update
    set n=excluded.n,goals=excluded.goals,p=excluded.p returning 1),
en as (select public.xg_dist_band(distance) db, count(*) n, sum(is_goal::int) k
       from public.raw_shots
       where source = 'citrus_pbp_extract' and coalesce(period_type,'REG')<>'SO'
         and situation_code ~ '^[0-9]{4}$'
         and case when coalesce(is_home_team,true) then substr(situation_code,1,1)='0'
                  else substr(situation_code,4,1)='0' end
       group by 1)
insert into public.xg_v5_en (dist_band,n,goals,p)
select e.db,e.n,e.k, round(((e.k + 15*0.30)/(e.n + 15.0))::numeric,6) from en e
on conflict (dist_band) do update set n=excluded.n,goals=excluded.goals,p=excluded.p;

-- Stage B. Neutralise the multipliers first so xg_v5() reports base-only, then
-- measure observed against expected and shrink toward 1.0.
update public.xg_v5_moat set mult = 1.0;

with tr as (
  select public.xg_v5_moat_bucket(has_pass_before_shot, pass_quality_score, goalie_movement_score) b,
         is_goal::int g,
         public.xg_v5(shot_type, distance, angle, is_rebound, is_home_team,
                      home_skaters_on_ice, away_skaters_on_ice,
                      situation_code ~ '^[0-9]{4}$' and
                        case when coalesce(is_home_team,true) then substr(situation_code,1,1)='0'
                             else substr(situation_code,4,1)='0' end,
                      has_pass_before_shot, pass_quality_score, goalie_movement_score) base
  from public.raw_shots
  where source = 'citrus_pbp_extract' and coalesce(period_type,'REG') <> 'SO'),
agg as (select b, count(*) n, sum(g) k, sum(base) e,
                case b when 0 then 'no pass before the shot'
                       else 'pass, quality step ' || (((b-1) % 4) + 1)::text
                            || case when b > 4 then ', goalie moved' else '' end end lab
         from tr group by 1)
insert into public.xg_v5_moat (bucket,label,n,goals,expected,mult)
select b, lab, n, k, round(e,4), round(((k + 50.0)/(e + 50.0))::numeric, 6) from agg
on conflict (bucket) do update set label=excluded.label, n=excluded.n,
  goals=excluded.goals, expected=excluded.expected, mult=excluded.mult;

-- score every Citrus-extracted shot
update public.raw_shots s set xg_v5 = public.xg_v5(
    s.shot_type, s.distance, s.angle, s.is_rebound, s.is_home_team,
    s.home_skaters_on_ice, s.away_skaters_on_ice,
    s.situation_code ~ '^[0-9]{4}$' and case when coalesce(s.is_home_team,true)
      then substr(s.situation_code,1,1)='0' else substr(s.situation_code,4,1)='0' end,
    s.has_pass_before_shot, s.pass_quality_score, s.goalie_movement_score)
where s.source = 'citrus_pbp_extract' and coalesce(s.period_type,'REG') <> 'SO';

-- attribution must be rebuilt: anything already there used an older score
update public.strength_build_state set onice_built_at = null;


-- ═══════════════════════════════════════════════════════════════════════════
-- MONEYPUCK OUT OF THE WEIGHTING, ENTIRELY
-- ═══════════════════════════════════════════════════════════════════════════
-- The bridge was the right thing for two hours and the wrong thing to keep.
-- Our model now scores every shot in every season. The imported historical rows
-- supply the FACTS of shots we never extracted ourselves — where the puck was,
-- what kind of shot it was, who was on the ice. Our weights, and only ours,
-- decide what those shots were worth. Where the seven moat features do not
-- exist, those rows fall into the no-pass bucket whose multiplier is 1.000, so
-- the moat contributes nothing to a season in which we never measured it.
--
-- Unadjusted, across 1,023,834 shots and nine seasons:
--   calibration 0.9266 - 0.9966      AUC 0.7247 - 0.7719
-- Every season inside the 0.90-1.10 band with no per-season fudge factor.
create or replace function public.citrus_score_v5_batch(p_batch integer default 120000)
returns table(processed integer, remaining bigint)
language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare n integer;
begin
  with pick as (
    select id from public.raw_shots
    where xg_v5 is null and coalesce(period_type,'REG') <> 'SO' limit p_batch),
  upd as (
    update public.raw_shots s
       set xg_v5 = public.xg_v5(
             s.shot_type, s.distance, s.angle, s.is_rebound, s.is_home_team,
             s.home_skaters_on_ice, s.away_skaters_on_ice,
             case when s.situation_code ~ '^[0-9]{4}$'
                  then case when coalesce(s.is_home_team,true)
                            then substr(s.situation_code,1,1) = '0'
                            else substr(s.situation_code,4,1) = '0' end
                  else coalesce(s.is_empty_net,false) end,
             s.has_pass_before_shot, s.pass_quality_score, s.goalie_movement_score)
    from pick where s.id = pick.id returning 1)
  select count(*) into n from upd;
  return query select n, (select count(*) from public.raw_shots
                           where xg_v5 is null and coalesce(period_type,'REG') <> 'SO');
end;
$fn$;

-- Recorded, deliberately NOT applied: what a per-season intercept would be, as
-- a measure of how well our weights transfer to a season we did not learn on.
-- Fitting an intercept per season to that season's own goals is fitting to the
-- answer, and the unadjusted numbers are already inside the band.
create table if not exists public.xg_v5_season_scale (
  season integer primary key, shots integer not null, goals integer not null,
  raw_sum numeric(12,2) not null, scale numeric(9,6) not null,
  fitted_at timestamptz not null default now());

comment on table public.xg_v5_season_scale is
  'Diagnostic only, never applied. How far our model is from each season''s own goal total. A scale far from 1.0 means our weights transfer poorly to that season, which is information, not something to correct away.';

insert into public.xg_v5_season_scale (season, shots, goals, raw_sum, scale)
select season, count(*), count(*) filter (where is_goal), round(sum(xg_v5)::numeric,2),
       round((count(*) filter (where is_goal)::numeric / nullif(sum(xg_v5),0))::numeric, 6)
from public.raw_shots where coalesce(period_type,'REG')<>'SO' and xg_v5 is not null
group by 1
on conflict (season) do update set shots=excluded.shots, goals=excluded.goals,
  raw_sum=excluded.raw_sum, scale=excluded.scale, fitted_at=now();

-- our model or nothing
create or replace function public.citrus_xg(p_v5 numeric, p_honest numeric, p_legacy numeric)
returns numeric language sql immutable parallel safe as $$
  -- p_honest was the MoneyPuck-fitted bridge; p_legacy is raw_shots.xg_value,
  -- which reads the outcome. Neither is served.
  select coalesce(p_v5, 0)
$$;

drop view if exists public.xg_model_coverage;
create view public.xg_model_coverage as
select season, count(*) shots,
       count(*) filter (where xg_v5 is not null) scored_by_our_model,
       count(*) filter (where xg_v5 is null) unscored,
       count(*) filter (where has_pass_before_shot) with_moat_features,
       round((sum(public.citrus_xg(xg_v5, null, null))
              / nullif(count(*) filter (where is_goal),0))::numeric, 4) calibration
from public.raw_shots where coalesce(period_type,'REG') <> 'SO'
group by 1 order by 1;

-- the bridge goes to the attic
do $$
declare t text;
begin
  foreach t in array array['xg_honest_cells','xg_honest_parent','xg_honest_en','xg_honest_global'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
               where n.nspname='public' and c.relname=t and c.relkind='r') then
      execute format('alter table public.%I set schema attic', t);
    end if;
  end loop;
end $$;

comment on column public.raw_shots.xg_v5 is
  'Expected goals from the Citrus model: fitted on Citrus extraction with Citrus features including the seven moat features. This is the column production reads.';
comment on column public.raw_shots.xg_honest is
  'Retired 2026-08-26. The MoneyPuck-fitted bridge, kept for comparison only. Nothing reads it.';
comment on column public.raw_shots.xg_value is
  'DO NOT USE. The 2025-26 slice reads the outcome: AUC 0.9360 where an honest pre-shot model reaches 0.78, and 6,678 shots share the value 0.60000002 of which 99.9% are goals. Seasons 2017-2024 are MoneyPuck''s own xGoal column imported verbatim. Retained for comparison only.';

-- NOTE ON DISK: these scoring passes rewrite every row of a 166-column,
-- one-million-row table. Doing several in a row bloated raw_shots from 1.4 GB
-- to 1.96 GB and filled the volume mid-run. VACUUM (ANALYZE) public.raw_shots
-- after a full re-score, before starting another.
