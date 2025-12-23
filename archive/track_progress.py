#!/usr/bin/env python3
"""Track progress of data scraping by checking database"""

import os
from datetime import datetime, timedelta
from data_acquisition import supabase
import pandas as pd

def get_processed_dates():
    """Get list of dates that have shots in the database"""
    try:
        # Get unique dates from raw_shots table using created_at
        response = supabase.table('raw_shots').select('created_at').execute()
        
        if not response.data:
            return set()
        
        df = pd.DataFrame(response.data)
        if 'created_at' not in df.columns:
            return set()
        
        # Extract just the date part (remove time if present)
        dates = set()
        for date_str in df['created_at'].unique():
            if date_str:
                # Handle different date formats
                if 'T' in str(date_str):
                    date_str = str(date_str).split('T')[0]
                dates.add(str(date_str))
        
        return dates
    except Exception as e:
        print(f"[ERROR] Could not get processed dates: {e}")
        return set()

def get_date_range(start_date='2025-10-07'):
    """Get all dates from start_date to today"""
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.now()
    
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    
    return dates

def get_shot_counts_by_date():
    """Get shot counts grouped by date"""
    try:
        response = supabase.table('raw_shots').select('created_at').execute()
        
        if not response.data:
            return {}
        
        df = pd.DataFrame(response.data)
        if 'created_at' not in df.columns:
            return {}
        
        # Extract date part from created_at
        df['date'] = df['created_at'].apply(lambda x: str(x).split('T')[0] if x and 'T' in str(x) else str(x) if x else None)
        df = df[df['date'].notna()]
        
        counts = df['date'].value_counts().to_dict()
        return counts
    except Exception as e:
        print(f"[ERROR] Could not get shot counts: {e}")
        return {}

def main():
    print("=" * 80)
    print("DATA SCRAPING PROGRESS TRACKER")
    print("=" * 80)
    
    start_date = '2025-10-07'
    all_dates = get_date_range(start_date)
    processed_dates = get_processed_dates()
    shot_counts = get_shot_counts_by_date()
    
    print(f"\nDate Range: {start_date} to {datetime.now().strftime('%Y-%m-%d')}")
    print(f"Total days to process: {len(all_dates)}")
    print(f"Days processed: {len(processed_dates)}")
    print(f"Days remaining: {len(all_dates) - len(processed_dates)}")
    print(f"Progress: {len(processed_dates) / len(all_dates) * 100:.1f}%")
    
    print("\n" + "-" * 80)
    print("RECENT PROCESSING STATUS (Last 10 days):")
    print("-" * 80)
    
    recent_dates = sorted(all_dates, reverse=True)[:10]
    for date in recent_dates:
        status = "[OK]" if date in processed_dates else "[PENDING]"
        count = shot_counts.get(date, 0)
        print(f"{status} {date}: {count:,} shots")
    
    print("\n" + "-" * 80)
    print("TOTAL STATISTICS:")
    print("-" * 80)
    
    total_shots = sum(shot_counts.values())
    print(f"Total shots in database: {total_shots:,}")
    
    if shot_counts:
        avg_shots_per_day = total_shots / len(processed_dates) if processed_dates else 0
        print(f"Average shots per day: {avg_shots_per_day:.0f}")
        print(f"Most shots in a day: {max(shot_counts.values()):,} ({max(shot_counts, key=shot_counts.get)})")
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    main()

