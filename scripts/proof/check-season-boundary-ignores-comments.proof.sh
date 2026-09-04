#!/usr/bin/env bash
#
# PROOF: 20260904003000_check_season_boundary_ignores_comments.sql
#
# The claim: the season_boundary invariant has been failing on a function that
# does not do the thing it is accused of. `check_season_boundary` greps every
# function body in `public` for a call to the naive calendar rule, and it greps
# `p.prosrc` - which includes comments. `pool_playoff_season` carries the
# comment explaining why it deliberately does NOT call that rule, so the
# detector matched the note describing the fix and reported the bug.
#
# A detector that reads its own explanation as the defect is worse than no
# detector, so the burden here is two-sided: the false positive must go AND a
# genuine caller must still be caught. Both are asserted, and the second is the
# one that matters - it is the assertion that would fail if the fix were
# "stop looking".
#
# Requires a scratch PostgreSQL 16 cluster. Nothing here touches production.
#
#   PGHOST=/home/claude/pgsock PGPORT=5432 PGUSER=claude \
#     scripts/proof/check-season-boundary-ignores-comments.proof.sh

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
MIG="$REPO_ROOT/supabase/migrations"
CAP="$MIG/captures"

export PGHOST="${PGHOST:-/home/claude/pgsock}"
export PGPORT="${PGPORT:-54329}"
export PGUSER="${PGUSER:-postgres}"

OLD="$CAP/2026-09-04_pre_check_season_boundary.sql"
NEW="$MIG/20260904003000_check_season_boundary_ignores_comments.sql"

DB=csb_proof
Q="psql -d $DB -v ON_ERROR_STOP=1 -tAq"

PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }
assert_eq() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); say "  PASS  $1"
  else FAIL=$((FAIL+1)); say "  FAIL  $1 -- expected [$2] got [$3]"; fi
}
assert_contains() {
  case "$3" in (*"$2"*) PASS=$((PASS+1)); say "  PASS  $1";;
              (*) FAIL=$((FAIL+1)); say "  FAIL  $1 -- [$2] not in [$3]";; esac
}
assert_absent() {
  case "$3" in (*"$2"*) FAIL=$((FAIL+1)); say "  FAIL  $1 -- [$2] still in [$3]";;
              (*) PASS=$((PASS+1)); say "  PASS  $1";; esac
}

# ---- the capture must be the byte-exact production body -------------------
say ""
say "STEP 0 - the capture is byte-exact production (MIGRATION_SAFETY_GUIDE Rule 1)"
EXPECTED_MD5=de27d7d72285aff9e9ba18d966636978
ACTUAL_MD5=$( (md5sum "$OLD" 2>/dev/null || md5 -q "$OLD") | awk '{print $1}' )
assert_eq "capture md5 matches the definition read off prod 2026-09-04" "$EXPECTED_MD5" "$ACTUAL_MD5"

psql -d postgres -q -c "DROP DATABASE IF EXISTS $DB"
psql -d postgres -q -c "CREATE DATABASE $DB"

$Q >/dev/null <<'SQL'
CREATE TABLE nhl_games (season int, game_type text, game_date date);
INSERT INTO nhl_games SELECT 2025,'regular',d::date
  FROM generate_series('2025-10-07'::date,'2026-04-15'::date,'1 day') d;
INSERT INTO nhl_games SELECT 2026,'regular',d::date
  FROM generate_series('2026-09-29'::date,'2027-04-10'::date,'1 day') d;

CREATE FUNCTION get_nhl_season_year(p_date date) RETURNS integer LANGUAGE sql IMMUTABLE AS
$f$ SELECT CASE WHEN EXTRACT(MONTH FROM p_date) >= 10
                THEN EXTRACT(YEAR FROM p_date)::int
                ELSE EXTRACT(YEAR FROM p_date)::int - 1 END $f$;

CREATE FUNCTION get_current_season(p_on date DEFAULT CURRENT_DATE) RETURNS integer LANGUAGE sql STABLE AS
$f$ SELECT 2025 $f$;

-- The production shape: NAMES the rule in a line comment, never calls it.
CREATE FUNCTION pool_playoff_season(p_league_id uuid) RETURNS integer LANGUAGE plpgsql STABLE AS
$f$
BEGIN
  -- Deliberately NOT get_nhl_season_year(), which answers the regular-season
  -- question and returns 2025 for September 2026.
  RETURN 2026;
END $f$;

-- Same mistake in a block comment, to prove /* */ is stripped too.
CREATE FUNCTION mentions_in_block_comment() RETURNS integer LANGUAGE plpgsql STABLE AS
$f$
BEGIN
  /* not get_nhl_season_year( ) -- see the season notes */
  RETURN 1;
END $f$;

-- A function that GENUINELY calls it. The detector must never stop seeing it.
CREATE FUNCTION real_offender(d date) RETURNS integer LANGUAGE plpgsql STABLE AS
$f$
BEGIN
  RETURN get_nhl_season_year(d);
END $f$;
SQL

flagged() { $Q -c "SELECT coalesce(string_agg(detail,''),'<none>') FROM check_season_boundary(1) WHERE problem='calendar_rule_called_directly'"; }
count_of() { $Q -c "SELECT count(*) FROM check_season_boundary($2) WHERE problem='$1'"; }

# ---- STEP 1 ---------------------------------------------------------------
say ""
say "STEP 1 - the defect reproduces against the CAPTURED production body"
$Q -f "$OLD" >/dev/null || { say "  FAIL  capture did not load"; FAIL=$((FAIL+1)); }
OUT=$(flagged)
assert_contains "OLD flags pool_playoff_season, which does not call the rule" "pool_playoff_season" "$OUT"
assert_contains "OLD flags the block-comment mention too" "mentions_in_block_comment" "$OUT"
assert_contains "OLD does see the genuine caller" "real_offender" "$OUT"
assert_eq "OLD raises exactly one ERROR row" "1" "$(count_of calendar_rule_called_directly 1)"

# ---- STEP 2 ---------------------------------------------------------------
say ""
say "STEP 2 - apply the migration"
$Q -f "$NEW" >/dev/null || { say "  FAIL  migration did not apply"; FAIL=$((FAIL+1)); }

# ---- STEP 3 - the two-sided burden ----------------------------------------
say ""
say "STEP 3 - comment-only mentions go, the real call stays"
OUT=$(flagged)
assert_contains "the genuine caller is STILL reported (the fix is not 'stop looking')" "real_offender" "$OUT"
assert_absent  "pool_playoff_season is no longer falsely reported" "pool_playoff_season" "$OUT"
assert_absent  "the block comment is stripped as well" "mentions_in_block_comment" "$OUT"

# ---- STEP 4 ---------------------------------------------------------------
say ""
say "STEP 4 - with the only real caller gone, the check goes clean"
$Q -c 'DROP FUNCTION real_offender(date)' >/dev/null
assert_eq "no callers left -> no ERROR row" "0" "$(count_of calendar_rule_called_directly 1)"

# ---- STEP 5 - the untouched checks still work -----------------------------
say ""
say "STEP 5 - the other two checks are unharmed"
assert_eq "schedule loaded -> no_schedule_loaded silent" "0" "$(count_of no_schedule_loaded 1)"
assert_eq "absurd horizon -> schedule_runs_out fires"    "1" "$(count_of schedule_runs_out 99999)"
assert_eq "1-day horizon -> schedule_runs_out silent"    "0" "$(count_of schedule_runs_out 1)"
$Q -c "DELETE FROM nhl_games" >/dev/null
assert_eq "empty nhl_games -> no_schedule_loaded fires"  "1" "$(count_of no_schedule_loaded 1)"
$Q -c "INSERT INTO nhl_games SELECT 2026,'regular',d::date FROM generate_series('2026-09-29'::date,'2027-04-10'::date,'1 day') d" >/dev/null

# ---- STEP 6 ---------------------------------------------------------------
say ""
say "STEP 6 - re-applying the migration is a no-op"
BEFORE=$($Q -c "SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='check_season_boundary'")
$Q -f "$NEW" >/dev/null || { say "  FAIL  re-apply errored"; FAIL=$((FAIL+1)); }
AFTER=$($Q -c "SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='check_season_boundary'")
assert_eq "body identical after re-apply" "$BEFORE" "$AFTER"

# ---- STEP 7 - nothing but that predicate moved ----------------------------
say ""
say "STEP 7 - nothing but that one predicate changed"
assert_eq "still STABLE SECURITY DEFINER" "1" \
  "$($Q -c "SELECT count(*) FROM pg_proc WHERE proname='check_season_boundary' AND prosecdef AND provolatile='s'")"
assert_eq "signature unchanged" "p_horizon_days integer" \
  "$($Q -c "SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='check_season_boundary'")"
assert_eq "all three message strings survived verbatim" "1" \
  "$($Q -c "SELECT count(*) FROM pg_proc WHERE proname='check_season_boundary' AND prosrc LIKE '%opening night%' AND prosrc LIKE '%no regular-season rows%' AND prosrc LIKE '%silently falls back%'")"

say ""
say "=================================================="
if [ "$FAIL" -eq 0 ]; then say "ALL PASS  ($PASS assertions)"; else say "$FAIL FAILED, $PASS passed"; fi
say "=================================================="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
