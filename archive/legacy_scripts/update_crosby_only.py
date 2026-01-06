#!/usr/bin/env python3
"""
Quick test: Update just Crosby to verify the fix works.
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
CROSBY_ID = 8471675

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

print("=" * 80)
print("Updating Crosby Only - Testing Fix")
print("=" * 80)
print()

# Fetch landing data
url = f"{NHL_API_BASE}/player/{CROSBY_ID}/landing"
response = requests.get(url, timeout=10)
response.raise_for_status()
landing_data = response.json()

# Extract using the same logic as the main script
stats = {}
if "featuredStats" in landing_data:
    featured = landing_data["featuredStats"]
    featured_season = featured.get("season", 0)
    featured_season_start = featured_season // 10000 if featured_season > 0 else 0
    
    if featured_season_start == DEFAULT_SEASON or featured_season_start == 0:
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                stats["nhl_ppp"] = _safe_int(sub.get("powerPlayPoints", 0), 0)  # CRITICAL: powerPlayPoints, not powerPlayGoals
                stats["nhl_shp"] = _safe_int(sub.get("shorthandedPoints", 0), 0)
                stats["nhl_goals"] = _safe_int(sub.get("goals", 0), 0)
                stats["nhl_assists"] = _safe_int(sub.get("assists", 0), 0)
                stats["nhl_points"] = _safe_int(sub.get("points", 0), 0)

print(f"Extracted values:")
print(f"  PPP: {stats.get('nhl_ppp', 0)} (expected: 16)")
print(f"  SHP: {stats.get('nhl_shp', 0)}")
print()

# Update database
db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
updates = {
    "season": DEFAULT_SEASON,
    "player_id": CROSBY_ID,
    "nhl_ppp": stats.get("nhl_ppp", 0),
    "nhl_shp": stats.get("nhl_shp", 0),
    "nhl_goals": stats.get("nhl_goals", 0),
    "nhl_assists": stats.get("nhl_assists", 0),
    "nhl_points": stats.get("nhl_points", 0),
}

db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
print("✓ Updated database")

# Verify
result = db.select(
    "player_season_stats",
    select="nhl_ppp,nhl_shp",
    filters=[
        ("player_id", "eq", CROSBY_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if result and len(result) > 0:
    r = result[0]
    print(f"Database now shows:")
    print(f"  PPP: {r.get('nhl_ppp', 0)} (expected: 16)")
    print(f"  SHP: {r.get('nhl_shp', 0)}")
    if r.get('nhl_ppp', 0) == 16:
        print()
        print("✓✓✓ FIX VERIFIED - Crosby now has correct PPP (16) ✓✓✓")
    else:
        print()
        print(f"✗✗✗ STILL WRONG - Got {r.get('nhl_ppp', 0)}, expected 16 ✗✗✗")

print()
print("=" * 80)
print("Test Complete")
print("=" * 80)

