-- ─────────────────────────────────────────────────────────────────────────────
-- Two changes made because the backfill has to survive its own size.
--
-- The full nine-season shift backfill projects to roughly 2.9 GB of growth:
--   player_shifts_official   1.49 GB
--   player_toi_by_situation  0.79 GB
--   player_onice_xg          0.35 GB
--   player_toi_by_state      0.24 GB
-- on a database that returned "No space left on device" at 4 GB earlier tonight,
-- during a full-table update of raw_shots. A run that dies at hour two of three
-- is worse than one that never started, so both of the cheap savings are taken
-- before it starts.
--
-- 1. player_toi_by_situation becomes a view. It projected to 0.79 GB — more
--    than three times its own source — to hold three values already stored next
--    door, because it carried a bigserial, two timestamps and a numeric per
--    row. It has always been a projection of player_toi_by_state. Now it cannot
--    drift from it either.
--
-- 2. backfill_shifts.py stops writing start_time, end_time, duration and
--    team_abbrev on player_shifts_official. They are text restatements of the
--    integer seconds beside them and of team_id, nothing in the repo reads
--    them, and at full coverage they cost about 400 MB.
--
-- Together: about 1.2 GB less, and one fewer table that can disagree with
-- itself.
--
-- OPERATIONAL NOTE. Re-scoring raw_shots rewrites every row of a 166-column,
-- million-row table; several passes in a row bloated it from 1.4 GB to 1.96 GB
-- and filled the volume. Run VACUUM (ANALYZE) public.raw_shots after any full
-- re-score, and check disk headroom before starting a backfill of this size.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.rebuild_toi_by_situation(integer[]);
drop table if exists public.player_toi_by_situation;

create view public.player_toi_by_situation as
select player_id, game_id, state as situation, toi_seconds::numeric as toi_seconds,
       season, built_at as created_at, built_at as updated_at
from public.player_toi_by_state
where state in ('5v5', 'PP', 'PK');

comment on view public.player_toi_by_situation is
  'Legacy three-situation contract, now a view over player_toi_by_state so the two cannot disagree. Does not sum to total ice time: 4v4, 3v3 and empty-net time have never been in this table. The id column is gone; its only consumer was calculate_player_toi.py, which is retired.';

create or replace function public.citrus_build_toi_batch(p_batch integer default 150)
returns table(processed integer, remaining bigint)
language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare games integer[];
begin
  select array_agg(game_id) into games
  from (select q.game_id from public.shift_ingest_quality q
        join public.strength_build_state s using (game_id)
        where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null
        order by q.game_id limit p_batch) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_toi_by_state(games);
  update public.strength_build_state set toi_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null);
end;
$fn$;
