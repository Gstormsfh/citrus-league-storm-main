#!/usr/bin/env python3
"""Detailed check for active NHL games"""

import requests
import json
from datetime import datetime, timezone

def check_active_games():
    """Check NHL API for active games"""
    try:
        r = requests.get('https://api-web.nhle.com/v1/schedule/now', timeout=10)
        r.raise_for_status()
        data = r.json()
        
        games = data.get('games', [])
        
        print("=" * 80)
        print("NHL SCHEDULE CHECK")
        print("=" * 80)
        print(f"Current UTC: {datetime.now(timezone.utc)}")
        print(f"Current Local: {datetime.now()}")
        print(f"Total games in schedule: {len(games)}")
        print()
        
        if not games:
            print("No games found in schedule.")
            return
        
        # Categorize games - include INTERMISSION as active
        live_games = []
        intermission_games = []
        final_games = []
        preview_games = []
        other_games = []
        
        # Track all unique game states for debugging
        all_states = set()
        
        for game in games:
            state = game.get('gameState', 'UNKNOWN')
            game_id = game.get('id')
            away = game.get('awayTeam', {}).get('abbrev', '?')
            home = game.get('homeTeam', {}).get('abbrev', '?')
            start_utc = game.get('startTimeUTC', 'N/A')
            
            all_states.add(state)
            
            if state in ['LIVE', 'CRIT']:
                live_games.append((game_id, away, home, state, start_utc))
            elif state == 'INTERMISSION':
                intermission_games.append((game_id, away, home, state, start_utc))
            elif state == 'OFF':
                final_games.append((game_id, away, home, state, start_utc))
            elif state in ['PREVIEW', 'FUT']:
                preview_games.append((game_id, away, home, state, start_utc))
            else:
                other_games.append((game_id, away, home, state, start_utc))
        
        print(f"All game states found: {sorted(all_states)}")
        print()
        
        print(f"LIVE/CRIT games: {len(live_games)}")
        for gid, away, home, state, start in live_games:
            print(f"  🟢 {gid}: {away} @ {home} | {state} | Start: {start}")
        
        print(f"\nINTERMISSION games: {len(intermission_games)}")
        for gid, away, home, state, start in intermission_games:
            print(f"  🟡 {gid}: {away} @ {home} | {state} | Start: {start}")
        
        print(f"\nFINAL (OFF) games: {len(final_games)}")
        for gid, away, home, state, start in final_games[:5]:  # Show first 5
            print(f"  ⚫ {gid}: {away} @ {home} | {state} | Start: {start}")
        if len(final_games) > 5:
            print(f"  ... and {len(final_games) - 5} more")
        
        print(f"\nPREVIEW games: {len(preview_games)}")
        for gid, away, home, state, start in preview_games[:5]:  # Show first 5
            print(f"  ⚪ {gid}: {away} @ {home} | {state} | Start: {start}")
        if len(preview_games) > 5:
            print(f"  ... and {len(preview_games) - 5} more")
        
        if other_games:
            print(f"\nOTHER states: {len(other_games)}")
            for gid, away, home, state, start in other_games[:5]:
                print(f"  ❓ {gid}: {away} @ {home} | {state} | Start: {start}")
        
        print()
        print("=" * 80)
        active_count = len(live_games) + len(intermission_games)
        if active_count > 0:
            print(f"✅ {active_count} ACTIVE GAME(S) DETECTED! (LIVE/CRIT: {len(live_games)}, INTERMISSION: {len(intermission_games)})")
            print("Service should be polling every 30 seconds.")
        else:
            print("⚠️  No active games - service will poll every 5 minutes.")
        print("=" * 80)
        
        return active_count > 0
        
    except Exception as e:
        print(f"Error checking schedule: {e}")
        return False

if __name__ == "__main__":
    check_active_games()

