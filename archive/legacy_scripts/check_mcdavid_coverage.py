#!/usr/bin/env python3
"""Check how many of McDavid's games have NHL boxscore stats"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("CHECKING MCDAVID GAME COVERAGE")
print("=" * 80)

MCDAVID_ID = 8478402

# Get all games
game_stats = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_ppp,nhl_shp,nhl_ppg,nhl_ppa,nhl_shg,nhl_sha,ppp,shp",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=100
)

print(f"\nTotal games in database: {len(game_stats)}")

# Count games with NHL stats vs PBP stats
games_with_nhl_ppp = [g for g in game_stats if g.get('nhl_ppp', 0) > 0]
games_with_pbp_ppp = [g for g in game_stats if g.get('ppp', 0) > 0]
games_with_nhl_shp = [g for g in game_stats if g.get('nhl_shp', 0) > 0]
games_with_pbp_shp = [g for g in game_stats if g.get('shp', 0) > 0]

print(f"\nGames with nhl_ppp > 0: {len(games_with_nhl_ppp)}")
print(f"Games with pbp_ppp > 0: {len(games_with_pbp_ppp)}")
print(f"Games with nhl_shp > 0: {len(games_with_nhl_shp)}")
print(f"Games with pbp_shp > 0: {len(games_with_pbp_shp)}")

# Show breakdown
print("\nGames with NHL PPP:")
for g in games_with_nhl_ppp[:10]:
    print(f"  Game {g.get('game_id')} ({g.get('game_date')}): nhl_ppp={g.get('nhl_ppp', 0)}, pbp_ppp={g.get('ppp', 0)}")

print("\nGames with PBP PPP but no NHL PPP:")
missing_nhl = [g for g in game_stats if g.get('ppp', 0) > 0 and g.get('nhl_ppp', 0) == 0]
print(f"  Count: {len(missing_nhl)}")
for g in missing_nhl[:10]:
    print(f"  Game {g.get('game_id')} ({g.get('game_date')}): pbp_ppp={g.get('ppp', 0)}, nhl_ppp={g.get('nhl_ppp', 0)}")

print("\n" + "=" * 80)
print("DIAGNOSIS:")
print("=" * 80)
if len(games_with_pbp_ppp) > len(games_with_nhl_ppp):
    print(f"  ⚠️  ISSUE: {len(games_with_pbp_ppp) - len(games_with_nhl_ppp)} games have PBP PPP but NO NHL PPP")
    print("  This means scrape_per_game_nhl_stats.py hasn't processed these games yet")
    print("  OR the NHL API boxscore doesn't have the data")
    print("\n  SOLUTION: Run scrape_per_game_nhl_stats.py to backfill missing games")
else:
    print("  ✅ All games with PBP stats also have NHL stats")
print("=" * 80)

