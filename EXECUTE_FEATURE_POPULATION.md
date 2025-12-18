# Execute Feature Population Plan

## Current Status

✅ **Phase 1 Complete**: Fixes verified in code
- `speed_from_last_event` calculation fixed (handles zero time)
- `time_since_powerplay_started` tracking improved
- All values initialized before saving

⚠️ **Current Data**: Still has zeros (processed before fixes)

## Next Steps

### Phase 2: Test Sample Re-processing

**Option 1: Process specific dates manually**
```bash
# Activate your Python environment first (if using venv)
# Then process a few recent dates:
python -c "from data_acquisition import scrape_pbp_and_process; scrape_pbp_and_process('2025-01-20')"
python -c "from data_acquisition import scrape_pbp_and_process; scrape_pbp_and_process('2025-01-21')"
```

**Option 2: Use pull_season_data.py for date range**
```bash
# Process last 3 days
python pull_season_data.py 2025-01-19 2025-01-21 false
```

### Phase 3: Full Season Re-processing

**Recommended Approach**:
```bash
# This will re-process entire season with updated code
# Set cleanup_first=False to keep existing data and update it
python pull_season_data.py 2025-10-07 $(date +%Y-%m-%d) false
```

**What happens**:
1. Processes all dates from season start to today
2. Uses updated `data_acquisition.py` with fixes
3. Saves to `raw_shots` table in Supabase
4. Pulls fresh data to `data/our_shots_2025.csv`

### Phase 4: Verify Data Quality

After re-processing, run:
```bash
python verify_fixes.py
python input_percentage_breakdown.py
```

**Expected Results**:
- `speed_from_last_event`: 100% present, >0% non-zero
- `is_power_play`: >0% are 1 (powerplay shots)
- `time_since_powerplay_started`: Non-zero for PP shots

### Phase 5: Retrain Model

```bash
python retrain_xg_with_moneypuck.py
python show_feature_importance.py
```

**Expected Improvements**:
- Features 8-15: Non-zero importance
- Training R²: 0.75-0.80 (from 0.6943)
- Player-season R²: Higher (from 0.6466)

### Phase 6: Validate

```bash
python compare_full_season_stats.py
```

## Environment Setup

If you get `ModuleNotFoundError: No module named 'requests'`:

1. **Activate your virtual environment** (if using one):
   ```bash
   # Windows
   ml_env\Scripts\activate
   
   # Or if using conda
   conda activate ml_env
   ```

2. **Install dependencies** (if needed):
   ```bash
   pip install requests pandas numpy xgboost scikit-learn supabase python-dotenv joblib
   ```

## Quick Start (All-in-One)

If you want to process everything at once:

```bash
# 1. Activate environment
ml_env\Scripts\activate  # Windows

# 2. Re-process full season (this takes 2-4 hours)
python pull_season_data.py

# 3. Verify fixes
python verify_fixes.py

# 4. Retrain model
python retrain_xg_with_moneypuck.py

# 5. Check feature importance
python show_feature_importance.py

# 6. Validate against actuals
python compare_full_season_stats.py
```

## Expected Timeline

- Full re-processing: 2-4 hours (40K+ shots, API rate limits)
- Verification: 10 minutes
- Retraining: 15 minutes
- Validation: 10 minutes

**Total**: ~3-5 hours

