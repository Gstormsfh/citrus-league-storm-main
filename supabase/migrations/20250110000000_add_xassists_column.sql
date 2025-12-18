-- Add I_F_xAssists column to raw_player_stats table
-- This column stores Expected Assists (xA) values for players

ALTER TABLE raw_player_stats 
ADD COLUMN IF NOT EXISTS I_F_xAssists NUMERIC DEFAULT 0;

-- Add comment to explain the column
COMMENT ON COLUMN raw_player_stats.I_F_xAssists IS 'Individual For Expected Assists - Sum of xA values for passes made by this player that led to shots';

