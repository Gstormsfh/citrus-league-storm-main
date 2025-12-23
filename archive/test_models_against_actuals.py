# test_models_against_actuals.py
# Test xG and xA models against actual goals and assists from staging data

import os
from dotenv import load_dotenv
from supabase import create_client, Client
import pandas as pd

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("🔍 Testing xG and xA Models Against Actual Goals and Assists")
print("=" * 70)

# Get our calculated data
print("\n1. Fetching our calculated xG and xA data...")
try:
    # Try to fetch both xG and xA
    our_data = supabase.table('raw_player_stats').select(
        'playerId, game_id, I_F_xGoals, I_F_xAssists'
    ).execute()
    has_xa_column = True
except Exception as e:
    # If xA column doesn't exist, just fetch xG
    print("   ⚠️  I_F_xAssists column not found, testing xG only...")
    our_data = supabase.table('raw_player_stats').select(
        'playerId, game_id, I_F_xGoals'
    ).execute()
    has_xa_column = False

if not our_data.data:
    print("❌ No data found in raw_player_stats")
    exit()

our_df = pd.DataFrame(our_data.data)
print(f"   Found {len(our_df)} records")

# Aggregate by player
if has_xa_column and 'I_F_xAssists' in our_df.columns:
    our_agg = our_df.groupby('playerId').agg({
        'I_F_xGoals': 'sum',
        'I_F_xAssists': 'sum'
    }).reset_index()
    our_agg.columns = ['playerId', 'our_xG_total', 'our_xA_total']
else:
    our_agg = our_df.groupby('playerId').agg({
        'I_F_xGoals': 'sum'
    }).reset_index()
    our_agg.columns = ['playerId', 'our_xG_total']
    our_agg['our_xA_total'] = 0.0  # Set to 0 if column doesn't exist
print(f"   Found {len(our_agg)} unique players")

# Get staging data with actual goals and assists
print("\n2. Fetching staging_2025_skaters data (actual goals/assists)...")
try:
    staging_data = supabase.table('staging_2025_skaters').select(
        'playerId, name, I_F_goals, I_F_primaryAssists, I_F_secondaryAssists, games_played, situation'
    ).eq('situation', 'all').execute()
    
    staging_df = pd.DataFrame(staging_data.data)
    
    # Calculate total assists
    staging_df['I_F_primaryAssists'] = pd.to_numeric(staging_df['I_F_primaryAssists'], errors='coerce').fillna(0)
    staging_df['I_F_secondaryAssists'] = pd.to_numeric(staging_df['I_F_secondaryAssists'], errors='coerce').fillna(0)
    staging_df['I_F_assists'] = staging_df['I_F_primaryAssists'] + staging_df['I_F_secondaryAssists']
    staging_df['I_F_goals'] = pd.to_numeric(staging_df['I_F_goals'], errors='coerce').fillna(0)
    staging_df['games_played'] = pd.to_numeric(staging_df['games_played'], errors='coerce').fillna(1)
    
    print(f"   Found {len(staging_df)} players in staging data")
    
except Exception as e:
    print(f"❌ Error fetching staging data: {e}")
    exit()

# Merge and compare
print("\n3. Comparing xG vs Actual Goals...")
our_agg['playerId'] = our_agg['playerId'].astype(str)
staging_df['playerId'] = staging_df['playerId'].astype(str)

comparison = our_agg.merge(
    staging_df[['playerId', 'name', 'I_F_goals', 'I_F_assists', 'games_played']],
    on='playerId',
    how='inner'
)

if len(comparison) == 0:
    print("⚠️  No matching playerIds found")
    exit()

# Calculate per-game rates
comparison['our_xG_per_game'] = comparison['our_xG_total'] / 1  # We have 1 day of data
comparison['our_xA_per_game'] = comparison['our_xA_total'] / 1 if 'our_xA_total' in comparison.columns else 0.0
comparison['actual_goals_per_game'] = comparison['I_F_goals'] / comparison['games_played']
comparison['actual_assists_per_game'] = comparison['I_F_assists'] / comparison['games_played']

# Calculate ratios (avoid division by zero)
comparison['xG_to_goals_ratio'] = comparison['our_xG_per_game'] / comparison['actual_goals_per_game'].replace(0, 1)
comparison['xA_to_assists_ratio'] = (comparison['our_xA_per_game'] / comparison['actual_assists_per_game'].replace(0, 1)) if 'our_xA_total' in comparison.columns else None

print(f"\n📊 Results ({len(comparison)} matching players):")
print("=" * 70)

# xG Analysis
print("\n🎯 Expected Goals (xG) vs Actual Goals:")
print("-" * 70)
print(f"  Average xG/game: {comparison['our_xG_per_game'].mean():.3f}")
print(f"  Average actual goals/game: {comparison['actual_goals_per_game'].mean():.3f}")
print(f"  Average ratio (xG/goals): {comparison['xG_to_goals_ratio'].mean():.2f}x")
print(f"  Median ratio: {comparison['xG_to_goals_ratio'].median():.2f}x")

print("\n  Top 10 by xG:")
top_xg = comparison.nlargest(10, 'our_xG_per_game')[
    ['name', 'our_xG_per_game', 'actual_goals_per_game', 'xG_to_goals_ratio']
]
print(top_xg.to_string(index=False))

# xA Analysis
print("\n\n🎯 Expected Assists (xA) vs Actual Assists:")
print("-" * 70)
if has_xa_column and 'our_xA_total' in comparison.columns:
    xa_players = comparison[comparison['our_xA_per_game'] > 0]
    if len(xa_players) > 0:
        print(f"  Players with xA: {len(xa_players)}")
        print(f"  Average xA/game: {xa_players['our_xA_per_game'].mean():.3f}")
        print(f"  Average actual assists/game: {xa_players['actual_assists_per_game'].mean():.3f}")
        if 'xA_to_assists_ratio' in xa_players.columns and xa_players['xA_to_assists_ratio'].notna().any():
            print(f"  Average ratio (xA/assists): {xa_players['xA_to_assists_ratio'].mean():.2f}x")
            print(f"  Median ratio: {xa_players['xA_to_assists_ratio'].median():.2f}x")
        
        print("\n  Top 10 by xA:")
        top_xa = xa_players.nlargest(10, 'our_xA_per_game')[
            ['name', 'our_xA_per_game', 'actual_assists_per_game']
        ]
        if 'xA_to_assists_ratio' in top_xa.columns:
            top_xa = top_xa[['name', 'our_xA_per_game', 'actual_assists_per_game', 'xA_to_assists_ratio']]
        print(top_xa.to_string(index=False))
    else:
        print("  ⚠️  No players with xA data found")
else:
    print("  ⚠️  xA column (I_F_xAssists) not found in database. Skipping xA analysis.")
    print("      Run the migration: supabase/migrations/20250110000000_add_xassists_column.sql")

# Overall assessment
print("\n\n✅ Model Assessment:")
print("-" * 70)
xg_median_ratio = comparison['xG_to_goals_ratio'].median()
print(f"  xG Model: {'✅ Reasonable' if 0.8 < xg_median_ratio < 1.5 else '⚠️  Needs calibration'} (median ratio: {xg_median_ratio:.2f}x)")
if has_xa_column and 'our_xA_total' in comparison.columns:
    xa_players = comparison[comparison['our_xA_per_game'] > 0]
    if len(xa_players) > 0 and 'xA_to_assists_ratio' in xa_players.columns and xa_players['xA_to_assists_ratio'].notna().any():
        xa_median_ratio = xa_players['xA_to_assists_ratio'].median()
        print(f"  xA Model: {'✅ Reasonable' if 0.8 < xa_median_ratio < 1.5 else '⚠️  Needs calibration'} (median ratio: {xa_median_ratio:.2f}x)")
    else:
        print(f"  xA Model: ⚠️  No xA data available for analysis")

print("\n📝 Note: Our data is from 1 day (13 games) vs staging full season data.")
print("   Ratios should be interpreted in context of sample size difference.")

