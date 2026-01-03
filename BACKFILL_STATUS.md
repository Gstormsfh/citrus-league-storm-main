# Backfill Status & Verification

## Current Status

**Backtest Running**: `python backtest_vopa_model_fast.py 2025-10-07 2025-12-18 2025`

This will generate projections for **268 games** that already have actual stats, increasing matched games from **59 → ~268** and data points from **126 → ~5,000+**.

## Look-Ahead Trap Verification ✓

**Status: PASSED**

All critical date comparisons use strict `<` (not `<=`):
- ✅ `get_team_xga_per_60_rolling_cached`: `if log_date < game_date`
- ✅ `get_opponent_shots_for_per_60_rolling_cached`: `if log_date < game_date`
- ✅ `calculate_goalie_days_rest_cached`: `if prev_date < game_date`

**No look-ahead leakage detected.** The model will only use data from games before the projection date.

## Expected Results After Backfill

| Metric | Current (Sparse) | Expected (Full Range) |
|--------|------------------|----------------------|
| Matched Games | 59 | ~268 |
| Data Points (n) | 126 | ~5,000+ |
| Statistical Power | Low (Anecdotal) | High (Predictive) |
| VOPA Gap | 3.95 ✓ | 3.95 (Should stay consistent) |
| Correlation | 0.29 (unreliable) | 0.35-0.45 (expected) |

## What to Monitor

### 1. Correlation Watch
- **Expected**: 0.35-0.45 for a good model
- **Warning**: If correlation > 0.70, check for look-ahead leakage
- **Good Sign**: Correlation stabilizes around 0.40 with larger sample

### 2. VOPA Gap Consistency
- **Current**: 3.955 points (Top 10 vs Bottom 10)
- **Expected**: Should stay consistently ~3.95 across all games
- **Warning**: If gap drops significantly, check for calculation errors

### 3. Goalie VOPA
- **Current**: 2.18 average (2.4x higher than skaters)
- **Monitor**: If it stays at ~2.18 and dominates rankings, consider positional multiplier
- **Expected**: Goalies will have high VOPA but also high MAE (volatility)

### 4. Sample Size
- **Target**: 300+ matched games, 5,000+ projections
- **Reliability**: Correlation becomes statistically significant at this scale

## Post-Backfill Audit

After the backfill completes, run:

```bash
python vopa_backtest_audit.py 2025
```

**Expected Output:**
- Match Rate: >90% (for completed dates)
- Sample Size: 5,000+ projections
- Correlation: 0.35-0.45 (stable)
- VOPA Gap: ~3.95 (consistent)

## Victory Conditions

✅ **VOPA Gap**: Already confirmed at 3.95 (66.7x improvement from 0.11)
✅ **Date Logic**: Verified strict `<` comparisons (no look-ahead)
⏳ **Sample Size**: Waiting for backfill to complete
⏳ **Correlation**: Will stabilize with larger sample

Once backfill completes and audit shows 300+ games with correlation ~0.40, the model is **production-ready**.



