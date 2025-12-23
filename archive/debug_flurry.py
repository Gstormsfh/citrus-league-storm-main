#!/usr/bin/env python3
"""Debug flurry adjustment."""
import pandas as pd
from feature_calculations import calculate_flurry_adjusted_xg

df = pd.DataFrame({
    'game_id': [2025020001, 2025020001],
    'team_code': ['TOR', 'TOR'],
    'period': [1, 1],
    'time_in_period': ['10:00', '10:02'],
    'time_since_last_event': [5.0, 2.0],
    'xG_Value': [0.10, 0.15]
})

print("Input DataFrame:")
print(df)
print("\nTime calculation:")
df['_time'] = df['time_in_period'].apply(lambda x: int(x.split(':')[0])*60 + int(x.split(':')[1]))
print(df[['time_in_period', '_time', 'time_since_last_event']])
print(f"\nTime diff: {df['_time'].iloc[1] - df['_time'].iloc[0]} seconds (should be <= 3.0)")

print("\n" + "="*80)
print("Running flurry adjustment...")

# Add debug version
import pandas as pd
import numpy as np

df_test = df.copy()
xg_column = 'xG_Value'
game_id_col = 'game_id'
team_code_col = 'team_code'
period_col = 'period'
time_in_period_col = 'time_in_period'
time_since_last_event_col = 'time_since_last_event'
flurry_boost_factor = 1.15

def parse_time_to_seconds(time_str):
    if pd.isna(time_str) or not time_str or ':' not in str(time_str):
        return 0
    try:
        parts = str(time_str).split(':')
        minutes = int(parts[0])
        seconds = int(parts[1])
        return minutes * 60 + seconds
    except (ValueError, IndexError):
        return 0

df_test['_time_seconds'] = df_test[time_in_period_col].apply(parse_time_to_seconds)
df_test['flurry_adjusted_xg'] = pd.to_numeric(df_test[xg_column], errors='coerce').fillna(0.0)

print(f"\nDebug: Grouping by {game_id_col}, {team_code_col}, {period_col}")
for (game_id, team_code, period), group in df_test.groupby([game_id_col, team_code_col, period_col]):
    print(f"\nGroup: game_id={game_id}, team={team_code}, period={period}")
    print(f"  Group size: {len(group)}")
    if len(group) < 2:
        print("  Skipping (need 2+ shots)")
        continue
    
    group_sorted = group.sort_values('_time_seconds')
    print(f"  Sorted group indices: {group_sorted.index.tolist()}")
    print(f"  Times: {group_sorted['_time_seconds'].tolist()}")
    
    flurry_sequence = []
    for i in range(len(group_sorted)):
        current_idx = group_sorted.index[i]
        current_time = group_sorted.loc[current_idx, '_time_seconds']
        current_xg = group_sorted.loc[current_idx, xg_column]
        print(f"\n  Shot {i}: idx={current_idx}, time={current_time}, xg={current_xg}")
        
        if not flurry_sequence:
            flurry_sequence = [{'idx': current_idx, 'time': current_time, 'xg': current_xg}]
            print(f"    Starting flurry sequence")
            continue
        
        last_shot = flurry_sequence[-1]
        time_diff = current_time - last_shot['time']
        print(f"    Time diff from last: {time_diff} seconds")
        
        if time_since_last_event_col in group_sorted.columns:
            time_since_last = group_sorted.loc[current_idx, time_since_last_event_col]
            print(f"    time_since_last_event: {time_since_last}")
            if pd.notna(time_since_last) and time_since_last > 0:
                time_diff = min(time_diff, time_since_last) if time_diff > 0 else time_since_last
                print(f"    Using min: {time_diff} seconds")
        
        if 0 < time_diff <= 3.0:
            print(f"    ✅ FLURRY DETECTED (time_diff={time_diff} <= 3.0)")
            flurry_sequence.append({'idx': current_idx, 'time': current_time, 'xg': current_xg})
        else:
            print(f"    ❌ Not a flurry (time_diff={time_diff} > 3.0)")
            if len(flurry_sequence) > 1:
                print(f"    Processing flurry with {len(flurry_sequence)} shots")
                for j, shot in enumerate(flurry_sequence):
                    if j > 0:
                        boosted = shot['xg'] * flurry_boost_factor
                        boosted = min(max(boosted, shot['xg']), 0.95)
                        print(f"      Shot {j} (idx={shot['idx']}): {shot['xg']} → {boosted}")
                        df_test.loc[shot['idx'], 'flurry_adjusted_xg'] = boosted
            flurry_sequence = [{'idx': current_idx, 'time': current_time, 'xg': current_xg}]
    
    if len(flurry_sequence) > 1:
        print(f"\n  Processing final flurry with {len(flurry_sequence)} shots")
        for j, shot in enumerate(flurry_sequence):
            if j > 0:
                boosted = shot['xg'] * flurry_boost_factor
                boosted = min(max(boosted, shot['xg']), 0.95)
                print(f"    Shot {j} (idx={shot['idx']}): {shot['xg']} → {boosted}")
                df_test.loc[shot['idx'], 'flurry_adjusted_xg'] = boosted

result = df_test

print("\nOutput DataFrame:")
print(result[['time_in_period', 'xG_Value', 'flurry_adjusted_xg']])
print(f"\nExpected second shot: 0.15 * 1.15 = {0.15 * 1.15:.4f}")
print(f"Actual second shot: {result['flurry_adjusted_xg'].iloc[1]:.4f}")

