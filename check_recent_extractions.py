#!/usr/bin/env python3
"""Check when games were last extracted"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
MCDAVID_ID = 8478402

# Get games with PPP/SHP for McDavid
games = db.select(
    "player_game_stats",
    select="game_id,game_date,ppp,shp,updated_at",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)],
    limit=100
)

ppp_shp_games = [g for g in games if (g.get("ppp") or 0) > 0 or (g.get("shp") or 0) > 0]

print("Games with PPP or SHP (sorted by updated_at):")
for g in sorted(ppp_shp_games, key=lambda x: x.get("updated_at") or ""):
    print(f"  Game {g.get('game_id')} ({g.get('game_date')}): PPP={g.get('ppp')} SHP={g.get('shp')} Updated={g.get('updated_at')}")

# Check when season stats were last updated
season_stats = db.select(
    "player_season_stats",
    select="updated_at",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)],
    limit=1
)

if season_stats:
    print(f"\nSeason stats last updated: {season_stats[0].get('updated_at')}")
