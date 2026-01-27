#!/usr/bin/env python3
"""
Audit McDavid Stats - Check actual database values
Player ID: 8478402
Season: 2025 (2025-2026 NHL season)
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
PLAYER_ID = 8478402
SEASON = 2025  # 2025-2026 season stored as 2025

print("=" * 80)
print("MCDAVID STATS AUDIT - 2025-2026 SEASON")
print("=" * 80)
print(f"Player ID: {PLAYER_ID}")
print(f"Season: {SEASON} (2025-2026 NHL season)")
print()

# 1. CHECK SEASON STATS (What we're displaying)
print("1. SEASON STATS (player_season_stats - what users see):")
print("-" * 80)
season_stats = db.select(
    "player_season_stats",
    select="player_id,season,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_ppp,nhl_shp,games_played,updated_at",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("season", "eq", SEASON)
    ],
    limit=1
)
if season_stats and len(season_stats) > 0:
    s = season_stats[0]
    print(f"   Goals: {s.get('nhl_goals', 0)}")
    print(f"   Assists: {s.get('nhl_assists', 0)}")
    print(f"   Points: {s.get('nhl_points', 0)}")
    print(f"   Shots: {s.get('nhl_shots_on_goal', 0)}")
    print(f"   PPP: {s.get('nhl_ppp', 0)}")
    print(f"   SHP: {s.get('nhl_shp', 0)}")
    print(f"   Games: {s.get('games_played', 0)}")
    print(f"   Updated: {s.get('updated_at', 'N/A')}")
else:
    print("   ❌ NO SEASON STATS FOUND!")
print()

# 2. SUM PER-GAME STATS (What we've scraped)
print("2. PER-GAME STATS SUM (player_game_stats - what we've scraped):")
print("-" * 80)
# Get all per-game stats
all_games = db.select(
    "player_game_stats",
    select="nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,game_id,game_date",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("season", "eq", SEASON),
        ("is_goalie", "eq", False)
    ],
    limit=10000  # Get all games
)

if all_games:
    total_goals = sum(int(g.get("nhl_goals", 0) or 0) for g in all_games)
    total_assists = sum(int(g.get("nhl_assists", 0) or 0) for g in all_games)
    total_points = sum(int(g.get("nhl_points", 0) or 0) for g in all_games)
    total_shots = sum(int(g.get("nhl_shots_on_goal", 0) or 0) for g in all_games)
    calculated_points = total_goals + total_assists
    game_count = len(all_games)
    
    print(f"   Total Goals (sum): {total_goals}")
    print(f"   Total Assists (sum): {total_assists}")
    print(f"   Total Points (sum of nhl_points): {total_points}")
    print(f"   Calculated Points (goals + assists): {calculated_points}")
    print(f"   Total Shots (sum): {total_shots}")
    print(f"   Games Count: {game_count}")
    
    if total_points != calculated_points:
        print(f"   ⚠️  WARNING: Points mismatch! Stored={total_points}, Calculated={calculated_points}")
else:
    print("   ❌ NO PER-GAME STATS FOUND!")
print()

# 3. COMPARE SEASON vs PER-GAME SUM
print("3. COMPARISON (Season Stats vs Per-Game Sum):")
print("-" * 80)
if season_stats and all_games:
    s = season_stats[0]
    season_goals = s.get("nhl_goals", 0)
    season_assists = s.get("nhl_assists", 0)
    season_points = s.get("nhl_points", 0)
    season_shots = s.get("nhl_shots_on_goal", 0)
    
    print(f"   Goals: Season={season_goals}, Per-Game Sum={total_goals}, Match={season_goals == total_goals}")
    print(f"   Assists: Season={season_assists}, Per-Game Sum={total_assists}, Match={season_assists == total_assists}")
    print(f"   Points: Season={season_points}, Per-Game Sum={total_points}, Match={season_points == total_points}")
    print(f"   Shots: Season={season_shots}, Per-Game Sum={total_shots}, Match={season_shots == total_shots}")
    
    if season_goals != total_goals:
        print(f"   ❌ GOALS MISMATCH: Season has {season_goals}, but per-game sum is {total_goals}")
    if season_points != total_points:
        print(f"   ❌ POINTS MISMATCH: Season has {season_points}, but per-game sum is {total_points}")
    if season_shots != total_shots:
        print(f"   ❌ SHOTS MISMATCH: Season has {season_shots}, but per-game sum is {total_shots}")
print()

# 4. CHECK FOR ZERO-STAT GAMES
print("4. ZERO-STAT GAMES (games with no goals, assists, or shots):")
print("-" * 80)
zero_games = [g for g in all_games if 
              (g.get("nhl_goals", 0) or 0) == 0 and 
              (g.get("nhl_assists", 0) or 0) == 0 and 
              (g.get("nhl_shots_on_goal", 0) or 0) == 0]
if zero_games:
    print(f"   Found {len(zero_games)} games with zero stats:")
    for g in zero_games[:10]:  # Show first 10
        print(f"     Game {g.get('game_id')} on {g.get('game_date')}")
else:
    print("   ✓ No zero-stat games found")
print()

# 5. RECENT GAMES
print("5. RECENT GAMES (last 5 games):")
print("-" * 80)
if all_games:
    recent = sorted(all_games, key=lambda x: x.get("game_date", ""), reverse=True)[:5]
    for g in recent:
        print(f"   {g.get('game_date')} - Game {g.get('game_id')}: "
              f"G={g.get('nhl_goals', 0)} A={g.get('nhl_assists', 0)} "
              f"P={g.get('nhl_points', 0)} SOG={g.get('nhl_shots_on_goal', 0)}")
print()

# 6. CHECK POINTS CALCULATION
print("6. POINTS CALCULATION CHECK (games where nhl_points != goals + assists):")
print("-" * 80)
mismatch_games = []
for g in all_games:
    goals = int(g.get("nhl_goals", 0) or 0)
    assists = int(g.get("nhl_assists", 0) or 0)
    points = int(g.get("nhl_points", 0) or 0)
    calculated = goals + assists
    if points != calculated:
        mismatch_games.append((g.get("game_id"), g.get("game_date"), goals, assists, points, calculated))

if mismatch_games:
    print(f"   Found {len(mismatch_games)} games with points mismatch:")
    for game_id, date, g, a, p, calc in mismatch_games[:10]:
        print(f"     Game {game_id} ({date}): G={g} A={a}, Stored Points={p}, Calculated={calc}")
else:
    print("   OK: All games have correct points calculation")
print()

# 7. NHL.COM COMPARISON
print("7. NHL.COM COMPARISON:")
print("-" * 80)
print("   According to NHL.com (https://www.nhl.com/oilers/player/connor-mcdavid-8478402):")
print("   Expected: 90 points")
if season_stats:
    s = season_stats[0]
    our_points = s.get("nhl_points", 0)
    print(f"   Our System: {our_points} points")
    print(f"   Difference: {90 - our_points} points MISSING")
    print(f"   Missing: 1 goal, 1 PPP, 2 shots (per user report)")
print()

print("=" * 80)
print("AUDIT COMPLETE")
print("=" * 80)
