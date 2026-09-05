/**
 * queryColumns.ts - Centralized column selection for Supabase queries
 * 
 * ENTERPRISE EGRESS OPTIMIZATION
 * 
 * Purpose: Reduce egress by selecting ONLY the columns needed for each table
 * instead of using .select('*') which transfers ALL columns.
 * 
 * Benefits:
 * - 40-60% reduction in data transfer per query
 * - Faster query responses
 * - Lower Supabase egress costs
 * 
 * Usage:
 *   import { COLUMNS } from '@/utils/queryColumns';
 *   supabase.from('matchups').select(COLUMNS.MATCHUP)
 */

// ============================================================================
// MATCHUP TABLE COLUMNS
// ============================================================================
// Based on Matchup interface in MatchupService.ts
export const MATCHUP_COLUMNS = 'id, league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date, created_at, updated_at';

// Slim version for list views (no timestamps)
export const MATCHUP_COLUMNS_SLIM = 'id, league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date';

// ============================================================================
// LEAGUE TABLE COLUMNS  
// ============================================================================
// Based on League interface in LeagueService.ts
// 2026-08-24: waiver/trade columns added — the commissioner settings dialog
// hydrates from leagueData.waiver_type etc.; omitting them here made every
// league read as defaults ('rolling', 2:00 AM, 48h) in that dialog, and a
// commissioner pressing Save then silently REVERTED the league's real
// waiver configuration to those defaults.
export const LEAGUE_COLUMNS = 'id, name, commissioner_id, draft_status, join_code, roster_size, draft_rounds, league_size, settings, scoring_settings, scheduled_draft_time, waiver_type, waiver_process_time, waiver_period_hours, waiver_game_lock, allow_trades_during_games, trade_review_type, trade_review_period_hours, trade_veto_threshold, created_at, updated_at';

// Slim version for list views
export const LEAGUE_COLUMNS_SLIM = 'id, name, commissioner_id, draft_status, roster_size, league_size, settings, scoring_settings, scheduled_draft_time';

// ============================================================================
// TEAM TABLE COLUMNS
// ============================================================================
// Based on Team interface in LeagueService.ts
export const TEAM_COLUMNS = 'id, league_id, owner_id, team_name, created_at, updated_at';

// Slim version for list views
export const TEAM_COLUMNS_SLIM = 'id, league_id, owner_id, team_name';

// ============================================================================
// ROSTER ASSIGNMENTS TABLE COLUMNS (Source of Truth for Rosters)
// ============================================================================
// Replaces draft_picks queries for roster membership (Jan 17, 2026)
export const ROSTER_ASSIGNMENT_COLUMNS = 'id, league_id, team_id, player_id, acquired_at, created_at, updated_at';

// Slim version - just what's needed for roster building
export const ROSTER_ASSIGNMENT_COLUMNS_SLIM = 'id, player_id, team_id';

// ============================================================================
// DRAFT PICKS TABLE COLUMNS (DEPRECATED for roster queries)
// ============================================================================
// Note: draft_picks table has 'picked_at', NOT 'created_at'
// ⚠️ DEPRECATED: Use roster_assignments for current roster membership
export const DRAFT_PICK_COLUMNS = 'id, league_id, team_id, player_id, pick_number, round_number, draft_session_id, picked_at, deleted_at';

// Slim version - just what's needed for roster building
export const DRAFT_PICK_COLUMNS_SLIM = 'id, player_id, team_id, pick_number';

// ============================================================================
// NHL GAMES TABLE COLUMNS
// ============================================================================
// Full columns for game display - kept as * since most are needed
export const NHL_GAME_COLUMNS = 'id, game_id, game_date, game_time, home_team, away_team, home_score, away_score, status, period, period_time, venue, season, game_type, moneyline_home, moneyline_away, implied_win_probability_home, implied_win_probability_away';

// Slim version for schedule checks
export const NHL_GAME_COLUMNS_SLIM = 'game_id, game_date, home_team, away_team, status';

// For has-game-today checks
export const NHL_GAME_COLUMNS_MINIMAL = 'home_team, away_team';

// ============================================================================
// PLAYER SEASON STATS COLUMNS
// ============================================================================
// Full stats for player display
export const PLAYER_STATS_DISPLAY = 'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds, goalie_gp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts, nhl_shots_faced, nhl_goals_against, x_goals, updated_at';

// Projection-related stats only
export const PLAYER_STATS_PROJECTIONS = 'player_id, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, total_projected_points';

// ============================================================================
// WAIVER/TRADE COLUMNS
// ============================================================================
// Base columns that exist from the initial migration — safe for all waiver types
export const WAIVER_CLAIM_COLUMNS_BASE = 'id, league_id, team_id, player_id, drop_player_id, priority, status, created_at, processed_at, failure_reason';

// Full columns including FAAB-specific fields (bid_amount, is_conditional_drop)
export const WAIVER_CLAIM_COLUMNS = 'id, league_id, team_id, player_id, drop_player_id, priority, bid_amount, status, created_at, processed_at, failure_reason, is_conditional_drop';

export const TRADE_OFFER_COLUMNS = 'id, league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids, status, message, created_at, expires_at, processed_at, counter_offer_id, review_type, review_started_at, review_ends_at, vetoed_at';

// ============================================================================
// FANTASY MATCHUP LINES COLUMNS
// ============================================================================
// Note: The table schema is:
// - total_points (not 'points')
// - stats_breakdown (not 'stats')
// - No 'slot' or 'is_starter' columns (those are in fantasy_daily_rosters)
export const MATCHUP_LINES_COLUMNS = 'id, matchup_id, player_id, team_id, total_points, stats_breakdown, games_played, games_remaining_total, games_remaining_active, has_live_game, updated_at, created_at';

// Slim version - just essentials for matchup display
export const MATCHUP_LINES_COLUMNS_SLIM = 'id, matchup_id, player_id, team_id, total_points';

// ============================================================================
// PROFILE COLUMNS
// ============================================================================
// `avatar_url` was missing until 2026-09-04: the account page uploaded one,
// PUT /api/account/profile stored it, and GET /api/account/profile never
// returned it, so the avatar vanished on the next load while the league
// rows (which fetch it themselves) still showed it. `push_notifications` is
// the on-the-clock opt-in (migration 20260905001000).
export const PROFILE_COLUMNS = 'id, username, display_name, first_name, last_name, phone, location, bio, default_team_name, timezone, avatar_url, push_notifications, created_at, updated_at';

// ============================================================================
// DRAFT ORDER COLUMNS
// ============================================================================
export const DRAFT_ORDER_COLUMNS = 'id, league_id, round_number, team_order, created_at';

// ============================================================================
// PLAYER PROJECTED STATS COLUMNS
// ============================================================================
export const PLAYER_PROJECTED_STATS_COLUMNS = 'projection_id, player_id, game_id, projection_date, season, calculation_method, total_projected_points, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, projected_xg, projected_wins, projected_saves, projected_shutouts, projected_goals_against, projected_gaa, projected_save_pct, is_goalie, starter_confirmed, base_ppg, shrinkage_weight, finishing_multiplier, opponent_adjustment, b2b_penalty, home_away_adjustment, confidence_score, opponent_abbrev, is_home_game, matchup_difficulty, created_at, updated_at';

// ============================================================================
// KEEPER DESIGNATION COLUMNS
// ============================================================================
export const KEEPER_DESIGNATION_COLUMNS = 'id, league_id, team_id, player_id, season_year, keeper_round, keeper_penalty_type, original_draft_round, years_kept, designated_at, approved_by, status';

// ============================================================================
// AUCTION DRAFT COLUMNS
// ============================================================================
export const AUCTION_BUDGET_COLUMNS = 'id, league_id, team_id, initial_budget, remaining_budget, players_won, updated_at';

export const AUCTION_NOMINATION_COLUMNS = 'id, league_id, draft_session_id, nominated_by_team_id, player_id, player_name, minimum_bid, current_high_bid, current_high_bidder_team_id, status, nomination_number, expires_at, created_at';

export const AUCTION_BID_COLUMNS = 'id, league_id, nomination_id, team_id, bid_amount, created_at';

// ============================================================================
// DRAFT SNAPSHOT COLUMNS
// ============================================================================
export const DRAFT_SNAPSHOT_COLUMNS = 'id, league_id, draft_session_id, snapshot_data, created_at';

// ============================================================================
// POOL PICK COLUMNS (Pick'em)
// ============================================================================
export const POOL_PICK_COLUMNS = 'id, league_id, user_id, week_number, game_id, picked_team, is_correct, spread_value, created_at, updated_at';

// ============================================================================
// CONFIDENCE PICK COLUMNS
// ============================================================================
export const CONFIDENCE_PICK_COLUMNS = 'id, league_id, user_id, week_number, game_id, picked_team, confidence_points, is_correct, points_earned, created_at';

// ============================================================================
// GAME SPREAD / ODDS COLUMNS
// ============================================================================
export const GAME_SPREAD_COLUMNS = 'id, game_id, game_date, external_id, home_team, away_team, home_spread, away_spread, home_moneyline, away_moneyline, over_under, source, bookmaker, fetched_at';

// ============================================================================
// PLAYOFF COLUMNS
// ============================================================================
export const PLAYOFF_BRACKET_COLUMNS = 'id, league_id, season, bracket_size, status, current_round, total_rounds, seeding_method, reseed_each_round, consolation_enabled, two_week_matchups, champion_team_id, runner_up_team_id, third_place_team_id, generated_by, started_at, completed_at, created_at, updated_at';

export const PLAYOFF_SEED_COLUMNS = 'id, bracket_id, team_id, seed_number, regular_season_wins, regular_season_losses, regular_season_ties, regular_season_points_for, source, created_at';

export const PLAYOFF_SERIES_COLUMNS = 'id, bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, home_team_id, away_team_id, home_score, away_score, winner_team_id, loser_team_id, status, matchup_week_1, matchup_week_2, winner_advances_to, winner_slot, loser_drops_to, loser_slot, created_at, updated_at';

// ============================================================================
// PLAYER DIRECTORY COLUMNS
// ============================================================================
export const PLAYER_DIRECTORY_COLUMNS = 'player_id, full_name, position_code, team_abbrev, jersey_number, headshot_url, eligible_positions';

// ============================================================================
// PLAYER TALENT METRICS COLUMNS
// ============================================================================
export const PLAYER_TALENT_METRICS_COLUMNS = 'player_id, xg_per_60, xg_rating, roster_status, is_ir_eligible';

// ============================================================================
// GOALIE GSAX COLUMNS
// ============================================================================
// Must match the real `goalie_gsax_primary` schema:
//   goalie_id INTEGER PRIMARY KEY, raw_gsax NUMERIC, regressed_gsax NUMERIC, ...
// (see supabase/migrations/20250114000001_create_goalie_gsax_primary_table.sql).
// The prior value `'player_id, gsax'` selected two columns that do not exist,
// which made every goalie player card 500 during the April 10 2026 draft
// disaster (see docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md §2). We select the
// Bayesian-regressed value because that is what the projection system
// consumes; callers that need the raw value should fetch it explicitly.
export const GOALIE_GSAX_COLUMNS = 'goalie_id, regressed_gsax';

// ============================================================================
// TEAM LINEUPS COLUMNS
// ============================================================================
// SCHEMA-TRUTH FIX (2026-08-18, draft-night finding). This list asked for
// `id` and `created_at`, and `team_lineups` has NEITHER — the table is keyed
// by the composite PRIMARY KEY (league_id, team_id), so there is no surrogate
// id by design. PostgREST rejects the whole select with 42703 ("column id
// does not exist"), which means EVERY read through this constant returned a
// 500: GET /api/rosters/league/:leagueId/team/:teamId/lineup (rosters.ts) and
// LineupService.getLineup (server). Observed live during draft night — two
// 500s, one per team, on the Matchup page.
//
// Because the select is static, this failed 100% of the time rather than
// intermittently, so no caller can have been depending on the missing
// fields. Matching the constant to the real schema is the whole fix — no
// migration, no data change.
export const TEAM_LINEUP_COLUMNS = 'team_id, league_id, starters, bench, ir, slot_assignments, updated_at';

// ============================================================================
// MATCHUP SIMULATIONS COLUMNS
// ============================================================================
export const MATCHUP_SIMULATION_COLUMNS = 'id, league_id, week_number, team1_id, team2_id, team1_win_pct, team2_win_pct, simulated_at, matchup_id, num_simulations';

// ============================================================================
// FANTASY WEEKS COLUMNS
// ============================================================================
export const FANTASY_WEEK_COLUMNS = 'id, week_number, start_date, end_date, season, label';

// ============================================================================
// AUDIT LOG COLUMNS
// ============================================================================
export const AUDIT_LOG_COLUMNS = 'id, user_id, event_type, league_id, details, severity, ip_address, user_agent, created_at';

// ============================================================================
// WAIVER PRIORITY COLUMNS
// ============================================================================
export const WAIVER_PRIORITY_COLUMNS = 'id, league_id, team_id, priority, updated_at';

// ============================================================================
// TRANSACTION LEDGER COLUMNS
// ============================================================================
export const TRANSACTION_LEDGER_COLUMNS = 'id, league_id, user_id, team_id, type, player_id, source, created_at';

// ============================================================================
// NOTIFICATION COLUMNS
// ============================================================================
export const NOTIFICATION_COLUMNS = 'id, user_id, type, title, message, read_status, league_id, metadata, created_at';

// ============================================================================
// COUNT-ONLY QUERIES (use with { count: 'exact', head: true })
// ============================================================================
// For count queries, we still need a column selection even though data isn't returned
// Use 'id' as the minimal selection
export const COUNT_ONLY = 'id';

// ============================================================================
// EXPORT GROUPED BY USE CASE
// ============================================================================
export const COLUMNS = {
  // Full column sets
  MATCHUP: MATCHUP_COLUMNS,
  LEAGUE: LEAGUE_COLUMNS,
  TEAM: TEAM_COLUMNS,
  ROSTER_ASSIGNMENT: ROSTER_ASSIGNMENT_COLUMNS,
  DRAFT_PICK: DRAFT_PICK_COLUMNS,
  DRAFT_ORDER: DRAFT_ORDER_COLUMNS,
  NHL_GAME: NHL_GAME_COLUMNS,
  PLAYER_STATS: PLAYER_STATS_DISPLAY,
  WAIVER: WAIVER_CLAIM_COLUMNS,
  WAIVER_BASE: WAIVER_CLAIM_COLUMNS_BASE,
  TRADE: TRADE_OFFER_COLUMNS,
  MATCHUP_LINES: MATCHUP_LINES_COLUMNS,
  PROFILE: PROFILE_COLUMNS,
  PLAYER_PROJECTED_STATS: PLAYER_PROJECTED_STATS_COLUMNS,
  KEEPER_DESIGNATION: KEEPER_DESIGNATION_COLUMNS,
  AUCTION_BUDGET: AUCTION_BUDGET_COLUMNS,
  AUCTION_NOMINATION: AUCTION_NOMINATION_COLUMNS,
  AUCTION_BID: AUCTION_BID_COLUMNS,
  DRAFT_SNAPSHOT: DRAFT_SNAPSHOT_COLUMNS,
  POOL_PICK: POOL_PICK_COLUMNS,
  CONFIDENCE_PICK: CONFIDENCE_PICK_COLUMNS,
  GAME_SPREAD: GAME_SPREAD_COLUMNS,
  PLAYOFF_BRACKET: PLAYOFF_BRACKET_COLUMNS,
  PLAYOFF_SEED: PLAYOFF_SEED_COLUMNS,
  PLAYOFF_SERIES: PLAYOFF_SERIES_COLUMNS,
  PLAYER_DIRECTORY: PLAYER_DIRECTORY_COLUMNS,
  PLAYER_TALENT_METRICS: PLAYER_TALENT_METRICS_COLUMNS,
  GOALIE_GSAX: GOALIE_GSAX_COLUMNS,
  TEAM_LINEUP: TEAM_LINEUP_COLUMNS,
  MATCHUP_SIMULATION: MATCHUP_SIMULATION_COLUMNS,
  FANTASY_WEEK: FANTASY_WEEK_COLUMNS,
  AUDIT_LOG: AUDIT_LOG_COLUMNS,
  WAIVER_PRIORITY: WAIVER_PRIORITY_COLUMNS,
  TRANSACTION_LEDGER: TRANSACTION_LEDGER_COLUMNS,
  NOTIFICATION: NOTIFICATION_COLUMNS,

  // Slim versions
  MATCHUP_SLIM: MATCHUP_COLUMNS_SLIM,
  MATCHUP_LINES_SLIM: MATCHUP_LINES_COLUMNS_SLIM,
  LEAGUE_SLIM: LEAGUE_COLUMNS_SLIM,
  TEAM_SLIM: TEAM_COLUMNS_SLIM,
  ROSTER_ASSIGNMENT_SLIM: ROSTER_ASSIGNMENT_COLUMNS_SLIM,
  DRAFT_PICK_SLIM: DRAFT_PICK_COLUMNS_SLIM,
  NHL_GAME_SLIM: NHL_GAME_COLUMNS_SLIM,
  NHL_GAME_MINIMAL: NHL_GAME_COLUMNS_MINIMAL,

  // For count queries
  COUNT: COUNT_ONLY,
};

export default COLUMNS;
