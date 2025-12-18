#!/usr/bin/env python3
"""Real-time progress monitor for data scraping"""

import os
import time
from datetime import datetime
from data_acquisition import supabase

def get_total_shots():
    """Get total number of shots in database"""
    try:
        response = supabase.table('raw_shots').select('id', count='exact').limit(1).execute()
        return response.count if hasattr(response, 'count') else 0
    except:
        return 0

def get_latest_date():
    """Get the most recent date with data"""
    try:
        response = supabase.table('raw_shots').select('created_at').order('created_at', desc=True).limit(1).execute()
        if response.data and response.data[0].get('created_at'):
            date_str = response.data[0]['created_at']
            if 'T' in str(date_str):
                return str(date_str).split('T')[0]
            return str(date_str)
    except:
        pass
    return None

def main():
    print("=" * 80)
    print("REAL-TIME PROGRESS MONITOR")
    print("=" * 80)
    print("Press Ctrl+C to stop monitoring\n")
    
    last_count = 0
    start_time = time.time()
    
    try:
        while True:
            current_count = get_total_shots()
            latest_date = get_latest_date()
            elapsed = time.time() - start_time
            
            if current_count > last_count:
                new_shots = current_count - last_count
                rate = new_shots / (elapsed / 60) if elapsed > 0 else 0  # shots per minute
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Total: {current_count:,} shots | "
                      f"Latest: {latest_date} | "
                      f"Rate: {rate:.0f} shots/min | "
                      f"New: +{new_shots:,}")
                last_count = current_count
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Total: {current_count:,} shots | "
                      f"Latest: {latest_date} | "
                      f"Waiting for new data...")
            
            time.sleep(10)  # Check every 10 seconds
            
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped.")
        print(f"Final count: {get_total_shots():,} shots")

if __name__ == "__main__":
    main()

