# Migration Instructions: Enhanced Features for raw_shots Table

## Overview
This migration adds ~60 new columns to the `raw_shots` table to maximize data extraction and match MoneyPuck's feature richness.

## What's Added

### Enhanced Features (~30 columns)
- Situation features: `home_skaters_on_ice`, `away_skaters_on_ice`, `is_empty_net`, `penalty_length`, `penalty_time_left`
- Last event features: `last_event_category`, `last_event_x`, `last_event_y`, `last_event_team`, `distance_from_last_event`, `time_since_last_event`, `speed_from_last_event`, `last_event_shot_angle`, `last_event_shot_distance`, `player_num_that_did_last_event`
- Goalie features: `goalie_id`, `goalie_name`
- Period/time features: `period`, `time_in_period`, `time_remaining_seconds`, `time_since_faceoff`
- Team context: `team_code`, `is_home_team`, `zone`, `home_score`, `away_score`
- Shot outcomes: `shot_was_on_goal`, `shot_goalie_froze`, `shot_generated_rebound`, `shot_play_stopped`, `shot_play_continued_in_zone`, `shot_play_continued_outside_zone`
- Rush detection: `is_rush`

### Raw Data Fields (~20 columns)
- Play identification: `event_id`, `sort_order`, `type_desc`
- Period/time: `period_type`, `time_remaining`
- Situation: `situation_code`, `home_team_defending_side`
- Coordinates: `zone_code`
- Player IDs: `shooting_player_id`, `scoring_player_id`, `assist1_player_id`, `assist2_player_id`
- Goalie: `goalie_in_net_id`
- Team context: `event_owner_team_id`, `home_team_id`, `away_team_id`, `home_team_abbrev`, `away_team_abbrev`, `away_sog`, `home_sog`
- Shot details: `shot_type_raw`, `miss_reason`

### Calculated Features (~10 columns)
- Arena adjustments: `arena_adjusted_x`, `arena_adjusted_y`, `arena_adjusted_x_abs`, `arena_adjusted_y_abs`, `arena_adjusted_shot_distance`
- Shot angle metrics: `shot_angle_plus_rebound`, `shot_angle_plus_rebound_speed`

## Step 1: Apply the Migration

### Via Supabase Dashboard (Recommended)

1. **Navigate to Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and Paste Migration SQL**
   - Open the file: `supabase/migrations/20250121000000_add_enhanced_features_to_raw_shots.sql`
   - Copy the entire contents
   - Paste into the SQL Editor

4. **Run the Migration**
   - Click "Run" or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
   - You should see a success message

5. **Verify the Columns**
   - Go to "Table Editor" in the left sidebar
   - Select the `raw_shots` table
   - You should see all the new columns in the list

## Step 2: Verify Extraction

After applying the migration, test the extraction:

```bash
python -c "from data_acquisition import scrape_pbp_and_process; scrape_pbp_and_process('2025-10-07')"
```

This should:
- Extract shots with all new features
- Save successfully to the database
- Export to `data/our_shots_2025.csv`

## Troubleshooting

### Error: "Could not find column in schema cache"
- This means the migration hasn't been applied yet
- Apply the migration using the steps above

### Error: "Column already exists"
- Some columns might already exist from previous migrations
- The migration uses `ADD COLUMN IF NOT EXISTS`, so this is safe to ignore

### Performance
- The migration creates indexes on commonly queried fields
- This should improve query performance for filtered searches

## Next Steps

After migration:
1. ✅ Test extraction on sample date
2. ✅ Verify all features populate correctly
3. ✅ Retrain xG model with MoneyPuck targets
4. ✅ Compare feature coverage with MoneyPuck
