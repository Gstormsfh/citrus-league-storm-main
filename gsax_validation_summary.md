# GSAx Validation Summary

## Data Quality Improvements ✅

### Filters Applied (Similar to xG Model)
1. **Non-zero xG filtering**: Removed 627 shots with xG = 0
2. **xG range validation**: Capped xG values at 0.50 (realistic maximum)
3. **Goalie ID validation**: Ensured all goalie_ids > 0
4. **Game ID validation**: Ensured all game_ids > 0
5. **Distance/Angle validation**: Optional validation if available

### Results
- **Data retention**: 97.7% (40,569 shots from 41,524 initial)
- **xG distribution**: 
  - Min: 0.0010
  - Max: 0.5000 (capped)
  - Mean: 0.0731
  - Median: 0.0476
  - 95th percentile: 0.2198
- **Talent-adjusted xG coverage**: 99.3%

## GSAx Statistics Validation ✅

### Regressed GSAx Statistics
- **Mean**: 0.94
- **Median**: 0.19
- **Range**: [-7.97, 11.38] (all within expected [-20, +20])
- **Distribution**: 
  - 45 goalies above average (positive GSAx)
  - 38 goalies below average (negative GSAx)
  - 31 goalies near zero (within [-1, 1])

### Regression Validation
- **High-sample goalies (>= 500 shots)**: 
  - Raw vs Regressed correlation: **0.9978** ✅
  - Regression preserves signal for high-sample goalies
- **Low-sample goalies (< 200 shots)**:
  - Average regressed GSAx: -0.07 ✅
  - Max absolute: 1.12 ✅
  - Regression successfully shrinks low-sample goalies toward 0

### Data Quality Checks
- ✅ No negative shot counts
- ✅ No negative xGA values
- ✅ All goalies have GA <= shots (logical constraint)
- ⚠️ 1 goalie with unusual save % (0.8421) - likely very low sample

## Stability Test Results ⚠️

### Split-Half Correlation Test
- **Correlation (r)**: 0.1721
- **P-value**: 0.1636
- **Sample size**: 67 goalies
- **Target**: r > 0.60
- **Status**: FAIL

### Analysis
The low correlation suggests:
1. **Regression constant may still be too high**: C=500 might need to be lower (e.g., C=300)
2. **Random splits may introduce noise**: Time-based or game-based splits might be better
3. **Sample size per goalie**: Average ~600 shots per goalie, but split into ~300 per half may be too small
4. **Inherent volatility**: Goalie performance is inherently volatile, especially in small samples

## Recommendations

### Immediate Actions
1. **Test lower C values**: Try C=300, C=250 to see if correlation improves
2. **Increase minimum sample size**: Test with min_shots=400 instead of 200
3. **Try time-based splits**: Split by first half vs second half of season instead of random

### Data Quality
- ✅ Data filtering is working correctly
- ✅ GSAx values are in reasonable ranges
- ✅ Regression is working as expected (high-sample preserved, low-sample shrunk)

### Next Steps
1. Test C=300 and C=250 to find optimal regression constant
2. Re-run stability test with higher minimum sample size
3. Consider alternative split methods (time-based, game-based)
4. Re-run predictive test once we have more season data

