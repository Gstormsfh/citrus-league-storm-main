#!/usr/bin/env python3
"""
Comprehensive system verification script.
Verifies that all systems are working correctly:
- NHL.com data fetching (TOI, Plus/Minus)
- PPP/SHP extraction with window-based tracking
- Season stats aggregation
- Data integrity
"""

import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print("COMPREHENSIVE SYSTEM VERIFICATION")
print("=" * 80)
print()

all_checks_passed = True

# ============================================================================
# CHECK 1: NHL.com Data Fetching (TOI and Plus/Minus)
# ============================================================================
print("CHECK 1: NHL.com Data Fetching (TOI and Plus/Minus)")
print("-" * 80)

try:
    # Fetch from NHL.com
    url = f"https://api-web.nhle.com/v1/player/{MCDAVID_ID}/landing"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    nhl_data = response.json()
    
    nhl_toi_seconds = 0
    nhl_plus_minus = 0
    nhl_games = 0
    
    if "featuredStats" in nhl_data:
        featured = nhl_data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                nhl_plus_minus = sub.get("plusMinus", 0)
            
            # Get TOI from seasonTotals
            if "seasonTotals" in rs and isinstance(rs["seasonTotals"], list) and len(rs["seasonTotals"]) > 0:
                latest = rs["seasonTotals"][-1]
                nhl_games = latest.get("gamesPlayed", 0)
                avg_toi = latest.get("avgToi", 0)  # Format: "MM:SS" or seconds
                if isinstance(avg_toi, str) and ":" in avg_toi:
                    parts = avg_toi.split(":")
                    nhl_toi_seconds = int(parts[0]) * 60 + int(parts[1])
                    nhl_toi_seconds *= nhl_games  # Convert to total seconds
                elif isinstance(avg_toi, (int, float)):
                    nhl_toi_seconds = int(avg_toi * nhl_games)
    
    # Get our data
    our_stats = db.select(
        "player_season_stats",
        select="games_played, icetime_seconds, nhl_toi_seconds, plus_minus, nhl_plus_minus",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if our_stats:
        our_row = our_stats[0]
        our_toi = our_row.get("nhl_toi_seconds", 0) or our_row.get("icetime_seconds", 0)
        our_pm = our_row.get("nhl_plus_minus") or our_row.get("plus_minus", 0)
        our_games = our_row.get("games_played", 0)
        
        print(f"  NHL.com: TOI={nhl_toi_seconds//60} min total ({nhl_toi_seconds//60//our_games if our_games > 0 else 0} min/game), +/-={nhl_plus_minus}, Games={nhl_games}")
        print(f"  Our DB:  TOI={our_toi//60} min total ({our_toi//60//our_games if our_games > 0 else 0} min/game), +/-={our_pm}, Games={our_games}")
        
        # Allow small differences (within 5%)
        toi_diff = abs(nhl_toi_seconds - our_toi)
        toi_pct = (toi_diff / nhl_toi_seconds * 100) if nhl_toi_seconds > 0 else 0
        
        if toi_pct < 5 and abs(nhl_plus_minus - our_pm) <= 1:
            print(f"  [OK] TOI and Plus/Minus match NHL.com (TOI diff: {toi_pct:.1f}%)")
        else:
            print(f"  [WARNING] TOI or Plus/Minus mismatch (TOI diff: {toi_pct:.1f}%)")
            all_checks_passed = False
    else:
        print("  [ERROR] No stats found in database")
        all_checks_passed = False
        
except Exception as e:
    print(f"  [ERROR] Failed to verify NHL.com data: {e}")
    all_checks_passed = False

print()

# ============================================================================
# CHECK 2: PPP/SHP Extraction
# ============================================================================
print("CHECK 2: PPP/SHP Extraction (Window-Based Tracking)")
print("-" * 80)

try:
    # Get NHL.com PPP/SHP
    nhl_ppp = 0
    nhl_shp = 0
    
    if "featuredStats" in nhl_data:
        featured = nhl_data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                nhl_ppp = sub.get("powerPlayPoints", 0)
                nhl_shp = sub.get("shorthandedPoints", 0)
    
    # Get our PPP/SHP
    our_stats = db.select(
        "player_season_stats",
        select="ppp, shp",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if our_stats:
        our_ppp = our_stats[0].get("ppp", 0)
        our_shp = our_stats[0].get("shp", 0)
        
        print(f"  NHL.com: PPP={nhl_ppp}, SHP={nhl_shp}")
        print(f"  Our DB:  PPP={our_ppp}, SHP={our_shp}")
        
        if our_ppp == nhl_ppp and our_shp == nhl_shp:
            print(f"  [OK] PPP and SHP match NHL.com exactly")
        else:
            print(f"  [ERROR] PPP/SHP mismatch!")
            print(f"    PPP diff: {nhl_ppp - our_ppp}")
            print(f"    SHP diff: {nhl_shp - our_shp}")
            all_checks_passed = False
    else:
        print("  [ERROR] No stats found")
        all_checks_passed = False
        
except Exception as e:
    print(f"  [ERROR] Failed to verify PPP/SHP: {e}")
    all_checks_passed = False

print()

# ============================================================================
# CHECK 3: Game Stats Aggregation
# ============================================================================
print("CHECK 3: Game Stats Aggregation")
print("-" * 80)

try:
    # Get all game stats
    game_stats = db.select(
        "player_game_stats",
        select="ppp, shp, goals, primary_assists, secondary_assists, points",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        order="game_id.asc"
    )
    
    # Sum manually
    sum_ppp = sum(g.get("ppp", 0) or 0 for g in game_stats)
    sum_shp = sum(g.get("shp", 0) or 0 for g in game_stats)
    sum_goals = sum(g.get("goals", 0) or 0 for g in game_stats)
    sum_assists = sum((g.get("primary_assists", 0) or 0) + (g.get("secondary_assists", 0) or 0) for g in game_stats)
    sum_points = sum(g.get("points", 0) or 0 for g in game_stats)
    
    # Get season stats
    season_stats = db.select(
        "player_season_stats",
        select="ppp, shp, goals, points",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if season_stats:
        season_row = season_stats[0]
        season_ppp = season_row.get("ppp", 0)
        season_shp = season_row.get("shp", 0)
        season_goals = season_row.get("goals", 0)
        season_points = season_row.get("points", 0)
        
        print(f"  Game stats sum: PPP={sum_ppp}, SHP={sum_shp}, Goals={sum_goals}, Points={sum_points}")
        print(f"  Season stats:   PPP={season_ppp}, SHP={season_shp}, Goals={season_goals}, Points={season_points}")
        
        if (sum_ppp == season_ppp and sum_shp == season_shp and 
            sum_goals == season_goals and sum_points == season_points):
            print(f"  [OK] Game stats aggregation is correct")
        else:
            print(f"  [ERROR] Aggregation mismatch!")
            if sum_ppp != season_ppp:
                print(f"    PPP: game sum={sum_ppp}, season={season_ppp}")
            if sum_shp != season_shp:
                print(f"    SHP: game sum={sum_shp}, season={season_shp}")
            if sum_goals != season_goals:
                print(f"    Goals: game sum={sum_goals}, season={season_goals}")
            if sum_points != season_points:
                print(f"    Points: game sum={sum_points}, season={season_points}")
            all_checks_passed = False
    else:
        print("  [ERROR] No season stats found")
        all_checks_passed = False
        
except Exception as e:
    print(f"  [ERROR] Failed to verify aggregation: {e}")
    import traceback
    traceback.print_exc()
    all_checks_passed = False

print()

# ============================================================================
# CHECK 4: Specific Game Verification (2025020534)
# ============================================================================
print("CHECK 4: Specific Game Verification (2025020534)")
print("-" * 80)

try:
    game_stats = db.select(
        "player_game_stats",
        select="ppp, shp, goals, primary_assists, secondary_assists, points",
        filters=[("game_id", "eq", 2025020534), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if game_stats:
        g = game_stats[0]
        ppp = g.get("ppp", 0) or 0
        shp = g.get("shp", 0) or 0
        goals = g.get("goals", 0) or 0
        assists = (g.get("primary_assists", 0) or 0) + (g.get("secondary_assists", 0) or 0)
        points = g.get("points", 0) or 0
        
        print(f"  Game 2025020534: Goals={goals}, Assists={assists}, Points={points}, PPP={ppp}, SHP={shp}")
        
        # This game should have PPP=1, SHP=1 based on our fix
        if ppp == 1 and shp == 1:
            print(f"  [OK] Game has correct PPP/SHP values")
        else:
            print(f"  [WARNING] Game has incorrect PPP/SHP (expected PPP=1, SHP=1)")
            all_checks_passed = False
    else:
        print("  [ERROR] Game not found")
        all_checks_passed = False
        
except Exception as e:
    print(f"  [ERROR] Failed to verify game: {e}")
    all_checks_passed = False

print()

# ============================================================================
# CHECK 5: Database Schema Verification
# ============================================================================
print("CHECK 5: Database Schema Verification")
print("-" * 80)

try:
    # Check if required columns exist by trying to select them
    test_query = db.select(
        "player_season_stats",
        select="nhl_toi_seconds, nhl_plus_minus",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if test_query:
        print(f"  [OK] Required columns (nhl_toi_seconds, nhl_plus_minus) exist")
    else:
        print(f"  [WARNING] Could not verify columns (but query succeeded)")
        
except Exception as e:
    error_str = str(e)
    if "column" in error_str.lower() and "does not exist" in error_str.lower():
        print(f"  [ERROR] Required columns missing: {e}")
        all_checks_passed = False
    else:
        print(f"  [WARNING] Could not verify schema: {e}")

print()

# ============================================================================
# FINAL SUMMARY
# ============================================================================
print("=" * 80)
print("VERIFICATION SUMMARY")
print("=" * 80)

if all_checks_passed:
    print("[OK] All checks passed! System is working correctly.")
    print()
    print("Verified:")
    print("  [OK] NHL.com data fetching (TOI, Plus/Minus)")
    print("  [OK] PPP/SHP extraction with window-based tracking")
    print("  [OK] Season stats aggregation")
    print("  [OK] Game-level data integrity")
    print("  [OK] Database schema")
    return_code = 0
else:
    print("[ERROR] Some checks failed. Please review the output above.")
    return_code = 1

print()
print("=" * 80)

sys.exit(return_code)
