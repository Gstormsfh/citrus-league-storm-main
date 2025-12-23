#!/usr/bin/env python3
"""Analyze the impact of post-processing calibration for high xG bin."""

import pandas as pd

# Load calibration data
df = pd.read_csv('data/shot_level_stats.csv')
high_bin = df[df['xg_bin'] == '0.5+'].iloc[0]

# Current totals
total_xg = 3077.71
total_goals = 3027

# Calculate impact
current_high_xg = high_bin['mean_predicted_xg'] * high_bin['shots']
calibrated_high_xg = high_bin['shots'] * high_bin['actual_goal_rate']
reduction = current_high_xg - calibrated_high_xg
new_total = total_xg - reduction
new_ratio = new_total / total_goals

print("=" * 80)
print("POST-PROCESSING CALIBRATION IMPACT ANALYSIS")
print("=" * 80)

print(f"\nHigh xG Bin (0.5+) Details:")
print(f"  Shots: {int(high_bin['shots'])}")
print(f"  Current Predicted: {high_bin['mean_predicted_xg']:.1%}")
print(f"  Actual Goal Rate: {high_bin['actual_goal_rate']:.1%}")
print(f"  Gap: {(high_bin['mean_predicted_xg'] - high_bin['actual_goal_rate'])*100:.1f}%")

print(f"\nTotal xG Impact:")
print(f"  Current total xG in 0.5+ bin: {current_high_xg:.2f}")
print(f"  Calibrated total xG: {calibrated_high_xg:.2f}")
print(f"  Reduction: {reduction:.2f} xG ({reduction/total_xg*100:.2f}% of total)")

print(f"\nOverall Calibration Impact:")
print(f"  Current ratio: {total_xg/total_goals:.3f}x")
print(f"  After calibration: {new_ratio:.3f}x")
print(f"  Change: {(new_ratio - total_xg/total_goals)*100:+.2f} percentage points")

print(f"\n📊 Assessment:")
print(f"  ✅ Would improve 0.5+ bin calibration (15.7% gap → 0%)")
print(f"  ⚠️  Minimal impact on overall calibration ({total_xg/total_goals:.3f}x → {new_ratio:.3f}x)")
print(f"  ⚠️  Only affects {int(high_bin['shots'])} shots ({high_bin['shots']/41524*100:.2f}% of total)")
print(f"  ⚠️  Very small sample size ({int(high_bin['shots'])} shots)")

print(f"\n💡 Recommendation:")
if reduction/total_xg < 0.01:  # Less than 1% impact
    print("  ⚠️  MARGINAL IMPROVEMENT - Not recommended")
    print("     - Impact is < 0.4% of total xG")
    print("     - Overall calibration already excellent (1.017x)")
    print("     - Very small sample size (70 shots) makes calibration unreliable")
    print("     - Risk of overfitting to small sample")
else:
    print("  ✅ WORTH IMPLEMENTING")
    print("     - Significant impact on total xG")
    print("     - Would improve high-danger shot calibration")

print("\n" + "=" * 80)

