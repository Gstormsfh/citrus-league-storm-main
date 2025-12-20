#!/usr/bin/env python3
"""Check McDavid's detailed stats."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

MCDAVID_ID = 8478402

print("=" * 70)
print(f"McDavid (8478402) Detailed Stats Check")
print("=" * 70)

# Get all game stats
all_games = []
offset = 0
while True:
  page = db.select("player_game_stats", filters=[("player_id", "eq", MCDAVID_ID)], limit=1000, offset=offset)
  if not page:
    break
  all_games.extend(page)
  if len(page) < 1000:
    break
  offset += 1000

print(f"\nTotal games in player_game_stats: {len(all_games)}")

if all_games:
  # Sum up totals
  total_g = sum(g.get("goals", 0) for g in all_games)
  total_a = sum(g.get("primary_assists", 0) + g.get("secondary_assists", 0) for g in all_games)
  total_pts = sum(g.get("points", 0) for g in all_games)
  total_sog = sum(g.get("shots_on_goal", 0) for g in all_games)
  total_pim = sum(g.get("pim", 0) for g in all_games)
  total_ppp = sum(g.get("ppp", 0) for g in all_games)
  total_shp = sum(g.get("shp", 0) for g in all_games)
  total_toi = sum(g.get("icetime_seconds", 0) for g in all_games)
  
  print(f"\nGame-level totals:")
  print(f"  G: {total_g}, A: {total_a}, PTS: {total_pts}")
  print(f"  SOG: {total_sog}, PIM: {total_pim}, PPP: {total_ppp}, SHP: {total_shp}")
  print(f"  TOI: {total_toi}s ({total_toi//60} minutes)")
  
  # Check games with PIM
  games_with_pim = [g for g in all_games if g.get("pim", 0) > 0]
  print(f"\nGames with PIM > 0: {len(games_with_pim)}")
  if games_with_pim:
    print(f"  Sample: Game {games_with_pim[0].get('game_id')} - PIM: {games_with_pim[0].get('pim', 0)}")
  
  # Check games with PPP
  games_with_ppp = [g for g in all_games if g.get("ppp", 0) > 0]
  print(f"\nGames with PPP > 0: {len(games_with_ppp)}")
  if games_with_ppp:
    print(f"  Sample: Game {games_with_ppp[0].get('game_id')} - PPP: {games_with_ppp[0].get('ppp', 0)}")

# Get season stats
season = db.select("player_season_stats", filters=[("player_id", "eq", MCDAVID_ID)], limit=1)
if season:
  s = season[0]
  print(f"\nSeason stats (player_season_stats):")
  print(f"  GP: {s.get('games_played', 0)}, G: {s.get('goals', 0)}, A: {s.get('primary_assists', 0) + s.get('secondary_assists', 0)}, PTS: {s.get('points', 0)}")
  print(f"  SOG: {s.get('shots_on_goal', 0)}, PIM: {s.get('pim', 0)}, PPP: {s.get('ppp', 0)}, SHP: {s.get('shp', 0)}")
  print(f"  +/-: {s.get('plus_minus', 0)}, TOI: {s.get('icetime_seconds', 0)}s")

print("=" * 70)


