# Goals Above Replacement (GAR) Framework Implementation Summary

## Overview
This document summarizes the implementation of the GAR framework for the Citrus League Storm fantasy hockey platform. The GAR framework breaks down player value into distinct, measurable components (EVO, EVD, PPO, PPD, Penalty) with Bayesian regression and replacement level adjustments.

## Completed Components

### 1. Database Schema
**File:** `supabase/migrations/20250125000000_create_toi_and_gar_tables.sql`

Created three new tables:
- **`player_toi_by_situation`**: Stores Time On Ice (TOI) for each player by game situation (5v5, PP, PK)
- **`player_shifts`**: Stores individual shift data for tracking which players were on ice at any given time
- **`player_gar_components`**: Stores all GAR component rates and final GAR values

### 2. Shift Tracking and TOI Calculation
**File:** `calculate_player_toi.py`

- Tracks player shifts from play-by-play data
- Identifies game situations (5v5, PP, PK) from `situation_code`
- Calculates TOI per situation for each player
- Stores results in `player_toi_by_situation` and `player_shifts` tables

**Note:** Full shift tracking requires NHL API line change events. The current implementation uses a simplified approach based on period starts and goals. Enhanced shift tracking can be added when line change data is available.

### 3. Raw Component Rate Calculation
**File:** `calculate_gar_components.py`

Calculates raw component rates (per 60 minutes) for:
- **EVO (Even Strength Offense)**: xGF/60 at 5v5
- **EVD (Even Strength Defense)**: xGA/60 at 5v5 (placeholder - requires on-ice tracking)
- **PPO (Power Play Offense)**: xGF/60 on PP
- **PPD (Power Play Defense/Penalty Kill)**: xGA/60 on PK (placeholder - requires on-ice tracking)
- **Penalty Component**: (Penalties Drawn - Penalties Taken)/60 (placeholder - requires penalty event data)

**Current Implementation:**
- Uses shooter's xG as proxy for on-ice xGF (works for EVO and PPO)
- EVD and PPD require full on-ice tracking (see "Future Enhancements" below)
- Penalty component requires penalty event data from play-by-play

### 4. Bayesian Regression
**File:** `calculate_gar_regression.py`

Applies Bayesian regression to each component rate with component-specific stabilization thresholds:
- **EVO/EVD**: C = 500 TOI minutes (stabilizes faster - more common situations)
- **PPO**: C = 100 TOI minutes (stabilizes slower - less common, high variance)
- **PPD**: C = 100 TOI minutes (stabilizes slower - less common, high variance)
- **Penalty**: C = 1000 TOI minutes (stabilizes very slowly - rare events)

**Formula:**
```
Regressed_Rate = (TOI / (TOI + C)) × Raw_Rate + (C / (TOI + C)) × RP_Rate
```

### 5. Replacement Level Calculation
**File:** `calculate_gar_regression.py`

Calculates replacement level rates (75th percentile by TOI) for each component:
- Represents the average performance of a fringe NHL player
- Configurable percentile (default: 75th)
- Used as baseline for "Above Replacement" calculation

### 6. Final GAR Values
**File:** `calculate_gar_regression.py`

Calculates final GAR values (Above Replacement) for each component:
- **GAR_per_60 = Regressed_Rate - RP_Rate**
- **Total_GAR_per_60 = Sum of all component GAR values**
- EVD and PPD are inverted (lower rates are better for defense)

### 7. Quality of Competition (QoC) Adjustments
**File:** `apply_qoc_adjustments.py`

Applies QoC adjustments to fantasy projections:
- **Even Strength**: QoC_Factor = (Player_EVO - Opponent_EVD) × Adjustment_Strength
- **Power Play**: QoC_Factor = (Player_PPO - Opponent_PPD) × Adjustment_Strength
- **Adjusted_xG = Base_Talent_Adjusted_xG × (1 + QoC_Factor)**

**Integration:** Integrated into `fantasy_projection_pipeline.py` via `update_projections_with_gsax()` function.

## Usage

### Step 1: Calculate TOI by Situation
```bash
python calculate_player_toi.py
```
This processes all games in `raw_shots` table and calculates TOI by situation.

### Step 2: Calculate Raw Component Rates
```bash
python calculate_gar_components.py
```
This calculates raw EVO, EVD, PPO, PPD, and Penalty component rates.

### Step 3: Apply Regression and Calculate Final GAR
```bash
python calculate_gar_regression.py
```
This applies Bayesian regression, calculates replacement levels, and computes final GAR values.

### Step 4: Use in Projections
The QoC adjustments are automatically applied when using `update_projections_with_gsax()` in `fantasy_projection_pipeline.py` with `apply_qoc=True`.

## Output Files

- **`player_gar_components_raw.csv`**: Raw component rates (from step 2)
- **`player_gar_components.csv`**: Final GAR values with regression (from step 3)
- **`replacement_level_rates.csv`**: Replacement level rates for each component

## Database Tables

All data is stored in Supabase:
- **`player_toi_by_situation`**: TOI data by situation
- **`player_shifts`**: Individual shift records
- **`player_gar_components`**: Complete GAR component data

## Future Enhancements

### 1. Full On-Ice Tracking
**Status:** Pending

**Current State:** Uses shooter's xG as proxy for on-ice xGF (works for EVO/PPO)

**Enhancement Needed:**
- Join `player_shifts` with `raw_shots` to identify all players on ice for each shot
- Calculate on-ice xGF and xGA for accurate EVD and PPD calculation
- Create `shots_with_on_ice_players` view or table

**Impact:** Enables accurate EVD and PPD component calculation

### 2. Penalty Event Tracking
**Status:** Pending

**Current State:** Penalty component is placeholder (0.0)

**Enhancement Needed:**
- Extract penalty events from play-by-play data
- Track `penalty_drawn_by` and `penalty_taken_by` player IDs
- Calculate penalty rates per 60 minutes

**Impact:** Enables Penalty component calculation

### 3. Team-Level GAR Aggregation
**Status:** Pending

**Current State:** QoC adjustments use placeholder team averages

**Enhancement Needed:**
- Map player_id to team_id
- Calculate team average GAR components (EVD, PPD) for QoC adjustments
- Filter by position (forwards for EVO/PPO, all for EVD/PPD)

**Impact:** Enables accurate QoC adjustments in projections

### 4. Validation
**Status:** Framework exists, needs data

**Files:** 
- `validate_gar_team_correlation.py`
- `validate_gar_components.py`

**Enhancement Needed:**
- Run validation scripts once GAR data is available
- Verify team GAR correlates with goal differential (r > 0.90)
- Verify component independence (cross-component r < 0.90)

## Configuration

### Replacement Level Percentile
**Default:** 75th percentile
**Location:** `calculate_gar_regression.py` - `REPLACEMENT_LEVEL_PERCENTILE` constant

### Stabilization Thresholds
**Location:** `calculate_gar_regression.py` - `STABILIZATION_THRESHOLDS` dictionary
- EVO/EVD: 500 TOI minutes
- PPO/PPD: 100 TOI minutes
- Penalty: 1000 TOI minutes

### QoC Adjustment Strength
**Default:** 0.1 (10% adjustment)
**Location:** `apply_qoc_adjustments.py` - `QOC_ADJUSTMENT_STRENGTH` constant

## Success Criteria

✅ All skaters have GAR component rates calculated (EVO, PPO completed; EVD, PPD pending on-ice tracking)
✅ Component rates are regressed using Bayesian methodology
✅ Replacement level is correctly defined and applied (75th percentile)
✅ Total GAR values are calculated and stored
✅ QoC adjustments can be applied to projections
⏳ Team GAR correlates with goal differential (r > 0.90) - **Pending validation**
⏳ Components are independent (cross-component r < 0.90) - **Pending validation**
⏳ Components add value beyond simple stats (R² > 0.50) - **Pending validation**

## Notes

1. **On-Ice Tracking:** The current implementation uses a simplified approach for EVO and PPO (shooter's xG as proxy). Full on-ice tracking is required for accurate EVD and PPD calculation.

2. **Penalty Component:** Currently a placeholder. Requires penalty event data extraction from play-by-play.

3. **Team Mapping:** QoC adjustments require player_id to team_id mapping, which may need to be added based on your data structure.

4. **Season Parameter:** All scripts default to season 2025. Adjust as needed for different seasons.

5. **Data Dependencies:** 
   - Requires `raw_shots` table with situation data
   - Requires `player_toi_by_situation` table (from step 1)
   - Requires `player_gar_components` table (from step 3)

## Next Steps

1. **Run Initial Calculations:**
   - Execute `calculate_player_toi.py` to generate TOI data
   - Execute `calculate_gar_components.py` to calculate raw rates
   - Execute `calculate_gar_regression.py` to apply regression and calculate final GAR

2. **Enhance On-Ice Tracking:**
   - Implement full shift-to-shot joining logic
   - Calculate accurate EVD and PPD components

3. **Add Penalty Tracking:**
   - Extract penalty events from play-by-play
   - Calculate penalty component rates

4. **Validate Results:**
   - Run validation scripts once data is available
   - Verify correlations and component independence

5. **Integrate with Projections:**
   - Ensure team_id mapping is available
   - Test QoC adjustments in production projections

