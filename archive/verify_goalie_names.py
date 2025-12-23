#!/usr/bin/env python3
"""Verify goalie names are available for GSAx data."""

import pandas as pd
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

# Load GSAx data
gsax_df = pd.read_csv('goalie_gsax.csv')

# Load goalie names from staging
print("Loading goalie names from staging_2025_goalies...")
response = supabase.table('staging_2025_goalies').select('playerId, name, team').execute()
goalies_df = pd.DataFrame(response.data)

print(f"\nFound {len(goalies_df)} goalies in staging table")
print(f"Found {len(gsax_df)} goalies in GSAx data")

# Convert types for merge
gsax_df['goalie_id'] = gsax_df['goalie_id'].astype(int)
goalies_df['playerId'] = pd.to_numeric(goalies_df['playerId'], errors='coerce').astype('Int64')

# Merge to get names
merged = gsax_df.merge(
    goalies_df,
    left_on='goalie_id',
    right_on='playerId',
    how='left'
)

# Check coverage
with_names = merged['name'].notna().sum()
missing_names = merged['name'].isna().sum()

print(f"\n✅ Goalies with names: {with_names} ({with_names/len(merged)*100:.1f}%)")
if missing_names > 0:
    print(f"⚠️  Goalies missing names: {missing_names} ({missing_names/len(merged)*100:.1f}%)")
    print("\nMissing names for goalie IDs:")
    missing = merged[merged['name'].isna()][['goalie_id', 'regressed_gsax']]
    print(missing.to_string(index=False))

print("\n" + "=" * 80)
print("SAMPLE: Top 5 Goalies with Names")
print("=" * 80)
top_5 = merged.nlargest(5, 'regressed_gsax')[['goalie_id', 'name', 'team', 'regressed_gsax']].drop_duplicates(subset='goalie_id')
for _, row in top_5.iterrows():
    name = row['name'] if pd.notna(row['name']) else 'UNKNOWN'
    team = row['team'] if pd.notna(row['team']) else 'N/A'
    print(f"  {int(row['goalie_id']):8d}: {name:30s} ({team:3s}) - GSAx: {row['regressed_gsax']:6.2f}")

print("\n" + "=" * 80)
print("CONCLUSION")
print("=" * 80)
if missing_names == 0:
    print("✅ All goalies have names available in staging table")
    print("✅ App can join goalie_gsax.goalie_id with staging_2025_goalies.playerId to get names")
else:
    print(f"⚠️  {missing_names} goalies missing names (may be inactive or not in staging)")

