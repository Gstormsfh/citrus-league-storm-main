-- 20260912050000 — a scheduled draft can build the order it needs to start.
--
-- THE DEFECT. start_due_scheduled_drafts (20260911234500) ignites through
-- start_draft_v2, "the same RPC the commissioner's button calls". That was
-- half true, and the missing half made the feature inert for every real
-- league.
--
-- The button does not call start_draft_v2. It calls useStartDraftFull
-- (apps/web/src/hooks/useStartDraftFull.ts), which is a TWO-step sequence:
--
--   1. draftOrderExistsForLeague → if missing, DraftService.initializeDraftOrder
--   2. start_draft_v2
--
-- The sweep only ever did step 2. start_draft_v2 READS draft_order and raises
-- draft_not_configured when round 1 is absent; it has never created one. And
-- nothing in the database could: as of this migration, zero functions and zero
-- migrations insert into public.draft_order. The only writer anywhere is
-- server/src/services/DraftService.ts, over HTTP, which a pg_cron job cannot
-- reach.
--
-- That makes the precondition circular. A league that has never drafted has no
-- draft_order, so the sweep cannot ignite it. A league that HAS a draft_order
-- only has one because somebody already pressed Start Draft — at which point
-- there is nothing left to schedule. The feature could not start a single real
-- league, and never had: zero scheduled_start_* rows existed on either
-- environment before this migration.
--
-- Reproduced on staging 2026-09-12 04:22:47Z, league
-- ada00051-0000-4000-8000-000000000001 — four teams, no order, scheduled for
-- now(). The sweep selected it and wrote:
--   draft_not_configured: league ... has no round-1 draft_order, sqlstate 23514
-- League stayed not_started with 0 draft_events. Nobody was told.
--
-- WHAT THIS CHANGES
--
-- (a) build_draft_order_for_league — the missing step 1, in SQL. Mirrors
--     DraftService.initializeDraftOrder exactly: shuffle the team ids, one
--     draft_session_id for the whole draft, even rounds reversed unless the
--     league is linear, totalRounds = draft_rounds or 14, draftType from
--     settings or 'snake'. It carries that method's mid-draft guard too —
--     rebuilding an order is only ever legal before ignition.
--
--     The duplication with the TypeScript is deliberate and temporary. The
--     alternative — moving the button onto this function two days before the
--     season opens — risks the one ignition path that demonstrably works. The
--     snake semantic is six lines and has not changed since 20260807. Unify
--     after launch, not before.
--
-- (b) The sweep builds the order when round 1 is missing, then ignites. A
--     league that cannot be built is skipped BEFORE ignition rather than
--     throwing through it, so the reason we report is the real one.
--
-- (c) The silence is over. A failed scheduled start now notifies the
--     commissioner once per (league, scheduled time), and a successful one
--     notifies every manager. Both write directly to public.notifications
--     rather than through notify_league_members: that function resolves the
--     caller with auth.uid(), which is NULL under pg_cron, so it would refuse
--     every call the sweep could make.
--
--     This matters more than it looks. p_grace_minutes bounds ignition to 120
--     minutes past the scheduled time, so a league failing silently for two
--     hours falls out of the window and can never auto-start. Telling the
--     commissioner on the FIRST failure is what keeps that window actionable.

-- ── (a) the missing step 1 ─────────────────────────────────────────────
create or replace function public.build_draft_order_for_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role text;
  v_status   text;
  v_size     int;
  v_rounds   int;
  v_type     text;
  v_team_ids uuid[];
  v_session  uuid;
  v_round    int;
  v_order    jsonb;
  v_found    boolean;
begin
  -- Same gate and the same NULL behaviour as the sweep that calls this:
  -- pg_cron carries no JWT, so auth.role() is null, `null not in (...)` is
  -- null, and the IF is not taken. A JWT call arrives as 'anon' or
  -- 'authenticated' and is refused here as well as by the revoked EXECUTE.
  v_caller_role := auth.role();
  if v_caller_role not in ('service_role', 'postgres') then
    raise exception 'unauthorized: build_draft_order_for_league is a scheduled job (caller role %)',
      coalesce(v_caller_role, '<null>')
      using errcode = 'insufficient_privilege';
  end if;

  select true, l.draft_status::text, l.league_size,
         coalesce(l.draft_rounds, 14),
         coalesce(l.settings ->> 'draftType', 'snake')
    into v_found, v_status, v_size, v_rounds, v_type
    from public.leagues l
   where l.id = p_league_id
     for update;

  if not coalesce(v_found, false) then
    return jsonb_build_object('ok', false, 'reason', 'league_not_found');
  end if;

  -- DraftService.initializeDraftOrder's mid-draft guard, in the same words:
  -- the first thing this function does is delete every draft_order row for
  -- the league, and doing that under a running draft desynchronises the
  -- engine's in-memory order from what clients are served.
  if v_status not in ('not_started', 'queued') then
    return jsonb_build_object('ok', false, 'reason', 'draft_not_startable',
                              'draft_status', v_status);
  end if;

  if v_size is null or v_size <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_league_size',
                              'league_size', v_size);
  end if;

  -- `order by random()` is this function's shuffleTeamOrder. Without it the
  -- commissioner drafts first every time: team rows come back by created_at
  -- and his is created with the league.
  select array_agg(t.id order by random())
    into v_team_ids
    from public.teams t
   where t.league_id = p_league_id;

  -- start_draft_v2 requires jsonb_array_length(team_order) = league_size, so
  -- a short roster cannot produce a startable order. Refuse here, with the
  -- real reason, rather than writing an order that ignition will reject.
  if v_team_ids is null or array_length(v_team_ids, 1) is distinct from v_size then
    return jsonb_build_object('ok', false, 'reason', 'roster_incomplete',
                              'teams', coalesce(array_length(v_team_ids, 1), 0),
                              'league_size', v_size);
  end if;

  v_session := gen_random_uuid();

  -- UNIQUE (league_id, round_number) means a rebuild must clear first. This
  -- is the same hard delete DraftService does, under the same guard.
  delete from public.draft_order where league_id = p_league_id;

  for v_round in 1..v_rounds loop
    -- Snake: even rounds reverse. Linear: every round forward.
    if v_type <> 'linear' and v_round % 2 = 0 then
      select jsonb_agg(u.x order by u.ord desc) into v_order
        from unnest(v_team_ids) with ordinality as u(x, ord);
    else
      select jsonb_agg(u.x order by u.ord asc) into v_order
        from unnest(v_team_ids) with ordinality as u(x, ord);
    end if;

    insert into public.draft_order (league_id, round_number, team_order, draft_session_id)
    values (p_league_id, v_round, v_order, v_session);
  end loop;

  return jsonb_build_object('ok', true,
                            'rounds', v_rounds,
                            'team_count', v_size,
                            'draft_type', v_type,
                            'draft_session_id', v_session);
end;
$function$;

revoke all on function public.build_draft_order_for_league(uuid) from public;
revoke all on function public.build_draft_order_for_league(uuid) from anon;
revoke all on function public.build_draft_order_for_league(uuid) from authenticated;
grant execute on function public.build_draft_order_for_league(uuid) to service_role;

-- ── (c) somebody gets told ─────────────────────────────────────────────
-- notify_league_members resolves its caller with auth.uid(), which is NULL
-- under pg_cron, so it returns {success:false,'Authentication required'} for
-- every call the sweep could make. This writes public.notifications directly,
-- deduplicated on (league, scheduled time, kind) because the sweep runs every
-- 30 seconds and a league that cannot start fails on every single pass.
create or replace function public.notify_scheduled_start(
  p_league_id uuid,
  p_scheduled_for timestamptz,
  p_kind text,
  p_title text,
  p_message text,
  p_reason text default null,
  p_commissioner_only boolean default true
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role text;
  v_epoch   text;
  v_meta    jsonb;
  v_written int := 0;
begin
  v_caller_role := auth.role();
  if v_caller_role not in ('service_role', 'postgres') then
    raise exception 'unauthorized: notify_scheduled_start is a scheduled job (caller role %)',
      coalesce(v_caller_role, '<null>')
      using errcode = 'insufficient_privilege';
  end if;

  -- The epoch, not the rendered timestamp: the same derivation the ignition
  -- idempotency key uses, so a RESCHEDULED draft is a new key and gets a new
  -- notification rather than being silenced by the old one.
  v_epoch := extract(epoch from p_scheduled_for)::bigint::text;

  if exists (
    select 1 from public.notifications n
     where n.league_id = p_league_id
       and n.metadata ->> 'kind' = p_kind
       and n.metadata ->> 'scheduled_epoch' = v_epoch
  ) then
    return 0;
  end if;

  v_meta := jsonb_build_object(
              'kind',            p_kind,
              'source',          'scheduled_start_sweep',
              'scheduled_for',   p_scheduled_for,
              'scheduled_epoch', v_epoch
            )
            || case when p_reason is null then '{}'::jsonb
                    else jsonb_build_object('reason', p_reason) end;

  if p_commissioner_only then
    insert into public.notifications (league_id, user_id, type, title, message, metadata)
    select p_league_id, l.commissioner_id, 'SYSTEM', p_title, p_message, v_meta
      from public.leagues l
     where l.id = p_league_id
       and l.commissioner_id is not null
       -- notifications.user_id FKs to profiles; a commissioner without one
       -- would abort the whole sweep pass on a constraint violation.
       and exists (select 1 from public.profiles pr where pr.id = l.commissioner_id);
  else
    insert into public.notifications (league_id, user_id, type, title, message, metadata)
    select distinct p_league_id, t.owner_id, 'SYSTEM', p_title, p_message, v_meta
      from public.teams t
     where t.league_id = p_league_id
       -- owner_id is null on AI teams.
       and t.owner_id is not null
       and exists (select 1 from public.profiles pr where pr.id = t.owner_id);
  end if;

  get diagnostics v_written = row_count;
  return v_written;
end;
$function$;

revoke all on function public.notify_scheduled_start(uuid, timestamptz, text, text, text, text, boolean) from public;
revoke all on function public.notify_scheduled_start(uuid, timestamptz, text, text, text, text, boolean) from anon;
revoke all on function public.notify_scheduled_start(uuid, timestamptz, text, text, text, text, boolean) from authenticated;
grant execute on function public.notify_scheduled_start(uuid, timestamptz, text, text, text, text, boolean) to service_role;

-- ── (b) the sweep builds what it needs, then ignites ───────────────────
create or replace function public.start_due_scheduled_drafts(p_grace_minutes int default 120)
returns table (league_id uuid, outcome text, detail text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role text;
  v_row   record;
  v_res   jsonb;
  v_key   uuid;
  v_build jsonb;
  v_when  text;
  v_msg   text;
  v_reason text;
begin
  -- Same gate as draft_deadline_sweep, deliberately including its NULL
  -- behaviour: pg_cron calls carry no JWT, so auth.role() is null and
  -- `null not in (...)` is null — the IF is not taken and the sweep runs.
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
    -- House timezone, matching draftTimeChangeMessage on the server.
    v_when := to_char(v_row.scheduled_draft_time at time zone 'America/Denver',
                      'Dy Mon FMDD, FMHH12:MI AM') || ' MT';

    -- ── Step 1: the order. This is what the sweep was missing. ────────
    -- The commissioner's button builds it first (useStartDraftFull step 1)
    -- and start_draft_v2 only ever reads it, so a league whose commissioner
    -- never pressed Start Draft had nothing to ignite against.
    if not exists (
      select 1 from public.draft_order d
       where d.league_id = v_row.id
         and d.round_number = 1
         and d.deleted_at is null
    ) then
      v_build := public.build_draft_order_for_league(v_row.id);

      if not coalesce((v_build ->> 'ok')::boolean, false) then
        v_reason := v_build ->> 'reason';

        -- Skip BEFORE ignition so the reason we report is the real one
        -- rather than start_draft_v2's downstream draft_not_configured.
        v_msg := case v_reason
          when 'roster_incomplete' then
            'Your draft was set for ' || v_when || ', but the league has ' ||
            coalesce(v_build ->> 'teams', '0') || ' of ' ||
            coalesce(v_build ->> 'league_size', '?') ||
            ' teams. Fill the league, then set a new draft time.'
          when 'invalid_league_size' then
            'Your draft was set for ' || v_when ||
            ', but the league size is not set. Set it in league settings, then pick a new draft time.'
          else
            'Your draft was set for ' || v_when ||
            ', but it could not start on its own. Open the league and start the draft from the draft room.'
        end;

        perform public.notify_scheduled_start(
          v_row.id, v_row.scheduled_draft_time,
          'scheduled_start_failed',
          'Your draft did not start',
          v_msg, v_reason, true);

        if not exists (
          select 1 from public.draft_metrics m
           where m.metric = 'scheduled_start_blocked'
             and m.league_id = v_row.id
             and m.ts > now() - interval '10 minutes'
        ) then
          insert into public.draft_metrics (metric, league_id, value, detail)
          values ('scheduled_start_blocked', v_row.id, 1,
                  jsonb_build_object('scheduled_for', v_row.scheduled_draft_time,
                                     'build', v_build));
        end if;

        league_id := v_row.id;
        outcome   := 'blocked';
        detail    := v_reason;
        return next;
        continue;
      end if;
    end if;

    -- ── Step 2: ignition, unchanged ───────────────────────────────────
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

      if outcome = 'started' then
        perform public.notify_scheduled_start(
          v_row.id, v_row.scheduled_draft_time,
          'scheduled_draft_started',
          'Your draft has started',
          'The draft you were waiting on just opened. Head to the draft room — the clock is running.',
          null, false);
      end if;

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

      perform public.notify_scheduled_start(
        v_row.id, v_row.scheduled_draft_time,
        'scheduled_start_failed',
        'Your draft did not start',
        'Your draft was set for ' || v_when ||
        ', but it could not start on its own. Open the league and start the draft from the draft room.',
        sqlstate, true);

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

notify pgrst, 'reload schema';
