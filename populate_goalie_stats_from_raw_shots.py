#!/usr/bin/env python3
"""
populate_goalie_stats_from_raw_shots.py

Populate goalie statistics in player_game_stats table by calculating from raw_shots and nhl_games.
This script:
1. Queries raw_shots grouped by goalie_id and game_id
2. Calculates per-game: shots_faced, goals_against, saves, shutouts
3. Joins with nhl_games to determine wins
4. Upserts to player_game_stats table
5. Optionally re-runs build_player_season_stats.py to aggregate
"""

import os
import sys
import pandas as pd
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from datetime import datetime

# Fix Windows encoding issues
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

SEASON = 2025


def determine_goalie_team_from_shots(goalie_shots, game_info):
    """
    Determine which team a goalie played for based on shots they faced.
    
    Logic:
    - If is_home_team is available: shots with is_home_team=True are from home team,
      so goalie facing them is away team's goalie
    - Otherwise: use team_code or home_team_abbrev/away_team_abbrev to determine
      which team took the shots
    """
    # Method 1: Use is_home_team if available (most reliable)
    if 'is_home_team' in goalie_shots.columns:
        is_home_values = goalie_shots['is_home_team'].dropna()
        if len(is_home_values) > 0:
            # Check if majority of shots are from home team
            home_shot_count = (is_home_values == True).sum()
            away_shot_count = (is_home_values == False).sum()
            
            if home_shot_count > away_shot_count:
                # Goalie facing home team's shots → away team's goalie
                return game_info['away_team'], False
            elif away_shot_count > home_shot_count:
                # Goalie facing away team's shots → home team's goalie
                return game_info['home_team'], True
    
    # Method 2: Use team_code if available
    if 'team_code' in goalie_shots.columns:
        team_codes = goalie_shots['team_code'].dropna().unique()
        if len(team_codes) > 0:
            team_code = str(team_codes[0]).upper()
            game_home_team = str(game_info['home_team']).upper()
            game_away_team = str(game_info['away_team']).upper()
            
            if team_code == game_home_team:
                # Goalie facing home team's shots → away team's goalie
                return game_info['away_team'], False
            elif team_code == game_away_team:
                # Goalie facing away team's shots → home team's goalie
                return game_info['home_team'], True
    
    # Method 3: Fallback to home_team_abbrev/away_team_abbrev logic
    home_teams = goalie_shots['home_team_abbrev'].dropna().unique()
    away_teams = goalie_shots['away_team_abbrev'].dropna().unique()
    
    if len(home_teams) > 0:
        home_team_abbrev = str(home_teams[0]).upper()
        game_home_team = str(game_info['home_team']).upper()
        game_away_team = str(game_info['away_team']).upper()
        
        if home_team_abbrev == game_home_team:
            # Goalie facing home team's shots → away team's goalie
            return game_info['away_team'], False
        elif home_team_abbrev == game_away_team:
            # Goalie facing away team's shots → home team's goalie
            return game_info['home_team'], True
    
    # Fallback: try away_teams
    if len(away_teams) > 0:
        away_team_abbrev = str(away_teams[0]).upper()
        game_home_team = str(game_info['home_team']).upper()
        game_away_team = str(game_info['away_team']).upper()
        
        if away_team_abbrev == game_away_team:
            # Goalie facing away team's shots → home team's goalie
            return game_info['home_team'], True
        elif away_team_abbrev == game_home_team:
            # Goalie facing home team's shots → away team's goalie
            return game_info['away_team'], False
    
    return None, None


def populate_goalie_stats_from_raw_shots(season: int = SEASON, auto_aggregate: bool = True):
    """Populate goalie stats in player_game_stats from raw_shots."""
    print("=" * 80)
    print("POPULATING GOALIE STATS FROM RAW_SHOTS")
    print("=" * 80)
    print(f"Season: {season}")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Step 1: Get all game IDs for the season
    print("Step 1: Fetching game IDs for season...")
    
    game_id_min = season * 1000000
    game_id_max = (season + 1) * 1000000
    
    # Get all final games for the season
    games_data = db.select(
        "nhl_games",
        select="game_id, home_team, away_team, home_score, away_score, status, game_date",
        filters=[
            ("season", "eq", season),
            ("game_id", "gte", game_id_min),
            ("game_id", "lt", game_id_max)
        ]
    )
    
    if not games_data:
        print("❌ No games found for season")
        return
    
    df_games = pd.DataFrame(games_data)
    df_games['game_id'] = pd.to_numeric(df_games['game_id'], errors='coerce')
    df_games = df_games[df_games['game_id'].notna()].copy()
    
    # Process games - prefer final, but include others if needed
    # Check what statuses we have
    if 'status' in df_games.columns:
        status_counts = df_games['status'].value_counts()
        print(f"  Game status breakdown: {status_counts.to_dict()}")
        
        # Prefer final games for accurate wins, but include live/completed games too
        # Only exclude scheduled games (they have no shots yet)
        playable_statuses = ['final', 'live', 'completed', 'official']
        df_games = df_games[df_games['status'].isin(playable_statuses)].copy()
        
        if len(df_games) == 0:
            # If no playable games, check if we have any games with shots
            print(f"⚠️  No playable games found. Checking for games with shots in raw_shots...")
            # We'll continue anyway - the shots query will determine what's available
    else:
        print(f"  No status column found, using all {len(df_games)} games")
    
    print(f"✅ Processing {len(df_games)} games for season {season}")
    print()
    
    # Step 2: Fetch raw_shots for all games (in batches)
    print("Step 2: Fetching raw_shots data (this may take a while)...")
    
    all_shots = []
    batch_size = 1000
    
    # Get unique game IDs from df_games
    game_ids = df_games['game_id'].tolist()
    unique_game_ids = game_ids  # Already unique from df_games query
    
    print(f"  Found {len(unique_game_ids)} unique game IDs to process")
    
    # Process games in batches using 'in' filter for efficiency
    batch_game_count = 50
    for i in range(0, len(unique_game_ids), batch_game_count):
        batch_game_ids = [int(gid) for gid in unique_game_ids[i:i+batch_game_count]]
        
        offset = 0
        while True:
            # Use 'in' filter to get shots for multiple games at once
            shots_batch = db.select(
                "raw_shots",
                select="goalie_id, game_id, is_goal, is_empty_net, home_team_abbrev, away_team_abbrev, is_home_team, team_code",
                filters=[
                    ("game_id", "in", batch_game_ids),
                    ("goalie_id", "gt", 0)
                ],
                limit=batch_size,
                offset=offset
            )
            
            # Filter out null goalie_id
            shots_batch = [s for s in shots_batch if s.get('goalie_id') is not None and s.get('goalie_id') > 0]
            
            if not shots_batch or len(shots_batch) == 0:
                break
            
            all_shots.extend(shots_batch)
            
            if len(shots_batch) < batch_size:
                break
            
            offset += batch_size
        
        if (i + batch_game_count) % 500 == 0 or (i + batch_game_count) >= len(unique_game_ids):
            print(f"  Processed {min(i + batch_game_count, len(unique_game_ids))}/{len(unique_game_ids)} games ({len(all_shots):,} shots)...")
    
    if len(all_shots) == 0:
        print("❌ No shots found in raw_shots")
        return
    
    print(f"✅ Fetched {len(all_shots):,} shots from {len(game_ids)} games")
    print()
    
    # Step 3: Process shots into DataFrame
    print("Step 3: Processing shots data...")
    
    df_shots = pd.DataFrame(all_shots)
    df_shots['goalie_id'] = pd.to_numeric(df_shots['goalie_id'], errors='coerce')
    df_shots['is_goal'] = pd.to_numeric(df_shots['is_goal'], errors='coerce').fillna(0).astype(int)
    df_shots['is_empty_net'] = pd.to_numeric(df_shots['is_empty_net'], errors='coerce').fillna(False).astype(bool)
    df_shots = df_shots[df_shots['goalie_id'].notna() & (df_shots['goalie_id'] > 0)].copy()
    
    # Filter out empty net shots
    df_shots_filtered = df_shots[~df_shots['is_empty_net']].copy()
    
    print(f"✅ Processed {len(df_shots_filtered):,} non-empty-net shots")
    print()
    
    # Step 4: Calculate per-game goalie stats
    print("Step 4: Calculating per-game goalie stats...")
    
    # Group by goalie and game
    goalie_game_stats = df_shots_filtered.groupby(['goalie_id', 'game_id']).agg(
        shots_faced=('goalie_id', 'count'),
        goals_against=('is_goal', 'sum')
    ).reset_index()
    
    goalie_game_stats['saves'] = goalie_game_stats['shots_faced'] - goalie_game_stats['goals_against']
    goalie_game_stats['shutouts'] = (goalie_game_stats['goals_against'] == 0).astype(int)
    goalie_game_stats['goalie_gp'] = 1  # Each row is one game
    
    print(f"✅ Calculated stats for {len(goalie_game_stats)} goalie-game combinations")
    print()
    
    # Step 5: Determine wins by joining with nhl_games
    print("Step 5: Determining wins from game results...")
    
    goalie_game_stats_with_wins = []
    
    for _, row in goalie_game_stats.iterrows():
        goalie_id = int(row['goalie_id'])
        game_id = int(row['game_id'])
        
        # Get game info
        game_info = df_games[df_games['game_id'] == game_id]
        if len(game_info) == 0:
            continue
        
        game_info = game_info.iloc[0]
        
        # Get shots for this goalie in this game to determine team
        goalie_shots = df_shots_filtered[
            (df_shots_filtered['goalie_id'] == goalie_id) & 
            (df_shots_filtered['game_id'] == game_id)
        ].copy()
        
        if len(goalie_shots) == 0:
            continue
        
        # Convert is_home_team to boolean if present
        if 'is_home_team' in goalie_shots.columns:
            goalie_shots['is_home_team'] = pd.to_numeric(goalie_shots['is_home_team'], errors='coerce').fillna(False).astype(bool)
        
        # Determine goalie's team
        goalie_team, is_home = determine_goalie_team_from_shots(goalie_shots, game_info)
        
        if goalie_team is None:
            # Skip if we can't determine team
            continue
        
        # Calculate win
        home_score = int(game_info.get('home_score', 0) or 0)
        away_score = int(game_info.get('away_score', 0) or 0)
        
        if is_home:
            won = 1 if home_score > away_score else 0
        else:
            won = 1 if away_score > home_score else 0
        
        goalie_game_stats_with_wins.append({
            'season': season,
            'game_id': game_id,
            'game_date': game_info.get('game_date'),
            'player_id': goalie_id,
            'team_abbrev': goalie_team,
            'position_code': 'G',
            'is_goalie': True,
            'goalie_gp': 1,
            'wins': won,
            'saves': int(row['saves']),
            'shots_faced': int(row['shots_faced']),
            'goals_against': int(row['goals_against']),
            'shutouts': int(row['shutouts']),
            # Skater stats should be 0 for goalies
            'goals': 0,
            'primary_assists': 0,
            'secondary_assists': 0,
            'points': 0,
            'shots_on_goal': 0,
            'hits': 0,
            'blocks': 0,
            'pim': 0,
            'ppp': 0,
            'shp': 0,
            'plus_minus': 0,
            'icetime_seconds': 0
        })
    
    print(f"✅ Determined wins for {len(goalie_game_stats_with_wins)} goalie-game records")
    print()
    
    # Step 6: Upsert to player_game_stats
    print("Step 6: Upserting to player_game_stats...")
    
    # Batch upsert
    batch_size = 100
    total_batches = (len(goalie_game_stats_with_wins) + batch_size - 1) // batch_size
    
    for i in range(0, len(goalie_game_stats_with_wins), batch_size):
        batch = goalie_game_stats_with_wins[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        
        try:
            db.upsert("player_game_stats", batch, on_conflict="season,game_id,player_id")
            print(f"  [{batch_num}/{total_batches}] Upserted {len(batch)} goalie-game records")
        except Exception as e:
            print(f"  ⚠️  Error upserting batch {batch_num}: {e}")
    
    print(f"✅ Upserted {len(goalie_game_stats_with_wins)} goalie-game records to player_game_stats")
    print()
    
    # Step 7: Optionally re-run build_player_season_stats
    if auto_aggregate:
        print("Step 7: Aggregating to player_season_stats...")
        print("  (Running build_player_season_stats.py)")
        print()
        
        try:
            # Set environment variable for season
            import subprocess
            env = os.environ.copy()
            env['CITRUS_DEFAULT_SEASON'] = str(season)
            
            result = subprocess.run(
                [sys.executable, "build_player_season_stats.py"],
                capture_output=True,
                text=True,
                timeout=600,  # 10 minutes timeout
                env=env
            )
            
            if result.returncode == 0:
                print("✅ Successfully aggregated to player_season_stats")
                if result.stdout:
                    # Print last few lines of output
                    lines = result.stdout.strip().split('\n')
                    for line in lines[-5:]:
                        if line.strip():
                            print(f"   {line}")
            else:
                print(f"⚠️  build_player_season_stats.py returned code {result.returncode}")
                if result.stderr:
                    print(f"   Error: {result.stderr[:500]}")
        except subprocess.TimeoutExpired:
            print("⚠️  build_player_season_stats.py timed out (may still be running)")
            print("   You may need to run it manually: python build_player_season_stats.py")
        except Exception as e:
            print(f"⚠️  Error running build_player_season_stats.py: {e}")
            print("   You may need to run it manually: python build_player_season_stats.py")
    
    print()
    print("=" * 80)
    print("GOALIE STATS POPULATION COMPLETE")
    print("=" * 80)
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Populate goalie stats from raw_shots')
    parser.add_argument('--season', type=int, default=SEASON, help='Season year (default: 2025)')
    parser.add_argument('--no-aggregate', action='store_true', help='Skip running build_player_season_stats.py')
    
    args = parser.parse_args()
    
    populate_goalie_stats_from_raw_shots(
        season=args.season,
        auto_aggregate=not args.no_aggregate
    )

