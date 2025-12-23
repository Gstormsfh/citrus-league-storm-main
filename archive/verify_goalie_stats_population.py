#!/usr/bin/env python3
"""
verify_goalie_stats_population.py

Verify that goalie stats are correctly populated in player_season_stats after running
populate_goalie_stats_from_raw_shots.py and build_player_season_stats.py.
"""

import os
import sys
import pandas as pd
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

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


def verify_goalie_stats_population():
    """Verify goalie stats are populated in player_season_stats."""
    print("=" * 80)
    print("VERIFYING GOALIE STATS POPULATION")
    print("=" * 80)
    print()
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Step 1: Get goalies from player_season_stats
    print("Step 1: Fetching goalie stats from player_season_stats...")
    
    # Get goalie stats
    goalie_stats = db.select(
        'player_season_stats',
        select='player_id, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct',
        filters=[
            ('season', 'eq', SEASON),
            ('is_goalie', 'eq', True),
            ('goalie_gp', 'gt', 0)
        ],
        order='goalie_gp.desc',
        limit=20
    )
    
    if not goalie_stats:
        print("❌ No goalies found in player_season_stats with goalie_gp > 0")
        print("   Run populate_goalie_stats_from_raw_shots.py first")
        return
    
    df_season = pd.DataFrame(goalie_stats)
    
    # Get player names from player_directory
    player_ids = df_season['player_id'].tolist()
    player_names = {}
    if player_ids:
        for pid in player_ids:
            players = db.select(
                'player_directory',
                select='player_id, full_name',
                filters=[('player_id', 'eq', int(pid))],
                limit=1
            )
            if players:
                player_names[int(pid)] = players[0].get('full_name', 'Unknown')
    
    df_season['player_name'] = df_season['player_id'].map(player_names).fillna('Unknown')
    
    print(f"✅ Found {len(df_season)} goalies with goalie_gp > 0")
    print()
    
    # Step 2: Check data quality
    print("Step 2: Checking data quality...")
    print()
    
    issues = []
    
    for _, row in df_season.iterrows():
        goalie_id = int(row['player_id'])
        goalie_gp = int(row.get('goalie_gp', 0) or 0)
        wins = int(row.get('wins', 0) or 0)
        saves = int(row.get('saves', 0) or 0)
        shots_faced = int(row.get('shots_faced', 0) or 0)
        goals_against = int(row.get('goals_against', 0) or 0)
        shutouts = int(row.get('shutouts', 0) or 0)
        save_pct = row.get('save_pct')
        
        # Validation checks
        if goalie_gp > 0 and wins > goalie_gp:
            issues.append(f"Goalie {goalie_id}: wins ({wins}) > games played ({goalie_gp})")
        
        if shots_faced > 0 and saves != (shots_faced - goals_against):
            issues.append(f"Goalie {goalie_id}: saves ({saves}) != shots_faced ({shots_faced}) - goals_against ({goals_against})")
        
        if shots_faced > 0:
            calculated_save_pct = saves / shots_faced
            if save_pct and abs(float(save_pct) - calculated_save_pct) > 0.001:
                issues.append(f"Goalie {goalie_id}: save_pct mismatch (stored: {save_pct:.4f}, calculated: {calculated_save_pct:.4f})")
        
        if shutouts > goalie_gp:
            issues.append(f"Goalie {goalie_id}: shutouts ({shutouts}) > games played ({goalie_gp})")
    
    if issues:
        print("⚠️  Found data quality issues:")
        for issue in issues[:10]:  # Show first 10
            print(f"   {issue}")
        if len(issues) > 10:
            print(f"   ... and {len(issues) - 10} more issues")
    else:
        print("✅ No data quality issues found")
    
    print()
    
    # Step 3: Display sample goalie stats
    print("Step 3: Sample goalie stats from player_season_stats:")
    print("-" * 120)
    print(f"{'Player ID':<12} {'Name':<25} {'GP':<6} {'W':<6} {'SV%':<8} {'GAA':<8} {'SO':<6} {'Shots':<8} {'Saves':<8}")
    print("-" * 120)
    
    for _, row in df_season.head(10).iterrows():
        goalie_id = int(row['player_id'])
        name = str(row.get('player_name', 'Unknown'))[:24]
        gp = int(row.get('goalie_gp', 0) or 0)
        wins = int(row.get('wins', 0) or 0)
        save_pct = row.get('save_pct')
        shots_faced = int(row.get('shots_faced', 0) or 0)
        goals_against = int(row.get('goals_against', 0) or 0)
        shutouts = int(row.get('shutouts', 0) or 0)
        saves = int(row.get('saves', 0) or 0)
        
        gaa = (goals_against / gp) if gp > 0 else 0.0
        save_pct_str = f"{float(save_pct):.3f}" if save_pct else "N/A"
        
        print(f"{goalie_id:<12} {name:<25} {gp:<6} {wins:<6} {save_pct_str:<8} {gaa:<8.2f} {shutouts:<6} {shots_faced:<8} {saves:<8}")
    
    print("-" * 120)
    print()
    
    # Step 4: Summary statistics
    print("Step 4: Summary statistics:")
    print()
    
    total_goalies = len(df_season)
    goalies_with_wins = len(df_season[df_season['wins'].fillna(0) > 0])
    goalies_with_saves = len(df_season[df_season['saves'].fillna(0) > 0])
    goalies_with_shutouts = len(df_season[df_season['shutouts'].fillna(0) > 0])
    
    avg_gp = df_season['goalie_gp'].mean()
    avg_wins = df_season['wins'].fillna(0).mean()
    avg_saves = df_season['saves'].fillna(0).mean()
    avg_shutouts = df_season['shutouts'].fillna(0).mean()
    
    print(f"  Total goalies with GP > 0: {total_goalies}")
    print(f"  Goalies with wins > 0: {goalies_with_wins} ({goalies_with_wins/total_goalies*100:.1f}%)")
    print(f"  Goalies with saves > 0: {goalies_with_saves} ({goalies_with_saves/total_goalies*100:.1f}%)")
    print(f"  Goalies with shutouts > 0: {goalies_with_shutouts} ({goalies_with_shutouts/total_goalies*100:.1f}%)")
    print()
    print(f"  Average GP: {avg_gp:.1f}")
    print(f"  Average Wins: {avg_wins:.1f}")
    print(f"  Average Saves: {avg_saves:.1f}")
    print(f"  Average Shutouts: {avg_shutouts:.2f}")
    print()
    
    # Step 5: Check if stats are ready for frontend
    print("Step 5: Frontend readiness check...")
    print()
    
    ready_count = 0
    for _, row in df_season.iterrows():
        has_gp = (row.get('goalie_gp', 0) or 0) > 0
        has_wins = (row.get('wins', 0) or 0) >= 0  # 0 is valid
        has_saves = (row.get('saves', 0) or 0) >= 0
        has_save_pct = row.get('save_pct') is not None
        has_gaa = (row.get('goals_against', 0) or 0) >= 0 and (row.get('goalie_gp', 0) or 0) > 0
        has_shutouts = (row.get('shutouts', 0) or 0) >= 0
        
        if has_gp and has_wins and has_saves and has_save_pct and has_gaa and has_shutouts:
            ready_count += 1
    
    print(f"  Goalies ready for frontend display: {ready_count}/{total_goalies} ({ready_count/total_goalies*100:.1f}%)")
    print()
    
    if ready_count == total_goalies:
        print("✅ All goalies have complete stats - ready for frontend!")
    else:
        print(f"⚠️  {total_goalies - ready_count} goalies missing some stats")
    
    print()
    print("=" * 80)
    print("VERIFICATION COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    verify_goalie_stats_population()

