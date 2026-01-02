#!/usr/bin/env python3
"""Check what dates have games"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
games = db.select("nhl_games", select="game_date,game_id", filters=[("game_date", "gte", "2024-12-17")], limit=10, order="game_date.desc")

print("Recent games with dates:")
for g in games:
    print(f"  {g['game_date']} - game_id: {g['game_id']}")

if games:
    test_date = games[0]['game_date']
    print(f"\nUsing date: {test_date}")

