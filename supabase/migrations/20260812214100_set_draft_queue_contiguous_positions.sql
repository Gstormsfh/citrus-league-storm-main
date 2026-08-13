-- ARCHITECT 2026-08-12 — renumber queue positions contiguously.
--
-- The first cut assigned `position` from the input array's ordinality.
-- When DISTINCT ON dropped a duplicated player, its slot went with it:
-- input [A, B, A, C] stored positions 1, 2, 4 (verified against live
-- data). Functionally harmless — the unique index is satisfied and the
-- engine reads `order by position asc` — but "position is 1..N with no
-- holes" is an invariant a future reader will assume without checking,
-- and it costs one window function to actually be true.
create or replace function public.set_draft_queue(
  p_team_id uuid, p_player_ids integer[]
) returns integer language plpgsql security invoker set search_path to 'public'
as $function$
declare
  v_league_id uuid;
  v_written   int := 0;
  c_max_queue constant int := 200;
begin
  if p_team_id is null then
    raise exception 'set_draft_queue: p_team_id is required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_player_ids is not null
     and coalesce(array_length(p_player_ids, 1), 0) > c_max_queue then
    raise exception 'set_draft_queue: queue exceeds % entries', c_max_queue
      using errcode = 'program_limit_exceeded';
  end if;
  select t.league_id into v_league_id from public.teams t where t.id = p_team_id;
  if v_league_id is null then
    raise exception 'set_draft_queue: team not found or not visible'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.draft_queues where team_id = p_team_id;
  if p_player_ids is not null and coalesce(array_length(p_player_ids, 1), 0) > 0 then
    insert into public.draft_queues (team_id, league_id, position, player_id)
    select p_team_id, v_league_id,
           (row_number() over (order by d.ord))::smallint, d.pid
    from (select distinct on (pid) pid, ord
          from unnest(p_player_ids) with ordinality as u(pid, ord)
          order by pid, ord) d;
    get diagnostics v_written = row_count;
  end if;
  return v_written;
end;
$function$;
grant execute on function public.set_draft_queue(uuid, integer[]) to authenticated;
