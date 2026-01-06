#!/usr/bin/env python3
"""
Comprehensive final audit to ensure everything is aligned with NHL.com.
"""

import os
import sys
import requests
import time
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

# Test players - diverse set
test_players = [
    (8478402, "Connor McDavid", 31, 2, 18, 18),
    (8482078, "Lucas Raymond", 18, 0, 20, 17),
    (8471675, "Sidney Crosby", 16, 0, 35, 17),
    (8476453, "Mika Zibanejad", 18, 0, 0, 0),  # May not have hits/blocks
    (8480801, "Brady Tkachuk", 7, 0, 58, 5),
    (8471214, "Nathan MacKinnon", 0, 0, 72, 7),  # Check hits/blocks
]

print("=" * 80)
print("COMPREHENSIVE FINAL AUDIT")
print("=" * 80)
print()

all_correct = True
issues = []

for player_id, name, exp_ppp, exp_shp, exp_hits, exp_blocks in test_players:
    print(f"{'='*80}")
    print(f"Player: {name} (ID: {player_id})")
    print(f"{'='*80}")
    
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
        print(f"FAIL: Not found in database")
        all_correct = False
        issues.append(f"{name}: Not found in database")
        print()
        continue
    
    db_stats = db_result[0]
    
    # Fetch from API
    api_stats = {}
    for attempt in range(2):
        try:
            url = f"{NHL_API_BASE}/player/{player_id}/landing"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            landing_data = response.json()
            
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
                        break
        except requests.exceptions.RequestException as e:
            if "429" in str(e) and attempt < 1:
                time.sleep(3)
                continue
            else:
                print(f"API Error: {e}")
                break
    
    if not api_stats:
        print("Could not fetch API data")
        print()
        continue
    
    # Compare
    mismatches = []
    
    checks = [
        ("Goals", db_stats.get('nhl_goals', 0), api_stats.get('goals', 0)),
        ("Assists", db_stats.get('nhl_assists', 0), api_stats.get('assists', 0)),
        ("Points", db_stats.get('nhl_points', 0), api_stats.get('points', 0)),
        ("PPP", db_stats.get('nhl_ppp', 0), api_stats.get('ppp', 0)),
        ("SHP", db_stats.get('nhl_shp', 0), api_stats.get('shp', 0)),
        ("SOG", db_stats.get('nhl_shots_on_goal', 0), api_stats.get('shots', 0)),
        ("PIM", db_stats.get('nhl_pim', 0), api_stats.get('pim', 0)),
    ]
    
    print("Database vs NHL.com API:")
    for stat_name, db_val, api_val in checks:
        match = db_val == api_val
        status = "OK" if match else "FAIL"
        print(f"  {status} {stat_name:8s}: DB={db_val:3d}, API={api_val:3d}")
        if not match:
            mismatches.append(f"{stat_name}: DB={db_val}, API={api_val}")
    
    # Check hits/blocks (from StatsAPI, may be 0 for some players)
    db_hits = db_stats.get('nhl_hits', 0)
    db_blocks = db_stats.get('nhl_blocks', 0)
    print(f"  Hits:      DB={db_hits:3d} (StatsAPI source)")
    print(f"  Blocks:    DB={db_blocks:3d} (StatsAPI source)")
    
    # Verify expected values if provided
    if exp_ppp is not None and db_stats.get('nhl_ppp', 0) != exp_ppp:
        mismatches.append(f"PPP: Expected {exp_ppp}, got {db_stats.get('nhl_ppp', 0)}")
    if exp_shp is not None and db_stats.get('nhl_shp', 0) != exp_shp:
        mismatches.append(f"SHP: Expected {exp_shp}, got {db_stats.get('nhl_shp', 0)}")
    if exp_hits is not None and exp_hits > 0 and db_hits != exp_hits:
        mismatches.append(f"Hits: Expected {exp_hits}, got {db_hits}")
    if exp_blocks is not None and exp_blocks > 0 and db_blocks != exp_blocks:
        mismatches.append(f"Blocks: Expected {exp_blocks}, got {db_blocks}")
    
    print()
    
    if mismatches:
        print(f"FAIL - MISMATCHES:")
        for m in mismatches:
            print(f"    {m}")
        all_correct = False
        issues.append(f"{name}: {', '.join(mismatches)}")
    else:
        print("OK - All stats match!")
    
    time.sleep(0.5)  # Rate limiting

print()
print("=" * 80)
print("SUMMARY")
print("=" * 80)

# Count coverage
total_players = db.select("player_season_stats", select="player_id", filters=[("season", "eq", DEFAULT_SEASON)], limit=10000)
players_with_ppp = db.select("player_season_stats", select="player_id", filters=[("season", "eq", DEFAULT_SEASON), ("nhl_ppp", "gt", 0)], limit=10000)
players_with_hits = db.select("player_season_stats", select="player_id", filters=[("season", "eq", DEFAULT_SEASON), ("nhl_hits", "gt", 0)], limit=10000)

total = len(total_players) if total_players else 0
ppp_count = len(players_with_ppp) if players_with_ppp else 0
hits_count = len(players_with_hits) if players_with_hits else 0

print(f"Total players: {total:,}")
print(f"Players with PPP > 0: {ppp_count:,}")
print(f"Players with hits > 0: {hits_count:,}")
print()

if all_correct:
    print("*** ALL VERIFIED PLAYERS MATCH NHL.COM! ***")
else:
    print(f"Found {len(issues)} issues:")
    for issue in issues:
        print(f"  - {issue}")

print("=" * 80)

