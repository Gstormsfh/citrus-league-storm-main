# Goalie Projections Testing Guide

## ✅ Implementation Status

The goalie projection system is **fully implemented** and ready for testing!

## 🚀 Quick Start Testing

### 1. Run Database Migrations First

Before testing, ensure the migrations have been applied:

```bash
# Apply migrations (via Supabase dashboard or CLI)
# These migrations add:
# - Goalie projection columns to player_projected_stats
# - Vegas odds columns to nhl_games
# - Updated RPC function for goalie projections
```

**Migrations to apply:**
- `20251224000000_add_goalie_projections.sql`
- `20251224000001_add_vegas_odds_to_nhl_games.sql`
- `20251224000002_update_get_daily_projections_rpc.sql`

### 2. Test Goalie Projection Calculation

**Find a goalie to test:**
```bash
python find_test_goalies.py
```

**Test a specific goalie:**
```bash
# Test with debug output
python debug_projection.py --player-id 8480280

# Or test with a specific game
python debug_projection.py --player-id 8480280 --game-id 2025020555
```

**Enable detailed debug logging:**
```bash
# Windows PowerShell
$env:DEBUG_GOALIE="true"
python debug_projection.py --player-id 8480280

# Linux/Mac
DEBUG_GOALIE=true python debug_projection.py --player-id 8480280
```

### 3. Test Batch Processing

**Run daily projections for all players (including goalies):**
```bash
python run_daily_projections.py --date 2025-12-20
```

This will:
- Automatically detect goalies and route to goalie projection function
- Use goalie-specific outlier thresholds (20.0 warning, 30.0 rejection)
- Store goalie projections with all goalie-specific fields

### 4. Test Frontend Display

1. **Start the frontend:**
   ```bash
   npm run dev
   ```

2. **Navigate to a matchup page** with goalies

3. **Verify goalie display:**
   - Goalies should show: **GP, W, SV%, GSAx, GAA, SOs** (not G, A, SOG)
   - Projection should show goalie-specific stats
   - "Probable" badge if starter not confirmed
   - GoalieProjectionTooltip should show goalie breakdown

## 📊 What to Test

### Backend Testing

1. **Goalie Projection Calculation:**
   - ✅ Saves projection (Opponent Shots/60 × SV% × TOI)
   - ✅ Wins projection (Vegas implied probability or team win rate)
   - ✅ Shutouts projection (GSAx-based probability)
   - ✅ Goals Against & GAA calculation
   - ✅ Bayesian shrinkage for SV% (low-sample goalies)

2. **Data Quality:**
   - ✅ GSAx data is fetched correctly
   - ✅ Opponent shots for/60 calculation
   - ✅ Vegas odds integration (or fallback to win rate)
   - ✅ Starter confirmation logic

3. **Batch Processing:**
   - ✅ Goalies are separated from skaters
   - ✅ Goalie-specific outlier thresholds work
   - ✅ Projections are stored correctly in database

### Frontend Testing

1. **PlayerCard Display:**
   - ✅ Goalies show goalie stats (GP, W, SV%, GSAx, GAA, SOs)
   - ✅ Skaters still show skater stats (G, A, SOG)
   - ✅ Projection bar shows correct values
   - ✅ "Probable" badge for unconfirmed starters

2. **Projection Tooltip:**
   - ✅ GoalieProjectionTooltip shows goalie breakdown
   - ✅ ProjectionTooltip shows skater breakdown
   - ✅ Correct tooltip is shown based on player type

3. **Data Flow:**
   - ✅ MatchupService correctly maps goalie stats
   - ✅ GSAx is fetched and displayed
   - ✅ Projections are fetched from RPC correctly

## 🐛 Known Issues / Notes

1. **Vegas Odds Migration:** The `implied_win_probability_home` column doesn't exist yet - need to run migration `20251224000001_add_vegas_odds_to_nhl_games.sql`

2. **Goalie GP = 0:** Some goalies in the database have `goalie_gp = 0`, which means:
   - Expected TOI = 0 (assumed backup)
   - Projected saves = 0
   - Projected GA = 0
   - This is expected behavior - goalies with no games played are assumed backups

3. **Opponent Shots For/60:** May return `None` if opponent team has no recent games or TOI data. Falls back to league average (30.0 shots/60).

## 🎯 Test Scenarios

### Scenario 1: Elite Goalie with High GSAx
- **Goalie:** Jeremy Swayman (8480280) - GSAx: 6.50
- **Expected:** Higher shutout probability (1.5× base rate)
- **Test:** `python debug_projection.py --player-id 8480280`

### Scenario 2: Goalie with Games Played
- **Find:** Goalie with `goalie_gp > 0`
- **Expected:** Non-zero projected saves and GA
- **Test:** Use `find_test_goalies.py` to find goalies with GP > 0

### Scenario 3: B2B Scenario
- **Find:** Goalie whose team played yesterday
- **Expected:** Win probability reduced by 15%
- **Test:** Check `check_back_to_back()` logic

### Scenario 4: High-Volume Opponent
- **Find:** Goalie facing team with high shots for/60
- **Expected:** Higher projected saves
- **Test:** Check opponent shots for/60 calculation

## 📝 Next Steps

1. **Run migrations** to add Vegas odds columns
2. **Test with goalies who have GP > 0** for more realistic projections
3. **Verify frontend display** in matchup view
4. **Test batch processing** with `run_daily_projections.py`

## 🔍 Debugging Tips

- Use `DEBUG_GOALIE=true` for detailed goalie projection logs
- Use `DEBUG_DDR=true` for DDR (opponent strength) debugging
- Check `find_test_goalies.py` output for goalie IDs with stats
- Verify GSAx data exists: `SELECT * FROM goalie_gsax_primary WHERE goalie_id = <id>`
