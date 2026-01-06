#!/usr/bin/env python3
"""Check Connor McDavid's actual stats from NHL API vs database"""
import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("CHECKING CONNOR MCDAVID STATS")
print("=" * 80)

# McDavid's player ID
MCDAVID_ID = 8478402

# 1. Check database
print("\n1. DATABASE (player_season_stats):")
print("-" * 80)
stats = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp,ppp,shp",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=1
)
if stats:
    s = stats[0]
    print(f"  nhl_ppp={s.get('nhl_ppp', 0)}")
    print(f"  nhl_shp={s.get('nhl_shp', 0)}")
    print(f"  pbp_ppp={s.get('ppp', 0)}")
    print(f"  pbp_shp={s.get('shp', 0)}")
else:
    print("  No stats found in database")

# 2. Check player_game_stats
print("\n2. DATABASE (player_game_stats - per game breakdown):")
print("-" * 80)
game_stats = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_ppp,nhl_shp,nhl_ppg,nhl_ppa,nhl_shg,nhl_sha",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=50
)
print(f"  Total games: {len(game_stats)}")
ppp_total = sum(s.get('nhl_ppp', 0) for s in game_stats)
shp_total = sum(s.get('nhl_shp', 0) for s in game_stats)
ppg_total = sum(s.get('nhl_ppg', 0) for s in game_stats)
ppa_total = sum(s.get('nhl_ppa', 0) for s in game_stats)
shg_total = sum(s.get('nhl_shg', 0) for s in game_stats)
sha_total = sum(s.get('nhl_sha', 0) for s in game_stats)
print(f"  Sum of nhl_ppp across games: {ppp_total}")
print(f"  Sum of nhl_shp across games: {shp_total}")
print(f"  Sum of nhl_ppg: {ppg_total}")
print(f"  Sum of nhl_ppa: {ppa_total}")
print(f"  Sum of nhl_shg: {shg_total}")
print(f"  Sum of nhl_sha: {sha_total}")
print(f"  Calculated PPP (ppg+ppa): {ppg_total + ppa_total}")
print(f"  Calculated SHP (shg+sha): {shg_total + sha_total}")

# 3. Check a recent game from NHL API
print("\n3. NHL API (checking recent game):")
print("-" * 80)
if game_stats:
    recent_game = game_stats[0]
    game_id = recent_game.get('game_id')
    print(f"  Checking game {game_id}...")
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
                        print(f"  Found McDavid in {team_key}:")
                        print(f"    powerPlayGoals: {player.get('powerPlayGoals', 0)}")
                        print(f"    powerPlayAssists: {player.get('powerPlayAssists', 0)}")
                        print(f"    shorthandedGoals: {player.get('shorthandedGoals', 0)}")
                        print(f"    shorthandedAssists: {player.get('shorthandedAssists', 0)}")
                        print(f"    Calculated PPP: {player.get('powerPlayGoals', 0) + player.get('powerPlayAssists', 0)}")
                        print(f"    Calculated SHP: {player.get('shorthandedGoals', 0) + player.get('shorthandedAssists', 0)}")
                        break
    except Exception as e:
        print(f"  Error checking API: {e}")

# 4. Check if nhl_ppg/nhl_ppa are being aggregated
print("\n4. CHECKING AGGREGATION:")
print("-" * 80)
print("  build_player_season_stats.py should aggregate:")
print("    nhl_ppp += nhl_ppp from each game")
print("    nhl_shp += nhl_shp from each game")
print("  But it should ALSO aggregate:")
print("    nhl_ppg += nhl_ppg from each game")
print("    nhl_ppa += nhl_ppa from each game")
print("    nhl_shg += nhl_shg from each game")
print("    nhl_sha += nhl_sha from each game")
print("  Then verify: nhl_ppp == nhl_ppg + nhl_ppa")

print("\n" + "=" * 80)
print("SUMMARY:")
print("=" * 80)
if stats:
    s = stats[0]
    db_ppp = s.get('nhl_ppp', 0)
    db_shp = s.get('nhl_shp', 0)
    calc_ppp = ppg_total + ppa_total
    calc_shp = shg_total + sha_total
    print(f"  Database nhl_ppp: {db_ppp}")
    print(f"  Calculated (sum of games): {calc_ppp}")
    print(f"  Database nhl_shp: {db_shp}")
    print(f"  Calculated (sum of games): {calc_shp}")
    if db_ppp != calc_ppp:
        print(f"  ⚠️  MISMATCH: Database PPP ({db_ppp}) != Sum of games ({calc_ppp})")
    if db_shp != calc_shp:
        print(f"  ⚠️  MISMATCH: Database SHP ({db_shp}) != Sum of games ({calc_shp})")
print("=" * 80)

