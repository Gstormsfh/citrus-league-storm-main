#!/usr/bin/env python3
"""
standings_scheduler_drill.py — proves calculate_ppg_standings and
calculate_roto_standings return non-trivial data against a league that has
completed matchups + populated weekly stats. Staging by default; requires
--i-know-this-is-prod to run against prod.

Anti-best-ball. A pass requires:
  * PPG: at least one team with games_played > 0.
  * Roto: at least one category with total_stat > 0 for some team.
  * If both functions return only zeros, exit 2 — the schedulers would run
    green while doing no scoring work, and we'd never know.
"""

import os
import sys
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'data-pipeline'))
import _bootstrap  # noqa: F401
from data_pipeline.utils.supabase_rest import SupabaseRest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--league-id', help='League to test; default: first league with completed matchups')
    ap.add_argument('--categories', nargs='+',
                    default=['goals', 'assists', 'sog', 'hits', 'blocks', 'ppp', 'wins', 'saves'],
                    help='Roto categories to test')
    ap.add_argument('--i-know-this-is-prod', action='store_true')
    args = ap.parse_args()

    from urllib.parse import urlparse
    host = urlparse(os.environ['VITE_SUPABASE_URL']).hostname or ''
    is_prod = 'prod' in host or ('citrus' in host and 'staging' not in host)
    if is_prod and not args.i_know_this_is_prod:
        print(f'REFUSING: resolved host {host} looks like prod', file=sys.stderr)
        return 1
    print(f'[drill] Supabase host: {host}')

    db = SupabaseRest(os.environ['VITE_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

    if args.league_id:
        league_id = args.league_id
    else:
        # Find a league with at least one completed matchup — required for
        # PPG to return non-zero.
        matchups = db.select('matchups', select='league_id',
                             filters=[('status', 'eq', 'completed')], limit=1) or []
        if not matchups:
            print('SKIP: no completed matchups in this env; standings would return zeros for all.', file=sys.stderr)
            return 0
        league_id = matchups[0]['league_id']
    print(f'[drill] league: {league_id}')

    # PPG standings
    ppg = db.rpc('calculate_ppg_standings', {'p_league_id': league_id, 'p_through_week': None})
    ppg_rows = ppg if isinstance(ppg, list) else []
    print(f'[drill] PPG rows: {len(ppg_rows)}')
    for r in ppg_rows[:5]:
        print(f'  {r}')
    ppg_did_work = any(int(r.get('games_played', 0) or 0) > 0 for r in ppg_rows)

    # Roto standings
    roto = db.rpc('calculate_roto_standings', {
        'p_league_id': league_id,
        'p_categories': args.categories,
        'p_through_week': None,
    })
    roto_rows = roto if isinstance(roto, list) else []
    print(f'[drill] Roto rows: {len(roto_rows)} (categories={len(args.categories)}, teams=?)')
    for r in roto_rows[:6]:
        print(f'  {r}')
    roto_did_work = any(float(r.get('stat_value', 0) or 0) > 0 for r in roto_rows)

    print()
    print(f'[drill] PPG had_work={ppg_did_work}  Roto had_work={roto_did_work}')
    if not ppg_did_work and not roto_did_work:
        print('DRILL FAIL: both standings returned only zeros — this is the '
              'no-op-green-run failure class.', file=sys.stderr)
        return 2
    print('[drill] PASS: at least one standings function returned real work')
    return 0


if __name__ == '__main__':
    sys.exit(main())
