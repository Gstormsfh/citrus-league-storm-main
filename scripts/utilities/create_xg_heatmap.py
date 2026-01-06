"""
Create a showcase-ready heatmap visualization of Expected Goals (xG) across the ice.
This script generates a heatmap showing xG values for shots from different locations.
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.colors import LinearSegmentedColormap
import joblib
import math
import os

# Try to load the model
try:
    XG_MODEL = joblib.load('xg_model_moneypuck.joblib')
    MODEL_FEATURES = joblib.load('model_features_moneypuck.joblib')
    print("✅ Loaded MoneyPuck-aligned xG model")
    USE_MONEYPUCK_MODEL = True
except FileNotFoundError:
    try:
        XG_MODEL = joblib.load('xg_model.joblib')
        MODEL_FEATURES = joblib.load('model_features.joblib')
        print("✅ Loaded standard xG model")
        USE_MONEYPUCK_MODEL = False
    except FileNotFoundError:
        print("❌ ERROR: No xG model found!")
        exit(1)

# Load encoders if they exist
try:
    SHOT_TYPE_ENCODER = joblib.load('shot_type_encoder.joblib')
except FileNotFoundError:
    SHOT_TYPE_ENCODER = None
    print("⚠️  Shot type encoder not found - using default encoding")

try:
    LAST_EVENT_CATEGORY_ENCODER = joblib.load('last_event_category_encoder.joblib')
except FileNotFoundError:
    LAST_EVENT_CATEGORY_ENCODER = None

try:
    PASS_ZONE_ENCODER = joblib.load('pass_zone_encoder.joblib')
except FileNotFoundError:
    PASS_ZONE_ENCODER = None

# Constants
NET_X = 89  # Center of net X coordinate (feet from center ice)
NET_Y = 0   # Center of net Y coordinate (feet from center ice)

def calculate_distance(x, y):
    """Calculate distance from shot location to center of net."""
    return math.sqrt((NET_X - x)**2 + (NET_Y - y)**2)

def calculate_angle(x, y):
    """Calculate angle from center of net to shot location (0-90 degrees)."""
    dx = abs(NET_X - x)
    dy = abs(y - NET_Y)
    if dx == 0:
        angle = 90.0
    else:
        angle = math.degrees(math.atan2(dy, dx))
    return max(0.0, min(90.0, angle))

def create_default_features(x, y, distance, angle):
    """Create default feature values for a shot at given location."""
    # Calculate base features
    features = {}
    
    # Core location features
    features['distance'] = distance
    features['angle'] = angle
    features['distance_angle_interaction'] = (distance * angle) / 100.0
    
    # Default binary features (typical game situation)
    features['is_rebound'] = 0
    features['is_power_play'] = 0
    features['is_empty_net'] = 0
    features['is_slot_shot'] = 1 if distance < 20 and angle < 30 else 0
    features['has_pass_before_shot'] = 0
    
    # Shot type (default to wrist shot - most common)
    if SHOT_TYPE_ENCODER:
        try:
            features['shot_type_encoded'] = SHOT_TYPE_ENCODER.transform(['Wrist Shot'])[0]
        except:
            features['shot_type_encoded'] = 0
    else:
        features['shot_type_encoded'] = 0
    
    # Score differential (default to tied game)
    features['score_differential'] = 0
    
    # Pass features (no pass by default)
    features['pass_lateral_distance'] = 0.0
    features['pass_to_net_distance'] = 0.0
    features['pass_immediacy_score'] = 0.0
    features['goalie_movement_score'] = 0.0
    features['pass_quality_score'] = 0.0
    
    # Pass zone (no pass)
    if PASS_ZONE_ENCODER:
        try:
            features['pass_zone_encoded'] = PASS_ZONE_ENCODER.transform(['None'])[0] if 'None' in PASS_ZONE_ENCODER.classes_ else 0
        except:
            features['pass_zone_encoded'] = 0
    else:
        features['pass_zone_encoded'] = 0
    
    # Last event features (default to no previous event)
    features['speed_from_last_event'] = 0.0
    features['distance_from_last_event'] = 0.0
    features['time_since_last_event'] = 0.0
    
    # Last event category
    if LAST_EVENT_CATEGORY_ENCODER:
        try:
            features['last_event_category_encoded'] = LAST_EVENT_CATEGORY_ENCODER.transform(['None'])[0] if 'None' in LAST_EVENT_CATEGORY_ENCODER.classes_ else 0
        except:
            features['last_event_category_encoded'] = 0
    else:
        features['last_event_category_encoded'] = 0
    
    # East-west location
    features['last_event_x'] = x
    features['last_event_y'] = y
    
    # Add any other features that might be in MODEL_FEATURES
    # Set them to reasonable defaults
    for feature in MODEL_FEATURES:
        if feature not in features:
            # Default numeric features to 0
            if 'encoded' in feature or 'score' in feature or 'distance' in feature or 'angle' in feature:
                features[feature] = 0.0
            elif 'is_' in feature or 'has_' in feature:
                features[feature] = 0
            else:
                features[feature] = 0.0
    
    return features

def predict_xg(x, y):
    """Predict xG for a shot at given coordinates."""
    distance = calculate_distance(x, y)
    angle = calculate_angle(x, y)
    
    # Create features
    features = create_default_features(x, y, distance, angle)
    
    # Create DataFrame with features in correct order
    feature_df = pd.DataFrame([features])
    
    # Ensure all MODEL_FEATURES are present
    for feature in MODEL_FEATURES:
        if feature not in feature_df.columns:
            feature_df[feature] = 0.0
    
    # Select features in correct order
    X_predict = feature_df[MODEL_FEATURES]
    
    # Fill any NaN values
    X_predict = X_predict.fillna(0)
    
    # Predict
    try:
        xg = XG_MODEL.predict_proba(X_predict)[0][1]  # Probability of goal
    except:
        xg = XG_MODEL.predict(X_predict)[0]  # Direct prediction
    
    # Clip to reasonable range
    xg = max(0.0, min(0.6, xg))
    
    return xg

def create_heatmap():
    """Create a heatmap of xG values across the offensive zone."""
    print("🎨 Creating xG Heatmap...")
    
    # Create grid of shot locations
    # X: 0 to 89 feet (from center ice to net)
    # Y: -42 to 42 feet (full width of rink)
    x_range = np.linspace(0, 89, 90)
    y_range = np.linspace(-42, 42, 85)
    
    # Only include locations in offensive zone (x > 25) and reasonable shooting angles
    X_grid, Y_grid = np.meshgrid(x_range, y_range)
    
    # Calculate xG for each point
    print("  Calculating xG for each location...")
    xg_grid = np.zeros_like(X_grid)
    
    for i in range(len(y_range)):
        for j in range(len(x_range)):
            x = X_grid[i, j]
            y = Y_grid[i, j]
            
            # Only calculate for offensive zone
            if x > 25:
                xg_grid[i, j] = predict_xg(x, y)
            else:
                xg_grid[i, j] = np.nan
    
    # Create figure with custom styling
    fig, ax = plt.subplots(figsize=(14, 10))
    
    # Create custom colormap (blue to red, like heat)
    colors = ['#000080', '#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF8000', '#FF0000']
    n_bins = 100
    cmap = LinearSegmentedColormap.from_list('xg_heatmap', colors, N=n_bins)
    
    # Create heatmap
    im = ax.contourf(X_grid, Y_grid, xg_grid, levels=50, cmap=cmap, alpha=0.8)
    
    # Add colorbar
    cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label('Expected Goals (xG)', fontsize=14, fontweight='bold')
    cbar.ax.tick_params(labelsize=12)
    
    # Draw rink outline
    # Goal line
    ax.plot([89, 89], [-42, 42], 'k-', linewidth=3)
    
    # Side boards
    ax.plot([0, 89], [-42, -42], 'k-', linewidth=2)
    ax.plot([0, 89], [42, 42], 'k-', linewidth=2)
    
    # Blue lines (at x = 25 and x = -25, but we only show offensive zone)
    ax.plot([25, 25], [-42, 42], 'b--', linewidth=2, alpha=0.5)
    
    # Goal crease (semi-circle)
    crease_radius = 6
    crease_theta = np.linspace(0, np.pi, 100)
    crease_x = 89 - crease_radius * np.cos(crease_theta)
    crease_y = crease_radius * np.sin(crease_theta)
    ax.plot(crease_x, crease_y, 'r-', linewidth=2)
    
    # Goal posts
    goal_width = 6  # feet
    ax.plot([89, 89], [-goal_width/2, goal_width/2], 'k-', linewidth=4)
    
    # Faceoff circles (simplified)
    circle1 = patches.Circle((69, -22), 15, fill=False, edgecolor='blue', linewidth=1, linestyle='--', alpha=0.3)
    circle2 = patches.Circle((69, 22), 15, fill=False, edgecolor='blue', linewidth=1, linestyle='--', alpha=0.3)
    ax.add_patch(circle1)
    ax.add_patch(circle2)
    
    # Add zone labels
    ax.text(45, 0, 'OFFENSIVE ZONE', fontsize=16, fontweight='bold', 
            ha='center', va='center', rotation=90, color='white', 
            bbox=dict(boxstyle='round', facecolor='black', alpha=0.5))
    
    # Add title and labels
    ax.set_title('Expected Goals (xG) Heatmap\nShot Quality by Location', 
                 fontsize=20, fontweight='bold', pad=20)
    ax.set_xlabel('Distance from Center Ice (feet)', fontsize=14, fontweight='bold')
    ax.set_ylabel('Distance from Center (feet)', fontsize=14, fontweight='bold')
    
    # Set axis limits
    ax.set_xlim(0, 89)
    ax.set_ylim(-42, 42)
    
    # Add grid
    ax.grid(True, alpha=0.3, linestyle='--')
    
    # Add text annotations for key areas
    ax.text(75, 0, 'HIGH xG\n(Slot)', fontsize=12, fontweight='bold', 
            ha='center', va='center', color='white',
            bbox=dict(boxstyle='round', facecolor='red', alpha=0.7))
    ax.text(50, 0, 'MEDIUM xG', fontsize=10, fontweight='bold', 
            ha='center', va='center', color='black',
            bbox=dict(boxstyle='round', facecolor='yellow', alpha=0.7))
    ax.text(35, 0, 'LOW xG\n(Point)', fontsize=10, fontweight='bold', 
            ha='center', va='center', color='white',
            bbox=dict(boxstyle='round', facecolor='blue', alpha=0.7))
    
    # Add model info
    model_type = "MoneyPuck-Aligned" if USE_MONEYPUCK_MODEL else "Standard"
    ax.text(5, -38, f'Model: {model_type} | Features: {len(MODEL_FEATURES)}', 
            fontsize=10, style='italic', color='gray',
            bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))
    
    # Make it look professional
    ax.set_aspect('equal')
    plt.tight_layout()
    
    # Save high-resolution version
    output_file = 'xg_heatmap_showcase.png'
    plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor='white')
    print(f"✅ Heatmap saved to: {output_file}")
    
    # Also create a clean version without text annotations
    fig2, ax2 = plt.subplots(figsize=(14, 10))
    im2 = ax2.contourf(X_grid, Y_grid, xg_grid, levels=50, cmap=cmap, alpha=0.8)
    cbar2 = plt.colorbar(im2, ax=ax2, fraction=0.046, pad=0.04)
    cbar2.set_label('Expected Goals (xG)', fontsize=14, fontweight='bold')
    cbar2.ax.tick_params(labelsize=12)
    
    # Draw rink outline (same as before)
    ax2.plot([89, 89], [-42, 42], 'k-', linewidth=3)
    ax2.plot([0, 89], [-42, -42], 'k-', linewidth=2)
    ax2.plot([0, 89], [42, 42], 'k-', linewidth=2)
    ax2.plot([25, 25], [-42, 42], 'b--', linewidth=2, alpha=0.5)
    crease_x = 89 - crease_radius * np.cos(crease_theta)
    crease_y = crease_radius * np.sin(crease_theta)
    ax2.plot(crease_x, crease_y, 'r-', linewidth=2)
    ax2.plot([89, 89], [-goal_width/2, goal_width/2], 'k-', linewidth=4)
    circle1 = patches.Circle((69, -22), 15, fill=False, edgecolor='blue', linewidth=1, linestyle='--', alpha=0.3)
    circle2 = patches.Circle((69, 22), 15, fill=False, edgecolor='blue', linewidth=1, linestyle='--', alpha=0.3)
    ax2.add_patch(circle1)
    ax2.add_patch(circle2)
    
    ax2.set_title('Expected Goals (xG) Heatmap\nShot Quality by Location', 
                 fontsize=20, fontweight='bold', pad=20)
    ax2.set_xlabel('Distance from Center Ice (feet)', fontsize=14, fontweight='bold')
    ax2.set_ylabel('Distance from Center (feet)', fontsize=14, fontweight='bold')
    ax2.set_xlim(0, 89)
    ax2.set_ylim(-42, 42)
    ax2.grid(True, alpha=0.3, linestyle='--')
    ax2.set_aspect('equal')
    
    output_file_clean = 'xg_heatmap_clean.png'
    plt.savefig(output_file_clean, dpi=300, bbox_inches='tight', facecolor='white')
    print(f"✅ Clean heatmap saved to: {output_file_clean}")
    plt.close(fig2)
    
    plt.show()
    
    # Print some statistics
    valid_xg = xg_grid[~np.isnan(xg_grid)]
    print(f"\n📊 Heatmap Statistics:")
    print(f"   Min xG: {np.min(valid_xg):.4f}")
    print(f"   Max xG: {np.max(valid_xg):.4f}")
    print(f"   Mean xG: {np.mean(valid_xg):.4f}")
    print(f"   Locations with xG > 0.3: {np.sum(valid_xg > 0.3)}")
    print(f"   Locations with xG > 0.2: {np.sum(valid_xg > 0.2)}")

if __name__ == "__main__":
    create_heatmap()

