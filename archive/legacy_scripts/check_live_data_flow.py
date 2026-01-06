#!/usr/bin/env python3
"""
Diagnostic script to check the live data flow:
1. Check if games are detected as active
2. Check if player_game_stats has data for today's games
3. Check if the RPC returns data
4. Check if the scheduler is running the live stats update
"""

import os
import sys
import datetime as dt
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
today = dt.date.today()

print("=" * 80)
print("LIVE DATA FLOW DIAGNOSTIC")
print("=" * 80)
print(f"Today's date: {today}")
print()

# 1. Check today's games
print("1. TODAY'S GAMES:")
print("-" * 80)
games = db.select(
    "nhl_games",
    select="game_id,home_team,away_team,status,game_date",
    filters=[("game_date", "eq", today.isoformat())],
    limit=20
)
print(f"Found {len(games)} games for today")
for g in games:
    print(f"  Game {g['game_id']}: {g.get('away_team', '?')} @ {g.get('home_team', '?')} - Status: {g.get('status', '?')}")
print()

# 2. Check if player_game_stats has data for today
print("2. PLAYER_GAME_STATS FOR TODAY:")
print("-" * 80)
stats = db.select(
    "player_game_stats",
    select="game_id,player_id,nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_points,updated_at",
    filters=[("game_date", "eq", today.isoformat())],
    limit=20
)
print(f"Found {len(stats)} player_game_stats rows for today")
if stats:
    for s in stats[:10]:
        print(f"  Game {s['game_id']}, Player {s['player_id']}: G={s.get('nhl_goals', 0)}, A={s.get('nhl_assists', 0)}, P={s.get('nhl_points', 0)}, SOG={s.get('nhl_shots_on_goal', 0)}, Updated={s.get('updated_at', '?')}")
else:
    print("  ⚠️ NO STATS FOUND - This is the problem!")
print()

# 3. Check active game detection
print("3. ACTIVE GAME DETECTION:")
print("-" * 80)
try:
    from data_scraping_service import detect_active_games
    has_active = detect_active_games()
    print(f"detect_active_games() returns: {has_active}")
except Exception as e:
    print(f"Error checking active games: {e}")
print()

# 4. Check if live stats update would work
print("4. LIVE STATS UPDATE TEST:")
print("-" * 80)
try:
    from scrape_live_nhl_stats import get_active_game_ids, update_live_game_stats
    active_ids = get_active_game_ids()
    print(f"Active game IDs: {active_ids}")
    if active_ids:
        print("Running live stats update...")
        result = update_live_game_stats()
        print(f"Result: {result}")
    else:
        print("No active games found")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
print()

# 5. Check a specific player's stats via RPC
print("5. RPC TEST (get_daily_game_stats):")
print("-" * 80)
if stats:
    # Get a player ID from the stats
    test_player_id = stats[0]['player_id']
    print(f"Testing RPC for player {test_player_id} on {today}")
    try:
        rpc_result = db.rpc('get_daily_game_stats', {
            'p_player_ids': [test_player_id],
            'p_game_date': today.isoformat()
        })
        print(f"RPC returned {len(rpc_result) if rpc_result else 0} rows")
        if rpc_result:
            print(f"Sample row: {rpc_result[0]}")
        else:
            print("  ⚠️ RPC returned no data")
    except Exception as e:
        print(f"Error calling RPC: {e}")
else:
    print("Skipping RPC test (no player_game_stats found)")
print()

print("=" * 80)
print("DIAGNOSTIC COMPLETE")
print("=" * 80)

