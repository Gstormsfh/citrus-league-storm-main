#!/usr/bin/env python3
"""
process_xg_stats.py
Phase 2: Process raw JSON data and calculate xG/xA stats.

This script reads raw JSON from raw_nhl_data table, processes it through
feature engineering and ML models, then saves processed shots to raw_shots table.
"""

import sys
import datetime
import pandas as pd
import numpy as np
import argparse
import time
from dotenv import load_dotenv
import os

# Set UTF-8 encoding for stdout
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Import processing functions from data_acquisition
from data_acquisition import (
    _extract_shots_from_game,
    _save_shots_to_database,
    get_fresh_supabase_client,
    XG_MODEL,
    MODEL_FEATURES,
    USE_MONEYPUCK_MODEL,
    XA_MODEL,
    XA_MODEL_FEATURES,
    LAST_EVENT_CATEGORY_ENCODER
)

# Load Supabase client
load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
from supabase import create_client, Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Constants
DEFAULT_BATCH_SIZE = 10


def get_unprocessed_games_batch(limit=10, offset=0):
    """
    Get a batch of unprocessed games from raw_nhl_data table.
    Memory-efficient: fetches small batches instead of loading all games.
    
    Args:
        limit: Number of games to fetch
        offset: Offset for pagination
    
    Returns:
        list: List of dicts with 'game_id' and 'raw_json'
    """
    try:
        response = supabase.table('raw_nhl_data')\
            .select('game_id, raw_json')\
            .eq('processed', False)\
            .order('game_id')\
            .range(offset, offset + limit - 1)\
            .execute()
        
        return response.data if response.data else []
    except Exception as e:
        print(f"Error fetching unprocessed games: {e}")
        return []


def count_unprocessed_games():
    """Count total number of unprocessed games."""
    try:
        response = supabase.table('raw_nhl_data')\
            .select('game_id', count='exact')\
            .eq('processed', False)\
            .execute()
        
        return response.count if hasattr(response, 'count') else 0
    except Exception as e:
        print(f"Error counting unprocessed games: {e}")
        return 0


def process_single_game_json(raw_json, game_id):
    """
    Process a single game's JSON data: extract shots, calculate features, apply models.
    
    Args:
        raw_json: Raw JSON from raw_nhl_data table
        game_id: NHL game ID
    
    Returns:
        pd.DataFrame: Processed shots DataFrame or None if failed
    """
    db_client = get_fresh_supabase_client()
    
    try:
        # 1. Extract shots from JSON first (before deleting anything)
        print(f"  Game {game_id}: Extracting shots...")
        all_shot_data = _extract_shots_from_game(raw_json, game_id, db_client)
        
        if not all_shot_data:
            print(f"  Game {game_id}: No shots found - skipping")
            return None
        
        # 2. Only delete existing shots AFTER we know we have new shots to save
        print(f"  Game {game_id}: Deleting existing shots (clean slate)...")
        try:
            db_client.table('raw_shots').delete().eq('game_id', game_id).execute()
        except Exception as e:
            # Ignore if no shots exist
            pass
        
        # 3. Convert to DataFrame
        df_shots = pd.DataFrame(all_shot_data)
        
        if df_shots.empty:
            print(f"  Game {game_id}: Empty DataFrame after extraction - skipping")
            return None
        
        # 4. Apply calculated features
        try:
            from feature_calculations import apply_calculated_features_to_dataframe
            df_shots = apply_calculated_features_to_dataframe(df_shots)
        except ImportError:
            pass  # Skip if not available
        except Exception as e:
            print(f"  Game {game_id}: Warning - error applying calculated features: {e}")
        
        # 5. Prepare features for xG prediction
        if USE_MONEYPUCK_MODEL and 'last_event_category_encoded' in MODEL_FEATURES:
            if 'last_event_category' in df_shots.columns and 'last_event_category_encoded' not in df_shots.columns:
                from sklearn.preprocessing import LabelEncoder
                if LAST_EVENT_CATEGORY_ENCODER is not None:
                    df_shots['last_event_category_encoded'] = LAST_EVENT_CATEGORY_ENCODER.transform(
                        df_shots['last_event_category'].fillna('unknown').astype(str)
                    )
                else:
                    le = LabelEncoder()
                    df_shots['last_event_category_encoded'] = le.fit_transform(
                        df_shots['last_event_category'].fillna('unknown').astype(str)
                    )
        
        # Calculate derived features
        if 'distance' in df_shots.columns and 'angle' in df_shots.columns:
            df_shots['distance_angle_interaction'] = (df_shots['distance'] * df_shots['angle']) / 100
        
        if 'speed_from_last_event' in df_shots.columns:
            speed_series = pd.to_numeric(df_shots['speed_from_last_event'], errors='coerce').fillna(0)
            df_shots['speed_from_last_event_log'] = np.log1p(speed_series)
        
        # Ensure all required features exist
        for feature in MODEL_FEATURES:
            if feature not in df_shots.columns:
                if feature in ['home_empty_net', 'away_empty_net', 'is_empty_net', 
                              'has_pass_before_shot', 'is_rebound', 'is_slot_shot', 'is_power_play']:
                    df_shots[feature] = 0
                elif feature == 'shot_angle_adjusted':
                    df_shots[feature] = df_shots['angle'].abs() if 'angle' in df_shots.columns else 0
                elif feature == 'last_event_category_encoded':
                    df_shots[feature] = 0
                elif feature == 'distance_angle_interaction':
                    if 'distance' in df_shots.columns and 'angle' in df_shots.columns:
                        df_shots[feature] = (df_shots['distance'] * df_shots['angle']) / 100
                    else:
                        df_shots[feature] = 0
                elif feature == 'speed_from_last_event_log':
                    if 'speed_from_last_event' in df_shots.columns:
                        df_shots[feature] = np.log1p(df_shots['speed_from_last_event'].fillna(0))
                    else:
                        df_shots[feature] = 0
                else:
                    df_shots[feature] = 0
        
        # Select features and predict xG
        X_predict = df_shots[MODEL_FEATURES].copy()
        
        # Fill missing values
        for feature in MODEL_FEATURES:
            if feature in X_predict.columns and X_predict[feature].isna().any():
                if feature in ['pass_lateral_distance', 'pass_to_net_distance', 'pass_immediacy_score', 
                              'goalie_movement_score', 'pass_quality_score', 'pass_zone_encoded',
                              'has_pass_before_shot', 'is_rebound', 'is_slot_shot', 'is_power_play',
                              'is_empty_net', 'home_empty_net', 'away_empty_net']:
                    X_predict[feature] = pd.to_numeric(X_predict[feature], errors='coerce').fillna(0)
                elif feature in ['time_since_last_event', 'distance_from_last_event', 'speed_from_last_event',
                                'last_event_shot_angle', 'last_event_shot_distance', 'last_event_category_encoded']:
                    non_zero_values = X_predict[feature][X_predict[feature] > 0]
                    if len(non_zero_values) > 0:
                        fill_value = non_zero_values.median()
                        X_predict[feature] = pd.to_numeric(X_predict[feature], errors='coerce').fillna(fill_value)
                    else:
                        X_predict[feature] = pd.to_numeric(X_predict[feature], errors='coerce').fillna(0)
                elif feature == 'shot_angle_adjusted':
                    if 'angle' in df_shots.columns:
                        X_predict[feature] = pd.to_numeric(X_predict[feature], errors='coerce').fillna(df_shots['angle'].abs())
                    else:
                        X_predict[feature] = pd.to_numeric(X_predict[feature], errors='coerce').fillna(0)
                else:
                    median_val = pd.to_numeric(X_predict[feature], errors='coerce').median()
                    X_predict[feature] = pd.to_numeric(X_predict[feature], errors='coerce').fillna(median_val)
        
        # 6. Predict xG
        if USE_MONEYPUCK_MODEL:
            df_shots['xG_Value'] = XG_MODEL.predict(X_predict)
            df_shots['xG_Value'] = df_shots['xG_Value'].clip(lower=0.0, upper=0.6)
        else:
            raw_xg = XG_MODEL.predict_proba(X_predict)[:, 1]
            CALIBRATION_FACTOR = 3.5
            df_shots['xG_Value'] = np.power(raw_xg, CALIBRATION_FACTOR)
            df_shots['xG_Value'] = df_shots['xG_Value'].clip(upper=0.50)
            SCALE_FACTOR = 0.19
            df_shots['xG_Value'] = df_shots['xG_Value'] * SCALE_FACTOR
        
        # 7. Predict xA (if model available)
        df_shots['xA_Value'] = 0.0
        if XA_MODEL and XA_MODEL_FEATURES:
            passes_mask = df_shots['has_pass_before_shot'] == 1
            df_passes = df_shots[passes_mask].copy()
            if len(df_passes) > 0:
                X_xa_predict = df_passes[XA_MODEL_FEATURES]
                raw_xa = XA_MODEL.predict_proba(X_xa_predict)[:, 1]
                CALIBRATION_FACTOR_XA = 3.5
                df_passes['xA_Value'] = np.power(raw_xa, CALIBRATION_FACTOR_XA)
                df_passes['xA_Value'] = df_passes['xA_Value'].clip(upper=0.50)
                SCALE_FACTOR_XA = 0.15
                df_passes['xA_Value'] = df_passes['xA_Value'] * SCALE_FACTOR_XA
                df_shots.loc[passes_mask, 'xA_Value'] = df_passes['xA_Value'].values
        
        # 8. Apply flurry adjustment
        try:
            from feature_calculations import calculate_flurry_adjusted_xg
            df_shots = calculate_flurry_adjusted_xg(
                df_shots, xg_column='xG_Value', game_id_col='game_id',
                team_code_col='team_code', period_col='period',
                time_in_period_col='time_in_period', time_since_last_event_col='time_since_last_event'
            )
        except:
            df_shots['flurry_adjusted_xg'] = df_shots['xG_Value']
        
        # 9. Save to database
        print(f"  Game {game_id}: Saving {len(df_shots)} shots...")
        try:
            _save_shots_to_database(df_shots, db_client, game_id)
            
            # VERIFY: Check that shots were actually saved
            verify_response = db_client.table('raw_shots').select('id').eq('game_id', game_id).execute()
            shots_saved = len(verify_response.data) if verify_response.data else 0
            
            if shots_saved == 0:
                raise Exception(f"Verification failed: No shots found in database after save (expected {len(df_shots)})")
            
            if shots_saved < len(df_shots) * 0.9:  # Allow 10% tolerance for duplicates/constraints
                print(f"  Game {game_id}: WARNING - Only {shots_saved}/{len(df_shots)} shots saved")
            
        except Exception as e:
            print(f"  Game {game_id}: ERROR - Failed to save shots: {e}")
            import traceback
            traceback.print_exc()
            # Don't mark as processed if save failed
            return None
        
        # 10. Mark as processed ONLY after successful save AND verification
        try:
            supabase.table('raw_nhl_data')\
                .update({'processed': True})\
                .eq('game_id', game_id)\
                .execute()
        except Exception as e:
            print(f"  Game {game_id}: Warning - failed to mark as processed: {e}")
            # Shots are saved, but flag update failed - this is OK, can re-run
        
        print(f"  Game {game_id}: Processed {len(df_shots)} shots (verified {shots_saved} in DB)")
        return df_shots
        
    except Exception as e:
        print(f"  Game {game_id}: Error processing: {e}")
        import traceback
        traceback.print_exc()
        return None


def process_games_batch(batch_size=10):
    """
    Process games in batches for memory efficiency.
    
    Args:
        batch_size: Number of games to process per batch
    
    Returns:
        dict: Summary with processed and failed counts
    """
    total_unprocessed = count_unprocessed_games()
    
    if total_unprocessed == 0:
        print("No unprocessed games found.")
        return {'processed': 0, 'failed': 0}
    
    print(f"Found {total_unprocessed:,} unprocessed games")
    print(f"Processing in batches of {batch_size}...")
    print()
    
    processed_count = 0
    failed_count = 0
    start_time = time.time()
    batch_num = 0
    
    # Fixed: Always fetch from offset 0 since processed games are filtered out
    # This eliminates the offset pagination bug that caused stalls at 268 games
    while True:
        try:
            # Recalculate total unprocessed every batch for accurate progress
            total_unprocessed = count_unprocessed_games()
            
            if total_unprocessed == 0:
                print("All games processed!")
                break
            
            # Always fetch from offset 0 (processed games are filtered out automatically)
            games = get_unprocessed_games_batch(limit=batch_size, offset=0)
            
            if not games:
                # Verify no games are actually remaining
                total_unprocessed = count_unprocessed_games()
                if total_unprocessed == 0:
                    print("All games processed!")
                    break
                else:
                    # Shouldn't happen, but retry
                    print(f"[WARNING] No games returned but {total_unprocessed} still unprocessed. Retrying...")
                    continue
            
            batch_num += 1
            print(f"Processing batch #{batch_num}: {len(games)} games (total unprocessed: {total_unprocessed:,})")
            
            for game in games:
                game_id = game['game_id']
                raw_json = game['raw_json']
                
                try:
                    result = process_single_game_json(raw_json, game_id)
                    
                    if result is not None:
                        processed_count += 1
                    else:
                        failed_count += 1
                        print(f"  [FAILED] Game {game_id} returned None")
                except KeyboardInterrupt:
                    print("\n[INTERRUPTED] User stopped processing")
                    raise
                except Exception as e:
                    failed_count += 1
                    print(f"  [ERROR] Game {game_id} crashed: {e}")
                    import traceback
                    traceback.print_exc()
                    # Continue with next game instead of stopping
                    continue
            
            # Progress update (recalculate remaining after processing)
            total_unprocessed = count_unprocessed_games()
            elapsed = time.time() - start_time
            rate = processed_count / elapsed if elapsed > 0 else 0
            remaining = total_unprocessed
            eta = remaining / rate if rate > 0 else 0
            
            print(f"  Progress: {processed_count:,} processed, {failed_count:,} failed, {remaining:,} remaining")
            print(f"  Rate: {rate:.1f} games/sec, ETA: {eta:.0f} seconds")
            print()
            
        except KeyboardInterrupt:
            print("\n[INTERRUPTED] Processing stopped by user")
            break
        except Exception as e:
            print(f"\n[FATAL ERROR] Batch processing crashed: {e}")
            import traceback
            traceback.print_exc()
            print(f"\n[INFO] Processed {processed_count} games before crash")
            print(f"[INFO] You can resume by running the script again - it will continue from unprocessed games")
            # Don't break - try to continue with next batch
            offset += batch_size  # Skip this batch
            continue
    
    end_time = time.time()
    
    print("=" * 80)
    print("PROCESSING COMPLETE")
    print("=" * 80)
    print(f"Total time: {end_time - start_time:.2f} seconds")
    print(f"Games processed: {processed_count:,}")
    print(f"Games failed: {failed_count:,}")
    
    return {'processed': processed_count, 'failed': failed_count}


def main():
    """Main entry point with CLI arguments."""
    parser = argparse.ArgumentParser(description='Phase 2: Process raw NHL data and calculate xG/xA')
    parser.add_argument('--batch-size', '-b', type=int, default=DEFAULT_BATCH_SIZE,
                       help=f'Number of games to process per batch (default: {DEFAULT_BATCH_SIZE})')
    parser.add_argument('--game-id', type=int, default=None,
                       help='Process a specific game ID (overrides batch processing)')
    
    args = parser.parse_args()
    
    print("=" * 80)
    print("PHASE 2: PROCESS RAW NHL DATA")
    print("=" * 80)
    print()
    
    if args.game_id:
        # Process single game
        print(f"Processing game {args.game_id}...")
        response = supabase.table('raw_nhl_data')\
            .select('game_id, raw_json')\
            .eq('game_id', args.game_id)\
            .execute()
        
        if not response.data:
            print(f"Game {args.game_id} not found in raw_nhl_data table.")
            return
        
        game = response.data[0]
        result = process_single_game_json(game['raw_json'], game['game_id'])
        
        if result is not None:
            print(f"[OK] Game {args.game_id} processed successfully ({len(result)} shots)")
        else:
            print(f"[ERROR] Game {args.game_id} processing failed")
    else:
        # Process in batches
        summary = process_games_batch(batch_size=args.batch_size)
        print(f"\n[OK] Processing complete. {summary['processed']:,} games processed.")


if __name__ == "__main__":
    main()

