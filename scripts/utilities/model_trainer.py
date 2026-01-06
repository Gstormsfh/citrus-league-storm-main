# model_trainer.py

import pandas as pd
import numpy as np
import math
from xgboost import XGBClassifier  # Upgraded to XGBoost for better accuracy
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import joblib # The preferred tool for saving models

def create_dummy_xg_data(n_shots=1000):
    """Creates synthetic data simulating hockey shots for model training."""
    np.random.seed(42)
    
    # 1. FEATURES (X): The inputs the model uses to predict a goal
    # Distance: Closer shots (10-80 ft) are more likely to be goals
    distance = np.random.uniform(low=10, high=80, size=n_shots)
    # Angle: Higher angles (closer to center) are better
    angle = np.random.uniform(low=5, high=70, size=n_shots)
    # Rebound: Binary feature (1=rebound, more likely to be a goal)
    is_rebound = np.random.choice([0, 1], size=n_shots, p=[0.9, 0.1])
    
    # Calculate shot coordinates from distance and angle for slot detection
    # NET_X = 89, NET_Y = 0 (NHL coordinate system)
    # x_coord = NET_X - distance * cos(angle)
    # y_coord = distance * sin(angle) (can be positive or negative)
    x_coord = 89 - distance * np.cos(np.radians(angle))
    y_coord = distance * np.sin(np.radians(angle)) * np.random.choice([-1, 1], size=n_shots)  # Random side
    
    # NEW: High-Danger Zone Score (The Slot) - SCALED 0-1
    # Define slot as: distance < 25 feet AND |y| < 15 feet (within 15 feet laterally)
    # Score scales from 1.0 (very close to net) to 0.0 (edge of slot or outside)
    # Formula: 
    #   - Distance component: max(0, 1 - (distance / 25)) - closer = higher
    #   - Lateral component: max(0, 1 - (|y| / 15)) - more centered = higher
    #   - Combined: average of both components, only for shots in slot
    slot_mask = (distance < 25) & (np.abs(y_coord) < 15)
    distance_component = np.maximum(0.0, 1.0 - (distance / 25.0))  # 1.0 at net, 0.0 at 25ft
    lateral_component = np.maximum(0.0, 1.0 - (np.abs(y_coord) / 15.0))  # 1.0 at center, 0.0 at 15ft
    # Weighted average: distance matters more (60%) than lateral position (40%)
    is_slot_shot = np.where(
        slot_mask,
        (distance_component * 0.6 + lateral_component * 0.4),  # Scaled 0-1 within slot
        0.0  # Outside slot = 0
    )
    
    # NEW FEATURES:
    # Shot type: Categorical feature (wrist, snap, slap, backhand, tip-in, etc.)
    shot_types = ['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around']
    shot_type = np.random.choice(shot_types, size=n_shots, p=[0.35, 0.25, 0.15, 0.10, 0.08, 0.05, 0.02])
    
    # Power play: Binary feature (1=power play, 0=even strength or shorthanded)
    # Power plays increase goal probability
    is_power_play = np.random.choice([0, 1], size=n_shots, p=[0.75, 0.25])
    
    # Score differential: Range from -5 to +5 (negative = trailing, positive = leading)
    # Teams trailing are more aggressive, teams leading may be more conservative
    score_differential = np.random.choice(range(-5, 6), size=n_shots)
    
    # PASS FEATURES (NEW):
    # has_pass_before_shot: Binary feature (1=pass before shot, 0=no pass)
    # ~30% of shots have a pass before them (one-timers, backdoor passes)
    has_pass_before_shot = np.random.choice([0, 1], size=n_shots, p=[0.70, 0.30])
    
    # pass_lateral_distance: How far across the ice the pass traveled (0-50 feet)
    # Only meaningful when has_pass_before_shot = 1
    pass_lateral_distance = np.where(
        has_pass_before_shot == 1,
        np.random.uniform(low=0, high=50, size=n_shots),  # Pass exists: 0-50 ft lateral
        0.0  # No pass: 0 ft
    )
    
    # pass_to_net_distance: How close the pass was to the net (10-60 feet)
    # Only meaningful when has_pass_before_shot = 1
    # Lower values = passes closer to net = more dangerous
    pass_to_net_distance = np.where(
        has_pass_before_shot == 1,
        np.random.uniform(low=10, high=60, size=n_shots),  # Pass exists: 10-60 ft from net
        0.0  # No pass: 0 ft
    )
    
    # NEW PASS CONTEXT FEATURES:
    # pass_zone: Zone classification based on pass location
    # Zones: 'crease', 'slot_low_angle', 'slot_high_angle', 'high_slot_low_angle', 
    #        'high_slot_high_angle', 'blue_line_low_angle', 'blue_line_high_angle', 'deep', 'no_pass'
    pass_zones = ['crease', 'slot_low_angle', 'slot_high_angle', 'high_slot_low_angle', 
                  'high_slot_high_angle', 'blue_line_low_angle', 'blue_line_high_angle', 'deep', 'no_pass']
    # When pass exists, assign zones based on pass_to_net_distance (closer = better zones)
    pass_zone = np.where(
        has_pass_before_shot == 1,
        np.random.choice(['crease', 'slot_low_angle', 'slot_high_angle', 'high_slot_low_angle', 
                         'high_slot_high_angle', 'blue_line_low_angle', 'blue_line_high_angle', 'deep'],
                        size=n_shots,
                        p=[0.15, 0.20, 0.15, 0.15, 0.10, 0.10, 0.10, 0.05]),  # Better zones more common
        'no_pass'  # No pass: default zone
    )
    
    # time_before_shot: Time between pass and shot (0-3 seconds)
    # Only meaningful when has_pass_before_shot = 1
    time_before_shot = np.where(
        has_pass_before_shot == 1,
        np.random.uniform(low=0.1, high=3.0, size=n_shots),  # Pass exists: 0.1-3.0 seconds
        0.0  # No pass: 0 seconds
    )
    
    # pass_immediacy_score: How immediate the shot is (0-1)
    # Formula: max(0, 1 - (time_before_shot / 3.0))
    pass_immediacy_score = np.where(
        has_pass_before_shot == 1,
        np.maximum(0.0, 1.0 - (time_before_shot / 3.0)),  # Shorter time = higher score
        0.0  # No pass: 0 score
    )
    
    # goalie_movement_score: Goalie movement required (0-1)
    # Formula: (pass_lateral_distance / 50.0) * pass_immediacy_score
    goalie_movement_score = np.where(
        has_pass_before_shot == 1,
        np.minimum(1.0, (pass_lateral_distance / 50.0) * pass_immediacy_score),  # Cross-ice + immediate = high
        0.0  # No pass: 0 score
    )
    
    # pass_quality_score: Composite pass quality (0-1)
    # Weighted combination of zone, immediacy, movement, and distance
    zone_weights = {
        'crease': 1.0,
        'slot_low_angle': 0.9,
        'slot_high_angle': 0.7,
        'high_slot_low_angle': 0.6,
        'high_slot_high_angle': 0.5,
        'blue_line_low_angle': 0.4,
        'blue_line_high_angle': 0.3,
        'deep': 0.2,
        'no_pass': 0.0
    }
    zone_weight_array = np.array([zone_weights.get(zone, 0.0) for zone in pass_zone])
    distance_component = np.where(
        pass_to_net_distance > 0,
        np.maximum(0.0, 1.0 - (pass_to_net_distance / 100.0)),  # Closer = higher
        0.0
    )
    pass_quality_score = np.where(
        has_pass_before_shot == 1,
        (zone_weight_array * 0.4 + 
         pass_immediacy_score * 0.3 + 
         goalie_movement_score * 0.2 + 
         distance_component * 0.1),
        0.0  # No pass: 0 score
    )
    pass_quality_score = np.clip(pass_quality_score, 0.0, 1.0)  # Ensure 0-1 range
    
    # 2. TARGET (y): The actual outcome (Goal=1, No Goal=0)
    # Goal probability is based on all features
    # This is a highly simplified proxy for the real complex probability
    base_prob = (
        (90 - distance) / 100 +           # Distance factor (33.2% importance)
        (90 - angle) / 150 +              # Angle factor: penalize high angles more aggressively
        (is_rebound * 0.15) +              # Rebound bonus (17.4% importance)
        (is_power_play * 0.10) +           # Power play bonus (16.7% importance)
        (np.abs(score_differential) * 0.02) +  # Trailing/leading teams more aggressive
        # NEW: Slot/Crease Boost (Directly targets the undervalued area)
        # Scaled boost: shots very close to net in slot get full 5% boost, edge shots get less
        (is_slot_shot * 0.05) +           # Scaled 0-5% bonus based on slot position
        # PASS FEATURE MODIFIERS (EXISTING):
        (has_pass_before_shot * 0.12) +   # Pass bonus: passes significantly increase goal probability
        # ENHANCED: Lateral distance bonus - stronger multiplier for cross-ice passes
        # This helps boost half-wall shots that receive lateral passes
        (has_pass_before_shot * pass_lateral_distance / 150) +  # Increased from /200 to /150 for stronger boost
        (has_pass_before_shot * (60 - pass_to_net_distance) / 300) +  # Pass-to-net bonus: closer passes more dangerous
        # NEW PASS CONTEXT MODIFIERS:
        (pass_immediacy_score * 0.08) +   # Immediate shots more dangerous
        (goalie_movement_score * 0.06) +  # Goalie movement increases danger
        (pass_quality_score * 0.10) +      # Overall pass quality matters
        (np.random.normal(0, 0.05, n_shots))  # Random noise
    )
    
    # Shot type modifiers (some shot types are more effective)
    shot_type_modifiers = {
        'wrist': 0.02,
        'snap': 0.03,
        'slap': 0.01,
        'backhand': -0.01,
        'tip-in': 0.05,
        'deflected': 0.04,
        'wrap-around': 0.02
    }
    for i, st in enumerate(shot_type):
        base_prob[i] += shot_type_modifiers[st]
    
    # Clip probabilities to valid range [0, 1]
    base_prob = np.clip(base_prob, 0, 1)
    
    # Generate the binary outcome based on the probability
    is_goal = np.random.rand(n_shots) < base_prob
    
    df = pd.DataFrame({
        'distance': distance,
        'angle': angle,
        'is_rebound': is_rebound,
        'shot_type': shot_type,
        'is_power_play': is_power_play,
        'score_differential': score_differential,
        # NEW: High-Danger Zone Flag
        'is_slot_shot': is_slot_shot,
        # EXISTING PASS FEATURES:
        'has_pass_before_shot': has_pass_before_shot,
        'pass_lateral_distance': pass_lateral_distance,
        'pass_to_net_distance': pass_to_net_distance,
        # NEW PASS CONTEXT FEATURES:
        'pass_zone': pass_zone,
        'pass_immediacy_score': pass_immediacy_score,
        'goalie_movement_score': goalie_movement_score,
        'pass_quality_score': pass_quality_score,
        'is_goal': is_goal.astype(int) # 0 or 1
    })
    return df

# --- TRAINING AND SAVING THE MODEL ---

# 1. Load Data
print("Generating synthetic training data...")
df_shots = create_dummy_xg_data(n_shots=5000)  # Increased sample size for XGBoost
print(f"Generated {len(df_shots)} shot records")

# 2. Encode categorical features (shot_type and pass_zone)
print("Encoding categorical features...")
shot_type_encoder = LabelEncoder()
df_shots['shot_type_encoded'] = shot_type_encoder.fit_transform(df_shots['shot_type'])

# Save the shot type encoder for use in prediction
joblib.dump(shot_type_encoder, 'shot_type_encoder.joblib')
print(f"Shot types: {list(shot_type_encoder.classes_)}")

# Encode pass_zone (categorical feature)
pass_zone_encoder = LabelEncoder()
df_shots['pass_zone_encoded'] = pass_zone_encoder.fit_transform(df_shots['pass_zone'])

# Save the pass zone encoder for use in prediction
joblib.dump(pass_zone_encoder, 'pass_zone_encoder.joblib')
print(f"Pass zones: {list(pass_zone_encoder.classes_)}")

# 3. Define Features (X) and Target (y)
# Updated feature list with new pass context features and slot shot flag
MODEL_FEATURES = ['distance', 'angle', 'is_rebound', 'shot_type_encoded', 'is_power_play', 'score_differential',
                 'is_slot_shot',  # NEW: High-danger zone flag
                 'has_pass_before_shot', 'pass_lateral_distance', 'pass_to_net_distance',
                 'pass_zone_encoded', 'pass_immediacy_score', 'goalie_movement_score', 'pass_quality_score']
X = df_shots[MODEL_FEATURES]
y = df_shots['is_goal']

print(f"Features: {MODEL_FEATURES}")
print(f"Target distribution: {y.value_counts().to_dict()}")

# 4. Train Model (Using XGBoost for state-of-the-art accuracy)
print("\nTraining XGBoost Classifier...")
model = XGBClassifier(
    use_label_encoder=False,
    eval_metric='logloss',
    random_state=42,
    n_estimators=100,
    max_depth=6,
    learning_rate=0.1
)
model.fit(X, y)
print("Training Complete.")

# Print feature importance
print("\nFeature Importance:")
feature_importance = pd.DataFrame({
    'feature': MODEL_FEATURES,
    'importance': model.feature_importances_
}).sort_values('importance', ascending=False)
print(feature_importance.to_string(index=False))

# 5. Save the Model and Feature List
# The model will be saved as 'xg_model.joblib' for reuse in the data_acquisition script.
model_filename = 'xg_model.joblib'
joblib.dump(model, model_filename)
print(f"\nModel successfully saved as {model_filename}")

# Save the feature list for reference
features_filename = 'model_features.joblib'
joblib.dump(MODEL_FEATURES, features_filename)
print(f"Feature list saved as {features_filename}")
print(f"\n✅ Model training complete! Ready for deployment.")

