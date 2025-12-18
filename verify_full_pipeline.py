#!/usr/bin/env python3
"""
verify_full_pipeline.py
Comprehensive verification of the full data pipeline:
- Supabase connection
- Database schema (migrations)
- Model loading
- Feature extraction
- Data saving to Supabase
"""

import os
import sys
import pandas as pd
import joblib
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

print("=" * 80)
print("FULL PIPELINE VERIFICATION")
print("=" * 80)

# 1. Verify Supabase Connection
print("\n" + "=" * 80)
print("1. VERIFYING SUPABASE CONNECTION")
print("=" * 80)

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Supabase credentials not found in .env file")
    print("   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

print(f"✅ Supabase URL: {SUPABASE_URL[:30]}...")
print(f"✅ Service key found: {len(SUPABASE_KEY)} characters")

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    # Test connection by querying a simple table
    response = supabase.table('raw_shots').select('id').limit(1).execute()
    print("✅ Supabase connection successful!")
except Exception as e:
    print(f"❌ Supabase connection failed: {e}")
    sys.exit(1)

# 2. Verify Database Schema (Migrations)
print("\n" + "=" * 80)
print("2. VERIFYING DATABASE SCHEMA (MIGRATIONS)")
print("=" * 80)

# Check for new columns from migrations
required_columns = [
    'shot_angle_adjusted',
    'home_empty_net',
    'away_empty_net',
    'shooting_team_code',
    'defending_team_code',
    'home_skaters_on_ice',
    'away_skaters_on_ice',
    'last_event_category',
    'time_since_last_event',
    'distance_from_last_event',
    'speed_from_last_event',
    'is_rush',
    'arena_adjusted_x',
    'arena_adjusted_y',
    'arena_adjusted_shot_distance'
]

try:
    # Get table schema
    response = supabase.table('raw_shots').select('*').limit(1).execute()
    if response.data:
        existing_columns = set(response.data[0].keys())
        
        missing_columns = []
        found_columns = []
        
        for col in required_columns:
            if col in existing_columns:
                found_columns.append(col)
            else:
                missing_columns.append(col)
        
        print(f"✅ Found {len(found_columns)}/{len(required_columns)} required columns")
        
        if found_columns:
            print("\n   Found columns:")
            for col in found_columns[:10]:  # Show first 10
                print(f"     ✅ {col}")
            if len(found_columns) > 10:
                print(f"     ... and {len(found_columns) - 10} more")
        
        if missing_columns:
            print(f"\n   ⚠️  Missing {len(missing_columns)} columns:")
            for col in missing_columns:
                print(f"     ❌ {col}")
            print("\n   💡 Run migrations:")
            print("      - supabase/migrations/20250121000000_add_enhanced_features_to_raw_shots.sql")
            print("      - supabase/migrations/20250121000001_add_angle_adjusted_and_empty_net_flags.sql")
        else:
            print("\n   ✅ All required columns exist!")
    else:
        print("⚠️  Table exists but is empty - cannot verify schema")
        
except Exception as e:
    print(f"❌ Error checking schema: {e}")

# 3. Verify Model Loading
print("\n" + "=" * 80)
print("3. VERIFYING MODEL LOADING")
print("=" * 80)

try:
    model = joblib.load('xg_model_moneypuck.joblib')
    print("✅ MoneyPuck model loaded: xg_model_moneypuck.joblib")
except FileNotFoundError:
    print("❌ Error: xg_model_moneypuck.joblib not found")
    print("   Run retrain_xg_with_moneypuck.py first")
    sys.exit(1)

try:
    feature_names = joblib.load('model_features_moneypuck.joblib')
    print(f"✅ Feature list loaded: {len(feature_names)} features")
except FileNotFoundError:
    print("❌ Error: model_features_moneypuck.joblib not found")
    sys.exit(1)

try:
    encoder = joblib.load('last_event_category_encoder.joblib')
    print("✅ Encoder loaded: last_event_category_encoder.joblib")
except FileNotFoundError:
    print("⚠️  Encoder not found (will encode on-the-fly)")

# 4. Verify Feature Extraction (Test on Sample Date)
print("\n" + "=" * 80)
print("4. TESTING FEATURE EXTRACTION ON SAMPLE DATE")
print("=" * 80)

print("Testing on sample date: 2025-10-07")
print("(This will extract features and test model prediction)")

try:
    from data_acquisition import scrape_pbp_and_process
    
    # Test on a single date
    result = scrape_pbp_and_process(date_str='2025-10-07')
    
    if result is not None and len(result) > 0:
        print(f"✅ Feature extraction successful!")
        print(f"   Processed {len(result)} player/game combinations")
        print(f"   Sample xG values:")
        if 'I_F_xGoals' in result.columns:
            print(f"     Mean xG: {result['I_F_xGoals'].mean():.4f}")
            print(f"     Max xG: {result['I_F_xGoals'].max():.4f}")
            print(f"     Total xG: {result['I_F_xGoals'].sum():.4f}")
    else:
        print("⚠️  Feature extraction completed but returned no data")
        print("   (This may be normal if no games on this date)")
        
except Exception as e:
    print(f"❌ Error during feature extraction: {e}")
    import traceback
    traceback.print_exc()

# 5. Verify Data Saved to Supabase
print("\n" + "=" * 80)
print("5. VERIFYING DATA SAVED TO SUPABASE")
print("=" * 80)

try:
    # Check recent shots
    response = supabase.table('raw_shots').select('*').order('created_at', desc=True).limit(10).execute()
    
    if response.data and len(response.data) > 0:
        print(f"✅ Found {len(response.data)} recent shots in database")
        
        # Check for new features in saved data
        sample_shot = response.data[0]
        new_features_found = []
        new_features_missing = []
        
        for col in required_columns[:10]:  # Check first 10
            if col in sample_shot:
                if sample_shot[col] is not None:
                    new_features_found.append(col)
                else:
                    new_features_missing.append(f"{col} (NULL)")
            else:
                new_features_missing.append(f"{col} (missing)")
        
        if new_features_found:
            print(f"\n   ✅ New features populated in database:")
            for feat in new_features_found[:5]:
                print(f"      - {feat}: {sample_shot[feat]}")
        
        if new_features_missing:
            print(f"\n   ⚠️  Some features not populated:")
            for feat in new_features_missing[:5]:
                print(f"      - {feat}")
        
        # Check xG values
        if 'xg_value' in sample_shot:
            print(f"\n   ✅ xG values being saved: {sample_shot['xg_value']:.4f}")
        
    else:
        print("⚠️  No shots found in database")
        print("   Run pull_season_data.py to populate data")
        
except Exception as e:
    print(f"❌ Error checking database: {e}")

# 6. Summary
print("\n" + "=" * 80)
print("VERIFICATION SUMMARY")
print("=" * 80)

print("\n✅ Pipeline Status:")
print("   1. Supabase connection: ✅")
print("   2. Database schema: Check above")
print("   3. Model loading: ✅")
print("   4. Feature extraction: Check above")
print("   5. Data saving: Check above")

print("\n💡 Next Steps:")
print("   - If migrations are missing, apply them via Supabase Dashboard")
print("   - Run pull_season_data.py to extract full season data")
print("   - Verify new features are being saved correctly")

print("\n" + "=" * 80)

