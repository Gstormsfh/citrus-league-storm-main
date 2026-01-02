#!/usr/bin/env python3
"""Verify that defensemen stats are now populated after scraper fix"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from datetime import date, timedelta

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("DEFENSEMEN STATS VERIFICATION (After Scraper Fix)")
print("=" * 80)
print()

# Get current week dates (or use week 2 dates)
week_end = date.today()
week_start = week_end - timedelta(days=6)

print(f"Checking week: {week_start} to {week_end}")
print()

# 1. Check Kris Letang specifically
print("1. Checking Kris Letang (8471724)...")
letang_stats = db.select("player_game_stats",
                        "game_id, game_date, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, nhl_hits, nhl_ppp, nhl_shp, nhl_pim, updated_at",
                        filters=[("player_id", "eq", 8471724),
                                ("game_date", "gte", week_start.isoformat()),
                                ("game_date", "lte", week_end.isoformat())],
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
    
    # Show sample games
    print("\n   Sample games:")
    for stat in letang_stats[:3]:
        print(f"     Game {stat['game_id']} ({stat.get('game_date', 'N/A')}): G={stat.get('nhl_goals', 0)}, A={stat.get('nhl_assists', 0)}, SOG={stat.get('nhl_shots_on_goal', 0)}")
else:
    print("   [WARN] No records found for Kris Letang in this week")

# 2. Check all defensemen vs forwards
print("\n2. Comparing defensemen vs forwards stats...")
dmen_stats = db.select("player_game_stats",
                      "player_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks",
                      filters=[("game_date", "gte", week_start.isoformat()),
                              ("game_date", "lte", week_end.isoformat()),
                              ("is_goalie", "eq", False)],
                      limit=1000)

# Join with player_directory to get positions
dmen_with_pos = []
for stat in dmen_stats:
    player_dir = db.select("player_directory",
                          "position_code",
                          filters=[("player_id", "eq", stat['player_id']), ("season", "eq", 2025)],
                          limit=1)
    if player_dir:
        stat['position_code'] = player_dir[0].get('position_code')
        dmen_with_pos.append(stat)

# Aggregate by position
position_totals = {}
for stat in dmen_with_pos:
    pos = stat.get('position_code', 'UNKNOWN')
    if pos not in position_totals:
        position_totals[pos] = {'goals': 0, 'assists': 0, 'sog': 0, 'blocks': 0, 'count': 0}
    position_totals[pos]['goals'] += stat.get('nhl_goals', 0)
    position_totals[pos]['assists'] += stat.get('nhl_assists', 0)
    position_totals[pos]['sog'] += stat.get('nhl_shots_on_goal', 0)
    position_totals[pos]['blocks'] += stat.get('nhl_blocks', 0)
    position_totals[pos]['count'] += 1

print("   Position totals:")
for pos in sorted(position_totals.keys()):
    totals = position_totals[pos]
    print(f"     {pos}: {totals['count']} records, G={totals['goals']}, A={totals['assists']}, SOG={totals['sog']}, Blk={totals['blocks']}")

# 3. Test the RPC with Kris Letang
print("\n3. Testing get_matchup_stats RPC with Kris Letang...")
# We can't directly call the RPC from Python easily, but we can simulate it
print("   (RPC test would require Supabase client - check in SQL editor)")
print("   Run: SELECT * FROM get_matchup_stats(ARRAY[8471724]::int[], '2025-12-15'::date, '2025-12-21'::date);")

# 4. Summary
print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
if position_totals.get('D', {}).get('goals', 0) > 0 or position_totals.get('D', {}).get('sog', 0) > 0:
    print("[OK] Defensemen now have stats populated!")
    print(f"     Defensemen totals: G={position_totals.get('D', {}).get('goals', 0)}, SOG={position_totals.get('D', {}).get('sog', 0)}")
else:
    print("[WARN] Defensemen still showing zeros")
    print("       Check if scraper ran successfully and updated records")

print()
print("Next steps:")
print("  1. Check matchup tabs in frontend - defensemen should now show stats")
print("  2. Verify RPC returns non-zero stats for defensemen")
print("  3. If still zeros, check scraper logs for errors")

