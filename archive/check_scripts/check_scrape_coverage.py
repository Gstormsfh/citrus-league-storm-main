#!/usr/bin/env python3
"""Check how many games were actually scraped"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import defaultdict

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("SCRAPE COVERAGE ANALYSIS")
print("=" * 80)
print()

# Get all games in the date range
print("1. Checking games in date range 2024-10-07 to 2025-12-24...")
all_games = []
offset = 0
while True:
    batch = db.select("nhl_games",
                     "game_id,game_date",
                     filters=[("game_date", "gte", "2024-10-07"), ("game_date", "lte", "2025-12-24")],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    all_games.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

print(f"   Total games in date range: {len(all_games)}")

# Check which games have player_game_stats records
print("\n2. Checking which games have player_game_stats records...")
games_with_stats = set()
offset = 0
while True:
    batch = db.select("player_game_stats",
                     "game_id",
                     filters=[("game_date", "gte", "2024-10-07"), ("game_date", "lte", "2025-12-24")],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    games_with_stats.update([r.get('game_id') for r in batch])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"   Games with player_game_stats: {len(games_with_stats)}")

# Check which games have SOG > 0
print("\n3. Checking which games have SOG populated...")
games_with_sog = set()
offset = 0
while True:
    batch = db.select("player_game_stats",
                     "game_id",
                     filters=[("game_date", "gte", "2024-10-07"), ("game_date", "lte", "2025-12-24"),
                              ("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    games_with_sog.update([r.get('game_id') for r in batch])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"   Games with SOG > 0: {len(games_with_sog)}")

# Check which games have other stats populated (to see if scraper ran)
print("\n4. Checking which games have other NHL stats populated...")
games_with_other_stats = set()
offset = 0
while True:
    batch = db.select("player_game_stats",
                     "game_id",
                     filters=[("game_date", "gte", "2024-10-07"), ("game_date", "lte", "2025-12-24"),
                              ("is_goalie", "eq", False), ("nhl_goals", "gt", 0)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    games_with_other_stats.update([r.get('game_id') for r in batch])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"   Games with goals > 0: {len(games_with_other_stats)}")

# Summary
print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"Total games in range: {len(all_games)}")
print(f"Games with player_game_stats: {len(games_with_stats)}")
print(f"Games with NHL goals populated: {len(games_with_other_stats)}")
print(f"Games with SOG populated: {len(games_with_sog)}")
print(f"\nSOG coverage: {len(games_with_sog)}/{len(games_with_other_stats)} games ({len(games_with_sog)/len(games_with_other_stats)*100 if games_with_other_stats else 0:.1f}%)")

if len(games_with_sog) < len(games_with_other_stats):
    print("\n[WARN] Some games have other stats but not SOG - scraper may have failed for those games")
    print("You may need to re-run the scraper for games missing SOG")

