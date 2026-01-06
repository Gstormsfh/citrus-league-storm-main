#!/usr/bin/env python3
"""
Test extraction for Crosby to verify PPP vs PPG.
"""

import os
import sys
import requests
from dotenv import load_dotenv

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
NHL_API_BASE = "https://api-web.nhle.com/v1"
CROSBY_ID = 8471675

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

print("=" * 80)
print("Testing Crosby Extraction - PPP vs PPG")
print("=" * 80)
print()

# Fetch landing data
url = f"{NHL_API_BASE}/player/{CROSBY_ID}/landing"
print(f"Fetching: {url}")
response = requests.get(url, timeout=10)
response.raise_for_status()
landing_data = response.json()
print("✓ Fetched landing data")
print()

# Check featuredStats
if "featuredStats" in landing_data:
    featured = landing_data["featuredStats"]
    if "regularSeason" in featured:
        rs = featured["regularSeason"]
        if "subSeason" in rs:
            sub = rs["subSeason"]
            print("FeaturedStats subSeason values:")
            print(f"  powerPlayGoals: {sub.get('powerPlayGoals', 0)}")
            print(f"  powerPlayPoints: {sub.get('powerPlayPoints', 0)}")
            print(f"  shorthandedGoals: {sub.get('shorthandedGoals', 0)}")
            print(f"  shorthandedPoints: {sub.get('shorthandedPoints', 0)}")
            print()
            
            ppp = _safe_int(sub.get("powerPlayPoints", 0), 0)
            ppg = _safe_int(sub.get("powerPlayGoals", 0), 0)
            
            print(f"Extracted:")
            print(f"  PPG (powerPlayGoals): {ppg}")
            print(f"  PPP (powerPlayPoints): {ppp}")
            print()
            
            if ppp == 16:
                print("✓✓✓ PPP CORRECT (16) ✓✓✓")
            else:
                print(f"✗✗✗ PPP WRONG - Expected 16, got {ppp} ✗✗✗")
            
            if ppp > ppg:
                print(f"✓ PPP ({ppp}) > PPG ({ppg}) - This is correct (PPP = PPG + PPA)")
            else:
                print(f"✗ PPP ({ppp}) <= PPG ({ppg}) - This is wrong!")

# Also check seasonTotals
print()
print("=" * 80)
print("Checking seasonTotals for 20252026:")
print("=" * 80)
if "seasonTotals" in landing_data:
    season_totals = landing_data["seasonTotals"]
    for season_data in reversed(season_totals):
        season_id = season_data.get("season", 0)
        season_start = season_id // 10000 if season_id > 0 else 0
        if season_start == 2025:
            print(f"Season {season_id}:")
            print(f"  powerPlayGoals: {season_data.get('powerPlayGoals', 0)}")
            print(f"  powerPlayPoints: {season_data.get('powerPlayPoints', 0)}")
            print(f"  shorthandedGoals: {season_data.get('shorthandedGoals', 0)}")
            print(f"  shorthandedPoints: {season_data.get('shorthandedPoints', 0)}")
            break

print()
print("=" * 80)
print("Test Complete")
print("=" * 80)

