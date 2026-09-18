-- Scheduled ignition audit, 2026-09-18.
-- Preserve the existing ignition RPC, order builder and idempotency contract.
-- Isolate preparation failures per league, serialize against reschedules and
-- manual starts, and never ignite an offline league. Notification failure must
-- not roll back a valid draft start or prevent the next league from starting.
create or replace function public.start_due_scheduled_drafts(p_grace_minutes int default 120)
returns table (league_id uuid, outcome text, detail text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record;
  v_res jsonb;
  v_build jsonb;
  v_key uuid;
  v_when text;
  v_reason text;
  v_error_state text;
  v_error_message text;
begin
  -- Cron runs without a JWT. EXECUTE is restricted below as well.
  if auth.role() not in ('service_role', 'postgres') then
    raise exception 'unauthorized: start_due_scheduled_drafts is a scheduled job'
      using errcode = 'insufficient_privilege';
  end if;

  for v_row in
    select l.id, l.commissioner_id, l.scheduled_draft_time
    from public.leagues l
    where l.scheduled_draft_time <= now()
      and l.scheduled_draft_time >= now() - make_interval(mins => greatest(p_grace_minutes, 0))
      and l.draft_status in ('not_started', 'queued')
      and l.commissioner_id is not null
      and coalesce(l.settings ->> 'draftType', 'snake') <> 'offline'
    order by l.scheduled_draft_time, l.id
    for update of l skip locked
  loop
    league_id := v_row.id;
    outcome := null;
    detail := null;
    v_reason := null;
    v_when := to_char(v_row.scheduled_draft_time at time zone 'America/Denver',
      'Dy Mon FMDD, FMHH12:MI AM') || ' MT';

    -- Both preparation and ignition belong to the same per-league savepoint.
    -- A broken order must neither abort the whole sweep nor leave a partial
    -- order behind. An existing commissioner-defined order is preserved.
    begin
      if not exists (
        select 1 from public.draft_order d
        where d.league_id = v_row.id and d.round_number = 1 and d.deleted_at is null
      ) then
        v_build := public.build_draft_order_for_league(v_row.id);
        if not coalesce((v_build ->> 'ok')::boolean, false) then
          outcome := 'blocked';
          v_reason := coalesce(v_build ->> 'reason', 'order_not_built');
          detail := v_reason;
          if not exists (
            select 1 from public.draft_metrics m
            where m.metric = 'scheduled_start_blocked' and m.league_id = v_row.id
              and m.ts > now() - interval '10 minutes'
          ) then
            insert into public.draft_metrics (metric, league_id, value, detail)
            values ('scheduled_start_blocked', v_row.id, 1,
              jsonb_build_object('scheduled_for', v_row.scheduled_draft_time, 'build', v_build));
          end if;
        end if;
      end if;

      if outcome is null then
        v_key := md5('scheduled_start:' || v_row.id::text || ':' ||
          extract(epoch from v_row.scheduled_draft_time)::bigint::text)::uuid;
        v_res := public.start_draft_v2(v_row.id,
          jsonb_build_object('kind', 'commissioner', 'id', v_row.commissioner_id),
          v_key, gen_random_uuid());
        outcome := case when coalesce((v_res ->> 'was_duplicate')::boolean, false)
          then 'already_started' else 'started' end;
        detail := v_res ->> 'first_pick_deadline';
        insert into public.draft_metrics (metric, league_id, value, detail)
        values ('scheduled_start_' || outcome, v_row.id, 1,
          jsonb_build_object('scheduled_for', v_row.scheduled_draft_time,
            'late_seconds', round(extract(epoch from now() - v_row.scheduled_draft_time)),
            'first_pick_deadline', v_res ->> 'first_pick_deadline'));
      end if;
    exception when others then
      v_error_state := sqlstate;
      v_error_message := sqlerrm;
      outcome := 'failed';
      v_reason := v_error_state;
      detail := v_error_state || ' ' || v_error_message;
      begin
        if not exists (
          select 1 from public.draft_metrics m
          where m.metric = 'scheduled_start_failed' and m.league_id = v_row.id
            and m.ts > now() - interval '10 minutes'
        ) then
          insert into public.draft_metrics (metric, league_id, value, detail)
          values ('scheduled_start_failed', v_row.id, 1,
            jsonb_build_object('scheduled_for', v_row.scheduled_draft_time,
              'sqlstate', v_error_state, 'message', v_error_message));
        end if;
      exception when others then
        raise warning 'scheduled_start_failure_metric league %: %', v_row.id, sqlerrm;
      end;
    end;

    -- Delivery is best effort, outside the ignition savepoint. Its failure
    -- is separately observable without resetting an already-running clock.
    begin
      if outcome = 'started' then
        perform public.notify_scheduled_start(v_row.id, v_row.scheduled_draft_time,
          'scheduled_draft_started', 'Your draft has started',
          'Your draft is open. Head to the draft room; the clock is running.', null, false);
      elsif outcome in ('blocked', 'failed') then
        perform public.notify_scheduled_start(v_row.id, v_row.scheduled_draft_time,
          'scheduled_start_failed', 'Your draft did not start',
          case when v_reason = 'roster_incomplete' then
            'Your draft was set for ' || v_when || ', but the league has ' ||
            coalesce(v_build ->> 'teams', '0') || ' of ' ||
            coalesce(v_build ->> 'league_size', '?') ||
            ' teams. Fill the league, then set a new draft time.'
          else 'Your draft was set for ' || v_when ||
            ', but it could not start automatically. Check league settings and open the draft room to start or reschedule.'
          end, v_reason, true);
      end if;
    exception when others then
      v_error_state := sqlstate;
      raise warning 'scheduled_start_notification_failed league %: %', v_row.id, sqlerrm;
      begin
        insert into public.draft_metrics (metric, league_id, value, detail)
        values ('scheduled_start_notification_failed', v_row.id, 1,
          jsonb_build_object('scheduled_for', v_row.scheduled_draft_time, 'sqlstate', v_error_state));
      exception when others then
        raise warning 'scheduled_start_notification_metric league %: %', v_row.id, sqlerrm;
      end;
    end;
    return next;
  end loop;
end;
$function$;

revoke all on function public.start_due_scheduled_drafts(int) from public, anon, authenticated;
grant execute on function public.start_due_scheduled_drafts(int) to service_role;
notify pgrst, 'reload schema';

