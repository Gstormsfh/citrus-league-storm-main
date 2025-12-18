# GAR and GSAx Validation Framework Summary

## Overview
Comprehensive validation framework for GAR (Goals Above Replacement) and GSAx (Goals Saved Above Expected) metrics. The framework tests that these metrics accurately measure player value and predict team success using rigorous statistical methods.

## Validation Tests Implemented

### Phase 1: Team-Level Correlation (r > 0.90 Test)

**File:** `validate_gar_team_correlation.py`

**Purpose:** Validate that team-level GAR (sum of skater GAR + goalie GSAx) correctly predicts team success.

**Test:**
- Calculates Total Team GAR = Σ(Skater GAR) + Σ(Goalie GSAx_reg)
- Loads actual Goal Differential (GF - GA) from `nhl_games` table
- Calculates Pearson correlation between Team GAR and Goal Differential

**Success Criteria:** r ≥ 0.90 to 0.95

**Key Features:**
- Maps players to teams using staging tables (`staging_2025_skaters`, `staging_2025_goalies`)
- Aggregates GAR by team (sums skater GAR, sums goalie GSAx)
- Handles team abbreviation to team_id mapping
- Generates scatter plot with regression line

**Usage:**
```bash
python validate_gar_team_correlation.py
```

**Output:**
- `validation_results/gar_team_correlation_results.csv`
- `validation_results/gar_team_correlation_scatter.png`

### Phase 2: Predictive Validation (Repeatability)

#### Test 2A: GSAx Year-Over-Year Correlation

**File:** `validate_gsax_predictive.py` (already implemented)

**Purpose:** Validate that GSAx_reg in Season 1 predicts future goalie performance.

**Test:**
- Calculates GSAx_reg for all goalies in Season 1
- Calculates Actual Goals Allowed Above Average (GA-AA) for same goalies in Season 2
- Correlates Season 1 GSAx_reg with Season 2 GA-AA

**Success Criteria:** r ≈ 0.40 to 0.60

**Usage:**
```bash
python validate_gsax_predictive.py
```

**Output:**
- `validation_results/gsax_predictive_results.csv`
- `validation_results/gsax_predictive_scatter.png`

#### Test 2B: GAR Component Split-Half Reliability

**File:** `validate_gar_component_stability.py` (new)

**Purpose:** Validate that GAR components (EVO, EVD) are stable and measure repeatable skill.

**Test:**
- Splits each player's TOI into two random halves (Half A and Half B)
- Calculates Regressed EVO Rate for each half
- Calculates Regressed EVD Rate for each half (placeholder until on-ice tracking)
- Correlates Half A vs Half B for each component

**Success Criteria:** r > 0.60 for EVO and EVD

**Key Features:**
- Uses same Bayesian regression thresholds as main GAR calculation
- Filters to players with minimum TOI (default: 200 minutes)
- Random seed for reproducibility
- Calculates replacement level rates for each half

**Usage:**
```bash
python validate_gar_component_stability.py
```

**Output:**
- `validation_results/gar_evo_stability_results.csv`
- `validation_results/gar_evo_stability_scatter.png`
- `validation_results/gar_evd_stability_results.csv` (when on-ice tracking available)
- `validation_results/gar_evd_stability_scatter.png` (when on-ice tracking available)

**Note:** EVD test requires full on-ice tracking (currently placeholder).

### Phase 3: Component Validation (Independence)

**File:** `validate_gar_components.py` (completed)

**Purpose:** Verify that GAR components measure distinct skills, not just "good player = good at everything."

**Test:**
- Calculates correlation matrix for all GAR component pairs
- Tests pairs: EVO vs EVD, EVO vs PPO, EVD vs PPD, PPO vs PPD
- Finds example players with different component patterns

**Success Criteria:** r < 0.30 between opposing components (EVO vs EVD)

**Key Features:**
- Uses regressed rates (not raw rates) for correlation
- Filters to players with sufficient TOI in each component
- Generates correlation heatmap
- Identifies player examples:
  - High EVO, Low EVD (offensive specialist)
  - Low EVO, High EVD (defensive specialist)
  - High PPO, Low EVO (powerplay specialist)

**Usage:**
```bash
python validate_gar_components.py
```

**Output:**
- `validation_results/gar_component_correlation_matrix.csv`
- `validation_results/gar_component_correlation_heatmap.png`
- `validation_results/gar_component_value_results.csv`
- `validation_results/gar_player_examples.csv`

## Validation Report Generator

**File:** `generate_validation_report.py` (updated)

**Purpose:** Generate comprehensive markdown report summarizing all validation test results.

**Features:**
- Loads all validation results from CSV files
- Extracts correlation metrics
- Generates executive summary with pass/fail status
- Includes detailed results for each test
- Lists all generated files and visualizations

**Usage:**
```bash
python generate_validation_report.py
```

**Output:**
- `validation_results/validation_report.md`

## Success Criteria Summary

| Test | Threshold | Description |
|------|-----------|-------------|
| GSAx Stability | r > 0.60 | Split-half correlation for GSAx repeatability |
| GSAx Predictive | r > 0.50 | Year-over-year correlation with future performance |
| GAR Team Correlation | r > 0.90 | Team GAR vs Goal Differential |
| GAR EVO Stability | r > 0.60 | Split-half correlation for EVO repeatability |
| GAR EVD Stability | r > 0.60 | Split-half correlation for EVD repeatability |
| Component Independence | r < 0.30 | Cross-component correlation (EVO vs EVD) |

## Data Requirements

### Required Tables:
- `player_gar_components` - GAR component rates and values
- `goalie_gsax` - Goalie GSAx data
- `player_toi_by_situation` - TOI data by situation
- `raw_shots` - Shot data with situation information
- `nhl_games` - Game data for goal differential calculation
- `staging_2025_skaters` - Player-team mapping for skaters
- `staging_2025_goalies` - Player-team mapping for goalies

### Prerequisites:
1. Run `calculate_gar_regression.py` to generate GAR data
2. Run `calculate_goalie_gsax.py` to generate GSAx data
3. Run `calculate_player_toi.py` to generate TOI data (for component stability)

## Running All Tests

To run all validation tests and generate the report:

```bash
# Run individual tests
python validate_gsax_stability.py
python validate_gsax_predictive.py
python validate_gar_team_correlation.py
python validate_gar_component_stability.py
python validate_gar_components.py

# Generate comprehensive report
python generate_validation_report.py
```

## Output Files

All results are saved to `validation_results/` directory:

### CSV Results:
- `gsax_stability_results.csv`
- `gsax_predictive_results.csv`
- `gar_team_correlation_results.csv`
- `gar_evo_stability_results.csv`
- `gar_evd_stability_results.csv`
- `gar_component_correlation_matrix.csv`
- `gar_component_value_results.csv`
- `gar_player_examples.csv`

### Visualizations:
- `gsax_stability_scatter.png`
- `gsax_predictive_scatter.png`
- `gar_team_correlation_scatter.png`
- `gar_evo_stability_scatter.png`
- `gar_evd_stability_scatter.png`
- `gar_component_correlation_heatmap.png`

### Report:
- `validation_report.md` - Comprehensive markdown report

## Notes

1. **Team Mapping:** The framework uses staging tables to map players to teams. Ensure staging tables are up-to-date.

2. **On-Ice Tracking:** EVD and PPD component stability tests require full on-ice tracking (currently placeholders).

3. **Season Filtering:** All tests should use consistent season filtering. Default is 2025 season.

4. **Data Quality:** Tests handle missing data gracefully and log data quality issues.

5. **Reproducibility:** Split-half tests use fixed random seeds (42) for reproducibility.

## Next Steps

1. **Run Initial Tests:** Execute all validation scripts once GAR data is available
2. **Review Results:** Check correlation values against success criteria
3. **Refine Metrics:** If correlations are low, adjust regression thresholds or calculation methods
4. **Complete On-Ice Tracking:** Implement full on-ice tracking for EVD/PPD tests
5. **Production Validation:** Run tests regularly to monitor metric quality over time

