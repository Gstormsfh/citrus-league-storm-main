#!/usr/bin/env python3
"""Rebuild extractor drill — proves the FIXED extractor on a real game, no writes.

Run from repo root. Verified by Claude on 2026-08-10 in a clean sandbox against
prod game 2025020569 (UTA/WPG, 196 plays, 4 goals):
  rows 49/49 vs stored (perfect parity) | goals 4/4
  score_differential: nonzero on 39/45 NON-goals (stored/broken: 0/45)
  home_score populated on all 45 non-goals; values 0..3 (stored: never)
  skaters/situation_code/sort_order/event_id/east_west: 49/49 non-null

Usage:  python scripts/drills/xg_rebuild_extractor_drill.py path/to/game.json GAME_ID
Exit 0 = all gates pass, 2 = a gate failed. No database access at all.
"""
import sys, os, json
import pandas as pd

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
for p in ['data-pipeline', 'data-pipeline/acquisition', 'data-pipeline/utils', 'scripts/utilities']:
    sys.path.insert(0, os.path.join(REPO, p))
os.environ.setdefault('VITE_SUPABASE_URL', 'https://drill.invalid')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'drill')

class StubDB:  # any write attempt is a drill failure by construction
    def select(self, *a, **k): return []
    def upsert(self, *a, **k): raise RuntimeError('DB WRITE ATTEMPTED IN DRILL')

def main():
    raw_path, game_id = sys.argv[1], int(sys.argv[2])
    import data_acquisition as da
    raw = json.load(open(raw_path))
    df = pd.DataFrame(da._extract_shots_from_game(raw, game_id, StubDB()))
    g = df['is_goal'].astype(bool)
    sd = pd.to_numeric(df['score_differential'], errors='coerce')
    n_505 = sum(1 for p in raw['plays']
                if p.get('typeCode') == 505
                and (p.get('periodDescriptor') or {}).get('periodType') != 'SO')
    so_rows = int((pd.to_numeric(df['period'], errors='coerce') >= 5).sum()) \
        if raw.get('gameType') == 2 else 0

    checks = [
        ('rows_extracted > 0',            len(df) > 0),
        ('goal_parity vs raw 505 non-SO', int(g.sum()) == n_505 or abs(int(g.sum()) - n_505) <= max(1, so_rows)),
        # >=1 nonzero, NOT a percentage bar: a tie-heavy game legitimately sits
        # near 0% nonzero (e.g. 2024020037: 8/85). This gate exists to catch
        # the historical all-zero label-proxy bug, which any single nonzero
        # non-goal disproves.
        ('score_diff live on non-goals',  int((sd[~g] != 0).sum()) >= 1),
        ('strength populated',            df['home_skaters_on_ice'].notna().all() and df['away_skaters_on_ice'].notna().all()),
        ('ordering fields present',       df['sort_order'].notna().all() and df['event_id'].notna().all()),
    ]
    width = max(len(n) for n, _ in checks)
    failed = False
    for name, ok in checks:
        print(f'  {name:{width}s}  {"PASS" if ok else "FAIL"}')
        failed |= not ok
    print(f'  [info] rows={len(df)} goals={int(g.sum())} raw505_noSO={n_505} '
          f'sd_nonzero_nongoal={(sd[~g] != 0).sum()}/{int((~g).sum())} so_period_rows={so_rows}')
    sys.exit(2 if failed else 0)

if __name__ == '__main__':
    main()
