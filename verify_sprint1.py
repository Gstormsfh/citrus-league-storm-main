#!/usr/bin/env python3
"""
Verify Sprint 1: League-Wide Baselines Infrastructure

This script verifies that:
1. The migration columns exist
2. The LEAGUE row exists in league_averages
3. The values are reasonable
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

def verify_sprint1(season: int = DEFAULT_SEASON):
    """Verify Sprint 1 implementation."""
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    print("=" * 80)
    print("🔍 VERIFYING SPRINT 1: League-Wide Baselines Infrastructure")
    print("=" * 80)
    print()
    
    # 1. Check if LEAGUE row exists
    print("1️⃣  Checking for LEAGUE row in league_averages...")
    league_row = db.select(
        "league_averages",
        select="position,season,league_avg_sv_pct,league_avg_xga_per_60,league_avg_shots_for_per_60",
        filters=[("position", "eq", "LEAGUE"), ("season", "eq", season)],
        limit=1
    )
    
    if not league_row or len(league_row) == 0:
        print("   ❌ FAIL: LEAGUE row not found!")
        print("   Expected: position='LEAGUE', season={}".format(season))
        return False
    
    row = league_row[0]
    print("   ✅ LEAGUE row found!")
    print(f"      Position: {row.get('position')}")
    print(f"      Season: {row.get('season')}")
    print(f"      SV%: {row.get('league_avg_sv_pct')}")
    print(f"      xGA/60: {row.get('league_avg_xga_per_60')}")
    print(f"      Shots For/60: {row.get('league_avg_shots_for_per_60')}")
    print()
    
    # 2. Verify values are reasonable
    print("2️⃣  Verifying values are reasonable...")
    sv_pct = float(row.get('league_avg_sv_pct', 0))
    xga_per_60 = float(row.get('league_avg_xga_per_60', 0))
    
    checks_passed = 0
    total_checks = 2
    
    # SV% should be between 0.85 and 0.95 (reasonable NHL range)
    if 0.85 <= sv_pct <= 0.95:
        print(f"   ✅ SV% is reasonable: {sv_pct:.3f} (expected: 0.85-0.95)")
        checks_passed += 1
    else:
        print(f"   ⚠️  SV% is outside expected range: {sv_pct:.3f} (expected: 0.85-0.95)")
    
    # xGA/60 should be between 1.5 and 4.0 (reasonable NHL range)
    if 1.5 <= xga_per_60 <= 4.0:
        print(f"   ✅ xGA/60 is reasonable: {xga_per_60:.3f} (expected: 1.5-4.0)")
        checks_passed += 1
    else:
        print(f"   ⚠️  xGA/60 is outside expected range: {xga_per_60:.3f} (expected: 1.5-4.0)")
        if xga_per_60 == 2.5:
            print("      (Note: This is the fallback value - xGA/60 calculation may need game data)")
    
    print()
    
    # 3. Check all position rows exist
    print("3️⃣  Verifying all position rows exist...")
    all_rows = db.select(
        "league_averages",
        select="position,season",
        filters=[("season", "eq", season)],
        order="position"
    )
    
    positions = [row.get('position') for row in all_rows]
    expected_positions = ['C', 'D', 'G', 'LEAGUE', 'LW', 'RW']
    
    print(f"   Found {len(positions)} position rows: {', '.join(sorted(positions))}")
    
    missing = set(expected_positions) - set(positions)
    if missing:
        print(f"   ⚠️  Missing positions: {', '.join(sorted(missing))}")
    else:
        print("   ✅ All expected positions found!")
    
    print()
    
    # Summary
    print("=" * 80)
    print("📊 VERIFICATION SUMMARY")
    print("=" * 80)
    print(f"✅ LEAGUE row exists: Yes")
    print(f"✅ Values stored: SV%={sv_pct:.3f}, xGA/60={xga_per_60:.3f}")
    print(f"✅ Value checks passed: {checks_passed}/{total_checks}")
    print(f"✅ Position rows: {len(positions)} found")
    print()
    
    if checks_passed == total_checks and 'LEAGUE' in positions:
        print("🎉 SPRINT 1 VERIFICATION: PASSED")
        print()
        print("Next steps:")
        print("  - Sprint 2: Update calculate_daily_projections.py to use these baselines")
        print("  - Sprint 3: Implement career-weighted Bayesian shrinkage")
        print("  - Sprint 4: Add finishing talent stabilization buffer")
        return True
    else:
        print("⚠️  SPRINT 1 VERIFICATION: PARTIAL PASS")
        print("   Some checks failed, but infrastructure is in place.")
        return False

if __name__ == "__main__":
    season = DEFAULT_SEASON
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid season argument: {sys.argv[1]}. Using default: {DEFAULT_SEASON}")
    
    success = verify_sprint1(season)
    sys.exit(0 if success else 1)

