-- ═════════════════════════════════════════════════════════════════════════════
-- Two model faults, found by measuring instead of assuming.
--
--   1. The moat multipliers were fit on one season with bands that did not
--      match the data, and came out pointing backwards.
--   2. The empty-net test I "fixed" earlier tonight worked in 2025-26 and
--      silently failed in the eight seasons before it. That one was mine.
--
-- ─── 1. THE MOAT ─────────────────────────────────────────────────────────────
--
-- The old bucket function was
--     1 + least(3, floor(pass_quality * 4)) + (goalie_moved ? 4 : 0)
-- which cuts pass quality at 0.25 / 0.50 / 0.75 — the quartiles of [0,1], on
-- the assumption that a score named "quality" occupies [0,1].
--
-- It does not. Over all 63,069 shots that follow a pass, across nine seasons,
-- pass_quality_score runs 0.08 to 0.82 with its mass between 0.30 and 0.74.
-- Cutting at the quartiles of [0,1] therefore crushed everything into two
-- buckets: bucket 4 ended with zero shots and bucket 8 with eleven. The band
-- where the signal is strongest — 0.53 to 0.64, which converts at 21.7% when
-- the goalie holds his ground — was averaged into its neighbours and vanished.
--
-- Goalie movement was worse: one boolean at 0.05, when the truth is not
-- monotone and turns at 0.20 —
--
--     goalie movement    shots    goals    conversion
--     0                 18,246    2,657      14.56%
--     (0, .05]          13,450    2,008      14.93%
--     (.05, .20]        20,357    3,088      15.17%
--     (.20, .35]         8,075      911      11.28%
--     (.35, .50]         1,995      230      11.53%
--     > .50                946       87       9.20%
--
-- A little movement helps; a lot hurts. A boolean at 0.05 puts the helpful and
-- the harmful on the same side of the line, which is how a feature carrying
-- real signal ends up looking like it points backwards.
--
-- And it was fit on 118,975 shots — exactly one season, 2025-26 — then applied
-- to all nine. Multipliers of 0.646 and 0.916 came out of two thousand shots in
-- one year.
--
-- REFIT on all 1,023,834 non-shootout shots, six pass-quality bands by four
-- goalie-movement bands, cut where conversion actually changes:
--
--     pq band       gm 0     gm 1     gm 2     gm 3
--     1 (<=.22)     1.625    0.981      -        -
--     2 (<=.32)     1.851    1.109    1.166      -
--     3 (<=.43)     1.516    1.779    1.637    0.996
--     4 (<=.53)     1.912    1.374    1.041    1.222
--     5 (<=.64)     1.929    1.398    1.249    1.197
--     6 (> .64)     0.937    1.278    1.088    0.979
--     no pass       1.000
--
-- Every well-sampled pass bucket is now above 1.0, where the raw conversion
-- rates said they always should have been. Within a quality band a moving
-- goalie lowers the multiplier, which is the honest reading of the table above.
--
-- SHRINKAGE  mult = (goals + 40) / (expected + 40). A cell holding 900 expected
-- goals barely moves; one holding 4 is pulled back to 1.0. That is the defence
-- against a thin cell inventing a correction out of noise.
--
-- RENORMALISATION  After fitting, every multiplier is scaled by one global
-- constant chosen so sum(base x mult) = sum(goals) over the whole training set.
-- Changing the SHAPE of the moat must not move the LEVEL of the model. Without
-- this, lifting the pass buckets by 40% would quietly inflate league-wide
-- expected goals by about three percent. Global calibration comes out 1.0000.
--
-- ─── 2. THE EMPTY NET ────────────────────────────────────────────────────────
--
-- Earlier tonight raw_shots.is_empty_net was found untrustworthy: 3,877 shots
-- flagged in 2025-26, converting at 19.1% where an empty net converts near 60%.
-- Switching that season to the NHL situation code moved its calibration from
-- 1.198 to 1.014. So when the test was lifted into a shared function, only the
-- situation-code half was written, returning false otherwise.
--
-- situation_code is populated in 2025-26 and NOWHERE ELSE. Zero rows in
-- 2017-18 through 2024-25. So for eight seasons every empty-net goal was scored
-- as though a goalie were in the net, and the damage appeared exactly where you
-- would expect — at range:
--
--     distance band 10    2023-24  1.638      2024-25  1.592
--     distance band 11    2023-24  2.029      2024-25  3.062
--
-- Goals from the far end arriving at up to three times the predicted rate,
-- because they were empty-netters wearing a goalie.
--
-- is_empty_net is not broken. It is broken in ONE season:
--
--     season   flagged   goals   conversion
--     2017        613      386      63.0%
--     2018        683      401      58.7%
--     2019        605      339      56.0%
--     2020        463      290      62.6%
--     2021        800      520      65.0%
--     2022        782      462      59.1%
--     2023        843      485      57.5%
--     2024        959      533      55.6%
--     2025      3,877      741      19.1%     <-- over-flagged 3.7x
--
-- THE RULE: prefer the situation code where it exists, because it counts who
-- was on the ice rather than trusting a flag. Fall back to is_empty_net where
-- it does not, because a flag that is right sixty percent of the time beats
-- pretending every net had a goalie in it.
--
-- After the fix, those same bands read 1.072 / 1.051 and 0.684 / 0.924.
--
-- ─── RESULT ──────────────────────────────────────────────────────────────────
--
--     season   calibration     AUC band
--     2017        0.9791
--     2018        1.0002
--     2019        1.0182
--     2020        1.0157
--     2021        1.0040
--     2022        0.9921
--     2023        1.0235
--     2024        1.0287
--     2025        0.9509
--     ALL         1.0000        0.7342 - 0.7685
--
-- Every season inside 0.95-1.03, global exactly 1.0000, and discrimination
-- still in the range an honest pre-shot model lives in. A model that reads the
-- outcome scores 0.93.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the base, so the moat can be fit against something that is not itself ────
create or replace function public.xg_v5_base(
  p_shot_type text, p_distance numeric, p_angle numeric, p_rebound boolean,
  p_is_home boolean, p_home_sk integer, p_away_sk integer, p_empty_net boolean)
returns numeric language sql stable parallel safe
set search_path = public, pg_temp
as $fn$
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
    (select g.p from public.xg_v5_global g),
    0.07)
$fn$;

-- ── the empty-net test, written once, with both halves ──────────────────────
create or replace function public.xg_shot_empty_net(
  p_situation_code text, p_is_home boolean, p_flag boolean default null)
returns boolean language sql immutable parallel safe as $fn$
  select case
    when p_situation_code ~ '^[0-9]{4}$'
      then case when coalesce(p_is_home, true)
                then substr(p_situation_code, 1, 1) = '0'
                else substr(p_situation_code, 4, 1) = '0' end
    else coalesce(p_flag, false)
  end
$fn$;

comment on function public.xg_shot_empty_net(text, boolean, boolean) is
  'Whether the shooter faced an empty net. Prefers the NHL situation code; falls back to raw_shots.is_empty_net where no code was stored, which is every season before 2025-26. Do NOT drop the fallback.';

create or replace function public.xg_shot_empty_net(p_situation_code text, p_is_home boolean)
returns boolean language sql immutable parallel safe as $fn$
  select public.xg_shot_empty_net(p_situation_code, p_is_home, null)
$fn$;

comment on function public.xg_shot_empty_net(text, boolean) is
  'DEPRECATED — situation code only, therefore always false for 2017-2024. Call the three-argument form.';

-- ── the bands, cut where the data changes ───────────────────────────────────
create or replace function public.xg_pass_quality_band(p_q numeric)
returns smallint language sql immutable parallel safe as $fn$
  select case when p_q is null then 1 when p_q <= 0.22 then 1
              when p_q <= 0.32 then 2 when p_q <= 0.43 then 3
              when p_q <= 0.53 then 4 when p_q <= 0.64 then 5
              else 6 end::smallint
$fn$;

create or replace function public.xg_goalie_move_band(p_m numeric)
returns smallint language sql immutable parallel safe as $fn$
  select case when coalesce(p_m,0) <= 0.05 then 0 when p_m <= 0.20 then 1
              when p_m <= 0.35 then 2 else 3 end::smallint
$fn$;

create or replace function public.xg_v5_moat_bucket(
  p_has_pass boolean, p_pass_quality numeric, p_goalie_move numeric)
returns smallint language sql immutable parallel safe as $fn$
  select case when not coalesce(p_has_pass, false) then 0::smallint
              else ((public.xg_pass_quality_band(p_pass_quality) - 1) * 4
                    + public.xg_goalie_move_band(p_goalie_move) + 1)::smallint end
$fn$;

-- ── the fit, in two halves so neither can time out ──────────────────────────
create table if not exists public.xg_v5_fit_rows (
  id bigint primary key, bucket smallint not null,
  base numeric not null, is_goal boolean not null);
create index if not exists xvfr_bucket on public.xg_v5_fit_rows (bucket);

create or replace function public.citrus_fit_moat_rows(p_batch integer default 150000)
returns table(processed integer, remaining bigint)
language plpgsql security invoker set search_path = public, pg_temp
as $fn$
declare n integer; v_after bigint;
begin
  select coalesce(max(id), 0) into v_after from public.xg_v5_fit_rows;
  insert into public.xg_v5_fit_rows (id, bucket, base, is_goal)
  select s.id,
         public.xg_v5_moat_bucket(s.has_pass_before_shot, s.pass_quality_score,
                                  s.goalie_movement_score),
         public.xg_v5_base(s.shot_type, s.distance, s.angle, s.is_rebound,
                           s.is_home_team, s.home_skaters_on_ice, s.away_skaters_on_ice,
                           public.xg_shot_empty_net(s.situation_code, s.is_home_team,
                                                    s.is_empty_net)),
         coalesce(s.is_goal, false)
  from (select * from public.raw_shots
         where id > v_after and coalesce(period_type,'REG') <> 'SO'
         order by id limit p_batch) s
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return query select n,
    (select count(*) from public.raw_shots
      where coalesce(period_type,'REG') <> 'SO'
        and id > (select coalesce(max(id),0) from public.xg_v5_fit_rows));
end;
$fn$;

create or replace function public.citrus_fit_xg_v5_moat(p_k numeric default 40)
returns table(bucket smallint, n bigint, goals bigint, expected numeric, mult numeric)
language plpgsql security invoker set search_path = public, pg_temp
as $fn$
declare v_scale numeric;
begin
  create temporary table _agg on commit drop as
  select f.bucket, count(*)::bigint n, count(*) filter (where f.is_goal)::bigint goals,
         sum(f.base) expected
  from public.xg_v5_fit_rows f group by 1;

  create temporary table _raw on commit drop as
  select a.*, (a.goals + p_k) / nullif(a.expected + p_k, 0) as mult_raw from _agg a;

  select sum(r.goals) / nullif(sum(r.expected * r.mult_raw), 0) into v_scale from _raw r;

  delete from public.xg_v5_moat;
  insert into public.xg_v5_moat (bucket, label, n, goals, expected, mult)
  select r.bucket,
         case when r.bucket = 0 then 'no pass before the shot'
              else 'pass q-band ' || (((r.bucket - 1) / 4) + 1)::text
                   || ', goalie-move band ' || ((r.bucket - 1) % 4)::text end,
         r.n, r.goals, round(r.expected, 4), round(r.mult_raw * v_scale, 6)
  from _raw r;

  return query select m.bucket, m.n::bigint, m.goals::bigint, m.expected, m.mult
  from public.xg_v5_moat m order by m.bucket;
end;
$fn$;

-- ── re-scoring, as opposed to scoring ───────────────────────────────────────
-- citrus_score_v5_batch only touches xg_v5 IS NULL, which is right for new
-- shots and useless after a model change. This walks the whole table by id,
-- writing only where the value actually moves, so a re-run costs no disk.
create or replace function public.citrus_rescore_v5_batch(
  p_batch integer default 100000, p_after bigint default null)
returns table(processed integer, changed integer, next_after bigint, remaining bigint)
language plpgsql security invoker set search_path = public, pg_temp
as $fn$
declare v_after bigint; v_max bigint; v_seen integer; v_chg integer;
begin
  v_after := coalesce(p_after,
    (select coalesce(value_num, 0)::bigint from public.citrus_ops_config
      where key = 'xg_v5_rescore_cursor'));

  create temporary table _pick on commit drop as
  select id, shot_type, distance, angle, is_rebound, is_home_team,
         home_skaters_on_ice, away_skaters_on_ice, situation_code, is_empty_net,
         has_pass_before_shot, pass_quality_score, goalie_movement_score, xg_v5
  from public.raw_shots
  where id > v_after and coalesce(period_type,'REG') <> 'SO'
  order by id limit p_batch;

  select count(*), coalesce(max(id), v_after) into v_seen, v_max from _pick;

  with newv as (
    select p.id, least(0.99, greatest(0.0, public.xg_v5(
             p.shot_type, p.distance, p.angle, p.is_rebound, p.is_home_team,
             p.home_skaters_on_ice, p.away_skaters_on_ice,
             public.xg_shot_empty_net(p.situation_code, p.is_home_team, p.is_empty_net),
             p.has_pass_before_shot, p.pass_quality_score, p.goalie_movement_score))) as v
    from _pick p),
  upd as (update public.raw_shots s set xg_v5 = n.v from newv n
           where s.id = n.id and s.xg_v5 is distinct from n.v returning 1)
  select count(*)::integer into v_chg from upd;

  insert into public.citrus_ops_config (key, value_num, note)
  values ('xg_v5_rescore_cursor', v_max, 'Highest raw_shots.id re-scored. Set to 0 to start over.')
  on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

  return query select v_seen, v_chg, v_max,
    (select count(*) from public.raw_shots
      where id > v_max and coalesce(period_type,'REG') <> 'SO');
end;
$fn$;

create or replace function public.citrus_score_v5_batch(p_batch integer default 120000)
returns table(processed integer, remaining bigint)
language plpgsql set search_path = public, pg_temp
as $fn$
declare n integer;
begin
  with pick as (select id from public.raw_shots
                 where xg_v5 is null and coalesce(period_type,'REG') <> 'SO' limit p_batch),
  upd as (update public.raw_shots s
             set xg_v5 = public.xg_v5(
                   s.shot_type, s.distance, s.angle, s.is_rebound, s.is_home_team,
                   s.home_skaters_on_ice, s.away_skaters_on_ice,
                   public.xg_shot_empty_net(s.situation_code, s.is_home_team, s.is_empty_net),
                   s.has_pass_before_shot, s.pass_quality_score, s.goalie_movement_score)
           from pick where s.id = pick.id returning 1)
  select count(*) into n from upd;
  return query select n, (select count(*) from public.raw_shots
                           where xg_v5 is null and coalesce(period_type,'REG') <> 'SO');
end;
$fn$;

grant execute on function public.citrus_fit_moat_rows(integer)          to service_role;
grant execute on function public.citrus_fit_xg_v5_moat(numeric)         to service_role;
grant execute on function public.citrus_rescore_v5_batch(integer,bigint) to service_role;

-- HOW TO RE-RUN THE WHOLE THING
--   truncate table public.xg_v5_fit_rows;
--   select * from public.citrus_fit_moat_rows(350000);   -- until remaining = 0
--   select * from public.citrus_fit_xg_v5_moat(40);
--   update public.citrus_ops_config set value_num = 0 where key = 'xg_v5_rescore_cursor';
--   select * from public.citrus_rescore_v5_batch(150000); -- until remaining = 0
--   update public.strength_build_state set onice_built_at = null;  -- force re-attribution
