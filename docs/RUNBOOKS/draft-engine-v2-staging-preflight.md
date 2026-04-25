# Draft Engine v2 — Staging Preflight Runbook

> **Audience.** Anyone validating the staging environment before
> Phase 1 of Draft Engine v2 begins, or running the staging
> simulator/chaos harness in any subsequent phase. This document
> assumes **no prior knowledge of the codebase**. Every command is
> spelled out; every file path is absolute or relative to the repo
> root.

> **Companion docs.**
> - `docs/DRAFT_ENGINE_V2_SPEC.md` — the formal contract. This
>   runbook references it by section number (e.g. §6.1).
> - `docs/DRAFT_ENGINE_V2_PLAN.md` — the multi-phase plan.

> **Environment under test.** All Phase 0–7 work runs **only** on:
> - Public URL: `staging.citrusfantasysports.com`
> - Supabase project ref: `jjgspcpvqaiitloglxbb`
> - GCP project: `citrus-fantasy-staging` (per
>   `docs/RUNBOOKS/GCP_ORG_SETUP.md`; provisioned in the GCP
>   migration runbook)
> - Cloud Run service name: `citrus-api-staging` (region
>   `us-central1`)
>
> **Production is untouched.** If any command in this runbook
> targets a project ref or hostname other than the four above, stop
> and re-read the command. Hostname-confusion was a contributor to
> at least one of the prior live-draft incidents.

---

## Contents

1. Prerequisites
2. Phase 0 infrastructure preflight checks
3. Seeding a test league
4. Verifying Realtime is firing
5. Resetting state between runs
6. Comparing clocks across N browser tabs
7. Documented results template

---

## §1 Prerequisites

### §1.1 Tools you need on your laptop

```bash
# Supabase CLI (for `db push`, `functions deploy`, SQL execution)
npm install -g supabase
supabase --version              # ≥ 1.200.0

# psql, for direct SQL against the staging DB
which psql                       # any 14+ client is fine

# Node 20.x (matches CI)
node --version                   # v20.x

# jq (used in many of the SQL-vs-API comparison snippets)
which jq

# gcloud (for Cloud Run logs / config inspection)
gcloud --version
```

### §1.2 Credentials you need

These are stored in 1Password under `citrus-fantasy-staging`. Do
not paste them into chat or the repo. Export them in your shell
**only** for the duration of preflight:

```bash
export SUPABASE_PROJECT_REF=jjgspcpvqaiitloglxbb
export SUPABASE_URL=https://${SUPABASE_PROJECT_REF}.supabase.co
export SUPABASE_DB_URL='postgresql://postgres:<service-pw>@db.jjgspcpvqaiitloglxbb.supabase.co:5432/postgres'
export SUPABASE_SERVICE_ROLE_KEY='<from 1Password>'
export SUPABASE_ANON_KEY='<from 1Password>'
export STAGING_API_BASE='https://staging.citrusfantasysports.com'
```

**Sanity check before proceeding** (this is what every later command
relies on):

```bash
psql "$SUPABASE_DB_URL" -c "SELECT current_database(), current_user, version();"
# Expect: current_database = postgres, current_user = postgres, version
# string starts with "PostgreSQL".
```

If `psql` fails to connect, fix that before doing anything else; no
SQL command in this runbook will work otherwise.

### §1.3 Repo state

```bash
git fetch origin
git checkout claude/debug-staging-environment-mv9CY-ZS8os
git pull --ff-only
```

All of Phase 0's work — and only Phase 0's work — lands on this
branch.

---

## §2 Phase 0 infrastructure preflight checks

Each check below produces a one-line result. Record the result in
the **Documented results template** (§7). If any check fails or the
result is uncertain, **stop and surface to the user before Phase 1
begins**.

### §2.1 Postgres version (pgmq bug-window check)

The pgmq extension has a known `drop_queue` overload bug in
Postgres `17.6.1.016+` (a specific window). v2 requires a Postgres
version outside that window.

```bash
psql "$SUPABASE_DB_URL" -At -c "SELECT version();"
```

**Pass criteria.** Major version ≥ 15. Patch revision NOT in the
documented bug window (consult Supabase changelog if revision is
17.6.1.x). Record the exact version string in §7.

### §2.2 pgmq is installable

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT name, default_version, installed_version
  FROM pg_available_extensions
  WHERE name = 'pgmq';
"
```

**Pass criteria.** A row is returned. If `installed_version` is
NULL, that is fine for Phase 0 — Phase 3 installs it. Record both
columns.

### §2.3 pg_cron is installed and at ≥ 1.6.4

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT extversion FROM pg_extension WHERE extname = 'pg_cron';
"
```

**Pass criteria.** Returns a single row with `extversion ≥ 1.6.4`.
If absent, halt — Supabase Pro is required (see
`supabase/migrations/20260208400000_supabase_pro_upgrade.sql`).

### §2.4 Sub-minute pg_cron actually fires 6×/min

This is what the safety-net sweep (§7.8 of the spec) depends on.

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
-- Schedule a 10-second job that just inserts a row.
DROP TABLE IF EXISTS preflight_cron_test;
CREATE TABLE preflight_cron_test(t timestamptz default now());
SELECT cron.schedule(
  'preflight-10s', '*/10 * * * * *',
  $$INSERT INTO preflight_cron_test DEFAULT VALUES$$
);
SQL

# Wait one full minute.
sleep 65

psql "$SUPABASE_DB_URL" -At -c "
  SELECT count(*) FROM preflight_cron_test
  WHERE t > now() - interval '60 seconds';
"
```

**Pass criteria.** Output is `5` or `6`. (Sub-minute cron fires
roughly every 10s; allow ±1 due to scheduler jitter at the second
boundary.) Anything ≤ 4 means sub-minute is NOT working — surface
to the user.

**Cleanup** (do this regardless of pass/fail):

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
SELECT cron.unschedule('preflight-10s');
DROP TABLE IF EXISTS preflight_cron_test;
SQL
```

### §2.5 `net.http_post` (pg_net) is available

The keep-alive cron job that re-invokes the worker depends on this.

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT extversion FROM pg_extension WHERE extname = 'pg_net';
"
```

**Pass criteria.** Returns a non-empty version string. If empty,
record and surface — the worker keep-alive design needs adjustment
(plan §3 phase 3 keep-alive bullet).

### §2.6 Edge Function max duration ceiling

The long-running worker design (spec §5.3) relies on a 150s
ceiling. Verify the staging plan supports it.

Open the Supabase dashboard for project `jjgspcpvqaiitloglxbb` →
Settings → Functions, and read off the **max execution duration**
field. Record the exact number of seconds in §7. Pass criteria:
≥ 150s.

### §2.7 Realtime concurrency cap

Target = 500 drafts × ~20 clients = ~10,000 concurrent subscribers.
Pro standard tier is ~500. **If the staging cap is below the
target, this is a real blocker that must reach the user before
Phase 3.**

In the Supabase dashboard → Settings → Realtime, record:
- **Max concurrent connections** (number).
- **Channel cap** (if surfaced).

Pass criteria: capture the number and write it down. The decision
about (a) tier upgrade, (b) channel consolidation, or (c) reduced
concurrent-draft ceiling is the user's; do not proceed past Phase 2
until they have decided.

### §2.8 `leagues` column-name collision check

Spec §6.3 adds six columns to `leagues`. If any already exist on
the staging schema, Phase 1's ALTER TABLE will fail or, worse,
collide with pre-existing data.

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'leagues'
    AND column_name IN (
      'feature_flags',
      'draft_event_counter',
      'pick_deadline',
      'draft_state',
      'draft_generation',
      'draft_shadow_mode'
    )
  ORDER BY column_name;
"
```

**Pass criteria.** **Zero rows returned.** If any rows return,
record each collision and surface to the user. The plan documents
the resolution paths (reuse via namespacing, rename, or
inspect-and-migrate). Do not proceed to Phase 1 until the user has
chosen.

### §2.9 Auth + RLS sanity check (post-fix readiness)

Spec §6.1 RLS requires `service_role` for writes and league
member SELECT for reads. Confirm the existing RLS infrastructure
on `leagues` is intact:

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT tablename, rowsecurity
  FROM pg_tables WHERE tablename IN ('leagues','league_members');
"
```

**Pass criteria.** Both rows show `rowsecurity = t`.

---

## §3 Seeding a test league

The simulator (Phase 7) and any manual draft test need a clean
league with a deterministic team / member layout. **This procedure
is staging-only.** Never run it against prod.

### §3.1 Synthetic users

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
-- 12 synthetic auth users named test_user_01 .. test_user_12.
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..12 LOOP
    INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
    VALUES (
      gen_random_uuid(),
      format('test_user_%02s@citrusfantasysports.test', i),
      jsonb_build_object('display_name', format('Test %02s', i)),
      now()
    )
    ON CONFLICT (email) DO NOTHING;
  END LOOP;
END$$;
SQL
```

### §3.2 League + teams + members

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
WITH new_league AS (
  INSERT INTO leagues (id, name, settings, created_at)
  VALUES (
    gen_random_uuid(),
    'Preflight Test League',
    jsonb_build_object(
      'team_count',           12,
      'total_rounds',         15,
      'pick_time_limit_seconds', 90,
      'draft_format',         'snake'
    ),
    now()
  )
  RETURNING id
),
seeded_users AS (
  SELECT u.id, row_number() OVER (ORDER BY u.email) AS slot
  FROM auth.users u
  WHERE u.email LIKE 'test_user_%@citrusfantasysports.test'
  ORDER BY u.email LIMIT 12
)
INSERT INTO league_teams (id, league_id, owner_user_id, team_name, slot)
SELECT gen_random_uuid(), nl.id, su.id, format('Team %02s', su.slot), su.slot
FROM seeded_users su, new_league nl;

-- Capture the league id for subsequent commands.
SELECT id AS preflight_league_id
FROM leagues WHERE name = 'Preflight Test League'
ORDER BY created_at DESC LIMIT 1;
SQL
```

Record the returned `preflight_league_id` in §7. All later commands
use it as `$LEAGUE_ID`. Export it:

```bash
export LEAGUE_ID='<paste from above>'
```

### §3.3 Verify the seed

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT count(*) AS team_count
  FROM league_teams WHERE league_id = '$LEAGUE_ID';
"
```

**Pass criteria.** Returns `12`.

> **Schema drift caveat.** If staging's `league_teams` /
> `league_members` table or column names differ from the snippets
> above (e.g. you find `members` instead of `league_members`), do
> NOT silently rename inside this script — first reconcile against
> the actual schema with
> `\dt league*` and
> `\d+ league_teams`, then update §3.2 in this runbook in the same
> PR that does the seed.

---

## §4 Verifying Realtime is firing

Realtime is a load-bearing dependency of the v2 client (spec §9.6).
Verify it works on staging **before** Phase 5 begins building on it.

### §4.1 Subscribe to a test channel from one terminal

```bash
# In terminal A
node - <<'JS'
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
const ch = sb
  .channel('preflight-test-' + Date.now())
  .on('broadcast', { event: 'event' }, (m) => console.log('GOT:', JSON.stringify(m)))
  .subscribe(s => console.log('STATE:', s))
setInterval(() => {}, 60000)
JS
```

You should see `STATE: SUBSCRIBED` within ~2 seconds. If you see
`CHANNEL_ERROR` or no state at all, Realtime is not reachable —
stop and investigate (firewall, anon key, project ref).

### §4.2 Publish from another terminal

```bash
# In terminal B
CHANNEL_NAME='<paste exact channel name from terminal A>'
node - <<JS
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
const ch = sb.channel('${CHANNEL_NAME}')
await ch.subscribe()
await ch.send({ type: 'broadcast', event: 'event', payload: { hello: 'world' } })
console.log('sent')
process.exit(0)
JS
```

**Pass criteria.** Terminal A logs `GOT: {... "payload":{"hello":"world"} ...}`
within 1 second.

### §4.3 Confirm broadcast on the v2 channel naming convention

After Phase 1 ships and at least one event lands in `draft_events`,
repeat §4.1 with the actual v2 channel name:

```
draft_events_v2:${LEAGUE_ID}
```

This is the exact convention the client (spec §9.6) subscribes to.
Until Phase 1 is live, leave a TODO marker in §7 noting that this
sub-step is gated on Phase 1 schema landing.

---

## §5 Resetting state between runs

Each preflight or simulator run leaves rows behind in `draft_events`
(once Phase 1 lands), `draft_picks_v2`, the pgmq queue, and
`leagues.draft_event_counter`. Reset is **per-league**, never
global, and **never run against prod**.

### §5.1 Hard guard — assert you're on staging

The very first command of any reset script must be:

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT CASE
    WHEN current_setting('cluster_name', true) IS NULL
      AND current_database() = 'postgres'
      AND inet_server_addr()::text LIKE '%.jjgspcpvqaiitloglxbb%'
    THEN 'staging'
    ELSE 'NOT_STAGING'
  END;
"
```

Bail if the result is not `staging`. Yes, this looks paranoid. The
April 10 postmortem documented confusion about which environment
was being acted on; this guard exists to prevent a recurrence.

### §5.2 Reset just the test league

```bash
psql "$SUPABASE_DB_URL" <<SQL
BEGIN;

-- Delete events FIRST (projection FK references events).
DELETE FROM draft_picks_v2 WHERE league_id = '$LEAGUE_ID';
DELETE FROM draft_events    WHERE league_id = '$LEAGUE_ID';

-- Reset league counters and state.
UPDATE leagues SET
  draft_event_counter = 0,
  pick_deadline       = NULL,
  draft_state         = 'not_started',
  draft_generation    = 0
WHERE id = '$LEAGUE_ID';

-- Drain pgmq messages for this league.
DELETE FROM pgmq.q_draft_deadlines
WHERE (message->>'league_id')::uuid = '$LEAGUE_ID';

COMMIT;
SQL
```

**Pass criteria.** All four DELETEs succeed. Verify with:

```bash
psql "$SUPABASE_DB_URL" -At -c "
  SELECT
    (SELECT count(*) FROM draft_events    WHERE league_id = '$LEAGUE_ID') AS events,
    (SELECT count(*) FROM draft_picks_v2 WHERE league_id = '$LEAGUE_ID') AS picks,
    (SELECT draft_event_counter FROM leagues WHERE id = '$LEAGUE_ID') AS counter,
    (SELECT draft_state FROM leagues WHERE id = '$LEAGUE_ID') AS state;
"
# Expect: 0 | 0 | 0 | not_started
```

### §5.3 Tear down the synthetic users (only at end of preflight)

```bash
psql "$SUPABASE_DB_URL" <<SQL
DELETE FROM league_teams WHERE league_id = '$LEAGUE_ID';
DELETE FROM leagues       WHERE id        = '$LEAGUE_ID';
DELETE FROM auth.users
  WHERE email LIKE 'test_user_%@citrusfantasysports.test';
SQL
```

This is destructive. Only run when you are completely done with the
preflight session.

---

## §6 Comparing clocks across N browser tabs

The v2 client (spec §9.5) uses a multi-sample handshake to compute
each client's offset from server time. The simulator (Phase 7)
asserts that **all** subscribed tabs see the same `pick_deadline`
within ±300ms. This procedure verifies the handshake works in
practice, on real staging.

### §6.1 Open N tabs

Open `staging.citrusfantasysports.com` in N tabs. (Until Phase 5
lands, this URL still serves v1; the procedure works against the
v1 draft room as a baseline.) Sign in to N different test users
(one per tab). All tabs join the **same** `$LEAGUE_ID`.

### §6.2 Snapshot the perceived deadline from each tab

In every tab's DevTools console, paste:

```js
(async () => {
  const t_send = performance.now();
  const r = await fetch('/api/draft/v2/league/' +
    new URL(location.href).pathname.split('/').filter(Boolean)[1] +
    '/sync', { credentials: 'include' });
  const t_recv = performance.now();
  const j = await r.json();
  console.table({
    rtt_ms:               Math.round(t_recv - t_send),
    server_time:          j.server_time,
    pick_deadline:        j.pick_deadline,
    perceived_remaining_ms: j.pick_deadline
      ? new Date(j.pick_deadline) - Date.now()
      : null,
    ua:                   navigator.userAgent.slice(0, 40)
  });
})();
```

(Until Phase 1 lands `/sync` on staging, substitute the v1 endpoint
that returns `timerStartedAt + pickTimeLimit`. This procedure exists
both as a baseline against v1 and as the intended validation step
post-Phase 1.)

### §6.3 Pass criteria

- Across N tabs, the **maximum** difference in
  `perceived_remaining_ms` is ≤ 300ms when all tabs were sampled
  within 1 second of each other.
- All tabs report identical `pick_deadline` strings (server is the
  authority — this is the principle being validated).
- `server_time` differs across tabs only by RTT (≤ 2× the largest
  observed RTT).

If any of the above fails by >2×, capture the offending tab's full
console output (including `navigator.userAgent` and the RTT) and
attach to the §7 results table — this is exactly the kind of clock
issue v2's design is built to eliminate, and the failure pattern
informs whether the multi-sample handshake needs more samples or
shorter inter-sample gaps.

### §6.4 Skew injection (chaos baseline)

To prove the handshake compensates for skewed device clocks, in
each tab override `Date.now()` with a fixed offset before running
§6.2:

```js
const skewMs = 2000; // try -2000, +2000, +5000, -5000
const _now = Date.now;
Date.now = () => _now() + skewMs;
```

Pass criteria identical to §6.3. Skew is allowed; what must hold is
that **`pick_deadline` agrees across tabs** (it is server-anchored)
and that the client's reported `perceived_remaining_ms` only differs
by RTT.

---

## §7 Documented results template

Copy this block into the PR description (or a comment on the
preflight PR) when you finish. Every row is required.

```
## Phase 0 staging preflight — results

Environment under test:
- Hostname:                 staging.citrusfantasysports.com
- Supabase project ref:     jjgspcpvqaiitloglxbb
- Branch:                   claude/debug-staging-environment-mv9CY-ZS8os
- Run by:                   <name>
- Run date (Mountain Time): <YYYY-MM-DD HH:MM>

| Check                              | Result | Notes |
|------------------------------------|--------|-------|
| §2.1 Postgres version              |        |       |
| §2.2 pgmq installable              |        |       |
| §2.3 pg_cron version               |        |       |
| §2.4 Sub-minute pg_cron count/min  |        |       |
| §2.5 pg_net version                |        |       |
| §2.6 Edge Function max duration    |        |       |
| §2.7 Realtime concurrency cap      |        |       |
| §2.8 `leagues` column collisions   |        |       |
| §2.9 RLS rowsecurity flags         |        |       |
| §3   Seed test league id           |        |       |
| §4.1 Realtime SUBSCRIBED state     |        |       |
| §4.2 Cross-tab broadcast received  |        |       |
| §5   Reset round-trip clean        |        |       |
| §6.3 Max tab clock divergence (ms) |        |       |
| §6.4 Skew-injection result         |        |       |

Open issues raised to user:
- Realtime concurrency cap decision (§2.7): <decision or pending>
- `leagues` column collisions (§2.8):       <decision or pending>
- Other:
```

When all rows are filled in and the two open issues from §2.7 and
§2.8 are either resolved or explicitly deferred-with-mitigation,
Phase 0 is complete and Phase 1 may begin **after** the 48h
calendar gate.
