"""
ENSURE DATA INTEGRITY
======================
Master script to verify and fix ALL data issues. Run this daily after scraping.

This script:
1. Verifies all played games have goalie records
2. Fixes any missing goalie records
3. Verifies data counts are correct
4. Reports any anomalies

Usage:
    python ensure_data_integrity.py
"""
import subprocess
import sys
from supabase_rest import SupabaseRest
from dotenv import load_dotenv
from datetime import date
import os

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

SEASON = 2025
BATCH_SIZE = 1000


def paginate_select(table, select, filters, max_records=50000):
    """Paginate through all records."""
    all_records = []
    offset = 0
    
    while len(all_records) < max_records:
        try:
            batch = db.select(table, select=select, filters=filters, limit=BATCH_SIZE, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < BATCH_SIZE:
                break
            offset += BATCH_SIZE
        except Exception as e:
            print(f"  [WARN] Pagination error: {e}")
            break
    
    return all_records


def check_goalie_coverage():
    """Check if all played games have goalie records."""
    print("\n[1/3] CHECKING GOALIE COVERAGE...")
    
    today = date.today().isoformat()
    
    # Get all played games
    nhl_games = paginate_select(
        'nhl_games',
        select='game_id,game_date',
        filters=[('season', 'eq', SEASON)]
    )
    played = [g for g in nhl_games if g.get('game_date') and g['game_date'] <= today]
    played_ids = set([g['game_id'] for g in played])
    
    # Get games with goalie records
    goalie_records = paginate_select(
        'player_game_stats',
        select='game_id',
        filters=[('season', 'eq', SEASON), ('is_goalie', 'eq', True)]
    )
    goalie_game_ids = set([r['game_id'] for r in goalie_records])
    
    missing = played_ids - goalie_game_ids
    
    print(f"  Played games: {len(played_ids)}")
    print(f"  Games with goalies: {len(goalie_game_ids)}")
    print(f"  Missing goalie data: {len(missing)}")
    
    return missing


def fix_missing_goalies(missing_count):
    """Run the goalie recovery script if there are missing games."""
    if missing_count == 0:
        print("  [OK] No missing goalie data - skipping recovery")
        return True
    
    print(f"\n[2/3] FIXING {missing_count} GAMES WITH MISSING GOALIES...")
    print("  Running fix_all_missing_goalies.py...")
    
    try:
        result = subprocess.run(
            [sys.executable, "fix_all_missing_goalies.py"],
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode == 0:
            print("  [OK] Recovery script completed successfully")
            return True
        else:
            print(f"  [ERROR] Recovery script failed:")
            print(result.stderr[-500:] if result.stderr else "No error output")
            return False
    except Exception as e:
        print(f"  [ERROR] Failed to run recovery: {e}")
        return False


def verify_data_counts():
    """Verify data counts look reasonable."""
    print("\n[3/3] VERIFYING DATA COUNTS...")
    
    # Count total records
    all_records = paginate_select(
        'player_game_stats',
        select='game_id,is_goalie',
        filters=[('season', 'eq', SEASON)]
    )
    
    total = len(all_records)
    goalies = len([r for r in all_records if r.get('is_goalie')])
    skaters = total - goalies
    games = len(set([r['game_id'] for r in all_records]))
    
    print(f"  Total records: {total}")
    print(f"  Goalie records: {goalies}")
    print(f"  Skater records: {skaters}")
    print(f"  Unique games: {games}")
    
    # Sanity checks
    issues = []
    
    if goalies < games * 2:
        issues.append(f"Too few goalies ({goalies}) for {games} games (expect at least {games * 2})")
    
    if skaters < games * 30:
        issues.append(f"Too few skaters ({skaters}) for {games} games (expect at least {games * 30})")
    
    if goalies > games * 6:
        issues.append(f"Too many goalies ({goalies}) for {games} games - possible duplicates")
    
    if issues:
        print("\n  POTENTIAL ISSUES:")
        for issue in issues:
            print(f"    [WARN] {issue}")
        return False
    
    print("  [OK] Data counts look healthy")
    return True


def main():
    print("=" * 70)
    print("ENSURE DATA INTEGRITY")
    print("=" * 70)
    print(f"Season: {SEASON}")
    print(f"Date: {date.today().isoformat()}")
    
    # Step 1: Check goalie coverage
    missing = check_goalie_coverage()
    
    # Step 2: Fix any missing data
    if missing:
        fix_missing_goalies(len(missing))
        
        # Re-check after fix
        missing_after = check_goalie_coverage()
        if missing_after:
            print(f"\n  [WARN] Still {len(missing_after)} games missing after fix")
    else:
        print("\n[2/3] SKIPPING RECOVERY (no missing data)")
    
    # Step 3: Verify counts
    verify_data_counts()
    
    # Final summary
    print("\n" + "=" * 70)
    final_missing = check_goalie_coverage()
    if len(final_missing) <= 2:  # Allow for today's games not started
        print("[OK] DATA INTEGRITY CHECK PASSED")
    else:
        print(f"[WARN] {len(final_missing)} games still missing goalie data")
    print("=" * 70)


if __name__ == '__main__':
    main()
