# Testing MoneyPuck Methodology Alignment

## ✅ Implementation Status

All MoneyPuck methodology changes have been implemented:
- ✅ Removed binary `is_rush` flag, using `speed_from_last_event` instead
- ✅ Added explicit location features (East-West, North-South)
- ✅ Added `time_since_powerplay_started` tracking
- ✅ Implemented flurry-adjusted expected goals
- ✅ Aligned model features with MoneyPuck's exact 15 variables
- ✅ Updated database migration

## 📊 Current Data

- **Matched shots**: 6,080 records (for training)
- **Our shots**: 39,780 records (with features)
- **MoneyPuck shots**: 39,518 records (for comparison)

## 🧪 Testing Steps

### Step 1: Activate Virtual Environment

```powershell
# Windows PowerShell
.\ml_env\Scripts\Activate.ps1

# Or if that doesn't work:
ml_env\Scripts\activate
```

### Step 2: Verify Implementation

```powershell
python test_moneypuck_alignment.py
```

This will verify all features are implemented correctly.

### Step 3: Retrain Model with MoneyPuck's 15 Variables

```powershell
python retrain_xg_with_moneypuck.py
```

This will:
- Load matched data (6,080 shots)
- Derive missing features from existing data
- Train XGBoost model with MoneyPuck's exact 15 variables
- Save new model: `xg_model_moneypuck.joblib`
- Display R² score

**Expected Output:**
- Training R²: Should be >0.30 (target: 87%+ improvement from ~0.16)
- Test R²: Should be similar to training R² (no overfitting)

### Step 4: Test Model Performance

```powershell
python test_moneypuck_model.py
```

This will:
- Load the newly trained model
- Generate predictions on matched data
- Calculate R², MAE, RMSE, and correlation
- Compare against MoneyPuck's xG values

**Key Metrics to Check:**
- **R² Score**: Target >0.30 (vs previous ~0.16)
- **MAE**: Should be <0.03 (mean absolute error)
- **RMSE**: Should be <0.04 (root mean squared error)
- **Correlation**: Should be >0.70 (strong correlation with MoneyPuck)

## 📈 Expected Improvements

### Before (Previous Model)
- R²: ~0.16 (16% of variance explained)
- Features: ~13 features, including binary flags
- Methodology: Simple rush/rebound detection

### After (MoneyPuck-Aligned Model)
- R²: **>0.30** (30%+ of variance explained) - **87%+ improvement**
- Features: MoneyPuck's exact 15 variables
- Methodology: Speed variables instead of binary flags
- Post-processing: Flurry-adjusted xG

## 🔍 What to Look For

1. **R² Improvement**: Should see significant increase from ~0.16 to >0.30
2. **Feature Importance**: Check which of the 15 variables are most important
3. **Calibration**: Total predicted xG should be close to total actual goals
4. **Flurry Adjustment**: Verify flurry-adjusted xG is calculated correctly

## 🐛 Troubleshooting

### If R² is still low (<0.25):
- Check if all 15 features are being used (look for warnings about missing features)
- Verify feature values are reasonable (no extreme outliers)
- Consider if data needs to be reprocessed with new features

### If model training fails:
- Ensure all dependencies are installed: `pip install xgboost pandas numpy scikit-learn scipy`
- Check that `data/matched_shots_2025.csv` exists and has valid data
- Verify `data/our_shots_2025.csv` has the required base features

### If features are missing:
- The retrain script will derive features from existing data (e.g., `east_west_location_of_shot` from `shot_y`)
- For best results, reprocess data with `data_acquisition.py` to get all new features
- Run: `python data_acquisition.py` (or specify a date)

## 📝 Next Steps After Testing

1. **If R² > 0.30**: ✅ Success! Model is aligned with MoneyPuck methodology
2. **If R² 0.25-0.30**: Good progress, consider adding TOI features as enhancements
3. **If R² < 0.25**: Review feature extraction and data quality

## 🎯 Success Criteria

- ✅ R² > 0.30 (87%+ improvement from baseline)
- ✅ All 15 MoneyPuck variables included
- ✅ Speed variables working (no binary rush flag)
- ✅ Flurry adjustment implemented
- ✅ Model calibration within 10% of actual goals

