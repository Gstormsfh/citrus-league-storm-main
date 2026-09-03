#!/usr/bin/env bash
# CITRUS-CLASSIFICATION ----------------------------------------------------------
# CATEGORY: PROOF (scratch Postgres only; never points at a Supabase project)
# Purpose:     Prove 20260903180000_talent_metrics_rebuild_preserves_columns.sql
#              against prod-shaped tables: the old body wipes every column it
#              does not own, the new body preserves them, refreshes xg_per_60 /
#              xg_rating / both timestamps, removes players outside the TOI set,
#              and is idempotent. Exit 0 = PASS.
# Last active: 2026-09-03
# Invoked:     PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash scripts/proof/talent-metrics-rebuild-preserves-columns.proof.sh
# Reads:       supabase/migrations/20260903180000_talent_metrics_rebuild_preserves_columns.sql
#              supabase/migrations/captures/2026-09-03_pre_talent_metrics_rebuild_preserves_columns.sql
# Writes:      scratch database tm_proof (dropped and recreated)
# ----------------------------------------------------------------------------
# Column types below were harvested from production information_schema on
# 2026-09-03, not composed (INS-16). If player_talent_metrics gains a column,
# add it here so the preservation assertion covers it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260903180000_talent_metrics_rebuild_preserves_columns.sql"
CAP="$ROOT/supabase/migrations/captures/2026-09-03_pre_talent_metrics_rebuild_preserves_columns.sql"
P0="psql -v ON_ERROR_STOP=1 -qX"
$P0 -c "drop database if exists tm_proof;"
$P0 -c "create database tm_proof;"
P="$P0 -d tm_proof"
$P <<'SQL'
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
create table public.player_game_stats (
  player_id integer not null, game_id integer not null,
  nhl_toi_seconds integer not null default 0, is_goalie boolean not null default false);
create table public.player_xg_season (
  player_id integer not null, season integer not null, game_type text not null, xg double precision not null);
create table public.player_talent_metrics (
  player_id integer not null, season integer not null default 2025,
  ros_projection_xg numeric, talent_adjusted_xg_per_60 numeric, avg_toi_per_game numeric,
  calculated_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  gp_last_10 integer default 0, is_likely_to_play boolean default false, last_updated date,
  positional_replacement_level numeric, positional_std_dev numeric, vopa_score numeric,
  vopa_calculation_date date, created_at timestamptz not null default now(),
  roster_status text, is_ir_eligible boolean default false, roster_status_updated_at timestamptz,
  xg_per_60 numeric, xg_rating text, roster_status_source text,
  constraint player_talent_metrics_pkey primary key (player_id, season));
insert into public.player_game_stats values
  (8478402, 2025020001, 1200, false), (8478402, 2025020002, 1300, false),
  (8477934, 2025020001,  900, false), (8477934, 2025020002, 1000, false),
  (8471675, 2025020001, 15000, false),
  (8476945, 2025020001, 3600, true);
insert into public.player_xg_season values
  (8478402, 2025, 'regular', 30.5), (8477934, 2025, 'regular', 12.0), (8471675, 2025, 'regular', 1.0);
SQL
land_writers() {
$P <<'SQL'
insert into public.player_talent_metrics (player_id, season, roster_status, is_ir_eligible, roster_status_source,
  vopa_score, avg_toi_per_game, gp_last_10, positional_replacement_level)
values (8478402, 2025, 'IR', true, 'nhl_api', 4.20, 20.8, 9, 1.1)
on conflict (player_id, season) do update set
  roster_status = excluded.roster_status, is_ir_eligible = excluded.is_ir_eligible,
  roster_status_source = excluded.roster_status_source, vopa_score = excluded.vopa_score,
  avg_toi_per_game = excluded.avg_toi_per_game, gp_last_10 = excluded.gp_last_10,
  positional_replacement_level = excluded.positional_replacement_level;
insert into public.player_talent_metrics (player_id, season, xg_per_60, vopa_score) values (8400000, 2025, 0.5, 9.9)
on conflict do nothing;
update public.player_talent_metrics set xg_per_60 = 999, xg_rating = 'STALE', last_updated = '2020-01-01' where player_id = 8478402;
SQL
}
echo "[1] old body (capture) reproduces the wipe"
$P -f "$CAP"
$P -c "select * from public.rebuild_player_talent_metrics(2025);" >/dev/null
land_writers
$P -c "select * from public.rebuild_player_talent_metrics(2025);" >/dev/null
$P <<'SQL'
do $$ begin
  if exists (select 1 from public.player_talent_metrics where player_id = 8478402 and roster_status is not null) then
    raise exception 'UNEXPECTED: old body preserved roster_status; capture may not be the live body';
  end if;
  raise notice 'old body wiped foreign columns (expected)';
end $$;
SQL
echo "[2] apply migration, run new body, assert preservation"
land_writers
$P -f "$MIG"
$P -c "select * from public.rebuild_player_talent_metrics(2025);"
$P <<'SQL'
do $$ declare r record; begin
  select * into r from public.player_talent_metrics where player_id = 8478402 and season = 2025;
  if r.roster_status <> 'IR' or r.is_ir_eligible is not true or r.roster_status_source <> 'nhl_api'
     or r.vopa_score <> 4.20 or r.avg_toi_per_game <> 20.8 or r.gp_last_10 <> 9 or r.positional_replacement_level <> 1.1 then
    raise exception 'FAIL foreign columns not preserved: %', r; end if;
  if r.xg_per_60 <> 43.9200 or r.xg_rating is not null or r.last_updated <> current_date then
    raise exception 'FAIL owned columns not refreshed: %', r; end if;
  if exists (select 1 from public.player_talent_metrics where player_id = 8400000) then
    raise exception 'FAIL player outside TOI set not removed'; end if;
  if exists (select 1 from public.player_talent_metrics where player_id = 8476945) then
    raise exception 'FAIL goalie was rated'; end if;
  if (select count(*) from public.player_talent_metrics where season = 2025) <> 3 then
    raise exception 'FAIL expected 3 rows'; end if;
  raise notice 'PASS preservation, refresh, removal, goalie exclusion';
end $$;
SQL
echo "[3] idempotent re-apply + grants unchanged"
$P -f "$MIG" >/dev/null
$P -c "select * from public.rebuild_player_talent_metrics(2025);" >/dev/null
$P <<'SQL'
do $$ declare a aclitem[]; begin
  select proacl into a from pg_proc where proname = 'rebuild_player_talent_metrics';
  if a::text <> '{postgres=X/postgres,service_role=X/postgres}' then
    raise exception 'FAIL grants drifted: %', a; end if;
  raise notice 'PASS grants = postgres + service_role only';
end $$;
SQL
echo "ALL PASS"
