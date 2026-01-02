-- Database Usage Audit Query for Citrus Fantasy Sports
-- Copy and paste this into the Supabase SQL Editor to see your database storage usage

SELECT 
    table_name, 
    pg_size_pretty(table_size) AS table_size, 
    pg_size_pretty(indexes_size) AS indexes_size, 
    pg_size_pretty(total_size) AS total_size,
    row_estimate
FROM (
    SELECT 
        table_name, 
        pg_table_size(table_name) AS table_size, 
        pg_indexes_size(table_name) AS indexes_size, 
        pg_total_relation_size(table_name) AS total_size,
        (SELECT reltuples FROM pg_class WHERE relname = table_name) AS row_estimate
    FROM (
        SELECT quote_ident(table_name) AS table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
    ) AS all_tables
) AS pretty_sizes
ORDER BY total_size DESC;

-- Also get total database size:
SELECT pg_size_pretty(pg_database_size(current_database())) AS total_database_size;

