#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Gap-fill helper: re-fetch shots for games missing from raw_shots
# Last active: 2026-02-18
# Invoked:     manual run when monitor_data_scraping flags gaps
# Reads:       raw_nhl_data, NHL API
# Writes:      raw_shots
# ────────────────────────────────────────────────────────────
"""
backfill_missing_shots.py

Fixes two categories of missing PBP data:
1. Games marked processed=True but with NO shots in raw_shots (silent failures)
2. Games marked processed=False (never processed)

This script resets the processed flag so run_daily_pbp_processing.py will
pick them up and reprocess them.

Requires SUPABASE_SERVICE_ROLE_KEY in .env (not the anon key).

Usage:
    python scripts/utilities/backfill_missing_shots.py
    python scripts/utilities/backfill_missing_shots.py --dry-run
"""

import os
import sys
import argparse
from dotenv import load_dotenv

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def find_missing_shots(db):
    """Find games that are processed but have no shots in raw_shots."""
    # Get all processed game_ids
    processed_ids = set()
    offset = 0
    while True:
        batch = db.select('raw_nhl_data', select='game_id',
                          filters=[('processed', 'eq', True)],
                          limit=1000, offset=offset)
        if not batch:
            break
        processed_ids.update(g['game_id'] for g in batch)
        if len(batch) < 1000:
            break
        offset += 1000

    # Get all game_ids with shots
    shot_game_ids = set()
    offset = 0
    while True:
        batch = db.select('raw_shots', select='game_id', limit=1000, offset=offset)
        if not batch:
            break
        shot_game_ids.update(g['game_id'] for g in batch)
        if len(batch) < 1000:
            break
        offset += 1000

    # Find gaps
    missing = processed_ids - shot_game_ids
    return sorted(missing)


def find_unprocessed_games(db):
    """Find games that were never processed."""
    games = db.select('raw_nhl_data', select='game_id,game_date',
                      filters=[('processed', 'eq', False)],
                      limit=1000)
    return [(g['game_id'], g.get('game_date', 'unknown')) for g in (games or [])]


def reset_processed_flag(db, game_ids, dry_run=False):
    """Reset processed=False for given game_ids so they get reprocessed."""
    for gid in game_ids:
        if dry_run:
            print(f"  [DRY RUN] Would reset processed=False for game {gid}")
        else:
            try:
                db.update('raw_nhl_data',
                          {'processed': False},
                          filters=[('game_id', 'eq', gid)])
                print(f"  Reset processed=False for game {gid}")
            except Exception as e:
                print(f"  ERROR resetting game {gid}: {e}")


def main():
    parser = argparse.ArgumentParser(description='Backfill missing shots from raw_nhl_data')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be done without making changes')
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
        print("This script requires the service role key (not the anon key).")
        sys.exit(1)

    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

    print("=" * 70)
    print("BACKFILL MISSING SHOTS")
    print("=" * 70)

    # 1. Find processed games with no shots
    print("\n--- Games marked processed but missing shots ---")
    missing = find_missing_shots(db)
    if missing:
        print(f"Found {len(missing)} games with missing shots:")
        for gid in missing:
            info = db.select('raw_nhl_data', select='game_id,game_date',
                             filters=[('game_id', 'eq', gid)], limit=1)
            date = info[0]['game_date'] if info else 'unknown'
            print(f"  Game {gid} ({date})")

        print(f"\nResetting processed flag for {len(missing)} games...")
        reset_processed_flag(db, missing, dry_run=args.dry_run)
    else:
        print("No missing shots found.")

    # 2. Find unprocessed games
    print("\n--- Games never processed ---")
    unprocessed = find_unprocessed_games(db)
    if unprocessed:
        print(f"Found {len(unprocessed)} unprocessed games:")
        for gid, date in unprocessed:
            print(f"  Game {gid} ({date})")
    else:
        print("All games have been processed.")

    # Summary
    total = len(missing) + len(unprocessed)
    print(f"\n{'=' * 70}")
    print(f"TOTAL GAMES NEEDING REPROCESSING: {total}")
    if total > 0 and not args.dry_run:
        print(f"\nNext step: Run run_daily_pbp_processing.py to process these games")
        print(f"  python run_daily_pbp_processing.py")
    elif total > 0 and args.dry_run:
        print(f"\nRe-run without --dry-run to apply fixes")
    print("=" * 70)


if __name__ == '__main__':
    main()
