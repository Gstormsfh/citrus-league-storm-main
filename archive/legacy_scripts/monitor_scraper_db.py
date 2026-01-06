#!/usr/bin/env python3
"""Monitor scraper progress by checking database."""
import os
import time
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 70)
print("MONITORING PER-GAME NHL STATS SCRAPER PROGRESS")
print("=" * 70)
print("Checking database every 10 seconds...")
print()

last_count = 0
start_time = time.time()

while True:
    try:
        # Count games with nhl_hits populated
        with_hits = db.select('player_game_stats', select='game_id', 
                             filters=[('season', 'eq', 2025), ('nhl_hits', 'gt', 0)], 
                             limit=10000)
        games_with_hits = len(set([r['game_id'] for r in (with_hits or [])]))
        
        # Count total final games
        total_games = db.select('nhl_games', select='game_id', 
                               filters=[('season', 'eq', 2025), ('status', 'eq', 'final')], 
                               limit=10000)
        total_final = len(total_games) if total_games else 0
        
        # Count players with nhl_hits
        players_with_hits = db.select('player_game_stats', select='player_id', 
                                     filters=[('season', 'eq', 2025), ('is_goalie', 'eq', False), ('nhl_hits', 'gt', 0)], 
                                     limit=10000)
        num_players = len(set([r['player_id'] for r in (players_with_hits or [])])) if players_with_hits else 0
        
        if games_with_hits != last_count:
            elapsed = time.time() - start_time
            pct = (games_with_hits / total_final * 100) if total_final > 0 else 0
            
            if games_with_hits > last_count and elapsed > 0:
                rate = (games_with_hits - last_count) / 10  # games per 10 seconds
                remaining = (total_final - games_with_hits) / rate if rate > 0 else 0
                eta_min = remaining / 60
            else:
                rate = 0
                eta_min = 0
            
            print(f"[{games_with_hits:3d}/{total_final}] {pct:5.1f}% | Players: {num_players:4d} | Rate: {rate:.2f} games/10s | ETA: {eta_min:.1f} min", flush=True)
            last_count = games_with_hits
            
            if games_with_hits >= total_final:
                print()
                print("=" * 70)
                print("✓ SCRAPER COMPLETE!")
                print("=" * 70)
                break
        
        time.sleep(10)
        
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped.")
        break
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(10)

