#!/usr/bin/env python3
"""Test processing today's games"""

from run_daily_pbp_processing import process_recently_finished_games

print("Testing process_recently_finished_games...")
result = process_recently_finished_games(max_age_hours=2)
print(f"\nResult:")
print(f"  Processed: {result.get('processed', 0)}")
print(f"  Failed: {result.get('failed', 0)}")
print(f"  Skipped: {result.get('skipped', 0)}")
print(f"  Game IDs: {result.get('game_ids', [])}")

