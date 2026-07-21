# Draft Engine — Staging Preflight Runbook

> **Status:** post-11g.9 persistent-engine preflight. Replaces the
> pre-Phase-4.5 preflight (which was Cloud-Run + Edge-Function + pgmq
> oriented).
> **Audience:** anyone validating staging before a deploy, anyone
> standing staging back up after 10b re-provisioning, or anyone
> verifying the staging engine matches expected operational shape.
> **Companion docs:**
> - [`README.md`](./README.md) — which runbook for which situation.
> - [`draft-engine-v2-operations.md`](./draft-engine-v2-operations.md) — incident response.
> - [`draft-engine-v2-rollback-playbook.md`](./draft-engine-v2-rollback-playbook.md) — when to roll back.
> - [`../PHASE_4_5_PRODUCTIONIZATION_PLAN.md`](../PHASE_4_5_PRODUCTIONIZATION_PLAN.md) §6.1 — 10b staging re-provisioning detail.

---

## ⚠ Legacy-path warning

The pre-Phase-4.5 preflight checked: `pgmq` installable, sub-minute
pg_cron firing, Edge Function max duration, `draft_generation`
column collisions. **None of these checks apply to the post-11g.9
architecture.** pgmq + pg_cron jobs + Edge Function were DROP CASCADE'd
in chunk 11g.9 (irreversible). If you find yourself running those
checks against staging, you're working off the wrong runbook.

---

## §1 Prerequisites

### §1.1 Tools

```bash
# Supabase CLI (for db push, sql execution)
npm install -g supabase
supabase --version              # ≥ 1.200.0

# psql, for direct SQL against staging DB
which psql                       # any 14+ client is fine

# Node 20.x (matches CI)
node --version                   # v20.x

# gcloud (for GCE VM logs / config)
gcloud --version

# jq (for JSON-out parsing in some checks below)
which jq
```

### §1.2 Credentials and environment

Stored in 1Password under `citrus-fantasy-staging`. Do not paste into
chat or commit. Export for the duration of preflight only:

```bash
export SUPABASE_PROJECT_REF=jjgspcpvqaiitloglxbb
export SUPABASE_URL=https://${SUPABASE_PROJECT_REF}.supabase.co
# DIRECT primary URL (port 5432) — NOT the pooler URL (6543).
# Pooled URLs drop LISTEN frames silently; the LISTEN/NOTIFY self-test
# below depends on this being correct.
export SUPABASE_DB_URL='postgresql://postgres:<service-pw>@db.jjgspcpvqaiitloglxbb.supabase.co:5432/postgres'
export SUPABASE_SERVICE_ROLE_KEY='<from 1Password>'
export SUPABASE_ANON_KEY='<from 1Password>'

# Staging engine endpoint (populated by 10b re-provisioning 2026-07-21;
# see PHASE_4_5_GCE_PLATFORM_NOTES.md §15). Static IP retained on
# teardown so this value survives VM lifecycle churn.
export STAGING_ENGINE_HOST='35.203.89.236'
export STAGING_ENGINE_HTTP_PORT=3001
export STAGING_ENGINE_WS_PORT=3002
```

### §1.3 Sanity check before proceeding

Every later command depends on `psql` connectivity:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT current_database(), current_user, version();"
# Expect: current_database = postgres, current_user = postgres,
# version string starts with "PostgreSQL".
```

If `psql` fails to connect, fix that first — no later check works
without it.

### §1.4 Repo state

```bash
cd /c/Users/garre/Documents/citrus-league-storm-phase45 && \
git fetch origin && \
git checkout phase-4-5-implementation && \
git pull --ff-only
```

---

## §2 Persistent-engine infrastructure checks

Each check produces a one-line result. Record in §6 results template.
If any check fails or is uncertain, **stop and investigate** before
the engine is allowed to serve traffic.

### §2.1 Postgres version + extensions sanity

```bash
psql "$SUPABASE_DB_URL" -At -c "SELECT version();"
psql "$SUPABASE_DB_URL" -At -c "
  SELECT extname, extversion
  FROM pg_extension
  WHERE extname IN ('pg_net', 'pgcrypto', 'uuid-ossp', 'pgmq');
"
```

**Pass criteria:**
- PostgreSQL ≥ 15 (any recent Supabase managed version qualifies).
- `pgcrypto` and/or `uuid-ossp` present (for `gen_random_uuid()`).
- **`pgmq` MUST NOT be present.** It was DROP CASCADE'd in chunk 11g.9
  (`supabase/migrations/20260512000000_remove_pgmq_infrastructure.sql`).
  If `pgmq` appears in the output, the migration didn't apply or staging
  is on an older snapshot — investigate before proceeding.

### §2.2 `draft_events` + `draft_snapshots` tables exist and are healthy

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT relname, reltuples::bigint AS approx_rows
  FROM pg_class
  WHERE relname IN ('draft_events', 'draft_snapshots',
                    'draft_picks_v2', 'auction_bids',
                    'auction_nominations', 'auction_budgets')
  ORDER BY relname;
"
```

**Pass criteria:** all six tables present. Row counts not asserted
(varies with staging-data state); the existence check is what matters.

### §2.3 `draft_events_notify_after_insert` trigger is installed

This is the chunk 11g.7-7e trigger that fires `pg_notify` on every
`draft_events` INSERT. Without it, cross-process events do not reach
the engine.

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT tgname, tgrelid::regclass, tgenabled
  FROM pg_trigger
  WHERE tgname = 'draft_events_notify_after_insert';
"
```

**Pass criteria:** one row returned with `tgrelid = draft_events`
and `tgenabled = O` (origin / enabled). If zero rows: the chunk
11g.7-7e migration `20260511000000_draft_events_notify.sql` did not
apply.

### §2.4 `draft_events_notify_trigger()` function body is current

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT pg_get_functiondef(oid)
  FROM pg_proc
  WHERE proname = 'draft_events_notify_trigger';
"
```

**Pass criteria:** function body contains
`pg_notify('draft_events', json_build_object('league_id', NEW.league_id, 'seq', NEW.seq)::text)`.
If a different shape, the trigger is stale and the engine will fail
to parse notifications.

### §2.5 No legacy pgmq cron jobs

Sanity check that chunk 11g.9 cleanup landed cleanly:

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT jobname, schedule
  FROM cron.job
  WHERE jobname LIKE 'draft-%';
"
```

**Pass criteria:** zero rows. The legacy `draft-deadline-sweep` and
`draft-autopick-keepalive` jobs were unscheduled in chunk 11g.9
(`20260512000000_remove_pgmq_infrastructure.sql`). If any rows
return, the unschedule did not apply.

### §2.6 `submit_pick_v2` accepts ADR-004 trusted-executor path

ADR-004 modified `submit_pick_v2`'s user-kind branch to accept
`service_role` callers (the engine) without requiring `auth.uid()`
to match team owner — the engine has verified at the application
layer per ADR-004 §5.3.

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT pg_get_functiondef(oid)
  FROM pg_proc
  WHERE proname = 'submit_pick_v2';
" | grep -A 2 "v_caller_role NOT IN"
```

**Pass criteria:** function body contains
`v_caller_role NOT IN ('service_role', 'postgres')` in the user-kind
branch. If absent, ADR-004's migration did not apply.

---

## §3 Engine deployment + startup verification

### §3.1 GCE VM connectivity

```bash
gcloud compute instances list --project=citrus-fantasy-staging \
  --filter="name~draft-engine" \
  --format="table(name,zone,status,networkInterfaces[0].accessConfigs[0].natIP)"
```

**Pass criteria:** one row, status `RUNNING`, external IP populated.

### §3.2 Engine process is running

```bash
ssh "$STAGING_ENGINE_HOST" "sudo systemctl status citrus-draft-engine --no-pager"
# OR for Docker:
ssh "$STAGING_ENGINE_HOST" "docker ps --filter name=citrus-draft-engine"
```

**Pass criteria:** systemd service `active (running)` OR Docker
container in `Up` state.

### §3.3 Engine startup log sequence

Within 30 seconds of process start, the following must appear in order:

```bash
ssh "$STAGING_ENGINE_HOST" "sudo journalctl -u citrus-draft-engine -n 100 --no-pager" \
  | grep -E "hono.listening|uws.listening|event_subscription.started|event_subscription.self_test"
```

**Pass criteria** (all four present):

```
hono.listening               { port: 3001 }
uws.listening                { port: 3002 }
event_subscription.started   {}
event_subscription.self_test_succeeded  {}
```

**Fail mode — `event_subscription.self_test_failed` (error):** the
engine's `SUPABASE_DB_URL` is wrong (likely pooled URL). See §4.

### §3.4 `SUPABASE_DB_URL` is direct (not pooled)

The single most common operational misconfiguration. Direct =
host `db.<project>.supabase.co`, port `5432`. Pooled =
`pooler.supabase.com` or port `6543`.

```bash
# Read the engine's effective env var (do NOT log the password):
ssh "$STAGING_ENGINE_HOST" "
  sudo systemctl show citrus-draft-engine -p Environment 2>/dev/null \
    | grep -oP 'SUPABASE_DB_URL=postgresql://[^@]+@\K[^/?]+' \
    || docker inspect citrus-draft-engine \
       | grep -oP 'SUPABASE_DB_URL=postgresql://[^@]+@\K[^/?]+'
"
```

**Pass criteria:**
- Host matches `db.<project>.supabase.co` pattern.
- Port `5432` (default; absent in URL is fine).
- Host does NOT contain `pooler.supabase.com`.
- Port is NOT `6543`.

**Fail mode:** silent-failure of LISTEN/NOTIFY. Fix env var, restart
service, re-run §3.3 startup verification.

---

## §4 LISTEN/NOTIFY end-to-end verification

The startup self-test (§3.3) is the cheap version. This is the
end-to-end version: fire a real `draft_events`-shaped INSERT and
confirm the engine receives + applies it.

### §4.1 Trigger a synthetic NOTIFY directly via psql

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT pg_notify('draft_events',
                   json_build_object('league_id', 'preflight-test',
                                     'seq', 999999)::text);
"
```

Then check engine logs within 5 seconds:

```bash
ssh "$STAGING_ENGINE_HOST" "sudo journalctl -u citrus-draft-engine -n 50 --no-pager --since '10 seconds ago'" \
  | grep "event_subscription.notification_received"
```

**Pass criteria:** at least one `event_subscription.notification_received`
log line within 5s of the psql NOTIFY. The engine may then log
`event_subscription.event_not_yet_visible` (because the synthetic
seq doesn't correspond to a real `draft_events` row) — that's
expected for this test.

### §4.2 Trigger via a real RPC (covers the full INSERT → trigger → NOTIFY path)

```bash
# Call draft_pause via psql — produces real draft_events INSERT.
# Pick a staging league_id that exists in draft_state = 'in_progress'.
# Known-good staging league (10b fixture, "Staging League"):
#   993c9219-ecbf-4e4e-9fb0-e9837e1bded3 — draftType=snake, seeded
#   with one team + one draft_order row for lobby-construction proof.
#   Requires state='in_progress' for draft_pause to accept; toggle
#   via `UPDATE leagues SET draft_state='active' WHERE id=...` when
#   running §4.2 (revert to 'not_started' after test).
psql "$SUPABASE_DB_URL" -c "
  SELECT public.draft_pause(
    '<staging-league-id>'::uuid,
    jsonb_build_object('kind', 'commissioner',
                       'id', '<staging-commissioner-user-id>'::uuid)
  );
"
```

Then:

```bash
ssh "$STAGING_ENGINE_HOST" "sudo journalctl -u citrus-draft-engine -n 50 --no-pager --since '10 seconds ago'" \
  | grep -E "event_subscription.notification_received|event_subscription.event_applied"
```

**Pass criteria:** both `notification_received` AND `event_applied`
log lines fire within 2s. Then resume the league to leave staging
state clean:

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT public.draft_resume(
    '<staging-league-id>'::uuid,
    jsonb_build_object('kind', 'commissioner',
                       'id', '<staging-commissioner-user-id>'::uuid)
  );
"
```

---

## §5 Snapshot persistence + bootstrap verification

### §5.1 `draft_snapshots` table is writable

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT count(*) FROM draft_snapshots WHERE created_at > now() - interval '24 hours';
"
```

**Pass criteria:** non-zero count if any drafts have been active in
the last 24h, OR zero count if staging has been quiet. Confirms the
table exists and the engine has write access.

### §5.2 Snapshot persistence emission verification

If staging has an active draft, the engine should periodically emit
`snapshot.persistence.written` for it. If no active draft,
skip §5.2 and proceed.

```bash
ssh "$STAGING_ENGINE_HOST" "sudo journalctl -u citrus-draft-engine -n 200 --no-pager" \
  | grep "snapshot.persistence.written" | tail -5
```

**Pass criteria:** at least one log line in the last few minutes
if there's an active draft.

### §5.3 Bootstrap fallback path (full event-replay)

Confirm the belt-and-suspenders path works: restart the engine and
verify it bootstraps from snapshot+delta OR falls back cleanly to
full event-replay.

```bash
# Restart the engine:
ssh "$STAGING_ENGINE_HOST" "sudo systemctl restart citrus-draft-engine"

# Watch logs for bootstrap behavior:
ssh "$STAGING_ENGINE_HOST" "sudo journalctl -u citrus-draft-engine -n 100 --no-pager --since '30 seconds ago'" \
  | grep -E "snapshot.bootstrap|registry.lobby_added"
```

**Pass criteria:** for each previously-active lobby, see either:
- `snapshot.bootstrap.applied` (info) — snapshot+delta path worked, OR
- `snapshot.bootstrap.fallback_full_replay` (warn) — fallback worked
  (acceptable; may indicate version mismatch or missing snapshot).

Both outcomes are correct. **Fail mode** = lobby fails to bootstrap
at all (no `registry.lobby_added` for an expected lobby).

---

## §6 Documented results template

Copy this block into the preflight PR or operations issue when done.

```
## Staging preflight — results

Environment under test:
- VM:                       <gce-vm-name>
- IP:                       <external-ip>
- Supabase project ref:     jjgspcpvqaiitloglxbb
- Engine SHA:               <git rev-parse HEAD>
- Branch:                   phase-4-5-implementation
- Run by:                   <name>
- Run date (Mountain Time): <YYYY-MM-DD HH:MM>

| Check                                              | Result | Notes |
|----------------------------------------------------|--------|-------|
| §2.1 PG version + extensions (pgmq MUST be absent) |        |       |
| §2.2 draft_events / draft_snapshots tables exist   |        |       |
| §2.3 draft_events_notify_after_insert trigger      |        |       |
| §2.4 draft_events_notify_trigger() function body   |        |       |
| §2.5 No legacy pgmq cron jobs                      |        |       |
| §2.6 submit_pick_v2 ADR-004 trusted-executor path  |        |       |
| §3.1 GCE VM is RUNNING                             |        |       |
| §3.2 Engine process is running                     |        |       |
| §3.3 Engine startup log sequence (all 4 lines)     |        |       |
| §3.4 SUPABASE_DB_URL is direct (not pooled)        |        |       |
| §4.1 Synthetic NOTIFY received within 5s           |        |       |
| §4.2 Real-RPC NOTIFY + apply within 2s             |        |       |
| §5.1 draft_snapshots table writable                |        |       |
| §5.2 snapshot.persistence.written emission         |        |       |
| §5.3 Bootstrap on restart (snapshot OR fallback)   |        |       |

Open issues raised:
- <any>
```

When every check passes, the staging engine is operational and
matches expected post-11g.9 shape.

---

## §7 Pre-cutover transient-state sidebar

> **This section retires at chunk 11g.10 sub-step 10f (production
> cutover).** Until then, the preflight applies to the GCE-deployed
> draft engine alone; the main `citrus-api` (HTTP for non-draft
> features) still runs on Cloud Run separately and has its own
> health checks outside this runbook.

During pre-cutover transient:

- The engine is reachable via `STAGING_ENGINE_HOST:3001` (Hono) +
  `STAGING_ENGINE_HOST:3002` (uWS).
- The main API is reachable via `staging.citrusfantasysports.com`
  (Cloud Run).
- Cross-process events flow Postgres → engine via LISTEN/NOTIFY.
  Verified by §4 above.

Post-cutover, both services collapse onto the GCE VM (per ADR-001 +
`../PHASE_4_5_ARCHITECTURE.md`) and `staging.citrusfantasysports.com`
points at GCE. 10f's deliverable includes the cutover sequencing.
