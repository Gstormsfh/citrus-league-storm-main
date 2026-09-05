-- PLAYER OWNERSHIP (2026-09-05). Rostered% and started% across every Citrus
-- team that holds a roster (a completed draft), for the Press Box roster and
-- players rows: "100% · 99% | vs TOR 3RD". design_handoff README §4 and §5
-- named this as the data gap; nothing read it league-wide before.
--
-- Aggregate only: counts of teams, no team or manager identity leaves the
-- function, which is why SECURITY DEFINER is acceptable here. Measured on
-- prod the night it was written: 51 teams with rosters across 11 leagues;
-- McDavid rostered on 11 of them (22%), started on 9 of those (82%).
--
-- Read by GET /api/players/ownership (server PlayerService.getOwnership),
-- cached 10 minutes server-side. Until this migration runs the route
-- returns [] and the client hides the two percentages.

create or replace function public.get_player_ownership()
returns table (
  player_id text,
  rostered_teams int,
  started_teams int,
  total_teams int,
  rostered_pct int,
  started_pct int
)
language sql
stable
security definer
set search_path = public
as $$
  with active as (
    select distinct ra.team_id
    from public.roster_assignments ra
    join public.teams t on t.id = ra.team_id
    join public.leagues l on l.id = t.league_id
    where l.draft_status = 'completed'
  ),
  total as (select count(*)::int as n from active),
  rostered as (
    select ra.player_id::text as player_id, count(distinct ra.team_id)::int as n
    from public.roster_assignments ra
    join active a on a.team_id = ra.team_id
    group by 1
  ),
  started as (
    select (s.value #>> '{}') as player_id, count(distinct tl.team_id)::int as n
    from public.team_lineups tl
    join active a on a.team_id = tl.team_id
    cross join lateral jsonb_array_elements(tl.starters) as s
    group by 1
  )
  select
    r.player_id,
    r.n,
    coalesce(st.n, 0),
    (select n from total),
    round(100.0 * r.n / nullif((select n from total), 0))::int,
    round(100.0 * coalesce(st.n, 0) / nullif(r.n, 0))::int
  from rostered r
  left join started st on st.player_id = r.player_id;
$$;

revoke all on function public.get_player_ownership() from public;
revoke all on function public.get_player_ownership() from anon;
grant execute on function public.get_player_ownership() to authenticated;
grant execute on function public.get_player_ownership() to service_role;

comment on function public.get_player_ownership() is
  'Rostered/started percentages per player across every Citrus team with a roster. Aggregate counts only. Press Box roster + players rows (2026-09-05).';
