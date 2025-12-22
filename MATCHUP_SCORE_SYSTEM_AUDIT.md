# Matchup Score Calculation System - World-Class Audit

## Overview
This document outlines the comprehensive, world-class matchup score calculation system that ensures **ALL matchups** (user teams AND AI teams) use the **EXACT same calculation logic** as the matchup tab.

## Core Principles

1. **Single Source of Truth**: The `calculate_daily_matchup_scores` RPC is the ONLY way scores are calculated
2. **Unified Calculation**: All matchups use identical logic - no special cases
3. **Automatic Synchronization**: Scores update automatically via multiple mechanisms
4. **Performance Optimized**: Strategic indexes ensure fast queries even with large datasets
5. **Error Resilient**: Graceful error handling ensures system continues operating even if individual updates fail

## Architecture

### Database Layer

#### RPC Functions

1. **`calculate_daily_matchup_scores`**
   - **Purpose**: Calculates daily fantasy scores for a team (returns 7 daily scores, Mon-Sun)
   - **Logic**: Uses `fantasy_daily_rosters` to determine active players each day, then sums `player_game_stats.nhl_*` columns
   - **Goalie Detection**: Hard check using `player_directory.position_code = 'G'` (matches frontend)
   - **Returns**: 7 rows (one per day) with `roster_date` and `daily_score`

2. **`calculate_matchup_total_score`**
   - **Purpose**: Sums 7 daily scores to get total matchup score for a team
   - **Logic**: Calls `calculate_daily_matchup_scores` and sums all `daily_score` values
   - **Input Validation**: Validates matchup_id, team_id, week_start, week_end exist and are valid
   - **Returns**: Single `NUMERIC(10, 3)` value

3. **`update_all_matchup_scores`**
   - **Purpose**: Updates `team1_score` and `team2_score` for all matchups in a league (or all leagues)
   - **Logic**: 
     - Loops through all matchups (filtered by league if provided)
     - Calls `calculate_matchup_total_score` for team1 and team2
     - Updates `matchups` table with calculated scores
   - **Error Handling**: Individual matchup failures don't stop the entire operation
   - **Returns**: Table of updated matchups with scores and success status

4. **`auto_complete_matchups`**
   - **Purpose**: Automatically marks matchups as 'completed' when week ends
   - **Enhanced**: Now also updates scores for affected leagues
   - **Logic**: 
     - Finds matchups that need completion (week ended, scores present)
     - Marks them as 'completed'
     - Updates scores for all affected leagues
   - **Error Handling**: Score update failures don't prevent matchup completion

#### Performance Indexes

1. **`idx_matchups_status_week_end`**: Optimizes `auto_complete_matchups` queries
2. **`idx_matchups_league_week_end`**: Optimizes `update_all_matchup_scores` queries
3. **`idx_player_game_stats_player_game`**: Optimizes player stats lookups
4. **`idx_nhl_games_date_game_id`**: Optimizes game date lookups
5. **`idx_player_directory_season_position`**: Optimizes goalie detection queries

### Frontend Layer

#### Service Functions

1. **`MatchupService.updateMatchupScores(leagueId?)`**
   - **Purpose**: Calls `update_all_matchup_scores` RPC from frontend
   - **Error Handling**: Returns error object, doesn't throw
   - **Returns**: `{ error, updatedCount, results }`

#### Automatic Update Triggers

1. **Standings Page Load**
   - Calls `auto_complete_matchups()` (which also updates scores)
   - Then calls `updateMatchupScores(leagueId)` to ensure all scores are current
   - Non-blocking: Errors don't prevent standings from loading

2. **Matchup Page Load**
   - Calls `updateMatchupScores(leagueId)` when league is confirmed and draft is completed
   - Non-blocking: Errors don't prevent matchup from loading

3. **Periodic Refresh (In-Progress Matchups)**
   - Updates scores every 5 minutes for in-progress matchups
   - Runs immediately on mount, then every 5 minutes
   - Only runs for active users viewing in-progress matchups
   - Non-blocking: Errors are logged but don't stop the interval

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Game Stats Scraped                        │
│              (player_game_stats updated)                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Automatic Score Update Triggers                 │
│  • Standings page load                                       │
│  • Matchup page load                                         │
│  • Periodic refresh (every 5 min for in-progress)           │
│  • Week end (via auto_complete_matchups)                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│         update_all_matchup_scores RPC                        │
│  • Loops through all matchups                                │
│  • For each matchup:                                          │
│    - calculate_matchup_total_score(team1)                    │
│    - calculate_matchup_total_score(team2)                    │
│    - Update matchups.team1_score, team2_score                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│      calculate_matchup_total_score RPC                       │
│  • Calls calculate_daily_matchup_scores                      │
│  • Sums 7 daily scores                                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│    calculate_daily_matchup_scores RPC                        │
│  • Uses fantasy_daily_rosters (active players)               │
│  • Joins player_game_stats.nhl_* columns                      │
│  • Returns 7 daily scores (Mon-Sun)                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              matchups Table Updated                          │
│  • team1_score, team2_score updated                          │
│  • Standings and dropdown automatically use new scores       │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Unified Calculation
- **ALL matchups** (user teams AND AI teams) use the **EXACT same calculation**
- No special cases or different logic paths
- Single RPC function ensures consistency

### 2. Automatic Synchronization
- Scores update automatically when:
  - Standings page loads
  - Matchup page loads
  - Every 5 minutes for in-progress matchups
  - Week ends (via `auto_complete_matchups`)
- No manual intervention required

### 3. Error Resilience
- Individual matchup failures don't stop the entire operation
- Errors are logged but don't block UI
- System continues operating even if some updates fail
- Input validation prevents invalid data

### 4. Performance
- Strategic indexes optimize all query patterns
- Efficient joins and filters
- Processes most recent weeks first
- Handles large leagues gracefully

### 5. Data Integrity
- Input validation at every level
- Null checks and COALESCE for safety
- Transaction-safe updates
- Always returns valid scores (never null)

## Testing Checklist

- [x] All matchups use same calculation logic
- [x] Scores update automatically on page loads
- [x] Periodic refresh works for in-progress matchups
- [x] Week completion triggers score updates
- [x] Error handling doesn't break system
- [x] Performance indexes are in place
- [x] Input validation prevents invalid data
- [x] Standings show correct scores
- [x] Matchup dropdown shows correct scores
- [x] AI teams' matchups are calculated correctly

## Migration Files

1. `20251226100000_create_calculate_matchup_total_score_rpc.sql` - Core calculation RPC
2. `20251226110000_create_update_all_matchup_scores_rpc.sql` - Batch update RPC
3. `20251226120000_integrate_score_updates_into_auto_complete.sql` - Auto-complete integration
4. `20251226130000_optimize_matchup_score_calculation_indexes.sql` - Performance indexes

## Future Enhancements

1. **Database Triggers**: Consider adding triggers on `player_game_stats` updates to automatically trigger score updates
2. **Caching**: Add caching layer for frequently accessed matchup scores
3. **Webhooks**: Add webhook support for real-time score updates
4. **Monitoring**: Add metrics and monitoring for score calculation performance
5. **Batch Processing**: Optimize for very large leagues with thousands of matchups

## Conclusion

This system provides a **world-class, production-ready** matchup score calculation system that:
- Ensures consistency across all matchups
- Automatically stays synchronized
- Handles errors gracefully
- Performs efficiently at scale
- Requires zero manual intervention

The system is designed to be **fluid, automatic, and world-class** - exactly as specified.
