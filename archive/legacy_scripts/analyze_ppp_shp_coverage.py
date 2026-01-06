#!/usr/bin/env python3
"""
Analyze PPP/SHP coverage to see if script completed or if players legitimately have 0.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("Analyzing PPP/SHP Coverage")
print("=" * 80)
print()

# Get all players with their positions
all_stats = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp,nhl_goals,nhl_points",
    filters=[("season", "eq", DEFAULT_SEASON)],
    limit=1000
)

# Get player directory to check positions
player_dir = db.select(
    "player_directory",
    select="player_id,is_goalie",
    filters=[("season", "eq", DEFAULT_SEASON)],
    limit=1000
)

goalie_map = {p["player_id"]: p.get("is_goalie", False) for p in player_dir}

if all_stats:
    total = len(all_stats)
    skaters = []
    goalies = []
    
    for stat in all_stats:
        player_id = stat.get("player_id")
        is_goalie = goalie_map.get(player_id, False)
        
        if is_goalie:
            goalies.append(stat)
        else:
            skaters.append(stat)
    
    print(f"Total players: {total}")
    print(f"  Skaters: {len(skaters)}")
    print(f"  Goalies: {len(goalies)}")
    print()
    
    # Analyze skaters
    skaters_with_ppp = sum(1 for s in skaters if s.get("nhl_ppp", 0) > 0)
    skaters_with_shp = sum(1 for s in skaters if s.get("nhl_shp", 0) > 0)
    skaters_with_ppp_or_shp = sum(1 for s in skaters if s.get("nhl_ppp", 0) > 0 or s.get("nhl_shp", 0) > 0)
    skaters_with_points = sum(1 for s in skaters if s.get("nhl_points", 0) > 0)
    skaters_with_goals = sum(1 for s in skaters if s.get("nhl_goals", 0) > 0)
    
    print("Skaters Analysis:")
    print(f"  Skaters with points > 0: {skaters_with_points}")
    print(f"  Skaters with goals > 0: {skaters_with_goals}")
    print(f"  Skaters with PPP > 0: {skaters_with_ppp}")
    print(f"  Skaters with SHP > 0: {skaters_with_shp}")
    print(f"  Skaters with PPP or SHP > 0: {skaters_with_ppp_or_shp}")
    print()
    
    # Check skaters with points but no PPP/SHP (might be missing data)
    skaters_missing_ppp = [s for s in skaters if s.get("nhl_points", 0) > 0 and s.get("nhl_ppp") is None]
    skaters_zero_ppp_with_points = [s for s in skaters if s.get("nhl_points", 0) > 5 and s.get("nhl_ppp", 0) == 0]
    
    print(f"Skaters with points but NULL PPP: {len(skaters_missing_ppp)}")
    print(f"Skaters with 5+ points but 0 PPP: {len(skaters_zero_ppp_with_points)}")
    
    if len(skaters_zero_ppp_with_points) > 0:
        print()
        print("Sample skaters with points but 0 PPP (might need update):")
        for s in skaters_zero_ppp_with_points[:5]:
            print(f"  Player {s.get('player_id')}: {s.get('nhl_points', 0)} points, {s.get('nhl_ppp', 0)} PPP")
    
    print()
    if skaters_with_ppp_or_shp > 300 and len(skaters_zero_ppp_with_points) < 50:
        print("✓✓✓ Coverage looks good! Most skaters have been updated. ✓✓✓")
        print(f"   {skaters_with_ppp_or_shp}/{len(skaters)} skaters have PPP/SHP data")
    elif len(skaters_zero_ppp_with_points) > 100:
        print("⚠ Many skaters with points have 0 PPP - script may need to continue")
    else:
        print("✓ Script appears to have completed")
        print(f"   {skaters_with_ppp_or_shp} skaters have PPP/SHP > 0")
        print(f"   {len(skaters) - skaters_with_ppp_or_shp} skaters have 0 (which is valid for many players)")

print()
print("=" * 80)

