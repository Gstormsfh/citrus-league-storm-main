#!/usr/bin/env python3
"""Comprehensive verification of all NHL stats"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

game_id = 2025020560  # The game we just tested

print("=" * 80)
print("COMPREHENSIVE STATS VERIFICATION")
print("=" * 80)
print(f"Game ID: {game_id}\n")

# Get all skaters from this game
players = db.select("player_game_stats", select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_pim,nhl_ppg,nhl_ppa,nhl_ppp,nhl_shg,nhl_sha,nhl_shp,is_goalie", filters=[("game_id", "eq", game_id), ("is_goalie", "eq", False)])

print(f"Total skaters: {len(players)}\n")

# Check each stat category
stats_to_check = {
    "Goals": "nhl_goals",
    "Assists": "nhl_assists", 
    "Points": "nhl_points",
    "SOG": "nhl_shots_on_goal",
    "Hits": "nhl_hits",
    "Blocks": "nhl_blocks",
    "PIM": "nhl_pim",
    "PPG": "nhl_ppg",
    "PPA": "nhl_ppa",
    "PPP": "nhl_ppp",
    "SHG": "nhl_shg",
    "SHA": "nhl_sha",
    "SHP": "nhl_shp"
}

print("STAT CATEGORY VERIFICATION:")
print("-" * 80)
for stat_name, stat_field in stats_to_check.items():
    players_with_stat = sum(1 for p in players if p.get(stat_field, 0) > 0)
    total_value = sum(p.get(stat_field, 0) for p in players)
    status = "[OK]" if players_with_stat > 0 or stat_name in ["SHG", "SHA", "SHP"] else "[--]"
    print(f"{status} {stat_name:10} - {players_with_stat:2} players, Total: {total_value:3}")

# Verify PPP calculation
print("\n" + "=" * 80)
print("PPP/SHP CALCULATION VERIFICATION:")
print("-" * 80)
ppp_issues = []
shp_issues = []
for p in players:
    ppg = p.get('nhl_ppg', 0)
    ppa = p.get('nhl_ppa', 0)
    ppp = p.get('nhl_ppp', 0)
    expected_ppp = ppg + ppa
    
    shg = p.get('nhl_shg', 0)
    sha = p.get('nhl_sha', 0)
    shp = p.get('nhl_shp', 0)
    expected_shp = shg + sha
    
    if (ppg > 0 or ppa > 0) and ppp != expected_ppp:
        ppp_issues.append(f"Player {p['player_id']}: PPG={ppg}, PPA={ppa}, PPP={ppp} (expected {expected_ppp})")
    
    if (shg > 0 or sha > 0) and shp != expected_shp:
        shp_issues.append(f"Player {p['player_id']}: SHG={shg}, SHA={sha}, SHP={shp} (expected {expected_shp})")

if ppp_issues:
    print("[WARN] PPP calculation issues:")
    for issue in ppp_issues:
        print(f"  {issue}")
else:
    print("[OK] PPP calculations correct (or no PP stats)")

if shp_issues:
    print("[WARN] SHP calculation issues:")
    for issue in shp_issues:
        print(f"  {issue}")
else:
    print("[OK] SHP calculations correct (or no SH stats)")

# Sample players with various stats
print("\n" + "=" * 80)
print("SAMPLE PLAYERS WITH STATS:")
print("-" * 80)
samples = []
for p in players:
    if any(p.get(field, 0) > 0 for field in ["nhl_goals", "nhl_assists", "nhl_shots_on_goal", "nhl_hits", "nhl_blocks", "nhl_ppg"]):
        samples.append(p)
    if len(samples) >= 5:
        break

for p in samples:
    print(f"\nPlayer {p['player_id']}:")
    print(f"  G: {p.get('nhl_goals', 0)}, A: {p.get('nhl_assists', 0)}, P: {p.get('nhl_points', 0)}")
    print(f"  SOG: {p.get('nhl_shots_on_goal', 0)}, Hits: {p.get('nhl_hits', 0)}, Blocks: {p.get('nhl_blocks', 0)}")
    print(f"  PPG: {p.get('nhl_ppg', 0)}, PPA: {p.get('nhl_ppa', 0)}, PPP: {p.get('nhl_ppp', 0)}")
    print(f"  SHG: {p.get('nhl_shg', 0)}, SHA: {p.get('nhl_sha', 0)}, SHP: {p.get('nhl_shp', 0)}")

print("\n" + "=" * 80)
print("VERIFICATION COMPLETE")
print("=" * 80)

