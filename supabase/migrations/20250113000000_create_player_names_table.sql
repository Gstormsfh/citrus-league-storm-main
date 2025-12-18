-- Create player_names table to store player and goalie names from our own data scrapes
-- This replaces dependency on staging files for player names

CREATE TABLE IF NOT EXISTS player_names (
    player_id INTEGER PRIMARY KEY,
    full_name VARCHAR(200) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    position VARCHAR(10), -- C, LW, RW, D, G
    team VARCHAR(10), -- Current team abbreviation
    jersey_number INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    headshot_url TEXT,
    last_updated TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_player_names_full_name ON player_names(full_name);
CREATE INDEX IF NOT EXISTS idx_player_names_team ON player_names(team);
CREATE INDEX IF NOT EXISTS idx_player_names_position ON player_names(position);
CREATE INDEX IF NOT EXISTS idx_player_names_is_active ON player_names(is_active);
CREATE INDEX IF NOT EXISTS idx_player_names_last_updated ON player_names(last_updated);

-- Add comments
COMMENT ON TABLE player_names IS 'Player and goalie names from our own NHL API scrapes. Replaces staging file dependencies.';
COMMENT ON COLUMN player_names.player_id IS 'NHL player ID (primary key)';
COMMENT ON COLUMN player_names.full_name IS 'Full name: "First Last"';
COMMENT ON COLUMN player_names.position IS 'Player position: C, LW, RW, D, G';
COMMENT ON COLUMN player_names.team IS 'Current team abbreviation (e.g., TOR, BOS)';

-- Enable RLS
ALTER TABLE player_names ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public can view player names"
ON player_names
FOR SELECT
USING (true);

-- Authenticated users can manage
CREATE POLICY "Authenticated users can manage player names"
ON player_names
FOR ALL
USING (auth.role() = 'authenticated');

