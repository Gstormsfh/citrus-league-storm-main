-- MOCK DRAFTS ARE REAL DRAFTS, BUT NOT REAL LEAGUES (2026-09-14)
--
-- A practice league (settings.practice = true) runs in the live V2 room on
-- the live engine so a manager can rehearse the real thing. Two places in
-- the database must stop treating it as a real league:
--
-- 1. draft_freeze_blockers. The deploy gate reads every league. A manager
--    who opens a mock at 9pm and closes the tab at 9:05 would otherwise
--    block production deploys for six hours ("draft in progress, last
--    pick 4 min ago"). Every branch of the gate now skips practice leagues.
--
-- 2. Lifecycle. A practice league is created for one draft and is never a
--    league anyone returns to. sweep_practice_leagues() soft-deletes any
--    practice league older than 24 hours the way the app soft-deletes
--    leagues today: a "[DELETED-<date>] " name prefix, which every league
--    list already filters. Rows stay; nothing is dropped.

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
  ),
  -- every league the gate has ever looked at, minus practice leagues
  real_leagues as (
    select l.* from public.leagues l
     where coalesce(l.settings ->> 'practice', 'false') <> 'true'
  )

  -- 1. a draft scheduled inside the freeze window
  select l.id, l.name,
         'draft scheduled within ' || p_upcoming_hours || 'h',
         l.scheduled_draft_time
    from real_leagues l
   where l.scheduled_draft_time is not null
     and l.scheduled_draft_time >= now()
     and l.scheduled_draft_time <= now() + make_interval(hours => p_upcoming_hours)

  union all

  -- 2. a draft that is in progress AND demonstrably moving
  select l.id, l.name,
         'draft in progress, last pick ' ||
           round(extract(epoch from (now() - p.last_pick)) / 60.0)::text || ' min ago',
         p.last_pick
    from real_leagues l
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
    from real_leagues l
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
    from real_leagues l
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

revoke all on function public.draft_freeze_blockers(integer, integer) from public;
revoke all on function public.draft_freeze_blockers(integer, integer) from anon;
revoke all on function public.draft_freeze_blockers(integer, integer) from authenticated;
grant execute on function public.draft_freeze_blockers(integer, integer) to service_role;

-- ── the sweep ───────────────────────────────────────────────────────────
create or replace function public.sweep_practice_leagues(p_older_than_hours integer default 24)
returns table (league_id uuid, league_name text)
language sql
volatile
security definer
set search_path to 'public'
as $function$
  update public.leagues l
     set name = '[DELETED-' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || '] ' || l.name
   where coalesce(l.settings ->> 'practice', 'false') = 'true'
     and l.name not like '[DELETED-%'
     and l.created_at < now() - make_interval(hours => p_older_than_hours)
  returning l.id, l.name;
$function$;

revoke all on function public.sweep_practice_leagues(integer) from public;
revoke all on function public.sweep_practice_leagues(integer) from anon;
revoke all on function public.sweep_practice_leagues(integer) from authenticated;
grant execute on function public.sweep_practice_leagues(integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sweep-practice-leagues') then
    perform cron.unschedule('sweep-practice-leagues');
  end if;
  perform cron.schedule(
    'sweep-practice-leagues',
    '15 9 * * *',
    'select public.sweep_practice_leagues()'
  );
exception when others then
  raise notice 'pg_cron not available, sweep-practice-leagues not scheduled';
end $$;
