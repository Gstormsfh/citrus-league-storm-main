# check_xg_values.py
# Check if individual xG predictions are too high

import requests
import math
import joblib
import pandas as pd
import numpy as np

NHL_BASE_URL = "https://api-web.nhle.com/v1"
NET_X, NET_Y = 89, 0

# Load model
XG_MODEL = joblib.load('xg_model.joblib')
MODEL_FEATURES = joblib.load('model_features.joblib')
SHOT_TYPE_ENCODER = joblib.load('shot_type_encoder.joblib')

# Get one game and calculate xG for the problematic player
game_id = '2025020453'
player_id = 8478439

pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
response = requests.get(pbp_url)
raw_data = response.json()

# Extract shots for this player
player_shots = []
previous_play = None

for play in raw_data.get('plays', []):
    type_code = play.get('typeCode')
    if type_code not in [505, 506, 507]:
        continue
    
    details = play.get('details', {})
    if not details:
        continue
    
    # Check if this is our player
    if type_code == 505:
        if details.get('scoringPlayerId') != player_id:
            previous_play = play
            continue
        player_id_check = details.get('scoringPlayerId')
    else:
        if details.get('shootingPlayerId') != player_id:
            previous_play = play
            continue
        player_id_check = details.get('shootingPlayerId')
    
    # Calculate features (simplified version)
    shot_coord_x = details.get('xCoord', 0)
    shot_coord_y = details.get('yCoord', 0)
    
    if shot_coord_x < 0:
        shot_coord_x = -shot_coord_x
        shot_coord_y = -shot_coord_y
    
    distance = math.sqrt((NET_X - shot_coord_x)**2 + (NET_Y - shot_coord_y)**2)
    
    # Fixed angle calculation (same as data_acquisition.py)
    dx = abs(NET_X - shot_coord_x)  # Horizontal distance from net
    dy = abs(shot_coord_y - NET_Y)  # Vertical distance from center
    
    if dx == 0:
        angle = 90.0  # Directly to the side
    else:
        # Calculate angle from center line (0° = straight on, 90° = from side)
        angle = math.degrees(math.atan2(dy, dx))
    
    # Ensure angle is in valid range (0-90 degrees)
    angle = max(0.0, min(90.0, angle))
    is_rebound = 0
    
    # Rebound check
    if previous_play:
        prev_type_code = previous_play.get('typeCode')
        prev_details = previous_play.get('details', {})
        if prev_type_code == 506:
            prev_team = prev_details.get('eventOwnerTeamId')
            curr_team = details.get('eventOwnerTeamId')
            if prev_team == curr_team:
                # Time calc (simplified)
                is_rebound = 1  # Assume rebound for now
    
    # Shot type
    shot_type_raw = details.get('shotType', '').lower() if details.get('shotType') else ''
    shot_type_mapping = {'wrist': 'wrist', 'snap': 'snap', 'slap': 'slap', 'backhand': 'backhand', 
                        'tip-in': 'tip-in', 'tip': 'tip-in', 'deflected': 'deflected', 
                        'deflection': 'deflected', 'wrap-around': 'wrap-around', 'wrap': 'wrap-around',
                        'between-legs': 'between-legs', 'bat': 'bat', 'poke': 'poke'}
    shot_type_standard = shot_type_mapping.get(shot_type_raw, 'wrist')
    if shot_type_standard in SHOT_TYPE_ENCODER.classes_:
        shot_type_encoded = SHOT_TYPE_ENCODER.transform([shot_type_standard])[0]
    else:
        shot_type_encoded = 0
    
    # Power play
    situation_code = str(play.get('situationCode', ''))
    is_power_play = 1 if any(pp in situation_code for pp in ['5v4', '5v3', '4v3', '6v4', '6v3']) else 0
    
    # Score differential
    away_score = details.get('awayScore', 0) or 0
    home_score = details.get('homeScore', 0) or 0
    event_owner_team_id = details.get('eventOwnerTeamId')
    home_team_id = raw_data.get('homeTeam', {}).get('id')
    if event_owner_team_id == home_team_id:
        score_differential = home_score - away_score
    else:
        score_differential = away_score - home_score
    
    # Predict xG
    features = pd.DataFrame([{
        'distance': distance,
        'angle': angle,
        'is_rebound': is_rebound,
        'shot_type_encoded': shot_type_encoded,
        'is_power_play': is_power_play,
        'score_differential': score_differential
    }])
    
    # Get raw prediction
    raw_xg = XG_MODEL.predict_proba(features[MODEL_FEATURES])[:, 1][0]
    
    # Apply calibration (same as in data_acquisition.py)
    CALIBRATION_FACTOR = 2.5
    xg_value = min(0.50, raw_xg ** CALIBRATION_FACTOR)  # Cap at 0.50
    
    player_shots.append({
        'event_id': play.get('eventId'),
        'type': 'GOAL' if type_code == 505 else 'SHOT',
        'distance': distance,
        'angle': angle,
        'xg': xg_value
    })
    
    previous_play = play

print(f"🔍 xG Analysis for Player {player_id} in Game {game_id}")
print("=" * 70)
print(f"Total shots: {len(player_shots)}")
print()

total_xg = 0
for i, shot in enumerate(player_shots, 1):
    print(f"{i}. Event {shot['event_id']} ({shot['type']}):")
    print(f"   Distance: {shot['distance']:.1f} ft, Angle: {shot['angle']:.1f}°, xG: {shot['xg']:.3f}")
    total_xg += shot['xg']

print()
print(f"Total xG: {total_xg:.2f}")
print(f"Database shows: 8.62")
print(f"Difference: {8.62 - total_xg:.2f}")

if total_xg < 8.62:
    print(f"\n⚠️  Database value is {8.62 / total_xg:.1f}x higher than calculated!")
    print("   Possible causes:")
    print("   1. Script was run multiple times and data was duplicated")
    print("   2. Aggregation is summing across multiple games")
    print("   3. Database has old/corrupted data")

