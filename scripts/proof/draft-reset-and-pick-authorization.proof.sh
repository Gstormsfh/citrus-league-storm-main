#!/usr/bin/env bash
#
# PROOF: 20260904000000_nuclear_reset_draft_clears_v2_state.sql
#        20260904001000_make_draft_pick_team_ownership.sql
#
# Reproduces both defects against the byte-exact captured OLD bodies, applies
# the two migrations, proves the NEW behaviour, and proves both migrations are
# idempotent on re-apply.
#
# Requires a scratch PostgreSQL 16 cluster. Point PGHOST/PGPORT/PGUSER at it:
#   PGHOST=/home/claude/pgsock PGPORT=54329 PGUSER=postgres \
#     scripts/proof/draft-reset-and-pick-authorization.proof.sh
#
# Nothing here touches production. The scratch database is dropped and
# recreated on every run.

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
MIG="$REPO_ROOT/supabase/migrations"
CAP="$MIG/captures"

export PGHOST="${PGHOST:-/home/claude/pgsock}"
export PGPORT="${PGPORT:-54329}"
export PGUSER="${PGUSER:-postgres}"
DB="${DB:-draft_reset_proof}"

PASS=0
FAIL=0

step()  { printf '\n== %s\n' "$*"; }
pass()  { PASS=$((PASS+1)); printf '   PASS  %s\n' "$*"; }
fail()  { FAIL=$((FAIL+1)); printf '   FAIL  %s\n' "$*"; }

P()  { psql -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
Q()  { psql -d "$DB" -tAc "$1"; }

# Assert a scalar query returns an expected value.
eq() { # eq <label> <sql> <expected>
  local got; got="$(Q "$2")"
  if [ "$got" = "$3" ]; then pass "$1 ($3)"; else fail "$1: expected [$3], got [$got]"; fi
}

# Assert a statement SUCCEEDS.
succeeds() { # succeeds <label> <sql>
  local out; out="$(psql -d "$DB" -v ON_ERROR_STOP=1 -tAc "$2" 2>&1)"
  if [ $? -eq 0 ]; then pass "$1"; else fail "$1: expected success, got: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi
}

# Assert a statement FAILS with a message containing a substring.
raises() { # raises <label> <sql> <substring>
  local out; out="$(psql -d "$DB" -v ON_ERROR_STOP=1 -tAc "$2" 2>&1)"
  local rc=$?
  if [ $rc -eq 0 ]; then
    fail "$1: expected an exception containing [$3], statement succeeded"
  elif printf '%s' "$out" | grep -qF "$3"; then
    pass "$1"
  else
    fail "$1: expected [$3], got: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"
  fi
}

# ── Fixed identities. Glyph-stable so failures are readable. ────────────────
L1='11111111-1111-1111-1111-111111111111'   # league under test
L2='22222222-2222-2222-2222-222222222222'   # a second league
CO='aaaaaaaa-0000-0000-0000-00000000000c'   # commissioner of L1
U1='aaaaaaaa-0000-0000-0000-000000000001'   # owner of T1
U2='aaaaaaaa-0000-0000-0000-000000000002'   # owner of T2
T1='bbbbbbbb-0000-0000-0000-000000000001'
T2='bbbbbbbb-0000-0000-0000-000000000002'
T3='bbbbbbbb-0000-0000-0000-000000000003'   # a team in L2
DS='cccccccc-0000-0000-0000-00000000000d'   # draft_session_id

printf '\n=== draft reset + pick authorization proof ===\n'
printf 'cluster: %s:%s  db: %s\n' "$PGHOST" "$PGPORT" "$DB"

# ── 0. Scratch database ────────────────────────────────────────────────────
step "0. scratch database"
psql -d postgres -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $DB;" >/dev/null

P <<'SQL'
-- Roles Supabase provides and the migrations' GRANTs may reference.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon;          END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- auth.uid() shim: reads the same GUC PostgREST sets, so "acting as" in this
-- proof is the same mechanism the real functions see in production.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE draft_status AS ENUM ('not_started','queued','in_progress','completed');

CREATE TABLE public.leagues (
  id uuid PRIMARY KEY,
  name text,
  commissioner_id uuid,
  draft_status draft_status,
  draft_state text,
  scheduled_draft_time timestamptz,
  settings jsonb
);

CREATE TABLE public.teams (
  id uuid PRIMARY KEY,
  league_id uuid REFERENCES public.leagues(id),
  owner_id uuid,
  team_name text
);

CREATE TABLE public.draft_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, player_id text,
  round_number int, pick_number int,
  draft_session_id uuid, picked_at timestamptz, deleted_at timestamptz
);

CREATE TABLE public.draft_picks_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, player_id text,
  round_number int, pick_number int
);

CREATE TABLE public.draft_events (
  id bigserial PRIMARY KEY,
  league_id uuid, event_type text, payload jsonb
);

CREATE TABLE public.draft_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, state jsonb
);

CREATE TABLE public.draft_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, pick_number int
);

CREATE TABLE public.draft_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, player_id text
);

CREATE TABLE public.auction_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, remaining int
);

CREATE TABLE public.auction_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, player_id text, status text
);

CREATE TABLE public.auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, amount int
);

CREATE TABLE public.team_lineups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid, slot text
);

CREATE TABLE public.roster_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid, team_id uuid, player_id text
);
SQL
[ $? -eq 0 ] && pass "schema bootstrapped" || fail "schema bootstrap"

# Seeder, reused before every reset test.
SEED_SQL=$(cat <<SQL
DELETE FROM public.roster_assignments;  DELETE FROM public.team_lineups;
DELETE FROM public.auction_bids;        DELETE FROM public.auction_nominations;
DELETE FROM public.auction_budgets;     DELETE FROM public.draft_queues;
DELETE FROM public.draft_order;         DELETE FROM public.draft_snapshots;
DELETE FROM public.draft_events;        DELETE FROM public.draft_picks_v2;
DELETE FROM public.draft_picks;         DELETE FROM public.teams;
DELETE FROM public.leagues;

INSERT INTO public.leagues (id, name, commissioner_id, draft_status, draft_state, scheduled_draft_time, settings)
VALUES ('$L1','Test at golf','$CO','completed','completed', now(),
        '{"draftCompletedAt":"2026-09-04T00:20:00Z","timerStartedAt":"2026-09-04T00:03:00Z","keeperEnabled":false}'::jsonb),
       ('$L2','Another league','$CO','not_started','not_started', NULL, '{}'::jsonb);

INSERT INTO public.teams (id, league_id, owner_id, team_name) VALUES
  ('$T1','$L1','$U1','Team One'),
  ('$T2','$L1','$U2','Team Two'),
  ('$T3','$L2','$U1','Team Three');

-- A completed v2 draft: picks in draft_picks_v2, nothing in draft_picks.
INSERT INTO public.draft_picks_v2 (league_id, team_id, player_id, round_number, pick_number) VALUES
  ('$L1','$T1','8478402',1,1), ('$L1','$T2','8477934',1,2);
INSERT INTO public.draft_events (league_id, event_type, payload) VALUES
  ('$L1','draft_started','{}'::jsonb), ('$L1','pick_made','{}'::jsonb), ('$L1','draft_completed','{}'::jsonb);
INSERT INTO public.draft_snapshots (league_id, state) VALUES ('$L1','{"picks":2}'::jsonb);
INSERT INTO public.draft_order (league_id, team_id, pick_number) VALUES ('$L1','$T1',1), ('$L1','$T2',2);
INSERT INTO public.auction_budgets (league_id, team_id, remaining) VALUES ('$L1','$T1',137);
INSERT INTO public.auction_nominations (league_id, player_id, status) VALUES ('$L1','8478402','sold');
INSERT INTO public.auction_bids (league_id, team_id, amount) VALUES ('$L1','$T1',63);
INSERT INTO public.team_lineups (team_id, slot) VALUES ('$T1','C1');

-- A trade has happened since the draft: pick 1 was drafted by T1 but the
-- roster says T2 owns him now.
INSERT INTO public.roster_assignments (league_id, team_id, player_id) VALUES
  ('$L1','$T2','8478402'), ('$L1','$T2','8477934');

-- A manager's own pre-draft queue. This must SURVIVE a reset.
INSERT INTO public.draft_queues (league_id, team_id, player_id) VALUES ('$L1','$T1','8480069');
SQL
)

# ── 1. Install the captured OLD bodies ─────────────────────────────────────
step "1. install the byte-exact captured OLD bodies"
for c in 2026-09-04_pre_nuclear_reset_draft 2026-09-04_pre_make_draft_pick; do
  if [ ! -f "$CAP/$c.sql" ]; then fail "capture missing: $CAP/$c.sql"; else
    P -f "$CAP/$c.sql" >/dev/null 2>&1 && pass "loaded capture $c" || fail "loading capture $c"
  fi
done

# ── 2. Reproduce DEFECT 1: the reset does not reset a v2 draft ─────────────
step "2. DEFECT 1 - nuclear_reset_draft against the OLD body"
P -c "$SEED_SQL" >/dev/null
eq "seeded: draft_picks_v2 rows"  "SELECT count(*) FROM draft_picks_v2 WHERE league_id='$L1';" "2"
eq "seeded: draft_picks rows (v2 league, so empty)" "SELECT count(*) FROM draft_picks WHERE league_id='$L1';" "0"

succeeds "commissioner runs the OLD reset" \
  "SELECT set_config('request.jwt.claim.sub','$CO',false); SELECT nuclear_reset_draft('$L1');"

eq "DEFECT: picks survive the reset"        "SELECT count(*) FROM draft_picks_v2 WHERE league_id='$L1';" "2"
eq "DEFECT: the event log survives"         "SELECT count(*) FROM draft_events WHERE league_id='$L1';" "3"
eq "DEFECT: the engine snapshot survives"   "SELECT count(*) FROM draft_snapshots WHERE league_id='$L1';" "1"
eq "DEFECT: auction budgets survive"        "SELECT count(*) FROM auction_budgets WHERE league_id='$L1';" "1"
eq "DEFECT: draft_state still says completed" "SELECT draft_state FROM leagues WHERE id='$L1';" "completed"
eq "DEFECT: draftCompletedAt still present" "SELECT (settings ? 'draftCompletedAt')::text FROM leagues WHERE id='$L1';" "true"
eq "the league now disagrees with itself"   "SELECT (draft_status::text <> draft_state)::text FROM leagues WHERE id='$L1';" "true"
eq "rosters really were destroyed"          "SELECT count(*) FROM roster_assignments WHERE league_id='$L1';" "0"

# ── 3. Reproduce DEFECT 2: pick for a team you do not own ──────────────────
step "3. DEFECT 2 - make_draft_pick against the OLD body"
P -c "$SEED_SQL" >/dev/null
succeeds "DEFECT: U2 files a pick for U1's team" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT make_draft_pick('$L1','$T1','8471214',1,1,'$DS');"
eq "the pick really landed on the other manager's team" \
  "SELECT count(*) FROM draft_picks WHERE team_id='$T1' AND player_id='8471214';" "1"

succeeds "DEFECT: U1 files a pick for a team in a DIFFERENT league" \
  "SELECT set_config('request.jwt.claim.sub','$U1',false); SELECT make_draft_pick('$L1','$T3','8471675',1,2,'$DS');"
eq "a foreign-league team now has a pick in this league" \
  "SELECT count(*) FROM draft_picks WHERE league_id='$L1' AND team_id='$T3';" "1"

# ── 4. Apply both migrations ───────────────────────────────────────────────
step "4. apply the migrations"
for m in 20260904000000_nuclear_reset_draft_clears_v2_state 20260904001000_make_draft_pick_team_ownership; do
  out="$(P -f "$MIG/$m.sql" 2>&1)"
  if [ $? -eq 0 ]; then pass "applied $m"; else fail "applying $m: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"; fi
done

MD5_RESET_1="$(Q "SELECT md5(pg_get_functiondef('public.nuclear_reset_draft(uuid)'::regprocedure));")"
MD5_PICK_1="$(Q "SELECT md5(pg_get_functiondef('public.make_draft_pick(uuid,uuid,text,integer,integer,uuid)'::regprocedure));")"

# ── 5. NEW behaviour: the reset actually resets ────────────────────────────
step "5. NEW - nuclear_reset_draft clears v2 state"
P -c "$SEED_SQL" >/dev/null

raises "a non-commissioner still cannot reset" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT nuclear_reset_draft('$L1');" \
  "Only the commissioner can reset the draft"
eq "and the refused reset destroyed nothing" "SELECT count(*) FROM draft_picks_v2 WHERE league_id='$L1';" "2"

succeeds "commissioner runs the NEW reset" \
  "SELECT set_config('request.jwt.claim.sub','$CO',false); SELECT nuclear_reset_draft('$L1');"

eq "picks cleared"            "SELECT count(*) FROM draft_picks_v2 WHERE league_id='$L1';" "0"
eq "event log cleared"        "SELECT count(*) FROM draft_events WHERE league_id='$L1';" "0"
eq "engine snapshot cleared"  "SELECT count(*) FROM draft_snapshots WHERE league_id='$L1';" "0"
eq "draft order cleared"      "SELECT count(*) FROM draft_order WHERE league_id='$L1';" "0"
eq "auction budgets cleared"  "SELECT count(*) FROM auction_budgets WHERE league_id='$L1';" "0"
eq "auction nominations cleared" "SELECT count(*) FROM auction_nominations WHERE league_id='$L1';" "0"
eq "auction bids cleared"     "SELECT count(*) FROM auction_bids WHERE league_id='$L1';" "0"
eq "lineups cleared"          "SELECT count(*) FROM team_lineups WHERE team_id IN (SELECT id FROM teams WHERE league_id='$L1');" "0"
eq "rosters cleared"          "SELECT count(*) FROM roster_assignments WHERE league_id='$L1';" "0"
eq "draft_status reset"       "SELECT draft_status::text FROM leagues WHERE id='$L1';" "not_started"
eq "draft_state reset"        "SELECT draft_state FROM leagues WHERE id='$L1';" "not_started"
eq "league agrees with itself" "SELECT (draft_status::text = draft_state)::text FROM leagues WHERE id='$L1';" "true"
eq "draftCompletedAt dropped" "SELECT (settings ? 'draftCompletedAt')::text FROM leagues WHERE id='$L1';" "false"
eq "timerStartedAt nulled"    "SELECT (settings->'timerStartedAt' = 'null'::jsonb)::text FROM leagues WHERE id='$L1';" "true"
eq "unrelated settings kept"  "SELECT (settings ? 'keeperEnabled')::text FROM leagues WHERE id='$L1';" "true"
eq "the manager's draft queue SURVIVES" "SELECT count(*) FROM draft_queues WHERE league_id='$L1';" "1"
eq "the other league is untouched" "SELECT count(*) FROM teams WHERE league_id='$L2';" "1"

# ── 6. NEW behaviour: picks are tied to the team ───────────────────────────
step "6. NEW - make_draft_pick ties authorization to p_team_id"
P -c "$SEED_SQL" >/dev/null

raises "U2 may NOT pick for U1's team" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT make_draft_pick('$L1','$T1','8471214',1,1,'$DS');" \
  "Not authorized to make picks for this team"
eq "nothing was written"  "SELECT count(*) FROM draft_picks WHERE league_id='$L1';" "0"

succeeds "U2 MAY pick for their own team" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT make_draft_pick('$L1','$T2','8471214',1,1,'$DS');"
eq "and it landed on their team" "SELECT count(*) FROM draft_picks WHERE team_id='$T2' AND player_id='8471214';" "1"

succeeds "the commissioner MAY still pick on behalf of a manager" \
  "SELECT set_config('request.jwt.claim.sub','$CO',false); SELECT make_draft_pick('$L1','$T1','8471675',1,2,'$DS');"

raises "a team from another league is refused" \
  "SELECT set_config('request.jwt.claim.sub','$U1',false); SELECT make_draft_pick('$L1','$T3','8480069',1,3,'$DS');" \
  "That team is not in this league"

raises "an unauthenticated caller is refused" \
  "SELECT set_config('request.jwt.claim.sub','',false); SELECT make_draft_pick('$L1','$T2','8480069',1,3,'$DS');" \
  "Not authorized to make picks for this team"

# The checks the migration promised not to disturb.
raises "duplicate player in the same session still refused" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT make_draft_pick('$L1','$T2','8471214',2,5,'$DS');" \
  "Player already drafted in this session"
raises "duplicate pick number still refused" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT make_draft_pick('$L1','$T2','8478864',1,1,'$DS');" \
  "This pick number is already taken in this session"

# ── 7. Idempotent re-apply ─────────────────────────────────────────────────
step "7. re-apply both migrations (idempotence)"
for m in 20260904000000_nuclear_reset_draft_clears_v2_state 20260904001000_make_draft_pick_team_ownership; do
  out="$(P -f "$MIG/$m.sql" 2>&1)"
  if [ $? -eq 0 ]; then pass "re-applied $m"; else fail "re-applying $m: $(printf '%s' "$out" | head -3 | tr '\n' ' ')"; fi
done
eq "nuclear_reset_draft body unchanged by re-apply" \
  "SELECT (md5(pg_get_functiondef('public.nuclear_reset_draft(uuid)'::regprocedure)) = '$MD5_RESET_1')::text;" "true"
eq "make_draft_pick body unchanged by re-apply" \
  "SELECT (md5(pg_get_functiondef('public.make_draft_pick(uuid,uuid,text,integer,integer,uuid)'::regprocedure)) = '$MD5_PICK_1')::text;" "true"

# Behaviour still holds after the second apply.
P -c "$SEED_SQL" >/dev/null
raises "still refuses a foreign team after re-apply" \
  "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT make_draft_pick('$L1','$T1','8471214',1,1,'$DS');" \
  "Not authorized to make picks for this team"

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n----------------------------------------\n'
printf 'nuclear_reset_draft md5 = %s\n' "$MD5_RESET_1"
printf 'make_draft_pick     md5 = %s\n' "$MD5_PICK_1"
printf 'passed: %d   failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then printf 'ALL PASS\n'; exit 0; else printf 'FAILURES PRESENT\n'; exit 1; fi
