#!/usr/bin/env bash
#
# PROOF: 20260904100000_manager_week_metrics.sql
#        20260904101000_manager_week_metrics_functions.sql
#
# The claim these migrations make is a comparability claim: that a manager's
# week in a 12-team points league and a manager's week in an 8-team league
# with different scoring can be ranked against each other fairly. That is not
# obvious and it is not testable by reading the SQL, so most of this script is
# spent on it -- two leagues on deliberately different scales, and the
# assertion that the z-scores line up while the raw points do not.
#
# The rest proves the things that would be embarrassing to get wrong: the
# privacy floor actually refuses, the writer reports what it wrote, and a
# second run updates rather than duplicates.
#
# Requires a scratch PostgreSQL 16 cluster. Nothing here touches production.
#
#   PGHOST=/home/claude/pgsock PGPORT=5432 PGUSER=claude \
#     scripts/proof/manager-week-metrics.proof.sh

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
MIG="$REPO_ROOT/supabase/migrations"

export PGHOST="${PGHOST:-/home/claude/pgsock}"
export PGPORT="${PGPORT:-54329}"
export PGUSER="${PGUSER:-postgres}"

DB=mwm_proof
Q="psql -d $DB -v ON_ERROR_STOP=1 -tAq"

PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }
eq() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); say "  PASS  $1"
  else FAIL=$((FAIL+1)); say "  FAIL  $1 -- expected [$2] got [$3]"; fi
}

psql -d postgres -q -c "DROP DATABASE IF EXISTS $DB"
psql -d postgres -q -c "CREATE DATABASE $DB"

# ── the shape production has, reduced to what these functions touch ─────────
$Q >/dev/null <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
-- Roles are CLUSTER-wide, not per-database, so a plain CREATE ROLE makes this
-- script pass once and fail on every re-run -- which is how the second run of
-- this proof reported 22 failures that were all the same missing table.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $r$;

CREATE TABLE public.leagues (id uuid PRIMARY KEY, name text);
CREATE TABLE public.teams (id uuid PRIMARY KEY, league_id uuid, owner_id uuid, team_name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text, username text);
CREATE TYPE matchup_status AS ENUM ('scheduled','in_progress','completed');
CREATE TABLE public.matchups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, week_number int, team1_id uuid, team2_id uuid,
  team1_score numeric, team2_score numeric, status matchup_status,
  week_start_date date, week_end_date date
);
SQL

say ""
say "STEP 1 - the migrations apply"
$Q -f "$MIG/20260904100000_manager_week_metrics.sql" >/dev/null || { say "  FAIL  table migration"; FAIL=$((FAIL+1)); }
$Q -f "$MIG/20260904101000_manager_week_metrics_functions.sql" >/dev/null || { say "  FAIL  function migration"; FAIL=$((FAIL+1)); }
eq "table exists" "1" "$($Q -c "SELECT count(*) FROM pg_tables WHERE tablename='manager_week_metrics'")"
eq "RLS is enabled" "t" "$($Q -c "SELECT relrowsecurity FROM pg_class WHERE relname='manager_week_metrics'")"
eq "two policies" "2" "$($Q -c "SELECT count(*) FROM pg_policies WHERE tablename='manager_week_metrics'")"
eq "self-read policy admits only auth.uid()" "1" \
  "$($Q -c "SELECT count(*) FROM pg_policies WHERE tablename='manager_week_metrics' AND policyname='manager_week_metrics_self_read' AND qual LIKE '%uid()%'")"

# ── two leagues, deliberately different scales ─────────────────────────────
# ALPHA scores around 90 with a spread of ~10. BRAVO scores around 300 with a
# spread of ~40 -- a different scoring system entirely. Within each league the
# same manager SHAPE: one standout, one disaster, the rest bunched.
say ""
say "STEP 2 - fixture: two leagues on different scoring scales"
$Q >/dev/null <<'SQL'
INSERT INTO public.leagues VALUES
  ('11111111-0000-4000-8000-000000000001','Alpha'),
  ('22222222-0000-4000-8000-000000000002','Bravo');

INSERT INTO auth.users
SELECT ('33333333-0000-4000-8000-0000000000' || lpad(i::text,2,'0'))::uuid FROM generate_series(1,16) i;
INSERT INTO public.profiles
SELECT ('33333333-0000-4000-8000-0000000000' || lpad(i::text,2,'0'))::uuid, 'Manager ' || i, 'm' || i
  FROM generate_series(1,16) i;

-- Alpha: 8 teams. Bravo: 8 teams.
INSERT INTO public.teams
SELECT ('44444444-0000-4000-8000-0000000000' || lpad(i::text,2,'0'))::uuid,
       CASE WHEN i <= 8 THEN '11111111-0000-4000-8000-000000000001'::uuid
            ELSE '22222222-0000-4000-8000-000000000002'::uuid END,
       ('33333333-0000-4000-8000-0000000000' || lpad(i::text,2,'0'))::uuid,
       'Team ' || i
  FROM generate_series(1,16) i;
SQL

# Alpha points: 118, 92, 91, 90, 89, 88, 87, 60  (median 89.5, MAD 2.0)
# Bravo points: Alpha x3 EXACTLY -- 354, 276, 273, 270, 267, 264, 261, 180.
#
# The multiple has to be exact. The first version of this fixture used
# "about 3.3x" numbers whose inner spread was a different SHAPE, not just a
# different scale, and the z-scores correctly came out different (9.61 vs
# 16.32). That failure was the fixture asserting a claim it had not set up.
# A pure multiple isolates the property actually being proved: z is scale
# INVARIANT, so a league that scores in the hundreds and a league that scores
# in the tens produce identical z-scores for identically-shaped weeks.
$Q >/dev/null <<'SQL'
INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
VALUES
 ('11111111-0000-4000-8000-000000000001',1,'44444444-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000002',118,92,'completed','2026-09-27','2026-10-03'),
 ('11111111-0000-4000-8000-000000000001',1,'44444444-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000004',91,90,'completed','2026-09-27','2026-10-03'),
 ('11111111-0000-4000-8000-000000000001',1,'44444444-0000-4000-8000-000000000005','44444444-0000-4000-8000-000000000006',89,88,'completed','2026-09-27','2026-10-03'),
 ('11111111-0000-4000-8000-000000000001',1,'44444444-0000-4000-8000-000000000007','44444444-0000-4000-8000-000000000008',87,60,'completed','2026-09-27','2026-10-03'),
 ('22222222-0000-4000-8000-000000000002',1,'44444444-0000-4000-8000-000000000009','44444444-0000-4000-8000-000000000010',354,276,'completed','2026-09-27','2026-10-03'),
 ('22222222-0000-4000-8000-000000000002',1,'44444444-0000-4000-8000-000000000011','44444444-0000-4000-8000-000000000012',273,270,'completed','2026-09-27','2026-10-03'),
 ('22222222-0000-4000-8000-000000000002',1,'44444444-0000-4000-8000-000000000013','44444444-0000-4000-8000-000000000014',267,264,'completed','2026-09-27','2026-10-03'),
 ('22222222-0000-4000-8000-000000000002',1,'44444444-0000-4000-8000-000000000015','44444444-0000-4000-8000-000000000016',261,180,'completed','2026-09-27','2026-10-03');
SQL

say ""
say "STEP 3 - the writer reports what it wrote (the health signal)"
WROTE=$($Q -c "SELECT public.refresh_manager_week_metrics(2026, 1)")
eq "wrote one row per manager" "16" "$WROTE"
eq "and they are all there" "16" "$($Q -c "SELECT count(*) FROM public.manager_week_metrics")"

say ""
say "STEP 4 - THE CLAIM: z is scale-invariant, so leagues become comparable"
# Pairwise: every Alpha manager against the Bravo manager on 3x their points.
# If z carries scale at all, these diverge. Counting mismatches rather than
# comparing one pair, so a coincidence at the top cannot pass the test.
MISMATCH=$($Q -c "
  WITH a AS (SELECT points_for, z_score FROM public.manager_week_metrics
              WHERE league_id='11111111-0000-4000-8000-000000000001'),
       b AS (SELECT points_for, z_score FROM public.manager_week_metrics
              WHERE league_id='22222222-0000-4000-8000-000000000002')
  SELECT count(*) FROM a JOIN b ON b.points_for = a.points_for * 3
   WHERE round(a.z_score,6) <> round(b.z_score,6)")
eq "all 8 pairs score an identical z at 1x and 3x scale" "0" "$MISMATCH"
eq "and all 8 pairs were actually compared" "8" \
  "$($Q -c "
    WITH a AS (SELECT points_for FROM public.manager_week_metrics
                WHERE league_id='11111111-0000-4000-8000-000000000001'),
         b AS (SELECT points_for FROM public.manager_week_metrics
                WHERE league_id='22222222-0000-4000-8000-000000000002')
    SELECT count(*) FROM a JOIN b ON b.points_for = a.points_for * 3")"

ALPHA_MED=$($Q -c "SELECT league_week_median FROM public.manager_week_metrics WHERE points_for = 118")
BRAVO_MED=$($Q -c "SELECT league_week_median FROM public.manager_week_metrics WHERE points_for = 354")
say "         (Alpha median $ALPHA_MED, Bravo median $BRAVO_MED -- exactly 3x apart)"

# The point of the whole design: rank by raw points and Bravo takes every top
# place, having done nothing better than play in a higher-scoring league.
TOP8_BRAVO_BY_POINTS=$($Q -c "SELECT count(*) FROM (SELECT league_id FROM public.manager_week_metrics ORDER BY points_for DESC LIMIT 8) t WHERE league_id = '22222222-0000-4000-8000-000000000002'")
eq "ranked by raw points, Bravo sweeps the top 8 on scale alone" "8" "$TOP8_BRAVO_BY_POINTS"
eq "ranked by z, both leagues are represented in the top 8" "2" \
  "$($Q -c "SELECT count(DISTINCT league_id) FROM (SELECT league_id FROM public.manager_week_metrics ORDER BY z_score DESC, points_for DESC LIMIT 8) t")"

say ""
say "STEP 5 - the privacy floor refuses to answer"
eq "16 managers is under the floor -> zero rows" "0" \
  "$($Q -c "SELECT count(*) FROM public.leaderboard_week(2026, 1, 50)")"
eq "the floor is the spec's 100" "100" "$($Q -c "SELECT public.leaderboard_min_managers()")"

say ""
say "STEP 6 - and answers once the population clears it"
# 84 more managers in a third league, same shape, so the cut reaches 100.
$Q >/dev/null <<'SQL'
INSERT INTO public.leagues VALUES ('55555555-0000-4000-8000-000000000005','Charlie');
INSERT INTO auth.users SELECT ('66666666-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid FROM generate_series(1,84) i;
INSERT INTO public.profiles SELECT ('66666666-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'Sub ' || i, 's' || i FROM generate_series(1,84) i;
INSERT INTO public.teams SELECT ('77777777-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
  '55555555-0000-4000-8000-000000000005', ('66666666-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'C'||i
  FROM generate_series(1,84) i;
INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
SELECT '55555555-0000-4000-8000-000000000005', 1,
       ('77777777-0000-4000-8000-' || lpad((2*i-1)::text,12,'0'))::uuid,
       ('77777777-0000-4000-8000-' || lpad((2*i)::text,12,'0'))::uuid,
       80 + i, 80 + i*0.5, 'completed', '2026-09-27','2026-10-03'
  FROM generate_series(1,42) i;
SQL
$Q -c "SELECT public.refresh_manager_week_metrics(2026, 1)" >/dev/null
eq "population is now 100" "100" "$($Q -c "SELECT count(DISTINCT user_id) FROM public.manager_week_metrics")"
eq "the leaderboard answers" "50" "$($Q -c "SELECT count(*) FROM public.leaderboard_week(2026, 1, 50)")"
eq "rank 1 is rank 1" "1" "$($Q -c "SELECT rank FROM public.leaderboard_week(2026,1,50) ORDER BY rank LIMIT 1")"
eq "it reports the population it ranked over" "100" \
  "$($Q -c "SELECT DISTINCT population FROM public.leaderboard_week(2026,1,50)")"
eq "ranks are dense and ordered" "50" \
  "$($Q -c "SELECT count(*) FROM (SELECT rank, row_number() OVER (ORDER BY rank) rn FROM public.leaderboard_week(2026,1,50)) t WHERE rank = rn")"

say ""
say "STEP 7 - re-running updates rather than duplicating"
BEFORE=$($Q -c "SELECT count(*) FROM public.manager_week_metrics")
$Q -c "SELECT public.refresh_manager_week_metrics(2026, 1)" >/dev/null
eq "row count unchanged on re-run" "$BEFORE" "$($Q -c "SELECT count(*) FROM public.manager_week_metrics")"
eq "the unique constraint is what makes that true" "1" \
  "$($Q -c "SELECT count(*) FROM pg_constraint WHERE conname='manager_week_metrics_unique'")"

say ""
say "STEP 8 - the three unbuilt metrics ship NULL, not zero"
# Rule 9: hide the field, never a plausible number. Zero would render.
eq "lineup_efficiency all NULL" "0" "$($Q -c "SELECT count(*) FROM public.manager_week_metrics WHERE lineup_efficiency IS NOT NULL")"
eq "waiver_hit_rate all NULL"   "0" "$($Q -c "SELECT count(*) FROM public.manager_week_metrics WHERE waiver_hit_rate IS NOT NULL")"
eq "xg_luck all NULL"           "0" "$($Q -c "SELECT count(*) FROM public.manager_week_metrics WHERE xg_luck IS NOT NULL")"

say ""
say "STEP 9 - incomplete weeks are not ranked"
$Q -c "UPDATE public.matchups SET status='in_progress' WHERE league_id='11111111-0000-4000-8000-000000000001'" >/dev/null
$Q -c "DELETE FROM public.manager_week_metrics" >/dev/null
$Q -c "SELECT public.refresh_manager_week_metrics(2026, 1)" >/dev/null
eq "Alpha's 8 managers drop out while its week is live" "92" \
  "$($Q -c "SELECT count(*) FROM public.manager_week_metrics")"

say ""
say "=================================================="
if [ "$FAIL" -eq 0 ]; then say "ALL PASS  ($PASS assertions)"; else say "$FAIL FAILED, $PASS passed"; fi
say "=================================================="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
