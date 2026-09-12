-- 20260911234500 — a scheduled draft starts itself, server-side.
--
-- leagues.scheduled_draft_time has existed since 20260206000000 and nothing
-- has ever started a draft from it. The only auto-start was a setTimeout in
-- the commissioner's own browser tab (apps/web/src/pages/DraftRoom.tsx
-- ~2110), so a draft began only if that one person had the v1 draft room
-- open at the scheduled minute — never true of a backgrounded phone, and
-- DraftRoomV2 does not mention scheduled_draft_time at all. 0 of 69
-- production leagues had ever set a time.
--
-- This is the missing half: a 30-second sweep, the same cadence and idiom as
-- draft-deadline-sweep, that ignites any league whose time has passed.
-- Ignition goes through start_draft_v2 — the same RPC the commissioner's
-- button calls — so the event log, the snapshot and the engine keep one
-- ignition path instead of growing a second.
--
-- Design notes:
--   * The idempotency key is derived from (league, scheduled time), so a
--     re-run folds into start_draft_v2's Step 0 short-circuit rather than
--     igniting twice. Moving the scheduled time changes the key, which is
--     what a rescheduled draft should do.
--   * The actor is {kind, id} — the shape the button already writes
--     (verified against draft_events). Step 1 of start_draft_v2 refuses any
--     kind other than 'commissioner', and the event log should not grow a
--     second actor shape for the same event.
--   * p_grace_minutes bounds how late an ignition may be. A draft whose time
--     passed while the database was unreachable should still start; one
--     scheduled and forgotten three days ago should not suddenly ignite into
--     an empty room.
--   * Per-league outcomes land in draft_metrics, failures rate-limited to
--     one row per league per 10 minutes so an unstartable league cannot
--     spam the table every 30 seconds. Liveness of the job itself is already
--     covered by the cron-job-health monitor.

create or replace function public.start_due_scheduled_drafts(p_grace_minutes int default 120)
returns table (league_id uuid, outcome text, detail text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role text;
  v_row  record;
  v_res  jsonb;
  v_key  uuid;
begin
  -- Same gate as draft_deadline_sweep, deliberately including its NULL
  -- behaviour: pg_cron calls carry no JWT, so auth.role() is null and
  -- `null not in (...)` is null — the IF is not taken and the sweep runs.
  -- A JWT call arrives as 'anon' or 'authenticated' and is refused here as
  -- well as by the revoked EXECUTE below.
  v_caller_role := auth.role();
  if v_caller_role not in ('service_role', 'postgres') then
    raise exception 'unauthorized: start_due_scheduled_drafts is a scheduled job (caller role %)',
      coalesce(v_caller_role, '<null>')
      using errcode = 'insufficient_privilege';
  end if;

  for v_row in
    select l.id, l.commissioner_id, l.scheduled_draft_time
      from public.leagues l
     where l.scheduled_draft_time is not null
       and l.scheduled_draft_time <= now()
       and l.scheduled_draft_time >= now() - make_interval(mins => greatest(p_grace_minutes, 0))
       and l.draft_status in ('not_started', 'queued')
       and l.commissioner_id is not null
     order by l.scheduled_draft_time
  loop
    v_key := md5('scheduled_start:' || v_row.id::text || ':' ||
                 extract(epoch from v_row.scheduled_draft_time)::bigint::text)::uuid;

    begin
      v_res := public.start_draft_v2(
        v_row.id,
        jsonb_build_object('kind', 'commissioner', 'id', v_row.commissioner_id),
        v_key,
        gen_random_uuid()
      );

      league_id := v_row.id;
      outcome := case
                   when coalesce((v_res ->> 'was_duplicate')::boolean, false) then 'already_started'
                   else 'started'
                 end;
      detail := v_res ->> 'first_pick_deadline';

      insert into public.draft_metrics (metric, league_id, value, detail)
      values ('scheduled_start_' || outcome, v_row.id, 1,
              jsonb_build_object(
                'scheduled_for', v_row.scheduled_draft_time,
                'late_seconds', round(extract(epoch from now() - v_row.scheduled_draft_time)),
                'first_pick_deadline', v_res ->> 'first_pick_deadline'));
      return next;

    exception when others then
      league_id := v_row.id;
      outcome := 'failed';
      detail := sqlstate || ' ' || sqlerrm;

      if not exists (
        select 1 from public.draft_metrics m
         where m.metric = 'scheduled_start_failed'
           and m.league_id = v_row.id
           and m.ts > now() - interval '10 minutes'
      ) then
        insert into public.draft_metrics (metric, league_id, value, detail)
        values ('scheduled_start_failed', v_row.id, 1,
                jsonb_build_object(
                  'scheduled_for', v_row.scheduled_draft_time,
                  'sqlstate', sqlstate,
                  'message', sqlerrm));
      end if;
      return next;
    end;
  end loop;
end;
$function$;

revoke all on function public.start_due_scheduled_drafts(int) from public;
revoke all on function public.start_due_scheduled_drafts(int) from anon;
revoke all on function public.start_due_scheduled_drafts(int) from authenticated;
grant execute on function public.start_due_scheduled_drafts(int) to service_role;

-- ── the sweep: every 30s, the same cadence as draft-deadline-sweep ──────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'start-scheduled-drafts') then
    perform cron.unschedule('start-scheduled-drafts');
  end if;
  perform cron.schedule(
    'start-scheduled-drafts',
    '30 seconds',
    'select public.start_due_scheduled_drafts()'
  );
exception when others then
  raise notice 'pg_cron not available, start-scheduled-drafts not scheduled';
end $$;
