#!/usr/bin/env python3
"""
Restore PPP/SHP values by re-running fetch_nhl_stats_from_landing.py for key players.
"""

import os
import sys
import subprocess

print("=" * 80)
print("Restoring PPP/SHP Values")
print("=" * 80)
print()
print("Re-running fetch_nhl_stats_from_landing.py to restore correct values...")
print("(This will update nhl_ppp and nhl_shp from the NHL landing endpoint)")
print()

# Run the script
result = subprocess.run(
    [sys.executable, "fetch_nhl_stats_from_landing.py"],
    cwd=os.getcwd(),
    capture_output=True,
    text=True
)

print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr)

print()
print("=" * 80)
if result.returncode == 0:
    print("✓ Script completed successfully")
    print()
    print("Next steps:")
    print("1. Verify values in database")
    print("2. Refresh frontend to see updated stats")
else:
    print(f"✗ Script failed with exit code {result.returncode}")
print("=" * 80)

