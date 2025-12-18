#!/usr/bin/env python3
"""
fix_player_stats_aggregation.py

Re-aggregate player stats from raw_shots table to ensure complete coverage.
This fixes the issue where raw_player_stats only has 492 records instead of 
thousands (one per player per game).
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def load_all_shots():
    """Load all shots from CSV or database."""
    print("=" * 80)
    print("LOADING ALL SHOTS")
    print("=" * 80)
    
    # Try CSV first (faster)
    csv_path = 'data/our_shots_2025.csv'
    if os.path.exists(csv_path):
        print(f"\n📁 Loading from CSV: {csv_path}")
        try:
            df = pd.read_csv(csv_path)
            print(f"✅ Loaded {len(df):,} shots from CSV")
            return df
        except Exception as e:
            print(f"⚠️  Error loading CSV: {e}")
            print("   Falling back to database...")
    
    # Fallback to database
    print("\n📁 Loading from database: raw_shots table")
    try:
        all_shots = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('raw_shots').select('*').range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_shots.extend(response.data)
            
            if len(response.data) < batch_size:
                break
            
            offset += batch_size
            print(f"  Fetched {len(all_shots):,} records so far...")
        
        if all_shots:
            df = pd.DataFrame(all_shots)
            print(f"✅ Loaded {len(df):,} shots from database")
            return df
        else:
            print("❌ No shots found in database")
            return None
            
    except Exception as e:
        print(f"❌ Error loading from database: {e}")
        return None

def aggregate_player_stats(df_shots):
    """Aggregate xG and xA per player per game from shots."""
    print("\n" + "=" * 80)
    print("AGGREGATING PLAYER STATS")
    print("=" * 80)
    
    if df_shots is None or len(df_shots) == 0:
        print("❌ No shot data available")
        return None
    
    # Get xG column name
    xg_col = None
    for col in ['xg_value', 'xG_Value', 'predicted_xg', 'flurry_adjusted_xg']:
        if col in df_shots.columns:
            xg_col = col
            break
    
    if xg_col is None:
        print("❌ No xG column found")
        return None
    
    print(f"\nUsing xG column: {xg_col}")
    print(f"Total shots: {len(df_shots):,}")
    print(f"Total xG: {df_shots[xg_col].sum():.2f}")
    
    # Get player ID column
    player_id_col = None
    for col in ['player_id', 'playerId', 'shooting_player_id']:
        if col in df_shots.columns:
            player_id_col = col
            break
    
    if player_id_col is None:
        print("❌ No player ID column found")
        return None
    
    print(f"Using player ID column: {player_id_col}")
    
    # Get game_id column
    if 'game_id' not in df_shots.columns:
        print("❌ No game_id column found")
        return None
    
    # Aggregate xG per player per game (shooters)
    print("\n📊 Aggregating xG per player per game (shooters)...")
    final_stats_df_xg = df_shots.groupby([player_id_col, 'game_id']).agg(
        I_F_xGoals=(xg_col, 'sum')
    ).reset_index()
    
    # Rename player_id_col to playerId for consistency
    if player_id_col != 'playerId':
        final_stats_df_xg = final_stats_df_xg.rename(columns={player_id_col: 'playerId'})
    
    print(f"✅ Aggregated xG for {len(final_stats_df_xg):,} player/game combinations")
    print(f"   Total xG in aggregated stats: {final_stats_df_xg['I_F_xGoals'].sum():.2f}")
    
    # Aggregate xA per player per game (passers)
    print("\n📊 Aggregating xA per player per game (passers)...")
    
    # Get xA column
    xa_col = None
    for col in ['xa_value', 'xA_Value', 'predicted_xa']:
        if col in df_shots.columns:
            xa_col = col
            break
    
    # Get passer_id column
    passer_id_col = None
    for col in ['passer_id', 'passerId']:
        if col in df_shots.columns:
            passer_id_col = col
            break
    
    if xa_col and passer_id_col:
        # Filter to shots with passes that have xA
        passes_with_xa = df_shots[
            df_shots[passer_id_col].notna() & 
            (df_shots[xa_col] > 0)
        ].copy()
        
        if len(passes_with_xa) > 0:
            print(f"   Found {len(passes_with_xa):,} passes with xA values")
            
            final_stats_df_xa = passes_with_xa.groupby([passer_id_col, 'game_id']).agg(
                I_F_xAssists=(xa_col, 'sum')
            ).reset_index()
            
            # Rename passer_id_col to playerId for consistency
            if passer_id_col != 'playerId':
                final_stats_df_xa = final_stats_df_xa.rename(columns={passer_id_col: 'playerId'})
            
            print(f"✅ Aggregated xA for {len(final_stats_df_xa):,} passer/game combinations")
            print(f"   Total xA in aggregated stats: {final_stats_df_xa['I_F_xAssists'].sum():.2f}")
            
            # Merge xG and xA
            final_stats_df = final_stats_df_xg.merge(
                final_stats_df_xa,
                on=['playerId', 'game_id'],
                how='outer',
                suffixes=('', '_xa')
            )
            
            # Fill NaN values with 0
            final_stats_df['I_F_xGoals'] = final_stats_df['I_F_xGoals'].fillna(0.0)
            final_stats_df['I_F_xAssists'] = final_stats_df['I_F_xAssists'].fillna(0.0)
        else:
            print("   ⚠️  No passes with xA values found")
            final_stats_df = final_stats_df_xg.copy()
            final_stats_df['I_F_xAssists'] = 0.0
    else:
        print("   ⚠️  xA column or passer_id column not found - skipping xA aggregation")
        final_stats_df = final_stats_df_xg.copy()
        final_stats_df['I_F_xAssists'] = 0.0
    
    # Ensure proper data types
    final_stats_df['playerId'] = final_stats_df['playerId'].astype(int)
    final_stats_df['game_id'] = final_stats_df['game_id'].astype(int)
    final_stats_df['I_F_xGoals'] = final_stats_df['I_F_xGoals'].astype(float)
    final_stats_df['I_F_xAssists'] = final_stats_df['I_F_xAssists'].astype(float)
    
    print(f"\n✅ Final aggregated stats:")
    print(f"   Total player/game records: {len(final_stats_df):,}")
    print(f"   Total xG: {final_stats_df['I_F_xGoals'].sum():.2f}")
    print(f"   Total xA: {final_stats_df['I_F_xAssists'].sum():.2f}")
    print(f"   Unique players: {final_stats_df['playerId'].nunique():,}")
    print(f"   Unique games: {final_stats_df['game_id'].nunique():,}")
    
    return final_stats_df

def upload_to_database(final_stats_df):
    """Upload aggregated stats to raw_player_stats table."""
    print("\n" + "=" * 80)
    print("UPLOADING TO DATABASE")
    print("=" * 80)
    
    if final_stats_df is None or len(final_stats_df) == 0:
        print("❌ No data to upload")
        return False
    
    # Check if I_F_xAssists column exists
    try:
        test_query = supabase.table('raw_player_stats').select('I_F_xAssists').limit(1).execute()
        has_xa_column = True
    except Exception:
        has_xa_column = False
        if 'I_F_xAssists' in final_stats_df.columns:
            print("⚠️  I_F_xAssists column not found in database. Uploading xG data only.")
            final_stats_df = final_stats_df.drop(columns=['I_F_xAssists'])
    
    # Convert to records
    data_to_upload = final_stats_df.to_dict(orient='records')
    
    print(f"\n📤 Uploading {len(data_to_upload):,} player/game records...")
    
    # Upload in batches
    batch_size = 1000
    total_uploaded = 0
    
    for i in range(0, len(data_to_upload), batch_size):
        batch = data_to_upload[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(data_to_upload) + batch_size - 1) // batch_size
        
        try:
            response = supabase.table('raw_player_stats').upsert(
                batch,
                on_conflict='playerId,game_id'
            ).execute()
            total_uploaded += len(batch)
            print(f"  ✅ Batch {batch_num}/{total_batches}: Uploaded {len(batch):,} records (Total: {total_uploaded:,})")
        except Exception as e:
            print(f"  ❌ Error uploading batch {batch_num}: {e}")
            # Try individual inserts for this batch
            for record in batch:
                try:
                    supabase.table('raw_player_stats').upsert(
                        [record],
                        on_conflict='playerId,game_id'
                    ).execute()
                    total_uploaded += 1
                except Exception:
                    pass  # Skip duplicates silently
    
    print(f"\n✅ Successfully uploaded/updated {total_uploaded:,} records to raw_player_stats table")
    return True

def main():
    """Main function."""
    print("=" * 80)
    print("FIX PLAYER STATS AGGREGATION")
    print("=" * 80)
    print("\nThis script re-aggregates player stats from raw_shots table")
    print("to ensure complete coverage in raw_player_stats table.")
    print()
    
    # Load all shots
    df_shots = load_all_shots()
    
    if df_shots is None:
        print("❌ Failed to load shot data")
        return
    
    # Aggregate player stats
    final_stats_df = aggregate_player_stats(df_shots)
    
    if final_stats_df is None:
        print("❌ Failed to aggregate player stats")
        return
    
    # Upload to database
    success = upload_to_database(final_stats_df)
    
    if success:
        print("\n" + "=" * 80)
        print("✅ AGGREGATION COMPLETE!")
        print("=" * 80)
        print(f"\n📊 Summary:")
        print(f"   Total player/game records: {len(final_stats_df):,}")
        print(f"   Total xG: {final_stats_df['I_F_xGoals'].sum():.2f}")
        print(f"   Total xA: {final_stats_df['I_F_xAssists'].sum():.2f}")
        print(f"   Unique players: {final_stats_df['playerId'].nunique():,}")
        print(f"   Unique games: {final_stats_df['game_id'].nunique():,}")
        print("\n✅ Player stats have been re-aggregated and uploaded to database!")
        print("   You can now run compare_full_season_stats.py again to see improved statistics.")
    else:
        print("\n❌ Upload failed. Check errors above.")

if __name__ == "__main__":
    main()

