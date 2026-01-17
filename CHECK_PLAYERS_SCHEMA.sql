SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'players' AND column_name IN ('id', 'player_id', 'nhl_id') ORDER BY column_name;
