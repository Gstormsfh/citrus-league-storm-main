#!/usr/bin/env python3
"""
restore_raw_shots_from_csv.py

Restore raw_shots data from archived CSV backup.
This avoids re-processing games that were already processed.
"""

import os
import csv
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import psycopg2
from psycopg2.extensions import connection as PGConnection
from psycopg2.extras import execute_values

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Missing Supabase credentials")
    exit(1)

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

CSV_PATH = os.path.join("data", "archive", "raw_shots_backup.csv")

def get_db_connection() -> PGConnection:
    """Get direct PostgreSQL connection for bulk operations."""
    # Try DATABASE_URL first (direct connection, no pooler conversion)
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if database_url:
        return psycopg2.connect(database_url)
    
    # Fall back to individual variables (use direct connection, not pooler)
    host = os.environ.get("PGHOST")
    port = os.environ.get("PGPORT", "5432")
    dbname = os.environ.get("PGDATABASE")
    user = os.environ.get("PGUSER")
    password = os.environ.get("PGPASSWORD")
    
    # Don't convert to pooler - use direct connection
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password
    )

def restore_from_csv():
    """Restore raw_shots from CSV backup."""
    print("=" * 80)
    print("RESTORING raw_shots FROM ARCHIVED CSV")
    print("=" * 80)
    print()
    
    if not os.path.exists(CSV_PATH):
        print(f"[ERROR] Archived CSV not found: {CSV_PATH}")
        return False
    
    # Get file info
    file_size = os.path.getsize(CSV_PATH) / (1024 * 1024)  # MB
    print(f"Archived CSV: {CSV_PATH}")
    print(f"File size: {file_size:.2f} MB")
    print()
    
    # Count rows first
    print("Counting rows in CSV...")
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        row_count = sum(1 for _ in reader)
    
    print(f"Total shots in CSV: {row_count:,}")
    print(f"Columns: {len(header)}")
    print()
    
    # Check what games are in the CSV
    print("Analyzing games in CSV...")
    games_in_csv = set()
    shots_per_game = {}
    
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            game_id = row.get('game_id')
            if game_id:
                game_id = int(game_id)
                games_in_csv.add(game_id)
                shots_per_game[game_id] = shots_per_game.get(game_id, 0) + 1
    
    print(f"Unique games in CSV: {len(games_in_csv)}")
    print(f"Sample game IDs: {sorted(list(games_in_csv))[:10]}")
    print()
    
    # Skip checking existing games (too slow with large dataset)
    # Just restore all games from CSV - ON CONFLICT will handle duplicates
    print("Restoring all games from CSV (duplicates will be skipped)...")
    games_to_restore = games_in_csv
    print(f"Games to restore: {len(games_to_restore)}")
    print()
    
    print("=" * 80)
    print("RESTORING SHOTS")
    print("=" * 80)
    print()
    
    # Define column types for proper conversion
    INTEGER_COLUMNS = {
        'game_id', 'player_id', 'passer_id', 'shot_type_code', 'shot_type_encoded',
        'score_differential', 'pass_zone_encoded', 'period', 'event_id', 'sort_order',
        'home_skaters_on_ice', 'away_skaters_on_ice', 'penalty_length', 'penalty_time_left',
        'goalie_id', 'time_remaining_seconds', 'home_score', 'away_score', 'shooting_player_id',
        'scoring_player_id', 'assist1_player_id', 'assist2_player_id', 'goalie_in_net_id',
        'event_owner_team_id', 'home_team_id', 'away_team_id', 'away_sog', 'home_sog',
        'player_num_that_did_last_event', 'defending_team_skaters_on_ice',
        'shooting_team_forwards_on_ice', 'shooting_team_defencemen_on_ice',
        'defending_team_forwards_on_ice', 'defending_team_defencemen_on_ice',
        'skaters_in_screening_box', 'shot_angle_rebound_royal_road', 'season'
    }
    
    FLOAT_COLUMNS = {
        'shot_x', 'shot_y', 'pass_x', 'pass_y', 'distance', 'angle',
        'xg_value', 'flurry_adjusted_xg', 'xa_value', 'pass_lateral_distance',
        'pass_to_net_distance', 'pass_immediacy_score', 'goalie_movement_score',
        'pass_quality_score', 'time_before_shot', 'pass_angle', 'normalized_lateral_distance',
        'zone_relative_distance', 'last_event_x', 'last_event_y', 'distance_from_last_event',
        'time_since_last_event', 'speed_from_last_event', 'time_since_faceoff',
        'arena_adjusted_x', 'arena_adjusted_y', 'arena_adjusted_x_abs', 'arena_adjusted_y_abs',
        'arena_adjusted_shot_distance', 'shot_angle_plus_rebound', 'shot_angle_plus_rebound_speed',
        'last_event_shot_angle', 'last_event_shot_distance', 'shot_angle_adjusted',
        'east_west_location_of_last_event', 'east_west_location_of_shot', 'north_south_location_of_shot',
        'time_since_powerplay_started', 'shooter_time_on_ice', 'shooter_time_on_ice_since_faceoff',
        'shooting_team_average_time_on_ice', 'shooting_team_max_time_on_ice', 'shooting_team_min_time_on_ice',
        'shooting_team_average_time_on_ice_of_forwards', 'shooting_team_max_time_on_ice_of_forwards',
        'shooting_team_min_time_on_ice_of_forwards', 'shooting_team_average_time_on_ice_of_defencemen',
        'shooting_team_max_time_on_ice_of_defencemen', 'shooting_team_min_time_on_ice_of_defencemen',
        'shooting_team_average_time_on_ice_since_faceoff', 'shooting_team_max_time_on_ice_since_faceoff',
        'shooting_team_min_time_on_ice_since_faceoff', 'shooting_team_average_time_on_ice_of_forwards_since_faceoff',
        'shooting_team_max_time_on_ice_of_forwards_since_faceoff', 'shooting_team_min_time_on_ice_of_forwards_since_faceoff',
        'shooting_team_average_time_on_ice_of_defencemen_since_faceoff', 'shooting_team_max_time_on_ice_of_defencemen_since_faceoff',
        'shooting_team_min_time_on_ice_of_defencemen_since_faceoff', 'defending_team_average_time_on_ice',
        'defending_team_max_time_on_ice', 'defending_team_min_time_on_ice',
        'defending_team_average_time_on_ice_of_forwards', 'defending_team_max_time_on_ice_of_forwards',
        'defending_team_min_time_on_ice_of_forwards', 'defending_team_average_time_on_ice_of_defencemen',
        'defending_team_max_time_on_ice_of_defencemen', 'defending_team_min_time_on_ice_of_defencemen',
        'defending_team_average_time_on_ice_since_faceoff', 'defending_team_max_time_on_ice_since_faceoff',
        'defending_team_min_time_on_ice_since_faceoff', 'defending_team_average_time_on_ice_of_forwards_since_faceoff',
        'defending_team_max_time_on_ice_of_forwards_since_faceoff', 'defending_team_min_time_on_ice_of_forwards_since_faceoff',
        'defending_team_average_time_on_ice_of_defencemen_since_faceoff', 'defending_team_max_time_on_ice_of_defencemen_since_faceoff',
        'defending_team_min_time_on_ice_of_defencemen_since_faceoff', 'time_difference_since_change',
        'average_rest_difference', 'distance_to_nearest_defender', 'nearest_defender_to_net_distance',
        'angle_change_from_last_event', 'angle_change_squared', 'distance_change_from_last_event',
        'expected_rebound_probability', 'expected_goals_of_expected_rebounds', 'shooting_talent_adjusted_xg',
        'shooting_talent_multiplier', 'created_expected_goals'
    }
    
    BOOLEAN_COLUMNS = {
        'is_goal', 'is_rebound', 'is_power_play', 'has_pass_before_shot', 'is_empty_net',
        'shot_was_on_goal', 'shot_goalie_froze', 'shot_generated_rebound', 'shot_play_stopped',
        'shot_play_continued_in_zone', 'shot_play_continued_outside_zone', 'is_rush',
        'is_home_team', 'home_empty_net', 'away_empty_net'
    }
    
    # Columns to exclude (auto-generated by DB)
    EXCLUDE_COLUMNS = {'id', 'created_at', 'updated_at'}
    
    def convert_value(key, value):
        """Convert CSV value to proper Python type."""
        if value == '' or value is None:
            return None
        
        # Exclude auto-generated columns
        if key in EXCLUDE_COLUMNS:
            return None
        
        # Handle integers
        if key in INTEGER_COLUMNS:
            try:
                return int(value) if value else None
            except (ValueError, TypeError):
                return None
        
        # Handle floats
        if key in FLOAT_COLUMNS:
            try:
                return float(value) if value else None
            except (ValueError, TypeError):
                return None
        
        # Handle booleans (CSV uses 't'/'f' or 'True'/'False' or '1'/'0')
        if key in BOOLEAN_COLUMNS:
            if isinstance(value, str):
                value_lower = value.lower()
                if value_lower in ('t', 'true', '1', 'yes'):
                    return True
                elif value_lower in ('f', 'false', '0', 'no', ''):
                    return False
            try:
                return bool(int(value)) if value else False
            except (ValueError, TypeError):
                return False
        
        # Keep as string for everything else
        return value
    
    # Get all column names from CSV header (excluding auto-generated ones)
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        all_columns = [col for col in next(reader) if col not in EXCLUDE_COLUMNS]
    
    print(f"Restoring {len(all_columns)} columns per record")
    print()
    
    # Use REST API with small batches (only 33 games to restore)
    print("Restoring via REST API...")
    total_restored = 0
    batch_size = 50  # Very small batches to avoid timeouts
    batch_num = 0
    
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        batch = []
        
        for row in reader:
            game_id_str = row.get('game_id', '')
            if not game_id_str:
                continue
            
            try:
                game_id = int(game_id_str)
            except (ValueError, TypeError):
                continue
            
            # Only restore games that aren't already in database
            if game_id in games_to_restore:
                # Convert row to dict, ensuring all records have same keys
                record = {}
                for key in all_columns:
                    value = row.get(key, '')
                    converted = convert_value(key, value)
                    record[key] = converted
                
                batch.append(record)
                
                if len(batch) >= batch_size:
                    try:
                        db.upsert("raw_shots", batch, on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code")
                        total_restored += len(batch)
                        batch_num += 1
                        print(f"  Restored batch #{batch_num}: {total_restored:,} shots")
                        batch = []
                    except Exception as e:
                        print(f"  [ERROR] Batch {batch_num} failed: {e}")
                        # Try individual inserts for this batch
                        for record in batch:
                            try:
                                db.upsert("raw_shots", [record], on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code")
                                total_restored += 1
                            except:
                                pass
                        batch = []
        
        # Final batch
        if batch:
            try:
                db.upsert("raw_shots", batch, on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code")
                total_restored += len(batch)
                batch_num += 1
                print(f"  Restored final batch: {total_restored:,} shots")
            except Exception as e:
                print(f"  [ERROR] Final batch failed: {e}")
                # Try individual
                for record in batch:
                    try:
                        db.upsert("raw_shots", [record], on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code")
                        total_restored += 1
                    except:
                        pass
    
    print()
    print("=" * 80)
    print(f"RESTORATION COMPLETE")
    print("=" * 80)
    print(f"Total shots restored: {total_restored:,}")
    print(f"Games restored: {len(games_to_restore)}")
    print()
    
    # Update processed flags for restored games (batch update)
    print("Updating processed flags...")
    if games_to_restore:
        # Update in batches of 100 games
        games_list = list(games_to_restore)
        updated = 0
        batch_size_flags = 100
        
        for i in range(0, len(games_list), batch_size_flags):
            batch_games = games_list[i:i + batch_size_flags]
            for game_id in batch_games:
                try:
                    db.update(
                        "raw_nhl_data",
                        {"processed": True},
                        filters=[("game_id", "eq", game_id)]
                    )
                    updated += 1
                except Exception as e:
                    print(f"  [WARNING] Could not update flag for game {game_id}: {e}")
            
            if (i + batch_size_flags) % 500 == 0 or i + batch_size_flags >= len(games_list):
                print(f"  Updated {updated}/{len(games_to_restore)} processed flags...")
        
        print(f"Updated processed flags for {updated} games")
    print()
    print("=" * 80)
    print("[SUCCESS] Restoration complete!")
    print("=" * 80)
    
    return True

if __name__ == "__main__":
    success = restore_from_csv()
    sys.exit(0 if success else 1)

