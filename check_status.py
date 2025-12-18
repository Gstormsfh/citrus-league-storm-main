#!/usr/bin/env python3
"""Quick status check for data scraping progress"""

import pandas as pd
import os
from data_acquisition import supabase

print("=" * 80)
print("DATA SCRAPING STATUS CHECK")
print("=" * 80)

# Check CSV file
csv_path = 'data/our_shots_2025.csv'
if os.path.exists(csv_path):
    try:
        df = pd.read_csv(csv_path, nrows=1000)  # Just read first 1000 rows for speed
        file_size = os.path.getsize(csv_path) / (1024 * 1024)  # MB
        print(f"\n[OK] CSV file exists: {csv_path}")
        print(f"     File size: {file_size:.2f} MB")
        print(f"     Columns: {len(df.columns)}")
        if 'game_date' in df.columns:
            print(f"     Date range (sample): {df['game_date'].min()} to {df['game_date'].max()}")
    except Exception as e:
        print(f"\n[ERROR] Could not read CSV: {e}")
else:
    print(f"\n[WARNING] CSV file not found: {csv_path}")

# Check database
try:
    response = supabase.table('raw_shots').select('id', count='exact').limit(1).execute()
    count = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
    print(f"\n[OK] Database connection successful")
    print(f"     Shots in raw_shots table: {count:,}")
except Exception as e:
    print(f"\n[ERROR] Database check failed: {e}")

print("\n" + "=" * 80)

