#!/usr/bin/env python3
"""
Fix Lucas Raymond's PPP - update from API to match NHL.com.
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

RAYMOND_ID = 8482078  # Correct player ID

print("=" * 80)
print("Fixing Lucas Raymond's PPP")
print("=" * 80)
print()

# Check current database value
current = db.select(
    "player_season_stats",
    select="nhl_ppp,nhl_shp",
    filters=[
        ("player_id", "eq", RAYMOND_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if current and len(current) > 0:
    print(f"Current database value: PPP={current[0].get('nhl_ppp', 0)}")
    print()

# Fetch from API
url = f"{NHL_API_BASE}/player/{RAYMOND_ID}/landing"
response = requests.get(url, timeout=10)
response.raise_for_status()
landing_data = response.json()

# Extract stats
stats = {}
if "featuredStats" in landing_data:
    featured = landing_data["featuredStats"]
    if "regularSeason" in featured:
        rs = featured["regularSeason"]
        if "subSeason" in rs:
            sub = rs["subSeason"]
            stats["nhl_ppp"] = _safe_int(sub.get("powerPlayPoints", 0), 0)
            stats["nhl_shp"] = _safe_int(sub.get("shorthandedPoints", 0), 0)
            
            # Also show components for verification
            ppg = _safe_int(sub.get("powerPlayGoals", 0), 0)
            ppa = _safe_int(sub.get("powerPlayAssists", 0), 0)
            
            print("API values:")
            print(f"  PPG: {ppg}")
            print(f"  PPA: {ppa}")
            print(f"  PPG + PPA: {ppg + ppa}")
            print(f"  PPP (powerPlayPoints - TOTAL): {stats['nhl_ppp']}")
            print(f"  SHP: {stats['nhl_shp']}")
            print()

# Update database
updates = {
    "season": DEFAULT_SEASON,
    "player_id": RAYMOND_ID,
    "nhl_ppp": stats.get("nhl_ppp", 0),
    "nhl_shp": stats.get("nhl_shp", 0),
}

db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
print(f"✓ Updated database: PPP={stats.get('nhl_ppp', 0)}")

# Verify
verify = db.select(
    "player_season_stats",
    select="nhl_ppp,nhl_shp",
    filters=[
        ("player_id", "eq", RAYMOND_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if verify and len(verify) > 0:
    v = verify[0]
    print(f"✓ Verified: PPP={v.get('nhl_ppp', 0)}, SHP={v.get('nhl_shp', 0)}")
    if v.get('nhl_ppp', 0) == 18:
        print("✓✓✓ CORRECT - Matches NHL.com! ✓✓✓")
    else:
        print(f"✗✗✗ STILL WRONG - Expected 18, got {v.get('nhl_ppp', 0)} ✗✗✗")

print()
print("=" * 80)

