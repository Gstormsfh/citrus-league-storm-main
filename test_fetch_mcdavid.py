#!/usr/bin/env python3
"""Test fetching McDavid's TOI and plus/minus from landing endpoint."""

import sys
sys.path.insert(0, '.')

from fetch_nhl_stats_from_landing import fetch_player_landing_data, extract_toi_and_plus_minus

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print("TESTING MCDAVID STATS FETCH")
print("=" * 80)
print()

landing_data = fetch_player_landing_data(MCDAVID_ID)

if landing_data:
    print("[OK] Successfully fetched landing data")
    print()
    
    toi_seconds, plus_minus = extract_toi_and_plus_minus(landing_data, DEFAULT_SEASON)
    
    print(f"TOI: {toi_seconds} seconds ({toi_seconds / 60:.1f} minutes)")
    print(f"TOI per game: {toi_seconds / 35 / 60:.2f} minutes (expected: 22:41 = 22.68 min)")
    print(f"Plus/minus: {plus_minus}")
    print()
    
    if toi_seconds > 0:
        print("[OK] TOI extraction successful!")
    else:
        print("[WARNING] TOI extraction failed")
    
    if plus_minus != 0:
        print("[OK] Plus/minus extraction successful!")
    else:
        print("[WARNING] Plus/minus extraction failed")
else:
    print("[ERROR] Failed to fetch landing data")
