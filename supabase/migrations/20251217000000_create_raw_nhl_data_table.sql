-- Create raw_nhl_data table to store raw JSON play-by-play data from NHL API
-- This table serves as the source of truth for all game data before processing
-- Phase 1: Fast ingestion stores full JSON here
-- Phase 2: Processing reads from here and saves to raw_shots table

CREATE TABLE IF NOT EXISTS raw_nhl_data (
    id BIGSERIAL PRIMARY KEY,
    game_id INTEGER UNIQUE NOT NULL,
    game_date DATE NOT NULL,
    raw_json JSONB NOT NULL,  -- Full play-by-play JSON from NHL API
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE,  -- Track if this game has been processed
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_raw_nhl_data_game_id ON raw_nhl_data(game_id);
CREATE INDEX IF NOT EXISTS idx_raw_nhl_data_game_date ON raw_nhl_data(game_date);
CREATE INDEX IF NOT EXISTS idx_raw_nhl_data_processed ON raw_nhl_data(processed);

-- Add comment to explain the table
COMMENT ON TABLE raw_nhl_data IS 'Raw JSON play-by-play data from NHL API. Phase 1 stores data here, Phase 2 processes it into raw_shots table.';
COMMENT ON COLUMN raw_nhl_data.raw_json IS 'Full play-by-play JSON response from NHL API play-by-play endpoint';
COMMENT ON COLUMN raw_nhl_data.processed IS 'True if this game has been processed and shots saved to raw_shots table';

-- Enable RLS (public read access for raw data)
ALTER TABLE raw_nhl_data ENABLE ROW LEVEL SECURITY;

-- Everyone can read raw NHL data (it's public information)
CREATE POLICY "Public can view raw NHL data"
ON raw_nhl_data
FOR SELECT
USING (true);

-- Only service role can insert/update (via scripts)
-- Regular users cannot modify raw data

