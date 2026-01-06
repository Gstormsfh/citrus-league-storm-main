#!/usr/bin/env python3
"""
Test extraction for McDavid to verify the logic works before running full script.
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
MCDAVID_ID = 8478402

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

print("=" * 80)
print("Testing McDavid Extraction")
print("=" * 80)
print()

# Fetch landing data
url = f"{NHL_API_BASE}/player/{MCDAVID_ID}/landing"
print(f"Fetching: {url}")
response = requests.get(url, timeout=10)
response.raise_for_status()
landing_data = response.json()
print("✓ Fetched landing data")
print()

# Extract from featuredStats (PRIMARY)
stats = {}
if "featuredStats" in landing_data:
    featured = landing_data["featuredStats"]
    featured_season = featured.get("season", 0)
    featured_season_start = featured_season // 10000 if featured_season > 0 else 0
    print(f"Featured season: {featured_season} (start: {featured_season_start})")
    
    if featured_season_start == DEFAULT_SEASON or featured_season_start == 0:
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                print("✓ Found subSeason in featuredStats")
                print()
                print("Extracted stats:")
                stats["nhl_goals"] = _safe_int(sub.get("goals", 0), 0)
                stats["nhl_assists"] = _safe_int(sub.get("assists", 0), 0)
                stats["nhl_points"] = _safe_int(sub.get("points", 0), 0)
                stats["nhl_ppp"] = _safe_int(sub.get("powerPlayPoints", 0), 0)
                stats["nhl_shp"] = _safe_int(sub.get("shorthandedPoints", 0), 0)
                
                print(f"  Goals: {stats['nhl_goals']}")
                print(f"  Assists: {stats['nhl_assists']}")
                print(f"  Points: {stats['nhl_points']}")
                print(f"  PPP: {stats['nhl_ppp']} (expected: 31)")
                print(f"  SHP: {stats['nhl_shp']} (expected: 2)")
                print()
                
                if stats["nhl_ppp"] == 31 and stats["nhl_shp"] == 2:
                    print("✓✓✓ EXTRACTION WORKING CORRECTLY! ✓✓✓")
                else:
                    print("✗✗✗ EXTRACTION FAILED - VALUES DON'T MATCH ✗✗✗")
                    print(f"   Expected: PPP=31, SHP=2")
                    print(f"   Got:      PPP={stats['nhl_ppp']}, SHP={stats['nhl_shp']}")

# Now update database
print()
print("=" * 80)
print("Updating database...")
print("=" * 80)

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
updates = {
    "season": DEFAULT_SEASON,
    "player_id": MCDAVID_ID,
    "nhl_ppp": stats["nhl_ppp"],
    "nhl_shp": stats["nhl_shp"],
    "nhl_goals": stats["nhl_goals"],
    "nhl_assists": stats["nhl_assists"],
    "nhl_points": stats["nhl_points"],
}

db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
print("✓ Updated database")

# Verify
print()
print("=" * 80)
print("Verifying database update...")
print("=" * 80)
result = db.select(
    "player_season_stats",
    select="nhl_ppp,nhl_shp",
    filters=[
        ("player_id", "eq", MCDAVID_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if result and len(result) > 0:
    r = result[0]
    print(f"Database values:")
    print(f"  PPP: {r.get('nhl_ppp', 0)} (expected: 31)")
    print(f"  SHP: {r.get('nhl_shp', 0)} (expected: 2)")
    if r.get('nhl_ppp', 0) == 31 and r.get('nhl_shp', 0) == 2:
        print()
        print("✓✓✓ DATABASE UPDATE SUCCESSFUL! ✓✓✓")
    else:
        print()
        print("✗✗✗ DATABASE UPDATE FAILED ✗✗✗")

print()
print("=" * 80)
print("Test Complete")
print("=" * 80)

