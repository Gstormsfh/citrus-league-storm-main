# verify_rebound_detection.py
# Quick script to verify rebound detection is working

import pandas as pd
import requests
import math
from datetime import datetime

# Base URL for the new NHL API
NHL_BASE_URL = "https://api-web.nhle.com/v1"

def parse_time_to_seconds(time_str):
    """Convert time string (MM:SS) to total seconds."""
    if not time_str or ':' not in time_str:
        return 0
    try:
        parts = time_str.split(':')
        minutes = int(parts[0])
        seconds = int(parts[1])
        return minutes * 60 + seconds
    except (ValueError, IndexError):
        return 0

def calculate_time_difference(prev_play, current_play):
    """Calculate time difference between two plays in seconds."""
    prev_period = prev_play.get('periodDescriptor', {}).get('number', 0)
    curr_period = current_play.get('periodDescriptor', {}).get('number', 0)
    
    if prev_period != curr_period:
        return None
    
    prev_time = prev_play.get('timeInPeriod', '')
    curr_time = current_play.get('timeInPeriod', '')
    
    prev_seconds = parse_time_to_seconds(prev_time)
    curr_seconds = parse_time_to_seconds(curr_time)
    
    if prev_seconds is None or curr_seconds is None or prev_seconds == 0 or curr_seconds == 0:
        return None
    
    # Time counts UP, so current should be greater than previous
    time_diff = curr_seconds - prev_seconds
    
    if time_diff < 0 or time_diff > 60:
        return None
    
    return time_diff

# Test with one game
game_id = '2025020453'
pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"

response = requests.get(pbp_url)
raw_data = response.json()

rebound_examples = []
previous_play = None

for play in raw_data.get('plays', []):
    type_code = play.get('typeCode')
    if type_code not in [505, 506, 507]:
        continue
    
    details = play.get('details', {})
    if not details:
        continue
    
    # Check for rebound
    is_rebound = 0
    if previous_play:
        prev_type_code = previous_play.get('typeCode')
        prev_details = previous_play.get('details', {})
        prev_team_id = prev_details.get('eventOwnerTeamId')
        current_team_id = details.get('eventOwnerTeamId')
        
        if prev_type_code == 506:  # Previous was shot on goal
            if prev_team_id and current_team_id and prev_team_id == current_team_id:
                time_diff = calculate_time_difference(previous_play, play)
                if time_diff is not None and time_diff < 3.0:
                    is_rebound = 1
                    rebound_examples.append({
                        'event_id': play.get('eventId'),
                        'type': 'GOAL' if type_code == 505 else 'SHOT',
                        'prev_event_id': previous_play.get('eventId'),
                        'time_diff_seconds': time_diff,
                        'period': play.get('periodDescriptor', {}).get('number'),
                        'time': play.get('timeInPeriod'),
                        'prev_time': previous_play.get('timeInPeriod'),
                        'team_id': current_team_id
                    })
    
    previous_play = play

print(f"🔍 Rebound Detection Verification for Game {game_id}")
print("=" * 60)
print(f"Total rebound shots detected: {len(rebound_examples)}")
print()

if rebound_examples:
    print("📊 Rebound Examples:")
    for i, ex in enumerate(rebound_examples[:10], 1):
        print(f"\n{i}. Event {ex['event_id']} ({ex['type']})")
        print(f"   Previous: Event {ex['prev_event_id']} (shot-on-goal)")
        print(f"   Time difference: {ex['time_diff_seconds']:.2f} seconds")
        print(f"   Period {ex['period']}: {ex['prev_time']} → {ex['time']}")
        print(f"   Team ID: {ex['team_id']}")
else:
    print("⚠️  No rebounds detected. This could mean:")
    print("   - No rebound situations occurred in this game")
    print("   - Detection logic needs adjustment")
    print("   - Time threshold (3 seconds) might be too strict")

