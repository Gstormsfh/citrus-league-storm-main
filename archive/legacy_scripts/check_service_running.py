#!/usr/bin/env python3
"""Check if the data scraping service is actually running and working"""
import os
import sys
import subprocess
import datetime as dt
from pathlib import Path

print("=" * 80)
print("SERVICE STATUS CHECK")
print("=" * 80)

# 1. Check for running Python processes
print("\n1. RUNNING PYTHON PROCESSES:")
print("-" * 80)
try:
    result = subprocess.run(
        ['tasklist', '/FI', 'IMAGENAME eq python.exe', '/FO', 'CSV'],
        capture_output=True,
        text=True,
        shell=True
    )
    lines = result.stdout.split('\n')
    python_procs = [l for l in lines if 'python.exe' in l and 'PID' not in l]
    print(f"Found {len(python_procs)} Python process(es)")
    if python_procs:
        for proc in python_procs[:5]:
            parts = proc.split(',')
            if len(parts) >= 2:
                pid = parts[1].strip('"')
                mem = parts[4].strip('"') if len(parts) > 4 else '?'
                print(f"  PID {pid}: {mem} memory")
    else:
        print("  ⚠️ NO Python processes found - service is NOT running!")
except Exception as e:
    print(f"  Error checking processes: {e}")

# 2. Check log file
print("\n2. LOG FILE STATUS:")
print("-" * 80)
log_file = Path("logs/data_scraping_service.log")
if log_file.exists():
    mtime = dt.datetime.fromtimestamp(log_file.stat().st_mtime)
    now = dt.datetime.now()
    age_minutes = (now - mtime).total_seconds() / 60
    size = log_file.stat().st_size
    
    print(f"  Exists: Yes")
    print(f"  Last modified: {mtime.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Age: {age_minutes:.1f} minutes ago")
    print(f"  Size: {size:,} bytes")
    
    if age_minutes > 10:
        print(f"  ⚠️ WARNING: Log file is {age_minutes:.1f} minutes old - service may not be running!")
    
    # Read last 20 lines
    try:
        lines = log_file.read_text(encoding='utf-8', errors='ignore').split('\n')
        recent = [l for l in lines[-20:] if l.strip()]
        print(f"\n  Last 10 log lines:")
        for line in recent[-10:]:
            print(f"    {line}")
    except Exception as e:
        print(f"  Error reading log: {e}")
else:
    print("  ⚠️ Log file does NOT exist - service has never run!")

# 3. Check Windows Task Scheduler
print("\n3. WINDOWS TASK SCHEDULER:")
print("-" * 80)
try:
    result = subprocess.run(
        ['schtasks', '/QUERY', '/TN', 'CitrusDataScrapingService', '/FO', 'LIST'],
        capture_output=True,
        text=True,
        shell=True
    )
    if 'CitrusDataScrapingService' in result.stdout:
        print("  Task exists in Task Scheduler")
        if 'Running' in result.stdout:
            print("  ✅ Task is RUNNING")
        else:
            print("  ⚠️ Task exists but is NOT running")
    else:
        print("  ⚠️ Task NOT found in Task Scheduler")
except Exception as e:
    print(f"  Error checking Task Scheduler: {e}")

# 4. Test if we can import and run the service functions
print("\n4. SERVICE CODE CHECK:")
print("-" * 80)
try:
    sys.path.insert(0, '.')
    from data_scraping_service import detect_active_games
    has_active = detect_active_games()
    print(f"  detect_active_games() works: {has_active}")
except Exception as e:
    print(f"  ⚠️ Error importing/running service code: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 80)
print("DIAGNOSTIC COMPLETE")
print("=" * 80)

