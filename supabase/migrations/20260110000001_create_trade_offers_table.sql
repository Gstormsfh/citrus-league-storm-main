-- Create trade_offers table for trade system
CREATE TABLE IF NOT EXISTS trade_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  from_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  to_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  offered_player_ids INT[] NOT NULL,
  requested_player_ids INT[] NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'cancelled', 'expired')),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  counter_offer_id UUID REFERENCES trade_offers(id),
  CONSTRAINT different_teams CHECK (from_team_id != to_team_id),
  CONSTRAINT has_players CHECK (array_length(offered_player_ids, 1) > 0 AND array_length(requested_player_ids, 1) > 0)
);

-- Add indexes for performance
CREATE INDEX idx_trade_offers_league ON trade_offers(league_id);
CREATE INDEX idx_trade_offers_from_team ON trade_offers(from_team_id);
CREATE INDEX idx_trade_offers_to_team ON trade_offers(to_team_id);
CREATE INDEX idx_trade_offers_status ON trade_offers(status);
CREATE INDEX idx_trade_offers_created_at ON trade_offers(created_at);
CREATE INDEX idx_trade_offers_league_status ON trade_offers(league_id, status);

-- Enable RLS
ALTER TABLE trade_offers ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view trade offers involving their teams
CREATE POLICY "Users can view trade offers involving their teams"
  ON trade_offers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE (teams.id = trade_offers.from_team_id OR teams.id = trade_offers.to_team_id)
      AND teams.owner_id = auth.uid()
    )
  );

-- RLS Policies: Users can create trade offers from their teams
CREATE POLICY "Users can create trade offers from their teams"
  ON trade_offers
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = trade_offers.from_team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- RLS Policies: Users can update trade offers sent to their teams
CREATE POLICY "Users can respond to trade offers sent to their teams"
  ON trade_offers
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = trade_offers.to_team_id
      AND teams.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('pending', 'accepted', 'rejected', 'countered') AND
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = trade_offers.to_team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- RLS Policies: Users can cancel their own pending offers
CREATE POLICY "Users can cancel their own pending trade offers"
  ON trade_offers
  FOR UPDATE
  USING (
    status = 'pending' AND
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = trade_offers.from_team_id
      AND teams.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('pending', 'cancelled') AND
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = trade_offers.from_team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- Create trade_history table to track completed trades
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  trade_offer_id UUID NOT NULL REFERENCES trade_offers(id),
  team1_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team2_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team1_players INT[] NOT NULL,
  team2_players INT[] NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for trade_history
CREATE INDEX idx_trade_history_league ON trade_history(league_id);
CREATE INDEX idx_trade_history_team1 ON trade_history(team1_id);
CREATE INDEX idx_trade_history_team2 ON trade_history(team2_id);
CREATE INDEX idx_trade_history_executed_at ON trade_history(executed_at);

-- Enable RLS for trade_history
ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trade_history: Users can view trade history in their leagues
CREATE POLICY "Users can view trade history in their leagues"
  ON trade_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.league_id = trade_history.league_id
      AND teams.owner_id = auth.uid()
    )
  );
