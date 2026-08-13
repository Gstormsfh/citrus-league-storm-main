-- ARCHITECT 2026-08-12 — arm the deadline safety net.
--
-- Until now: draft_deadline_sweep() existed, the draft-autopick edge
-- function was deployed (v7, ACTIVE), the pgmq queue existed, pg_cron and
-- pg_net were installed — and NOTHING was scheduled. cron.job held exactly
-- one row. A pgmq message had sat unread since 2026-07-22. If the uWS
-- engine was not running when a pick clock expired, nothing autopicked.
--
-- CADENCE SYNTAX: pg_cron accepts interval format only for '[1-59]
-- seconds'. Anything longer must use 5-field cron format.
--
-- Job 2 is GATED ON A LIVE DRAFT: invoking a 140s worker every 2 minutes
-- around the clock would burn ~720 invocations/day to do nothing. The
-- service-role token is read from Vault at execution time and appears in
-- no migration, no cron row, and no log.
select cron.schedule(
  'draft-deadline-sweep', '30 seconds',
  $job$select public.draft_deadline_sweep()$job$
);

select cron.schedule(
  'draft-autopick-keepalive', '*/2 * * * *',
  $job$
  select net.http_post(
    url     := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'draft-autopick-token')),
    body    := jsonb_build_object('source', 'pg_cron_keepalive'),
    timeout_milliseconds := 5000)
  where exists (select 1 from public.leagues where draft_status = 'in_progress')
  $job$
);
