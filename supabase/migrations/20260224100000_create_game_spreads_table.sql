-- ============================================================================
-- GAME SPREADS TABLE — Stores NHL puck line / spread data from The Odds API
-- ============================================================================
-- Used by Pick'em ATS (Against the Spread) mode.
-- Populated daily by the fetch-spreads Edge Function.
--
-- The Odds API free tier: 500 requests/month
-- NHL has ~15 games/day max, 1-2 API calls fetch all spreads for a day.
-- Typical usage: ~60-90 requests/month (well within free tier).
-- ============================================================================

CREATE TABLE IF NOT EXISTS game_spreads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Game identification
    game_id TEXT NOT NULL,                    -- nhl_games.id or external ref
    game_date DATE NOT NULL,                  -- game date for easy filtering
    external_id TEXT,                         -- The Odds API event ID

    -- Teams
    home_team TEXT NOT NULL,                  -- team abbreviation (e.g. 'TOR')
    away_team TEXT NOT NULL,

    -- Spread data (puck line)
    home_spread NUMERIC NOT NULL DEFAULT -1.5,  -- NHL standard puck line
    away_spread NUMERIC NOT NULL DEFAULT 1.5,

    -- Moneyline odds (for reference/future use)
    home_moneyline INTEGER,                   -- e.g. -150
    away_moneyline INTEGER,                   -- e.g. +130

    -- Over/under (for reference/future use)
    over_under NUMERIC,                       -- e.g. 6.5

    -- Source metadata
    source TEXT NOT NULL DEFAULT 'the-odds-api',
    bookmaker TEXT DEFAULT 'consensus',       -- which bookmaker (or consensus)
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Versioning: allows multiple fetches per game (latest wins)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One spread entry per game per bookmaker
    UNIQUE (game_id, bookmaker)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_game_spreads_date
    ON game_spreads (game_date);
CREATE INDEX IF NOT EXISTS idx_game_spreads_game
    ON game_spreads (game_id);
CREATE INDEX IF NOT EXISTS idx_game_spreads_teams
    ON game_spreads (home_team, away_team, game_date);

-- RLS: spreads are public read (no sensitive data)
ALTER TABLE game_spreads ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read spreads
CREATE POLICY "game_spreads_select" ON game_spreads FOR SELECT
    USING (true);

-- Only service_role can insert/update (Edge Function uses service key)
-- No INSERT/UPDATE policies for authenticated = only service_role can write

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  GAME SPREADS TABLE — CREATED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  Columns: game_id, game_date, home/away_team, home/away_spread,';
  RAISE NOTICE '           home/away_moneyline, over_under, source, bookmaker';
  RAISE NOTICE '  Unique on: (game_id, bookmaker)';
  RAISE NOTICE '  RLS: public read, service_role write only';
  RAISE NOTICE '  Source: The Odds API (icehockey_nhl endpoint)';
  RAISE NOTICE '============================================================';
END $$;
