#!/usr/bin/env python3
"""Check if scraper is actually working by comparing counts over time."""
import os
import time
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 60)
print("SCRAPER PROGRESS CHECK")
print("=" * 60)

# Initial count
with_hits = db.select('player_game_stats', select='game_id', 
                     filters=[('season', 'eq', 2025), ('nhl_hits', 'gt', 0)], 
                     limit=10000)
games_with_hits = len(set([r['game_id'] for r in (with_hits or [])]))

total_games = db.select('nhl_games', select='game_id', 
                       filters=[('season', 'eq', 2025), ('status', 'eq', 'final')], 
                       limit=10000)
total_final = len(total_games) if total_games else 0

pct = (games_with_hits / total_final * 100) if total_final > 0 else 0

players_with_hits = db.select('player_game_stats', select='player_id', 
                             filters=[('season', 'eq', 2025), ('is_goalie', 'eq', False), ('nhl_hits', 'gt', 0)], 
                             limit=10000)
num_players = len(set([r['player_id'] for r in (players_with_hits or [])])) if players_with_hits else 0

print(f"Initial count: {games_with_hits}/{total_final} ({pct:.1f}%)")
print(f"Players with hits/blocks: {num_players}")
print()
print("Waiting 20 seconds to check if count increases...")
print()

time.sleep(20)

# Check again
with_hits2 = db.select('player_game_stats', select='game_id', 
                      filters=[('season', 'eq', 2025), ('nhl_hits', 'gt', 0)], 
                      limit=10000)
games_with_hits2 = len(set([r['game_id'] for r in (with_hits2 or [])]))

pct2 = (games_with_hits2 / total_final * 100) if total_final > 0 else 0

print("=" * 60)
print(f"New count: {games_with_hits2}/{total_final} ({pct2:.1f}%)")
print()

if games_with_hits2 > games_with_hits:
    diff = games_with_hits2 - games_with_hits
    print(f"✓ SCRAPER IS WORKING!")
    print(f"  Count increased by {diff} games in 20 seconds")
    print(f"  Rate: ~{diff * 3} games/minute")
else:
    print("⚠ Count unchanged - scraper may be:")
    print("  - Still fetching game list (pagination)")
    print("  - Processing games without hits")
    print("  - Stuck or finished")
    print()
    print("Checking if Python processes are running...")
    import subprocess
    try:
        result = subprocess.run(['powershell', '-Command', 'Get-Process python -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            count = result.stdout.strip()
            print(f"  Python processes: {count}")
    except:
        print("  (Could not check process count)")

print("=" * 60)

