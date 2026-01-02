#!/usr/bin/env python3
"""Check if scraper ran and SOG is populated"""

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
print("SCRAPER STATUS CHECK")
print("=" * 80)
print()

# 1. Check when records were last updated
print("1. Checking last update timestamps...")
recent_updates = db.select("player_game_stats",
                           "updated_at",
                           filters=[("updated_at", "gte", "2025-12-25T00:00:00")],
                           limit=10)

if recent_updates:
    print(f"   Found {len(recent_updates)} records updated today")
    latest = max(r.get('updated_at', '') for r in recent_updates)
    print(f"   Latest update: {latest}")
else:
    print("   No records updated today")

# 2. Check SOG population
print("\n2. Checking SOG population...")
all_skaters = []
offset = 0
while len(all_skaters) < 2000:
    batch = db.select("player_game_stats",
                     "nhl_shots_on_goal, game_id, game_date, updated_at",
                     filters=[("is_goalie", "eq", False)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    all_skaters.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

total_records = len(all_skaters)
sog_populated = sum(1 for r in all_skaters if r.get('nhl_shots_on_goal', 0) > 0)
sog_zero = total_records - sog_populated
sog_percentage = (sog_populated / total_records * 100) if total_records > 0 else 0

print(f"   Total skater records checked: {total_records:,}")
print(f"   Records with SOG > 0: {sog_populated:,} ({sog_percentage:.1f}%)")
print(f"   Records with SOG = 0: {sog_zero:,}")

# 3. Check games with SOG
print("\n3. Checking games with SOG populated...")
games_with_sog = set()
offset = 0
while True:
    batch = db.select("player_game_stats",
                     "game_id",
                     filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    games_with_sog.update([r.get('game_id') for r in batch])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"   Games with SOG > 0: {len(games_with_sog)}")

# 4. Check games with other stats (to see if scraper ran at all)
print("\n4. Checking games with other NHL stats...")
games_with_goals = set()
offset = 0
while True:
    batch = db.select("player_game_stats",
                     "game_id",
                     filters=[("is_goalie", "eq", False), ("nhl_goals", "gt", 0)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    games_with_goals.update([r.get('game_id') for r in batch])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"   Games with goals > 0: {len(games_with_goals)}")

# 5. Sample some games with SOG
print("\n5. Sample games with SOG...")
if games_with_sog:
    sample_games = list(games_with_sog)[:5]
    for game_id in sample_games:
        players = db.select("player_game_stats",
                           "player_id, nhl_shots_on_goal, nhl_goals",
                           filters=[("game_id", "eq", game_id), ("is_goalie", "eq", False)],
                           limit=5)
        players_with_sog = sum(1 for p in players if p.get('nhl_shots_on_goal', 0) > 0)
        print(f"   Game {game_id}: {players_with_sog}/{len(players)} players with SOG > 0")
else:
    print("   No games with SOG found")

# Summary
print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
if sog_percentage > 40:
    print("[OK] SOG is populated! Scraper appears to have run successfully.")
elif sog_percentage > 0:
    print("[WARN] SOG is partially populated. Scraper may have run but not completed.")
else:
    print("[ERROR] SOG is still 0%. Scraper has not run or failed.")
print(f"\n  - SOG populated: {sog_percentage:.1f}% of records")
print(f"  - Games with SOG: {len(games_with_sog)}")
print(f"  - Games with goals: {len(games_with_goals)}")

