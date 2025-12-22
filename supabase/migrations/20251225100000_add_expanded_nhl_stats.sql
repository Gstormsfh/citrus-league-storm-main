-- ============================================================================
-- EXPANDED NHL STATS FOR COMPREHENSIVE FANTASY SCORING
-- ============================================================================
-- This migration adds granular per-game stats to support diverse league scoring:
-- - Faceoffs (for centers-heavy leagues)
-- - Possession stats (takeaways/giveaways)
-- - Power Play / Shorthanded breakdown (PPG, PPA, SHG, SHA)
-- - Advanced shot metrics (Corsi components)
-- - Game context stats (GWG, shifts)
-- - Goalie advanced metrics (save %, situation-specific)
--
-- These columns provide the "DNA" for league-weighted scoring and future
-- advanced projections (e.g., possession-based models).
-- ============================================================================

-- ===================
-- FACEOFF STATS
-- ===================
-- Essential for leagues that value center play and puck possession
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_faceoff_wins integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_faceoff_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_faceoff_taken integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_faceoff_wins IS 'Official NHL faceoffs won for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_faceoff_losses IS 'Official NHL faceoffs lost for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_faceoff_taken IS 'Total faceoffs taken (wins + losses) for verification.';

-- ===================
-- POSSESSION STATS
-- ===================
-- Key indicators of puck control - valuable for analytics leagues
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_takeaways integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_giveaways integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_takeaways IS 'Official NHL takeaways for this game. Positive possession indicator.';
COMMENT ON COLUMN public.player_game_stats.nhl_giveaways IS 'Official NHL giveaways for this game. Used for possession ratios.';

-- ===================
-- POWER PLAY BREAKDOWN
-- ===================
-- Splitting PPP into goals/assists for "Banger Leagues" that weight differently
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_ppg integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ppa integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_ppg IS 'Official NHL power play goals for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_ppa IS 'Official NHL power play assists for this game.';

-- ===================
-- SHORTHANDED BREAKDOWN
-- ===================
-- Separate SH goals/assists for specialty scoring
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_shg integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_sha integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_shg IS 'Official NHL shorthanded goals for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_sha IS 'Official NHL shorthanded assists for this game.';

-- ===================
-- ADVANCED SHOT METRICS (CORSI COMPONENTS)
-- ===================
-- Corsi = SOG + Missed + Blocked (all shot attempts)
-- Fenwick = SOG + Missed (unblocked shot attempts)
-- Storing components allows manual calculation if API is inconsistent
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_shots_missed integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_blocked integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shot_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_shots_missed IS 'Shots that missed the net. Fenwick = SOG + Missed.';
COMMENT ON COLUMN public.player_game_stats.nhl_shots_blocked IS 'Player shots that were blocked by opponent. Corsi = SOG + Missed + Blocked.';
COMMENT ON COLUMN public.player_game_stats.nhl_shot_attempts IS 'Total shot attempts (Corsi). API may provide directly or calculate.';

-- ===================
-- GAME CONTEXT STATS
-- ===================
-- GWG highly valued in many leagues; shifts useful for ice time context
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_gwg integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shifts integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_otg integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_gwg IS 'Game-winning goals for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_shifts IS 'Number of shifts taken in this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_otg IS 'Overtime goals for this game.';

-- ===================
-- GOALIE ADVANCED METRICS
-- ===================
-- Save percentage with proper precision, situation-specific saves
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_save_pct numeric(5,3) NOT NULL DEFAULT 0.000,
ADD COLUMN IF NOT EXISTS nhl_even_saves integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_even_shots_against integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_pp_saves integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_pp_shots_against integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_sh_saves integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_sh_shots_against integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.player_game_stats.nhl_save_pct IS 'Save percentage for this game. Calculated: saves/shots_faced (0.000 if no shots).';
COMMENT ON COLUMN public.player_game_stats.nhl_even_saves IS 'Even-strength saves for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_even_shots_against IS 'Even-strength shots against for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_pp_saves IS 'Saves on power play (opponent PP) for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_pp_shots_against IS 'Shots against on opponent power play.';
COMMENT ON COLUMN public.player_game_stats.nhl_sh_saves IS 'Saves while shorthanded (own PP) for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_sh_shots_against IS 'Shots against while own team on power play.';

-- ===================
-- PERFORMANCE INDEXES
-- ===================
-- Index for efficient querying when calculating daily/weekly stats
CREATE INDEX IF NOT EXISTS idx_player_game_stats_nhl_expanded 
ON public.player_game_stats (game_id, player_id, is_goalie);

-- Composite index for fantasy scoring queries
CREATE INDEX IF NOT EXISTS idx_player_game_stats_fantasy_scoring
ON public.player_game_stats (season, game_id) 
INCLUDE (player_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppg, nhl_ppa, nhl_shg, nhl_sha);

-- ===================
-- TABLE COMMENT
-- ===================
COMMENT ON TABLE public.player_game_stats IS 'Per-game player statistics. NHL official stats (nhl_* columns) are the source of truth for fantasy scoring. Expanded Dec 2025 to support comprehensive league scoring categories including faceoffs, possession, PP/SH breakdown, Corsi components, and goalie advanced metrics.';
