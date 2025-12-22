# NHL API Analysis Summary

## Endpoints Tested

### 1. Landing Endpoint (api-web.nhle.com/v1/player/{id}/landing)
**Status**: ✅ Working reliably
**DNS Issues**: None
**Rate Limiting**: Unknown (using 100ms delay between requests)

#### Available Stats (Skaters):
- ✅ `gamesPlayed` → `games_played`
- ✅ `goals` → `nhl_goals`
- ✅ `assists` → `nhl_assists`
- ✅ `points` → `nhl_points`
- ✅ `plusMinus` → `nhl_plus_minus`
- ✅ `avgToi` (format: "MM:SS") → `nhl_toi_seconds` (needs conversion)
- ✅ `shots` → `nhl_shots_on_goal`
- ✅ `pim` → `nhl_pim`
- ✅ `powerPlayPoints` → `nhl_ppp`
- ✅ `shorthandedPoints` → `nhl_shp`
- ❌ `hits` → NOT AVAILABLE
- ❌ `blocks` / `blockedShots` → NOT AVAILABLE

#### Available Stats (Goalies):
- ✅ `gamesPlayed` → `goalie_gp`
- ✅ `wins` → `nhl_wins`
- ✅ `losses` → `nhl_losses`
- ✅ `otLosses` → `nhl_ot_losses`
- ✅ `goalsAgainst` → `nhl_goals_against`
- ✅ `goalsAgainstAvg` → `nhl_gaa` (already calculated)
- ✅ `savePctg` (format: 0.908302) → `nhl_save_pct`
- ✅ `shutouts` → `nhl_shutouts`
- ✅ `shotsAgainst` → `nhl_shots_faced`
- ✅ `timeOnIce` (format: "HH:MM:SS") → `nhl_toi_seconds` (needs conversion)
- Note: `saves` = `shotsAgainst - goalsAgainst` (can be calculated)

### 2. StatsAPI Endpoint (statsapi.web.nhl.com/api/v1/people/{id}/stats)
**Status**: ❌ DNS resolution failures (known issue)
**Reliability**: Unreliable due to DNS issues
**Fallback Strategy**: Use only when landing endpoint doesn't have required stats

#### Expected Stats (if working):
- Should have `hits` and `blocked` fields
- More comprehensive stat set
- Requires retry logic and error handling

## Implementation Strategy

### Phase 1: Landing Endpoint (Primary)
Use landing endpoint for all stats it provides:
- Skaters: Goals, Assists, Points, SOG, PIM, PPP, SHP, TOI, +/-
- Goalies: Wins, Losses, OTL, GA, GAA, SV%, SO, Shots Against, TOI

### Phase 2: Hits/Blocks Handling
**Problem**: Landing endpoint doesn't provide hits/blocks
**Options**:
1. **StatsAPI with Retry Logic**: Try StatsAPI with exponential backoff when DNS works
2. **Boxscore Endpoint**: Check if game boxscores have hits/blocks (per-game aggregation)
3. **Hybrid Approach**: Use StatsAPI for hits/blocks only, landing for everything else
4. **Temporary**: Keep PBP-calculated hits/blocks until StatsAPI solution works

**Recommendation**: Implement StatsAPI fallback with retry logic, but don't block on it. If StatsAPI fails, log warning and continue with other stats.

## Data Transformations Needed

1. **TOI Conversion**:
   - Landing: `avgToi` = "22:41" → Convert to seconds: `(22 * 60) + 41 = 1361` seconds per game
   - Total TOI = `avgToi_seconds * gamesPlayed`
   - Goalie: `timeOnIce` = "1750:03" → Convert HH:MM:SS to total seconds

2. **Save Percentage**:
   - Landing: `savePctg` = 0.908302 (already decimal format)
   - Store as-is (0.908302)

3. **GAA**:
   - Landing: `goalsAgainstAvg` = 2.53707 (already calculated)
   - Store as-is

## Field Mappings

### Skater Stats
| NHL API Field | Database Column | Notes |
|--------------|-----------------|-------|
| `gamesPlayed` | `games_played` | Direct |
| `goals` | `nhl_goals` | Direct |
| `assists` | `nhl_assists` | Direct |
| `points` | `nhl_points` | Direct |
| `plusMinus` | `nhl_plus_minus` | Direct |
| `avgToi` | `nhl_toi_seconds` | Convert "MM:SS" to seconds, multiply by games |
| `shots` | `nhl_shots_on_goal` | Direct |
| `pim` | `nhl_pim` | Direct |
| `powerPlayPoints` | `nhl_ppp` | Direct |
| `shorthandedPoints` | `nhl_shp` | Direct |
| `hits` | `nhl_hits` | **NOT IN LANDING - Need StatsAPI** |
| `blockedShots` / `blocks` | `nhl_blocks` | **NOT IN LANDING - Need StatsAPI** |

### Goalie Stats
| NHL API Field | Database Column | Notes |
|--------------|-----------------|-------|
| `gamesPlayed` | `goalie_gp` | Direct |
| `wins` | `nhl_wins` | Direct |
| `losses` | `nhl_losses` | Direct |
| `otLosses` | `nhl_ot_losses` | Direct |
| `goalsAgainst` | `nhl_goals_against` | Direct |
| `goalsAgainstAvg` | `nhl_gaa` | Direct (already calculated) |
| `savePctg` | `nhl_save_pct` | Direct (decimal format) |
| `shutouts` | `nhl_shutouts` | Direct |
| `shotsAgainst` | `nhl_shots_faced` | Direct |
| `timeOnIce` | `nhl_toi_seconds` | Convert "HH:MM:SS" to seconds |
| `saves` | `nhl_saves` | Calculate: `shotsAgainst - goalsAgainst` |

## Next Steps

1. ✅ Create database migration for `nhl_*` columns
2. ✅ Extend scraping script to extract all available stats from landing endpoint
3. ⚠️ Implement StatsAPI fallback for hits/blocks (with retry logic)
4. ✅ Update PlayerService to use NHL stats for display
5. ✅ Update fantasy scoring to use NHL stats
6. ✅ Preserve PBP stats for internal model use

