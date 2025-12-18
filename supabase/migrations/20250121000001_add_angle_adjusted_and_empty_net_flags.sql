-- Add MoneyPuck-aligned features for xG model improvement
-- These features match MoneyPuck's key features for better model alignment

-- Shot angle adjusted (absolute value of angle, MoneyPuck uses this - 8.9% importance)
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS shot_angle_adjusted NUMERIC;

-- Empty net flags (split by team, MoneyPuck uses these - 22.9% importance)
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS home_empty_net BOOLEAN DEFAULT FALSE;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS away_empty_net BOOLEAN DEFAULT FALSE;

-- Team codes (MoneyPuck uses these for context)
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS shooting_team_code VARCHAR(10);
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS defending_team_code VARCHAR(10);

-- Add comments
COMMENT ON COLUMN raw_shots.shot_angle_adjusted IS 'Absolute value of shot angle (MoneyPuck feature: shotAngleAdjusted, 8.9% importance)';
COMMENT ON COLUMN raw_shots.home_empty_net IS 'True if home team has empty net (goalie pulled)';
COMMENT ON COLUMN raw_shots.away_empty_net IS 'True if away team has empty net (goalie pulled)';
COMMENT ON COLUMN raw_shots.shooting_team_code IS 'Team code of shooting team (MoneyPuck feature: shootingTeamCode)';
COMMENT ON COLUMN raw_shots.defending_team_code IS 'Team code of defending team (MoneyPuck feature: defendingTeamCode)';

