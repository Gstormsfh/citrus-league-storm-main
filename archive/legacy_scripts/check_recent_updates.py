#!/usr/bin/env python3
"""Check if any players have been updated recently."""
import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Check McDavid specifically
mcdavid = db.select("player_season_stats", select="nhl_ppp,nhl_shp,updated_at", filters=[("player_id", "eq", 8478402), ("season", "eq", 2025)], limit=1)
if mcdavid:
    print(f"McDavid: PPP={mcdavid[0].get('nhl_ppp', 0)}, SHP={mcdavid[0].get('nhl_shp', 0)}, Updated={mcdavid[0].get('updated_at', 'unknown')}")

# Check a few random players
random = db.select("player_season_stats", select="player_id,nhl_ppp,nhl_shp", filters=[("season", "eq", 2025)], limit=10)
print(f"\nSample of 10 players:")
for p in random:
    print(f"  ID {p['player_id']}: PPP={p.get('nhl_ppp', 0)}, SHP={p.get('nhl_shp', 0)}")
