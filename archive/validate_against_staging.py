# validate_against_staging.py
# Compare our calculated xG values against staging_2025_skaters data

import os
from dotenv import load_dotenv
from supabase import create_client, Client
import pandas as pd

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("🔍 Validating xG Calculations Against Staging Data")
print("=" * 70)

# Get our calculated xG data (aggregated by player)
print("\n1. Fetching our calculated xG data from raw_player_stats...")
our_data = supabase.table('raw_player_stats').select('playerId, game_id, I_F_xGoals').execute()

if not our_data.data:
    print("❌ No data found in raw_player_stats")
    exit()

# Aggregate by player (sum across all games)
our_df = pd.DataFrame(our_data.data)
our_aggregated = our_df.groupby('playerId')['I_F_xGoals'].sum().reset_index()
our_aggregated.columns = ['playerId', 'our_xG_total']
print(f"   Found {len(our_aggregated)} unique players")

# Get staging data
print("\n2. Fetching staging_2025_skaters data...")
try:
    staging_data = supabase.table('staging_2025_skaters').select(
        'playerId, name, I_F_xGoals, games_played, situation'
    ).eq('situation', 'all').execute()
    
    if not staging_data.data:
        print("⚠️  No data found with situation='all', trying all situations...")
        staging_data = supabase.table('staging_2025_skaters').select(
            'playerId, name, I_F_xGoals, games_played, situation'
        ).limit(100).execute()
    
    staging_df = pd.DataFrame(staging_data.data)
    
    # If multiple situations, we might need to sum them
    if 'situation' in staging_df.columns:
        staging_agg = staging_df.groupby('playerId').agg({
            'I_F_xGoals': 'sum',
            'games_played': 'max',  # Games played should be same across situations
            'name': 'first'
        }).reset_index()
        staging_agg.columns = ['playerId', 'staging_xG_total', 'games_played', 'name']
    else:
        staging_agg = staging_df[['playerId', 'I_F_xGoals', 'games_played', 'name']].copy()
        staging_agg.columns = ['playerId', 'staging_xG_total', 'games_played', 'name']
    
    print(f"   Found {len(staging_agg)} players in staging data")
    
except Exception as e:
    print(f"❌ Error fetching staging data: {e}")
    exit()

# Merge and compare
print("\n3. Comparing data...")
# Ensure playerId types match (convert to same type)
our_aggregated['playerId'] = our_aggregated['playerId'].astype(str)
staging_agg['playerId'] = staging_agg['playerId'].astype(str)

comparison = our_aggregated.merge(
    staging_agg[['playerId', 'staging_xG_total', 'games_played', 'name']],
    on='playerId',
    how='inner'
)

if len(comparison) == 0:
    print("⚠️  No matching playerIds found between our data and staging data")
    print("   This might be because:")
    print("   - Player IDs are stored differently (string vs number)")
    print("   - We only have 13 games vs full season data")
    exit()

# Calculate per-game averages (ensure numeric types)
comparison['our_xG_total'] = pd.to_numeric(comparison['our_xG_total'], errors='coerce')
comparison['staging_xG_total'] = pd.to_numeric(comparison['staging_xG_total'], errors='coerce')
comparison['games_played'] = pd.to_numeric(comparison['games_played'], errors='coerce')

comparison['our_xG_per_game'] = comparison['our_xG_total'] / 1  # We have 1 day of data
comparison['staging_xG_per_game'] = comparison['staging_xG_total'] / comparison['games_played']
comparison['difference'] = comparison['our_xG_per_game'] - comparison['staging_xG_per_game']
comparison['ratio'] = comparison['our_xG_per_game'] / comparison['staging_xG_per_game']

print(f"\n📊 Comparison Results ({len(comparison)} matching players):")
print("=" * 70)
print(f"\nTop 10 players by our xG:")
top_our = comparison.nlargest(10, 'our_xG_per_game')[['name', 'our_xG_per_game', 'staging_xG_per_game', 'ratio']]
print(top_our.to_string(index=False))

print(f"\n\nStatistics:")
print(f"  Our avg xG/game: {comparison['our_xG_per_game'].mean():.3f}")
print(f"  Staging avg xG/game: {comparison['staging_xG_per_game'].mean():.3f}")
print(f"  Average ratio (our/staging): {comparison['ratio'].mean():.2f}x")
print(f"  Median ratio: {comparison['ratio'].median():.2f}x")

# Flag outliers
outliers = comparison[comparison['ratio'] > 2.0]
if len(outliers) > 0:
    print(f"\n⚠️  {len(outliers)} players with our xG > 2x staging xG:")
    print(outliers[['name', 'our_xG_per_game', 'staging_xG_per_game', 'ratio']].to_string(index=False))

print("\n✅ Validation complete!")
print("\nNote: Our data is from 1 day (13 games) vs staging full season data.")
print("   Ratios should be interpreted in context of sample size difference.")

