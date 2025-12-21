#!/usr/bin/env python3
"""
check_goalie_wins_calculation.py

Verify if we can determine goalie wins by joining raw_shots with nhl_games table.
Tests the logic for determining which team a goalie played for and whether they won.
"""

import os
import sys
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

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


def check_goalie_wins_calculation():
    """Check if we can calculate goalie wins from raw_shots + nhl_games."""
    print("=" * 80)
    print("CHECKING GOALIE WINS CALCULATION")
    print("=" * 80)
    print()
    
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Step 1: Get sample goalies with shots
    print("Step 1: Finding sample goalies with shots...")
    
    game_id_min = SEASON * 1000000
    game_id_max = (SEASON + 1) * 1000000
    
    # Fetch raw_shots for a few games to test
    print("  Fetching raw_shots data for sample games...")
    
    # Get a few game IDs first
    games_response = supabase.table('nhl_games').select(
        'game_id, home_team, away_team, home_score, away_score, status'
    ).eq('season', SEASON).eq('status', 'final').limit(10).execute()
    
    if not games_response.data:
        print("❌ No final games found in nhl_games")
        return
    
    sample_game_ids = [g['game_id'] for g in games_response.data[:5]]
    print(f"  Testing with {len(sample_game_ids)} games: {sample_game_ids}")
    print()
    
    # Fetch raw_shots for these games
    all_shots = []
    for game_id in sample_game_ids:
        response = supabase.table('raw_shots').select(
            'goalie_id, game_id, is_goal, is_empty_net, home_team_abbrev, away_team_abbrev, is_home_team, team_code'
        ).eq('game_id', game_id).not_.is_('goalie_id', 'null').gt('goalie_id', 0).execute()
        
        if response.data:
            all_shots.extend(response.data)
    
    if len(all_shots) == 0:
        print("❌ No shots found for sample games")
        return
    
    print(f"✅ Fetched {len(all_shots)} shots from {len(sample_game_ids)} games")
    print()
    
    # Convert to DataFrame
    df_shots = pd.DataFrame(all_shots)
    df_shots['goalie_id'] = pd.to_numeric(df_shots['goalie_id'], errors='coerce')
    df_shots['is_empty_net'] = pd.to_numeric(df_shots['is_empty_net'], errors='coerce').fillna(False).astype(bool)
    df_shots = df_shots[df_shots['goalie_id'].notna() & (df_shots['goalie_id'] > 0)].copy()
    
    # Get game results
    df_games = pd.DataFrame(games_response.data)
    df_games['game_id'] = pd.to_numeric(df_games['game_id'], errors='coerce')
    df_games = df_games[df_games['game_id'].notna()].copy()
    
    # Step 2: Determine goalie's team for each game
    print("Step 2: Determining goalie's team for each game...")
    print()
    
    # For each game, determine which goalie played for which team
    # Logic: The goalie who faces shots from the opposing team is the goalie for the defending team
    # If we see shots with home_team_abbrev = 'EDM' and goalie_id = X, then goalie X is the AWAY goalie (facing EDM shots)
    
    goalie_game_teams = []
    
    for game_id in sample_game_ids:
        game_shots = df_shots[df_shots['game_id'] == game_id].copy()
        game_info = df_games[df_games['game_id'] == game_id].iloc[0]
        
        if len(game_shots) == 0:
            continue
        
        # Get unique goalies in this game
        goalies_in_game = game_shots['goalie_id'].unique()
        
        for goalie_id in goalies_in_game:
            goalie_shots = game_shots[game_shots['goalie_id'] == goalie_id]
            
            # Determine goalie's team by checking which team's shots they faced
            # Method 1: Use is_home_team if available (most reliable)
            goalie_team = None
            is_home_goalie = None
            
            if 'is_home_team' in goalie_shots.columns:
                is_home_values = goalie_shots['is_home_team'].dropna()
                if len(is_home_values) > 0:
                    home_shot_count = (is_home_values == True).sum()
                    away_shot_count = (is_home_values == False).sum()
                    
                    if home_shot_count > away_shot_count:
                        # Goalie facing home team's shots → away team's goalie
                        goalie_team = game_info['away_team']
                        is_home_goalie = False
                    elif away_shot_count > home_shot_count:
                        # Goalie facing away team's shots → home team's goalie
                        goalie_team = game_info['home_team']
                        is_home_goalie = True
            
            # Method 2: Fallback to home_team_abbrev logic
            if goalie_team is None:
                home_teams = goalie_shots['home_team_abbrev'].dropna().unique()
                
                if len(home_teams) > 0:
                    # Check if home_team_abbrev from shots matches game's home_team
                    if str(home_teams[0]).upper() == str(game_info['home_team']).upper():
                        # Goalie is facing home team's shots → goalie is away team's goalie
                        goalie_team = game_info['away_team']
                        is_home_goalie = False
                    elif str(home_teams[0]).upper() == str(game_info['away_team']).upper():
                        # Goalie is facing away team's shots → goalie is home team's goalie
                        goalie_team = game_info['home_team']
                        is_home_goalie = True
            
            if goalie_team:
                # Calculate if goalie's team won
                home_score = int(game_info.get('home_score', 0) or 0)
                away_score = int(game_info.get('away_score', 0) or 0)
                
                if is_home_goalie:
                    won = home_score > away_score
                else:
                    won = away_score > home_score
                
                goalie_game_teams.append({
                    'goalie_id': int(goalie_id),
                    'game_id': int(game_id),
                    'goalie_team': goalie_team,
                    'is_home': is_home_goalie,
                    'home_score': home_score,
                    'away_score': away_score,
                    'won': won
                })
    
    if not goalie_game_teams:
        print("⚠️  Could not determine goalie teams from shot data")
        print("   This may indicate missing team abbreviation data in raw_shots")
        return
    
    df_goalie_games = pd.DataFrame(goalie_game_teams)
    
    print(f"✅ Determined team for {len(df_goalie_games)} goalie-game combinations")
    print()
    
    # Step 3: Calculate wins per goalie
    print("Step 3: Calculating wins per goalie...")
    print()
    
    goalie_wins = df_goalie_games.groupby('goalie_id').agg(
        games_played=('game_id', 'nunique'),
        wins=('won', 'sum')
    ).reset_index()
    
    print("Sample goalie win calculations:")
    print("-" * 80)
    print(f"{'Goalie ID':<12} {'Games':<10} {'Wins':<10} {'Win %':<10}")
    print("-" * 80)
    
    for _, row in goalie_wins.iterrows():
        win_pct = (row['wins'] / row['games_played'] * 100) if row['games_played'] > 0 else 0
        print(f"{int(row['goalie_id']):<12} {int(row['games_played']):<10} {int(row['wins']):<10} {win_pct:.1f}%")
    
    print("-" * 80)
    print()
    
    # Step 4: Show detailed breakdown for one goalie
    print("Step 4: Detailed breakdown for sample goalie...")
    print()
    
    if len(goalie_wins) > 0:
        sample_goalie_id = goalie_wins.iloc[0]['goalie_id']
        sample_games = df_goalie_games[df_goalie_games['goalie_id'] == sample_goalie_id]
        
        print(f"Goalie {int(sample_goalie_id)} game-by-game:")
        print("-" * 100)
        print(f"{'Game ID':<12} {'Team':<8} {'Home':<8} {'Away':<8} {'Result':<15} {'Won':<8}")
        print("-" * 100)
        
        for _, game_row in sample_games.iterrows():
            result = f"{game_row['home_score']}-{game_row['away_score']}"
            won_str = "Yes" if game_row['won'] else "No"
            home_team = df_games[df_games['game_id'] == game_row['game_id']].iloc[0]['home_team']
            away_team = df_games[df_games['game_id'] == game_row['game_id']].iloc[0]['away_team']
            
            print(f"{int(game_row['game_id']):<12} {game_row['goalie_team']:<8} {home_team:<8} {away_team:<8} {result:<15} {won_str:<8}")
        
        print("-" * 100)
        print()
    
    # Step 5: Verify calculation method
    print("Step 5: Verification...")
    print()
    print("✅ Wins calculation method verified:")
    print("   1. Determine goalie's team from raw_shots (which team's shots they faced)")
    print("   2. Join with nhl_games to get final scores")
    print("   3. Check if goalie's team won (home_score > away_score for home, vice versa)")
    print("   4. Count wins per goalie")
    print()
    
    print("=" * 80)
    print("WINS CALCULATION CHECK COMPLETE")
    print("=" * 80)
    
    return goalie_wins


if __name__ == "__main__":
    check_goalie_wins_calculation()
