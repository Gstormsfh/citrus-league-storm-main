#!/usr/bin/env python3
"""Quick check for active games."""
import requests

try:
    response = requests.get("https://api-web.nhle.com/v1/schedule/now", timeout=10)
    schedule = response.json()
    games = schedule.get("games", [])
    
    active = [g for g in games if g.get("gameState", "").upper() in ("LIVE", "CRIT")]
    final = [g for g in games if g.get("gameState", "").upper() == "OFF"]
    
    print(f"Total games in schedule: {len(games)}")
    print(f"Active games (LIVE/CRIT): {len(active)}")
    print(f"Final games (OFF): {len(final)}")
    print()
    
    if active:
        print("ACTIVE GAMES:")
        for g in active:
            game_id = g.get("id")
            away = g.get("awayTeam", {}).get("abbrev", "?")
            home = g.get("homeTeam", {}).get("abbrev", "?")
            state = g.get("gameState", "")
            print(f"  Game {game_id}: {away} @ {home} ({state})")
    else:
        print("No active games right now.")
        
    if final:
        print(f"\nFinal games (recently finished): {len(final)}")
        
except Exception as e:
    print(f"Error: {e}")


