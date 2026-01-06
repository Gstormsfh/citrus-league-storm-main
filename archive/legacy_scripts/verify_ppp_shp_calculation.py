#!/usr/bin/env python3
"""Verify PPP/SHP calculation includes all assists correctly"""
import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("VERIFYING PPP/SHP CALCULATION")
print("=" * 80)

MCDAVID_ID = 8478402

# Check a recent game with PPP from NHL API
print("\n1. CHECKING NHL API BOXSCORE FOR MCDAVID:")
print("-" * 80)

# Get a recent game where McDavid had PPP
game_stats = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_ppp,nhl_ppg,nhl_ppa,nhl_shp,nhl_shg,nhl_sha",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID), ("nhl_ppp", "gt", 0)],
    limit=5
)

if game_stats:
    test_game = game_stats[0]
    game_id = test_game.get('game_id')
    print(f"  Checking game {game_id} ({test_game.get('game_date')})")
    print(f"  Database: nhl_ppp={test_game.get('nhl_ppp', 0)}, nhl_ppg={test_game.get('nhl_ppg', 0)}, nhl_ppa={test_game.get('nhl_ppa', 0)}")
    
    try:
        url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            data = r.json()
            player_stats = data.get('playerByGameStats', {})
            for team_key in ['homeTeam', 'awayTeam']:
                team = player_stats.get(team_key, {})
                for player in (team.get('forwards', []) + team.get('defense', [])):
                    if player.get('playerId') == MCDAVID_ID:
                        print(f"\n  NHL API Boxscore for McDavid:")
                        print(f"    powerPlayGoals: {player.get('powerPlayGoals', 0)}")
                        print(f"    powerPlayAssists: {player.get('powerPlayAssists', 0)}")
                        print(f"    shorthandedGoals: {player.get('shorthandedGoals', 0)}")
                        print(f"    shorthandedAssists: {player.get('shorthandedAssists', 0)}")
                        print(f"\n  Calculated:")
                        ppg = player.get('powerPlayGoals', 0)
                        ppa = player.get('powerPlayAssists', 0)
                        shg = player.get('shorthandedGoals', 0)
                        sha = player.get('shorthandedAssists', 0)
                        calc_ppp = ppg + ppa
                        calc_shp = shg + sha
                        print(f"    PPP = {ppg} (goals) + {ppa} (assists) = {calc_ppp}")
                        print(f"    SHP = {shg} (goals) + {sha} (assists) = {calc_shp}")
                        print(f"\n  Database vs API:")
                        print(f"    PPP: DB={test_game.get('nhl_ppp', 0)}, API={calc_ppp}, Match={test_game.get('nhl_ppp', 0) == calc_ppp}")
                        print(f"    SHP: DB={test_game.get('nhl_shp', 0)}, API={calc_shp}, Match={test_game.get('nhl_shp', 0) == calc_shp}")
                        break
    except Exception as e:
        print(f"  Error: {e}")

# Check season totals
print("\n2. CHECKING SEASON TOTALS:")
print("-" * 80)
season_stats = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=1
)

game_totals = db.select(
    "player_game_stats",
    select="nhl_ppp,nhl_shp,nhl_ppg,nhl_ppa,nhl_shg,nhl_sha",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=100
)

if season_stats and game_totals:
    s = season_stats[0]
    total_ppp = sum(g.get('nhl_ppp', 0) for g in game_totals)
    total_shp = sum(g.get('nhl_shp', 0) for g in game_totals)
    total_ppg = sum(g.get('nhl_ppg', 0) for g in game_totals)
    total_ppa = sum(g.get('nhl_ppa', 0) for g in game_totals)
    total_shg = sum(g.get('nhl_shg', 0) for g in game_totals)
    total_sha = sum(g.get('nhl_sha', 0) for g in game_totals)
    
    print(f"  Season stats (player_season_stats):")
    print(f"    nhl_ppp={s.get('nhl_ppp', 0)}")
    print(f"    nhl_shp={s.get('nhl_shp', 0)}")
    print(f"\n  Sum of all games (player_game_stats):")
    print(f"    Total nhl_ppp={total_ppp}")
    print(f"    Total nhl_shp={total_shp}")
    print(f"    Total nhl_ppg={total_ppg}")
    print(f"    Total nhl_ppa={total_ppa}")
    print(f"    Total nhl_shg={total_shg}")
    print(f"    Total nhl_sha={total_sha}")
    print(f"\n  Verification:")
    print(f"    PPP = PPG + PPA = {total_ppg} + {total_ppa} = {total_ppg + total_ppa}")
    print(f"    SHP = SHG + SHA = {total_shg} + {total_sha} = {total_shg + total_sha}")
    print(f"\n  Match check:")
    print(f"    Season PPP matches sum: {s.get('nhl_ppp', 0) == total_ppp}")
    print(f"    Season SHP matches sum: {s.get('nhl_shp', 0) == total_shp}")

print("\n" + "=" * 80)
print("NOTE:")
print("=" * 80)
print("  The NHL API boxscore provides:")
print("    - powerPlayAssists: Total assists on power play goals (includes both primary and secondary)")
print("    - shorthandedAssists: Total assists on shorthanded goals (includes both primary and secondary)")
print("  We don't need to separate primary/secondary for PPP/SHP calculation.")
print("  The calculation: PPP = PPG + PPA, SHP = SHG + SHA is correct.")
print("=" * 80)

