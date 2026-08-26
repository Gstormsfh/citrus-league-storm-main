-- ─────────────────────────────────────────────────────────────────────────────
-- attic — where retired tables go instead of being dropped.
--
-- Eleven scratch, staging and backup tables were sitting in public: one-shot
-- migration staging from July, two dated backups from 11 August, a 117,672-row
-- xG recompute that was parked when the real fix turned out to be a nine-season
-- extractor rebuild, and four empty husks including one charmingly named
-- "_deprecated_public.players". None has an inbound foreign key, and a
-- repo-wide search finds live references to exactly none of them -- only two
-- one-shot utilities from the parked xG work and the migrations that created
-- them.
--
-- WHY MOVED AND NOT DROPPED
--   Everything that actually matters about being in public is fixed by
--   leaving it: PostgREST stops exposing them, generated types stop listing
--   them, RLS audits stop counting them, and a person reading the schema stops
--   having to work out which of four "deprecated 2025 skaters" tables is the
--   real one. Dropping buys nothing beyond that except the chance of being
--   wrong about a table nobody has looked at in a month.
--
--   Reversing this is one statement:
--       alter table attic.<name> set schema public;
--
-- KEPT IN public DELIBERATELY
--   integrity_check_results    the monitor's own log, actively written hourly
--   raw_shots_rebuild          empty, and the target of the pending 9-season
--                              extractor rebuild
--   _preshot_rebuild_baseline  the ledger that rebuild checks itself against
--   player_shifts              retired but not yet moved -- see the bottom of
--                              this file
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists attic;

comment on schema attic is
  'Retired tables. Nothing here is read by the application. Restore with: alter table attic.<name> set schema public;';

revoke all on schema attic from public, anon, authenticated;

do $$
declare
  t text;
  moved int := 0;
begin
  foreach t in array array[
    '_xg_recompute_2025',
    '_deprecated_staging_2024_skaters',
    '_deprecated_staging_2025_skaters',
    '_deprecated_staging_2024_goalies',
    '_deprecated_staging_2025_goalies',
    '_deprecated_public.players',
    '_deprecated_2025_Skaters',
    'phase0c_progress',
    'player_projected_stats_retired_phantoms',
    '_backup_ros_projections_20260811',
    '_backup_matchup_scores_20260811'
  ]
  loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      execute format('alter table public.%I set schema attic', t);
      moved := moved + 1;
    end if;
  end loop;
  raise notice 'moved % tables to attic', moved;
end $$;

do $mig$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'player_shifts') then
    execute $c$comment on table public.player_shifts is
  'RETIRED AND WRONG. Inferred from event participation by calculate_player_toi.py, not from shift charts. Reconciles with player_game_stats.nhl_toi_seconds for 4.0% of player-games; contains 19,688 "shifts" over five minutes. Superseded by player_shifts_official. Its only writer is orphaned - nothing imports calculate_player_toi.py. Do not read this table.'$c$;
  end if;
end $mig$;


-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONE STEP THAT WAITS FOR A PUSH
--
-- player_shifts is retired but still in public, because the copy of
-- freshness_sla.py that GitHub Actions runs still names it and would go looking
-- for a table that had moved out from under it. The code change is in this same
-- delivery: the SLA entry is removed and calculate_player_toi.py has moved to
-- scripts/_deprecated/ with a refusal at the top of it.
--
-- Once that is pushed and one hourly run has gone green, run:
--
--     alter table public.player_shifts set schema attic;
--
-- That is 351,759 rows and 133 MB of inferred intervals out of public, kept
-- intact in case anyone ever wants to see what the difference looked like.
-- ─────────────────────────────────────────────────────────────────────────────
