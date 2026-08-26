-- ─────────────────────────────────────────────────────────────────────────────
-- An honest expected-goals model, and the check that would have caught the
-- dishonest one.
--
-- WHAT WAS FOUND
--   raw_shots.xg_value for the Citrus era (2025-26) is contaminated by outcome
--   information. Two measurements, either one sufficient:
--
--     AUC 0.9360  against 0.7785 for MoneyPuck on the season before. No
--                 pre-shot model reaches 0.936; the ceiling for shot quality
--                 is about 0.82.
--     6,678 shots share the single value 0.60000002, and 6,669 of them are
--                 goals — 99.9%, and 78% of every goal scored in the season.
--
--   The commit history names the symptom without naming the cause:
--   84e4f0a1 "repair pre-shot score_differential + document 0.6 clip as
--   damage-limiter". The clip caps predictions that were already absurd.
--
--   A leaking score cannot be recalibrated into an honest one. Any monotone
--   remap simply relabels "this went in" as "0.99", and every on-ice rate
--   built on it collapses into a restatement of the box score.
--
--   Separately: the eight seasons before it were never scored by any Citrus
--   model at all. load_historical_shots_csv.py maps MoneyPuck's "xGoal"
--   straight into xg_value. Those seasons calibrate because MoneyPuck's model
--   is calibrated.
--
-- WHAT THIS BUILDS
--   Empirical goal probability over a grid of pre-shot facts only, fitted on
--   780,256 MoneyPuck-labelled shots from 2017-2023, with 2024 held out
--   entirely for validation. Two-level empirical-Bayes shrinkage so a thin cell
--   falls back to its parent rather than inventing a probability from four
--   shots.
--
--   Five features, chosen because they mean the same thing in both eras:
--     shot type    mapped to one vocabulary (tip/tip-in, back/backhand, …)
--     distance     identical range and definition on both sides
--     |angle|      MoneyPuck signs it, Citrus does not; abs() settles it
--     is_rebound   6.1% of MoneyPuck shots, 5.1% of ours — same concept
--     skater edge  shooter minus defender skaters, comparable in both
--
--   Deliberately excluded: is_power_play and defending_team_skaters_on_ice
--   (never populated for the MoneyPuck era), and every post-shot column in
--   raw_shots. Empty-net shots are fitted and scored on their own small table.
--
--   raw_shots.is_empty_net is NOT trusted in the Citrus era: 3,877 shots carry
--   it and convert at 19%, not the 62% the flag implies — it does not mean "the
--   net I am shooting at is empty". situation_code is used instead wherever it
--   exists, which is every Citrus-era shot. Getting this one flag wrong was the
--   entire difference between a 1.198 season and a 1.014 one.
--
-- HOW IT PERFORMED
--   Held-out season 2024, never seen in the fit, against MoneyPuck's own model
--   on exactly the same shots:
--
--                        AUC       xG ÷ goals
--     honest            0.7588       0.9939
--     MoneyPuck         0.7785       1.0223
--
--   Within 0.02 AUC of a gradient booster, and better calibrated, from five
--   bucketed facts. Applied to all nine seasons it calibrates between 0.962 and
--   1.014 with AUC 0.741 to 0.776 throughout — one model, one convention, and
--   for the first time the seasons are comparable to each other.
--
--   It will not beat xG v4 once that passes its gates. Retire it that day.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.xg_shot_class(p text)
returns text language sql immutable parallel safe as $$
  select case lower(coalesce(p,''))
    when 'wrist' then 'wrist'  when 'snap' then 'snap'  when 'slap' then 'slap'
    when 'tip' then 'tip'      when 'tip-in' then 'tip'
    when 'back' then 'back'    when 'backhand' then 'back'
    when 'defl' then 'defl'    when 'deflected' then 'defl'
    when 'wrap' then 'wrap'    when 'wrap-around' then 'wrap'
    else 'other' end
$$;

create or replace function public.xg_dist_band(d numeric)
returns smallint language sql immutable parallel safe as $$
  select case
    when d is null then 99
    when d <  5 then 0  when d < 10 then 1  when d < 15 then 2
    when d < 20 then 3  when d < 25 then 4  when d < 30 then 5
    when d < 35 then 6  when d < 40 then 7  when d < 50 then 8
    when d < 60 then 9  when d < 80 then 10 else 11 end::smallint
$$;

create or replace function public.xg_angle_band(a numeric)
returns smallint language sql immutable parallel safe as $$
  select least(8, floor(abs(coalesce(a,0)) / 10.0))::smallint
$$;

create or replace function public.xg_skater_edge(is_home boolean, h int, a int)
returns smallint language sql immutable parallel safe as $$
  select greatest(-2, least(2,
    case when coalesce(is_home,true) then coalesce(h,5) - coalesce(a,5)
         else coalesce(a,5) - coalesce(h,5) end))::smallint
$$;

create table if not exists public.xg_honest_cells (
  shot_class text not null, dist_band smallint not null, angle_band smallint not null,
  is_rebound boolean not null, skater_edge smallint not null,
  n integer not null, goals integer not null, p numeric(9,6) not null,
  primary key (shot_class, dist_band, angle_band, is_rebound, skater_edge)
);
create table if not exists public.xg_honest_parent (
  shot_class text not null, dist_band smallint not null,
  n integer not null, goals integer not null, p numeric(9,6) not null,
  primary key (shot_class, dist_band)
);
create table if not exists public.xg_honest_en (
  dist_band smallint primary key, n integer not null, goals integer not null, p numeric(9,6) not null
);
create table if not exists public.xg_honest_global (
  id integer primary key default 1, p numeric(9,6) not null, constraint one_row_g check (id = 1)
);

comment on table public.xg_honest_cells is
  'Empirical goal probability by pre-shot cell, fitted on MoneyPuck-labelled seasons with two-level shrinkage. No post-shot input, so it cannot leak.';

create or replace function public.xg_honest(
  p_shot_type text, p_distance numeric, p_angle numeric,
  p_rebound boolean, p_is_home boolean, p_home_sk integer, p_away_sk integer,
  p_empty_net boolean default false
) returns numeric language sql stable parallel safe
set search_path = public, pg_temp as $$
  select coalesce(
    case when coalesce(p_empty_net,false)
         then (select e.p from public.xg_honest_en e
                where e.dist_band = public.xg_dist_band(p_distance)) end,
    (select c.p from public.xg_honest_cells c
      where c.shot_class  = public.xg_shot_class(p_shot_type)
        and c.dist_band   = public.xg_dist_band(p_distance)
        and c.angle_band  = public.xg_angle_band(p_angle)
        and c.is_rebound  = coalesce(p_rebound,false)
        and c.skater_edge = public.xg_skater_edge(p_is_home, p_home_sk, p_away_sk)),
    (select pa.p from public.xg_honest_parent pa
      where pa.shot_class = public.xg_shot_class(p_shot_type)
        and pa.dist_band  = public.xg_dist_band(p_distance)),
    (select g.p from public.xg_honest_global g),
    0.06)
$$;

alter table public.raw_shots add column if not exists xg_honest numeric(9,6);
create index if not exists idx_raw_shots_xg_honest on public.raw_shots (season) where xg_honest is null;

-- ── the fit: 2017-2023, non-empty-net. 2024 is never touched here. ──────────
with tr as (
  select public.xg_shot_class(shot_type) sc, public.xg_dist_band(distance) db,
         public.xg_angle_band(angle) ab, coalesce(is_rebound,false) rb,
         public.xg_skater_edge(is_home_team, home_skaters_on_ice, away_skaters_on_ice) se,
         is_goal::int g
  from public.raw_shots
  where season between 2017 and 2023 and coalesce(period_type,'REG') <> 'SO'
    and not coalesce(is_empty_net,false)
),
glob as (select avg(g)::numeric p from tr),
ins_g as (insert into public.xg_honest_global (id,p) select 1, round(p,6) from glob
          on conflict (id) do update set p = excluded.p returning 1),
par as (select sc, db, count(*) n, sum(g) k from tr group by 1,2),
ins_p as (
  insert into public.xg_honest_parent (shot_class,dist_band,n,goals,p)
  select p.sc, p.db, p.n, p.k, round(((p.k + 200*gl.p)/(p.n + 200.0))::numeric,6)
  from par p, glob gl
  on conflict (shot_class,dist_band) do update
    set n=excluded.n, goals=excluded.goals, p=excluded.p returning 1),
cell as (select sc, db, ab, rb, se, count(*) n, sum(g) k from tr group by 1,2,3,4,5),
parp as (select p.sc, p.db, ((p.k + 200*gl.p)/(p.n + 200.0))::numeric pp from par p, glob gl),
ins_c as (
  insert into public.xg_honest_cells (shot_class,dist_band,angle_band,is_rebound,skater_edge,n,goals,p)
  select c.sc, c.db, c.ab, c.rb, c.se, c.n, c.k,
         round(((c.k + 50*pp.pp)/(c.n + 50.0))::numeric,6)
  from cell c join parp pp on pp.sc=c.sc and pp.db=c.db
  on conflict (shot_class,dist_band,angle_band,is_rebound,skater_edge) do update
    set n=excluded.n, goals=excluded.goals, p=excluded.p returning 1),
en as (select public.xg_dist_band(distance) db, count(*) n, sum(is_goal::int) k
       from public.raw_shots
       where season between 2017 and 2023 and coalesce(period_type,'REG')<>'SO'
         and coalesce(is_empty_net,false) group by 1)
insert into public.xg_honest_en (dist_band,n,goals,p)
select e.db, e.n, e.k, round(((e.k + 20*0.30)/(e.n + 20.0))::numeric,6) from en e
on conflict (dist_band) do update set n=excluded.n, goals=excluded.goals, p=excluded.p;

-- ── scoring, a batch at a time ──────────────────────────────────────────────
create or replace function public.citrus_score_honest_xg_batch(p_batch integer default 60000)
returns table(processed integer, remaining bigint)
language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare n integer;
begin
  with pick as (
    select id from public.raw_shots
    where xg_honest is null and coalesce(period_type,'REG') <> 'SO' limit p_batch
  ),
  upd as (
    update public.raw_shots s
       set xg_honest = public.xg_honest(
             s.shot_type, s.distance, s.angle, s.is_rebound, s.is_home_team,
             s.home_skaters_on_ice, s.away_skaters_on_ice,
             -- is_empty_net does not mean what it says in the Citrus era
             case when s.situation_code ~ '^[0-9]{4}$'
                  then case when coalesce(s.is_home_team,true)
                            then substr(s.situation_code,1,1) = '0'
                            else substr(s.situation_code,4,1) = '0' end
                  else coalesce(s.is_empty_net,false) end)
    from pick where s.id = pick.id returning 1
  )
  select count(*) into n from upd;
  return query select n, (select count(*) from public.raw_shots
                           where xg_honest is null and coalesce(period_type,'REG') <> 'SO');
end;
$fn$;

-- ── the check that would have caught the leak on day one ────────────────────
create or replace function public.citrus_leakage_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable security invoker
set search_path = public, pg_temp as $$
  with s as (
    select season, is_goal, rank() over (partition by season order by xg_honest) r
    from public.raw_shots where coalesce(period_type,'REG') <> 'SO' and xg_honest is not null
  ),
  a as (select season, count(*) filter (where is_goal) np,
               count(*) filter (where not is_goal) nn, sum(r) filter (where is_goal) sr
        from s group by 1),
  auc as (select season, (sr - np*(np+1)/2.0) / nullif(np::numeric*nn,0) v from a),
  worst as (select max(v) hi, min(v) lo, (array_agg(season order by v desc))[1] s_hi from auc)
  select 'xg_no_outcome_leakage',
         case when hi is null then 'info'
              when hi <= 0.85 and lo >= 0.60 then 'pass' else 'fail' end,
         'AUC ' || round(lo,4)::text || ' - ' || round(hi,4)::text,
         '0.60 - 0.85',
         case when hi > 0.85
              then 'season ' || s_hi::text || ' scores at ' || round(hi,4)::text ||
                   '. No pre-shot model reaches that; the score is reading the outcome.'
              else 'discrimination in the range an honest pre-shot model lives in' end
  from worst;
$$;

comment on function public.citrus_leakage_invariant() is
  'Fails when an expected-goals column discriminates better than any pre-shot model can. The deployed 2025-26 xG scored 0.9360 against 0.7785 for MoneyPuck; 78% of the season''s goals shared one hardcoded value.';

-- ── attribution reads the honest score ──────────────────────────────────────
-- xg_value and flurry_adjusted_xg stay in place, untouched, so the comparison
-- can be re-run. Nothing downstream reads them any more. The _flurry columns
-- are filled from xg_honest for now: a flurry adjustment computed on a leaking
-- score is a leaking score, and that has to be redone on top of this one before
-- the column means anything different from its neighbour.
create or replace function public.rebuild_onice_xg(p_games integer[])
returns integer language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare n integer;
begin
  delete from public.player_onice_xg where game_id = any(p_games);

  with sh as (
    select s.game_id, s.period,
           (split_part(s.time_in_period,':',1))::int*60
             + (split_part(s.time_in_period,':',2))::int as t,
           s.event_owner_team_id as shooting_team,
           coalesce(s.xg_honest,0)::numeric as xg,
           coalesce(s.is_goal,false) as is_goal,
           case when s.situation_code ~ '^[0-9]{4}$' then s.situation_code end as sc
    from public.raw_shots s
    where s.game_id = any(p_games) and s.time_in_period is not null
      and s.period is not null and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  coded as (
    select sh.*,
           coalesce(substr(sh.sc,1,1)::int, i.away_goalie)  as a_g,
           coalesce(substr(sh.sc,2,1)::int, i.away_skaters) as a_sk,
           coalesce(substr(sh.sc,3,1)::int, i.home_skaters) as h_sk,
           coalesce(substr(sh.sc,4,1)::int, i.home_goalie)  as h_g
    from sh left join public.game_strength_intervals i
      on i.game_id = sh.game_id and i.period = sh.period
     and i.start_s <= sh.t and i.end_s > sh.t
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period, min(st) as st, max(en) as en
    from (
      select *, sum(newgrp) over (partition by game_id, player_id, period
                                  order by st, en rows unbounded preceding) as g
      from (
        select game_id, player_id, team_id, period,
               shift_start_time_seconds as st, shift_end_time_seconds as en,
               case when shift_start_time_seconds > max(shift_end_time_seconds) over (
                      partition by game_id, player_id, period
                      order by shift_start_time_seconds, shift_end_time_seconds
                      rows between unbounded preceding and 1 preceding)
                    then 1 else 0 end as newgrp
        from public.player_shifts_official
        where game_id = any(p_games) and shift_end_time_seconds > shift_start_time_seconds
      ) a
    ) b group by game_id, player_id, period, g
  ),
  onice as (
    select c.*, m.player_id, m.team_id, (m.team_id = c.shooting_team) as is_for,
           case when m.team_id = t.home_id then c.h_sk else c.a_sk end as own_sk,
           case when m.team_id = t.home_id then c.a_sk else c.h_sk end as opp_sk,
           case when m.team_id = t.home_id then c.h_g  else c.a_g  end as own_g,
           case when m.team_id = t.home_id then c.a_g  else c.h_g  end as opp_g,
           t.season
    from coded c
    join merged m on m.game_id = c.game_id and m.period = c.period
                 and m.st < c.t and m.en >= c.t      -- 99.5% agreement, measured
    join public.game_teams t on t.game_id = c.game_id
    where c.a_sk is not null and c.h_sk is not null
  )
  insert into public.player_onice_xg
        (game_id, player_id, state, xgf, xga, xgf_flurry, xga_flurry, cf, ca, gf, ga, team_id, season)
  select game_id, player_id,
         case when own_g = 0 then 'EN_FOR'
              when opp_g = 0 then 'EN_AGAINST'
              when own_sk = opp_sk and own_sk = 5 then '5v5'
              when own_sk = opp_sk and own_sk = 4 then '4v4'
              when own_sk = opp_sk and own_sk = 3 then '3v3'
              when own_sk > opp_sk then 'PP' when own_sk < opp_sk then 'PK'
              else 'OTHER' end,
         coalesce(sum(xg) filter (where is_for), 0),
         coalesce(sum(xg) filter (where not is_for), 0),
         coalesce(sum(xg) filter (where is_for), 0),
         coalesce(sum(xg) filter (where not is_for), 0),
         count(*) filter (where is_for), count(*) filter (where not is_for),
         count(*) filter (where is_for and is_goal), count(*) filter (where not is_for and is_goal),
         min(team_id), min(season)
  from onice group by 1,2,3;

  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- anything already attributed used the contaminated score
update public.strength_build_state set onice_built_at = null;
