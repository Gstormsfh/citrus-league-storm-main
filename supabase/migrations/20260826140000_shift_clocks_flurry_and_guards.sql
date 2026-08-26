-- ═════════════════════════════════════════════════════════════════════════════
-- Three corrections and four new guards, all found by fixing something else.
--
-- ─── 1. toi_split_conservation was comparing two different measurements ──────
--
-- It read: sum(player_toi_by_state.toi_seconds) must not exceed
--          sum(player_shifts_official.duration_seconds)
-- and failed on 52 player-games.
--
-- But the split is not built from duration_seconds. rebuild_toi_by_state merges
-- the [start, end) intervals and intersects them with the strength timeline. So
-- the left side is measured in start-and-end seconds and the right side in the
-- NHL's stated duration, and over 2,311 shift rows in three 2021-22 games, 62
-- carry a duration exactly ONE SECOND short of (end - start). Sixty-two rounded
-- seconds produced the 52 failures. Nothing was over-counted.
--
-- Corrected to compare like with like: greatest(stated duration, end - start).
-- A real over-count — a shift counted twice, an interval intersected twice —
-- still breaks it.
--
-- ─── 2. seventeen shifts whose clocks had come apart ─────────────────────────
--
-- Correcting (1) surfaced this. Of 5,856,843 shifts, 81 disagreed at all, 64 of
-- those by exactly one second, and seventeen by more:
--
--   A. six rows, two games, 2018-19 and 2019-20
--      start = 0, end = 0, duration = 300 to 1200 seconds. No clock parsed at
--      all. Goalies, by the length — and the split gave them ZERO seconds where
--      the chart says twenty minutes.
--   B. ten rows, six games, all 2025-26
--      start = 0 with a sane end and a much smaller duration — end 12:16,
--      duration 00:02. start_time reads exactly '00:00', which is the tell. The
--      span counts from the opening faceoff and inflates that player's period
--      by up to 734 seconds.
--   C. one row, 2019-20: start 0, end 38, duration 938. Reading the rest of
--      that goalie's game settles it — the other goalie played the third out and
--      then 38 seconds of overtime, so this row has the overtime end and 938
--      with its leading digit gone. He was pulled at 15:38 of the third.
--
-- THE RULE, which C is what made visible:
--   end_time present  ->  trust the end, move the start   (B)
--   end_time NULL     ->  trust the duration, move the end (A and C)
--
-- Written as citrus_repair_shift_clocks() rather than a one-off UPDATE, because
-- the backfill kept arriving with more — 74 disagreements and a worst case of
-- 749 seconds an hour after the first seventeen were fixed. A repair that runs
-- once is not a repair, it is a moment. It now runs in the nightly pipeline.
--
-- Every repair is recorded in shift_clock_repairs with its original values, and
-- every touched game re-derives. A row whose arithmetic would land outside the
-- period, or would not reproduce its own duration, is left alone and keeps
-- failing the invariant until somebody looks at it.
--
-- ─── 3. the flurry columns were copies ───────────────────────────────────────
--
--   coalesce(sum(xg) filter (where is_for), 0),      -- xgf
--   coalesce(sum(xg) filter (where is_for), 0),      -- xgf_flurry   IDENTICAL
--
-- Worse than leaving them null, because anything reading them believes they are
-- adjusted. Expected goals are summed as though every shot were independent;
-- inside a scramble they are not. Three shots of 0.20 in four seconds are not
-- 0.60 expected goals — the sequence yields a goal with probability
-- 1 - 0.80^3 = 0.488, and the sum overstates it by a quarter. Players who live
-- at the net front collect the most of that inflation, which is exactly the
-- population a fantasy product must price correctly.
--
-- Now: a team's shots within a period are grouped into sequences where
-- consecutive shots arrive three seconds or less apart, the sequence's true
-- probability is computed, and each shot is scaled so the sequence totals that.
-- Three seconds is where the data changes — a shot within two seconds of
-- another converts at 8.6% to 23.0% by season against 5.9% to 6.8% for
-- everything else, and the lift has largely decayed by four. Measured effect:
-- the adjusted total runs about 1.5% below the raw one.
--
-- xgf and xga keep the unadjusted sums, because "how much did this player
-- generate" and "how many goals should this have produced" are different
-- questions and both get asked.
--
-- ─── AND MONEYPUCK LEAVES THE SIGNATURE ──────────────────────────────────────
--
-- The shot value came through citrus_xg(s.xg_v5, s.xg_honest, s.xg_value), and
-- citrus_xg returns coalesce(p_v5, 0) — it ignores the other two. The number
-- was already ours. But xg_value is the column that reads the outcome and
-- xg_honest is the retired bridge trained against theirs, and passing them in
-- meant a reader could not tell that from the code, and one edit to citrus_xg
-- could put them back in the answer without anything failing.
--
-- It reads s.xg_v5 and nothing else now, and citrus_moneypuck_separation()
-- enforces it: no view may read either column, no function may outside a named
-- comparison set, and citrus_xg must return the v5 argument.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the repairs table and the repair ────────────────────────────────────────
create table if not exists public.shift_clock_repairs (
  game_id     integer not null,
  player_id   integer not null,
  period      smallint not null,
  shift_id    bigint  not null,
  pattern     text    not null,
  old_start   integer not null,
  old_end     integer not null,
  duration_s  integer not null,
  new_start   integer not null,
  new_end     integer not null,
  repaired_at timestamptz not null default now(),
  primary key (shift_id)
);

comment on table public.shift_clock_repairs is
  'Every shift whose start/end seconds were corrected because they disagreed with the row''s own duration. Keeps the original values so any repair can be audited or undone.';

drop function if exists public.citrus_repair_shift_clocks(integer);

create function public.citrus_repair_shift_clocks(p_tolerance integer default 2)
returns table(out_pattern text, out_repaired integer, out_games integer)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
begin
  create temporary table _fix on commit drop as
  with broken as (
    select shift_id, game_id, player_id, period,
           shift_start_time_seconds st, shift_end_time_seconds en,
           duration_seconds d, end_time
    from public.player_shifts_official
    where duration_seconds is not null
      and abs(duration_seconds - (shift_end_time_seconds - shift_start_time_seconds)) > p_tolerance
  ),
  proposed as (
    select b.*,
           case when b.end_time is not null then 'B: start lost, end kept'
                else 'A/C: end_time lost, duration kept' end as pat,
           case when b.end_time is not null then b.en - b.d else 0 end   as new_st,
           case when b.end_time is not null then b.en       else b.d end as new_en
    from broken b
  )
  select * from proposed p
  where p.new_st >= 0 and p.new_en > p.new_st and p.new_en <= 1800
    and p.new_en - p.new_st = p.d;

  insert into public.shift_clock_repairs
        (game_id, player_id, period, shift_id, pattern,
         old_start, old_end, duration_s, new_start, new_end)
  select f.game_id, f.player_id, f.period, f.shift_id, f.pat,
         f.st, f.en, f.d, f.new_st, f.new_en
  from _fix f
  on conflict (shift_id) do nothing;

  update public.player_shifts_official s
     set shift_start_time_seconds = f.new_st,
         shift_end_time_seconds   = f.new_en
  from _fix f
  where s.shift_id = f.shift_id
    and (s.shift_start_time_seconds, s.shift_end_time_seconds)
        is distinct from (f.new_st, f.new_en);

  update public.strength_build_state
     set toi_built_at = null, onice_built_at = null
   where game_id in (select distinct f.game_id from _fix f);

  return query
    select f.pat, count(*)::integer, count(distinct f.game_id)::integer
    from _fix f group by 1;
end;
$fn$;

-- ── the guards ──────────────────────────────────────────────────────────────
create or replace function public.citrus_shift_duration_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select 'shift_duration_agreement'::text,
         case when count(*) = 0 then 'pass'
              when count(*) filter (where d <> 0) > count(*) * 0.01 then 'warn'
              when max(abs(d)) > 2 then 'warn'
              else 'pass' end::text,
         count(*) filter (where d <> 0)::text || ' of ' || count(*)::text
           || ' shifts differ, worst ' || coalesce(max(abs(d))::text, '0') || 's',
         'under 1% differing, none by more than 2s'::text,
         'duration_seconds against (shift_end_time_seconds - shift_start_time_seconds). '
           || 'The NHL rounds its own stated duration down by a second on a small number '
           || 'of shifts; anything larger means the two clocks have come apart.'::text
  from (select duration_seconds - (shift_end_time_seconds - shift_start_time_seconds) as d
        from public.player_shifts_official where duration_seconds is not null) z
$fn$;

create or replace function public.citrus_flurry_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with t as (
    select sum(xgf) raw, sum(xgf_flurry) adj, count(*) n,
           count(*) filter (where xgf_flurry > xgf + 0.0001) as adj_exceeds_raw
    from public.player_onice_xg
  )
  select 'flurry_adjustment_applied'::text,
         case when n = 0 then 'info'
              when adj_exceeds_raw > 0 then 'fail'
              when raw = 0 then 'info'
              when adj / raw between 0.90 and 0.995 then 'pass'
              else 'fail' end::text,
         case when n = 0 then 'nothing built yet'
              else 'adjusted / raw = ' || round(adj / nullif(raw,0), 4)::text end,
         '0.90 - 0.995, and never above raw'::text,
         'The flurry adjustment removes the double-count inside a scramble, so the '
           || 'adjusted total is always a little below the raw one. Equal to it means '
           || 'the columns are copies again, which is what they were until 2026-08-26.'::text
  from t
$fn$;

create or replace function public.citrus_ingest_quality_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with q as (
    select count(*) n,
           count(*) filter (where verdict <> 'good') bad,
           count(*) filter (where verdict <> 'good' and n_shifts < 300) short_chart
    from public.shift_ingest_quality
  )
  select 'shift_ingest_quality'::text,
         case when n = 0 then 'info'
              when bad::numeric / n > 0.02  then 'fail'
              when bad::numeric / n > 0.005 then 'warn'
              else 'pass' end::text,
         bad::text || ' of ' || n::text || ' not good ('
           || round(100.0*bad/nullif(n,0), 2)::text || '%), '
           || short_chart::text || ' with a short chart',
         'under 0.5% not good'::text,
         'A game that is not good stays on games_needing_shifts and retries on the next '
           || 'run by itself. A chart under 300 shifts is a truncated response from the '
           || 'endpoint, not a defect in our copy — the play-by-play and boxscore for '
           || 'those games are complete.'::text
  from q
$fn$;

grant execute on function public.citrus_repair_shift_clocks(integer)     to service_role;
grant execute on function public.citrus_shift_duration_invariant()       to anon, authenticated, service_role;
grant execute on function public.citrus_flurry_invariant()               to anon, authenticated, service_role;
grant execute on function public.citrus_ingest_quality_invariant()       to anon, authenticated, service_role;

-- rebuild_onice_xg and citrus_moneypuck_separation are applied to production and
-- recorded in supabase_migrations.schema_migrations under
-- 'onice_flurry_real_and_moneypuck_free' and 'moneypuck_separation_invariant',
-- which are the authoritative texts.
