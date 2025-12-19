#!/usr/bin/env python3
"""Reset stats_extracted flag to re-extract PIM/PPP/SHP."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("Resetting stats_extracted flag for all games...")

# Get all games
all_games = []
offset = 0
while True:
  page = db.select("raw_nhl_data", select="game_id", limit=1000, offset=offset)
  if not page:
    break
  all_games.extend([g["game_id"] for g in page if g.get("game_id")])
  if len(page) < 1000:
    break
  offset += 1000

print(f"Found {len(all_games)} games")

# Reset stats_extracted to False
updated = 0
for game_id in all_games:
  db.update("raw_nhl_data", {"stats_extracted": False, "stats_extracted_at": None}, filters=[("game_id", "eq", game_id)])
  updated += 1
  if updated % 50 == 0:
    print(f"  Reset {updated}/{len(all_games)} games...")

print(f"\nDone! Reset {updated} games. Now run extractor_job.py to re-extract with PIM/PPP/SHP.")

