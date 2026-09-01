# Citrus Fantasy Sports - Complete System Flowcharts

This document contains detailed flowcharts for all major processes in the Citrus Fantasy Sports application.

---

## 📊 FLOWCHART 1: DATA COLLECTION PIPELINE (NHL Stats → Database)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         NHL DATA COLLECTION PIPELINE                      │
└─────────────────────────────────────────────────────────────────────────┘

START: data_scraping_service.py (24/7 Windows Service)
  │
  ├─► Check Current Time
  │    │
  │    ├─► Is there a LIVE game?
  │    │    ├─► YES: Set interval = 30 seconds
  │    │    └─► NO: Set interval = 5 minutes
  │    │
  │    └─► Is it intermission?
  │         └─► YES: Set interval = 60 seconds
  │
  ├─► Fetch NHL Schedule (nhl-schedule-2025.csv)
  │    │
  │    └─► Store in: nhl_games table
  │         Columns: game_id, home_team, away_team, game_date, game_state
  │
  ├─► For Each Game Today:
  │    │
  │    ├─► Check game_state in nhl_games
  │    │    │
  │    │    ├─► LIVE/CRIT: Fetch immediately (high priority)
  │    │    ├─► FUT/PRE: Skip (not started)
  │    │    └─► FINAL: Check cache
  │    │         │
  │    │         ├─► Cached < 2 hours ago? → Skip
  │    │         └─► Cached > 2 hours ago? → Fetch once (stat corrections)
  │    │
  │    ├─► [BATCH OPERATION - SAME PROXY IP]
  │    │    │
  │    │    ├─► safe_api_call_batch(game_id)
  │    │    │    │
  │    │    │    ├─► Fetch Play-by-Play JSON
  │    │    │    │    URL: /gamecenter/{game_id}/play-by-play
  │    │    │    │    Via: 1 proxy IP from 100-IP pool
  │    │    │    │
  │    │    │    ├─► Fetch Boxscore JSON
  │    │    │    │    URL: /gamecenter/{game_id}/boxscore
  │    │    │    │    Via: SAME proxy IP (bandwidth optimization)
  │    │    │    │
  │    │    │    └─► Circuit Breaker Logic
  │    │    │         │
  │    │    │         ├─► Success? → Continue
  │    │    │         ├─► Auth Error (403)? → Rotate to next proxy IP
  │    │    │         └─► 3 consecutive failures?
  │    │    │              └─► Pause 5s, then 10s, then 20s (exponential backoff)
  │    │    │
  │    │    ├─► Store Raw JSON
  │    │    │    Table: raw_nhl_data
  │    │    │    Columns: game_id, pbp_data (JSONB), boxscore_data (JSONB)
  │    │    │
  │    │    └─► Parse Play-by-Play Events
  │    │         │
  │    │         ├─► Extract Shots/Goals
  │    │         │    Store in: raw_shots
  │    │         │    Columns: game_id, player_id, shot_type, x_coord, y_coord,
  │    │         │             is_goal, shot_distance, shot_angle, strength_state
  │    │         │
  │    │         ├─► Extract Player Stats (from PBP parsing)
  │    │         │    Store in: player_game_stats
  │    │         │    Columns: player_id, game_id, goals, assists, shots,
  │    │         │             blocks, hits, pim, toi_seconds
  │    │         │
  │    │         └─► Extract Goalie Stats
  │    │              Store in: player_game_stats
  │    │              Columns: player_id, game_id, saves, shots_against,
  │    │                       goals_against, toi_seconds
  │
  ├─► NIGHTLY JOB (Midnight MT): fetch_nhl_stats_from_landing.py
  │    │
  │    ├─► Fetch from NHL Landing Endpoint (boxscore API)
  │    │    URL: /stats/rest/en/skater/summary
  │    │    Reason: PPP/SHP accuracy (PBP parsing can miss assists)
  │    │
  │    ├─► For Each Player:
  │    │    │
  │    │    └─► UPDATE player_game_stats SET
  │    │         nhl_goals = landing.goals,
  │    │         nhl_assists = landing.assists,
  │    │         nhl_power_play_points = landing.ppp,
  │    │         nhl_short_handed_points = landing.shp,
  │    │         nhl_shots = landing.shots,
  │    │         nhl_blocks = landing.blocks,
  │    │         nhl_hits = landing.hits,
  │    │         nhl_pim = landing.pim
  │    │
  │    └─► VALIDATION QUERY:
  │         SELECT COALESCE(nhl_goals, goals, 0) as final_goals
  │         -- Uses NHL data if available, falls back to PBP parsing
  │
  ├─► WEEKLY AGGREGATION: build_player_season_stats.py
  │    │
  │    └─► For Each Player:
  │         │
  │         ├─► Sum all player_game_stats
  │         │    GROUP BY player_id, season_id
  │         │
  │         └─► Store in: player_season_stats (SOURCE OF TRUTH)
  │              Columns: player_id, games_played, goals, assists, points,
  │                       ppp, shp, shots, blocks, hits, pim, plus_minus
  │
  └─► ADVANCED STATS PIPELINE (every 6 hours)
       │
       ├─► calculate_xg.py
       │    │
       │    ├─► Load XGBoost model: models/xg_model_moneypuck.joblib
       │    │
       │    ├─► For Each Shot in raw_shots:
       │    │    │
       │    │    ├─► Extract Features:
       │    │    │    - shot_distance (Euclidean from net)
       │    │    │    - shot_angle (degrees from center)
       │    │    │    - shot_type (wrist, slap, snap, etc.)
       │    │    │    - strength_state (EV, PP, SH)
       │    │    │    - rush_shot (boolean)
       │    │    │    - rebound_shot (boolean)
       │    │    │    - traffic (boolean - defender within 5ft)
       │    │    │
       │    │    ├─► Predict: xG = model.predict(features)
       │    │    │
       │    │    └─► UPDATE raw_shots SET expected_goal = xG
       │    │
       │    └─► Aggregate by Player:
       │         │
       │         └─► Store in: player_talent_metrics
       │              Columns: player_id, total_xg, total_xa, sh_percent_above_expected
       │
       ├─► calculate_goalie_gsax.py
       │    │
       │    ├─► For Each Shot Against in raw_shots WHERE goalie_id IS NOT NULL:
       │    │    │
       │    │    ├─► Calculate Expected Save Probability
       │    │    │    ESP = 1 - xG
       │    │    │
       │    │    ├─► Did goalie save it?
       │    │    │    ├─► YES: GSAx += (1 - ESP) = positive
       │    │    │    └─► NO: GSAx += (0 - ESP) = negative
       │    │    │
       │    │    └─► Aggregate: SUM(GSAx) by goalie_id
       │    │
       │    └─► Store in: goalie_gsax
       │         Columns: goalie_id, total_gsax, gsax_per_60
       │
       └─► calculate_gar.py (Goals Above Replacement)
            │
            ├─► Skater GAR:
            │    GAR = (Goals - Expected_Goals) + (xA * 0.7) + (Def_Impact)
            │
            └─► Goalie GAR:
                 GAR = GSAx * (Shots_Against / League_Avg_Shots)

END: Data now available for Fantasy Projections
```

---

## 📊 FLOWCHART 2: FANTASY PROJECTIONS PIPELINE

```
┌─────────────────────────────────────────────────────────────────────────┐
│               FANTASY PROJECTION CALCULATION PIPELINE                     │
└─────────────────────────────────────────────────────────────────────────┘

START: fantasy_projection_pipeline.py (Daily at 6 AM MT)
  │
  ├─► STEP 1: Load Player Historical Data
  │    │
  │    ├─► Query: player_season_stats (current season)
  │    │    SELECT player_id, games_played, goals, assists, shots,
  │    │           blocks, hits, pim, avg_toi
  │    │
  │    ├─► Query: player_talent_metrics
  │    │    SELECT player_id, total_xg, total_xa, sh_percent_above_expected
  │    │
  │    └─► Query: player_toi_by_situation
  │         SELECT player_id, ev_toi, pp_toi, sh_toi, avg_linemates_quality
  │
  ├─► STEP 2: Load Upcoming Schedule (Next 7 Days)
  │    │
  │    └─► Query: nhl_games WHERE game_date BETWEEN today AND today+7
  │         │
  │         └─► For Each Player's Team:
  │              Calculate: games_in_next_7_days
  │
  ├─► STEP 3: Load Opponent Quality
  │    │
  │    └─► Query: team_matchup_difficulty
  │         SELECT opponent_team_id, goals_against_per_game,
  │                shots_against_per_game, pk_percent, pp_percent_against
  │
  ├─► STEP 4: Calculate Base Projections (Physical Stats)
  │    │
  │    ├─► For Each Skater:
  │    │    │
  │    │    ├─► Regression Model (60-day window):
  │    │    │    │
  │    │    │    ├─► Goals/Game = (Total_xG / GP) * Bayesian_Shrinkage
  │    │    │    │    Where: Bayesian_Shrinkage = (GP / (GP + 20))
  │    │    │    │           -- Prevents small-sample volatility
  │    │    │    │
  │    │    │    ├─► Assists/Game = (Total_xA / GP) * Linemate_Quality_Factor
  │    │    │    │
  │    │    │    ├─► PPP/Game = (PP_TOI / Total_TOI) * Team_PP_Percent * 0.8
  │    │    │    │
  │    │    │    ├─► Shots/Game = (Total_Shots / GP) * Usage_Rate
  │    │    │    │
  │    │    │    ├─► Blocks/Game = (Total_Blocks / GP)
  │    │    │    │    -- Simplified (no major adjustments)
  │    │    │    │
  │    │    │    ├─► Hits/Game = (Total_Hits / GP)
  │    │    │    │
  │    │    │    └─► PIM/Game = (Total_PIM / GP) * 0.9
  │    │    │         -- Regression to mean (penalties are random)
  │    │    │
  │    │    ├─► Quality of Competition Adjustment:
  │    │    │    │
  │    │    │    └─► For Each Upcoming Game:
  │    │    │         │
  │    │    │         ├─► Opponent_Def_Rating = team_matchup_difficulty.goals_against_per_game
  │    │    │         │
  │    │    │         ├─► IF Opponent_Def_Rating < League_Avg:
  │    │    │         │    Boost Goals_Projection by 10%
  │    │    │         │
  │    │    │         └─► IF Opponent_Def_Rating > League_Avg:
  │    │    │              Reduce Goals_Projection by 10%
  │    │    │
  │    │    └─► Multiply by games_in_next_7_days
  │    │         │
  │    │         └─► Store in: projection_cache
  │    │              Columns: player_id, proj_goals, proj_assists, proj_ppp,
  │    │                       proj_shots, proj_blocks, proj_hits, proj_pim
  │    │
  │    └─► For Each Goalie:
  │         │
  │         ├─► Regression Model:
  │         │    │
  │         │    ├─► Starts/Week = Team_GP * Expected_Start_Percent
  │         │    │    Where: Expected_Start_Percent based on:
  │         │    │           - Historical start rate (60-day window)
  │         │    │           - Back-to-back games (lower start %)
  │         │    │           - Coach's goalie rotation pattern
  │         │    │
  │         │    ├─► Save_Percent = League_Avg_SV% + (GSAx_Per_60 / 100)
  │         │    │    -- GSAx converts to save percentage delta
  │         │    │
  │         │    ├─► Shots_Against/Game = Opponent_Shots_Per_Game * Team_Def_Factor
  │         │    │
  │         │    ├─► Saves/Game = Shots_Against * Save_Percent
  │         │    │
  │         │    ├─► Goals_Against/Game = Shots_Against * (1 - Save_Percent)
  │         │    │
  │         │    ├─► Win_Probability = Team_Goal_Diff * 0.15 + 0.50
  │         │    │    -- Better teams = higher win chance
  │         │    │
  │         │    └─► Shutout_Probability = Save_Percent^30
  │         │         -- ~30 shots/game, all must be saved
  │         │
  │         └─► Store in: projection_cache
  │              Columns: player_id, proj_starts, proj_wins, proj_saves,
  │                       proj_goals_against, proj_shutouts
  │
  ├─► STEP 5: Convert Physical Projections to Fantasy Points
  │    │
  │    │    [NOTE: This happens PER-LEAGUE based on scoring_settings]
  │    │
  │    └─► For Each League:
  │         │
  │         ├─► Load: leagues.scoring_settings (JSONB)
  │         │    Example:
  │         │    {
  │         │      "skater": {
  │         │        "goals": 6,
  │         │        "assists": 4,
  │         │        "power_play_points": 2,
  │         │        "shots_on_goal": 0.9,
  │         │        "blocks": 1,
  │         │        "hits": 0,
  │         │        "penalty_minutes": 0
  │         │      }
  │         │    }
  │         │
  │         ├─► For Each Player on Roster:
  │         │    │
  │         │    └─► Calculate Fantasy Points:
  │         │         │
  │         │         ├─► IF Skater:
  │         │         │    Total_Points =
  │         │         │      (proj_goals * settings.goals) +
  │         │         │      (proj_assists * settings.assists) +
  │         │         │      (proj_ppp * settings.power_play_points) +
  │         │         │      (proj_shp * settings.short_handed_points) +
  │         │         │      (proj_shots * settings.shots_on_goal) +
  │         │         │      (proj_blocks * settings.blocks) +
  │         │         │      (proj_hits * settings.hits) +
  │         │         │      (proj_pim * settings.penalty_minutes)
  │         │         │
  │         │         └─► IF Goalie:
  │         │              Total_Points =
  │         │                (proj_wins * settings.wins) +
  │         │                (proj_saves * settings.saves) +
  │         │                (proj_shutouts * settings.shutouts) +
  │         │                (proj_goals_against * settings.goals_against)
  │         │
  │         └─► Store in: player_projected_stats
  │              Columns: player_id, league_id, total_projected_points,
  │                       proj_goals, proj_assists, ..., projection_date
  │
  └─► STEP 6: Cache for Frontend
       │
       └─► Store in: projections table (denormalized for speed)
            Columns: player_id, projected_points_default_scoring,
                     proj_goals, proj_assists, proj_ppp, proj_shots,
                     last_updated

END: Projections available in UI via /src/services/PlayerService.ts
```

---

## 📊 FLOWCHART 3: WEEKLY MATCHUP SCORING CALCULATION

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WEEKLY MATCHUP SCORING SYSTEM                          │
└─────────────────────────────────────────────────────────────────────────┘

TRIGGER: calculate_matchup_scores.py (Runs every night at 11 PM MT)
  │
  ├─► STEP 1: Identify Active Matchups
  │    │
  │    └─► Query: SELECT * FROM matchups
  │         WHERE week_start <= today AND week_end >= today
  │         AND league_id IN (SELECT league_id FROM leagues WHERE status = 'active')
  │
  ├─► STEP 2: For Each Matchup:
  │    │
  │    ├─► Load Matchup Details:
  │    │    - matchup_id
  │    │    - league_id
  │    │    - team1_id, team2_id
  │    │    - week_start, week_end (Mon-Sun)
  │    │
  │    ├─► Load League Scoring Settings:
  │    │    Query: SELECT scoring_settings FROM leagues WHERE league_id = ?
  │    │    │
  │    │    └─► Parse JSONB:
  │    │         {
  │    │           "skater": {
  │    │             "goals": 6,
  │    │             "assists": 4,
  │    │             "power_play_points": 2,
  │    │             "short_handed_points": 0,
  │    │             "shots_on_goal": 0.9,
  │    │             "blocks": 1,
  │    │             "hits": 0,
  │    │             "penalty_minutes": 0
  │    │           },
  │    │           "goalie": {
  │    │             "wins": 5,
  │    │             "shutouts": 5,
  │    │             "saves": 0.6,
  │    │             "goals_against": -3
  │    │           }
  │    │         }
  │    │
  │    ├─► STEP 3: Calculate TEAM 1 Score
  │    │    │
  │    │    ├─► Query Daily Rosters for Each Day (Mon-Sun):
  │    │    │    │
  │    │    │    └─► SELECT player_id, slot_type
  │    │    │         FROM fantasy_daily_rosters
  │    │    │         WHERE team_id = team1_id
  │    │    │           AND roster_date = current_day
  │    │    │           AND slot_type = 'active'
  │    │    │         │
  │    │    │         └─► [ONLY ACTIVE PLAYERS COUNT]
  │    │    │              Bench players (slot_type = 'bench') excluded
  │    │    │
  │    │    ├─► For Each Active Player:
  │    │    │    │
  │    │    │    ├─► Query Player Stats for That Day:
  │    │    │    │    │
  │    │    │    │    └─► SELECT
  │    │    │    │         COALESCE(nhl_goals, goals, 0) as final_goals,
  │    │    │    │         COALESCE(nhl_assists, assists, 0) as final_assists,
  │    │    │    │         COALESCE(nhl_power_play_points, 0) as final_ppp,
  │    │    │    │         COALESCE(nhl_short_handed_points, 0) as final_shp,
  │    │    │    │         COALESCE(nhl_shots, shots, 0) as final_shots,
  │    │    │    │         COALESCE(nhl_blocks, blocks, 0) as final_blocks,
  │    │    │    │         COALESCE(nhl_hits, hits, 0) as final_hits,
  │    │    │    │         COALESCE(nhl_pim, pim, 0) as final_pim
  │    │    │    │         FROM player_game_stats
  │    │    │    │         WHERE player_id = ? AND game_date = current_day
  │    │    │    │
  │    │    │    ├─► Determine Position:
  │    │    │    │    Query: SELECT position_code FROM player_directory WHERE player_id = ?
  │    │    │    │    │
  │    │    │    │    ├─► IF position_code = 'G': Use Goalie Scoring
  │    │    │    │    └─► ELSE: Use Skater Scoring
  │    │    │    │
  │    │    │    ├─► Calculate Daily Fantasy Points:
  │    │    │    │    │
  │    │    │    │    ├─► IF Skater:
  │    │    │    │    │    Daily_Points =
  │    │    │    │    │      (final_goals * scoring_settings.skater.goals) +
  │    │    │    │    │      (final_assists * scoring_settings.skater.assists) +
  │    │    │    │    │      (final_ppp * scoring_settings.skater.power_play_points) +
  │    │    │    │    │      (final_shp * scoring_settings.skater.short_handed_points) +
  │    │    │    │    │      (final_shots * scoring_settings.skater.shots_on_goal) +
  │    │    │    │    │      (final_blocks * scoring_settings.skater.blocks) +
  │    │    │    │    │      (final_hits * scoring_settings.skater.hits) +
  │    │    │    │    │      (final_pim * scoring_settings.skater.penalty_minutes)
  │    │    │    │    │
  │    │    │    │    └─► IF Goalie:
  │    │    │    │         │
  │    │    │    │         ├─► Query Goalie-Specific Stats:
  │    │    │    │         │    SELECT wins, saves, shutouts, goals_against
  │    │    │    │         │    FROM player_game_stats
  │    │    │    │         │    WHERE player_id = ? AND game_date = current_day
  │    │    │    │         │
  │    │    │    │         └─► Daily_Points =
  │    │    │    │              (wins * scoring_settings.goalie.wins) +
  │    │    │    │              (saves * scoring_settings.goalie.saves) +
  │    │    │    │              (shutouts * scoring_settings.goalie.shutouts) +
  │    │    │    │              (goals_against * scoring_settings.goalie.goals_against)
  │    │    │    │              -- Note: goals_against is typically negative
  │    │    │    │
  │    │    │    └─► Accumulate: Day_Total += Daily_Points
  │    │    │
  │    │    └─► Repeat for All 7 Days (Mon-Sun)
  │    │         │
  │    │         └─► Team1_Weekly_Total = SUM(All Daily Totals)
  │    │
  │    ├─► STEP 4: Calculate TEAM 2 Score
  │    │    [Exact same process as Team 1]
  │    │
  │    ├─► STEP 5: Update Matchup Results
  │    │    │
  │    │    └─► UPDATE matchups SET
  │    │         team1_score = Team1_Weekly_Total,
  │    │         team2_score = Team2_Weekly_Total,
  │    │         winner_id = CASE
  │    │           WHEN Team1_Weekly_Total > Team2_Weekly_Total THEN team1_id
  │    │           WHEN Team2_Weekly_Total > Team1_Weekly_Total THEN team2_id
  │    │           ELSE NULL -- Tie
  │    │         END,
  │    │         last_calculated = NOW()
  │    │         WHERE matchup_id = ?
  │    │
  │    └─► STEP 6: Calculate Daily Breakdown
  │         │
  │         └─► For Each Day (Mon-Sun):
  │              │
  │              └─► Store in: fantasy_matchup_lines
  │                   Columns: matchup_id, game_date,
  │                            team1_daily_score, team2_daily_score
  │                   │
  │                   └─► [Used for UI chart display]

END: Matchup scores available in /src/pages/Matchup.tsx
     - Weekly totals shown at top
     - Daily breakdown in bar chart
     - Live updates every 30 seconds during game nights
```

---

## 📊 FLOWCHART 4: USER AUTHENTICATION & LEAGUE ISOLATION

```
┌─────────────────────────────────────────────────────────────────────────┐
│               USER AUTHENTICATION & LEAGUE ISOLATION FLOW                 │
└─────────────────────────────────────────────────────────────────────────┘

START: User lands on app (https://citrus-fantasy-sports.web.app)
  │
  ├─► Check Authentication Status
  │    │
  │    ├─► Read from: localStorage.getItem('sb-auth-token')
  │    │    [Supabase stores JWT here]
  │    │
  │    ├─► IF token exists:
  │    │    │
  │    │    ├─► Validate with Supabase: supabase.auth.getSession()
  │    │    │    │
  │    │    │    ├─► Token Valid:
  │    │    │    │    └─► Load user profile from auth.users
  │    │    │    │         Redirect to: /roster
  │    │    │    │
  │    │    │    └─► Token Expired/Invalid:
  │    │    │         └─► Clear localStorage
  │    │    │              Redirect to: /auth
  │    │    │
  │    └─► IF no token:
  │         └─► Redirect to: /auth (Login/Signup page)
  │
  ├─► LOGIN FLOW (/src/pages/Auth.tsx)
  │    │
  │    ├─► User enters email + password
  │    │
  │    ├─► Frontend: AuthContext.signIn(email, password)
  │    │    Location: /src/contexts/AuthContext.tsx:106
  │    │
  │    ├─► Call: supabase.auth.signInWithPassword({ email, password })
  │    │    │
  │    │    ├─► Supabase validates credentials
  │    │    │    │
  │    │    │    ├─► SUCCESS:
  │    │    │    │    │
  │    │    │    │    ├─► Returns: { session: { access_token, user } }
  │    │    │    │    │
  │    │    │    │    ├─► Store JWT in localStorage
  │    │    │    │    │
  │    │    │    │    ├─► Query: SELECT * FROM profiles WHERE id = user.id
  │    │    │    │    │    [RLS Policy: Users can only read their own profile]
  │    │    │    │    │
  │    │    │    │    ├─► Set AuthContext.user = profile data
  │    │    │    │    │
  │    │    │    │    └─► Redirect to: /roster
  │    │    │    │
  │    │    │    └─► FAILURE:
  │    │    │         └─► Show error: "Invalid credentials"
  │    │    │              [NO RATE LIMITING - VULNERABILITY]
  │    │
  │    └─► OAuth Login (Google/Apple)
  │         │
  │         ├─► User clicks "Sign in with Google"
  │         │
  │         ├─► Call: supabase.auth.signInWithOAuth({ provider: 'google' })
  │         │
  │         ├─► Redirect to Google OAuth consent screen
  │         │
  │         ├─► User authorizes → Redirect back to /auth/callback
  │         │
  │         └─► Same flow as password login (query profile, set context)
  │
  ├─► SIGNUP FLOW (/src/pages/Auth.tsx)
  │    │
  │    ├─► User enters: email, password, display_name
  │    │
  │    ├─► Password validation:
  │    │    Location: /src/components/auth/PasswordStrength.tsx:14-19
  │    │    Rules: length >= 8, uppercase, lowercase, number
  │    │    [NOTE: Minimum is only 6 chars - WEAK]
  │    │
  │    ├─► Call: supabase.auth.signUp({ email, password })
  │    │    │
  │    │    ├─► Supabase creates user in auth.users
  │    │    │
  │    │    ├─► Trigger: create_profile_for_new_user() [Database function]
  │    │    │    Location: supabase/migrations/*_create_profile_trigger.sql
  │    │    │    │
  │    │    │    └─► INSERT INTO profiles (id, email, display_name)
  │    │    │         VALUES (new_user.id, new_user.email, 'New User')
  │    │    │
  │    │    ├─► Send verification email (if enabled)
  │    │    │
  │    │    └─► Redirect to: /profile-setup
  │    │
  │    └─► Profile Setup (/src/pages/ProfileSetup.tsx)
  │         │
  │         ├─► User enters: display_name, avatar_url
  │         │
  │         └─► UPDATE profiles SET
  │              display_name = ?,
  │              avatar_url = ?
  │              WHERE id = user.id
  │              [RLS Policy: Users can only update their own profile]
  │
  ├─► LEAGUE SELECTION & ISOLATION
  │    │
  │    ├─► User navigates to: /roster
  │    │    Location: /src/pages/Roster.tsx
  │    │
  │    ├─► LeagueContext loads user's leagues:
  │    │    Location: /src/contexts/LeagueContext.tsx:45
  │    │    │
  │    │    └─► Query:
  │    │         SELECT leagues.*, teams.id as team_id
  │    │         FROM leagues
  │    │         JOIN teams ON teams.league_id = leagues.id
  │    │         WHERE teams.owner_id = user.id
  │    │         │
  │    │         └─► [RLS Policy: Users only see leagues they're members of]
  │    │              Policy: /supabase/migrations/*_comprehensive_league_rls_fix.sql:23
  │    │              CREATE POLICY "Users can view leagues they are members of"
  │    │              ON leagues FOR SELECT
  │    │              USING (user_owns_team_in_league_simple(id))
  │    │
  │    ├─► User selects league from dropdown
  │    │    │
  │    │    └─► LeagueContext.setCurrentLeague(league_id)
  │    │         Location: /src/contexts/LeagueContext.tsx:77
  │    │         │
  │    │         └─► Store in: localStorage.setItem('selectedLeagueId', league_id)
  │    │              [Persists across page refreshes]
  │    │
  │    ├─► LEAGUE ISOLATION ENFORCEMENT (Multi-Layer)
  │    │    │
  │    │    ├─► Layer 1: Frontend LeagueMembershipService
  │    │    │    Location: /src/services/LeagueMembershipService.ts:197
  │    │    │    │
  │    │    │    └─► Before ANY league operation:
  │    │    │         await LeagueMembershipService.requireMembership(league_id, user.id)
  │    │    │         │
  │    │    │         ├─► Check membership cache (30-second TTL)
  │    │    │         │    Cache key: `membership_${league_id}_${user.id}`
  │    │    │         │
  │    │    │         ├─► If not cached:
  │    │    │         │    Query: SELECT COUNT(*) FROM teams
  │    │    │         │           WHERE league_id = ? AND owner_id = ?
  │    │    │         │
  │    │    │         └─► IF count = 0:
  │    │    │              throw Error('Access denied: Not a member')
  │    │    │
  │    │    ├─► Layer 2: Database Row Level Security (RLS)
  │    │    │    Location: supabase/migrations/*_comprehensive_league_rls_fix.sql
  │    │    │    │
  │    │    │    ├─► teams Table Policy:
  │    │    │    │    CREATE POLICY "Users can only view their own teams"
  │    │    │    │    ON teams FOR SELECT
  │    │    │    │    USING (owner_id = auth.uid())
  │    │    │    │
  │    │    │    ├─► team_lineups Policy:
  │    │    │    │    CREATE POLICY "Users can only view lineups for their teams"
  │    │    │    │    ON team_lineups FOR SELECT
  │    │    │    │    USING (
  │    │    │    │      team_id IN (
  │    │    │    │        SELECT id FROM teams WHERE owner_id = auth.uid()
  │    │    │    │      )
  │    │    │    │    )
  │    │    │    │
  │    │    │    ├─► matchups Policy:
  │    │    │    │    CREATE POLICY "Users can view matchups in their leagues"
  │    │    │    │    ON matchups FOR SELECT
  │    │    │    │    USING (
  │    │    │    │      league_id IN (
  │    │    │    │        SELECT league_id FROM teams WHERE owner_id = auth.uid()
  │    │    │    │      )
  │    │    │    │    )
  │    │    │    │
  │    │    │    └─► [45+ tables ALL have RLS policies]
  │    │    │
  │    │    └─► Layer 3: RPC Function Validation
  │    │         Location: supabase/migrations/*_comprehensive_league_rls_fix.sql:113
  │    │         │
  │    │         └─► Example: calculate_daily_matchup_scores(p_league_id)
  │    │              │
  │    │              ├─► IF NOT (
  │    │              │      is_commissioner_of_league(p_league_id) OR
  │    │              │      user_owns_team_in_league_simple(p_league_id)
  │    │              │    )
  │    │              │    THEN RAISE EXCEPTION 'Access denied'
  │    │              │
  │    │              └─► Only then execute function logic
  │    │
  │    └─► CACHE INVALIDATION on League Switch
  │         │
  │         └─► When user switches leagues:
  │              │
  │              ├─► Clear membership cache:
  │              │    LeagueMembershipService.clearCache()
  │              │
  │              ├─► Clear React Query cache:
  │              │    queryClient.invalidateQueries(['league', oldLeagueId])
  │              │
  │              └─► Refetch all data for new league:
  │                   queryClient.prefetchQuery(['league', newLeagueId])
  │
  └─► COMMISSIONER PRIVILEGES
       │
       ├─► Determined by: leagues.commissioner_id = user.id
       │
       ├─► Additional RLS Policies for Commissioners:
       │    │
       │    ├─► Can update league settings:
       │    │    CREATE POLICY "Commissioners can update their league"
       │    │    ON leagues FOR UPDATE
       │    │    USING (commissioner_id = auth.uid())
       │    │
       │    ├─► Can edit team lineups (for all teams):
       │    │    CREATE POLICY "Commissioners can edit any lineup in their league"
       │    │    ON team_lineups FOR UPDATE
       │    │    USING (
       │    │      team_id IN (
       │    │        SELECT teams.id FROM teams
       │    │        JOIN leagues ON leagues.id = teams.league_id
       │    │        WHERE leagues.commissioner_id = auth.uid()
       │    │      )
       │    │    )
       │    │
       │    └─► Can force-process waivers:
       │         RPC: process_waivers_for_league(league_id)
       │         [Validates commissioner_id before executing]
       │
       └─► Frontend Commissioner UI:
            Location: /src/pages/GmOffice.tsx
            Features: Edit league settings, manage teams, force waiver runs

END: User is authenticated, league-isolated, and ready to use app
```

---

## 📊 FLOWCHART 5: DRAFT ROOM SYSTEM

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          LIVE DRAFT ROOM FLOW                             │
└─────────────────────────────────────────────────────────────────────────┘

START: Commissioner starts draft (/src/pages/GmOffice.tsx)
  │
  ├─► Commissioner clicks "Start Draft"
  │    │
  │    └─► Call: LeagueService.startDraft(league_id)
  │         Location: /src/services/LeagueService.ts:456
  │         │
  │         ├─► Validate: User is commissioner
  │         │    Query: SELECT commissioner_id FROM leagues WHERE id = league_id
  │         │    IF commissioner_id != user.id THEN Error
  │         │
  │         ├─► Generate Draft Order (Snake Draft)
  │         │    │
  │         │    ├─► Get all teams in league:
  │         │    │    Query: SELECT id FROM teams WHERE league_id = ? ORDER BY RANDOM()
  │         │    │    [Randomizes draft order]
  │         │    │
  │         │    ├─► Calculate total picks:
  │         │    │    Total = num_teams * roster_size
  │         │    │    Example: 12 teams * 20 players = 240 picks
  │         │    │
  │         │    ├─► Generate snake pattern:
  │         │    │    Round 1: Team1, Team2, ..., Team12
  │         │    │    Round 2: Team12, Team11, ..., Team1  [REVERSED]
  │         │    │    Round 3: Team1, Team2, ..., Team12
  │         │    │    ...
  │         │    │
  │         │    └─► Store in: draft_order table
  │         │         Columns: league_id, pick_number, team_id
  │         │         Example:
  │         │           Pick 1 → Team 5
  │         │           Pick 2 → Team 3
  │         │           Pick 3 → Team 11
  │         │           ...
  │         │
  │         ├─► Update league status:
  │         │    UPDATE leagues SET status = 'drafting' WHERE id = league_id
  │         │
  │         └─► Create draft snapshot:
  │              INSERT INTO draft_snapshots (league_id, current_pick, state)
  │              VALUES (league_id, 1, 'in_progress')
  │
  ├─► Users join draft room (/src/pages/DraftRoom.tsx)
  │    │
  │    ├─► Load draft state:
  │    │    Location: /src/services/DraftService.ts:89
  │    │    │
  │    │    ├─► Query: SELECT * FROM draft_order WHERE league_id = ?
  │    │    │         ORDER BY pick_number
  │    │    │
  │    │    ├─► Query: SELECT * FROM draft_picks WHERE league_id = ?
  │    │    │    [Already-made picks]
  │    │    │
  │    │    └─► Calculate: current_pick = COUNT(draft_picks) + 1
  │    │
  │    ├─► Subscribe to real-time updates:
  │    │    Location: /src/pages/DraftRoom.tsx:145
  │    │    │
  │    │    └─► supabase
  │    │         .channel('draft-room')
  │    │         .on('postgres_changes', {
  │    │           event: 'INSERT',
  │    │           schema: 'public',
  │    │           table: 'draft_picks'
  │    │         }, (payload) => {
  │    │           // New pick made → Update UI
  │    │           addPickToBoard(payload.new)
  │    │         })
  │    │         .subscribe()
  │    │
  │    └─► Display UI:
  │         ├─► Draft Board (all picks so far)
  │         ├─► Player List (available players)
  │         ├─► Current Pick indicator
  │         └─► "Your Turn" banner (if on the clock)
  │
  ├─► MAKING A PICK
  │    │
  │    ├─► User searches for player
  │    │    Location: /src/pages/DraftRoom.tsx:234
  │    │    │
  │    │    └─► Query: SELECT * FROM players
  │    │         WHERE name ILIKE '%search_term%'
  │    │           AND id NOT IN (SELECT player_id FROM draft_picks WHERE league_id = ?)
  │    │         ORDER BY projections.total_projected_points DESC
  │    │         LIMIT 50
  │    │
  │    ├─► User clicks "Draft Player"
  │    │    │
  │    │    ├─► Validate: It's their turn
  │    │    │    │
  │    │    │    ├─► Get current pick:
  │    │    │    │    current_pick_num = COUNT(draft_picks) + 1
  │    │    │    │
  │    │    │    ├─► Get team on the clock:
  │    │    │    │    Query: SELECT team_id FROM draft_order
  │    │    │    │           WHERE league_id = ? AND pick_number = current_pick_num
  │    │    │    │
  │    │    │    └─► IF team_id != user's_team_id:
  │    │    │         Error: "Not your turn"
  │    │    │
  │    │    ├─► Validate: Player not already drafted
  │    │    │    Query: SELECT COUNT(*) FROM draft_picks
  │    │    │           WHERE league_id = ? AND player_id = ?
  │    │    │    IF count > 0: Error: "Player already drafted"
  │    │    │
  │    │    ├─► Make the pick:
  │    │    │    Location: /src/services/DraftService.ts:178
  │    │    │    │
  │    │    │    └─► INSERT INTO draft_picks (
  │    │    │         league_id,
  │    │    │         team_id,
  │    │    │         player_id,
  │    │    │         pick_number,
  │    │    │         timestamp
  │    │    │        ) VALUES (?, ?, ?, current_pick_num, NOW())
  │    │    │        │
  │    │    │        └─► [Real-time update broadcasts to all users in room]
  │    │    │
  │    │    ├─► Add player to roster:
  │    │    │    INSERT INTO team_lineups (
  │    │    │      team_id,
  │    │    │      player_id,
  │    │    │      slot_type,
  │    │    │      slot_index
  │    │    │    ) VALUES (team_id, player_id, 'bench', next_available_index)
  │    │    │
  │    │    └─► Update UI:
  │    │         ├─► Add player to Draft Board
  │    │         ├─► Remove from available players
  │    │         ├─► Advance to next pick
  │    │         └─► Show "Player X on the clock"
  │    │
  │    └─► AUTO-PICK (if user doesn't pick in time)
  │         │
  │         ├─► Timer: 90 seconds per pick (configurable)
  │         │
  │         ├─► IF timer expires:
  │         │    │
  │         │    └─► Select best available player:
  │         │         │
  │         │         ├─► Query: SELECT player_id FROM projections
  │         │         │           WHERE player_id NOT IN (
  │         │         │             SELECT player_id FROM draft_picks WHERE league_id = ?
  │         │         │           )
  │         │         │           ORDER BY total_projected_points DESC
  │         │         │           LIMIT 1
  │         │         │
  │         │         └─► Make pick automatically (same INSERT logic)
  │         │
  │         └─► Notify user: "Auto-picked: Player X"
  │
  ├─► DRAFT COMPLETION
  │    │
  │    ├─► After all picks made:
  │    │    IF COUNT(draft_picks) = (num_teams * roster_size)
  │    │
  │    ├─► Update league status:
  │    │    UPDATE leagues SET status = 'active' WHERE id = league_id
  │    │
  │    ├─► Finalize rosters:
  │    │    For each team:
  │    │      - Validate roster size
  │    │      - Set initial lineups (top players to active slots)
  │    │
  │    └─► Redirect all users to: /roster

END: Draft complete, league is active, users manage rosters
```

---

## 📊 FLOWCHART 6: WAIVER WIRE PROCESSING

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WAIVER WIRE PROCESSING FLOW                        │
└─────────────────────────────────────────────────────────────────────────┘

START: User submits waiver claim (/src/pages/WaiverWire.tsx)
  │
  ├─► User selects:
  │    - Player to ADD (from free agents)
  │    - Player to DROP (from their roster)
  │    - Priority ranking (if multiple claims)
  │
  ├─► Submit Claim
  │    Location: /src/services/WaiverService.ts:89
  │    │
  │    ├─► Validate: Player is eligible
  │    │    Query: SELECT * FROM player_waiver_status
  │    │           WHERE player_id = ? AND league_id = ?
  │    │    │
  │    │    ├─► IF on_waivers = false: Error "Player not on waivers"
  │    │    └─► IF waiver_clear_date > NOW(): Error "Waivers haven't cleared"
  │    │
  │    ├─► Validate: User owns drop player
  │    │    Query: SELECT COUNT(*) FROM team_lineups
  │    │           WHERE team_id = user's_team AND player_id = drop_player_id
  │    │    IF count = 0: Error "You don't own this player"
  │    │
  │    ├─► Get current waiver priority:
  │    │    Query: SELECT priority FROM waiver_priority
  │    │           WHERE league_id = ? AND team_id = user's_team
  │    │
  │    └─► INSERT INTO waiver_claims (
  │         league_id,
  │         team_id,
  │         player_id_add,
  │         player_id_drop,
  │         priority,
  │         status,
  │         submitted_at
  │        ) VALUES (?, ?, ?, ?, current_priority, 'pending', NOW())
  │
  ├─► NIGHTLY WAIVER PROCESSING (3 AM local time)
  │    TRIGGER: Python script - process_waivers.py (scheduled task)
  │    │
  │    ├─► For Each League:
  │    │    │
  │    │    ├─► STEP 1: Acquire Advisory Lock (Prevents concurrent processing)
  │    │    │    Location: supabase/migrations/*_add_waiver_concurrency_locks.sql:48
  │    │    │    │
  │    │    │    └─► SELECT pg_try_advisory_xact_lock(hashtext(league_id::TEXT))
  │    │    │         │
  │    │    │         ├─► Lock acquired: Continue
  │    │    │         └─► Lock NOT acquired: Skip (another process is running)
  │    │    │
  │    │    ├─► STEP 2: Get all pending claims for this league
  │    │    │    │
  │    │    │    └─► Query: SELECT * FROM waiver_claims
  │    │    │         WHERE league_id = ?
  │    │    │           AND status = 'pending'
  │    │    │         ORDER BY priority ASC, submitted_at ASC
  │    │    │         FOR UPDATE SKIP LOCKED
  │    │    │         -- Locks rows, skips if locked by another transaction
  │    │    │
  │    │    ├─► STEP 3: Determine Waiver System Type
  │    │    │    Query: SELECT waiver_system FROM leagues WHERE id = league_id
  │    │    │    │
  │    │    │    ├─► "rolling" - Reverse standings order (worst team = priority 1)
  │    │    │    ├─► "faab" - Blind bidding (highest bid wins)
  │    │    │    └─► "reverse_standings" - Worst team always picks first
  │    │    │
  │    │    ├─► STEP 4: Process Claims in Priority Order
  │    │    │    │
  │    │    │    └─► For Each Claim (sorted by priority):
  │    │    │         │
  │    │    │         ├─► Check if player still available:
  │    │    │         │    Query: SELECT COUNT(*) FROM team_lineups
  │    │    │         │           WHERE player_id = claim.player_id_add
  │    │    │         │             AND team_id IN (SELECT id FROM teams WHERE league_id = ?)
  │    │    │         │    │
  │    │    │         │    ├─► Count = 0: Player available → Process claim
  │    │    │         │    └─► Count > 0: Player taken → Reject claim
  │    │    │         │
  │    │    │         ├─► IF Player Available:
  │    │    │         │    │
  │    │    │         │    ├─► Transaction START
  │    │    │         │    │
  │    │    │         │    ├─► Remove dropped player from roster:
  │    │    │         │    │    DELETE FROM team_lineups
  │    │    │         │    │    WHERE team_id = claim.team_id
  │    │    │         │    │      AND player_id = claim.player_id_drop
  │    │    │         │    │
  │    │    │         │    ├─► Add new player to roster:
  │    │    │         │    │    INSERT INTO team_lineups (
  │    │    │         │    │      team_id,
  │    │    │         │    │      player_id,
  │    │    │         │    │      slot_type,
  │    │    │         │    │      slot_index
  │    │    │         │    │    ) VALUES (claim.team_id, claim.player_id_add, 'bench', ?)
  │    │    │         │    │
  │    │    │         │    ├─► Log transaction:
  │    │    │         │    │    INSERT INTO roster_transactions (
  │    │    │         │    │      team_id,
  │    │    │         │    │      transaction_type,
  │    │    │         │    │      player_id_added,
  │    │    │         │    │      player_id_dropped,
  │    │    │         │    │      timestamp
  │    │    │         │    │    ) VALUES (claim.team_id, 'waiver', ...)
  │    │    │         │    │
  │    │    │         │    ├─► Update claim status:
  │    │    │         │    │    UPDATE waiver_claims SET status = 'approved'
  │    │    │         │    │    WHERE id = claim.id
  │    │    │         │    │
  │    │    │         │    ├─► Update waiver priority (if rolling):
  │    │    │         │    │    -- Move claiming team to end of priority list
  │    │    │         │    │    UPDATE waiver_priority
  │    │    │         │    │    SET priority = (SELECT MAX(priority) + 1 FROM waiver_priority)
  │    │    │         │    │    WHERE team_id = claim.team_id
  │    │    │         │    │    │
  │    │    │         │    │    └─► Renumber all priorities (1, 2, 3, ...)
  │    │    │         │    │
  │    │    │         │    └─► Transaction COMMIT
  │    │    │         │
  │    │    │         └─► IF Player NOT Available:
  │    │    │              │
  │    │    │              └─► UPDATE waiver_claims SET status = 'rejected',
  │    │    │                   rejection_reason = 'Player already claimed'
  │    │    │                   WHERE id = claim.id
  │    │    │
  │    │    └─► STEP 5: Send Notifications
  │    │         │
  │    │         └─► For Each Processed Claim:
  │    │              │
  │    │              ├─► IF status = 'approved':
  │    │              │    INSERT INTO notifications (
  │    │              │      user_id,
  │    │              │      title,
  │    │              │      message
  │    │              │    ) VALUES (
  │    │              │      team.owner_id,
  │    │              │      'Waiver Claim Approved',
  │    │              │      'You claimed Player X'
  │    │              │    )
  │    │              │
  │    │              └─► IF status = 'rejected':
  │    │                   INSERT INTO notifications (...)
  │    │                   VALUES (..., 'Waiver Claim Rejected', 'Player X was claimed by another team')
  │    │
  │    └─► Release Advisory Lock (automatic at transaction end)
  │
  └─► USER SEES RESULTS (Next Morning)
       │
       └─► Navigate to: /waiver-wire
            │
            ├─► Query: SELECT * FROM waiver_claims
            │          WHERE team_id = user's_team
            │          ORDER BY submitted_at DESC
            │
            └─► Display:
                 ├─► Approved claims (green checkmark)
                 ├─► Rejected claims (red X, with reason)
                 └─► Pending claims (yellow clock)

END: Waiver processing complete, rosters updated
```

---

## 📊 FLOWCHART 7: GAME LOCK SYSTEM

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GAME LOCK ENFORCEMENT                           │
└─────────────────────────────────────────────────────────────────────────┘

PURPOSE: Prevent lineup changes after a player's game has started

START: User attempts to edit lineup (/src/pages/Roster.tsx)
  │
  ├─► User drags player to new slot
  │    Location: /src/pages/Roster.tsx:456 (drag & drop handler)
  │
  ├─► BEFORE APPLYING CHANGE - Check Game Lock
  │    Location: /src/services/GameLockService.ts:34
  │    │
  │    └─► isPlayerLocked(player_id, current_date)
  │         │
  │         ├─► Query: SELECT game_state, game_time
  │         │          FROM nhl_games
  │         │          WHERE game_date = current_date
  │         │            AND (home_team_id = player.team_id OR away_team_id = player.team_id)
  │         │
  │         ├─► Check game_state:
  │         │    │
  │         │    ├─► game_state = 'LIVE' → LOCKED
  │         │    ├─► game_state = 'FINAL' → LOCKED
  │         │    ├─► game_state = 'CRIT' (critical, OT) → LOCKED
  │         │    ├─► game_state = 'FUT' (future) → Check time
  │         │    │    │
  │         │    │    └─► IF NOW() > game_time:
  │         │    │         LOCKED (game started but API hasn't updated state yet)
  │         │    │
  │         │    └─► game_state = 'PRE' (pregame) → Check time
  │         │         │
  │         │         └─► IF NOW() > game_time:
  │         │              LOCKED
  │         │
  │         └─► RETURN: { locked: true/false, reason: 'Game started at 7:00 PM' }
  │
  ├─► IF Player is LOCKED:
  │    │
  │    └─► Show error toast:
  │         "Cannot move Player X - their game has started"
  │         │
  │         └─► Cancel drag operation
  │              (player snaps back to original position)
  │
  └─► IF Player is NOT LOCKED:
       │
       └─► Apply lineup change:
            │
            └─► UPDATE team_lineups SET
                 slot_type = new_slot,
                 slot_index = new_index
                 WHERE team_id = ? AND player_id = ?

END: Lineup change applied (or blocked if game locked)
```

---

## 📊 FLOWCHART 8: FRONTEND PAGE NAVIGATION

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        USER NAVIGATION FLOW                               │
└─────────────────────────────────────────────────────────────────────────┘

App Entry Point: /src/App.tsx
  │
  ├─► React Router Setup
  │    Location: /src/App.tsx:45-180
  │    │
  │    └─► Routes:
  │         │
  │         ├─► / (Landing Page)
  │         │    Component: /src/pages/Index.tsx
  │         │    Purpose: Marketing page, "Get Started" button → /auth
  │         │    Visibility: Public (no auth required)
  │         │
  │         ├─► /auth (Login/Signup)
  │         │    Component: /src/pages/Auth.tsx
  │         │    Features:
  │         │      - Email/password login
  │         │      - OAuth (Google, Apple)
  │         │      - Password reset
  │         │    Related: /src/components/auth/PasswordStrength.tsx
  │         │
  │         ├─► /auth/callback (OAuth Redirect)
  │         │    Component: /src/pages/AuthCallback.tsx
  │         │    Purpose: Handle OAuth redirects, extract token, redirect to /roster
  │         │
  │         ├─► /profile-setup (New User Onboarding)
  │         │    Component: /src/pages/ProfileSetup.tsx
  │         │    Purpose: Set display name, avatar
  │         │    After completion: Redirect to /roster
  │         │
  │         ├─► /roster (Main Page - Protected)
  │         │    Component: /src/pages/Roster.tsx
  │         │    Features:
  │         │      - View current lineup
  │         │      - Drag & drop to change lineup
  │         │      - Active/Bench slots
  │         │      - Game lock indicators
  │         │    Services: RosterCacheService, GameLockService
  │         │    Context: LeagueContext, AuthContext
  │         │
  │         ├─► /draft-room (Live Draft - Protected)
  │         │    Component: /src/pages/DraftRoom.tsx
  │         │    Features:
  │         │      - Real-time draft board
  │         │      - Player search
  │         │      - Make picks
  │         │      - Auto-pick timer
  │         │    Real-time: Supabase channel subscription
  │         │    Services: DraftService
  │         │    Components: /src/components/draft/DraftBoard.tsx
  │         │
  │         ├─► /matchup/:leagueId/:weekId (Weekly Matchup - Protected)
  │         │    Component: /src/pages/Matchup.tsx
  │         │    Features:
  │         │      - View weekly head-to-head scores
  │         │      - Daily breakdown chart
  │         │      - Player stats by day
  │         │      - Live score updates (30s polling)
  │         │    Services: MatchupService
  │         │    Charts: Recharts (bar chart for daily scores)
  │         │
  │         ├─► /free-agents (Free Agent Search - Protected)
  │         │    Component: /src/pages/FreeAgents.tsx
  │         │    Features:
  │         │      - Search all available players
  │         │      - Filter by position, team
  │         │      - Sort by projections
  │         │      - Add to roster (if roster spots available)
  │         │    Services: PlayerService
  │         │    Query: Loads 900+ players with projections
  │         │
  │         ├─► /waiver-wire (Waiver Claims - Protected)
  │         │    Component: /src/pages/WaiverWire.tsx
  │         │    Features:
  │         │      - View players on waivers
  │         │      - Submit waiver claims
  │         │      - View pending/approved/rejected claims
  │         │      - Waiver priority display
  │         │    Services: WaiverService
  │         │
  │         ├─► /trade-analyzer (Trade Proposals - Protected)
  │         │    Component: /src/pages/TradeAnalyzer.tsx
  │         │    Features:
  │         │      - Create multi-player trade proposals
  │         │      - View trade impact (before/after projections)
  │         │      - Accept/reject incoming trades
  │         │      - Commissioner approval workflow
  │         │    Services: TradeService
  │         │
  │         ├─► /standings (League Standings - Protected)
  │         │    Component: /src/pages/Standings.tsx
  │         │    Features:
  │         │      - Win/loss records
  │         │      - Points for/against
  │         │      - Playoff seeding
  │         │    Services: LeagueService
  │         │
  │         ├─► /league/:leagueId (League Dashboard - Protected)
  │         │    Component: /src/pages/League.tsx
  │         │    Features:
  │         │      - League overview
  │         │      - All teams
  │         │      - Recent transactions
  │         │      - League settings (if commissioner)
  │         │
  │         ├─► /team/:teamId (Other Team View - Protected)
  │         │    Component: /src/pages/TeamPage.tsx
  │         │    Features:
  │         │      - View other team's roster
  │         │      - Recent moves
  │         │      - Team stats
  │         │    Validation: Must be in same league
  │         │
  │         ├─► /gm-office (Commissioner Tools - Protected, Commissioner Only)
  │         │    Component: /src/pages/GmOffice.tsx
  │         │    Features:
  │         │      - Start/pause draft
  │         │      - Edit league settings
  │         │      - Force-process waivers
  │         │      - Edit any team's roster
  │         │      - Manage league members
  │         │    Validation: Must be commissioner of current league
  │         │
  │         ├─► /team-analytics (Advanced Analytics - Protected)
  │         │    Component: /src/pages/TeamAnalytics.tsx
  │         │    Features:
  │         │      - xG/xA for all players
  │         │      - GAR (Goals Above Replacement)
  │         │      - GSAx for goalies
  │         │      - Strength of schedule
  │         │    Data: player_talent_metrics, goalie_gsax
  │         │
  │         └─► /profile (User Profile - Protected)
  │              Component: /src/pages/Profile.tsx
  │              Features:
  │                - Edit display name
  │                - Change avatar
  │                - Email settings
  │                - Password change
  │
  └─► Protected Route Wrapper
       Location: /src/App.tsx:30-42
       │
       └─► For any route marked "Protected":
            │
            ├─► Check: AuthContext.user exists
            │    │
            │    ├─► User logged in: Render page
            │    └─► User NOT logged in: Redirect to /auth
            │
            └─► Load dependencies:
                 - LeagueContext (current league)
                 - User's teams
                 - League membership

END: User navigates between pages based on role and league membership
```

---

## 📊 SUMMARY: COMPLETE SYSTEM DATA FLOW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    END-TO-END SYSTEM DATA FLOW                            │
└─────────────────────────────────────────────────────────────────────────┘

[LAYER 1: DATA COLLECTION]
NHL API (api-web.nhle.com)
  ↓ (100 rotating proxy IPs, 30s-5min intervals)
data_scraping_service.py (24/7 Windows Service)
  ↓ (Parses JSON, stores raw data)
raw_nhl_data + raw_shots tables
  ↓ (Nightly at midnight MT)
fetch_nhl_stats_from_landing.py (PPP/SHP accuracy)
  ↓ (Updates nhl_* columns)
player_game_stats (8 stat categories per player per game)
  ↓ (Weekly aggregation)
player_season_stats (SOURCE OF TRUTH for season totals)

[LAYER 2: ADVANCED ANALYTICS]
raw_shots table
  ↓ (XGBoost model: xg_model_moneypuck.joblib)
calculate_xg.py → player_talent_metrics (xG, xA, shooting talent)
  ↓
calculate_goalie_gsax.py → goalie_gsax (saves above expected)
  ↓
calculate_gar.py → player_gar_components (Goals Above Replacement)

[LAYER 3: FANTASY PROJECTIONS]
player_season_stats + player_talent_metrics + nhl_games (schedule)
  ↓ (Daily at 6 AM MT)
fantasy_projection_pipeline.py (Bayesian regression + QoC adjustments)
  ↓
projection_cache (Physical stats: goals, assists, shots, etc.)
  ↓ (Apply league-specific scoring settings)
player_projected_stats (Fantasy points per league)

[LAYER 4: FANTASY SCORING]
player_game_stats (Actuals) + leagues.scoring_settings (Rules)
  ↓ (Nightly at 11 PM MT)
calculate_matchup_scores.py
  ↓ (Aggregates active players only, applies scoring multipliers)
matchups.team1_score + matchups.team2_score (Weekly totals)
  ↓
fantasy_matchup_lines (Daily breakdown for chart)

[LAYER 5: USER INTERFACE]
Supabase Database (PostgreSQL)
  ↓ (React Query with 5-min stale time)
Frontend Service Layer (TypeScript)
  - PlayerService.ts (player search, stats)
  - MatchupService.ts (weekly scores)
  - RosterCacheService.ts (lineup management)
  - DraftService.ts (draft picks)
  - WaiverService.ts (waiver claims)
  ↓
React Components (UI)
  - Roster.tsx (lineup management)
  - Matchup.tsx (weekly scores)
  - DraftRoom.tsx (live draft)
  - WaiverWire.tsx (waiver claims)
  - TeamAnalytics.tsx (advanced stats)
  ↓
User's Browser

[SECURITY LAYER - ENFORCED AT ALL LEVELS]
Row Level Security (RLS) - Database filters data by league_id + owner_id
  ↓
LeagueMembershipService.ts - Application-level validation (30s cache)
  ↓
RPC Function Validation - Database functions validate membership before executing
  ↓
League Isolation Guaranteed - Users ONLY see their league's data
```

---

This flowchart document provides a complete visual reference for understanding how data moves through the system, from NHL API scraping to user-facing fantasy scores. Each flowchart corresponds to a major subsystem and can be used for debugging, onboarding new engineers, or planning improvements.
