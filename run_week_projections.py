"""
Run projections for an entire week (all days with games).
Usage: python run_week_projections.py [start_date] [end_date]
"""
import subprocess
import sys
from datetime import datetime, timedelta

def main():
    # Default to Week 3
    start_date = datetime.strptime(sys.argv[1] if len(sys.argv) > 1 else "2025-12-22", "%Y-%m-%d").date()
    end_date = datetime.strptime(sys.argv[2] if len(sys.argv) > 2 else "2025-12-28", "%Y-%m-%d").date()
    
    print("=" * 70)
    print(f"RUNNING PROJECTIONS FOR {start_date} to {end_date}")
    print("=" * 70)
    
    current = start_date
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        print(f"\n--- Processing {date_str} ---")
        
        result = subprocess.run(
            [sys.executable, "run_daily_projections.py", "--date", date_str, "--season", "2025"],
            capture_output=False
        )
        
        if result.returncode != 0:
            print(f"[WARN] Projections for {date_str} may have had issues")
        
        current += timedelta(days=1)
    
    print("\n" + "=" * 70)
    print("WEEK PROJECTIONS COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    main()
