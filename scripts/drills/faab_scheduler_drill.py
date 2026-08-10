#!/usr/bin/env python3
"""
faab_scheduler_drill.py — anti-best-ball proof that FAAB processing actually
runs work and mutates state.

Runs against STAGING by default (or whatever env's .env resolves). Requires
one existing FAAB league in the target env (the drill will refuse if none
exists). Never touches prod unless the caller explicitly points at prod
creds AND passes --i-know-this-is-prod. Never creates or drops leagues.

Flow:
  1. Read one FAAB league from `leagues`.
  2. Snapshot a target team's faab budget and roster size.
  3. Pick an unrostered player_id from the target season.
  4. Create ONE synthetic pending waiver_claim: this team, this player,
     $10 bid, no drop. Priority column stores the bid.
  5. Call process_faab_waivers_for_league(leagueId).
  6. Assert:
     - Claim status transitioned to 'successful' or 'failed' (not 'pending').
     - If successful: budget decremented by exactly the bid amount.
     - If successful: player now on team's roster_assignments.
  7. Clean up: DELETE the synthetic claim; if successful, undo the roster
     add + restore the budget.

Green-run must show real writes (bid deducted, roster changed). A run that
touched zero rows is an anti-signal and returns exit 2 — the exact shape
`optimize-best-ball-rosters` failed on for 162 straight runs.
"""

import os
import sys
import argparse
import datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'data-pipeline'))
import _bootstrap  # noqa: F401
from data_pipeline.utils.supabase_rest import SupabaseRest


def _client() -> SupabaseRest:
    url = os.environ.get('VITE_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('ERROR: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required', file=sys.stderr)
        sys.exit(1)
    return SupabaseRest(url, key)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--league-id', help='Force a specific league; default: first FAAB league found')
    ap.add_argument('--bid-amount', type=int, default=10)
    ap.add_argument('--i-know-this-is-prod', action='store_true',
                    help='Required if VITE_SUPABASE_URL resolves to prod host')
    args = ap.parse_args()

    from urllib.parse import urlparse
    host = urlparse(os.environ['VITE_SUPABASE_URL']).hostname or ''
    is_prod = 'prod' in host or ('citrus' in host and 'staging' not in host)
    if is_prod and not args.i_know_this_is_prod:
        print(f'REFUSING: resolved host {host} looks like prod. '
              f'Pass --i-know-this-is-prod to override.', file=sys.stderr)
        return 1

    print(f'[drill] Supabase host: {host}')
    db = _client()

    # 1. Find a FAAB league
    leagues = db.select('leagues', select='id,name,waiver_type,settings',
                        filters=[('waiver_type', 'eq', 'faab')], limit=10) or []
    if args.league_id:
        leagues = [l for l in leagues if l.get('id') == args.league_id]
    if not leagues:
        print('REFUSING: no FAAB leagues found in target env.', file=sys.stderr)
        return 1
    league = leagues[0]
    league_id = league['id']
    print(f'[drill] league: {league_id} ({league.get("name")})')

    # 2. Snapshot a team + budget
    teams = db.select('teams', select='id,team_name,owner_id',
                      filters=[('league_id', 'eq', league_id)], limit=1) or []
    if not teams:
        print(f'REFUSING: league {league_id} has no teams', file=sys.stderr)
        return 1
    team = teams[0]
    team_id = team['id']
    print(f'[drill] team: {team_id} ({team.get("team_name")})')

    budgets = db.select('faab_budgets', select='remaining_budget',
                        filters=[('league_id', 'eq', league_id), ('team_id', 'eq', team_id)],
                        limit=1) or []
    if not budgets:
        print(f'REFUSING: team {team_id} has no faab_budgets row. '
              f'This is exactly the census gap M1 backfills.', file=sys.stderr)
        return 1
    starting_budget = float(budgets[0]['remaining_budget'])
    if starting_budget < args.bid_amount:
        print(f'REFUSING: budget {starting_budget} < bid {args.bid_amount}', file=sys.stderr)
        return 1
    print(f'[drill] starting budget: {starting_budget}')

    # 3. Pick an unrostered player from current season directory
    from data_pipeline.utils.season_config import current_season
    season = current_season()
    dir_rows = db.select('player_directory', select='player_id,full_name,team_abbrev',
                         filters=[('season', 'eq', season)], limit=50) or []
    rostered = db.select('roster_assignments', select='player_id',
                         filters=[('league_id', 'eq', league_id)], limit=1000) or []
    rostered_ids = {int(r['player_id']) for r in rostered if r.get('player_id') is not None}
    target = None
    for r in dir_rows:
        pid = int(r['player_id'])
        if pid not in rostered_ids:
            target = r
            break
    if not target:
        print('REFUSING: could not find an unrostered player_directory row', file=sys.stderr)
        return 1
    player_id = int(target['player_id'])
    print(f'[drill] target player: {player_id} {target.get("full_name")} ({target.get("team_abbrev")})')

    # 4. Create synthetic claim (via admin insert — bypasses claim schema
    #    validation; documented as drill-only). priority = bid_amount per
    #    FAAB convention.
    claim_row = {
        'league_id': league_id,
        'team_id': team_id,
        'player_id': player_id,
        'drop_player_id': None,
        'status': 'pending',
        'priority': args.bid_amount,
        'created_at': dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    # We insert one claim; capture the id.
    from urllib.request import Request, urlopen
    import json
    resp = db.session.post(
        f'{db.rest_base}/waiver_claims',
        headers={**db._headers(), 'Prefer': 'return=representation'},
        data=json.dumps([claim_row]),
        timeout=db.timeout_seconds,
    )
    if resp.status_code >= 400:
        print(f'REFUSING: could not insert synthetic claim: {resp.status_code} {resp.text}', file=sys.stderr)
        return 1
    inserted = resp.json()
    claim_id = inserted[0]['id']
    print(f'[drill] created pending claim {claim_id} bid={args.bid_amount}')

    try:
        # 5. Fire the processor
        print('[drill] calling process_faab_waivers_for_league...')
        result = db.rpc('process_faab_waivers_for_league', {'p_league_id': league_id})
        print(f'[drill] rpc returned: {result}')

        # 6. Assert
        post_claim = db.select('waiver_claims', select='status,processed_at,failure_reason',
                               filters=[('id', 'eq', claim_id)], limit=1) or []
        if not post_claim:
            print('DRILL FAIL: claim disappeared', file=sys.stderr)
            return 2
        final_status = post_claim[0]['status']
        print(f'[drill] claim final status: {final_status}')
        if final_status == 'pending':
            print('DRILL FAIL: claim still pending after processor ran — same '
                  'shape as best-ball no-op.', file=sys.stderr)
            return 2

        post_budget = db.select('faab_budgets', select='remaining_budget',
                                filters=[('league_id', 'eq', league_id),
                                         ('team_id', 'eq', team_id)],
                                limit=1) or []
        new_budget = float(post_budget[0]['remaining_budget']) if post_budget else None
        print(f'[drill] budget: {starting_budget} → {new_budget}')

        post_roster = db.select('roster_assignments', select='player_id',
                                filters=[('league_id', 'eq', league_id),
                                         ('team_id', 'eq', team_id),
                                         ('player_id', 'eq', player_id)],
                                limit=1) or []
        rostered_now = len(post_roster) > 0
        print(f'[drill] player rostered post-run: {rostered_now}')

        if final_status == 'successful':
            expected_budget = starting_budget - args.bid_amount
            if abs((new_budget or 0) - expected_budget) > 0.001:
                print(f'DRILL FAIL: budget expected {expected_budget}, got {new_budget}',
                      file=sys.stderr)
                return 2
            if not rostered_now:
                print('DRILL FAIL: claim successful but player not on roster', file=sys.stderr)
                return 2
            print('[drill] PASS: FAAB processor did real work (bid deducted, roster changed)')
        else:
            # failed → budget unchanged, no roster change
            if abs((new_budget or 0) - starting_budget) > 0.001:
                print(f'DRILL FAIL: claim failed but budget changed from {starting_budget} to {new_budget}',
                      file=sys.stderr)
                return 2
            print(f'[drill] PASS (failed path): {post_claim[0].get("failure_reason")}')

        return 0
    finally:
        # 7. Cleanup: delete the claim regardless of outcome
        print('[drill] cleanup: removing synthetic claim')
        db.session.delete(
            f'{db.rest_base}/waiver_claims?id=eq.{claim_id}',
            headers=db._headers(), timeout=db.timeout_seconds,
        )
        # If successful, restore roster + budget
        if 'final_status' in dir() and final_status == 'successful':
            print('[drill] cleanup: reversing roster add + restoring budget')
            db.session.delete(
                f'{db.rest_base}/roster_assignments?league_id=eq.{league_id}&team_id=eq.{team_id}&player_id=eq.{player_id}',
                headers=db._headers(), timeout=db.timeout_seconds,
            )
            db.update(
                'faab_budgets',
                {'remaining_budget': starting_budget},
                filters=[('league_id', 'eq', league_id), ('team_id', 'eq', team_id)],
            )


if __name__ == '__main__':
    sys.exit(main())
