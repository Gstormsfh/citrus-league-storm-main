@echo off
REM Full Season Backtest for VOPA Model
REM Date Range: 2025-10-07 to 2026-01-03 (all games with actual stats)
REM Season: 2025

echo ================================================================================
echo RUNNING FULL SEASON BACKTEST
echo ================================================================================
echo.
echo Date Range: 2025-10-07 to 2026-01-03
echo Season: 2025
echo Expected Games: 587 games with stats
echo Expected Projections: ~20,000+ (multiple players per game)
echo.
echo This may take 10-30 minutes depending on data volume...
echo.
echo ================================================================================
echo.

python backtest_vopa_model_fast.py 2025-10-07 2026-01-03 2025

echo.
echo ================================================================================
echo BACKTEST COMPLETE
echo ================================================================================
echo.
echo Next steps:
echo   1. Run audit: python vopa_backtest_audit.py 2025 2025-10-07 2026-01-03
echo   2. Check correlation and VOPA gap metrics
echo.
pause



