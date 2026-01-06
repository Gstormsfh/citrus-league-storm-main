#!/usr/bin/env python3
"""Verify current service state"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt

load_dotenv()

db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("CURRENT SERVICE STATE")
print("=" * 80)
print()

# Check games in raw_nhl_data
print("1. Games in raw_nhl_data for today:")
games = db.select('raw_nhl_data', select='game_id,processed,game_date', filters=[('game_date', 'eq', '2026-01-04')], limit=10)
if games:
    print(f"   Total: {len(games)}")
    processed = [g for g in games if g.get('processed', False)]
    unprocessed = [g for g in games if not g.get('processed', False)]
    print(f"   Processed: {len(processed)}")
    print(f"   Unprocessed: {len(unprocessed)}")
    print()
    print("   Unprocessed games:")
    for g in unprocessed:
        print(f"     Game {g.get('game_id')}: processed={g.get('processed')}")
else:
    print("   No games found")
print()

# Check raw_shots
print("2. Games with processed shots (raw_shots):")
shots = db.select('raw_shots', select='DISTINCT game_id', filters=[('game_id', 'in', [g.get('game_id') for g in (games or [])])], limit=10)
if shots:
    shot_game_ids = set([s.get('game_id') for s in shots if s.get('game_id')])
    print(f"   Games with shots: {len(shot_game_ids)}")
    for gid in shot_game_ids:
        print(f"     Game {gid}")
else:
    print("   No shots found for today's games")
print()

# Check current game states
print("3. Current game states (via PBP API):")
import requests
game_ids = [g.get('game_id') for g in (games or [])]
for game_id in game_ids[:5]:
    try:
        pbp = requests.get(f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play", timeout=5).json()
        state = pbp.get('gameState', 'unknown')
        print(f"   Game {game_id}: {state}")
    except:
        print(f"   Game {game_id}: Error checking")
print()

print("=" * 80)
print("SUMMARY:")
print("=" * 80)
if games:
    unprocessed_count = len([g for g in games if not g.get('processed', False)])
    if unprocessed_count > 0:
        print(f"⚠️  {unprocessed_count} games are NOT processed yet")
        print("   The immediate PBP processing should process them when they finish")
        print("   OR you can run: python run_daily_pbp_processing.py")
    else:
        print("✅ All games are processed")
else:
    print("⚠️  No games in raw_nhl_data for today")

