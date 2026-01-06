#!/usr/bin/env python3
"""
Check if the landing script has completed by verifying recent updates.
"""

import os
import sys
from datetime import datetime, timedelta
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
print("Checking Script Completion Status")
print("=" * 80)
print()

# Count players with PPP/SHP data
print("Checking players with PPP/SHP data...")
all_players = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp",
    filters=[("season", "eq", DEFAULT_SEASON)],
    limit=1000
)

if all_players:
    total = len(all_players)
    with_ppp = sum(1 for p in all_players if p.get("nhl_ppp", 0) > 0)
    with_shp = sum(1 for p in all_players if p.get("nhl_shp", 0) > 0)
    with_ppp_or_shp = sum(1 for p in all_players if p.get("nhl_ppp", 0) > 0 or p.get("nhl_shp", 0) > 0)
    
    print(f"Total players checked: {total}")
    print(f"Players with PPP > 0: {with_ppp}")
    print(f"Players with SHP > 0: {with_shp}")
    print(f"Players with PPP or SHP > 0: {with_ppp_or_shp}")
    print()
    
    # Check a few key players
    print("Verifying key players:")
    key_players = [
        (8478402, "Connor McDavid"),
        (8471675, "Sidney Crosby"),
        (8471214, "Nathan MacKinnon"),
        (8477956, "Auston Matthews"),
    ]
    
    for player_id, name in key_players:
        player_stats = [p for p in all_players if p.get("player_id") == player_id]
        if player_stats:
            p = player_stats[0]
            print(f"  {name}: PPP={p.get('nhl_ppp', 0)}, SHP={p.get('nhl_shp', 0)}")
        else:
            print(f"  {name}: Not found")
    
    print()
    if with_ppp_or_shp > 400:  # Reasonable threshold
        print("✓✓✓ Script appears to have completed successfully! ✓✓✓")
        print(f"   {with_ppp_or_shp} players have PPP/SHP data")
    else:
        print("⚠ Script may still be running or encountered issues")
        print(f"   Only {with_ppp_or_shp} players have PPP/SHP data")
else:
    print("No player stats found")

print()
print("=" * 80)

