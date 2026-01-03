# Boxscore Consolidation - Setup & Testing Guide

## ✅ Implementation Complete

The code has been updated to consolidate scraping:
- `ingest_raw_nhl.py` now fetches BOTH PBP and boxscore data
- `scrape_per_game_nhl_stats.py` reads boxscore from stored data (with API fallback)
- All stat extractions preserved (SOG, PPG, PPA, SHG, SHA, etc.)
- Defencemen properly handled via "defense" position group

## Step 1: Apply Database Migration

Run this SQL in your Supabase SQL Editor:

```sql
-- Add boxscore_json column to raw_nhl_data table
ALTER TABLE public.raw_nhl_data
ADD COLUMN IF NOT EXISTS boxscore_json JSONB;

-- Add comment
COMMENT ON COLUMN public.raw_nhl_data.boxscore_json IS 'Full boxscore JSON response from NHL API boxscore endpoint. Contains player stats organized by position groups (forwards, defense, goalies) for proper defencemen handling.';

-- Create index for faster queries on boxscore data
CREATE INDEX IF NOT EXISTS idx_raw_nhl_data_boxscore_json ON public.raw_nhl_data USING gin (boxscore_json);
```

**OR** apply the migration file:
```bash
# The migration file is at:
supabase/migrations/20251231000000_add_boxscore_json_to_raw_nhl_data.sql
```

## Step 2: Test with a Single Game

Test that the new code works:

```bash
# Test ingestion (fetches PBP + boxscore for one game)
python -c "
from ingest_raw_nhl import ingest_single_game
result = ingest_single_game(2025020563)  # Use a recent game ID
print('Success:', result.get('success'))
print('Boxscore:', result.get('boxscore', False))
"
```

## Step 3: Verify Boxscore Storage

Check that boxscore was stored:

```sql
-- In Supabase SQL Editor
SELECT 
    game_id,
    CASE WHEN boxscore_json IS NULL THEN 'Missing' ELSE 'Present' END as boxscore_status,
    jsonb_typeof(boxscore_json) as boxscore_type
FROM raw_nhl_data
WHERE game_id = 2025020563  -- Use your test game ID
LIMIT 1;
```

## Step 4: Test Extraction

Test that `scrape_per_game_nhl_stats.py` can read from stored data:

```bash
# This should now read from stored boxscore instead of fetching from API
python scrape_per_game_nhl_stats.py 2025-12-30 2025-12-30
```

## Step 5: Full Ingestion (Optional)

Once verified, you can re-run ingestion for games that don't have boxscore yet:

```bash
# This will fetch boxscore for any games that don't have it yet
# (it will skip games that already have both PBP and boxscore)
python ingest_raw_nhl.py 2025-10-07 2025-12-30
```

## What Changed

### `ingest_raw_nhl.py`
- ✅ Added `scrape_single_game_boxscore()` function
- ✅ Updated `save_raw_json_to_db()` to store boxscore
- ✅ Updated `ingest_single_game()` to fetch both PBP and boxscore
- ✅ Maintains parallel processing (10 processes)

### `scrape_per_game_nhl_stats.py`
- ✅ Updated `fetch_game_boxscore()` to read from `raw_nhl_data.boxscore_json` first
- ✅ Falls back to API if boxscore not in database
- ✅ All stat extractions preserved (SOG, PPG, PPA, SHG, SHA, etc.)

## Benefits

1. **Consolidated Code**: One scraping path instead of two
2. **Defencemen Fixed**: Boxscore properly structures players in `["forwards", "defense", "goalies"]`
3. **All Stats Preserved**: SOG, PPG, PPA, SHG, SHA, plus all other stats
4. **Performance**: Boxscore stored during initial scrape, reducing API calls
5. **Backward Compatible**: Falls back to API if stored data unavailable

## Verification Checklist

- [ ] Migration applied successfully
- [ ] Test game ingestion stores both PBP and boxscore
- [ ] Boxscore can be retrieved from database
- [ ] `scrape_per_game_nhl_stats.py` reads from stored data
- [ ] Defencemen stats are extracted correctly
- [ ] All stat categories present (SOG, PPG, PPA, SHG, SHA)




