-- Create waiver_claims table for waiver wire system
-- NOTE: player_id and drop_player_id are NHL API player IDs (integers)
-- No foreign key to player_directory because that table uses composite key (season, player_id)
CREATE TABLE IF NOT EXISTS waiver_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id INT NOT NULL,
  drop_player_id INT,
  priority INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'successful', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  failure_reason TEXT,
  CONSTRAINT valid_priority CHECK (priority > 0)
);

-- Add indexes for performance
CREATE INDEX idx_waiver_claims_league ON waiver_claims(league_id);
CREATE INDEX idx_waiver_claims_team ON waiver_claims(team_id);
CREATE INDEX idx_waiver_claims_player ON waiver_claims(player_id);
CREATE INDEX idx_waiver_claims_status ON waiver_claims(status);
CREATE INDEX idx_waiver_claims_created_at ON waiver_claims(created_at);
CREATE INDEX idx_waiver_claims_league_status ON waiver_claims(league_id, status);

-- Enable RLS
ALTER TABLE waiver_claims ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view claims in their leagues
CREATE POLICY "Users can view waiver claims in their leagues"
  ON waiver_claims
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = waiver_claims.league_id
      AND teams.owner_id = auth.uid()
    )
  );

-- RLS Policies: Users can insert claims for their own teams
CREATE POLICY "Users can create waiver claims for their teams"
  ON waiver_claims
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = waiver_claims.team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- RLS Policies: Users can update their own pending claims (for cancellation)
CREATE POLICY "Users can cancel their own pending waiver claims"
  ON waiver_claims
  FOR UPDATE
  USING (
    status = 'pending' AND
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = waiver_claims.team_id
      AND teams.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('pending', 'cancelled') AND
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = waiver_claims.team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- Create waiver_priority table to track team waiver order
CREATE TABLE IF NOT EXISTS waiver_priority (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  priority INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, team_id),
  UNIQUE(league_id, priority)
);

-- Add indexes for waiver_priority
CREATE INDEX idx_waiver_priority_league ON waiver_priority(league_id);
CREATE INDEX idx_waiver_priority_league_priority ON waiver_priority(league_id, priority);

-- Enable RLS for waiver_priority
ALTER TABLE waiver_priority ENABLE ROW LEVEL SECURITY;

-- RLS Policies for waiver_priority: Users can view priorities in their leagues
CREATE POLICY "Users can view waiver priorities in their leagues"
  ON waiver_priority
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = waiver_priority.league_id
      AND teams.owner_id = auth.uid()
    )
  );
