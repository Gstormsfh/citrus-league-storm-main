-- ═════════════════════════════════════════════════════════════════════════════
-- Two faults in raw_shots that hid behind each other.
--
--   1. Eight seasons could not be attributed at all, because two columns
--      rebuild_onice_xg requires were empty in every one of them.
--   2. The one season that COULD be attributed had its power plays on the
--      wrong bench, and nothing could see that until (1) was fixed.
--
-- ─── 1. THE COLUMNS THAT WERE NEVER COPIED ───────────────────────────────────
--
-- rebuild_onice_xg opens with
--     where s.time_in_period is not null
--       and s.period is not null
--       and s.event_owner_team_id is not null
-- and in raw_shots those two are populated in 2025-26 and nowhere else. Zero
-- rows in 2017-18 through 2024-25. Not an error that throws — a WHERE clause
-- that matches nothing:
--
--     player_onice_xg     seasons present: 2025
--     player_gar_inputs   seasons present: 2025
--
-- The shift backfill would have fetched charts for all 11,870 games and then
-- produced on-ice numbers for one season in nine, silently.
--
-- WHERE THE DATA WAS: public.nhl_shots. Not a redundant twin of raw_shots —
-- the table holding the fields raw_shots lacks, at full coverage in every
-- season, with strength_source reading 'pbp_situation_code' back to 2017-18.
-- The NHL situation code has been there the whole time. It simply never
-- crossed over.
--
-- VALIDATED AGAINST 2025-26, where raw_shots already holds the truth. Joining
-- on (game_id, event_id) across 118,772 shots:
--
--     event_owner_team_id = nhl_shots.team_id                    100.00%
--     is_home_team        = nhl_shots.is_home                    100.00%
--     situation code rebuilt from the four on-ice counts           99.96%
--
-- The clock needed working out: seconds_elapsed is the cumulative GAME clock.
-- time_in_period = seconds_elapsed - (period-1)*1200 reproduces the stored
-- value on 99.97% of rows, period by period.
--
-- COVERAGE AFTER: 92.15% (2019-20, the worst) to 100% (2025-26). The join does
-- not reach every row and the remainder keep their nulls;
-- citrus_shot_field_coverage() reports the gap per season so it stays a number
-- somebody can look at rather than a silence.
--
-- ─── 2. THE TRANSPOSED SKATER COUNTS ─────────────────────────────────────────
--
-- Having a situation code for every season made it possible, for the first
-- time, to check the stored skater counts against the NHL's own count. They
-- disagree on 23,562 shots in 2025-26 — and every one of the 23,562 is an
-- exact transposition:
--
--     situation_code   stored home / away    code home / away    shots
--     1451                  4 / 5                5 / 4           9,681
--     1541                  5 / 4                4 / 5           8,998
--     1560                  5 / 6                6 / 5           1,784
--     0651                  6 / 5                5 / 6           1,697
--
-- home_skaters_on_ice and away_skaters_on_ice are swapped for the whole
-- season. At five-on-five the swap is invisible, which is how it survived: it
-- only shows on the 19.8% of shots where the counts differ. On every one of
-- those, a man on the power play was modelled as a man killing a penalty.
--
-- xg_skater_edge(is_home, home_sk, away_sk) reads these, and it is one of the
-- five keys of the cell lookup. One shot in five in the season that opens on
-- 29 September was priced with the advantage pointing at the wrong bench.
--
-- The other eight seasons: 18 to 654 disagreements each, essentially none of
-- them transpositions. Ordinary edge cases, not an inversion.
--
--     season   mismatches   exact transpositions
--     2017            18            0
--     2018           193            0
--     2019         3,631          106
--     2020           654            0
--     2021           205            0
--     2022            50            0
--     2023            27            0
--     2024           137            0
--     2025        23,562       23,562     <-- all of them
--
-- This is the third fault tonight that traces to the 2025-26 ingest
-- specifically: is_empty_net over-flags there by 3.7x, the skater counts are
-- swapped there, and situation_code was populated there and nowhere else.
-- Whatever wrote that season did several things differently.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the backfill ────────────────────────────────────────────────────────────
create or replace function public.citrus_backfill_shot_fields(p_batch integer default 100000)
returns table(processed integer, changed integer, next_after bigint, remaining bigint)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare v_after bigint; v_max bigint; v_seen integer; v_chg integer;
begin
  v_after := (select coalesce(value_num,0)::bigint from public.citrus_ops_config
               where key = 'shot_field_backfill_cursor');

  create temporary table _pick on commit drop as
  select r.id, r.period, n.seconds_elapsed, n.team_id, n.is_home,
         n.own_skaters, n.opp_skaters, n.own_goalie, n.opp_goalie,
         r.time_in_period as cur_time, r.event_owner_team_id as cur_team,
         r.situation_code as cur_sc
  from (select id, period, time_in_period, event_owner_team_id, situation_code, game_id, event_id
          from public.raw_shots
         where id > v_after
           and (time_in_period is null or event_owner_team_id is null
                or situation_code is null or situation_code !~ '^[0-9]{4}$')
         order by id limit p_batch) r
  join public.nhl_shots n on n.game_id = r.game_id and n.event_id = r.event_id;

  select count(*), coalesce(max(id), v_after) into v_seen, v_max from _pick;

  -- the cursor advances over rows with nothing to fix as well, or a season
  -- with no match in nhl_shots would loop forever
  select coalesce(max(id), v_after) into v_max
  from (select id from public.raw_shots
         where id > v_after
           and (time_in_period is null or event_owner_team_id is null
                or situation_code is null or situation_code !~ '^[0-9]{4}$')
         order by id limit p_batch) z;

  with src as (
    select p.id,
           case when p.cur_time is null and p.seconds_elapsed is not null and p.period is not null
                then lpad((((p.seconds_elapsed - (p.period-1)*1200)) / 60)::text, 2, '0') || ':' ||
                     lpad((((p.seconds_elapsed - (p.period-1)*1200)) % 60)::text, 2, '0')
                else p.cur_time end as new_time,
           coalesce(p.cur_team, p.team_id) as new_team,
           case when (p.cur_sc is null or p.cur_sc !~ '^[0-9]{4}$')
                     and p.own_skaters is not null and p.opp_skaters is not null
                     and p.own_goalie  is not null and p.opp_goalie  is not null
                then case when p.is_home
                          then p.opp_goalie::text || p.opp_skaters::text
                             || p.own_skaters::text || p.own_goalie::text
                          else p.own_goalie::text || p.own_skaters::text
                             || p.opp_skaters::text || p.opp_goalie::text end
                else p.cur_sc end as new_sc
    from _pick p
    -- a negative period clock means the period number and the game clock
    -- disagree; leave those alone rather than storing a nonsense time
    where p.seconds_elapsed is null or p.period is null
       or p.seconds_elapsed - (p.period-1)*1200 between 0 and 1800
  ),
  upd as (
    update public.raw_shots s
       set time_in_period = src.new_time, event_owner_team_id = src.new_team,
           situation_code = src.new_sc
    from src
    where s.id = src.id
      and (s.time_in_period      is distinct from src.new_time
        or s.event_owner_team_id is distinct from src.new_team
        or s.situation_code      is distinct from src.new_sc)
    returning 1
  )
  select count(*)::integer into v_chg from upd;

  insert into public.citrus_ops_config (key, value_num, note)
  values ('shot_field_backfill_cursor', v_max,
          'Highest raw_shots.id examined by citrus_backfill_shot_fields. Set to 0 to start over.')
  on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

  return query select v_seen, v_chg, v_max,
    (select count(*) from public.raw_shots
      where id > v_max
        and (time_in_period is null or event_owner_team_id is null
             or situation_code is null or situation_code !~ '^[0-9]{4}$'));
end;
$fn$;

create or replace function public.citrus_shot_field_coverage()
returns table(season integer, shots bigint, has_time bigint, has_team bigint,
              has_situation bigint, attributable_pct numeric)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select r.season::integer, count(*)::bigint,
         count(*) filter (where r.time_in_period is not null)::bigint,
         count(*) filter (where r.event_owner_team_id is not null)::bigint,
         count(*) filter (where r.situation_code ~ '^[0-9]{4}$')::bigint,
         round(100.0 * count(*) filter (where r.time_in_period is not null
                                          and r.event_owner_team_id is not null
                                          and r.period is not null) / count(*), 2)
  from public.raw_shots r
  where coalesce(r.period_type,'REG') <> 'SO'
  group by 1 order by 1
$fn$;

insert into public.citrus_ops_config (key, value_num, note)
values ('shot_field_backfill_cursor', 0,
        'Highest raw_shots.id examined by citrus_backfill_shot_fields. Set to 0 to start over.')
on conflict (key) do update set value_num = 0, updated_at = now();

-- ── the transposition, undone ───────────────────────────────────────────────
update public.raw_shots s
   set home_skaters_on_ice = substr(s.situation_code, 3, 1)::int,
       away_skaters_on_ice = substr(s.situation_code, 2, 1)::int
 where s.situation_code ~ '^[0-9]{4}$'
   and coalesce(s.period_type,'REG') <> 'SO'
   and (s.home_skaters_on_ice is distinct from substr(s.situation_code, 3, 1)::int
     or s.away_skaters_on_ice is distinct from substr(s.situation_code, 2, 1)::int);

create or replace function public.citrus_shot_strength_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with m as (
    select season,
           count(*) filter (where home_skaters_on_ice is distinct from substr(situation_code,3,1)::int
                              or away_skaters_on_ice is distinct from substr(situation_code,2,1)::int) as bad,
           count(*) filter (where home_skaters_on_ice = substr(situation_code,2,1)::int
                              and away_skaters_on_ice = substr(situation_code,3,1)::int
                              and home_skaters_on_ice <> away_skaters_on_ice) as transposed,
           count(*) as n
    from public.raw_shots
    where situation_code ~ '^[0-9]{4}$' and coalesce(period_type,'REG') <> 'SO'
    group by 1
  )
  select 'shot_skater_counts_match_code'::text,
         case when sum(transposed) > 100 then 'fail'
              when sum(bad) > sum(n) * 0.01 then 'warn'
              else 'pass' end::text,
         sum(bad)::text || ' disagree, ' || sum(transposed)::text || ' transposed',
         'under 1% disagreeing, under 100 transposed'::text,
         'A transposed pair puts the power play on the wrong bench. 2025-26 had '
           || '23,562 of them before 2026-08-26 and five-on-five hid every one.'::text
  from m
$fn$;

-- ── two housekeeping items from the same night ──────────────────────────────
-- raw_shots is rewritten in full by the scoring drivers. The default autovacuum
-- threshold of 20% means 200,000 dead rows accumulate before cleanup even
-- starts, throttled, while the next batch is already running. That is how the
-- table went from 1.49 GB to 1.96 GB and filled the volume at 01:00:24.
alter table public.raw_shots set (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_vacuum_threshold     = 20000,
  autovacuum_vacuum_cost_delay    = 0,
  autovacuum_analyze_scale_factor = 0.10
);
alter table public.nhl_shots set (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_vacuum_threshold     = 20000,
  autovacuum_vacuum_cost_delay    = 0
);

-- Nine indexes with idx_scan = 0 since raw_shots was created in January 2025.
-- pg_stat_database reports stats_reset = NULL, so those counters run the whole
-- life of the project, and they demonstrably work on the same tables --
-- raw_shots_pkey shows 165,296 scans. Every one of these is a single-column
-- btree on a boolean or a low-cardinality category, which Postgres will not
-- use to find half a table. 214 MB, and an index entry to maintain on every
-- write, serving no query. Recreate statements are beside each drop.
drop index if exists public.idx_raw_shots_created_at;          -- (created_at)
drop index if exists public.idx_raw_shots_pass_zone;           -- (pass_zone)
drop index if exists public.idx_raw_shots_zone;                -- (zone)
drop index if exists public.idx_raw_shots_goalie_id;           -- (goalie_id)
drop index if exists public.idx_raw_shots_last_event_category; -- (last_event_category)
drop index if exists public.idx_raw_shots_has_pass;            -- (has_pass_before_shot)
drop index if exists public.idx_raw_shots_is_rush;             -- (is_rush)
drop index if exists public.idx_raw_shots_player_id;           -- (player_id)
drop index if exists public.idx_nhl_shots_goal;                -- nhl_shots (is_goal)

grant execute on function public.citrus_backfill_shot_fields(integer)  to service_role;
grant execute on function public.citrus_shot_field_coverage()          to anon, authenticated, service_role;
grant execute on function public.citrus_shot_strength_invariant()      to anon, authenticated, service_role;

-- HOW TO RUN THE BACKFILL
--   update public.citrus_ops_config set value_num = 0 where key = 'shot_field_backfill_cursor';
--   select * from public.citrus_backfill_shot_fields(200000);   -- until remaining = 0
--   select * from public.citrus_shot_field_coverage();
