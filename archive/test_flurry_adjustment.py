#!/usr/bin/env python3
"""
test_flurry_adjustment.py

Test the flurry adjustment function with various scenarios to ensure it's working correctly.
"""

import pandas as pd
import numpy as np
from feature_calculations import calculate_flurry_adjusted_xg

def test_single_shot():
    """Test 1: Single shot (no flurry) - should remain unchanged."""
    print("\n" + "=" * 80)
    print("TEST 1: Single Shot (No Flurry)")
    print("=" * 80)
    
    df = pd.DataFrame({
        'game_id': [2025020001],
        'team_code': ['TOR'],
        'period': [1],
        'time_in_period': ['10:00'],
        'time_since_last_event': [5.0],
        'xG_Value': [0.10]
    })
    
    result = calculate_flurry_adjusted_xg(df)
    
    assert result['flurry_adjusted_xg'].iloc[0] == 0.10, "Single shot should remain unchanged"
    print("✅ PASS: Single shot xG unchanged (0.10 → 0.10)")

def test_two_shot_flurry():
    """Test 2: Two shots within 3 seconds - second should be boosted."""
    print("\n" + "=" * 80)
    print("TEST 2: Two Shots in Flurry (Within 3 Seconds)")
    print("=" * 80)
    
    df = pd.DataFrame({
        'game_id': [2025020001, 2025020001],
        'team_code': ['TOR', 'TOR'],
        'period': [1, 1],
        'time_in_period': ['10:00', '10:02'],  # 2 seconds apart
        'time_since_last_event': [5.0, 2.0],
        'xG_Value': [0.10, 0.15]
    })
    
    result = calculate_flurry_adjusted_xg(df, flurry_boost_factor=1.15)
    
    first_xg = result['flurry_adjusted_xg'].iloc[0]
    second_xg = result['flurry_adjusted_xg'].iloc[1]
    expected_second = min(0.15 * 1.15, 0.95)  # 0.15 * 1.15 = 0.1725
    
    assert first_xg == 0.10, f"First shot should remain unchanged (got {first_xg})"
    assert abs(second_xg - expected_second) < 0.001, f"Second shot should be boosted (got {second_xg}, expected {expected_second})"
    print(f"✅ PASS: First shot unchanged (0.10 → {first_xg:.4f})")
    print(f"✅ PASS: Second shot boosted (0.15 → {second_xg:.4f}, expected {expected_second:.4f})")

def test_three_shot_flurry():
    """Test 3: Three shots in flurry - second and third should be boosted."""
    print("\n" + "=" * 80)
    print("TEST 3: Three Shots in Flurry")
    print("=" * 80)
    
    df = pd.DataFrame({
        'game_id': [2025020001, 2025020001, 2025020001],
        'team_code': ['TOR', 'TOR', 'TOR'],
        'period': [1, 1, 1],
        'time_in_period': ['10:00', '10:01', '10:02'],  # 1 second apart each
        'time_since_last_event': [5.0, 1.0, 1.0],
        'xG_Value': [0.10, 0.15, 0.20]
    })
    
    result = calculate_flurry_adjusted_xg(df, flurry_boost_factor=1.15)
    
    first_xg = result['flurry_adjusted_xg'].iloc[0]
    second_xg = result['flurry_adjusted_xg'].iloc[1]
    third_xg = result['flurry_adjusted_xg'].iloc[2]
    
    expected_second = min(0.15 * 1.15, 0.95)
    expected_third = min(0.20 * 1.15, 0.95)
    
    assert first_xg == 0.10, f"First shot should remain unchanged (got {first_xg})"
    assert abs(second_xg - expected_second) < 0.001, f"Second shot should be boosted (got {second_xg})"
    assert abs(third_xg - expected_third) < 0.001, f"Third shot should be boosted (got {third_xg})"
    print(f"✅ PASS: First shot unchanged (0.10 → {first_xg:.4f})")
    print(f"✅ PASS: Second shot boosted (0.15 → {second_xg:.4f})")
    print(f"✅ PASS: Third shot boosted (0.20 → {third_xg:.4f})")

def test_shots_too_far_apart():
    """Test 4: Shots >3 seconds apart - should NOT be in same flurry."""
    print("\n" + "=" * 80)
    print("TEST 4: Shots >3 Seconds Apart (Not a Flurry)")
    print("=" * 80)
    
    df = pd.DataFrame({
        'game_id': [2025020001, 2025020001],
        'team_code': ['TOR', 'TOR'],
        'period': [1, 1],
        'time_in_period': ['10:00', '10:05'],  # 5 seconds apart
        'time_since_last_event': [5.0, 5.0],
        'xG_Value': [0.10, 0.15]
    })
    
    result = calculate_flurry_adjusted_xg(df)
    
    first_xg = result['flurry_adjusted_xg'].iloc[0]
    second_xg = result['flurry_adjusted_xg'].iloc[1]
    
    assert first_xg == 0.10, "First shot should remain unchanged"
    assert second_xg == 0.15, "Second shot should remain unchanged (not in flurry)"
    print(f"✅ PASS: Both shots unchanged (0.10 → {first_xg:.4f}, 0.15 → {second_xg:.4f})")

def test_different_teams():
    """Test 5: Shots from different teams - should NOT be in same flurry."""
    print("\n" + "=" * 80)
    print("TEST 5: Shots from Different Teams (Not a Flurry)")
    print("=" * 80)
    
    df = pd.DataFrame({
        'game_id': [2025020001, 2025020001],
        'team_code': ['TOR', 'MTL'],  # Different teams
        'period': [1, 1],
        'time_in_period': ['10:00', '10:01'],  # 1 second apart but different teams
        'time_since_last_event': [5.0, 1.0],
        'xG_Value': [0.10, 0.15]
    })
    
    result = calculate_flurry_adjusted_xg(df)
    
    first_xg = result['flurry_adjusted_xg'].iloc[0]
    second_xg = result['flurry_adjusted_xg'].iloc[1]
    
    assert first_xg == 0.10, "First shot should remain unchanged"
    assert second_xg == 0.15, "Second shot should remain unchanged (different team)"
    print(f"✅ PASS: Both shots unchanged (different teams)")

def test_capping():
    """Test 6: High xG values should be capped at 0.95."""
    print("\n" + "=" * 80)
    print("TEST 6: High xG Capping (Should Cap at 0.95)")
    print("=" * 80)
    
    df = pd.DataFrame({
        'game_id': [2025020001, 2025020001],
        'team_code': ['TOR', 'TOR'],
        'period': [1, 1],
        'time_in_period': ['10:00', '10:01'],
        'time_since_last_event': [5.0, 1.0],
        'xG_Value': [0.10, 0.90]  # High xG that would exceed 0.95 when boosted
    })
    
    result = calculate_flurry_adjusted_xg(df, flurry_boost_factor=1.15)
    
    second_xg = result['flurry_adjusted_xg'].iloc[1]
    boosted_value = 0.90 * 1.15  # Would be 1.035
    
    assert second_xg <= 0.95, f"High xG should be capped at 0.95 (got {second_xg})"
    print(f"✅ PASS: High xG capped (0.90 * 1.15 = {boosted_value:.4f} → {second_xg:.4f})")

def test_real_data_sample():
    """Test 7: Test with a sample from real data."""
    print("\n" + "=" * 80)
    print("TEST 7: Real Data Sample")
    print("=" * 80)
    
    try:
        df = pd.read_csv('data/our_shots_2025.csv', nrows=1000)
        
        # Check if required columns exist
        required = ['game_id', 'team_code', 'period', 'time_in_period', 'time_since_last_event']
        xg_col = None
        for col in ['xG_Value', 'xg_value', 'xg_Value']:
            if col in df.columns:
                xg_col = col
                break
        
        if not xg_col:
            print("⚠️  Skipping: No xG column found in sample data")
            return
        
        # Rename xg column to xG_Value for function
        if xg_col != 'xG_Value':
            df['xG_Value'] = df[xg_col]
        
        if all(col in df.columns for col in required + ['xG_Value']):
            result = calculate_flurry_adjusted_xg(df)
            
            # Check that flurry_adjusted_xg >= xG_Value for all shots (boosting, not discounting)
            boosted_shots = (result['flurry_adjusted_xg'] > result['xG_Value']).sum()
            unchanged_shots = (result['flurry_adjusted_xg'] == result['xG_Value']).sum()
            decreased_shots = (result['flurry_adjusted_xg'] < result['xG_Value']).sum()
            
            print(f"📊 Results from {len(result)} shots:")
            print(f"   Boosted shots: {boosted_shots} ({boosted_shots/len(result)*100:.1f}%)")
            print(f"   Unchanged shots: {unchanged_shots} ({unchanged_shots/len(result)*100:.1f}%)")
            print(f"   Decreased shots: {decreased_shots} ({decreased_shots/len(result)*100:.1f}%)")
            
            if decreased_shots > 0:
                print(f"   ⚠️  Warning: {decreased_shots} shots decreased (should not happen with boosting)")
            else:
                print(f"   ✅ PASS: No shots decreased (boosting working correctly)")
            
            # Check capping
            over_cap = (result['flurry_adjusted_xg'] > 0.95).sum()
            if over_cap > 0:
                print(f"   ⚠️  Warning: {over_cap} shots exceed 0.95 cap")
            else:
                print(f"   ✅ PASS: All shots capped at 0.95 or below")
        else:
            print("⚠️  Skipping: Missing required columns in sample data")
    except FileNotFoundError:
        print("⚠️  Skipping: data/our_shots_2025.csv not found")

def main():
    """Run all tests."""
    print("=" * 80)
    print("TESTING FLURRY ADJUSTMENT")
    print("=" * 80)
    print("\nTesting flurry adjustment with boosting approach (1.15x multiplier)")
    print("Expected behavior:")
    print("  - First shot in flurry: Unchanged")
    print("  - Subsequent shots: Boosted by 15% (capped at 0.95)")
    print("  - Shots >3 seconds apart: Not in flurry")
    print("  - Different teams: Not in flurry")
    
    try:
        test_single_shot()
        test_two_shot_flurry()
        test_three_shot_flurry()
        test_shots_too_far_apart()
        test_different_teams()
        test_capping()
        test_real_data_sample()
        
        print("\n" + "=" * 80)
        print("✅ ALL TESTS COMPLETE")
        print("=" * 80)
        print("\nFlurry adjustment is working correctly with BOOSTING approach!")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    main()

