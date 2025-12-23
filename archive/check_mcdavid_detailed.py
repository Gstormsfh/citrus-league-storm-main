#!/usr/bin/env python3
"""Detailed check of McDavid's stats to find discrepancies"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import defaultdict

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
MCDAVID_ID = 8478402

# Get all game stats
print("Fetching all game stats for McDavid...")
all_games = []
offset = 0
batch_size = 1000

while True:
    games = db.select(
        "player_game_stats",
        select="game_id,goals,primary_assists,secondary_assists,ppp,shp,icetime_seconds,plus_minus,game_date",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)],
        limit=batch_size,
        offset=offset
    )
    if not games:
        break
    all_games.extend(games)
    if len(games) < batch_size:
        break
    offset += batch_size

print(f"Found {len(all_games)} game stat entries\n")

# Check for duplicates
game_counts = defaultdict(int)
for g in all_games:
    game_counts[g.get("game_id")] += 1

duplicates = {gid: count for gid, count in game_counts.items() if count > 1}
if duplicates:
    print(f"WARNING: Found duplicate game entries: {duplicates}\n")

# Sum all stats
total_ppp = sum(g.get("ppp") or 0 for g in all_games)
total_shp = sum(g.get("shp") or 0 for g in all_games)
total_toi = sum(g.get("icetime_seconds") or 0 for g in all_games)
total_goals = sum(g.get("goals") or 0 for g in all_games)
total_primary_a = sum(g.get("primary_assists") or 0 for g in all_games)
total_secondary_a = sum(g.get("secondary_assists") or 0 for g in all_games)
total_assists = total_primary_a + total_secondary_a

print("Sum from player_game_stats:")
print(f"  Games: {len(all_games)}")
print(f"  Goals: {total_goals}")
print(f"  Assists: {total_assists} (Primary: {total_primary_a}, Secondary: {total_secondary_a})")
print(f"  PPP: {total_ppp}")
print(f"  SHP: {total_shp}")
print(f"  TOI: {total_toi} seconds ({total_toi // 60} minutes)")

# Get season stats
season_stats = db.select(
    "player_season_stats",
    select="*",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)],
    limit=1
)

if season_stats:
    s = season_stats[0]
    print("\nplayer_season_stats (aggregated):")
    print(f"  Games: {s.get('games_played')}")
    print(f"  Goals: {s.get('goals')}")
    primary_a = s.get('primary_assists', 0) or 0
    secondary_a = s.get('secondary_assists', 0) or 0
    print(f"  Assists: {primary_a + secondary_a} (Primary: {primary_a}, Secondary: {secondary_a})")
    print(f"  PPP: {s.get('ppp')}")
    print(f"  SHP: {s.get('shp')}")
    print(f"  TOI: {s.get('icetime_seconds')} seconds ({s.get('icetime_seconds', 0) // 60} minutes)")
    print(f"  Plus/Minus: {s.get('plus_minus')}")
    print(f"  Updated: {s.get('updated_at')}")
    
    # Compare
    print("\nDiscrepancies:")
    if total_ppp != s.get('ppp'):
        print(f"  PPP: Game stats sum={total_ppp}, Season stats={s.get('ppp')} (diff: {total_ppp - s.get('ppp')})")
    if total_shp != s.get('shp'):
        print(f"  SHP: Game stats sum={total_shp}, Season stats={s.get('shp')} (diff: {total_shp - s.get('shp')})")
    if total_goals != s.get('goals'):
        print(f"  Goals: Game stats sum={total_goals}, Season stats={s.get('goals')} (diff: {total_goals - s.get('goals')})")
    if total_assists != (primary_a + secondary_a):
        print(f"  Assists: Game stats sum={total_assists}, Season stats={primary_a + secondary_a} (diff: {total_assists - (primary_a + secondary_a)})")
    if total_toi != s.get('icetime_seconds'):
        print(f"  TOI: Game stats sum={total_toi}, Season stats={s.get('icetime_seconds')} (diff: {total_toi - s.get('icetime_seconds')})")
    if len(all_games) != s.get('games_played'):
        print(f"  Games: Game stats count={len(all_games)}, Season stats={s.get('games_played')} (diff: {len(all_games) - s.get('games_played')})")

# Show games with PPP or SHP
print("\nGames with PPP or SHP:")
ppp_shp_games = [g for g in all_games if (g.get("ppp") or 0) > 0 or (g.get("shp") or 0) > 0]
for g in sorted(ppp_shp_games, key=lambda x: x.get("game_id")):
    print(f"  Game {g.get('game_id')} ({g.get('game_date')}): PPP={g.get('ppp')} SHP={g.get('shp')}")
