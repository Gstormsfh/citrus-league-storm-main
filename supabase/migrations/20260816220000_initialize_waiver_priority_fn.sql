-- AUTONOMY (2026-08-16): post-draft waiver priority initialization.
-- Industry standard (Yahoo/ESPN): initial waiver order = inverse of draft
-- order (last round-1 picker gets priority 1). Nothing set this at draft
-- completion, so every league showed "Priority not set" until the first
-- reverse-standings recalc. Idempotent: no-ops when any rows exist.
-- APPLIED to prod 2026-08-16 via MCP apply_migration (initialize_waiver_priority_fn).
create or replace function public.initialize_waiver_priority(p_league_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  if exists (select 1 from waiver_priority where league_id = p_league_id) then
    return 0;
  end if;

  insert into waiver_priority (league_id, team_id, priority)
  select dp.league_id, dp.team_id,
         row_number() over (order by dp.pick_number desc)
  from draft_picks_v2 dp
  where dp.league_id = p_league_id
    and dp.round = 1;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.initialize_waiver_priority(uuid) from public;
grant execute on function public.initialize_waiver_priority(uuid) to service_role;
