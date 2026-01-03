# Full Season Backtest Commands

## Quick Command (Windows PowerShell)

```powershell
python backtest_vopa_model_fast.py 2025-10-07 2026-01-03 2025
```

## Quick Command (Linux/Mac)

```bash
python backtest_vopa_model_fast.py 2025-10-07 2026-01-03 2025
```

## What This Does

- **Date Range**: October 7, 2025 to January 3, 2026
- **Season**: 2025
- **Expected Games**: 587 games with actual stats
- **Expected Projections**: ~20,000+ (multiple players per game)
- **Estimated Time**: 10-30 minutes

## After Backtest Completes

Run the audit to see full results:

```bash
python vopa_backtest_audit.py 2025 2025-10-07 2026-01-03
```

## Expected Results

- **Matched Games**: ~587 (all games with stats)
- **Data Points**: ~20,000+ projections
- **Correlation**: Should stabilize around 0.35-0.45
- **VOPA Gap**: Should remain ~3.95 (already confirmed working)

## Alternative: Run Batch Script (Windows)

```cmd
RUN_FULL_BACKTEST.bat
```

## Alternative: Run Shell Script (Linux/Mac)

```bash
chmod +x RUN_FULL_BACKTEST.sh
./RUN_FULL_BACKTEST.sh
```



