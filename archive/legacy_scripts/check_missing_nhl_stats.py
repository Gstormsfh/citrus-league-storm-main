#!/usr/bin/env python3
"""Check if NHL API has boxscore data for games missing NHL stats"""
import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("CHECKING MISSING NHL STATS FOR MCDAVID")
print("=" * 80)

MCDAVID_ID = 8478402

# Get games with PBP PPP but no NHL PPP
game_stats = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_ppp,nhl_ppg,nhl_ppa,ppp",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID), ("ppp", "gt", 0)],
    limit=25
)

missing_nhl = [g for g in game_stats if g.get('nhl_ppp', 0) == 0]

print(f"\nGames with PBP PPP but no NHL PPP: {len(missing_nhl)}")
print("\nChecking NHL API for these games...")

found_count = 0
missing_count = 0

for game in missing_nhl[:5]:  # Check first 5
    game_id = game.get('game_id')
    game_date = game.get('game_date')
    pbp_ppp = game.get('ppp', 0)
    
    print(f"\n  Game {game_id} ({game_date}): PBP PPP={pbp_ppp}")
    
    try:
        url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            data = r.json()
            player_stats = data.get('playerByGameStats', {})
            
            mcdavid_found = False
            for team_key in ['homeTeam', 'awayTeam']:
                team = player_stats.get(team_key, {})
                for player in (team.get('forwards', []) + team.get('defense', [])):
                    if player.get('playerId') == MCDAVID_ID:
                        mcdavid_found = True
                        ppg = player.get('powerPlayGoals', 0)
                        ppa = player.get('powerPlayAssists', 0)
                        calc_ppp = ppg + ppa
                        print(f"    ✅ NHL API has data: PPG={ppg}, PPA={ppa}, PPP={calc_ppp}")
                        print(f"    ⚠️  PBP shows {pbp_ppp} PPP, but NHL API shows {calc_ppp}")
                        if calc_ppp > 0:
                            found_count += 1
                        else:
                            print(f"    ⚠️  NHL API shows 0 PPP - possible discrepancy with PBP")
                        break
                if mcdavid_found:
                    break
            
            if not mcdavid_found:
                print(f"    ❌ McDavid not found in NHL API boxscore")
                missing_count += 1
        else:
            print(f"    ❌ NHL API returned status {r.status_code}")
            missing_count += 1
    except Exception as e:
        print(f"    ❌ Error: {e}")
        missing_count += 1

print("\n" + "=" * 80)
print("SUMMARY:")
print("=" * 80)
print(f"  Games checked: 5")
print(f"  Games with NHL data: {found_count}")
print(f"  Games missing NHL data: {missing_count}")
print("\n  NOTE: The NHL API boxscore provides:")
print("    - powerPlayAssists: TOTAL assists (primary + secondary combined)")
print("    - We calculate: PPP = powerPlayGoals + powerPlayAssists")
print("    - This is the official NHL.com calculation")
print("=" * 80)

