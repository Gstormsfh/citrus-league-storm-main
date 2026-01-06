# Daily Roster Locking and Scoring Implementation

## Overview
Implemented daily roster locking and scoring system where matchup totals are calculated as the sum of 7 daily scores. Each day's score is based on which players were ACTIVE (not bench) when their games started, using NHL official game logs as the source of truth.

## What Was Built

### 1. Database Schema

#### `fantasy_daily_rosters` Table
- Tracks daily roster snapshots (Mon-Sun) for each team in each matchup
- Fields: `team_id`, `matchup_id`, `player_id`, `roster_date`, `slot_type` (active/bench/ir), `is_locked`
- Locks players once their game starts (prevents roster changes after puck drop)

#### Indexes
- Added indexes on `nhl_games.game_time` for fast lock checks
- Composite indexes for date + time lookups

### 2. Per-Game NHL Stats Scraper

**File**: `scrape_per_game_nhl_stats.py`
- Scrapes NHL gamecenter boxscore endpoint: `https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore`
- Populates `player_game_stats.nhl_*` columns with official NHL.com game-by-game stats
- Uses NHL official stats (not PBP assumptions) as source of truth

**Stats Populated**:
- Skaters: `nhl_goals`, `nhl_assists`, `nhl_points`, `nhl_shots_on_goal`, `nhl_hits`, `nhl_blocks`, `nhl_pim`, `nhl_ppp`, `nhl_shp`, `nhl_plus_minus`, `nhl_toi_seconds`
- Goalies: `nhl_wins`, `nhl_losses`, `nhl_ot_losses`, `nhl_saves`, `nhl_shots_faced`, `nhl_goals_against`, `nhl_shutouts`

### 3. Updated RPC Functions

#### `get_matchup_stats`
- Now uses `player_game_stats.nhl_*` columns directly
- Filters by `game_date` to get only matchup week stats
- Uses NHL official stats as source of truth (not PBP)

#### `calculate_daily_matchup_scores` (NEW)
- Calculates daily fantasy scores for a matchup
- Uses `fantasy_daily_rosters` to determine which players were ACTIVE each day
- Sums fantasy points from `player_game_stats.nhl_*` for active players only
- Returns 7 daily scores (Mon-Sun)

**Scoring Formula**:
- Skaters: Goals (3), Assists (2), SOG (0.4), Blocks (0.4)
- Goalies: Wins (5), Saves (0.2), Shutouts (3), GA penalty (-1)

### 4. Backend Logic Updates

#### `LeagueService.saveLineup()`
- Now creates daily roster snapshots when lineup is saved
- Updates `fantasy_daily_rosters` for all future days in current matchup week
- Skips days where games have already started (locked)

#### `LeagueService.createDailyRosterSnapshots()` (NEW)
- Creates/updates daily roster records for Mon-Sun
- Only updates days that aren't locked yet
- Handles starters, bench, and IR players

#### `LeagueService.canUpdateRosterForDate()` (NEW)
- Checks if roster can be updated for a specific date
- Returns false if any player's game has started
- Uses `nhl_games.game_time` to determine lock status

### 5. Frontend Updates

#### `MatchupService.getMatchupData()`
- Now calculates daily scores using `calculate_daily_matchup_scores` RPC
- Always calculates (not just when scores exist)
- Returns 7 daily scores for both teams

#### `Matchup.tsx`
- Team totals now calculated as sum of 7 daily scores
- Falls back to player point sum if daily scores not available
- Daily points chart shows actual calculated scores (not placeholder)

## Data Flow

### Daily Scoring Flow
```
1. User saves lineup → createDailyRosterSnapshots()
   ↓
2. fantasy_daily_rosters table updated (Mon-Sun)
   ↓
3. Games start → players locked (is_locked = true)
   ↓
4. scrape_per_game_nhl_stats.py populates player_game_stats.nhl_* columns
   ↓
5. calculate_daily_matchup_scores RPC:
   - Queries fantasy_daily_rosters for active players each day
   - Joins with player_game_stats.nhl_* for that day's games
   - Sums fantasy points for active players only
   ↓
6. Matchup total = sum of 7 daily scores
```

## Testing This Week

Since it's Sunday evening MT, this is the perfect time to test:

1. **Run Migrations**
   ```bash
   # Apply all new migrations
   supabase migration up
   ```

2. **Test Boxscore Structure**
   ```bash
   python test_boxscore_structure.py
   ```
   This will show what fields are available in the boxscore endpoint.

3. **Scrape This Week's Games**
   ```bash
   python scrape_per_game_nhl_stats.py
   ```
   This will populate `player_game_stats.nhl_*` columns for this week's games.

4. **Verify Daily Rosters**
   - Save a lineup in the UI
   - Check `fantasy_daily_rosters` table - should have records for Mon-Sun
   - Verify locks are applied correctly (check `is_locked` for past days)

5. **Verify Daily Scores**
   - Check matchup page - should show 7 daily scores
   - Verify matchup total = sum of daily scores
   - Verify only active players' stats are counted

## Key Points

- **NHL Official Stats**: All scoring uses `player_game_stats.nhl_*` columns (NHL.com official)
- **Daily Locking**: Players lock when their game starts (not when any game starts)
- **User Timezone**: Lock checks use user's timezone from profile
- **Active Players Only**: Bench players' stats are excluded from daily scores
- **7 Day Sum**: Matchup total = Mon + Tue + Wed + Thu + Fri + Sat + Sun

## Next Steps

1. Test boxscore structure to verify field names
2. Run scraper for this week's games
3. Verify daily rosters are created when lineup is saved
4. Verify daily scores calculate correctly
5. Verify matchup totals match sum of daily scores
