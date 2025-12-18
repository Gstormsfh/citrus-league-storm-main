# Full Season Model Performance Results

## 📊 Current Performance (Model-to-Model Comparison)

**R²: 0.6943 (69.4% variance explained)**
- **Comparison**: Our predicted xG vs MoneyPuck's predicted xG
- **Dataset**: 6,090 matched shots from full 2025 season
- **Baseline**: ~0.16 (16% variance explained)
- **Improvement**: **334% (4.3x better)**

### Key Metrics:
- **R²**: 0.6943 ✅ (Target was >0.30)
- **Correlation**: 0.8348 (strong alignment)
- **MAE**: 0.0245
- **RMSE**: 0.0542
- **Calibration**: Well-calibrated across all xG bins

### Important Note:
This R² measures how well our model **predicts MoneyPuck's xG values**, not actual goals. This is a model-to-model comparison showing alignment with MoneyPuck's methodology.

## 🎯 Next Steps to Push Higher

1. **Apply Database Migration** - Enable saving new features
2. **Reprocess Games** - Get full feature data (not just derived)
3. **Retrain with Full Features** - Expected R²: 0.75-0.80
4. **Test Against Actual Goals** - Measure real-world predictive power

## 📈 Feature Importance (Current Model)

1. Distance: 34.3%
2. Distance × Angle Interaction: 28.7% ⭐
3. North-South Location: 10.3%
4. Shot Angle Plus Rebound Speed: 8.1%
5. Shot Type: 6.4%
6. East-West Location of Last Event: 6.1%
7. Angle: 6.0%

## 🚀 Ready to Push Forward!

