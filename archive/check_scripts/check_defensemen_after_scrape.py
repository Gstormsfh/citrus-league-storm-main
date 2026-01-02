#!/usr/bin/env python3
"""Check defensemen stats after scraper run"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("DEFENSEMEN STATS CHECK (After Week 2 Scrape)")
print("=" * 80)
print()

# Check week 2 dates
week_start = "2025-12-15"
week_end = "2025-12-21"

# 1. Check Kris Letang specifically
print("1. Checking Kris Letang (8471724) for week 2...")
letang_stats = db.select("player_game_stats",
                        "game_id, game_date, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, nhl_hits, nhl_ppp, nhl_shp, nhl_pim, updated_at",
                        filters=[("player_id", "eq", 8471724),
                                ("game_date", "gte", week_start),
                                ("game_date", "lte", week_end)],
                        limit=10)

if letang_stats:
    print(f"   Found {len(letang_stats)} game records")
    total_goals = sum(s.get('nhl_goals', 0) for s in letang_stats)
    total_assists = sum(s.get('nhl_assists', 0) for s in letang_stats)
    total_sog = sum(s.get('nhl_shots_on_goal', 0) for s in letang_stats)
    total_blocks = sum(s.get('nhl_blocks', 0) for s in letang_stats)
    total_hits = sum(s.get('nhl_hits', 0) for s in letang_stats)
    
    print(f"   Total stats: G={total_goals}, A={total_assists}, SOG={total_sog}, Blk={total_blocks}, Hits={total_hits}")
    
    if total_goals > 0 or total_assists > 0 or total_sog > 0 or total_blocks > 0:
        print("   [OK] Kris Letang has stats populated!")
    else:
        print("   [WARN] Kris Letang still has all zeros")
    
    # Show sample games with recent updates
    print("\n   Recent games (checking updated_at):")
    for stat in letang_stats[:5]:
        updated = stat.get('updated_at', 'N/A')
        print(f"     Game {stat['game_id']} ({stat.get('game_date', 'N/A')}): G={stat.get('nhl_goals', 0)}, A={stat.get('nhl_assists', 0)}, SOG={stat.get('nhl_shots_on_goal', 0)}, Updated={updated}")
else:
    print("   [WARN] No records found for Kris Letang in week 2")

# 2. Check all defensemen vs forwards for week 2
print("\n2. Comparing defensemen vs forwards stats for week 2...")
all_stats = db.select("player_game_stats",
                     "player_id, game_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie",
                     filters=[("game_date", "gte", week_start),
                             ("game_date", "lte", week_end),
                             ("is_goalie", "eq", False)],
                     limit=2000)

# Get positions
stats_with_pos = []
for stat in all_stats:
    player_dir = db.select("player_directory",
                          "position_code",
                          filters=[("player_id", "eq", stat['player_id']), ("season", "eq", 2025)],
                          limit=1)
    if player_dir:
        stat['position_code'] = player_dir[0].get('position_code')
        stats_with_pos.append(stat)

# Aggregate by position
position_totals = {}
for stat in stats_with_pos:
    pos = stat.get('position_code', 'UNKNOWN')
    if pos not in position_totals:
        position_totals[pos] = {'goals': 0, 'assists': 0, 'sog': 0, 'blocks': 0, 'count': 0, 'with_stats': 0}
    position_totals[pos]['goals'] += stat.get('nhl_goals', 0)
    position_totals[pos]['assists'] += stat.get('nhl_assists', 0)
    position_totals[pos]['sog'] += stat.get('nhl_shots_on_goal', 0)
    position_totals[pos]['blocks'] += stat.get('nhl_blocks', 0)
    position_totals[pos]['count'] += 1
    if stat.get('nhl_goals', 0) > 0 or stat.get('nhl_shots_on_goal', 0) > 0:
        position_totals[pos]['with_stats'] += 1

print("   Position totals for week 2:")
for pos in sorted(position_totals.keys()):
    totals = position_totals[pos]
    pct_with_stats = (totals['with_stats'] / totals['count'] * 100) if totals['count'] > 0 else 0
    print(f"     {pos}: {totals['count']} records, {totals['with_stats']} with stats ({pct_with_stats:.1f}%)")
    print(f"          G={totals['goals']}, A={totals['assists']}, SOG={totals['sog']}, Blk={totals['blocks']}")

# 3. Check a specific game we tested (2025020515)
print("\n3. Checking game 2025020515 (the one we tested)...")
game_stats = db.select("player_game_stats",
                      "player_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie, updated_at",
                      filters=[("game_id", "eq", 2025020515)],
                      limit=50)

dmen_in_game = []
for stat in game_stats:
    if stat.get('is_goalie', False):
        continue
    player_dir = db.select("player_directory",
                          "position_code",
                          filters=[("player_id", "eq", stat['player_id']), ("season", "eq", 2025)],
                          limit=1)
    if player_dir and player_dir[0].get('position_code') == 'D':
        dmen_in_game.append(stat)

print(f"   Defensemen in game: {len(dmen_in_game)}")
dmen_with_stats = [d for d in dmen_in_game if d.get('nhl_goals', 0) > 0 or d.get('nhl_shots_on_goal', 0) > 0]
print(f"   Defensemen with stats > 0: {len(dmen_with_stats)}")
if dmen_with_stats:
    print("   Sample defensemen with stats:")
    for d in dmen_with_stats[:3]:
        print(f"     Player {d['player_id']}: G={d.get('nhl_goals', 0)}, A={d.get('nhl_assists', 0)}, SOG={d.get('nhl_shots_on_goal', 0)}")

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
dmen_total = position_totals.get('D', {})
if dmen_total.get('sog', 0) > 0 or dmen_total.get('goals', 0) > 0:
    print("[OK] Defensemen now have stats populated!")
    print(f"     Defensemen: {dmen_total.get('count', 0)} records, {dmen_total.get('with_stats', 0)} with stats")
    print(f"     Total: G={dmen_total.get('goals', 0)}, SOG={dmen_total.get('sog', 0)}")
else:
    print("[WARN] Defensemen still showing zeros")
    print("       This suggests the scraper fix may not be working, or games haven't been played yet")

