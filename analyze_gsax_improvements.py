#!/usr/bin/env python3
"""
Analyze GSAx validation results and suggest improvements to regression constant C.
"""

import pandas as pd
import numpy as np
from scipy.stats import pearsonr

def analyze_current_results():
    """Analyze current validation results."""
    print("=" * 80)
    print("CURRENT GSAX VALIDATION RESULTS")
    print("=" * 80)
    print()
    
    # Load stability results
    stability_df = pd.read_csv('validation_results/gsax_stability_results.csv')
    r_stability, p_stability = pearsonr(stability_df['gsax_reg_half_a'], stability_df['gsax_reg_half_b'])
    
    print(f"GSAx Stability Test (Split-Half):")
    print(f"  Correlation: r = {r_stability:.4f}")
    print(f"  P-value: p = {p_stability:.4f}")
    print(f"  Sample size: n = {len(stability_df)}")
    print(f"  Target: r > 0.60")
    print(f"  Status: {'PASS' if r_stability >= 0.60 else 'FAIL'}")
    print()
    
    # Load predictive results
    predictive_df = pd.read_csv('validation_results/gsax_predictive_results.csv')
    r_predictive, p_predictive = pearsonr(predictive_df['season1_gsax_reg'], predictive_df['season2_ga_aa'])
    
    print(f"GSAx Predictive Test (Year-over-Year):")
    print(f"  Correlation: r = {r_predictive:.4f}")
    print(f"  P-value: p = {p_predictive:.4f}")
    print(f"  Sample size: n = {len(predictive_df)}")
    print(f"  Target: r > 0.50")
    print(f"  Status: {'PASS' if r_predictive >= 0.50 else 'FAIL'}")
    print()
    
    return r_stability, r_predictive, stability_df, predictive_df


def suggest_improvements(r_stability, r_predictive):
    """Suggest improvements based on current correlations."""
    print("=" * 80)
    print("RECOMMENDATIONS TO IMPROVE CORRELATIONS")
    print("=" * 80)
    print()
    
    print("Current Issues:")
    print("  1. Low stability correlation (r=0.20) suggests too much regression")
    print("  2. Low predictive correlation (r=0.09) suggests metric may not capture true skill")
    print()
    
    print("Recommended Actions:")
    print()
    print("1. REDUCE REGRESSION CONSTANT C:")
    print("   - Current: C = 1,000 shots")
    print("   - Suggested: C = 500 shots (allows more variance)")
    print("   - Rationale: Lower C preserves more signal, improving stability")
    print()
    
    print("2. INCREASE MINIMUM SAMPLE SIZE:")
    print("   - Current: 200 shots for stability test")
    print("   - Suggested: 400 shots (more reliable estimates)")
    print("   - Rationale: Higher sample size reduces noise in split-half test")
    print()
    
    print("3. CONSIDER ADJUSTING REGRESSION FORMULA:")
    print("   - Current: Linear shrinkage toward 0")
    print("   - Alternative: Use league-average GSAx as prior (not 0)")
    print("   - Rationale: If league average GSAx != 0, regression should account for this")
    print()
    
    print("4. ADDITIONAL DATA NEEDED:")
    print("   - More games/seasons for predictive test (currently n=16)")
    print("   - More goalies with high shot counts for stability test")
    print()
    
    print("5. VALIDATION METHODOLOGY:")
    print("   - Ensure split-half test uses truly random splits")
    print("   - Consider using time-based splits (first half vs second half of season)")
    print("   - For predictive test, ensure Season 2 data is truly future data")
    print()


def test_different_c_values():
    """Test how different C values would affect correlations (theoretical)."""
    print("=" * 80)
    print("THEORETICAL IMPACT OF DIFFERENT C VALUES")
    print("=" * 80)
    print()
    print("Lower C values:")
    print("  - Preserve more variance in GSAx")
    print("  - Should improve stability correlation (more signal preserved)")
    print("  - May increase noise for low-sample goalies")
    print()
    print("Higher C values:")
    print("  - More regression toward league average")
    print("  - Reduces variance (may hurt stability correlation)")
    print("  - Better for low-sample goalies (less noise)")
    print()
    print("Optimal C typically ranges from 300-800 shots in NHL analytics")
    print("Current C=1000 is on the conservative/high side")
    print()


if __name__ == "__main__":
    r_stab, r_pred, stab_df, pred_df = analyze_current_results()
    suggest_improvements(r_stab, r_pred)
    test_different_c_values()
    
    print("=" * 80)
    print("NEXT STEPS")
    print("=" * 80)
    print()
    print("1. Modify calculate_goalie_gsax.py to use C=500 instead of C=1000")
    print("2. Re-run calculate_goalie_gsax.py to regenerate GSAx values")
    print("3. Re-run validation tests with new C value")
    print("4. Compare correlations - should see improvement in stability test")
    print()

