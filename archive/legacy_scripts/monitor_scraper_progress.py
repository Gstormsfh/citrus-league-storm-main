#!/usr/bin/env python3
"""Monitor the per-game scraper progress."""
import time
import re
import sys

TERMINAL_FILE = r"c:\Users\garre\.cursor\projects\c-Users-garre-Documents-citrus-league-storm-main-citrus-league-storm-code-workspace\terminals\44.txt"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

print("=" * 70)
print("MONITORING PER-GAME NHL STATS SCRAPER PROGRESS")
print("=" * 70)
print()

last_game = 0
start_time = time.time()

while True:
    try:
        with open(TERMINAL_FILE, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # Find all progress lines like "[7/666] (1%)"
        matches = re.findall(r'\[(\d+)/(\d+)\]\s*\((\d+)%\)', content)
        
        if matches:
            current, total, pct = matches[-1]
            current = int(current)
            total = int(total)
            pct = int(pct)
            
            if current != last_game:
                elapsed = time.time() - start_time
                if current > 0:
                    rate = current / elapsed
                    remaining = (total - current) / rate if rate > 0 else 0
                    eta_min = remaining / 60
                else:
                    rate = 0
                    eta_min = 0
                
                print(f"[{current:3d}/{total}] {pct:3d}% complete | Rate: {rate:.1f} games/sec | ETA: {eta_min:.1f} min", flush=True)
                last_game = current
                
                # Check if done
                if current >= total:
                    print()
                    print("=" * 70)
                    print("SCRAPER COMPLETE!")
                    print("=" * 70)
                    break
        
        # Check if process has ended (look for summary line)
        if "All done!" in content or "Processed" in content.split('\n')[-10:]:
            # Look for final summary
            summary_match = re.search(r'Processed (\d+) games', content)
            if summary_match:
                print()
                print("=" * 70)
                print(f"SCRAPER COMPLETE! Processed {summary_match.group(1)} games")
                print("=" * 70)
                break
        
        time.sleep(5)
        
    except FileNotFoundError:
        print("Waiting for scraper to start...")
        time.sleep(2)
    except KeyboardInterrupt:
        print("\nMonitoring stopped.")
        break
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(5)

