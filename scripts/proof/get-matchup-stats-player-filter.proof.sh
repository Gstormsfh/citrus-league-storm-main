#!/usr/bin/env bash
#
# PROOF: 20260904002000_get_matchup_stats_filters_by_player.sql
#
# The claim this migration makes is unusual: it changes what the database
# READS without changing a single thing it RETURNS. So this script spends
# almost all of its effort on the second half of that claim - the OLD and NEW
# functions are run over the same fixture and compared cell for cell, over the
# awkward inputs as well as the ordinary one - and then measures the first.
#
# Requires a scratch PostgreSQL 16 cluster:
#   PGHOST=/home/claude/pgsock PGPORT=54329 PGUSER=postgres \
#     scripts/proof/get-matchup-stats-player-filter.proof.sh
#
# Nothing here touches production.

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
MIG="$REPO_ROOT/supabase/migrations"
CAP="$MIG/captures"

export PGHOST="${PGHOST:-/home/claude/pgsock}"
export PGPORT="${PGPORT:-54329}"
export PGUSER="${PGUSER:-postgres}"
DB="${DB:-matchup_stats_proof}"

PASS=0; FAIL=0
step() { printf '\n== %s\n' "$*"; }
pass() { PASS=$((PASS+1)); printf '   PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL+1)); printf '   FAIL  %s\n' "$*"; }
P()    { psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
Q()    { psql -d "$DB" -tAc "$1"; }
eq()   { local got; got="$(Q "$2")"; if [ "$got" = "$3" ]; then pass "$1 ($got)"; else fail "$1: expected [$3], got [$got]"; fi; }
gt()   { local got; got="$(Q "$2")"; if [ "$got" -gt "$3" ] 2>/dev/null; then pass "$1 ($got)"; else fail "$1: expected > $3, got [$got]"; fi; }

printf '\n=== get_matchup_stats player-filter proof ===\n'
printf 'cluster: %s:%s  db: %s\n' "$PGHOST" "$PGPORT" "$DB"

step "0. scratch database and fixture"
psql -d postgres -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $DB;" >/dev/null

P <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role;  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon;          END IF;
END $$;

CREATE TABLE public.nhl_games (
  game_id   integer PRIMARY KEY,
  game_date date NOT NULL,
  game_type text NOT NULL
);

-- Only the columns get_matchup_stats actually reads. `pgs.*` expands to
-- whatever this table has, so the shape here IS the shape the function sees.
CREATE TABLE public.player_game_stats (
  game_id            integer NOT NULL,
  player_id          integer NOT NULL,
  is_goalie          boolean,
  nhl_goals          integer, nhl_assists integer, nhl_points integer,
  nhl_shots_on_goal  integer, nhl_hits integer, nhl_blocks integer, nhl_pim integer,
  nhl_ppp integer, nhl_ppg integer, nhl_ppa integer,
  nhl_shp integer, nhl_shg integer, nhl_sha integer,
  nhl_plus_minus     integer,
  goalie_gp          integer,
  nhl_wins integer, wins integer,
  nhl_saves integer, saves integer,
  nhl_goals_against integer, goals_against integer,
  nhl_shots_faced integer, shots_faced integer,
  nhl_shutouts integer, shutouts integer,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE public.nhl_shots (
  id serial PRIMARY KEY,
  game_id    integer NOT NULL,
  shooter_id integer NOT NULL,
  xg_sql     numeric
);

-- Four regular games inside the window; one PLAYOFF game inside it; one
-- regular game outside it. Both excluded games carry real rows, so a filter
-- that leaked would change the answer rather than merely the cost.
INSERT INTO public.nhl_games VALUES
  (101,'2026-03-30','regular'), (102,'2026-03-31','regular'),
  (103,'2026-04-02','regular'), (104,'2026-04-04','regular'),
  (105,'2026-04-01','playoff'),
  (106,'2026-04-20','regular');

-- 300 players x 6 games. Ids 1-5 are goalies; 35-40 are deliberately given NO
-- rows at all, so the requested set contains players the fixture cannot
-- answer for.
INSERT INTO public.player_game_stats
SELECT g.game_id, p.player_id,
       (p.player_id <= 5),
       (p.player_id % 4), (p.player_id % 3), (p.player_id % 4) + (p.player_id % 3),
       (p.player_id % 7), (p.player_id % 5), (p.player_id % 6), (p.player_id % 9),
       0, (p.player_id % 2), (p.player_id % 3),          -- nhl_ppp 0 -> ppg+ppa fallback
       0, (p.player_id % 2), 0,                          -- nhl_shp 0 -> shg+sha fallback
       (p.player_id % 5) - 2,
       CASE WHEN p.player_id <= 5 THEN 1 ELSE 0 END,
       0, (p.player_id % 2),                             -- nhl_wins 0 -> wins fallback
       0, 20 + (p.player_id % 11),
       0, (p.player_id % 4),
       0, 25 + (p.player_id % 13),
       0, CASE WHEN p.player_id = 1 THEN 1 ELSE 0 END
FROM generate_series(1,300) AS p(player_id)
CROSS JOIN (VALUES (101),(102),(103),(104),(105),(106)) AS g(game_id)
WHERE p.player_id NOT BETWEEN 35 AND 40;

-- Ten shots per player per game, with a NULL xg in the mix so the SUM's NULL
-- handling is exercised on both sides of the comparison.
INSERT INTO public.nhl_shots (game_id, shooter_id, xg_sql)
SELECT g.game_id, p.player_id,
       CASE WHEN (p.player_id + s.i) % 17 = 0 THEN NULL
            ELSE round((0.01 * ((p.player_id + s.i) % 30))::numeric, 4) END
FROM generate_series(1,300) AS p(player_id)
CROSS JOIN (VALUES (101),(102),(103),(104),(105),(106)) AS g(game_id)
CROSS JOIN generate_series(1,10) AS s(i)
WHERE p.player_id NOT BETWEEN 35 AND 40;
SQL
[ $? -eq 0 ] && pass "fixture built" || fail "fixture"
eq "player_game_stats rows" "SELECT count(*) FROM player_game_stats;" "1764"
eq "nhl_shots rows"         "SELECT count(*) FROM nhl_shots;" "17640"

# The seven inputs both bodies are compared over. Case G's window contains no
# game at all; case B is the empty array; case C is ids the fixture has never
# heard of; case D asks for every player in the league.
run_cases() { # run_cases <target table>
  P <<SQL
CREATE TABLE $1 AS SELECT 'A'::text AS case_id, * FROM get_matchup_stats(
  (SELECT array_agg(i)::integer[] FROM generate_series(1,40) i), '2026-03-29', '2026-04-04');
INSERT INTO $1 SELECT 'B', * FROM get_matchup_stats(ARRAY[]::integer[], '2026-03-29', '2026-04-04');
INSERT INTO $1 SELECT 'C', * FROM get_matchup_stats(ARRAY[900,901,902,903,904,905], '2026-03-29', '2026-04-04');
INSERT INTO $1 SELECT 'D', * FROM get_matchup_stats(
  (SELECT array_agg(i)::integer[] FROM generate_series(1,300) i), '2026-03-29', '2026-04-04');
INSERT INTO $1 SELECT 'E', * FROM get_matchup_stats(ARRAY[1], '2026-03-29', '2026-04-04');
INSERT INTO $1 SELECT 'F', * FROM get_matchup_stats(ARRAY[1,2,36,37,120,299,900], '2026-03-29', '2026-04-04');
INSERT INTO $1 SELECT 'G', * FROM get_matchup_stats(ARRAY[1,2,3], '2026-06-01', '2026-06-07');
SQL
}

step "1. install the byte-exact captured OLD body and record what it answers"
if [ ! -f "$CAP/2026-09-04_pre_get_matchup_stats.sql" ]; then
  fail "capture missing"
else
  P -f "$CAP/2026-09-04_pre_get_matchup_stats.sql" >/dev/null 2>&1 && pass "loaded capture" || fail "loading capture"
fi
run_cases res_old >/dev/null 2>&1 && pass "OLD answered all 7 cases" || fail "OLD case run"
eq "OLD rows recorded" "SELECT count(*) FROM res_old;" "357"
# Sanity: the fixture actually produces numbers, so an all-zero comparison
# cannot pass by accident.
gt "OLD case A total goals" "SELECT COALESCE(SUM(goals),0)::text FROM res_old WHERE case_id='A';" "0"
gt "OLD case A total x_goals (rounded)" "SELECT COALESCE(ROUND(SUM(x_goals)),0)::text FROM res_old WHERE case_id='A';" "0"

step "2. DEFECT - the OLD body reads the whole league to answer about 40 players"
eq "week_rows as OLD computes it" \
   "SELECT count(*) FROM player_game_stats pgs JOIN (SELECT game_id FROM nhl_games WHERE game_date >= '2026-03-29' AND game_date <= '2026-04-04' AND game_type='regular') ng ON pgs.game_id = ng.game_id;" "1176"
eq "week_rows as NEW computes it" \
   "SELECT count(*) FROM player_game_stats pgs JOIN (SELECT game_id FROM nhl_games WHERE game_date >= '2026-03-29' AND game_date <= '2026-04-04' AND game_type='regular') ng ON pgs.game_id = ng.game_id WHERE pgs.player_id = ANY(ARRAY(SELECT generate_series(1,40)));" "136"
eq "week_shots as OLD computes it" \
   "SELECT count(*) FROM nhl_shots s JOIN (SELECT game_id FROM nhl_games WHERE game_date >= '2026-03-29' AND game_date <= '2026-04-04' AND game_type='regular') ng ON s.game_id = ng.game_id;" "11760"
eq "week_shots as NEW computes it" \
   "SELECT count(*) FROM nhl_shots s JOIN (SELECT game_id FROM nhl_games WHERE game_date >= '2026-03-29' AND game_date <= '2026-04-04' AND game_type='regular') ng ON s.game_id = ng.game_id WHERE s.shooter_id = ANY(ARRAY(SELECT generate_series(1,40)));" "1360"

step "3. apply the migration"
out="$(P -f "$MIG/20260904002000_get_matchup_stats_filters_by_player.sql" 2>&1)"
[ $? -eq 0 ] && pass "applied" || fail "applying: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
MD5_1="$(Q "SELECT md5(pg_get_functiondef('public.get_matchup_stats(integer[],date,date)'::regprocedure));")"

step "4. THE POINT - the NEW body answers identically, cell for cell"
run_cases res_new >/dev/null 2>&1 && pass "NEW answered all 7 cases" || fail "NEW case run"
eq "NEW returns the same number of rows" "SELECT count(*) FROM res_new;" "357"
eq "rows in OLD but not NEW" \
   "SELECT count(*) FROM (TABLE res_old EXCEPT ALL TABLE res_new) d;" "0"
eq "rows in NEW but not OLD" \
   "SELECT count(*) FROM (TABLE res_new EXCEPT ALL TABLE res_old) d;" "0"

# Said again per case, so a failure names the input rather than the total.
for c in A B C D E F G; do
  eq "case $c identical" \
     "SELECT (SELECT count(*) FROM (SELECT * FROM res_old WHERE case_id='$c' EXCEPT ALL SELECT * FROM res_new WHERE case_id='$c') a) + (SELECT count(*) FROM (SELECT * FROM res_new WHERE case_id='$c' EXCEPT ALL SELECT * FROM res_old WHERE case_id='$c') b);" "0"
done

step "5. the excluded games are still excluded (a leaking filter would show here)"
# Game 105 is inside the window but a playoff; 106 is regular but outside it.
# If either leaked, case A's goals would rise.
eq "case A goals unchanged by the filters" \
   "SELECT ((SELECT SUM(goals) FROM res_old WHERE case_id='A') = (SELECT SUM(goals) FROM res_new WHERE case_id='A'))::text;" "true"
eq "a player with no rows still returns a zero row, not no row" \
   "SELECT count(*)::text FROM res_new WHERE case_id='F' AND player_id IN (36,37,900);" "3"
eq "and those rows are all zero" \
   "SELECT (SUM(goals)+SUM(assists)+SUM(saves)+SUM(x_goals))::text FROM res_new WHERE case_id='F' AND player_id IN (36,37,900);" "0"
eq "the empty array returns no rows" "SELECT count(*)::text FROM res_new WHERE case_id='B';" "0"
eq "an out-of-window week returns zeroed rows for each id" \
   "SELECT count(*)::text FROM res_new WHERE case_id='G';" "3"

step "6. the aggregates that use fallbacks still fire"
# nhl_ppp is 0 for every fixture row, so a non-zero ppp proves the
# COALESCE(NULLIF(...), ppg+ppa) branch is still being taken.
gt "powerplay points come through the NULLIF fallback" \
   "SELECT COALESCE(SUM(ppp),0)::text FROM res_new WHERE case_id='D';" "0"
gt "goalie wins come through the NULLIF fallback" \
   "SELECT COALESCE(SUM(wins),0)::text FROM res_new WHERE case_id='D';" "0"
eq "goalie games played counted only for goalies" \
   "SELECT COALESCE(SUM(goalie_gp),0)::text FROM res_new WHERE case_id='D' AND player_id > 5;" "0"
gt "goalies do have games played" \
   "SELECT COALESCE(SUM(goalie_gp),0)::text FROM res_new WHERE case_id='D' AND player_id <= 5;" "0"

step "7. re-apply (idempotence)"
out="$(P -f "$MIG/20260904002000_get_matchup_stats_filters_by_player.sql" 2>&1)"
[ $? -eq 0 ] && pass "re-applied" || fail "re-applying: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
eq "body unchanged by re-apply" \
   "SELECT (md5(pg_get_functiondef('public.get_matchup_stats(integer[],date,date)'::regprocedure)) = '$MD5_1')::text;" "true"

printf '\n----------------------------------------\n'
printf 'get_matchup_stats md5 = %s\n' "$MD5_1"
printf 'passed: %d   failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then printf 'ALL PASS\n'; exit 0; else printf 'FAILURES PRESENT\n'; exit 1; fi
