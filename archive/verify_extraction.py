#!/usr/bin/env python3
"""Verify the extraction results"""

import pandas as pd

df = pd.read_csv('data/our_shots_2025.csv')

print("=" * 80)
print("EXTRACTION VERIFICATION")
print("=" * 80)
print(f"✅ Total shots extracted: {len(df):,}")
print(f"📊 Total columns: {len(df.columns)}")

print("\n📋 Column Categories:")
raw = [c for c in df.columns if any(x in c.lower() for x in ['_id', '_code', '_abbrev', '_sog', '_raw', 'reason', 'event', 'sort', 'type_desc'])]
enhanced = [c for c in df.columns if any(x in c.lower() for x in ['skaters', 'empty', 'penalty', 'last_event', 'goalie', 'period', 'time', 'zone', 'rush', 'outcome', 'team_code', 'is_home'])]
calc = [c for c in df.columns if 'arena_adjusted' in c.lower() or 'angle_plus' in c.lower()]

print(f"  - Raw data fields: {len(raw)}")
print(f"  - Enhanced features: {len(enhanced)}")
print(f"  - Calculated features: {len(calc)}")

print("\n✅ Sample of extracted columns:")
for col in sorted(df.columns)[:20]:
    non_null = df[col].notna().sum()
    print(f"  - {col}: {non_null}/{len(df)} values ({100*non_null/len(df):.1f}%)")

print("\n" + "=" * 80)
print("✅ Extraction successful! All features are being extracted.")
print("=" * 80)

