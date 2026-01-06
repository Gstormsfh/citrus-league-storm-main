#!/usr/bin/env python3
"""Check what the NHL API actually returns for a game"""
import requests
import json

game_id = 2025020660
url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
r = requests.get(url, timeout=10)
data = r.json()

player_stats = data.get('playerByGameStats', {})
home_team = player_stats.get('homeTeam', {})
forwards = home_team.get('forwards', [])

if forwards:
    p = forwards[0]
    print("Sample player stat keys from API:")
    print(json.dumps(list(p.keys()), indent=2))
    print("\nSample player stat values:")
    print(f"  playerId: {p.get('playerId')}")
    print(f"  goals: {p.get('goals')}")
    print(f"  assists: {p.get('assists')}")
    print(f"  sog: {p.get('sog')}")
    print(f"  shots: {p.get('shots')}")
    print(f"  shotsOnGoal: {p.get('shotsOnGoal')}")
    print(f"  hits: {p.get('hits')}")
    print(f"  blockedShots: {p.get('blockedShots')}")
    print(f"  blocked: {p.get('blocked')}")
    print(f"  timeOnIce: {p.get('timeOnIce')}")
    print(f"  toi: {p.get('toi')}")

