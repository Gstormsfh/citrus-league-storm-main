#!/usr/bin/env python3
"""Analyze stability test results."""

import pandas as pd
from scipy.stats import pearsonr

df = pd.read_csv('validation_results/gsax_stability_results.csv')
r, p = pearsonr(df['gsax_reg_half_a'], df['gsax_reg_half_b'])

print(f"Overall Correlation: r={r:.4f}, p={p:.4f}, n={len(df)}")
print(f"\nHigh-sample goalies (>=600 shots):")
high = df[df['total_shots'] >= 600]
print(f"  Count: {len(high)}")
if len(high) > 5:
    r_high, _ = pearsonr(high['gsax_reg_half_a'], high['gsax_reg_half_b'])
    print(f"  Correlation: {r_high:.4f}")

print(f"\nTop 5 by total_shots:")
print(high.nlargest(5, 'total_shots')[['goalie_id', 'total_shots', 'gsax_reg_half_a', 'gsax_reg_half_b', 'difference']].to_string(index=False))

