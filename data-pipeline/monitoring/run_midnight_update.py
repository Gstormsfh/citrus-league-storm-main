#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: Midnight update orchestrator: refresh roster_assignments, fantasy_daily_rosters
# Invoked: scheduled (likely cron)
# Reads:   team_lineups, leagues
# Writes:  fantasy_daily_rosters, roster_assignments
# ────────────────────────────────────────────────────────────
"""
Manual Midnight Run - Landing Stats Update
Run this script to manually trigger the nightly landing stats update
that normally runs at midnight MT via data_scraping_service.py
"""

import sys
from fetch_nhl_stats_from_landing import main

if __name__ == "__main__":
    print("=" * 80)
    print("🌙 MANUAL MIDNIGHT RUN - Landing Stats Update (PPP/SHP)")
    print("=" * 80)
    print()
    
    try:
        exit_code = main()
        if exit_code == 0:
            print()
            print("=" * 80)
            print("✅ MIDNIGHT RUN COMPLETE!")
            print("=" * 80)
        else:
            print()
            print("=" * 80)
            print(f"❌ MIDNIGHT RUN FAILED with exit code {exit_code}")
            print("=" * 80)
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print()
        print("\n⚠️  Interrupted by user")
        sys.exit(1)
    except Exception as e:
        print()
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
