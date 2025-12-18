# analyze_pass_sequences.py
# Analyze play sequences to understand how to detect passes before shots

import requests
import json

NHL_BASE_URL = "https://api-web.nhle.com/v1"
game_id = '2025020453'
pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"

response = requests.get(pbp_url)
raw_data = response.json()

def parse_time_to_seconds(time_str):
    if not time_str or ':' not in time_str:
        return None
    try:
        parts = time_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])
    except:
        return None

# Find shots that have assists (indicating a pass before the goal)
print("🔍 Analyzing Pass Sequences Before Shots")
print("=" * 70)

# Look for goals with assists (these definitely had passes)
goals_with_assists = []
for play in raw_data.get('plays', []):
    if play.get('typeCode') == 505:  # Goal
        details = play.get('details', {})
        if details.get('assist1PlayerId') or details.get('assist2PlayerId'):
            goals_with_assists.append({
                'event_id': play.get('eventId'),
                'scoring_player': details.get('scoringPlayerId'),
                'assist1': details.get('assist1PlayerId'),
                'assist2': details.get('assist2PlayerId'),
                'shot_x': details.get('xCoord'),
                'shot_y': details.get('yCoord'),
                'time': play.get('timeInPeriod'),
                'period': play.get('periodDescriptor', {}).get('number')
            })

print(f"\nGoals with assists (definite passes): {len(goals_with_assists)}")
for goal in goals_with_assists[:5]:
    print(f"\nGoal Event {goal['event_id']}:")
    print(f"  Scoring: {goal['scoring_player']} at ({goal['shot_x']}, {goal['shot_y']})")
    print(f"  Assist1: {goal['assist1']}")
    if goal['assist2']:
        print(f"  Assist2: {goal['assist2']}")

# Now look for plays right before shots (potential passes)
print("\n" + "=" * 70)
print("Analyzing play sequences before shots...")

shot_sequences = []
previous_plays = []  # Track last few plays

for play in raw_data.get('plays', []):
    type_code = play.get('typeCode')
    details = play.get('details', {})
    
    # If this is a shot, check previous plays
    if type_code in [505, 506, 507]:  # Goal, shot-on-goal, missed-shot
        shot_x = details.get('xCoord', 0)
        shot_y = details.get('yCoord', 0)
        shot_team = details.get('eventOwnerTeamId')
        shot_time = parse_time_to_seconds(play.get('timeInPeriod', ''))
        shot_period = play.get('periodDescriptor', {}).get('number')
        
        # Look back at previous plays by same team
        for prev_play in reversed(previous_plays[-10:]):  # Check last 10 plays
            prev_type = prev_play.get('typeCode')
            prev_details = prev_play.get('details', {})
            prev_team = prev_details.get('eventOwnerTeamId')
            prev_time = parse_time_to_seconds(prev_play.get('timeInPeriod', ''))
            prev_period = prev_play.get('periodDescriptor', {}).get('number')
            
            # Check if same team, same period, within reasonable time
            if (prev_team == shot_team and 
                prev_period == shot_period and 
                prev_time and shot_time and
                0 < (shot_time - prev_time) < 5):  # Within 5 seconds
                
                prev_x = prev_details.get('xCoord', 0)
                prev_y = prev_details.get('yCoord', 0)
                
                if prev_x != 0 and prev_y != 0:  # Has coordinates
                    # Calculate lateral distance (y-axis difference)
                    lateral_distance = abs(shot_y - prev_y)
                    
                    # Calculate distance from pass location to net
                    NET_X, NET_Y = 89, 0
                    if prev_x < 0:
                        prev_x = -prev_x
                        prev_y = -prev_y
                    pass_to_net_distance = ((NET_X - prev_x)**2 + (NET_Y - prev_y)**2)**0.5
                    
                    shot_sequences.append({
                        'shot_event': play.get('eventId'),
                        'prev_event': prev_play.get('eventId'),
                        'prev_type': prev_play.get('typeDescKey', ''),
                        'prev_type_code': prev_type,
                        'time_diff': shot_time - prev_time,
                        'lateral_distance': lateral_distance,
                        'pass_to_net_distance': pass_to_net_distance,
                        'shot_x': shot_x,
                        'shot_y': shot_y,
                        'pass_x': prev_x,
                        'pass_y': prev_y
                    })
                    break  # Only use closest previous play
        
        # Add this shot to previous plays
        previous_plays.append(play)
    else:
        # Add non-shot plays to tracking
        previous_plays.append(play)
        if len(previous_plays) > 20:  # Keep last 20 plays
            previous_plays.pop(0)

print(f"\nFound {len(shot_sequences)} shot sequences with previous plays")
print("\nSample sequences (shots with potential passes):")
for seq in shot_sequences[:10]:
    print(f"\nShot Event {seq['shot_event']}:")
    print(f"  Previous: Event {seq['prev_event']} ({seq['prev_type']}, typeCode {seq['prev_type_code']})")
    print(f"  Time diff: {seq['time_diff']} seconds")
    print(f"  Lateral distance: {seq['lateral_distance']:.1f} ft")
    print(f"  Pass location to net: {seq['pass_to_net_distance']:.1f} ft")
    print(f"  Pass location: ({seq['pass_x']}, {seq['pass_y']})")
    print(f"  Shot location: ({seq['shot_x']}, {seq['shot_y']})")

# Statistics
if shot_sequences:
    avg_lateral = sum(s['lateral_distance'] for s in shot_sequences) / len(shot_sequences)
    avg_pass_dist = sum(s['pass_to_net_distance'] for s in shot_sequences) / len(shot_sequences)
    print(f"\n📊 Statistics:")
    print(f"  Average lateral distance: {avg_lateral:.1f} ft")
    print(f"  Average pass-to-net distance: {avg_pass_dist:.1f} ft")
    print(f"  Sequences within 2 seconds: {sum(1 for s in shot_sequences if s['time_diff'] < 2)}")
    print(f"  Sequences within 3 seconds: {sum(1 for s in shot_sequences if s['time_diff'] < 3)}")

