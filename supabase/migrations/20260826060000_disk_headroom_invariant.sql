-- ─────────────────────────────────────────────────────────────────────────────
-- citrus_disk_invariants — the check that would have caught 2026-08-26.
--
-- WHY THIS EXISTS
--   At 01:00:24 the database filled, mid-backfill:
--       could not extend file "base/5/97935.1": No space left on device
--       could not write to data file for XID 22230546: No space left on device
--   The way we found out was a write failing. Nothing was watching the volume,
--   because nothing could: Postgres has no statvfs() in SQL and the postgres
--   role on Supabase is not superuser, so the size of the disk underneath is
--   simply not knowable from inside the database.
--
--   So the ceiling is told to us once — citrus_ops_config.disk_total_mb, set by
--   an operator from Settings -> Compute and Disk — and everything else is
--   measured against it.
--
-- THE HALF THAT SURPRISED US
--   WAL. 3.2 GB of it, on the same volume as the data, which is entirely normal
--   with max_wal_size = 4GB: Postgres retains recycled segments up to that
--   bound rather than deleting and re-creating them. Counting only
--   pg_database_size() understated the true footprint by nearly half.
--
-- SELF-CALIBRATION
--   shift_chain_growth does not carry a constant for "MB per game". It divides
--   what the three tables already hold by the games they already cover, and
--   multiplies by the games left. The estimate improves as coverage grows and
--   there is no number in here to rot.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.citrus_ops_config (
  key         text primary key,
  value_num   numeric,
  value_text  text,
  note        text,
  updated_at  timestamptz not null default now()
);

comment on table public.citrus_ops_config is
  'Operator-supplied facts the database cannot measure about itself. Set disk_total_mb from the Supabase dashboard (Settings -> Compute and Disk) whenever the disk is resized.';

insert into public.citrus_ops_config (key, value_num, note) values
  ('disk_total_mb', 8192,
   'Total volume size in MB, from the Supabase dashboard. NOT measurable from SQL. '
   'The value here is an assumption until an operator confirms it by setting '
   'value_text = ''confirmed''; the disk filled at roughly 3,965 MB of database '
   'plus 3,200 MB of WAL on 2026-08-26, which is consistent with 8 GB but does '
   'not prove it.'),
  ('disk_warn_pct', 80, 'Warn when database + WAL exceeds this share of the volume.'),
  ('disk_fail_pct', 90, 'Fail when database + WAL exceeds this share of the volume.')
on conflict (key) do nothing;

create or replace function public.citrus_disk_invariants()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_db_mb      numeric;
  v_wal_mb     numeric;
  v_total_mb   numeric;
  v_used_mb    numeric;
  v_warn_pct   numeric;
  v_fail_pct   numeric;
  v_pct        numeric;
  v_confirmed  boolean;
  v_games_all      bigint;
  v_games_shifts   bigint;
  v_games_derived  bigint;
  v_grow_mb        numeric;
  v_headroom_mb    numeric;
begin
  select pg_database_size(current_database())/1024.0/1024.0 into v_db_mb;
  select coalesce(sum(size),0)/1024.0/1024.0 from pg_ls_waldir() into v_wal_mb;

  select value_num, coalesce(value_text,'') = 'confirmed'
    into v_total_mb, v_confirmed
  from public.citrus_ops_config where key='disk_total_mb';
  select value_num into v_warn_pct from public.citrus_ops_config where key='disk_warn_pct';
  select value_num into v_fail_pct from public.citrus_ops_config where key='disk_fail_pct';
  v_total_mb  := coalesce(v_total_mb, 8192);
  v_warn_pct  := coalesce(v_warn_pct, 80);
  v_fail_pct  := coalesce(v_fail_pct, 90);
  v_confirmed := coalesce(v_confirmed, false);

  v_used_mb     := v_db_mb + v_wal_mb;
  v_pct         := round(100.0 * v_used_mb / nullif(v_total_mb,0), 1);
  v_headroom_mb := v_total_mb * (v_fail_pct/100.0) - v_used_mb;

  return query select
    'database_size'::text, 'info'::text,
    round(v_db_mb)::text || ' MB',
    '(reported, not judged here)'::text,
    'The data. Judged together with WAL by disk_headroom.'::text;

  return query select
    'wal_size'::text,
    case when v_wal_mb > v_total_mb * 0.35 then 'warn' else 'pass' end::text,
    round(v_wal_mb)::text || ' MB in ' || (select count(*)::text from pg_ls_waldir()) || ' segments',
    'under ' || round(v_total_mb * 0.35)::text || ' MB',
    'Recycled segments are retained up to max_wal_size (' || current_setting('max_wal_size')
      || '). They sit on the same volume as the data and are easy to forget.'::text;

  return query select
    'disk_headroom'::text,
    case when v_pct >= v_fail_pct then 'fail'
         when v_pct >= v_warn_pct then 'warn'
         else 'pass' end::text,
    round(v_used_mb)::text || ' MB of ' || round(v_total_mb)::text || ' MB (' || v_pct::text || '%)',
    'under ' || v_fail_pct::text || '%',
    case when v_confirmed then 'Ceiling confirmed from the dashboard.'
         else 'Ceiling is an ASSUMPTION of ' || round(v_total_mb)::text
              || ' MB, not a reading. Confirm it: update public.citrus_ops_config '
              || 'set value_num = <MB>, value_text = ''confirmed'' where key = ''disk_total_mb'';'
    end::text;

  select count(*) from public.raw_nhl_data                          into v_games_all;
  select count(distinct game_id) from public.player_shifts_official into v_games_shifts;
  select count(distinct game_id) from public.player_onice_xg        into v_games_derived;

  v_grow_mb :=
      case when v_games_shifts > 0
           then (pg_total_relation_size('public.player_shifts_official')/1024.0/1024.0)
                / v_games_shifts * greatest(0, v_games_all - v_games_shifts) else 0 end
    + case when v_games_derived > 0
           then ((pg_total_relation_size('public.player_toi_by_state')
                + pg_total_relation_size('public.player_onice_xg'))/1024.0/1024.0)
                / v_games_derived * greatest(0, v_games_all - v_games_derived) else 0 end;

  return query select
    'shift_chain_growth'::text,
    case when v_grow_mb > v_headroom_mb        then 'fail'
         when v_grow_mb > v_headroom_mb * 0.7  then 'warn'
         else 'pass' end::text,
    round(v_grow_mb)::text || ' MB still to write',
    round(greatest(v_headroom_mb,0))::text || ' MB of headroom',
    v_games_shifts::text || ' of ' || v_games_all::text || ' games charted, '
      || v_games_derived::text || ' derived. Rate measured from what is already '
      || 'stored, so it re-calibrates itself as coverage grows.'::text;

  return query
    with b as (
      select nsp.nspname||'.'||c.relname as tbl, s.n_live_tup, s.n_dead_tup
      from pg_class c
      join pg_namespace nsp on nsp.oid = c.relnamespace
      join pg_stat_user_tables s on s.relid = c.oid
      where c.relkind = 'r' and nsp.nspname in ('public','attic')
        and pg_total_relation_size(c.oid) > 100*1024*1024
    )
    select 'table_bloat'::text,
           case when max(dead_pct) >= 25 then 'fail'
                when max(dead_pct) >= 10 then 'warn'
                else 'pass' end::text,
           coalesce(max(dead_pct)::text, '0') || '% dead on '
             || coalesce((array_agg(tbl order by dead_pct desc))[1], '(no large tables)'),
           'under 25% dead'::text,
           'A full-table UPDATE on a wide table is what filled the disk on 2026-08-26. '
             || 'Vacuum between batches; do not let it accumulate.'::text
    from (select tbl, round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0), 1) as dead_pct
          from b) z;
end;
$fn$;

comment on function public.citrus_disk_invariants() is
  'Disk, WAL, projected growth and bloat. The volume size cannot be read from SQL — it comes from citrus_ops_config.disk_total_mb, which an operator sets from the Supabase dashboard.';

grant execute on function public.citrus_disk_invariants() to anon, authenticated, service_role;
grant select on public.citrus_ops_config to anon, authenticated, service_role;

-- ── two dead indexes, removed ────────────────────────────────────────────────
-- 28 and 7 lifetime scans against 1.2M rows, and every one of the seven
-- functions that touches player_shifts_official is scoped by game_id. They
-- were costing two B-tree maintenance operations per insert across a table
-- headed for nine million rows, and about 148 MB at full coverage, to serve
-- queries nothing makes.
drop index if exists public.idx_player_shifts_official_player;
drop index if exists public.idx_player_shifts_official_team;
