# GSAx and GAR Validation Report

**Generated:** 2025-12-13 16:04:34

---

## Executive Summary

- **GSAx Stability (Split-Half):** ⚠️ WARNING (r = 0.2005, n = 67)
- **GSAx Predictive Power:** ⚠️ WARNING (r = 0.0941, n = 16)

**Overall Status:** ⚠️ Some tests need attention

---

## Detailed Results

### 1. GSAx Stability Test (Split-Half Correlation)

- **Correlation:** 0.2005
- **P-value:** 0.1039
- **Sample Size:** 67 goalies
- **Success Threshold:** r > 0.60
- **Status:** ⚠️ WARNING

**Interpretation:**
- Low stability - metric may be too noisy or regression needs tuning
- Possible causes: small sample size, high variance in goalie performance, or regression constant (C) needs adjustment

**Visualization:** `validation_results/gsax_stability_scatter.png`

### 2. GSAx Predictive Test (Future Performance)

- **Correlation:** 0.0941
- **P-value:** 0.7289
- **Sample Size:** 16 goalies
- **Success Threshold:** r > 0.50
- **Status:** ⚠️ WARNING

**Interpretation:**
- Low predictive power - metric may need refinement
- Note: Small sample size (n=16) may limit statistical power
- Consider: Increasing minimum games requirement or using full season splits

**Visualization:** `validation_results/gsax_predictive_scatter.png`

### 3. GAR Team Correlation Test

⚠️ Results not available. GAR implementation required. Run `validate_gar_team_correlation.py` after GAR is implemented.

### 4. GAR Component Stability (Split-Half Reliability)

⚠️ EVO stability results not available. Run `validate_gar_component_stability.py` first.

⚠️ EVD stability results not available. Requires on-ice tracking.

### 5. GAR Component Independence and Value

⚠️ Component value results not available.

⚠️ Component correlation matrix not available.

---

## Success Criteria Summary

| Test | Threshold | Status |
|------|-----------|--------|
| GSAx Stability | r > 0.60 | ⚠️ (r = 0.2005) |
| GSAx Predictive | r > 0.50 | ⚠️ (r = 0.0941) |

---

## Generated Files

### Results CSV Files
- `validation_results/gsax_stability_results.csv`
- `validation_results/gsax_predictive_results.csv`
- `validation_results/gar_team_correlation_results.csv`
- `validation_results/gar_component_value_results.csv`
- `validation_results/gar_component_correlation_matrix.csv`
- `validation_results/gar_player_examples.csv`
- `validation_results/gar_evo_stability_results.csv`
- `validation_results/gar_evd_stability_results.csv`

### Visualizations
- `validation_results/gsax_stability_scatter.png`
- `validation_results/gsax_predictive_scatter.png`
- `validation_results/gar_team_correlation_scatter.png`
- `validation_results/gar_component_correlation_heatmap.png`
- `validation_results/gar_evo_stability_scatter.png`
- `validation_results/gar_evd_stability_scatter.png`
