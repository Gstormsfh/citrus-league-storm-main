#!/usr/bin/env python3
"""
validate_nhl_stats_population.py

Validate that NHL.com official stats are correctly populated and being used.
Checks:
- Coverage: % of players with NHL stats
- Data quality: Compare NHL stats vs PBP stats (should be similar but may differ)
- Missing fields: Identify any stats not available from NHL API
- Frontend readiness: Verify PlayerService will use NHL stats
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import Counter

# Fix Windows encoding issues
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

SEASON = 2025


def validate_nhl_stats_population():
    """Validate NHL stats population and data quality."""
    print("=" * 80)
    print("VALIDATING NHL STATS POPULATION")
    print("=" * 80)
    print()
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Step 1: Check coverage
    print("Step 1: Checking coverage...")
    print()
    
    # Get all players
    all_players = db.select(
        "player_season_stats",
        select="player_id, is_goalie, nhl_goals, nhl_assists, nhl_points, nhl_wins, nhl_saves",
        filters=[("season", "eq", SEASON)],
        limit=10000
    )
    
    if not all_players:
        print("❌ No players found in player_season_stats")
        return
    
    total_players = len(all_players)
    skaters = [p for p in all_players if not p.get("is_goalie", False)]
    goalies = [p for p in all_players if p.get("is_goalie", False)]
    
    print(f"Total players: {total_players}")
    print(f"  Skaters: {len(skaters)}")
    print(f"  Goalies: {len(goalies)}")
    print()
    
    # Check skater coverage
    skaters_with_nhl_goals = [s for s in skaters if s.get("nhl_goals", 0) > 0]
    skaters_with_nhl_assists = [s for s in skaters if s.get("nhl_assists", 0) > 0]
    skaters_with_nhl_points = [s for s in skaters if s.get("nhl_points", 0) > 0]
    
    print("Skater NHL stats coverage:")
    print(f"  Players with nhl_goals > 0: {len(skaters_with_nhl_goals)} ({len(skaters_with_nhl_goals)/len(skaters)*100:.1f}%)")
    print(f"  Players with nhl_assists > 0: {len(skaters_with_nhl_assists)} ({len(skaters_with_nhl_assists)/len(skaters)*100:.1f}%)")
    print(f"  Players with nhl_points > 0: {len(skaters_with_nhl_points)} ({len(skaters_with_nhl_points)/len(skaters)*100:.1f}%)")
    print()
    
    # Check goalie coverage
    goalies_with_nhl_wins = [g for g in goalies if g.get("nhl_wins", 0) > 0]
    goalies_with_nhl_saves = [g for g in goalies if g.get("nhl_saves", 0) > 0]
    
    print("Goalie NHL stats coverage:")
    print(f"  Goalies with nhl_wins > 0: {len(goalies_with_nhl_wins)} ({len(goalies_with_nhl_wins)/len(goalies)*100:.1f}%)")
    print(f"  Goalies with nhl_saves > 0: {len(goalies_with_nhl_saves)} ({len(goalies_with_nhl_saves)/len(goalies)*100:.1f}%)")
    print()
    
    # Step 2: Data quality comparison
    print("Step 2: Comparing NHL stats vs PBP stats (sample)...")
    print()
    
    # Get sample players with both NHL and PBP stats
    sample_skaters = db.select(
        "player_season_stats",
        select="player_id, goals, nhl_goals, primary_assists, secondary_assists, nhl_assists, points, nhl_points, shots_on_goal, nhl_shots_on_goal",
        filters=[
            ("season", "eq", SEASON),
            ("is_goalie", "eq", False),
            ("nhl_goals", "gt", 0)
        ],
        limit=10
    )
    
    if sample_skaters:
        print("Sample skater comparison (NHL vs PBP):")
        print("-" * 120)
        print(f"{'Player ID':<12} {'NHL G':<8} {'PBP G':<8} {'Diff':<8} {'NHL A':<8} {'PBP A':<8} {'Diff':<8} {'NHL Pts':<10} {'PBP Pts':<10} {'Diff':<8}")
        print("-" * 120)
        
        for p in sample_skaters[:10]:
            nhl_goals = int(p.get("nhl_goals", 0))
            pbp_goals = int(p.get("goals", 0))
            nhl_points = int(p.get("nhl_points", 0))
            pbp_points = int(p.get("points", 0))
            # Calculate PBP assists (primary + secondary)
            pbp_assists = int(p.get("primary_assists", 0)) + int(p.get("secondary_assists", 0))
            nhl_assists = int(p.get("nhl_assists", 0))
            
            goals_diff = nhl_goals - pbp_goals
            points_diff = nhl_points - pbp_points
            assists_diff = nhl_assists - pbp_assists
            
            print(f"{p['player_id']:<12} {nhl_goals:<8} {pbp_goals:<8} {goals_diff:<8} {nhl_assists:<8} {pbp_assists:<8} {assists_diff:<8} {nhl_points:<10} {pbp_points:<10} {points_diff:<8}")
        
        print("-" * 100)
        print()
        print("Note: Differences are expected - NHL.com is official, PBP is our calculation")
        print()
    
    # Step 3: Check for missing stats
    print("Step 3: Checking for missing stats...")
    print()
    
    # Check hits/blocks (may be 0 if StatsAPI fallback not implemented)
    skaters_with_hits = [s for s in skaters if s.get("nhl_hits", 0) > 0]
    skaters_with_blocks = [s for s in skaters if s.get("nhl_blocks", 0) > 0]
    
    print(f"Skaters with nhl_hits > 0: {len(skaters_with_hits)} ({len(skaters_with_hits)/len(skaters)*100:.1f}%)")
    print(f"Skaters with nhl_blocks > 0: {len(skaters_with_blocks)} ({len(skaters_with_blocks)/len(skaters)*100:.1f}%)")
    
    if len(skaters_with_hits) == 0 or len(skaters_with_blocks) == 0:
        print("⚠️  Hits/blocks are 0 - StatsAPI fallback may be needed")
    print()
    
    # Step 4: Frontend readiness
    print("Step 4: Frontend readiness check...")
    print()
    
    # Check that PlayerService will use NHL stats (they should be > 0 or fallback to PBP)
    ready_skaters = 0
    ready_goalies = 0
    
    for p in skaters:
        # PlayerService uses: nhl_goals ?? goals
        # So if nhl_goals exists (even if 0), it will be used
        # We consider "ready" if nhl_goals is set (>= 0, not NULL)
        if p.get("nhl_goals") is not None:
            ready_skaters += 1
    
    for p in goalies:
        if p.get("nhl_wins") is not None:
            ready_goalies += 1
    
    print(f"Skaters ready for frontend: {ready_skaters}/{len(skaters)} ({ready_skaters/len(skaters)*100:.1f}%)")
    print(f"Goalies ready for frontend: {ready_goalies}/{len(goalies)} ({ready_goalies/len(goalies)*100:.1f}%)")
    print()
    
    # Step 5: Summary
    print("=" * 80)
    print("VALIDATION SUMMARY")
    print("=" * 80)
    print()
    
    coverage_issues = []
    if len(skaters_with_nhl_goals) < len(skaters) * 0.9:
        coverage_issues.append(f"Only {len(skaters_with_nhl_goals)/len(skaters)*100:.1f}% of skaters have NHL goals")
    if len(goalies_with_nhl_wins) < len(goalies) * 0.9:
        coverage_issues.append(f"Only {len(goalies_with_nhl_wins)/len(goalies)*100:.1f}% of goalies have NHL wins")
    
    if coverage_issues:
        print("⚠️  Coverage Issues:")
        for issue in coverage_issues:
            print(f"  - {issue}")
        print()
        print("Recommendation: Run fetch_nhl_stats_from_landing.py to populate missing stats")
    else:
        print("✅ Coverage looks good")
    
    print()
    print("Next steps:")
    print("1. If coverage is low, run: python fetch_nhl_stats_from_landing.py")
    print("2. For hits/blocks, implement StatsAPI fallback (if needed)")
    print("3. Verify frontend displays NHL stats correctly")
    print()
    
    return {
        "total_players": total_players,
        "skaters_with_nhl_stats": len(skaters_with_nhl_goals),
        "goalies_with_nhl_stats": len(goalies_with_nhl_wins),
        "hits_coverage": len(skaters_with_hits) / len(skaters) if skaters else 0,
        "blocks_coverage": len(skaters_with_blocks) / len(skaters) if skaters else 0
    }


if __name__ == "__main__":
    validate_nhl_stats_population()
