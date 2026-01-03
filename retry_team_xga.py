#!/usr/bin/env python3
"""
Retry script to calculate team xGA/60 for a specific team (NYR in this case).
Includes retry logic with exponential backoff to handle temporary Supabase errors.
"""

from dotenv import load_dotenv
import os
import sys
import time
from supabase_rest import SupabaseRest
from calculate_daily_projections import get_team_xga_per_60

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def retry_team_xga(team: str, season: int = DEFAULT_SEASON, max_retries: int = 3, delay: int = 5):
    """
    Retry calculating team xGA/60 with exponential backoff.
    
    Args:
        team: Team abbreviation (e.g., "NYR")
        season: Season year (default: 2025)
        max_retries: Maximum number of retry attempts
        delay: Initial delay in seconds (will double with each retry)
    """
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    print(f"Attempting to calculate xGA/60 for {team} (season {season})...")
    print(f"Will retry up to {max_retries} times with exponential backoff\n")
    
    for attempt in range(1, max_retries + 1):
        try:
            print(f"Attempt {attempt}/{max_retries}...")
            xga_per_60 = get_team_xga_per_60(db, team, season, last_n_games=10, debug=True)
            
            if xga_per_60 is not None and xga_per_60 > 0:
                print(f"\n✅ Success! {team} xGA/60: {xga_per_60:.3f}")
                return xga_per_60
            else:
                print(f"⚠️  Got None or zero value: {xga_per_60}")
                if attempt < max_retries:
                    wait_time = delay * (2 ** (attempt - 1))
                    print(f"Waiting {wait_time} seconds before retry...\n")
                    time.sleep(wait_time)
                else:
                    print(f"\n❌ Failed after {max_retries} attempts. Returning None.")
                    return None
                    
        except Exception as e:
            error_msg = str(e)
            print(f"❌ Error on attempt {attempt}: {error_msg[:200]}...")
            
            if attempt < max_retries:
                wait_time = delay * (2 ** (attempt - 1))
                print(f"Waiting {wait_time} seconds before retry...\n")
                time.sleep(wait_time)
            else:
                print(f"\n❌ Failed after {max_retries} attempts due to: {e}")
                return None
    
    return None


if __name__ == "__main__":
    # Default to NYR if no argument provided
    team = sys.argv[1] if len(sys.argv) > 1 else "NYR"
    season = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SEASON
    
    print("=" * 80)
    print(f"RETRY TEAM XGA/60 CALCULATION")
    print("=" * 80)
    print()
    
    result = retry_team_xga(team, season)
    
    if result:
        print(f"\n✅ Calculation successful: {team} xGA/60 = {result:.3f}")
        sys.exit(0)
    else:
        print(f"\n❌ Calculation failed for {team}")
        sys.exit(1)



