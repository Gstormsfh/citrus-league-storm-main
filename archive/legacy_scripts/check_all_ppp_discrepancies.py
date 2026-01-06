#!/usr/bin/env python3
"""
Check for players where database PPP might be incorrect (showing PPG instead of total PPP).
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

print("=" * 80)
print("Checking for PPP Discrepancies")
print("=" * 80)
print()
print("Looking for players where database PPP might equal PPG instead of total PPP...")
print()

# Get a sample of players with PPP > 0
players = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("nhl_ppp", "gt", 0)
    ],
    limit=50
)

discrepancies = []
checked = 0

for player_stat in players[:20]:  # Check first 20 to avoid rate limits
    player_id = player_stat.get("player_id")
    db_ppp = player_stat.get("nhl_ppp", 0)
    
    if not player_id:
        continue
    
    try:
        # Fetch from API
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
                    api_ppp = _safe_int(sub.get("powerPlayPoints", 0), 0)
                    api_ppg = _safe_int(sub.get("powerPlayGoals", 0), 0)
                    
                    # Check if database PPP equals PPG (suspicious)
                    if db_ppp == api_ppg and api_ppp != api_ppg:
                        first_name = landing_data.get("firstName", {}).get("default", "Unknown")
                        last_name = landing_data.get("lastName", {}).get("default", "Unknown")
                        name = f"{first_name} {last_name}"
                        discrepancies.append({
                            "player_id": player_id,
                            "name": name,
                            "db_ppp": db_ppp,
                            "api_ppg": api_ppg,
                            "api_ppp": api_ppp
                        })
        
        checked += 1
        if checked % 5 == 0:
            print(f"  Checked {checked} players...")
        
        # Rate limiting
        import time
        time.sleep(0.2)
        
    except Exception as e:
        continue

print()
print("=" * 80)
if discrepancies:
    print(f"Found {len(discrepancies)} players with potential discrepancies:")
    print()
    for d in discrepancies:
        print(f"  {d['name']} (ID: {d['player_id']}):")
        print(f"    Database PPP: {d['db_ppp']} (looks like PPG)")
        print(f"    API PPG: {d['api_ppg']}")
        print(f"    API PPP (correct): {d['api_ppp']}")
        print()
    print("These players need to be updated with correct PPP values.")
else:
    print("✓ No discrepancies found in sample checked.")
print("=" * 80)

