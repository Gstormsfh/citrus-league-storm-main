#!/usr/bin/env python3
"""Quick projection generation for Jan 4, 2026 - simplified version."""

import os
import sys
from datetime import date
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from calculate_daily_projections import calculate_daily_projection, supabase_client

load_dotenv()

print("=" * 80)
print("QUICK PROJECTIONS FOR JAN 4, 2026")
print("=" * 80)

db = supabase_client()
target_date = date(2026, 1, 4)
season = 2025

# Get games
print(f"\n1. Fetching games for {target_date}...")
games = db.select(
    "nhl_games",
    select="game_id,home_team,away_team",
    filters=[("game_date", "eq", target_date.isoformat()), ("season", "eq", season)]
)

if not games:
    print("No games found!")
    sys.exit(0)

print(f"   Found {len(games)} games")

# Get teams
teams = set()
game_map = {}
for game in games:
    teams.add(game['home_team'])
    teams.add(game['away_team'])
    game_map[game['home_team']] = game['game_id']
    game_map[game['away_team']] = game['game_id']

print(f"   Teams playing: {len(teams)}")

# Get players on those teams
print(f"\n2. Fetching players...")
players = db.select(
    "player_directory",
    select="player_id,team_abbrev",
    filters=[("team_abbrev", "in", list(teams)), ("season", "eq", season)],
    limit=1000
)

print(f"   Found {len(players)} players")

# Filter to active players (games_played > 0)
print(f"\n3. Filtering to active players...")
player_ids = [int(p['player_id']) for p in players if p.get('player_id')]
active_players = []

# Check in batches
for i in range(0, len(player_ids), 100):
    batch = player_ids[i:i+100]
    stats = db.select(
        "player_season_stats",
        select="player_id",
        filters=[("player_id", "in", batch), ("season", "eq", season), ("games_played", "gt", 0)],
        limit=100
    )
    active_ids = {int(s['player_id']) for s in stats if s.get('player_id')}
    active_players.extend([p for p in players if int(p.get('player_id', 0)) in active_ids])

print(f"   Active players: {len(active_players)}")

# Default scoring
scoring = {
    "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5, "power_play_points": 1, "short_handed_points": 2, "hits": 0.2, "penalty_minutes": 0.5},
    "goalie": {"wins": 4, "shutouts": 3, "saves": 0.2, "goals_against": -1}
}

# Calculate projections
print(f"\n4. Calculating projections...")
projections = []
success = 0
failed = 0

for player in active_players:
    player_id = int(player['player_id'])
    team = player['team_abbrev']
    game_id = game_map.get(team)
    
    if not game_id:
        continue
    
    try:
        proj = calculate_daily_projection(
            db, player_id, int(game_id), target_date, season, scoring
        )
        if proj:
            projections.append(proj)
            success += 1
            if success % 50 == 0:
                print(f"   Processed {success} players...")
        else:
            failed += 1
    except Exception as e:
        failed += 1
        if failed <= 5:  # Only print first 5 errors
            print(f"   Error for player {player_id}: {e}")

print(f"\n5. Saving projections...")
print(f"   Success: {success}")
print(f"   Failed: {failed}")

# Upsert in batches
if projections:
    batch_size = 50
    for i in range(0, len(projections), batch_size):
        batch = projections[i:i+batch_size]
        try:
            db.upsert('player_projected_stats', batch, on_conflict='player_id,game_id,projection_date')
            print(f"   Saved batch {i//batch_size + 1} ({len(batch)} projections)")
        except Exception as e:
            print(f"   Error saving batch: {e}")

print("\n" + "=" * 80)
print("COMPLETE!")
print(f"Generated {len(projections)} projections for {target_date}")
print("=" * 80)

