# xa_model_trainer.py
# Trains XGBoost model for Expected Assists (xA)

import pandas as pd
import numpy as np
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
import joblib

def create_dummy_xa_data(n_passes=5000):
    """
    Creates synthetic data simulating passes that lead to shots for xA model training.
    
    xA Model Features (from pass perspective):
    - pass_distance_to_net: How close the pass was to the net
    - pass_angle: Angle from net center to pass location
    - time_before_shot: Time between pass and shot (shorter = higher xA)
    - pass_lateral_distance: How far across ice the pass traveled
    - is_power_play: Whether pass occurred during power play
    """
    np.random.seed(42)
    
    # FEATURES (X): The inputs the model uses to predict if pass leads to goal
    # Pass distance to net: Closer passes (10-80 ft) are more likely to lead to goals
    pass_distance_to_net = np.random.uniform(low=10, high=80, size=n_passes)
    
    # Pass angle: Lower angles (closer to center) are better
    pass_angle = np.random.uniform(low=5, high=70, size=n_passes)
    
    # Time before shot: Shorter time = higher xA (one-timers are more dangerous)
    # Most passes are within 1-3 seconds
    time_before_shot = np.random.uniform(low=0.5, high=3.0, size=n_passes)
    
    # Pass lateral distance: Cross-ice passes (higher) are more dangerous
    pass_lateral_distance = np.random.uniform(low=0, high=50, size=n_passes)
    
    # Power play: Passes during power plays are more likely to lead to goals
    is_power_play = np.random.choice([0, 1], size=n_passes, p=[0.75, 0.25])
    
    # TARGET (y): The actual outcome (Goal=1, No Goal=0)
    # Goal probability is based on pass features
    # Key insight: Passes close to net, with short time before shot, are very dangerous
    base_prob = (
        (90 - pass_distance_to_net) / 100 +           # Distance factor (closer = better)
        (pass_angle / 150) +                           # Angle factor (lower = better)
        (3.0 - time_before_shot) / 10 +                # Time factor (shorter = better, inverted)
        (pass_lateral_distance / 200) +                 # Lateral distance (cross-ice = better)
        (is_power_play * 0.10) +                       # Power play bonus
        (np.random.normal(0, 0.05, n_passes))          # Random noise
    )
    
    # Clip probabilities to valid range [0, 1]
    base_prob = np.clip(base_prob, 0, 1)
    
    # Generate the binary outcome based on the probability
    is_goal = np.random.rand(n_passes) < base_prob
    
    df = pd.DataFrame({
        'pass_distance_to_net': pass_distance_to_net,
        'pass_angle': pass_angle,
        'time_before_shot': time_before_shot,
        'pass_lateral_distance': pass_lateral_distance,
        'is_power_play': is_power_play,
        'is_goal': is_goal.astype(int)  # 0 or 1
    })
    return df

# --- TRAINING AND SAVING THE MODEL ---

# 1. Load Data
print("Generating synthetic training data for Expected Assists (xA)...")
df_passes = create_dummy_xa_data(n_passes=5000)
print(f"Generated {len(df_passes)} pass records")

# 2. Define Features (X) and Target (y)
XA_MODEL_FEATURES = ['pass_distance_to_net', 'pass_angle', 'time_before_shot', 
                     'pass_lateral_distance', 'is_power_play']
X = df_passes[XA_MODEL_FEATURES]
y = df_passes['is_goal']

print(f"Features: {XA_MODEL_FEATURES}")
print(f"Target distribution: {y.value_counts().to_dict()}")

# 3. Train Model (Using XGBoost for state-of-the-art accuracy)
print("\nTraining XGBoost Classifier for Expected Assists...")
xa_model = XGBClassifier(
    use_label_encoder=False,
    eval_metric='logloss',
    random_state=42,
    n_estimators=100,
    max_depth=6,
    learning_rate=0.1
)
xa_model.fit(X, y)
print("Training Complete.")

# Print feature importance
print("\nFeature Importance:")
feature_importance = pd.DataFrame({
    'feature': XA_MODEL_FEATURES,
    'importance': xa_model.feature_importances_
}).sort_values('importance', ascending=False)
print(feature_importance.to_string(index=False))

# 4. Save the Model and Feature List
model_filename = 'xa_model.joblib'
joblib.dump(xa_model, model_filename)
print(f"\nModel successfully saved as {model_filename}")

# Save the feature list for reference
features_filename = 'xa_model_features.joblib'
joblib.dump(XA_MODEL_FEATURES, features_filename)
print(f"Feature list saved as {features_filename}")
print(f"\n✅ xA model training complete! Ready for deployment.")

