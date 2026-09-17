-- THE CANARY LEAGUE IS A PRACTICE LEAGUE THAT MUST NEVER BE SWEPT (2026-09-16)
--
-- The draft canary (server/src/canary/draftCanary.ts) opens a socket to the
-- engine every five minutes for one permanent league and expects a snapshot.
-- That league is a practice league on purpose: practice leagues are already
-- invisible to the deploy freeze gate and to every "real league" list. It is
-- held in draft_status = 'in_progress' with draft_state = 'paused' so the
-- engine keeps the lobby resident, runs no clock and autopicks nothing.
--
-- sweep_practice_leagues() would rename it "[DELETED-...]" 24 hours after
-- creation, and the app's league lists would drop it. The canary would keep
-- connecting (the engine does not read the name), but the league would be
-- one accidental "clean up the deleted ones" away from gone, and the
-- pre-flight script that runs discovery for it by name would stop finding
-- it. So the sweep skips any league carrying settings.canary = true.
--
-- Nothing else reads settings.canary. To provision, see
-- infra/gcp/monitoring/README.md, "The canary league".

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
     and coalesce(l.settings ->> 'canary', 'false') <> 'true'
     and l.name not like '[DELETED-%'
     and l.created_at < now() - make_interval(hours => p_older_than_hours)
  returning l.id, l.name;
$function$;

revoke all on function public.sweep_practice_leagues(integer) from public;
revoke all on function public.sweep_practice_leagues(integer) from anon;
revoke all on function public.sweep_practice_leagues(integer) from authenticated;
grant execute on function public.sweep_practice_leagues(integer) to service_role;
