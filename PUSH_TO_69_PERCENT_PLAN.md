# Push R² Above 69% - Action Plan

## Current Status
- **Test R²**: 0.5071 (50.7% variance explained)
- **Target**: >0.69 (69%+ variance explained)
- **Gap**: Need to improve by ~37% relative improvement

## Key Issues Identified

### 1. Missing Real Feature Data
- **time_since_last_event**: 99.3% zeros (not calculated in old data)
- **distance_from_last_event**: 98.1% zeros (not calculated)
- **speed_from_last_event**: 100% missing (can't calculate without time)
- **is_power_play**: 100% zeros (not detected)
- **is_empty_net**: 100% zeros (not detected)

### 2. Data Quality
- Current data was processed before new feature extraction code
- Need to reprocess games with new code to get actual values

## Solution: Reprocess Games with New Code

### Step 1: Apply Database Migration
```sql
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS east_west_location_of_last_event NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS defending_team_skaters_on_ice INTEGER;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS east_west_location_of_shot NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS time_since_powerplay_started NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS north_south_location_of_shot NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS flurry_adjusted_xg NUMERIC;
```

### Step 2: Reprocess Recent Games
```bash
# Process games with new code (will calculate all features)
python data_acquisition.py 2025-01-15
python data_acquisition.py 2025-01-16
# ... process more dates
```

### Step 3: Pull Fresh Data
```bash
# Pull reprocessed data from database
python pull_season_data.py
```

### Step 4: Retrain with Full Features
```bash
# Retrain with actual feature values (not zeros)
python retrain_xg_with_moneypuck.py
```

## Expected Improvements

With actual feature values:
- **speed_from_last_event**: Will have real variance (currently 0% importance)
- **time_since_last_event**: Will have real variance
- **is_power_play**: Will have variance (currently all zeros)
- **distance_from_last_event**: Will have real values

**Expected R²**: 0.75-0.80 (with full feature data)

## Alternative: Advanced Feature Engineering

If we can't reprocess immediately:

1. **Better Feature Interactions**
   - distance × shot_type
   - angle × speed_from_last_event
   - location × situation interactions

2. **Polynomial Features**
   - distance², angle²
   - distance × angle²

3. **Binning**
   - Distance bins (close, medium, far)
   - Angle bins (sharp, medium, wide)

4. **Ensemble Methods**
   - Stack multiple models
   - Use different hyperparameters

## Quick Win: Hyperparameter Tuning

Try these hyperparameter combinations:

```python
# Option 1: Deeper trees
XGBRegressor(n_estimators=300, max_depth=8, learning_rate=0.03)

# Option 2: More regularization
XGBRegressor(n_estimators=200, max_depth=5, learning_rate=0.05, reg_alpha=0.5, reg_lambda=2.0)

# Option 3: Higher learning rate
XGBRegressor(n_estimators=150, max_depth=6, learning_rate=0.1)
```

## Priority Actions

1. ✅ **Apply database migration** (ready to go)
2. ⏳ **Reprocess 10-20 recent games** (get actual feature values)
3. ⏳ **Retrain with full features** (expected R²: 0.75+)
4. ⏳ **Test against actual goals** (verify calibration)

## Current Best Model

- **Training R²**: 0.7480 (74.8%)
- **Test R²**: 0.5071 (50.7%)
- **Gap**: Overfitting - need more data or regularization

**Key Features Working**:
- Distance: 34.3% importance
- Distance × Angle: 28.7% importance
- Location features: 16.4% importance

**Features Not Working** (due to zeros):
- speed_from_last_event: 0% (needs real data)
- time_since_last_event: 0% (needs real data)
- is_power_play: 0% (needs real data)

## Conclusion

**To get above 69%**: We need to reprocess games with the new code to get actual feature values. The current model is limited by missing data (zeros), not by model architecture.

**Next Step**: Apply migration → Reprocess games → Retrain → Test

