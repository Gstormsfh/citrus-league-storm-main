#!/usr/bin/env python3
"""
Run projections with enhanced progress tracking.
"""

import sys
import subprocess
import os

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

print("=" * 80)
print("RUNNING PROJECTIONS WITH PROGRESS TRACKING")
print("=" * 80)
print()

# Run the projection script
cmd = [sys.executable, "run_daily_projections.py", "--date", "2026-01-05"]

process = subprocess.Popen(
    cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
    universal_newlines=True
)

# Stream output in real-time
for line in process.stdout:
    print(line, end='', flush=True)

process.wait()

print()
print("=" * 80)
if process.returncode == 0:
    print("✓ PROJECTIONS COMPLETE")
else:
    print(f"✗ PROJECTIONS FAILED (exit code: {process.returncode})")
print("=" * 80)

