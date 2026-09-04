#!/usr/bin/env bash
# CITRUS-CLASSIFICATION ----------------------------------------------------------
# CATEGORY: PROOF (scratch Postgres only; never points at a Supabase project)
# Purpose:     Prove 20260903200000_auction_lot_award_and_completion.sql against
#              prod-shaped tables: the OLD body forfeits an uncontested lot and
#              never completes the draft; the NEW body awards the nominator at
#              their opening bid, charges the budget, refuses to award when no
#              budget row exists, emits draft_completed on the final lot, and is
#              idempotent. Exit 0 = PASS.
# Last active: 2026-09-03
# Invoked:     PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash scripts/proof/auction-lot-award-and-completion.proof.sh
# Reads:       supabase/migrations/20260903200000_auction_lot_award_and_completion.sql
#              supabase/migrations/captures/2026-09-03_pre_auction_lot_award_and_completion.sql
# Writes:      scratch database auction_proof (dropped and recreated)
# ----------------------------------------------------------------------------
# Column types and constraints were harvested from production information_schema
# and pg_constraint on 2026-09-03, not composed (INS-16). auth.role() is stubbed
# to service_role because the RPC gates on it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260903200000_auction_lot_award_and_completion.sql"
CAP="$ROOT/supabase/migrations/captures/2026-09-03_pre_auction_lot_award_and_completion.sql"
P0="psql -v ON_ERROR_STOP=1 -qX"
$P0 -c "drop database if exists auction_proof;"
$P0 -c "create database auction_proof;"
P="$P0 -d auction_proof"

# uuidgen is absent on some runners; gen_random_uuid() is always there.
newuuid() { $P -tAc "select gen_random_uuid();" | tr -d '[:space:]'; }

$P <<'SQL'
-- Supabase ships these roles; a scratch cluster does not.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin;  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
end $$;
create schema if not exists auth;
create function auth.role() returns text language sql stable as $fn$ select 'service_role'::text $fn$;
create function auth.uid()  returns uuid language sql stable as $fn$ select null::uuid $fn$;

create table public.leagues (
  id uuid primary key, name text, league_size int, roster_size int, draft_rounds int,
  draft_status text not null default 'in_progress', draft_state text default 'active',
  draft_event_counter bigint not null default 0, pick_deadline timestamptz, settings jsonb default '{}'::jsonb);
create table public.teams (id uuid primary key, league_id uuid not null, team_name text, owner_id uuid);
create table public.draft_order (
  id bigserial primary key, league_id uuid not null, round_number int not null,
  team_order jsonb not null, deleted_at timestamptz);
create table public.draft_events (
  id bigserial primary key, league_id uuid not null, seq bigint not null,
  event_type text not null, event_version int default 1, payload jsonb not null,
  payload_hash text not null, idempotency_key uuid unique, actor jsonb,
  correlation_id uuid, created_at timestamptz not null default now());
create table public.auction_nominations (
  id uuid primary key, league_id uuid not null, nomination_number int not null,
  player_id text not null, player_name text, nominated_by_team_id uuid,
  current_high_bidder_team_id uuid, current_high_bid numeric,
  status text not null default 'active',
  constraint auction_nominations_status_check check (status in ('active','sold','no_sale')),
  expires_at timestamptz);
create table public.auction_bids (
  id bigserial primary key, nomination_id uuid not null, team_id uuid not null,
  bid_amount numeric not null, created_at timestamptz not null default now());
create table public.auction_budgets (
  league_id uuid not null, team_id uuid not null,
  remaining_budget numeric not null, players_won int not null default 0,
  updated_at timestamptz default now(),
  primary key (league_id, team_id),
  constraint auction_budgets_remaining_budget_check check (remaining_budget >= 0),
  constraint auction_budgets_players_won_check check (players_won >= 0));
create table public.draft_picks (
  id bigserial primary key, league_id uuid not null, round_number int, pick_number int,
  team_id uuid, player_id text, picked_at timestamptz, draft_session_id uuid, deleted_at timestamptz);

-- append_draft_event and the payload validator, prod contract only.
create function public.validate_draft_event_payload(p_event_type text, p_payload jsonb)
returns void language plpgsql as $fn$
begin
  if p_event_type = 'draft_completed' then
    if not (p_payload ? 'completed_at' and p_payload ? 'total_picks') then
      raise exception 'invalid_event_payload: draft_completed requires completed_at and total_picks';
    end if;
  end if;
end $fn$;
create function public.append_draft_event(p_league_id uuid, p_event_type text, p_payload jsonb,
  p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid)
returns bigint language plpgsql as $fn$
declare v_seq bigint; v_id bigint;
begin
  perform public.validate_draft_event_payload(p_event_type, p_payload);
  update public.leagues set draft_event_counter = draft_event_counter + 1
   where id = p_league_id returning draft_event_counter into v_seq;
  insert into public.draft_events (league_id, seq, event_type, payload, payload_hash,
    idempotency_key, actor, correlation_id)
  values (p_league_id, v_seq, p_event_type, p_payload, p_payload_hash,
    p_idempotency_key, p_actor, p_correlation_id) returning id into v_id;
  return v_id;
end $fn$;
SQL

# 2 teams x 2 rounds = 4 lots.
LG='11111111-1111-1111-1111-111111111111'
T1='22222222-2222-2222-2222-222222222222'
T2='33333333-3333-3333-3333-333333333333'
$P <<SQL
insert into public.leagues (id, name, league_size, roster_size, draft_rounds)
  values ('$LG','Proof Auction',2,21,2);
insert into public.teams values ('$T1','$LG','Alpha',null), ('$T2','$LG','Beta',null);
insert into public.draft_order (league_id, round_number, team_order) values
  ('$LG',1,'["$T1","$T2"]'::jsonb), ('$LG',2,'["$T1","$T2"]'::jsonb);
insert into public.auction_budgets values ('$LG','$T1',200,0), ('$LG','$T2',200,0);
SQL

# One uncontested lot: nominator opens at 5, nobody else bids.
mklot() { # $1 nomination uuid  $2 number  $3 player  $4 team  $5 amount
$P -c "insert into public.auction_nominations (id, league_id, nomination_number, player_id, player_name, nominated_by_team_id, current_high_bidder_team_id, current_high_bid, status)
       values ('$1','$LG',$2,'$3','Player $3','$4','$4',$5,'active');
       insert into public.auction_bids (nomination_id, team_id, bid_amount) values ('$1','$4',$5);" >/dev/null
}

echo "[1] OLD body (capture): the uncontested lot is forfeited, draft never completes"
$P -f "$CAP" >/dev/null
N1='aaaaaaaa-0000-4000-8000-000000000001'
mklot $N1 1 8478402 $T1 5
$P -c "select public.close_nomination_v2('$LG','$N1','$(newuuid)','h1','{\"kind\":\"autopick\"}'::jsonb,null);" >/dev/null
$P <<SQL
do \$\$ declare r record; c int; begin
  select status into r from public.auction_nominations where id = '$N1';
  if r.status <> 'no_sale' then raise exception 'UNEXPECTED: capture did not forfeit (got %); capture may not be the live body', r.status; end if;
  select players_won into c from public.auction_budgets where team_id = '$T1';
  if c <> 0 then raise exception 'UNEXPECTED: capture awarded a player'; end if;
  select count(*) into c from public.draft_picks; 
  if c <> 0 then raise exception 'UNEXPECTED: capture wrote a draft_pick'; end if;
  select count(*) into c from public.draft_events where event_type='draft_completed';
  if c <> 0 then raise exception 'UNEXPECTED: capture emitted draft_completed'; end if;
  raise notice 'old body: lot forfeited, no award, no completion (expected)';
end \$\$;
SQL

echo "[2] apply the migration"
$P -f "$MIG"

echo "[3] NEW body: an uncontested lot awards the nominator at the opening bid"
N2='aaaaaaaa-0000-4000-8000-000000000002'
mklot $N2 2 8477934 $T2 7
$P -c "select public.close_nomination_v2('$LG','$N2','$(newuuid)','h2','{\"kind\":\"autopick\"}'::jsonb,null);" >/dev/null
$P <<SQL
do \$\$ declare v_status text; v_rem numeric; v_won int; v_picks int; begin
  select status into v_status from public.auction_nominations where id='$N2';
  if v_status <> 'sold' then raise exception 'FAIL uncontested lot not sold: %', v_status; end if;
  select remaining_budget, players_won into v_rem, v_won from public.auction_budgets where team_id='$T2';
  if v_rem <> 193 or v_won <> 1 then raise exception 'FAIL budget not charged: rem=% won=%', v_rem, v_won; end if;
  select count(*) into v_picks from public.draft_picks where team_id='$T2' and player_id='8477934';
  if v_picks <> 1 then raise exception 'FAIL no draft_picks row'; end if;
  raise notice 'PASS uncontested lot awarded to nominator at opening bid, budget charged 200->193';
end \$\$;
SQL

echo "[4] NEW body: a contested lot still awards the high bidder"
N3='aaaaaaaa-0000-4000-8000-000000000003'
mklot $N3 3 8471675 $T1 3
$P -c "insert into public.auction_bids (nomination_id, team_id, bid_amount) values ('$N3','$T2',9);
       update public.auction_nominations set current_high_bidder_team_id='$T2', current_high_bid=9 where id='$N3';" >/dev/null
$P -c "select public.close_nomination_v2('$LG','$N3','$(newuuid)','h3','{\"kind\":\"autopick\"}'::jsonb,null);" >/dev/null
$P <<SQL
do \$\$ declare v_rem numeric; begin
  select remaining_budget into v_rem from public.auction_budgets where team_id='$T2';
  if v_rem <> 184 then raise exception 'FAIL contested lot: expected 184 got %', v_rem; end if;
  raise notice 'PASS contested lot awarded to high bidder (193->184)';
end \$\$;
SQL

echo "[5] NEW body: a missing budget row refuses the award instead of giving a free player"
$P -c "delete from public.auction_budgets where team_id='$T1';" >/dev/null
N4='aaaaaaaa-0000-4000-8000-000000000004'
mklot $N4 4 8476945 $T1 4
if $P -c "select public.close_nomination_v2('$LG','$N4','$(newuuid)','h4','{\"kind\":\"autopick\"}'::jsonb,null);" >/dev/null 2>&1; then
  echo "FAIL: close succeeded with no budget row"; exit 1
fi
$P <<SQL
do \$\$ declare c int; begin
  select count(*) into c from public.draft_picks where player_id='8476945';
  if c <> 0 then raise exception 'FAIL free player was awarded'; end if;
  select count(*) into c from public.auction_nominations where id='$N4' and status='active';
  if c <> 1 then raise exception 'FAIL nomination was mutated by a refused close'; end if;
  raise notice 'PASS missing budget row refuses the award and rolls back cleanly';
end \$\$;
SQL

echo "[6] NEW body: the final lot emits draft_completed once, and a lot BEYOND the\n    final one does not emit a second (the single-fire latch)"
$P -c "insert into public.auction_budgets values ('$LG','$T1',200,0);" >/dev/null
$P -c "select public.close_nomination_v2('$LG','$N4','$(newuuid)','h4b','{\"kind\":\"autopick\"}'::jsonb,null);" >/dev/null
N5='aaaaaaaa-0000-4000-8000-000000000005'
mklot $N5 5 8480069 $T2 2
$P -c "select public.close_nomination_v2('$LG','$N5','$(newuuid)','h5','{\"kind\":\"autopick\"}'::jsonb,null);" >/dev/null
$P <<SQL
do \$\$ declare v_status text; v_dl timestamptz; c int; p jsonb; begin
  select count(*) into c from public.draft_events where event_type='draft_completed';
  if c <> 1 then raise exception 'FAIL expected exactly 1 draft_completed, got %', c; end if;
  select payload into p from public.draft_events where event_type='draft_completed';
  if not (p ? 'completed_at' and p ? 'total_picks') then raise exception 'FAIL completion payload shape: %', p; end if;
  if (p->>'total_picks')::int <> 4 then raise exception 'FAIL total_picks expected 4 got %', p->>'total_picks'; end if;
  select draft_status, pick_deadline into v_status, v_dl from public.leagues where id='$LG';
  if v_status <> 'completed' then raise exception 'FAIL league not completed: %', v_status; end if;
  if v_dl is not null then raise exception 'FAIL pick_deadline not cleared'; end if;
  raise notice 'PASS 4 lots offered, 5 resolved (one beyond the end), draft_completed emitted exactly once, league flipped, deadline cleared';
end \$\$;
SQL

echo "[7] cancelled is now a legal status, and re-apply is a no-op"
$P -c "update public.auction_nominations set status='cancelled' where id='$N1';" >/dev/null
$P -f "$MIG" >/dev/null
$P <<SQL
do \$\$ declare c int; begin
  select count(*) into c from public.draft_events where event_type='draft_completed';
  if c <> 1 then raise exception 'FAIL re-apply changed completion count: %', c; end if;
  raise notice 'PASS cancelled accepted by the CHECK; migration re-applied cleanly';
end \$\$;
SQL

echo "ALL PASS"
