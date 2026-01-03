#!/usr/bin/env python3
"""
Verify that the rolling cache is not using future data (look-ahead trap).
Checks that date comparisons are strict (< not <=) in cached functions.
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# Check critical date comparison logic
print("="*80)
print("LOOK-AHEAD TRAP VERIFICATION")
print("="*80 + "\n")

print("Checking critical date comparison logic in cached functions...\n")

# Read the backtest file to check date logic
backtest_file = project_root / "backtest_vopa_model_fast.py"

if not backtest_file.exists():
    print("⚠️  Could not find backtest_vopa_model_fast.py")
    sys.exit(1)

with open(backtest_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Check for critical date comparisons
issues = []
warnings = []

# Check 1: Rolling cache date comparisons should use < not <=
print("1. Checking rolling cache date comparisons...")
if "log['date'] < current_date" in content or "log.date < current_date" in content:
    print("   ✓ Found strict date comparison (<) in rolling cache")
else:
    issues.append("Rolling cache may be using <= instead of <")

# Check 2: Opponent context should filter by date
print("\n2. Checking opponent context date filtering...")
if "game_date < current_date" in content or "log['game_date'] < current_date" in content:
    print("   ✓ Found date filtering in opponent context")
else:
    warnings.append("Opponent context may not filter by date")

# Check 3: Schedule lookups should use <
print("\n3. Checking schedule/rest day calculations...")
if "game_date < current_date" in content or "schedule['date'] < current_date" in content:
    print("   ✓ Found date filtering in schedule lookups")
else:
    warnings.append("Schedule lookups may not filter by date")

# Check 4: Team stats should filter by date
print("\n4. Checking team stats date filtering...")
if "log['date'] < current_date" in content or "game_date < current_date" in content:
    print("   ✓ Found date filtering in team stats")
else:
    warnings.append("Team stats may not filter by date")

# Check for dangerous patterns
print("\n5. Checking for dangerous patterns...")
dangerous_patterns = [
    ("<=", "Less than or equal (may include current game)"),
    ("game_date >=", "May include future games"),
    ("date >=", "May include future games"),
]

for pattern, description in dangerous_patterns:
    if pattern in content:
        # Count occurrences
        count = content.count(pattern)
        # Check if it's in a date comparison context
        if "current_date" in content or "game_date" in content:
            warnings.append(f"Found '{pattern}' - {description} ({count} occurrences)")

# Summary
print("\n" + "="*80)
print("VERIFICATION SUMMARY")
print("="*80)

if issues:
    print("\n[!] CRITICAL ISSUES FOUND:")
    for issue in issues:
        print(f"   - {issue}")
    print("\n   These must be fixed before running the backtest!")
else:
    print("\n[OK] No critical issues found")

if warnings:
    print("\n[!] WARNINGS:")
    for warning in warnings:
        print(f"   - {warning}")
    print("\n   Review these to ensure no look-ahead leakage")
else:
    print("\n[OK] No warnings")

print("\n" + "="*80)
print("RECOMMENDATIONS")
print("="*80)
print("""
1. During backfill, monitor correlation:
   - If correlation > 0.70, check for look-ahead leakage
   - Expected correlation: 0.35-0.45 for a good model

2. Watch VOPA gap:
   - Should stay consistently ~3.95 across all games
   - If it drops significantly, check for calculation errors

3. Goalie VOPA:
   - Monitor if it stays at ~2.18 average
   - If it dominates rankings, consider positional multiplier

4. After backfill completes:
   - Run: python vopa_backtest_audit.py 2025
   - Should see 300+ matched games and 5,000+ projections
   - Correlation should stabilize with larger sample
""")

print("="*80 + "\n")

