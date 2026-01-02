#!/usr/bin/env python3
"""Final verification that defensemen stats are populated after full season scrape"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from datetime import date

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("FINAL DEFENSEMEN STATS VERIFICATION")
print("=" * 80)
print()

# 1. Check Kris Letang specifically (the example we used)
print("1. Checking Kris Letang (8471724)...")
letang_stats = db.select("player_game_stats",
                        "game_id, game_date, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, nhl_hits, nhl_ppp, nhl_shp, nhl_pim, updated_at",
                        filters=[("player_id", "eq", 8471724),
                                ("season", "eq", 2025)],
                        limit=100)

if letang_stats:
    print(f"   Found {len(letang_stats)} game records")
    
    # Filter to games with stats
    games_with_stats = [s for s in letang_stats if s.get('nhl_goals', 0) > 0 or s.get('nhl_shots_on_goal', 0) > 0 or s.get('nhl_assists', 0) > 0]
    print(f"   Games with stats > 0: {len(games_with_stats)}")
    
    total_goals = sum(s.get('nhl_goals', 0) for s in letang_stats)
    total_assists = sum(s.get('nhl_assists', 0) for s in letang_stats)
    total_sog = sum(s.get('nhl_shots_on_goal', 0) for s in letang_stats)
    total_blocks = sum(s.get('nhl_blocks', 0) for s in letang_stats)
    total_hits = sum(s.get('nhl_hits', 0) for s in letang_stats)
    total_ppp = sum(s.get('nhl_ppp', 0) for s in letang_stats)
    total_shp = sum(s.get('nhl_shp', 0) for s in letang_stats)
    
    print(f"   Season totals: G={total_goals}, A={total_assists}, SOG={total_sog}, Blk={total_blocks}, Hits={total_hits}, PPP={total_ppp}, SHP={total_shp}")
    
    if total_goals > 0 or total_assists > 0 or total_sog > 0 or total_blocks > 0:
        print("   [OK] Kris Letang has stats populated!")
    else:
        print("   [WARN] Kris Letang still has all zeros")
    
    # Show sample games with stats
    if games_with_stats:
        print("\n   Sample games with stats:")
        for stat in games_with_stats[:5]:
            print(f"     Game {stat['game_id']} ({stat.get('game_date', 'N/A')}): G={stat.get('nhl_goals', 0)}, A={stat.get('nhl_assists', 0)}, SOG={stat.get('nhl_shots_on_goal', 0)}, Blk={stat.get('nhl_blocks', 0)}")
else:
    print("   [WARN] No records found for Kris Letang")

# 2. Check all defensemen vs forwards for the season
print("\n2. Comparing defensemen vs forwards stats for entire season...")
all_stats = db.select("player_game_stats",
                     "player_id, game_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie",
                     filters=[("season", "eq", 2025),
                             ("is_goalie", "eq", False)],
                     limit=10000)

print(f"   Found {len(all_stats)} skater records")

# Get positions (sample first 2000 to avoid too many queries)
stats_with_pos = []
for i, stat in enumerate(all_stats[:2000]):
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

print("\n   Position totals (sample of 2000 records):")
for pos in sorted(position_totals.keys()):
    totals = position_totals[pos]
    pct_with_stats = (totals['with_stats'] / totals['count'] * 100) if totals['count'] > 0 else 0
    print(f"     {pos}: {totals['count']} records, {totals['with_stats']} with stats ({pct_with_stats:.1f}%)")
    print(f"          G={totals['goals']}, A={totals['assists']}, SOG={totals['sog']}, Blk={totals['blocks']}")

# 3. Check specific game we tested (2025020515)
print("\n3. Checking game 2025020515 (the one we tested earlier)...")
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
    for d in dmen_with_stats[:5]:
        print(f"     Player {d['player_id']}: G={d.get('nhl_goals', 0)}, A={d.get('nhl_assists', 0)}, SOG={d.get('nhl_shots_on_goal', 0)}, Blk={d.get('nhl_blocks', 0)}")

# 4. Check week 2 specifically (where the issue was reported)
print("\n4. Checking Week 2 (Dec 15-21) specifically...")
week2_stats = db.select("player_game_stats",
                       "player_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie",
                       filters=[("game_date", "gte", "2025-12-15"),
                               ("game_date", "lte", "2025-12-21"),
                               ("is_goalie", "eq", False)],
                       limit=2000)

week2_dmen = []
for stat in week2_stats:
    player_dir = db.select("player_directory",
                          "position_code",
                          filters=[("player_id", "eq", stat['player_id']), ("season", "eq", 2025)],
                          limit=1)
    if player_dir and player_dir[0].get('position_code') == 'D':
        week2_dmen.append(stat)

week2_dmen_with_stats = [d for d in week2_dmen if d.get('nhl_goals', 0) > 0 or d.get('nhl_shots_on_goal', 0) > 0]
print(f"   Week 2 defensemen: {len(week2_dmen)} records, {len(week2_dmen_with_stats)} with stats")
if week2_dmen_with_stats:
    total_g = sum(d.get('nhl_goals', 0) for d in week2_dmen)
    total_sog = sum(d.get('nhl_shots_on_goal', 0) for d in week2_dmen)
    print(f"   Week 2 totals: G={total_g}, SOG={total_sog}")

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
dmen_total = position_totals.get('D', {})
if dmen_total.get('sog', 0) > 0 or dmen_total.get('goals', 0) > 0:
    print("[SUCCESS] Defensemen now have stats populated!")
    print(f"     Defensemen: {dmen_total.get('count', 0)} records, {dmen_total.get('with_stats', 0)} with stats ({dmen_total.get('with_stats', 0)/dmen_total.get('count', 1)*100:.1f}%)")
    print(f"     Total: G={dmen_total.get('goals', 0)}, A={dmen_total.get('assists', 0)}, SOG={dmen_total.get('sog', 0)}, Blk={dmen_total.get('blocks', 0)}")
    print()
    print("Next steps:")
    print("  1. Check matchup tabs in frontend - defensemen should now show stats")
    print("  2. Verify RPC returns non-zero stats for defensemen")
    print("  3. Test with a specific matchup to confirm end-to-end")
else:
    print("[WARN] Defensemen still showing zeros")
    print("       This suggests the scraper may not have run successfully")

