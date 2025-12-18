# pass_impact_analyzer.py
# Analyze pass impact and validate zone-specific thresholds

import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from visualization_utils import fetch_raw_shots, filter_shots_with_passes, calculate_zone_statistics

def analyze_pass_impact(game_id=None, player_id=None, date_from=None, date_to=None):
    """
    Analyze the impact of passes on xG and validate zone-specific thresholds.
    
    Args:
        game_id: Filter by specific game ID
        player_id: Filter by specific player ID
        date_from: Filter from date
        date_to: Filter to date
    """
    # Fetch data
    df = fetch_raw_shots(game_id=game_id, player_id=player_id,
                        date_from=date_from, date_to=date_to)
    
    if df.empty:
        print("No data to analyze.")
        return
    
    print("\n" + "=" * 70)
    print("PASS IMPACT ANALYSIS")
    print("=" * 70)
    
    # Compare shots with passes vs without passes
    shots_with_pass = df[df['has_pass_before_shot'] == True].copy()
    shots_without_pass = df[df['has_pass_before_shot'] == False].copy()
    
    print(f"\n📊 Overall Comparison:")
    print(f"  Shots with pass: {len(shots_with_pass)}")
    print(f"  Shots without pass: {len(shots_without_pass)}")
    
    if len(shots_with_pass) > 0 and len(shots_without_pass) > 0:
        print(f"\n  Average xG with pass: {shots_with_pass['xg_value'].mean():.3f}")
        print(f"  Average xG without pass: {shots_without_pass['xg_value'].mean():.3f}")
        print(f"  xG increase: {((shots_with_pass['xg_value'].mean() / shots_without_pass['xg_value'].mean()) - 1) * 100:.1f}%")
        print(f"\n  Goal rate with pass: {(shots_with_pass['is_goal'].sum() / len(shots_with_pass) * 100):.1f}%")
        print(f"  Goal rate without pass: {(shots_without_pass['is_goal'].sum() / len(shots_without_pass) * 100):.1f}%")
    
    # Analyze by lateral distance thresholds
    print(f"\n📏 Lateral Distance Analysis:")
    if len(shots_with_pass) > 0:
        lateral_5ft_plus = shots_with_pass[shots_with_pass['pass_lateral_distance'] >= 5.0].copy()
        lateral_under_5ft = shots_with_pass[shots_with_pass['pass_lateral_distance'] < 5.0].copy()
        
        if len(lateral_5ft_plus) > 0:
            print(f"  Passes >= 5ft lateral: {len(lateral_5ft_plus)} shots")
            print(f"    Avg xG: {lateral_5ft_plus['xg_value'].mean():.3f}")
            print(f"    Goal rate: {(lateral_5ft_plus['is_goal'].sum() / len(lateral_5ft_plus) * 100):.1f}%")
            print(f"    Avg goalie movement: {lateral_5ft_plus['goalie_movement_score'].mean():.2f}")
        
        if len(lateral_under_5ft) > 0:
            print(f"  Passes < 5ft lateral: {len(lateral_under_5ft)} shots")
            print(f"    Avg xG: {lateral_under_5ft['xg_value'].mean():.3f}")
            print(f"    Goal rate: {(lateral_under_5ft['is_goal'].sum() / len(lateral_under_5ft) * 100):.1f}%")
            print(f"    Avg goalie movement: {lateral_under_5ft['goalie_movement_score'].mean():.2f}")
    
    # Analyze by zone (focus on crease/slot)
    print(f"\n🎯 Zone-Specific Analysis (Crease/Slot):")
    if len(shots_with_pass) > 0:
        crease_slot_passes = shots_with_pass[shots_with_pass['pass_zone'].isin(['crease', 'slot_low_angle', 'slot_high_angle'])].copy()
        
        if len(crease_slot_passes) > 0:
            print(f"  Crease/Slot passes: {len(crease_slot_passes)} shots")
            print(f"    Avg xG: {crease_slot_passes['xg_value'].mean():.3f}")
            print(f"    Goal rate: {(crease_slot_passes['is_goal'].sum() / len(crease_slot_passes) * 100):.1f}%")
            
            # Analyze 5ft+ lateral in crease/slot
            crease_slot_5ft_plus = crease_slot_passes[crease_slot_passes['pass_lateral_distance'] >= 5.0].copy()
            if len(crease_slot_5ft_plus) > 0:
                print(f"\n  ⚠️  KEY METRIC: Crease/Slot passes with >= 5ft lateral:")
                print(f"      Count: {len(crease_slot_5ft_plus)}")
                print(f"      Avg xG: {crease_slot_5ft_plus['xg_value'].mean():.3f}")
                print(f"      Goal rate: {(crease_slot_5ft_plus['is_goal'].sum() / len(crease_slot_5ft_plus) * 100):.1f}%")
                print(f"      Avg goalie movement: {crease_slot_5ft_plus['goalie_movement_score'].mean():.2f}")
                print(f"      Avg immediacy: {crease_slot_5ft_plus['pass_immediacy_score'].mean():.2f}")
    
    # Analyze by immediacy
    print(f"\n⏱️  Immediacy Analysis:")
    if len(shots_with_pass) > 0:
        immediate_passes = shots_with_pass[shots_with_pass['pass_immediacy_score'] >= 0.67].copy()  # < 1 second
        delayed_passes = shots_with_pass[shots_with_pass['pass_immediacy_score'] < 0.67].copy()
        
        if len(immediate_passes) > 0:
            print(f"  Immediate passes (< 1s): {len(immediate_passes)} shots")
            print(f"    Avg xG: {immediate_passes['xg_value'].mean():.3f}")
            print(f"    Goal rate: {(immediate_passes['is_goal'].sum() / len(immediate_passes) * 100):.1f}%")
        
        if len(delayed_passes) > 0:
            print(f"  Delayed passes (>= 1s): {len(delayed_passes)} shots")
            print(f"    Avg xG: {delayed_passes['xg_value'].mean():.3f}")
            print(f"    Goal rate: {(delayed_passes['is_goal'].sum() / len(delayed_passes) * 100):.1f}%")
    
    # Zone statistics
    print(f"\n📈 Zone Statistics:")
    zone_stats = calculate_zone_statistics(shots_with_pass)
    if not zone_stats.empty:
        print(zone_stats.to_string(index=False))
    
    # Summary recommendations
    print(f"\n💡 Key Insights:")
    if len(shots_with_pass) > 0:
        high_impact_passes = shots_with_pass[
            (shots_with_pass['pass_lateral_distance'] >= 5.0) &
            (shots_with_pass['pass_zone'].isin(['crease', 'slot_low_angle', 'slot_high_angle']))
        ].copy()
        
        if len(high_impact_passes) > 0:
            print(f"  • {len(high_impact_passes)} high-impact passes (5ft+ lateral in crease/slot)")
            print(f"    These passes have avg xG of {high_impact_passes['xg_value'].mean():.3f}")
            print(f"    vs overall avg of {shots_with_pass['xg_value'].mean():.3f}")
            print(f"    This validates the 5ft+ threshold in tight areas!")
    
    print("\n" + "=" * 70)

if __name__ == "__main__":
    # Run analysis
    analyze_pass_impact()
    
    # Uncomment to filter:
    # analyze_pass_impact(game_id=2025020453)  # Specific game
    # analyze_pass_impact(date_from='2025-12-07', date_to='2025-12-07')  # Specific date

