#!/usr/bin/env bash
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Read-only snapshot of the production schema + pg_cron manifest,
#              normalised so a diff shows drift and not dump noise.
# Last active: 2026-09-01
# Invoked:     PROD_DB_URL='postgresql://...' scripts/ops/dump-prod-schema.sh [out-dir]
#              (.github/workflows/schema-snapshot.yml weekly; Cloud Shell by hand)
# Reads:       PROD_DB_URL (direct, non-pooled; never printed), SCHEMAS (default: public)
# Writes:      <out-dir>/prod_schema.sql, <out-dir>/prod_cron.sql,
#              <out-dir>/prod_migration_history.sql
#              (out-dir defaults to supabase/schema in the repo this script lives in)
# ────────────────────────────────────────────────────────────
#
# Why this exists. supabase/migrations/ is supposed to be the truth, but prod
# drifts from it whenever a function or a cron job is edited in place: on
# 2026-09-01 project_ros, rebuild_player_projected_stats and
# backtest_inseason_weight had no defining migration, and the only schema
# record was a hand-taken snapshot 19 days old. This script makes the record
# mechanical: the same two files, the same way, every week — so the git diff
# between runs IS the list of prod changes that lack a migration
# (docs/PROD_CHANGE_LEDGER.md Rule 1).
#
# Read-only by construction: pg_dump --schema-only and one SELECT on cron.job.
# It never applies anything, and it is not a substitute for a backup
# (docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md).
#
# Connection rules.
#   * PROD_DB_URL must be the DIRECT primary connection
#     (postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres). Pooled
#     URLs (pooler.supabase.com, pgbouncer, port 6543) are refused: the repo
#     rule is KI-E010 (docs/RUNBOOKS/draft-engine-v2-known-issues.md), and
#     pg_dump additionally needs a session-mode connection for its consistent
#     snapshot. The direct hostname resolves over IPv4 only because the project
#     has the dedicated-IPv4 add-on (docs/PHASE_4_5_GCE_PLATFORM_NOTES.md §15.4);
#     "Network is unreachable" from an IPv4-only runner means that add-on lapsed.
#   * pg_dump must be at least the server's major version (pg_dump refuses newer
#     servers). Prod is Postgres 17; Cloud Shell and ubuntu-latest ship 16 by
#     default. The check below fails with the install line rather than letting
#     pg_dump's "server version mismatch" surprise you.
#
# Normalisation (what makes the diff quiet):
#   * `\restrict <token>` / `\unrestrict <token>` lines (pg_dump >= 17.6 / 16.10
#     emit a random token per run) are dropped.
#   * "-- Dumped from database version" / "-- Dumped by pg_dump version" banners
#     are dropped so a minor version bump is not a diff.
#   * trailing whitespace is stripped.
#   * object order is pg_dump's own (type, then name), which is stable between
#     runs; nothing here re-sorts the dump. The cron manifest is ordered by
#     jobname, then jobid, so it is stable too.
#   * ACLs are NOT captured (--no-privileges, per the audit spec); grant drift is
#     the job of check_security_drift() (migration 20260804045646).

set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/supabase/schema}"
SCHEMAS="${SCHEMAS:-public}"

# ── 1. Inputs ────────────────────────────────────────────────────────────
[ -n "${PROD_DB_URL:-}" ] || die "PROD_DB_URL is not set.
  GitHub Actions: add the repository secret PROD_DB_URL (Settings > Secrets and
  variables > Actions). Cloud Shell: export it for this shell only; never commit it.
  Value: the DIRECT connection string from the Supabase dashboard
  (Project Settings > Database > Connection string > Direct), port 5432."

for pat in 'pooler.supabase.com' 'pgbouncer' ':6543'; do
  case "$PROD_DB_URL" in
    *"$pat"*) die "PROD_DB_URL matches pooled-connection pattern '$pat' (KI-E010). Use the direct primary URL: db.<ref>.supabase.co:5432." ;;
  esac
done

command -v pg_dump >/dev/null || die "pg_dump not found. Install postgresql-client-17 (see below)."
command -v psql    >/dev/null || die "psql not found. Install postgresql-client-17 (see below)."

# Fail fast on an unreachable host, always encrypt. pg_dump/psql read these.
export PGSSLMODE="${PGSSLMODE:-require}" PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"

# ── 2. Server / client version agreement ─────────────────────────────────
# libpq error text names the host and user, never the password.
if ! server_num=$(psql -X -q -At -v ON_ERROR_STOP=1 -d "$PROD_DB_URL" -c 'SHOW server_version_num' 2>&1); then
  die "could not connect with PROD_DB_URL (value not shown): ${server_num}
  Check the password, and that the direct hostname resolves over IPv4 (§15.4 add-on)."
fi
server_major=$(( server_num / 10000 ))
client_major=$(pg_dump --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)?.*/\1/')
if [ "$client_major" -lt "$server_major" ]; then
  die "pg_dump is version $client_major but the server is Postgres $server_major; pg_dump refuses newer servers.
  Debian/Ubuntu (Cloud Shell, GitHub runners):
    sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
    sudo apt-get install -y postgresql-client-$server_major
    export PATH=/usr/lib/postgresql/$server_major/bin:\$PATH"
fi

# ── 3. Schema dump, normalised ───────────────────────────────────────────
mkdir -p "$OUT_DIR"
tmp_schema=$(mktemp) ; tmp_cron=$(mktemp) ; tmp_hist=$(mktemp)
trap 'rm -f "$tmp_schema" "$tmp_cron" "$tmp_hist"' EXIT

schema_args=()
IFS=',' read -r -a schema_list <<< "$SCHEMAS"
for s in "${schema_list[@]}"; do
  s="${s// /}"; [ -n "$s" ] && schema_args+=("--schema=$s")
done

pg_dump --schema-only --no-owner --no-privileges "${schema_args[@]}" -d "$PROD_DB_URL" \
  | sed -E \
      -e '/^\\(un)?restrict /d' \
      -e '/^-- Dumped (from database|by pg_dump) version/d' \
      -e 's/[[:space:]]+$//' \
  > "$tmp_schema"

[ -s "$tmp_schema" ] || die "pg_dump produced no output."
grep -q -E '^CREATE ' "$tmp_schema" || die "pg_dump output has no CREATE statements; refusing to overwrite the snapshot."

# ── 4. pg_cron manifest ──────────────────────────────────────────────────
# The three columns the audit asked for (jobname, schedule, command) plus the
# active flag, because enabling/disabling a job is a prod mutation too
# (PROD_CHANGE_LEDGER: the 0F-OPS-3 / SL-1b history). Commands are %L-quoted so
# a body containing $$ or quotes cannot break the file. This is a manifest for
# review, not a migration: do not feed it to psql.
{
  echo "-- Production pg_cron jobs: SELECT jobname, schedule, command FROM cron.job ORDER BY 1"
  echo "-- Generated by scripts/ops/dump-prod-schema.sh. Manifest for review; not a migration."
  echo
  psql -X -q -At -v ON_ERROR_STOP=1 -d "$PROD_DB_URL" <<'SQL'
SELECT coalesce(string_agg(
  format(E'-- jobname=%s schedule=%s active=%s\n%s',
         coalesce(jobname, '(unnamed)'), schedule, active,
         CASE WHEN jobname IS NULL
              THEN format('SELECT cron.schedule(%L, %L);', schedule, command)
              ELSE format('SELECT cron.schedule(%L, %L, %L);', jobname, schedule, command)
         END),
  E'\n\n' ORDER BY jobname NULLS LAST, jobid), '-- (no jobs)')
FROM cron.job;
SQL
} | sed -E 's/[[:space:]]+$//' > "$tmp_cron"

# ── 4b. Migration history as prod recorded it ────────────────────────────
# supabase_migrations.schema_migrations is the ledger prod actually kept, and
# it is NOT the same set as supabase/migrations/. Measured 2026-09-03: 450
# history rows vs 383 repo files, only 41 versions in common. 409 rows were
# applied through the Supabase MCP / dashboard and never got a file; 342 files
# were applied by psql or the SQL editor (or never applied) and never got a
# row. Neither side can rebuild prod alone. This file puts the prod side in
# git, full statements included, so the reconciliation has both halves.
# Append-only in practice, so the weekly diff is just the new rows.
{
  echo "-- Production supabase_migrations.schema_migrations: version, name, statements"
  echo "-- Generated by scripts/ops/dump-prod-schema.sh. History record; not a migration to re-run."
  echo
  psql -X -q -At -v ON_ERROR_STOP=1 -d "$PROD_DB_URL" <<'SQL'
SELECT coalesce(string_agg(
  format(E'-- ==== version=%s name=%s\n%s',
         version, coalesce(name, '(unnamed)'),
         coalesce(array_to_string(statements, E'\n'), '-- (no statements recorded)')),
  E'\n\n' ORDER BY version), '-- (no history rows)')
FROM supabase_migrations.schema_migrations;
SQL
} | sed -E 's/[[:space:]]+$//' > "$tmp_hist"

# ── 5. Publish atomically, then summarise (never the URL) ────────────────
mv "$tmp_schema" "$OUT_DIR/prod_schema.sql"
mv "$tmp_cron"   "$OUT_DIR/prod_cron.sql"
mv "$tmp_hist"   "$OUT_DIR/prod_migration_history.sql"
trap - EXIT

tables=$(grep -c -E '^CREATE (UNLOGGED )?TABLE ' "$OUT_DIR/prod_schema.sql" || true)
functions=$(grep -c -E '^CREATE (OR REPLACE )?FUNCTION ' "$OUT_DIR/prod_schema.sql" || true)
policies=$(grep -c -E '^CREATE POLICY ' "$OUT_DIR/prod_schema.sql" || true)
jobs=$(grep -c -E '^-- jobname=' "$OUT_DIR/prod_cron.sql" || true)
hist=$(grep -c -E '^-- ==== version=' "$OUT_DIR/prod_migration_history.sql" || true)
echo "prod_schema.sql: server pg$server_major, schemas=$SCHEMAS, $tables tables, $functions functions, $policies policies; prod_cron.sql: $jobs jobs; prod_migration_history.sql: $hist history rows"
