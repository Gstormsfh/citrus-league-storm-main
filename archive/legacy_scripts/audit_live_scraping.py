#!/usr/bin/env python3
"""Deep audit of live scraping system"""
import os
import sys
import datetime as dt
from pathlib import Path
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
today = dt.date.today()

print("=" * 80)
print("LIVE SCRAPING SYSTEM AUDIT")
print("=" * 80)
print(f"Date: {today}")
print()

# 1. Check today's games
print("1. TODAY'S GAMES:")
print("-" * 80)
games = db.select("nhl_games", select="game_id,home_team,away_team,status,home_score,away_score", filters=[("game_date", "eq", today.isoformat())], limit=20)
live_games = [g for g in games if g.get("status") == "live"]
print(f"Total games today: {len(games)}")
print(f"Live games: {len(live_games)}")
for g in live_games:
    print(f"  Game {g['game_id']}: {g.get('away_team', '?')} @ {g.get('home_team', '?')} - Score: {g.get('away_score', 0)}-{g.get('home_score', 0)}")
print()

# 2. Check player_game_stats for live games
print("2. PLAYER_GAME_STATS FOR LIVE GAMES:")
print("-" * 80)
if live_games:
    for g in live_games[:2]:
        game_id = g['game_id']
        stats = db.select("player_game_stats", select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,updated_at", filters=[("game_id", "eq", game_id)], limit=10)
        print(f"Game {game_id}: {len(stats)} player_game_stats rows")
        if stats:
            for s in stats[:5]:
                print(f"  Player {s['player_id']}: G={s.get('nhl_goals', 0)}, A={s.get('nhl_assists', 0)}, P={s.get('nhl_points', 0)}, SOG={s.get('nhl_shots_on_goal', 0)}, Updated={s.get('updated_at', '?')[:19]}")
        else:
            print(f"  ⚠️ NO STATS - This is a problem!")
        print()
else:
    print("No live games to check")
    print()

# 3. Check active game detection
print("3. ACTIVE GAME DETECTION:")
print("-" * 80)
try:
    from data_scraping_service import detect_active_games
    has_active = detect_active_games()
    print(f"detect_active_games() returns: {has_active}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
print()

# 4. Check scheduler status
print("4. SCHEDULER STATUS:")
print("-" * 80)
log_file = Path("logs/data_scraping_service.log")
if log_file.exists():
    lines = log_file.read_text(encoding='utf-8', errors='ignore').split('\n')
    recent = [l for l in lines[-50:] if 'live stats' in l.lower() or 'Scheduled' in l or 'Running job' in l or 'active games' in l.lower()]
    print("Recent scheduler activity (last 20 relevant lines):")
    for line in recent[-20:]:
        print(f"  {line}")
else:
    print("⚠️ Log file not found - service may not be running")
print()

# 5. Test live stats update
print("5. TEST LIVE STATS UPDATE:")
print("-" * 80)
try:
    from scrape_live_nhl_stats import get_active_game_ids, update_live_game_stats
    active_ids = get_active_game_ids()
    print(f"Active game IDs: {active_ids}")
    if active_ids:
        print("Running update_live_game_stats()...")
        result = update_live_game_stats()
        print(f"Result: {result}")
    else:
        print("No active games found")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
print()

# 6. Check cooldown status
print("6. COOLDOWN STATUS:")
print("-" * 80)
if live_games:
    try:
        from scrape_live_nhl_stats import get_last_update_time, should_update_game
        for g in live_games[:2]:
            game_id = g['game_id']
            last_update = get_last_update_time(db, game_id)
            should_update = should_update_game(db, game_id, is_live=True)
            print(f"Game {game_id}:")
            print(f"  Last update: {last_update}")
            print(f"  Should update: {should_update}")
            if last_update:
                now = dt.datetime.now(dt.timezone.utc)
                age = (now - last_update).total_seconds()
                print(f"  Age: {age:.0f} seconds")
    except Exception as e:
        print(f"Error: {e}")
print()

print("=" * 80)
print("AUDIT COMPLETE")
print("=" * 80)

