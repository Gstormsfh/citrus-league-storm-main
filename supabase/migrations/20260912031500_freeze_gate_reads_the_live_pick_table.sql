-- 20260912031500 — the change-freeze gate can see the live draft engine.
--
-- `draft_freeze_blockers` is the decider behind scripts/check_draft_freeze.ts,
-- the hard-fail step that refuses a production deploy during a draft. It is the
-- protection docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md §4 asked for after ten
-- deploys landed in the 2.5 hours before the inaugural draft.
--
-- It has been reading an empty table.
--
-- Reason 2 ("in progress AND demonstrably moving") takes max(picked_at) from
-- `draft_picks`. Every draft run since the v2 engine landed writes to
-- `draft_picks_v2` instead, and carries ZERO legacy rows. Measured in
-- production 2026-09-12:
--
--     IPAD TEST            0 legacy / 38 v2    newest 2026-09-11 23:22
--     Tester DYN           0 legacy / 228 v2   newest 2026-09-11 20:26
--     FHP Tester           0 legacy / 228 v2   newest 2026-09-11 17:11
--     Keeper Test          0 legacy / 168 v2   newest 2026-09-10 16:20
--
-- So max(picked_at) was always null and reason 2 could never match. The same
-- mistake runs the other way in reason 3, whose `NOT EXISTS (draft_picks ...)`
-- is now always TRUE, so it fires for the full p_live_hours whether or not the
-- draft has started picking.
--
-- Net effect before this migration: a live draft was detected only if it had a
-- scheduled start inside the last 6 hours. A room the commissioner opened by
-- hand was invisible to the RPC entirely, and was caught only by a raw
-- draft_status read in deploy-engine.yml -- a second decider that could
-- disagree with this one, and that carried no staleness bound, so a league
-- stuck at in_progress blocked every deploy until someone edited the row.
--
-- Three changes:
--   1. Both pick generations are unioned once, in `picks`, and every reason
--      reads that. `draft_picks` still holds rows for 15 older leagues so it
--      cannot simply be dropped from the query.
--   2. A fourth reason covers the hand-opened room: in progress, no picks in
--      either table, and a pick_deadline recent enough to mean the room is
--      genuinely open. start_draft_v2 sets pick_deadline on ignition, so its
--      age is a real liveness signal -- and bounding on it is what stops a
--      zombie in_progress league from blocking deploys forever.
--   3. Reason 4 explicitly excludes what reason 3 already matched, so a
--      scheduled draft is listed once rather than twice.
--
-- draft_picks_v2 has no deleted_at by design: it is a projection of
-- draft_events, and an undone pick is removed by re-projection rather than
-- flagged. Only the legacy table needs the deleted_at filter.

create or replace function public.draft_freeze_blockers(
  p_upcoming_hours integer default 24,
  p_live_hours integer default 6
)
returns table (league_id uuid, league_name text, reason text, at_time timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with picks as (
    select d.league_id, d.picked_at from public.draft_picks d where d.deleted_at is null
    union all
    select v.league_id, v.picked_at from public.draft_picks_v2 v
  )

  -- 1. a draft scheduled inside the freeze window
  select l.id, l.name,
         'draft scheduled within ' || p_upcoming_hours || 'h',
         l.scheduled_draft_time
    from public.leagues l
   where l.scheduled_draft_time is not null
     and l.scheduled_draft_time >= now()
     and l.scheduled_draft_time <= now() + make_interval(hours => p_upcoming_hours)

  union all

  -- 2. a draft that is in progress AND demonstrably moving
  select l.id, l.name,
         'draft in progress, last pick ' ||
           round(extract(epoch from (now() - p.last_pick)) / 60.0)::text || ' min ago',
         p.last_pick
    from public.leagues l
    join lateral (
      select max(x.picked_at) as last_pick from picks x where x.league_id = l.id
    ) p on true
   where l.draft_status = 'in_progress'
     and p.last_pick is not null
     and p.last_pick >= now() - make_interval(hours => p_live_hours)

  union all

  -- 3. in progress, no picks yet, but its scheduled start has just passed --
  --    the window where the room is open and the first pick is pending
  select l.id, l.name,
         'draft in progress, scheduled start just passed, no picks yet',
         l.scheduled_draft_time
    from public.leagues l
   where l.draft_status = 'in_progress'
     and l.scheduled_draft_time is not null
     and l.scheduled_draft_time >= now() - make_interval(hours => p_live_hours)
     and l.scheduled_draft_time <= now()
     and not exists (select 1 from picks x where x.league_id = l.id)

  union all

  -- 4. in progress, no picks yet, opened by hand rather than on a schedule.
  --    Bounded by pick_deadline so a league stuck at in_progress ages out of
  --    the gate instead of blocking every deploy indefinitely.
  select l.id, l.name,
         'draft in progress, room opened ' ||
           round(extract(epoch from (now() - l.pick_deadline)) / 60.0)::text ||
           ' min past first deadline, no picks yet',
         l.pick_deadline
    from public.leagues l
   where l.draft_status = 'in_progress'
     and l.pick_deadline is not null
     and l.pick_deadline >= now() - make_interval(hours => p_live_hours)
     and not exists (select 1 from picks x where x.league_id = l.id)
     and not (
       l.scheduled_draft_time is not null
       and l.scheduled_draft_time >= now() - make_interval(hours => p_live_hours)
       and l.scheduled_draft_time <= now()
     );
$function$;

-- Same signature, so CREATE OR REPLACE keeps existing privileges. Re-asserted
-- anyway: this function reads every league and must never be callable by anon.
revoke all on function public.draft_freeze_blockers(integer, integer) from public;
revoke all on function public.draft_freeze_blockers(integer, integer) from anon;
revoke all on function public.draft_freeze_blockers(integer, integer) from authenticated;
grant execute on function public.draft_freeze_blockers(integer, integer) to service_role;
