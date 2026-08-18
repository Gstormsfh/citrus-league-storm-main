-- 20260818210000 — draft autopick runtime plumbing AS CODE.
--
-- 2026-08-18 prod-readiness audit finding: staging had the
-- draft-deadline-sweep cron, the draft-autopick keepalive cron, the
-- draft-autopick edge function, and the vault token — prod had NONE
-- of them, because all four were applied out-of-band to staging with
-- no migration to replay. Result: a prod draft (league DACOSTA!)
-- froze at pick 1 with an expired deadline and nothing to advance it.
--
-- This migration owns the two cron jobs so the drift cannot recur.
-- It is idempotent (unschedule-if-exists, then schedule) and
-- environment-portable: the keepalive URL is read from the vault
-- secret 'functions-base-url' (a PUBLIC value, e.g.
-- https://<ref>.supabase.co/functions/v1), which both staging and
-- prod carry as of 2026-08-18.
--
-- NOT in this migration (each needs project-scoped secrets/deploys):
--   1. Edge function `draft-autopick` — deploy from
--      supabase/functions/draft-autopick (vendored in-repo as of this
--      commit):
--        supabase functions deploy draft-autopick \
--          --project-ref <ref> --no-verify-jwt
--   2. Vault secret 'draft-autopick-token' — MUST equal the project's
--      service-role key (the worker compares against
--      SUPABASE_SERVICE_ROLE_KEY). Set per-project in the dashboard
--      SQL editor:
--        select vault.create_secret('<service-role-key>',
--                                   'draft-autopick-token');
--      Until it exists, the keepalive's Authorization header is null
--      and the function answers 401 — visible in edge logs, harmless
--      to drafts (the sweep still enqueues; manual invocation still
--      works).

-- ── 1. deadline sweep: every 30s, enqueue overdue picks to pgmq ──────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'draft-deadline-sweep') then
    perform cron.unschedule('draft-deadline-sweep');
  end if;
  perform cron.schedule(
    'draft-deadline-sweep',
    '30 seconds',
    'select public.draft_deadline_sweep()'
  );
end $$;

-- ── 2. autopick keepalive: every 2 min while a draft is live ─────────
do $$
declare
  v_base_url text;
begin
  select decrypted_secret into v_base_url
    from vault.decrypted_secrets
   where name = 'functions-base-url';

  if v_base_url is null then
    raise notice 'draft-autopick-keepalive NOT scheduled: vault secret functions-base-url is missing. Create it, then re-run this block.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'draft-autopick-keepalive') then
    perform cron.unschedule('draft-autopick-keepalive');
  end if;

  perform cron.schedule(
    'draft-autopick-keepalive',
    '*/2 * * * *',
    format($job$
  select net.http_post(
    url     := %L || '/draft-autopick',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'draft-autopick-token'
      )
    ),
    body    := jsonb_build_object('source', 'pg_cron_keepalive'),
    timeout_milliseconds := 5000
  )
  where exists (
    select 1 from public.leagues where draft_status = 'in_progress'
  )
  $job$, v_base_url)
  );
end $$;
