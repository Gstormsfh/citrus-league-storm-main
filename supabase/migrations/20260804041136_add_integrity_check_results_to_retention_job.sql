-- 0D-ORG-2: Bring integrity_check_results under the existing log-retention policy.
--
-- APPLIED: prod 20260804041136 / staging (same name). Authoritative record of what is live.
--
-- THE GAP: cron job 'audit-log-retention' (0 6 1 * *) already purges audit_logs and
-- security_audit_log at 90 days. integrity_check_results was never added to it, so it has
-- grown unbounded since 2026-01-16 -- fed every 6 hours by the 'data-integrity-check' cron
-- (job 3) and every 24 hours by 'auto-fix-integrity' (job 4).
--
-- Current state at time of writing: 152,617 rows / 36 MB, of which 124,657 are older than
-- 30 days. The table has been READ 16 times in its entire life. It is pure operational
-- telemetry: check_time, check_name, status, details, affected_teams, auto_fixed. No
-- business data, no FK targets.
--
-- WHAT THIS CHANGES: adds a third DELETE to the SAME job with the SAME 90-day window, for
-- consistency with the policy already in force. NOTHING is deleted by this migration itself.
-- The purge happens on the job's next scheduled run (the 1st of the month), at which point
-- rows older than 90 days are removed. Be aware that is roughly 110 of the ~200 days
-- currently retained. If 90 days is the wrong window for integrity telemetry, change the
-- interval here rather than dropping the clause.
--
-- Deliberately NOT extended to the other log-like tables (auto_recovery_log,
-- team_lineups_backup_log, league_scoring_audit, join_code_attempts, failed_transactions,
-- matchup_scoring_snapshots) -- all are 24-104 kB and growing slowly enough that retention
-- would be premature. integrity_check_results is the only one at material size.
--
-- GATED: the job must still exist, still be scheduled, and its command must reference all
-- three tables afterwards.
--
-- VERIFIED ON PROD AFTER APPLY: job 6 active, covers_audit_logs=true,
--   covers_security_audit=true, covers_integrity_results=true.

DO $mig$
DECLARE
  v_jobid bigint;
  v_cmd   text;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'audit-log-retention';
  IF v_jobid IS NULL THEN
    RAISE NOTICE '0D-ORG-2: audit-log-retention job absent on this database; nothing to do';
    RETURN;
  END IF;

  v_cmd :=
    E'\n      DELETE FROM public.audit_logs\n'
    '      WHERE created_at < now() - interval ''90 days'';\n\n'
    '      DELETE FROM public.security_audit_log\n'
    '      WHERE created_at < now() - interval ''90 days'';\n\n'
    '      DELETE FROM public.integrity_check_results\n'
    '      WHERE check_time < now() - interval ''90 days'';\n    ';

  PERFORM cron.alter_job(job_id := v_jobid, command := v_cmd);

  SELECT command INTO v_cmd FROM cron.job WHERE jobid = v_jobid;

  IF v_cmd NOT LIKE '%integrity_check_results%' THEN
    RAISE EXCEPTION 'GATE1 FAIL: integrity_check_results not present in job command';
  END IF;
  IF v_cmd NOT LIKE '%audit_logs%' OR v_cmd NOT LIKE '%security_audit_log%' THEN
    RAISE EXCEPTION 'GATE2 FAIL: pre-existing retention clauses were lost';
  END IF;

  RAISE NOTICE '0D-ORG-2 OK: retention extended to integrity_check_results (job %)', v_jobid;
END
$mig$;
