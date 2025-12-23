#!/usr/bin/env python3
"""Quick data quality check for optimization."""

import pandas as pd
import numpy as np

df = pd.read_csv('data/our_shots_2025.csv')

print("=" * 80)
print("DATA QUALITY CHECK FOR OPTIMIZATION")
print("=" * 80)

# Check time_since_last_event
print("\ntime_since_last_event:")
print(f"  Total: {len(df)}")
print(f"  Zero: {(df['time_since_last_event'] == 0).sum()} ({(df['time_since_last_event'] == 0).sum()/len(df)*100:.1f}%)")
print(f"  Non-zero: {(df['time_since_last_event'] > 0).sum()} ({(df['time_since_last_event'] > 0).sum()/len(df)*100:.1f}%)")
if (df['time_since_last_event'] > 0).sum() > 0:
    non_zero = df[df['time_since_last_event'] > 0]['time_since_last_event']
    print(f"  Mean (non-zero): {non_zero.mean():.2f}")
    print(f"  Std (non-zero): {non_zero.std():.2f}")

# Check speed_from_last_event
print("\nspeed_from_last_event:")
print(f"  Missing: {df['speed_from_last_event'].isna().sum()}")
print(f"  Zero: {(df['speed_from_last_event'] == 0).sum()} ({(df['speed_from_last_event'] == 0).sum()/len(df)*100:.1f}%)")
print(f"  Non-zero: {(df['speed_from_last_event'] > 0).sum()} ({(df['speed_from_last_event'] > 0).sum()/len(df)*100:.1f}%)")
if (df['speed_from_last_event'] > 0).sum() > 0:
    non_zero = df[df['speed_from_last_event'] > 0]['speed_from_last_event']
    print(f"  Mean (non-zero): {non_zero.mean():.2f}")
    print(f"  Std (non-zero): {non_zero.std():.2f}")

# Check is_power_play
print("\nis_power_play:")
print(f"  True: {(df['is_power_play'] == 1).sum()} ({(df['is_power_play'] == 1).sum()/len(df)*100:.1f}%)")
print(f"  False: {(df['is_power_play'] == 0).sum()} ({(df['is_power_play'] == 0).sum()/len(df)*100:.1f}%)")

# Check is_empty_net
print("\nis_empty_net:")
print(f"  True: {(df['is_empty_net'] == True).sum()} ({(df['is_empty_net'] == True).sum()/len(df)*100:.1f}%)")
print(f"  False: {(df['is_empty_net'] == False).sum()} ({(df['is_empty_net'] == False).sum()/len(df)*100:.1f}%)")

# Check distance_from_last_event
print("\ndistance_from_last_event:")
print(f"  Zero: {(df['distance_from_last_event'] == 0).sum()} ({(df['distance_from_last_event'] == 0).sum()/len(df)*100:.1f}%)")
print(f"  Non-zero: {(df['distance_from_last_event'] > 0).sum()} ({(df['distance_from_last_event'] > 0).sum()/len(df)*100:.1f}%)")

print("\n" + "=" * 80)
print("RECOMMENDATIONS:")
print("=" * 80)

if (df['time_since_last_event'] == 0).sum() > len(df) * 0.5:
    print("⚠️  time_since_last_event is mostly 0 - this explains low importance")
    print("   → Need to ensure last event tracking is working correctly")

if (df['speed_from_last_event'] == 0).sum() > len(df) * 0.8:
    print("⚠️  speed_from_last_event is mostly 0 - recalculation needed")
    print("   → Fixed in retrain script, but may need data reprocessing")

if (df['is_power_play'] == 1).sum() < len(df) * 0.1:
    print("ℹ️  is_power_play is rare (<10%) - low variance explains 0 importance")
    print("   → This is expected (power plays are uncommon)")

if (df['is_empty_net'] == True).sum() < len(df) * 0.05:
    print("ℹ️  is_empty_net is rare (<5%) - low variance explains 0 importance")
    print("   → This is expected (empty net situations are uncommon)")

