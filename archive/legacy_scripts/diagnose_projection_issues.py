#!/usr/bin/env python3
"""
Diagnose projection issues:
1. Check if all 8 stat columns exist in player_projected_stats
2. Check if projections are being saved with all 8 stats
3. Check goalie wins projections and why they might be 0.5
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("PROJECTION ISSUES DIAGNOSTIC")
print("=" * 80)
print()

# 1. Check if columns exist (query a sample projection)
print("1. Checking database schema for projection columns...")
sample = db.select(
    "player_projected_stats",
    select="projection_id,player_id,projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_wins",
    limit=1
)

if sample and len(sample) > 0:
    print("   OK - Columns exist (or query succeeded)")
    print(f"   Sample projection has keys: {list(sample[0].keys())}")
else:
    print("   ERROR - Could not query projections or columns missing")
    print("   This suggests the migration to add projected_ppp, projected_shp, etc. was not applied")

print()

# 2. Check recent projections for missing stats
print("2. Checking recent projections for stat completeness...")
recent_projections = db.select(
    "player_projected_stats",
    select="player_id,projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_wins,is_goalie",
    order="projection_date.desc",
    limit=20
)

if recent_projections:
    print(f"   Found {len(recent_projections)} recent projections")
    
    skater_missing = 0
    goalie_missing = 0
    
    for proj in recent_projections:
        is_goalie = proj.get("is_goalie", False)
        
        if is_goalie:
            wins = proj.get("projected_wins")
            if wins == 0.5:
                goalie_missing += 1
        else:
            # Check if any of the 8 stats are missing (NULL or 0 when they shouldn't be)
            ppp = proj.get("projected_ppp")
            shp = proj.get("projected_shp")
            hits = proj.get("projected_hits")
            pim = proj.get("projected_pim")
            
            if ppp is None or shp is None or hits is None or pim is None:
                skater_missing += 1
                print(f"   WARNING: Player {proj.get('player_id')} has NULL stats: ppp={ppp}, shp={shp}, hits={hits}, pim={pim}")
    
    print(f"   Skaters with missing stats: {skater_missing}/{len([p for p in recent_projections if not p.get('is_goalie', False)])}")
    print(f"   Goalies with 0.5 wins: {goalie_missing}/{len([p for p in recent_projections if p.get('is_goalie', False)])}")
else:
    print("   No projections found")

print()

# 3. Check goalie wins specifically
print("3. Checking goalie wins projections...")
goalie_projections = db.select(
    "player_projected_stats",
    select="player_id,projected_wins,projection_date",
    filters=[("is_goalie", "eq", True)],
    order="projection_date.desc",
    limit=10
)

if goalie_projections:
    print(f"   Found {len(goalie_projections)} goalie projections")
    wins_values = {}
    for proj in goalie_projections:
        wins = proj.get("projected_wins")
        if wins not in wins_values:
            wins_values[wins] = 0
        wins_values[wins] += 1
    
    print(f"   Wins value distribution:")
    for wins, count in sorted(wins_values.items()):
        print(f"     {wins}: {count} goalies")
    
    if 0.5 in wins_values and wins_values[0.5] == len(goalie_projections):
        print("   ERROR: ALL goalies have 0.5 wins - this suggests Vegas odds are not available")
else:
    print("   No goalie projections found")

print()

# 4. Check Vegas odds availability
print("4. Checking Vegas odds availability in nhl_games...")
all_games = db.select(
    "nhl_games",
    select="game_id,implied_win_probability_home,implied_win_probability_away,moneyline_home,moneyline_away",
    limit=100
)

games_with_odds = []
if all_games:
    for game in all_games:
        if game.get("implied_win_probability_home") is not None:
            games_with_odds.append(game)
            if len(games_with_odds) >= 10:
                break

if games_with_odds:
    print(f"   Found {len(games_with_odds)} games with Vegas odds")
    print(f"   Sample: Game {games_with_odds[0].get('game_id')} has home prob={games_with_odds[0].get('implied_win_probability_home')}")
else:
    print("   WARNING: No games have Vegas odds populated")
    print("   This explains why goalie wins default to 0.5")

print()

# 5. Check if projection calculation is saving all stats
print("5. Checking a specific player's projection breakdown...")
test_player = db.select(
    "player_projected_stats",
    select="*",
    filters=[("is_goalie", "eq", False)],
    limit=1
)

if test_player:
    proj = test_player[0]
    print(f"   Player ID: {proj.get('player_id')}")
    print(f"   Goals: {proj.get('projected_goals')}")
    print(f"   Assists: {proj.get('projected_assists')}")
    print(f"   SOG: {proj.get('projected_sog')}")
    print(f"   Blocks: {proj.get('projected_blocks')}")
    print(f"   PPP: {proj.get('projected_ppp')}")
    print(f"   SHP: {proj.get('projected_shp')}")
    print(f"   Hits: {proj.get('projected_hits')}")
    print(f"   PIM: {proj.get('projected_pim')}")
    print(f"   Total Points: {proj.get('total_projected_points')}")
    
    missing = []
    if proj.get('projected_ppp') is None:
        missing.append('ppp')
    if proj.get('projected_shp') is None:
        missing.append('shp')
    if proj.get('projected_hits') is None:
        missing.append('hits')
    if proj.get('projected_pim') is None:
        missing.append('pim')
    
    if missing:
        print(f"   ERROR: Missing stats: {', '.join(missing)}")
    else:
        print("   OK - All 8 stats present")
else:
    print("   No skater projections found")

print()
print("=" * 80)
print("DIAGNOSTIC COMPLETE")
print("=" * 80)

