# CI telemetry — `ops_ci_runs` and the weekly prod schema snapshot

> Two things GitHub Actions writes so that CI, deploy and nightly outcomes reach a
> Claude session — and the founder — without a pasted log. Audience: Garrett;
> any Claude session asked "did CI pass?" or "what changed in prod?".
> Sources: `.github/actions/report-run/action.yml`,
> `.github/workflows/schema-snapshot.yml`, `scripts/ops/dump-prod-schema.sh`,
> migration `20260901234000_ops_ci_runs.sql`.

Claude's container cannot reach github.com. Until 2026-09-01 every CI result,
every deploy result and every failed nightly reached a session the same way: a
person read the GitHub page and pasted it. Supabase is the one connector both
sides already share (process-efficiency audit 2026-09-01, §C), so CI now writes
its outcomes into a Supabase table, and prod's schema is snapshotted into the
repo weekly by a workflow that opens a PR when it differs.

---

## 1. `ops_ci_runs` — one row per job outcome

### 1.1 What it is

`public.ops_ci_runs`: one row per GitHub Actions **job** (not per run), written by
the composite action `.github/actions/report-run` as the `if: always()` final
step of every job in:

| Workflow | Jobs reporting | Summary carries |
|---|---|---|
| `ci.yml` | all twelve (`python-tests` … `security-audit`, including `test-scripts`, `test-shared`) | test runner totals (`Tests 2108 passed (2108)`, `123 passed in 4.5s`, `# pass 12`), the type-error ratchet line, or nothing but the status |
| `production-deploy.yml` | `gate`, `deploy-api`, `deploy`, `notify` | ratchet line; `Serving revision citrus-api-00123-abc is running this build.`; `Health check passed (HTTP 200)`; `notify` carries the **deploy job's** result (`status = needs.deploy.result`) so "did master ship?" is one row |
| `main.yml` | `calculate` | last line of the nightly batch output |
| `data-invariants.yml` | `invariants` | last line of the invariant checker |
| `schema-snapshot.yml` | `snapshot` | `no drift` or `drift: 2 file(s) changed, PR #412`, plus the dump summary line |

Columns: `workflow` (display name, e.g. `CI`), `run_id`, `run_attempt`, `sha`
(the PR **head** commit for `pull_request` events, not the merge commit), `ref`
(branch), `job` (job key, e.g. `test-server`), `status`
(`success | failure | cancelled | skipped`), `started_at` (run start; NULL when
the token had no `actions: read`), `finished_at`, `summary` (≤ 4 KB,
ANSI-stripped), `url` (the run), `created_at`.

Access: RLS on, **no policies**, `anon` and `authenticated` explicitly revoked.
Only `service_role` reads or writes — GitHub Actions inserts with
`SUPABASE_SERVICE_ROLE_KEY`, Claude reads through the Supabase MCP. No app code
touches it.

Telemetry can never fail a job: the step is `if: always()` +
`continue-on-error: true`, and the action itself exits 0 on every path (missing
secrets, bad status, PostgREST error, timeout) with a `::warning::` in the log.
It never prints the key.

### 1.2 The SQL Claude runs

Latest failures, newest first:

```sql
SELECT created_at, workflow, job, status, ref, left(sha, 10) AS sha, summary, url
  FROM public.ops_ci_runs
 WHERE status IN ('failure', 'cancelled')
 ORDER BY created_at DESC
 LIMIT 20;
```

Did a specific branch or commit pass CI? (one row per job; all must be `success`)

```sql
SELECT job, status, summary, url
  FROM public.ops_ci_runs
 WHERE workflow = 'CI' AND ref = 'feat/x'          -- or: sha LIKE 'abc1234%'
   AND run_id = (SELECT max(run_id) FROM public.ops_ci_runs WHERE workflow = 'CI' AND ref = 'feat/x')
 ORDER BY job;
```

Did the last push to master deploy?

```sql
SELECT created_at, status, summary, left(sha, 10) AS sha, url
  FROM public.ops_ci_runs
 WHERE workflow = 'Production Deploy' AND job = 'notify'
 ORDER BY created_at DESC
 LIMIT 5;
```

Nightlies over the last week (projections, invariants, snapshot):

```sql
SELECT created_at::date AS day, workflow, job, status, summary
  FROM public.ops_ci_runs
 WHERE workflow IN ('Nightly Projection Batch', 'Data Invariants (daily)', 'Schema Snapshot')
   AND created_at > now() - interval '7 days'
 ORDER BY created_at DESC;
```

Run/attempt roll-up (one line per run):

```sql
SELECT workflow, run_id, run_attempt, ref, left(sha, 10) AS sha,
       count(*) FILTER (WHERE status = 'failure') AS failed,
       count(*) AS jobs, max(created_at) AS finished
  FROM public.ops_ci_runs
 GROUP BY workflow, run_id, run_attempt, ref, sha
 ORDER BY finished DESC
 LIMIT 20;
```

A run that is missing rows for some jobs was cancelled before they reported
(`ci.yml` cancels superseded PR runs) or the runner died; the `url` is the log.

### 1.3 When it is wrong or empty

| Symptom | Cause | Fix |
|---|---|---|
| No rows at all after a run | Migration not applied to prod (table absent → PostgREST 404, logged as `::warning::report-run: POST ops_ci_runs failed`) | Apply `20260901234000_ops_ci_runs.sql` via the Supabase MCP; nothing else to configure — the secrets it uses already exist for `ci.yml` |
| No rows for one PR | It came from a fork: GitHub gives fork PRs no secrets, so the action logs `not available to this run` and posts nothing | Expected; otherwise read the job's `Report run` step log |
| `started_at` NULL | Token lacked `actions: read` for the run lookup | Cosmetic; add `actions: read` to that workflow's `permissions:` if wanted |
| `summary` NULL on a test job | Runner output did not match the totals patterns and the log was empty | Open `url`; consider extending the grep in the action |

Adding the step to a new workflow: copy any `Report run` block from `ci.yml`
verbatim; add `log-file:` if a step tees its output; the job must have
`actions/checkout` so the local action resolves.

Retention: none yet, on purpose — see the migration header. Revisit when the
table passes ~50 MB (`SELECT pg_size_pretty(pg_total_relation_size('public.ops_ci_runs'))`).

---

## 2. Weekly prod schema snapshot

### 2.1 What it does

`schema-snapshot.yml` runs Sundays 09:00 UTC (and on `workflow_dispatch`). It
runs `scripts/ops/dump-prod-schema.sh`, which is read-only against prod:

- `pg_dump --schema-only --no-owner --no-privileges --schema=public` →
  `supabase/schema/prod_schema.sql`, normalised so the diff is drift, not noise:
  `\restrict`/`\unrestrict` token lines (random per run since pg_dump 17.6/16.10)
  and the "Dumped from/by version" banners are removed, trailing whitespace
  stripped, object order left as pg_dump emits it (type, then name — stable).
- `SELECT jobname, schedule, command FROM cron.job ORDER BY 1` (+ `active`) →
  `supabase/schema/prod_cron.sql`, one `cron.schedule(...)` call per job with
  `%L` quoting, so a body containing `$$` cannot break the file. It is a
  manifest for review, **not** a migration — do not feed it to psql.

If either file differs from what is committed on `master` (the first run counts:
the files do not exist yet), the workflow commits both to
`chore/schema-snapshot-<date>`, opens a PR (`chore(schema): prod schema snapshot
<date>`) with the diffstat in the body, and closes any older open snapshot PR as
superseded. A second run the same day force-updates that day's branch. Nothing
is merged automatically.

Not captured, by design: ACLs (`--no-privileges`; grant drift is
`check_security_drift()`'s job), data, and schemas other than `public`
(`SCHEMAS=public,cron scripts/ops/dump-prod-schema.sh` widens it by hand).

### 2.2 Reviewing a snapshot PR

For every hunk ask: **which file in `supabase/migrations/` produces this?**

- There is one (it merged since the last snapshot) → fine.
- There is none → that is drift: something was changed in place on prod. Write
  the migration now, capturing the live body first
  (`SELECT pg_get_functiondef('public.fn(args)'::regprocedure)`), per
  `docs/PROD_CHANGE_LEDGER.md` Rule 1. The 2026-09-01 cases were `project_ros`,
  `rebuild_player_projected_stats`, `backtest_inseason_weight` and the
  `rebuild-ros-projections` cron job.

Merge the snapshot PR either way — it records what prod *is*. Once the first
snapshot PR has merged, delete the hand-taken
`supabase/schema/production_snapshot_20260813.sql`; the weekly file replaces it.

The PR is opened with `GITHUB_TOKEN`, so GitHub deliberately does not start CI
on it. For two generated files that is acceptable; if a check is ever required
(branch protection), push to the branch or close/reopen the PR and CI runs.

### 2.3 One-time setup (Garrett) — secret names only

Add the repository secret **`PROD_DB_URL`** (Settings → Secrets and variables →
Actions). Value: the **direct** connection string from the Supabase dashboard
(Project Settings → Database → Connection string → *Direct*):
`postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`.

- Never the pooler (`pooler.supabase.com`, `pgbouncer`, port `6543`). The repo
  rule is **KI-E010** (`draft-engine-v2-known-issues.md`), and pg_dump needs a
  session-mode connection for its consistent snapshot anyway; the script refuses
  pooled patterns before connecting.
- The direct hostname is reachable from GitHub's IPv4-only runners only because
  the project has the dedicated-IPv4 add-on
  (`docs/PHASE_4_5_GCE_PLATFORM_NOTES.md` §15.4). "Network is unreachable" from
  the runner means that add-on lapsed.
- Until the secret exists, every run fails at the dump step with a message
  naming it. That is deliberate — a silent skip is the permanently-amber pattern
  this repo removed elsewhere. The failure is also a row in `ops_ci_runs`
  (`workflow = 'Schema Snapshot'`, `summary = 'ERROR: PROD_DB_URL is not set.'`).

### 2.4 Running it by hand (Cloud Shell)

Same script, same output, so a manual snapshot and the weekly one are
comparable byte for byte:

```bash
# Prod is Postgres 17; Cloud Shell ships client 16 and pg_dump refuses newer servers.
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-client-17
export PATH=/usr/lib/postgresql/17/bin:$PATH

cd ~/citrus-league-storm-main          # a clone; the script writes into supabase/schema/
read -rs PROD_DB_URL && export PROD_DB_URL   # paste the direct URL; not echoed, not in history
scripts/ops/dump-prod-schema.sh
git diff --stat -- supabase/schema/
```

The script prints one summary line (`prod_schema.sql: server pg17, schemas=public,
N tables, N functions, N policies; prod_cron.sql: N jobs`) and never the URL.
Commit the result on a `chore/schema-snapshot-<date>` branch and land it like any
other bundle (`DELIVERY.md`), or just read the diff and discard it.

---

## 3. Cross-references

- Audit that specified both: `process-efficiency-audit` 2026-09-01 §B-3, §B-4, §C (Supabase row), §D-3, §D-5.
- `docs/PROD_CHANGE_LEDGER.md` — Rule 1 (every prod mutation is a migration file); Rule 2 (read history before touching shared objects).
- `docs/CLAUDE_MIGRATIONS_PR291.md` — standing constraint: no `supabase db push` to prod from the repo; `scripts/db-push.mjs` enforces it.
- `docs/RUNBOOKS/DELIVERY.md` — how a branch from Claude becomes a PR.
- `docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md` — the snapshot is not a backup.
