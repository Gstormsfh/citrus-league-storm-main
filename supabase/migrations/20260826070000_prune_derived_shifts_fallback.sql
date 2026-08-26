-- ─────────────────────────────────────────────────────────────────────────────
-- citrus_prune_derived_shifts — the fallback, if the disk cannot grow.
--
-- READ THIS BEFORE RUNNING IT. It is a downgrade. It is here because a
-- downgrade beats a backfill that dies at eighty percent.
--
-- WHAT IT DOES
--   Deletes raw shift rows for games whose every derivative has already been
--   built — strength timeline, TOI by state, on-ice attribution all present.
--   Those three are what the product reads. The raw chart is an intermediate,
--   and at full coverage it is 1.4 GB of intermediate.
--
-- WHY IT DOES NOT CAUSE RE-FETCHING
--   games_needing_shifts keys off shift_ingest_quality.verdict, not off the
--   presence of shift rows. A pruned game still reads 'good' and stays off the
--   work list. To deliberately bring a season back:
--       delete from public.shift_ingest_quality where game_id/1000000 = 2019;
--       python data-pipeline\acquisition\backfill_shifts.py --season 2019
--   About eighteen minutes a season at the rate measured on 2026-08-26.
--
-- WHAT IT COSTS — plainly
--   shift_toi_reconciliation goes blind on pruned games. That is the invariant
--   which proves the TOI split is right, by comparing our merged intervals
--   against the NHL's own per-game totals: 99.16% exact at last reading. A
--   pruned game keeps the verdict it earned at ingest and can no longer be
--   re-checked. So prune the seasons you will not re-audit and keep the current
--   one. p_keep_seasons defaults to 2025-26 for exactly that reason.
--
-- DISK BEHAVIOUR — what DELETE actually buys
--   Nothing is returned to the operating system. Pages become reusable by this
--   same table once autovacuum has been through, which is the point: the table
--   is still growing, and reused pages are pages it does not have to ask the
--   volume for. The aim is to make it plateau, not to hand disk back.
--
--   The default autovacuum threshold on a table this size is twenty percent —
--   1.8 million rows of waiting before anything is reclaimed. Under pressure
--   that is far too slow, hence the storage parameters below.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.player_shifts_official set (
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_vacuum_threshold     = 50000,
  autovacuum_vacuum_cost_delay    = 0,
  autovacuum_analyze_scale_factor = 0.05
);

create or replace function public.citrus_prune_derived_shifts(
  p_batch          integer   default 200,
  p_keep_seasons   integer[] default array[2025]
)
returns table(games_pruned integer, rows_deleted bigint, games_remaining bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_games integer[];
  v_rows  bigint;
begin
  select array_agg(game_id) into v_games
  from (
    select q.game_id
    from public.shift_ingest_quality q
    join public.strength_build_state s using (game_id)
    where q.verdict = 'good'
      and s.built_at       is not null
      and s.toi_built_at   is not null
      and s.onice_built_at is not null
      and not (q.game_id / 1000000 = any(coalesce(p_keep_seasons, '{}'::integer[])))
      and exists (select 1 from public.player_shifts_official o where o.game_id = q.game_id)
    order by q.game_id
    limit greatest(1, p_batch)
  ) z;

  if v_games is null then
    return query select 0, 0::bigint, 0::bigint;
    return;
  end if;

  delete from public.player_shifts_official where game_id = any(v_games);
  get diagnostics v_rows = row_count;

  return query
    select cardinality(v_games), v_rows,
           (select count(*)
              from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good'
               and s.built_at is not null and s.toi_built_at is not null
               and s.onice_built_at is not null
               and not (q.game_id / 1000000 = any(coalesce(p_keep_seasons, '{}'::integer[])))
               and exists (select 1 from public.player_shifts_official o
                            where o.game_id = q.game_id));
end;
$fn$;

comment on function public.citrus_prune_derived_shifts(integer, integer[]) is
  'FALLBACK ONLY. Deletes raw shift rows for fully-derived games outside the kept seasons. Costs the shift_toi_reconciliation audit on those games; recoverable by re-fetching the season. Prefer growing the disk.';

grant execute on function public.citrus_prune_derived_shifts(integer, integer[]) to service_role;
