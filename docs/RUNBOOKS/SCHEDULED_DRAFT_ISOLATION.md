# Scheduled draft failure isolation

The existing 30-second `start-scheduled-drafts` job keeps its schedule and calls
the same RPC. The patch changes no draft engine, event format, deadline policy,
commissioner identity or custom order. Execute remains restricted to service_role
and the database owner; anonymous and authenticated customers cannot invoke it.

The sweep locks due league rows with `FOR UPDATE SKIP LOCKED`, ordered by time
and league ID. Each order-build/start attempt has its own savepoint. A failed
league is rolled back without aborting another league. Notification delivery is
outside that savepoint: delivery failure cannot rewind a valid start.
Offline leagues are excluded before preparation. The existing 120-minute grace
and deterministic idempotency key are unchanged.

## Evidence

- Nine isolated PostgreSQL tests reproduce the original failure and cover order,
  ignition and notification errors; offline/future/expired/running/completed
  leagues; custom, linear and snake order; retries; and customer-role denial.
- `node scripts/ops/scheduled-draft-staging-rehearsal.mjs` uses the real staging
  order builder, start RPC and draft-event chain, not an ignition stub. It
  verifies two valid starts despite two independent failures, notification
  failure without rollback, no duplicate start events, and offline exclusion.
- Rehearsal uses a transaction with exact-time fixture selection and rolls back
  accounts, leagues, events, triggers and function replacement. It verifies the
  original function and absence of fixture users/leagues afterward. PostgreSQL
  sequence values consumed by the rehearsal are not reset.
- Fixed staging target only; credentials are read in memory from the existing
  staging secret and never printed. No production test league is needed.

## Health and operational checks

Affirmative execution is recorded in `cron.job_run_details`, even when no draft
is due. Check both the job heartbeat and per-league metrics: a successful cron
invocation alone does not mean every eligible league started.

```sql
select j.jobname,j.active,r.status,r.start_time,r.end_time,r.return_message
from cron.job j
left join lateral (
  select * from cron.job_run_details d where d.jobid=j.jobid
  order by start_time desc limit 1
) r on true where j.jobname='start-scheduled-drafts';

select metric,league_id,ts,detail from public.draft_metrics
where ts > now()-interval '10 minutes'
and metric in ('scheduled_start_failed','scheduled_start_blocked',
               'scheduled_start_notification_failed') order by ts desc;
```

The 30-second job should have a recent completed invocation. Treat a missing or
stale heartbeat, SQL failure or failed eligible start as an operational issue.
`blocked` may require commissioner action, such as filling the league. This
patch does not create an external alert delivery system or certify one.

Before production replacement, all hosted checks and the draft freeze check
must pass. Capture the existing function and grants for rollback. Install only
this exact function migration, never a bulk push of the older worktree. Verify
the stored body/privileges and observe subsequent scheduled invocations. Do not
manually sweep production to manufacture a test result.
