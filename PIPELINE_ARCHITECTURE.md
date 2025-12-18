# Two-Phase Data Pipeline Architecture

## Overview

The data acquisition pipeline has been refactored into two separate phases for improved performance, fault tolerance, and maintainability.

### Phase 1: Raw Data Ingestion (`ingest_raw_nhl.py`)
Fast, parallel scraping that fetches play-by-play JSON from the NHL API and stores it in `raw_nhl_data` table.

### Phase 2: Data Processing (`process_xg_stats.py`)
Reads raw JSON from `raw_nhl_data`, calculates features, applies ML models (xG/xA), and saves processed shots to `raw_shots` table.

## Architecture Benefits

- **Fault Tolerance**: Processing bugs don't require re-scraping from API
- **Performance**: Higher parallelism during scraping (10-12 processes vs 1 sequential)
- **Data Integrity**: Full JSON preserved as source of truth
- **Resumability**: Can re-run processing on existing raw data
- **Idempotency**: Can safely re-run Phase 1 without duplicates

## Setup

### Step 1: Apply Database Migration

The `raw_nhl_data` table must be created before running Phase 1:

```sql
-- Run migration: supabase/migrations/20251217000000_create_raw_nhl_data_table.sql
```

Or apply via Supabase Dashboard:
1. Go to SQL Editor
2. Copy contents of `supabase/migrations/20251217000000_create_raw_nhl_data_table.sql`
3. Execute

### Step 2: Verify Setup

```bash
py test_two_phase_pipeline.py
```

This will check if the table exists and provide instructions.

## Usage

### Phase 1: Ingest Raw Data

Scrape raw JSON from NHL API:

```bash
# Scrape full season (default: 2025-10-07 to today)
py ingest_raw_nhl.py

# Scrape specific date range
py ingest_raw_nhl.py 2025-10-07 2025-12-16

# Use more parallel processes (faster, but higher rate limit risk)
py ingest_raw_nhl.py --max-processes 12

# Skip checking for already-scraped games (re-scrape all)
py ingest_raw_nhl.py --skip-check
```

**Options:**
- `start_date`: Start date (YYYY-MM-DD), default: 2025-10-07
- `end_date`: End date (YYYY-MM-DD), default: today
- `--max-processes, -p`: Number of parallel processes (default: 10)
- `--skip-check`: Skip checking for already-scraped games

**Performance:**
- ~10 games/second with 10 processes
- Full season (1,312 games): ~2.5 minutes

### Phase 2: Process Data

Process raw JSON and calculate xG/xA:

```bash
# Process all unprocessed games (default batch size: 10)
py process_xg_stats.py

# Process with larger batches (faster, more memory)
py process_xg_stats.py --batch-size 50

# Process a specific game
py process_xg_stats.py --game-id 2025020001
```

**Options:**
- `--batch-size, -b`: Games per batch (default: 10)
- `--game-id`: Process specific game ID

**Performance:**
- ~20 games/second (CPU-bound)
- Full season (1,312 games): ~1.1 minutes

## Workflow Examples

### Full Season Pipeline

```bash
# Step 1: Scrape all games
py ingest_raw_nhl.py 2025-10-07

# Step 2: Process all scraped games
py process_xg_stats.py --batch-size 20
```

### Incremental Updates

```bash
# Scrape new games (only fetches games not already in database)
py ingest_raw_nhl.py 2025-12-16

# Process new games
py process_xg_stats.py
```

### Re-process Existing Data

If you need to re-process games (e.g., after model updates):

```bash
# Mark games as unprocessed (via SQL or Supabase dashboard)
# UPDATE raw_nhl_data SET processed = FALSE WHERE game_id IN (...);

# Re-process
py process_xg_stats.py
```

## Database Schema

### `raw_nhl_data` Table

Stores raw JSON from NHL API:

- `game_id` (INTEGER, UNIQUE): NHL game ID
- `game_date` (DATE): Date of the game
- `raw_json` (JSONB): Full play-by-play JSON from API
- `scraped_at` (TIMESTAMPTZ): When JSON was scraped
- `processed` (BOOLEAN): Whether game has been processed
- `created_at` (TIMESTAMPTZ): Record creation time

### `raw_shots` Table

Stores processed shot data (unchanged from existing schema):

- All shot-level features and calculated metrics
- xG/xA values from ML models
- See existing migration files for full schema

## Error Handling

### Phase 1: Rate Limiting

- Automatic exponential backoff on 429 errors
- Pool-level throttling (all workers pause if one hits rate limit)
- Retries up to 5 times per game
- Failed games are logged but don't stop the pipeline

### Phase 2: Processing Errors

- Individual game failures don't stop batch processing
- Failed games remain `processed=False` for retry
- Clean slate: Deletes existing shots before re-processing

## Monitoring Progress

### Check Ingestion Status

```python
from data_acquisition import supabase

# Count total scraped games
response = supabase.table('raw_nhl_data').select('game_id', count='exact').execute()
print(f"Total games scraped: {response.count}")

# Count unprocessed games
response = supabase.table('raw_nhl_data').select('game_id', count='exact').eq('processed', False).execute()
print(f"Unprocessed games: {response.count}")
```

### Check Processing Status

```python
from data_acquisition import supabase

# Count processed shots
response = supabase.table('raw_shots').select('id', count='exact').execute()
print(f"Total shots processed: {response.count}")
```

## Troubleshooting

### "raw_nhl_data table does not exist"

Apply the migration:
```bash
# Via Supabase Dashboard SQL Editor, run:
# supabase/migrations/20251217000000_create_raw_nhl_data_table.sql
```

### Rate Limiting Issues

If hitting too many 429 errors:
- Reduce `--max-processes` (e.g., `--max-processes 4`)
- Add delays between batches
- Run during off-peak hours

### Processing Errors

If games fail to process:
- Check logs for specific error messages
- Verify models are loaded correctly (`xg_model_moneypuck.joblib`, etc.)
- Re-run processing: `py process_xg_stats.py --game-id <game_id>`

## Migration from Old Pipeline

The old `scrape_pbp_and_process()` function is still available but deprecated. To migrate:

1. **Scrape existing data** (if not already in `raw_nhl_data`):
   ```bash
   py ingest_raw_nhl.py 2025-10-07
   ```

2. **Process scraped data**:
   ```bash
   py process_xg_stats.py
   ```

3. **Verify results** match existing `raw_shots` data

## Performance Comparison

| Metric | Old Pipeline | New Pipeline |
|--------|-------------|--------------|
| Phase 1 Speed | ~1 game/sec | ~10 games/sec |
| Phase 2 Speed | N/A (combined) | ~20 games/sec |
| Full Season Time | 2-4 hours | < 5 minutes |
| Fault Tolerance | Low (re-scrape on error) | High (re-process only) |
| Parallelism | Limited | High (10-12 processes) |

## Next Steps

1. Apply migration to create `raw_nhl_data` table
2. Run Phase 1 to scrape current season data
3. Run Phase 2 to process scraped data
4. Verify results in `raw_shots` table
5. Update any scripts that use old `scrape_pbp_and_process()` function

