#!/usr/bin/env python3
"""Fix defensemen key in scraper"""

import os

scraper_path = r"C:\Users\garre\Documents\citrus-league-storm-main\scrape_per_game_nhl_stats.py"

with open(scraper_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace defensemen with defense
old_line = 'for position_group in ["forwards", "defensemen", "goalies"]:'
new_line = 'for position_group in ["forwards", "defense", "goalies"]:'

if old_line in content:
    content = content.replace(old_line, new_line)
    with open(scraper_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("[OK] Fixed defensemen -> defense in scraper")
else:
    print("[WARN] Line not found - may already be fixed")

