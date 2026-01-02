#!/usr/bin/env python3
"""Check SOG for a specific game we know should have it"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Check the game we tested earlier
test_game_id = 2025020560
print(f"Checking game {test_game_id} (the one we tested earlier)...")

players = db.select("player_game_stats",
                   "player_id,nhl_shots_on_goal,nhl_goals,nhl_assists,updated_at",
                   filters=[("game_id", "eq", test_game_id), ("is_goalie", "eq", False)],
                   limit=10)

print(f"\nFound {len(players)} skaters:")
for p in players[:5]:
    print(f"  Player {p['player_id']}: SOG={p.get('nhl_shots_on_goal', 0)}, G={p.get('nhl_goals', 0)}, A={p.get('nhl_assists', 0)}, Updated={p.get('updated_at', 'N/A')}")

# Check if any games have SOG > 0 at all
print("\nChecking if ANY games have SOG > 0...")
any_sog = db.select("player_game_stats",
                   "game_id,nhl_shots_on_goal",
                   filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                   limit=5)

if any_sog:
    print(f"Found {len(any_sog)} records with SOG > 0:")
    for r in any_sog:
        print(f"  Game {r['game_id']}: SOG={r.get('nhl_shots_on_goal', 0)}")
else:
    print("  [ERROR] NO records found with SOG > 0 in entire database!")

# Check recent games to see if they were updated
print("\nChecking recent games (last 5)...")
recent_games = db.select("player_game_stats",
                        "game_id,game_date,nhl_shots_on_goal,updated_at",
                        filters=[("is_goalie", "eq", False)],
                        limit=100,
                        order="game_id.desc")

# Group by game
from collections import defaultdict
game_stats = defaultdict(lambda: {"total": 0, "with_sog": 0, "updated_at": None})
for r in recent_games:
    game_id = r.get('game_id')
    game_stats[game_id]["total"] += 1
    if r.get('nhl_shots_on_goal', 0) > 0:
        game_stats[game_id]["with_sog"] += 1
    if not game_stats[game_id]["updated_at"]:
        game_stats[game_id]["updated_at"] = r.get('updated_at')

print("Recent games SOG status:")
for game_id in sorted(list(game_stats.keys()), reverse=True)[:5]:
    stats = game_stats[game_id]
    pct = (stats["with_sog"] / stats["total"] * 100) if stats["total"] > 0 else 0
    print(f"  Game {game_id}: {stats['with_sog']}/{stats['total']} with SOG ({pct:.1f}%), Updated: {stats['updated_at']}")

