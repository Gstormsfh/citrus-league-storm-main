#!/usr/bin/env python3
"""
Diagnostic to find why only 126 games are being audited when 300+ should exist.
Checks date ranges, game_id formats, and identifies missing projections.
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date, datetime
from collections import defaultdict

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def diagnose_missing_projections(db: SupabaseRest, season: int):
    """
    Diagnose why projections are missing for games that have stats.
    """
    print("\n" + "="*80)
    print("MISSING PROJECTIONS DIAGNOSTIC")
    print("="*80 + "\n")
    
    # 1. Check date ranges in both tables
    print("1. DATE RANGE ANALYSIS")
    print("-" * 80)
    
    # Get projection date range
    projections = db.select(
        "player_projected_stats",
        select="projection_date,game_id",
        filters=[("season", "eq", season)],
        limit=10000
    )
    
    if projections:
        proj_dates = sorted(set(p.get("projection_date") for p in projections))
        print(f"Projections Date Range: {proj_dates[0]} to {proj_dates[-1]}")
        print(f"Total Unique Projection Dates: {len(proj_dates)}")
        print(f"Total Projections: {len(projections)}")
    else:
        print("⚠️  No projections found!")
        proj_dates = []
    
    # Get game_stats date range
    game_stats = db.select(
        "player_game_stats",
        select="game_date,game_id",
        filters=[("season", "eq", season)],
        limit=10000
    )
    
    if game_stats:
        stats_dates = sorted(set(s.get("game_date") for s in game_stats))
        print(f"\nGame Stats Date Range: {stats_dates[0]} to {stats_dates[-1]}")
        print(f"Total Unique Game Stats Dates: {len(stats_dates)}")
        print(f"Total Game Stat Records: {len(game_stats)}")
    else:
        print("⚠️  No game stats found!")
        stats_dates = []
    
    # Find overlap
    if proj_dates and stats_dates:
        overlap = set(proj_dates) & set(stats_dates)
        missing_dates = set(stats_dates) - set(proj_dates)
        print(f"\nDate Overlap: {len(overlap)} dates")
        print(f"Missing Projection Dates: {len(missing_dates)} dates")
        if missing_dates:
            print(f"  Sample missing dates: {sorted(list(missing_dates))[:10]}")
    print()
    
    # 2. Check game_id formats
    print("2. GAME ID FORMAT ANALYSIS")
    print("-" * 80)
    
    proj_game_ids = set(int(p.get("game_id", 0)) for p in projections if p.get("game_id"))
    stats_game_ids = set(int(s.get("game_id", 0)) for s in game_stats if s.get("game_id"))
    
    print(f"Projection Game IDs: {len(proj_game_ids)} unique")
    if proj_game_ids:
        sample_proj_ids = sorted(list(proj_game_ids))[:5]
        print(f"  Sample: {sample_proj_ids}")
        print(f"  Format check: {['NHL API ID (2025020xxx)' if str(gid).startswith('2025020') else 'Database ID' for gid in sample_proj_ids]}")
    
    print(f"\nGame Stats Game IDs: {len(stats_game_ids)} unique")
    if stats_game_ids:
        sample_stats_ids = sorted(list(stats_game_ids))[:5]
        print(f"  Sample: {sample_stats_ids}")
        print(f"  Format check: {['NHL API ID (2025020xxx)' if str(gid).startswith('2025020') else 'Database ID' for gid in sample_stats_ids]}")
    
    # Check for mismatch
    overlap_ids = proj_game_ids & stats_game_ids
    missing_in_proj = stats_game_ids - proj_game_ids
    missing_in_stats = proj_game_ids - stats_game_ids
    
    print(f"\nGame ID Overlap: {len(overlap_ids)} games")
    print(f"Games with Stats but No Projections: {len(missing_in_proj)}")
    print(f"Games with Projections but No Stats: {len(missing_in_stats)}")
    
    if len(missing_in_proj) > 0:
        print(f"\n⚠️  WARNING: {len(missing_in_proj)} games have stats but no projections!")
        print(f"  Sample missing game IDs: {sorted(list(missing_in_proj))[:10]}")
    
    if len(missing_in_stats) > 0:
        print(f"\n⚠️  WARNING: {len(missing_in_stats)} games have projections but no stats (future games?)")
        print(f"  Sample: {sorted(list(missing_in_stats))[:10]}")
    print()
    
    # 3. Check games per date
    print("3. GAMES PER DATE ANALYSIS")
    print("-" * 80)
    
    # Count games per date in stats
    games_per_date_stats = defaultdict(set)
    for stat in game_stats:
        game_date = stat.get("game_date")
        game_id = stat.get("game_id")
        if game_date and game_id:
            games_per_date_stats[game_date].add(game_id)
    
    # Count games per date in projections
    games_per_date_proj = defaultdict(set)
    for proj in projections:
        proj_date = proj.get("projection_date")
        game_id = proj.get("game_id")
        if proj_date and game_id:
            games_per_date_proj[proj_date].add(game_id)
    
    print("Date | Stats Games | Projection Games | Missing")
    print("-" * 60)
    all_dates = sorted(set(list(games_per_date_stats.keys()) + list(games_per_date_proj.keys())))
    for d in all_dates[:20]:  # Show first 20 dates
        stats_count = len(games_per_date_stats.get(d, set()))
        proj_count = len(games_per_date_proj.get(d, set()))
        missing = stats_count - proj_count
        status = "✓" if missing == 0 else f"⚠️  -{missing}"
        print(f"{d} | {stats_count:3d} | {proj_count:3d} | {status}")
    
    if len(all_dates) > 20:
        print(f"... ({len(all_dates) - 20} more dates)")
    print()
    
    # 4. Summary and recommendations
    print("4. SUMMARY & RECOMMENDATIONS")
    print("-" * 80)
    
    total_games_with_stats = len(stats_game_ids)
    total_games_with_projections = len(proj_game_ids)
    matched_games = len(overlap_ids)
    
    print(f"Total Games with Stats: {total_games_with_stats}")
    print(f"Total Games with Projections: {total_games_with_projections}")
    print(f"Matched Games: {matched_games}")
    print(f"Coverage: {100*matched_games/total_games_with_stats:.1f}% of games with stats have projections")
    print()
    
    if matched_games < 300:
        print("⚠️  DIAGNOSIS: Not enough projections for full audit")
        print()
        print("ROOT CAUSE:")
        if len(missing_in_proj) > len(overlap_ids):
            print(f"  → {len(missing_in_proj)} games have stats but no projections")
            print("  → The backtest hasn't been run for the full season yet")
        elif proj_dates and stats_dates and len(proj_dates) < len(stats_dates):
            print(f"  → Projections only cover {len(proj_dates)} dates vs {len(stats_dates)} dates with stats")
            print("  → Date range mismatch - backtest needs to run for more dates")
        else:
            print("  → Unknown issue - check game_id format consistency")
        print()
        print("SOLUTION:")
        print("  1. Run backtest for full date range:")
        if stats_dates:
            print(f"     python backtest_vopa_model_fast.py {stats_dates[0]} {stats_dates[-1]} {season}")
        else:
            print(f"     python backtest_vopa_model_fast.py 2025-10-01 2026-01-01 {season}")
        print("  2. Verify game_id format is consistent (NHL API ID)")
        print("  3. Re-run audit after backtest completes")
    else:
        print("✓ Sufficient projections found for audit")
    print()
    
    return {
        "total_games_with_stats": total_games_with_stats,
        "total_games_with_projections": total_games_with_projections,
        "matched_games": matched_games,
        "missing_projections": len(missing_in_proj),
        "proj_date_range": (proj_dates[0], proj_dates[-1]) if proj_dates else None,
        "stats_date_range": (stats_dates[0], stats_dates[-1]) if stats_dates else None
    }

def main():
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    result = diagnose_missing_projections(db, season)
    
    print("="*80)
    print("DIAGNOSTIC COMPLETE")
    print("="*80 + "\n")

if __name__ == "__main__":
    main()



