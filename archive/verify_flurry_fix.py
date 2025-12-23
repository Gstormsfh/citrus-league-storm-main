#!/usr/bin/env python3
"""Verify flurry adjustment is working correctly on real data."""
import pandas as pd
from feature_calculations import calculate_flurry_adjusted_xg

# Load sample data
df = pd.read_csv('data/our_shots_2025.csv', nrows=1000)
df['xG_Value'] = df['xg_value']  # Map to expected column name

# Run flurry adjustment
result = calculate_flurry_adjusted_xg(df, flurry_boost_factor=1.15)

# Check results
boosted = (result['flurry_adjusted_xg'] > result['xG_Value']).sum()
unchanged = (result['flurry_adjusted_xg'] == result['xG_Value']).sum()
decreased = (result['flurry_adjusted_xg'] < result['xG_Value']).sum()
over_cap = (result['flurry_adjusted_xg'] > 0.95).sum()

print("=" * 80)
print("FLURRY ADJUSTMENT VERIFICATION")
print("=" * 80)
print(f"\n📊 Results from {len(result):,} shots:")
print(f"   ✅ Boosted shots: {boosted:,} ({boosted/len(result)*100:.1f}%)")
print(f"   ✅ Unchanged shots: {unchanged:,} ({unchanged/len(result)*100:.1f}%)")
print(f"   ❌ Decreased shots: {decreased:,} ({decreased/len(result)*100:.1f}%)")
print(f"   ⚠️  Over cap (0.95): {over_cap:,} ({over_cap/len(result)*100:.1f}%)")

if decreased > 0:
    print(f"\n❌ ERROR: {decreased} shots decreased (should not happen with boosting!)")
else:
    print(f"\n✅ PASS: No shots decreased (boosting working correctly)")

if over_cap > 0:
    print(f"\n❌ ERROR: {over_cap} shots exceed 0.95 cap")
else:
    print(f"✅ PASS: All shots capped at 0.95 or below")

# Show sample boosted shots
if boosted > 0:
    print(f"\n📊 Sample of boosted shots:")
    boosted_shots = result[result['flurry_adjusted_xg'] > result['xG_Value']].head(5)
    for idx, row in boosted_shots.iterrows():
        boost_pct = ((row['flurry_adjusted_xg'] / row['xG_Value']) - 1) * 100
        print(f"   xG: {row['xG_Value']:.4f} → {row['flurry_adjusted_xg']:.4f} (+{boost_pct:.1f}%)")

print("\n" + "=" * 80)
print("✅ VERIFICATION COMPLETE")
print("=" * 80)

