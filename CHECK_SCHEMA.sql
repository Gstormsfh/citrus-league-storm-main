-- Check the actual schema of fantasy_daily_rosters
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'fantasy_daily_rosters'
ORDER BY ordinal_position;
