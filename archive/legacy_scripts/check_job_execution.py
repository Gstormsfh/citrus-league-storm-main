#!/usr/bin/env python3
"""Check if the live stats update job is actually executing"""
from pathlib import Path
import datetime as dt

log_file = Path("logs/data_scraping_service.log")
if log_file.exists():
    lines = log_file.read_text(encoding='utf-8', errors='ignore').split('\n')
    
    # Look for "Running live stats update" or "Live stats update completed"
    recent_executions = []
    for i, line in enumerate(lines[-100:], start=len(lines)-100):
        if 'Running live stats update cycle' in line or 'Live stats update completed' in line:
            recent_executions.append((i, line))
    
    print("Recent live stats update job executions:")
    print("-" * 80)
    if recent_executions:
        for line_num, line in recent_executions[-10:]:
            print(f"Line {line_num}: {line}")
    else:
        print("⚠️ NO EXECUTIONS FOUND - The job is scheduled but NOT running!")
        print("\nThis means the scheduler has the job scheduled, but it's not executing.")
        print("Possible causes:")
        print("  1. The job is scheduled but the trigger isn't firing")
        print("  2. The job is executing but failing silently")
        print("  3. The scheduler isn't actually running the job")
    
    # Also check for "Running job" entries
    print("\n" + "=" * 80)
    print("Recent 'Running job' entries (all jobs):")
    print("-" * 80)
    recent_jobs = [l for l in lines[-50:] if 'Running job' in l]
    for line in recent_jobs[-10:]:
        print(line)

