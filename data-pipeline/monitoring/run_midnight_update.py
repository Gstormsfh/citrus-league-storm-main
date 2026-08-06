#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Manual trigger for the landing-stats refresh (PPP/SHP columns)
# Last active: 2026-03-02
# Invoked:     manual (developer runs it; NOT scheduled)
# Reads:       nhl_landing (NHL API), nhl_player_game_stats
# Writes:      nhl_player_game_stats (PPP/SHP columns via fetch_nhl_stats_from_landing)
# Does NOT write: fantasy_daily_rosters, roster_assignments — those live on separate paths
#                 (fantasy_daily_rosters: /api/scheduled/roster-snapshot-today cron +
#                  LineupService user_edit path; roster_assignments: unrelated).
# ────────────────────────────────────────────────────────────
"""
Manual Landing-Stats Refresh
Wraps fetch_nhl_stats_from_landing.main() so a developer can rerun the
PPP/SHP column refresh on demand. Despite the historical filename, this
script does NOT run at midnight and does NOT write fantasy_daily_rosters
or roster_assignments — the earlier docstring lied about both.
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
