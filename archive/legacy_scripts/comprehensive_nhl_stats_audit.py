#!/usr/bin/env python3
"""
Comprehensive audit to verify all stats match NHL.com exactly.
Checks database values against NHL.com API for multiple players.
"""

import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

# Test players - mix of high-profile players
test_players = [
    (8478402, "Connor McDavid"),
    (8482078, "Lucas Raymond"),
    (8471675, "Sidney Crosby"),
    (8476453, "Mika Zibanejad"),
    (8471214, "Nathan MacKinnon"),
    (8477956, "Auston Matthews"),
    (8480801, "Brady Tkachuk"),  # Known to have hits
    (8480039, "Martin Necas"),
]

print("=" * 80)
print("COMPREHENSIVE NHL.COM STATS AUDIT")
print("=" * 80)
print()
print("Verifying database values match NHL.com exactly...")
print()

all_correct = True
issues = []

for player_id, name in test_players:
    print(f"{'='*80}")
    print(f"Player: {name} (ID: {player_id})")
    print(f"{'='*80}")
    print()
    
    # Get database values
    db_result = db.select(
        "player_season_stats",
        select="nhl_goals,nhl_assists,nhl_points,nhl_ppp,nhl_shp,nhl_hits,nhl_blocks,nhl_shots_on_goal,nhl_pim",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if not db_result or len(db_result) == 0:
        print(f"✗ Not found in database")
        all_correct = False
        issues.append(f"{name}: Not found in database")
        print()
        continue
    
    db_stats = db_result[0]
    
    # Fetch from NHL API
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        landing_data = response.json()
        
        # Extract from featuredStats
        api_stats = {}
        if "featuredStats" in landing_data:
            featured = landing_data["featuredStats"]
            if "regularSeason" in featured:
                rs = featured["regularSeason"]
                if "subSeason" in rs:
                    sub = rs["subSeason"]
                    api_stats = {
                        "goals": _safe_int(sub.get("goals", 0), 0),
                        "assists": _safe_int(sub.get("assists", 0), 0),
                        "points": _safe_int(sub.get("points", 0), 0),
                        "ppp": _safe_int(sub.get("powerPlayPoints", 0), 0),
                        "shp": _safe_int(sub.get("shorthandedPoints", 0), 0),
                        "shots": _safe_int(sub.get("shots", 0), 0),
                        "pim": _safe_int(sub.get("pim", 0), 0),
                    }
        
        # For hits/blocks, we need StatsAPI (but that's unreliable, so we'll note if 0)
        # The landing endpoint doesn't have hits/blocks
        
        # Compare
        print("Comparison:")
        print(f"  Goals:     DB={db_stats.get('nhl_goals', 0)}, API={api_stats.get('goals', 0)} {'✓' if db_stats.get('nhl_goals', 0) == api_stats.get('goals', 0) else '✗'}")
        print(f"  Assists:   DB={db_stats.get('nhl_assists', 0)}, API={api_stats.get('assists', 0)} {'✓' if db_stats.get('nhl_assists', 0) == api_stats.get('assists', 0) else '✗'}")
        print(f"  Points:    DB={db_stats.get('nhl_points', 0)}, API={api_stats.get('points', 0)} {'✓' if db_stats.get('nhl_points', 0) == api_stats.get('points', 0) else '✗'}")
        print(f"  PPP:       DB={db_stats.get('nhl_ppp', 0)}, API={api_stats.get('ppp', 0)} {'✓' if db_stats.get('nhl_ppp', 0) == api_stats.get('ppp', 0) else '✗'}")
        print(f"  SHP:       DB={db_stats.get('nhl_shp', 0)}, API={api_stats.get('shp', 0)} {'✓' if db_stats.get('nhl_shp', 0) == api_stats.get('shp', 0) else '✗'}")
        print(f"  SOG:       DB={db_stats.get('nhl_shots_on_goal', 0)}, API={api_stats.get('shots', 0)} {'✓' if db_stats.get('nhl_shots_on_goal', 0) == api_stats.get('shots', 0) else '✗'}")
        print(f"  PIM:       DB={db_stats.get('nhl_pim', 0)}, API={api_stats.get('pim', 0)} {'✓' if db_stats.get('nhl_pim', 0) == api_stats.get('pim', 0) else '✗'}")
        print(f"  Hits:      DB={db_stats.get('nhl_hits', 0)} (StatsAPI source, may be 0 if API unavailable)")
        print(f"  Blocks:    DB={db_stats.get('nhl_blocks', 0)} (StatsAPI source, may be 0 if API unavailable)")
        print()
        
        # Check for mismatches
        mismatches = []
        if db_stats.get('nhl_goals', 0) != api_stats.get('goals', 0):
            mismatches.append(f"Goals: DB={db_stats.get('nhl_goals', 0)}, API={api_stats.get('goals', 0)}")
        if db_stats.get('nhl_assists', 0) != api_stats.get('assists', 0):
            mismatches.append(f"Assists: DB={db_stats.get('nhl_assists', 0)}, API={api_stats.get('assists', 0)}")
        if db_stats.get('nhl_points', 0) != api_stats.get('points', 0):
            mismatches.append(f"Points: DB={db_stats.get('nhl_points', 0)}, API={api_stats.get('points', 0)}")
        if db_stats.get('nhl_ppp', 0) != api_stats.get('ppp', 0):
            mismatches.append(f"PPP: DB={db_stats.get('nhl_ppp', 0)}, API={api_stats.get('ppp', 0)}")
        if db_stats.get('nhl_shp', 0) != api_stats.get('shp', 0):
            mismatches.append(f"SHP: DB={db_stats.get('nhl_shp', 0)}, API={api_stats.get('shp', 0)}")
        if db_stats.get('nhl_shots_on_goal', 0) != api_stats.get('shots', 0):
            mismatches.append(f"SOG: DB={db_stats.get('nhl_shots_on_goal', 0)}, API={api_stats.get('shots', 0)}")
        if db_stats.get('nhl_pim', 0) != api_stats.get('pim', 0):
            mismatches.append(f"PIM: DB={db_stats.get('nhl_pim', 0)}, API={api_stats.get('pim', 0)}")
        
        if mismatches:
            print(f"✗✗✗ MISMATCHES FOUND:")
            for m in mismatches:
                print(f"    {m}")
            all_correct = False
            issues.append(f"{name}: {', '.join(mismatches)}")
        else:
            print("✓✓✓ All stats match NHL.com!")
        
    except Exception as e:
        print(f"✗ Error fetching from API: {e}")
        all_correct = False
        issues.append(f"{name}: API error - {e}")
    
    print()

print("=" * 80)
print("SUMMARY")
print("=" * 80)
if all_correct:
    print("✓✓✓ ALL PLAYERS MATCH NHL.COM EXACTLY! ✓✓✓")
else:
    print(f"✗✗✗ Found {len(issues)} issues:")
    for issue in issues:
        print(f"  - {issue}")
print("=" * 80)

