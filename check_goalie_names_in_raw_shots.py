#!/usr/bin/env python3
"""Check if goalie names are available in raw_shots table."""

import pandas as pd
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

print("=" * 80)
print("CHECKING GOALIE NAMES IN RAW_SHOTS TABLE")
print("=" * 80)

# Sample raw_shots data
print("\nSampling raw_shots table...")
response = supabase.table('raw_shots').select('goalie_id, goalie_name').not_.is_('goalie_id', 'null').limit(1000).execute()
df = pd.DataFrame(response.data)

print(f"Total rows sampled: {len(df)}")
print(f"Rows with goalie_id: {df['goalie_id'].notna().sum()}")
print(f"Rows with goalie_name: {df['goalie_name'].notna().sum()}")

if df['goalie_name'].notna().sum() > 0:
    print(f"\n✅ Goalie names ARE available in raw_shots!")
    print(f"   Coverage: {df['goalie_name'].notna().sum() / len(df) * 100:.1f}%")
    print("\nSample goalie names:")
    sample = df[df['goalie_name'].notna()].head(10)
    for _, row in sample.iterrows():
        print(f"   {int(row['goalie_id']):8d}: {row['goalie_name']}")
    
    # Get unique goalies with names
    unique_goalies = df[df['goalie_name'].notna()].drop_duplicates(subset='goalie_id')
    print(f"\nUnique goalies with names in sample: {len(unique_goalies)}")
else:
    print("\n⚠️  Goalie names are NOT populated in raw_shots")
    print("   The column exists but is NULL")
    print("   Need to populate from NHL API or roster data")

# Check if we can get goalie names from goalie_id aggregation
print("\n" + "=" * 80)
print("AGGREGATING GOALIE NAMES FROM RAW_SHOTS")
print("=" * 80)

# Get unique goalie_id, goalie_name pairs
if df['goalie_name'].notna().sum() > 0:
    goalie_names = df[df['goalie_name'].notna()].groupby('goalie_id')['goalie_name'].first().reset_index()
    print(f"\nFound {len(goalie_names)} unique goalies with names")
    print("\nSample:")
    print(goalie_names.head(10).to_string(index=False))
    
    # Compare with GSAx data
    gsax_df = pd.read_csv('goalie_gsax.csv')
    merged = gsax_df.merge(goalie_names, left_on='goalie_id', right_on='goalie_id', how='left')
    with_names = merged['goalie_name'].notna().sum()
    print(f"\n✅ GSAx goalies with names from raw_shots: {with_names} / {len(merged)} ({with_names/len(merged)*100:.1f}%)")
else:
    print("\n⚠️  Cannot aggregate - goalie_name column is empty")
    print("   Recommendation: Populate goalie_name when processing shots")

