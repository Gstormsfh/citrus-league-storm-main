#!/usr/bin/env python3
"""
check_goalie_stats_from_raw_shots.py

Diagnostic script to verify if we can calculate all goalie statistics from raw_shots table.
Compares calculated stats from raw_shots with what's in player_season_stats to identify mismatches.
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


def check_goalie_stats_from_raw_shots():
    """Check if we can calculate goalie stats from raw_shots table."""
    print("=" * 80)
    print("CHECKING GOALIE STATS FROM RAW_SHOTS")
    print("=" * 80)
    print()
    
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Step 1: Get all goalies with shots in raw_shots for season 2025
    print("Step 1: Finding goalies with shots in raw_shots table...")
    
    # Get game IDs for season 2025 (game_id format: 2025xxxxxx)
    game_id_min = SEASON * 1000000
    game_id_max = (SEASON + 1) * 1000000
    
    # Fetch raw_shots data for season 2025
    print("  Fetching raw_shots data (this may take a moment)...")
    
    all_shots = []
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('raw_shots').select(
            'goalie_id, game_id, is_goal, is_empty_net'
        ).gte('game_id', game_id_min).lt('game_id', game_id_max).not_.is_('goalie_id', 'null').gt('goalie_id', 0).range(offset, offset + batch_size - 1).execute()
        
        if not response.data or len(response.data) == 0:
            break
        
        all_shots.extend(response.data)
        
        if len(response.data) < batch_size:
            break
        
        offset += batch_size
        if offset % 10000 == 0:
            print(f"    Fetched {len(all_shots):,} shots so far...")
    
    if len(all_shots) == 0:
        print("❌ No shots found in raw_shots for season 2025")
        return
    
    print(f"✅ Fetched {len(all_shots):,} shots from raw_shots")
    print()
    
    # Convert to DataFrame
    df = pd.DataFrame(all_shots)
    df['goalie_id'] = pd.to_numeric(df['goalie_id'], errors='coerce')
    df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
    df['is_empty_net'] = pd.to_numeric(df['is_empty_net'], errors='coerce').fillna(False).astype(bool)
    
    # Filter out rows with invalid goalie_id
    df = df[df['goalie_id'].notna() & (df['goalie_id'] > 0)].copy()
    
    # Step 2: Calculate stats from raw_shots
    print("Step 2: Calculating stats from raw_shots...")
    print()
    
    # Filter out empty net shots
    df_filtered = df[~df['is_empty_net']].copy()
    
    # Calculate per-goalie stats
    goalie_stats = df_filtered.groupby('goalie_id').agg(
        goalie_gp=('game_id', 'nunique'),
        shots_faced=('goalie_id', 'count'),
        goals_against=('is_goal', 'sum')
    ).reset_index()
    
    goalie_stats['saves'] = goalie_stats['shots_faced'] - goalie_stats['goals_against']
    goalie_stats['save_pct'] = goalie_stats['saves'] / goalie_stats['shots_faced']
    goalie_stats['gaa'] = (goalie_stats['goals_against'] / goalie_stats['goalie_gp']).round(2)
    
    # Calculate shutouts (games with 0 goals against)
    shutouts_by_goalie = df_filtered.groupby(['goalie_id', 'game_id']).agg(
        goals_in_game=('is_goal', 'sum')
    ).reset_index()
    
    shutouts = shutouts_by_goalie[shutouts_by_goalie['goals_in_game'] == 0].groupby('goalie_id').size().reset_index(name='shutouts')
    
    goalie_stats = goalie_stats.merge(shutouts, on='goalie_id', how='left')
    goalie_stats['shutouts'] = goalie_stats['shutouts'].fillna(0).astype(int)
    
    print(f"✅ Calculated stats for {len(goalie_stats)} goalies from raw_shots")
    print()
    
    # Step 3: Compare with player_season_stats
    print("Step 3: Comparing with player_season_stats...")
    print()
    
    # Get top 10 goalies by shots faced for comparison
    top_goalies = goalie_stats.nlargest(10, 'shots_faced')
    goalie_id_list = top_goalies['goalie_id'].tolist()
    
    # Fetch player_season_stats
    season_stats_response = supabase.table('player_season_stats').select(
        'player_id, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct'
    ).eq('season', SEASON).eq('is_goalie', True).in_('player_id', goalie_id_list).execute()
    
    season_stats = pd.DataFrame(season_stats_response.data) if season_stats_response.data else pd.DataFrame()
    
    if len(season_stats) == 0:
        print("⚠️  No matching goalies found in player_season_stats")
        print()
        print("Sample calculated stats from raw_shots:")
        for _, row in top_goalies.head(5).iterrows():
            print(f"  Goalie {int(row['goalie_id'])}:")
            print(f"    GP: {int(row['goalie_gp'])}")
            print(f"    Shots Faced: {int(row['shots_faced'])}")
            print(f"    Goals Against: {int(row['goals_against'])}")
            print(f"    Saves: {int(row['saves'])}")
            print(f"    SV%: {row['save_pct']:.4f}")
            print(f"    GAA: {row['gaa']:.2f}")
            print(f"    Shutouts: {int(row['shutouts'])}")
            print()
        return
    
    # Merge for comparison
    comparison = top_goalies.merge(
        season_stats,
        left_on='goalie_id',
        right_on='player_id',
        how='left',
        suffixes=('_raw_shots', '_season_stats')
    )
    
    # Compare
    print("Comparison Results:")
    print("-" * 100)
    print(f"{'Goalie ID':<12} {'Stat':<20} {'From raw_shots':<20} {'From player_season_stats':<25} {'Match':<10}")
    print("-" * 100)
    
    mismatches = []
    stats_to_compare = ['goalie_gp', 'shots_faced', 'goals_against', 'saves', 'shutouts']
    
    for _, row in comparison.iterrows():
        goalie_id = int(row['goalie_id'])
        has_mismatch = False
        
        for stat in stats_to_compare:
            raw_val = int(row.get(f'{stat}_raw_shots', 0) or 0)
            season_val = int(row.get(f'{stat}_season_stats', 0) or 0)
            
            if raw_val != season_val:
                has_mismatch = True
                match = "❌"
                print(f"{goalie_id:<12} {stat:<20} {str(raw_val):<20} {str(season_val):<25} {match:<10}")
        
        # Compare save_pct (with tolerance)
        raw_save_pct = row.get('save_pct_raw_shots')
        season_save_pct = row.get('save_pct_season_stats')
        
        if pd.notna(raw_save_pct) and pd.notna(season_save_pct):
            diff = abs(float(raw_save_pct) - float(season_save_pct))
            if diff >= 0.001:
                has_mismatch = True
                match = "❌"
                print(f"{goalie_id:<12} {'save_pct':<20} {f'{raw_save_pct:.4f}':<20} {f'{season_save_pct:.4f}':<25} {match:<10}")
        
        if has_mismatch:
            mismatches.append(goalie_id)
    
    print("-" * 100)
    print()
    
    # Summary
    if mismatches:
        print(f"⚠️  Found mismatches for {len(set(mismatches))} goalies")
        print("   This indicates player_season_stats may not be populated from raw_shots")
    else:
        print("✅ All calculated stats match player_season_stats")
    
    print()
    print("Sample calculated stats from raw_shots:")
    for _, row in top_goalies.head(5).iterrows():
        print(f"  Goalie {int(row['goalie_id'])}:")
        print(f"    GP: {int(row['goalie_gp'])}")
        print(f"    Shots Faced: {int(row['shots_faced'])}")
        print(f"    Goals Against: {int(row['goals_against'])}")
        print(f"    Saves: {int(row['saves'])}")
        print(f"    SV%: {row['save_pct']:.4f}")
        print(f"    GAA: {row['gaa']:.2f}")
        print(f"    Shutouts: {int(row['shutouts'])}")
        print()
    
    print("=" * 80)
    print("DIAGNOSTIC COMPLETE")
    print("=" * 80)
    
    return goalie_stats


if __name__ == "__main__":
    check_goalie_stats_from_raw_shots()
