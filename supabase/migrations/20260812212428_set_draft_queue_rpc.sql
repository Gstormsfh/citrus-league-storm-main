-- ARCHITECT 2026-08-12 — atomic queue replacement.
--
-- The draft queue had been browser-localStorage-only since it shipped:
-- DraftQueue.tsx wrote `draft-queue-${leagueId}` and nothing ever read it
-- back. `draft_queues` existed, with correct RLS, and held 0 rows. A
-- manager who built a queue and then lost connection got ZERO benefit —
-- autopick never consulted it.
--
-- WHY AN RPC RATHER THAN CLIENT-SIDE delete+insert: draft_queues carries
-- TWO unique indexes, (team_id, player_id) and (team_id, position). A
-- reorder cannot be expressed as row updates without transiently
-- violating one. The only clean expression is delete-all-then-reinsert,
-- and over PostgREST that is two round trips with a window where the
-- queue is EMPTY. An autopick in that window would silently miss.
--
-- SECURITY INVOKER, deliberately: the existing policy ("Team owner
-- manages own queue", teams.owner_id = auth.uid()) governs both the
-- DELETE and the INSERT, so this cannot become a way around it.
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
    select p_team_id, v_league_id, t.ord::smallint, t.pid
    from (select distinct on (pid) pid, ord
          from unnest(p_player_ids) with ordinality as u(pid, ord)
          order by pid, ord) t
    order by t.ord;
    get diagnostics v_written = row_count;
  end if;
  return v_written;
end;
$function$;
grant execute on function public.set_draft_queue(uuid, integer[]) to authenticated;
