#!/usr/bin/env python3
"""
Test the service manually to verify it works with a live game.
This will start the service and show real-time activity.
"""
import sys
import os
import time
from datetime import datetime

# Fix Windows encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=" * 80)
print("MANUAL SERVICE TEST - Starting Data Scraping Service")
print("=" * 80)
print("This will run the service for 2 minutes so you can see it working.")
print("Press Ctrl+C to stop early.")
print()
print("What to watch for:")
print("  - If games are active: Should see '30s interval' and ingestion every 30s")
print("  - If no games: Should see '300s interval' (5 min polling)")
print()
print("Starting in 3 seconds...")
print()

time.sleep(3)

try:
    from data_scraping_service import main
    main()
except KeyboardInterrupt:
    print("\n\nService stopped by user.")
except Exception as e:
    print(f"\n\nError: {e}")
    import traceback
    traceback.print_exc()


