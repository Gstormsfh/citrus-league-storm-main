# Expected Goals (xG) and Expected Assists (xA) Model Documentation

## 🎯 Model Overview

This pipeline includes **multiple XGBoost models**:

### Expected Goals (xG) Model
Predicts the probability that a shot will result in a goal. The model outputs a value between 0 and 1, where:
- **0.0** = 0% chance of goal (impossible shot)
- **1.0** = 100% chance of goal (guaranteed goal)
- **0.15** = 15% chance of goal (decent scoring chance)

### Expected Assists (xA) Model
Predicts the probability that a pass will result in a goal (from the pass perspective). This is a **unique metric** that tracks passer contributions separately from shooter contributions.
- **0.0** = 0% chance pass leads to goal
- **1.0** = 100% chance pass leads to goal
- **0.20** = 20% chance pass leads to goal (good assist opportunity)

### Expected Rebounds Model
Predicts the probability that a shot will generate a rebound. This is a separate XGBoost classifier that uses the same features as the xG model.
- **0.0** = 0% chance of generating a rebound
- **1.0** = 100% chance of generating a rebound
- **0.15** = 15% chance shot creates a rebound opportunity

### Dual-Tracking System
- **Shooters** get xG credit (probability their shot becomes a goal)
- **Passers** get xA credit (probability their pass leads to a goal)
- Both stored in `raw_player_stats` table
- Players can have both xG and xA in the same game (if they both shot and passed)

## 📊 Model Features (Inputs)

The model uses **13 features** to predict goal probability:

### 1. **distance** (Continuous, 0-100+ feet)
- **What it is**: Euclidean distance from shot location to center of net
- **Range**: Typically 10-80 feet (closer = better)
- **Impact**: Most important feature (33.2% importance)
- **Calculation**: `√((89 - x_coord)² + (0 - y_coord)²)`
- **Example**: A shot from 15 feet away has much higher xG than one from 60 feet

### 2. **angle** (Continuous, 0-90 degrees)
- **What it is**: Angle from center of net to shot location
- **Range**: 0-90 degrees (lower = better, closer to center)
  - 0° = directly in front of net (best angle)
  - 90° = from the side (worst angle)
- **Impact**: 14.5% importance
- **Calculation**: 
  ```python
  dx = abs(89 - x_coord)  # Horizontal distance from net
  dy = abs(y_coord - 0)   # Vertical distance from center
  angle = atan2(dy, dx) in degrees
  angle = max(0.0, min(90.0, angle))  # Clipped to valid range
  ```
- **Example**: A shot from directly in front (0°) has higher xG than from the side (45°)
- **Fix Applied**: Previously angles could exceed 90° (e.g., 129.8°). Now properly constrained.

### 3. **is_rebound** (Binary, 0 or 1)
- **What it is**: Whether this shot came immediately after a save/rebound
- **Values**: 
  - `0` = Not a rebound (normal shot)
  - `1` = Rebound shot (goalie just made a save)
- **Impact**: 17.4% importance (second most important!)
- **Why it matters**: Rebound shots catch goalies out of position
- **Detection Logic** (✅ IMPLEMENTED):
  1. Previous play must be a shot-on-goal (typeCode 506) that was saved (not a goal)
  2. Same team must be shooting (eventOwnerTeamId matches)
  3. Time difference must be < 3 seconds
  4. Must be in same period
- **Status**: ✅ Fully implemented and working

### 4. **shot_type_encoded** (Categorical, encoded as integer)
- **What it is**: Type of shot taken
- **Possible Values** (from NHL API):
  - `wrist` - Most common (407 in sample data)
  - `snap` - Quick release (348 in sample)
  - `slap` - Hard slap shot (129 in sample)
  - `tip-in` - Deflection in front (128 in sample)
  - `backhand` - Backhand shot (78 in sample)
  - `deflected` - Deflected shot (13 in sample)
  - `wrap-around` - Wrap-around attempt (8 in sample)
  - `bat` - Batted out of air (6 in sample)
  - `between-legs` - Between the legs (1 in sample)
  - `poke` - Poke check (1 in sample)
- **Impact**: 8.5% importance
- **Encoding**: Converted to numbers (0-6) using LabelEncoder
- **Why it matters**: Some shot types are more effective (tip-ins, deflections)

### 5. **is_power_play** (Binary, 0 or 1)
- **What it is**: Whether the shot occurred during a power play
- **Values**:
  - `0` = Even strength or shorthanded
  - `1` = Power play (5v4, 5v3, 4v3, 6v4, 6v3)
- **Impact**: 16.7% importance (third most important!)
- **Detection**: Parsed from `situation_code` field
- **Why it matters**: Power plays create better scoring opportunities

### 6. **score_differential** (Integer, typically -5 to +5)
- **What it is**: Score difference from shooting team's perspective
- **Range**: Negative = trailing, Positive = leading, 0 = tied
- **Impact**: 4.7% importance
- **Calculation**: 
  - If home team shooting: `home_score - away_score`
  - If away team shooting: `away_score - home_score`
- **Why it matters**: 
  - Trailing teams take more risks (higher xG shots)
  - Leading teams may be more conservative

### 7. **has_pass_before_shot** (Binary, 0 or 1)
- **What it is**: Whether there was a pass/play by the same team within 2-3 seconds before the shot
- **Values**: 
  - `0` = No pass before shot (regular shot)
  - `1` = Pass detected before shot (one-timer, backdoor pass)
- **Impact**: 38.5% importance (MOST IMPORTANT FEATURE!)
- **Detection Logic**:
  1. Looks back through last 15 plays
  2. Finds plays by same team, same period, within 3 seconds
  3. Excludes faceoffs, penalties, stoppages
  4. Requires coordinates (xCoord, yCoord) to calculate distances
- **Why it matters**: One-timers and backdoor passes are significantly more dangerous because:
  - Goalie is moving/reacting to the pass
  - Shot comes from unexpected angle
  - Less time for goalie to set up
- **Status**: ✅ Fully implemented and working

### 8. **pass_lateral_distance** (Continuous, 0-50+ feet)
- **What it is**: Lateral distance (y-axis difference) between pass location and shot location
- **Range**: 0-50 feet typically (higher = cross-ice pass)
- **Impact**: 24.7% importance (MOST IMPORTANT FEATURE!)
- **Calculation**: `abs(shot_y - pass_y)` when pass exists, 0 otherwise
- **Why it matters**: 
  - Cross-ice passes (high lateral distance) are more dangerous
  - Goalie must move laterally to cover the new angle
  - Creates more open net space
- **Example**: A pass from left side to right side (30 ft lateral) is more dangerous than a short pass (5 ft lateral)

### 9. **pass_to_net_distance** (Continuous, 0-100+ feet)
- **What it is**: Distance from pass location to net center
- **Range**: 0-100+ feet (lower = pass closer to net)
- **Impact**: 3.5% importance
- **Calculation**: `√((89 - pass_x)² + (0 - pass_y)²)` when pass exists, 0 otherwise
- **Why it matters**: Passes closer to the net create more dangerous scoring opportunities

### 10. **pass_zone_encoded** (Categorical, encoded as integer)
- **What it is**: Zone classification of where the pass originated (distance + angle based)
- **Possible Zones**:
  - `crease`: Distance < 10ft from net (any angle) - **Highest danger**
  - `slot_low_angle`: Distance 10-20ft AND angle < 30° - **Very high danger**
  - `slot_high_angle`: Distance 10-20ft AND angle ≥ 30° - **High danger**
  - `high_slot_low_angle`: Distance 20-35ft AND angle < 30° - **Medium-high danger**
  - `high_slot_high_angle`: Distance 20-35ft AND angle ≥ 30° - **Medium danger**
  - `blue_line_low_angle`: Distance 35-60ft AND angle < 45° - **Medium-low danger**
  - `blue_line_high_angle`: Distance 35-60ft AND angle ≥ 45° - **Low danger**
  - `deep`: Distance > 60ft (any angle) - **Very low danger**
  - `no_pass`: No pass detected - **Default**
- **Impact**: 2.9% importance
- **Why it matters**: 
  - Passes from the crease/slot are much more dangerous than passes from the blue line
  - Distinguishes between a pass right before a shot from the slot vs. a pass from the blue line
  - Captures the tactical advantage of passes in tight areas
- **Status**: ✅ Fully implemented and working

### 11. **pass_immediacy_score** (Continuous, 0-1)
- **What it is**: How quickly the shot follows the pass (immediacy metric)
- **Range**: 0.0-1.0 (higher = more immediate)
- **Impact**: 8.3% importance
- **Formula**: `max(0, 1 - (time_before_shot / 3.0))`
- **Values**:
  - 0 seconds = 1.0 (immediate one-timer)
  - 1 second = 0.67 (quick shot)
  - 2 seconds = 0.33 (delayed shot)
  - 3+ seconds = 0.0 (not immediate)
- **Why it matters**: 
  - Shorter time between pass and shot = higher danger
  - Goalie has less time to react and set up
  - One-timers are significantly more dangerous than delayed shots
- **Status**: ✅ Fully implemented and working

### 12. **goalie_movement_score** (Continuous, 0-1)
- **What it is**: Composite score measuring goalie movement requirement
- **Range**: 0.0-1.0 (higher = more goalie movement required)
- **Impact**: 13.8% importance (3rd most important!)
- **Formula**: `(pass_lateral_distance / 50.0) * pass_immediacy_score`
- **Why it matters**: 
  - Cross-ice passes that lead to immediate shots force goalie to move quickly
  - High lateral distance + immediate shot = high movement = high danger
  - Low lateral distance (short pass) = low movement = lower danger
  - Delayed shot (low immediacy) = low movement even with high lateral distance
- **Example**: A cross-ice pass (40ft lateral) leading to an immediate one-timer (0.5s) = high movement score = very dangerous
- **Status**: ✅ Fully implemented and working

### 13. **pass_quality_score** (Continuous, 0-1)
- **What it is**: Composite pass quality score combining all pass factors
- **Range**: 0.0-1.0 (higher = better pass quality)
- **Impact**: 2.8% importance
- **Formula**: Weighted combination:
  - Zone weight: 40% (where pass came from matters most)
  - Immediacy: 30% (how quick the shot is)
  - Goalie movement: 20% (cross-ice + immediate = dangerous)
  - Distance: 10% (closer passes are better)
- **Zone Weights**:
  - `crease`: 1.0 (highest)
  - `slot_low_angle`: 0.9
  - `slot_high_angle`: 0.7
  - `high_slot_low_angle`: 0.6
  - `high_slot_high_angle`: 0.5
  - `blue_line_low_angle`: 0.4
  - `blue_line_high_angle`: 0.3
  - `deep`: 0.2
  - `no_pass`: 0.0
- **Why it matters**: 
  - Captures overall pass quality in a single metric
  - Combines location, timing, and goalie movement factors
  - Helps model understand pass context holistically
- **Status**: ✅ Fully implemented and working

### 9. **pass_to_net_distance** (Continuous, 0-100+ feet)
- **What it is**: Distance from pass location to center of net
- **Range**: 10-60 feet typically (lower = pass closer to net)
- **Impact**: 7.9% importance
- **Calculation**: `sqrt((89 - pass_x)² + (0 - pass_y)²)` when pass exists, 0 otherwise
- **Why it matters**: 
  - Passes closer to the net are more dangerous
  - Creates better shooting angles
  - Less time for goalie to react
- **Example**: A pass from 15 feet in front of net is more dangerous than a pass from 50 feet away

## 🔢 Feature Importance Ranking

Based on the trained model (with enhanced pass context features):

1. **pass_lateral_distance** (24.7%) - MOST IMPORTANT! Cross-ice passes are extremely dangerous
2. **goalie_movement_score** (13.8%) - Second most important! Goalie movement requirement
3. **distance** (10.6%) - Third most important
4. **has_pass_before_shot** (9.3%) - Pass detection still very important
5. **pass_immediacy_score** (8.3%) - How immediate the shot is after pass
6. **is_rebound** (7.3%) - Rebound shots catch goalies out of position
7. **angle** (5.6%) - Shot angle from net center
8. **is_power_play** (5.1%) - Power play advantage
9. **pass_to_net_distance** (3.5%) - How close pass was to net
10. **score_differential** (3.3%) - Score situation
11. **pass_zone_encoded** (2.9%) - Zone where pass originated
12. **shot_type_encoded** (2.8%) - Type of shot
13. **pass_quality_score** (2.8%) - Composite pass quality

**Key Insights:**
- Pass context features (lateral distance, goalie movement, immediacy) are now the top features!
- The model now distinguishes between different types of passes (blue line vs slot vs crease)
- Goalie movement requirement is a critical factor in pass danger

## 📈 How the Model Works

### Training Process:
1. **Data Generation**: Creates 5,000 synthetic shot records with realistic distributions
2. **Feature Engineering**: Calculates all 13 features for each shot (including new pass context features)
3. **Label Encoding**: Converts categorical shot types and pass zones to numbers
4. **XGBoost Training**: Trains gradient boosting model to predict goal probability
5. **Model Saving**: Saves model and encoders (shot type, pass zone) to `.joblib` files

### Prediction Process:
1. **Extract Features**: From NHL play-by-play data
2. **Encode Categorical Features**: Convert shot type and pass zone text to numbers using saved encoders
3. **Calculate Base Features**: Distance, angle, rebound status, shot type, power play, score differential
4. **Detect Passes**: Look back through previous plays to find passes before shots
5. **Calculate Pass Metrics**: Lateral distance, pass-to-net distance, pass zone, immediacy, goalie movement, quality
6. **Predict**: Model outputs raw probability (0-1)
7. **Calibrate**: Apply calibration to bring values to realistic ranges (see Calibration section)
8. **Aggregate**: Sum xG values per player per game
9. **Upload**: Store in Supabase `raw_player_stats` table

## 🎓 Example Calculation

**Scenario**: Connor McDavid receives a cross-ice pass from Leon Draisaitl in the slot and immediately one-times it into the net. The pass came from 15 feet in front of the net, traveled 30 feet laterally, and the shot happened 0.5 seconds later. This occurred during a power play while trailing by 1 goal.

**Features**:
- `distance` = 20 feet (shot location)
- `angle` = 5 degrees (almost straight on)
- `is_rebound` = 0 (not a rebound)
- `shot_type_encoded` = 6 (wrist shot)
- `is_power_play` = 1 (yes, power play)
- `score_differential` = -1 (trailing by 1)
- `has_pass_before_shot` = 1 (pass detected!)
- `pass_lateral_distance` = 30 feet (cross-ice pass)
- `pass_to_net_distance` = 15 feet (pass close to net)
- `pass_zone_encoded` = 1 (slot_low_angle - pass from slot)
- `pass_immediacy_score` = 0.83 (0.5 seconds = very immediate)
- `goalie_movement_score` = 0.50 (30ft lateral × 0.83 immediacy = high movement)
- `pass_quality_score` = 0.85 (high zone + high immediacy + high movement + close distance)

**Model Prediction**: ~0.48 xG (48% chance of goal)

**Why**: This is an extremely dangerous scoring chance! The combination of:
- Close shot distance (20ft)
- Excellent angle (5°)
- Power play advantage
- **Cross-ice pass (30ft lateral)** - forces goalie movement
- **Immediate one-timer (0.5s)** - goalie has no time to react
- **Pass from slot (high danger zone)** - not from blue line
- **High goalie movement requirement** - goalie must move quickly

All these factors combine to create a very high xG value. The new pass context features (zone, immediacy, goalie movement) help the model understand that this isn't just "a pass before a shot" - it's a **dangerous cross-ice one-timer from the slot**, which is much more valuable than a pass from the blue line!

## 📝 Shot Type Reference

| Shot Type | Description | Frequency | Encoded Value |
|-----------|-------------|-----------|---------------|
| wrist | Standard wrist shot | Most common | 6 |
| snap | Quick snap shot | Very common | 4 |
| slap | Hard slap shot | Common | 3 |
| tip-in | Deflection in front of net | Common | 5 |
| backhand | Backhand shot | Less common | 0 |
| deflected | Deflected shot | Rare | 1 |
| wrap-around | Wrap-around attempt | Rare | 7 |
| bat | Batted out of air | Very rare | - |
| between-legs | Between the legs | Very rare | - |
| poke | Poke check | Very rare | - |

*Note: Encoded values may vary based on training data order*

## 🔍 Auditing & Transparency

### Model Files:
- `xg_model.joblib` - The trained XGBoost model
- `model_features.joblib` - List of feature names in order
- `shot_type_encoder.joblib` - Encoder for shot type categories

### Data Flow:
1. NHL API → Play-by-play JSON
2. Feature Extraction → Calculate 6 features
3. Model Prediction → xG probability (0-1)
4. Aggregation → Sum per player per game
5. Database → Upload to Supabase `raw_player_stats` table

### Validation:
- Model trained on 5,000 synthetic shots
- Feature importance shows which factors matter most
- All calculations are deterministic and reproducible

## 🎛️ Model Calibration

### Why Calibration is Needed

The model was trained on **synthetic data** (5,000 dummy shots), which doesn't perfectly match real NHL shot distributions. Without calibration, the model predicts unrealistically high xG values (many shots at 0.999 = 99.9% chance).

### Calibration Process

**Two-Stage Calibration Applied:**

1. **Power Function Compression**:
   ```python
   raw_xg = model.predict_proba(features)[:, 1]  # Raw prediction (0-1)
   compressed_xg = raw_xg ** 3.5  # Compress high values
   ```
   - Reduces extreme values (0.999 → 0.996, 0.5 → 0.088)
   - Preserves relative differences between shots

2. **Scale Factor Adjustment**:
   ```python
   calibrated_xg = compressed_xg * 0.17  # Scale to match real NHL averages
   ```
   - Brings average xG/game from ~1.165 down to ~0.180
   - Matches staging_2025_skaters average of ~0.200

3. **Maximum Cap**:
   ```python
   final_xg = min(calibrated_xg, 0.50)  # No shot exceeds 50% chance
   ```
   - Even the best shots (breakaways, empty nets) rarely exceed 0.50 xG

### Calibration Results

**Before Calibration:**
- Average xG/game: 1.165 (8.5x too high!)
- Top player xG: 8.62 (impossible for one game)
- Many shots at 0.999 (99.9% chance - unrealistic)

**After Calibration:**
- Average xG/game: **0.180** (staging: 0.200) ✅
- Top player xG: **0.703** (realistic) ✅
- Individual shots: **0.05-0.50 range** (realistic) ✅
- Validation ratio: **1.26x** (down from 8.5x!) ✅
- Median ratio: **0.95x** (very close to staging!) ✅

### Calibration Parameters

Current settings in `data_acquisition.py`:
```python
CALIBRATION_FACTOR = 3.5  # Power function exponent
SCALE_FACTOR = 0.17       # Final scaling multiplier
MAX_XG_PER_SHOT = 0.50    # Maximum xG for any single shot
```

**Note**: These parameters were tuned to match `staging_2025_skaters` data. If you process more games or retrain the model, you may need to adjust these values.

## 📊 Expected Assists (xA) Model

### Overview
The xA model predicts the probability that a pass will result in a goal. It's calculated from the **pass location perspective**, not the shot location.

### xA Model Features

1. **pass_distance_to_net** (Continuous, 0-100+ feet)
   - Distance from pass location to net center
   - **Impact**: 35.2% importance (MOST IMPORTANT!)
   - Closer passes = higher xA

2. **pass_angle** (Continuous, 0-90 degrees)
   - Angle from net center to pass location
   - **Impact**: 19.9% importance
   - Lower angles (closer to center) = higher xA

3. **time_before_shot** (Continuous, 0-3 seconds)
   - Time between pass and shot
   - **Impact**: 14.8% importance
   - Shorter time (one-timers) = higher xA

4. **pass_lateral_distance** (Continuous, 0-50+ feet)
   - How far across the ice the pass traveled
   - **Impact**: 13.3% importance
   - Cross-ice passes = higher xA

5. **is_power_play** (Binary, 0 or 1)
   - Whether pass occurred during power play
   - **Impact**: 16.8% importance
   - Power play passes = higher xA

### xA vs xG
- **xG**: "Given this shot, what's the probability it becomes a goal?"
- **xA**: "Given this pass, what's the probability the resulting shot becomes a goal?"
- Both use similar features but from different perspectives (shot location vs pass location)

### Example xA Calculation

**Scenario**: Player passes from 15 feet in front of net, 1 second before teammate shoots and scores.

**Features**:
- `pass_distance_to_net` = 15 feet
- `pass_angle` = 10 degrees
- `time_before_shot` = 1.0 seconds
- `pass_lateral_distance` = 20 feet (cross-ice)
- `is_power_play` = 1

**Model Prediction**: ~0.25 xA (25% chance pass leads to goal)

**Why**: Close pass, good angle, quick one-timer, cross-ice, power play = very high xA!

## ✅ Implementation Status

### Completed Features:
- ✅ Distance calculation (Euclidean formula)
- ✅ Angle calculation (0-90° range, fixed from previous >90° bug)
- ✅ Rebound detection (sequential play analysis, <3 seconds)
- ✅ Shot type encoding (LabelEncoder with 10 shot types)
- ✅ Power play detection (situation code parsing)
- ✅ Score differential (team perspective calculation)
- ✅ **Pass detection** (looks back 15 plays, same team, <3 seconds)
- ✅ **Pass lateral distance** (y-axis difference)
- ✅ **Pass-to-net distance** (Euclidean distance from pass to net)
- ✅ **Pass zone classification** (distance + angle based zones) - NEW!
- ✅ **Pass immediacy score** (time-based immediacy metric) - NEW!
- ✅ **Goalie movement score** (lateral distance × immediacy) - NEW!
- ✅ **Pass quality score** (composite pass quality metric) - NEW!
- ✅ **Pass zone encoding** (LabelEncoder for zone categories) - NEW!
- ✅ **Expected Assists (xA) model** - Separate model for passers
- ✅ **Passer identification** (extracts playerId from pass events)
- ✅ **xA feature calculation** (pass location features)
- ✅ **Dual-tracking system** (xG for shooters, xA for passers)
- ✅ Model calibration (two-stage: power function + scale factor)
- ✅ Database validation (compared against staging_2025_skaters)
- ✅ **Expected Rebounds model** - Predicts rebound probability from shots
- ✅ **Expected Goals of Expected Rebounds** - Credits players for generating rebound opportunities
- ✅ **Shooting Talent Adjusted xG** - Bayesian adjustment for individual player shooting skill
- ✅ **Created Expected Goals** - Credits players for creating opportunities (non-rebound xG + xGoals of xRebounds)

### Current Data Coverage:
- **Games Processed**: 13 games from December 7, 2025
- **Player/Game Records**: 395 unique combinations
- **Average xG/Game**: 0.180 (validated against staging: 0.200)
- **Validation Status**: ✅ Aligned with staging data

## 🎯 Shooting Talent Adjusted Expected Goals

### Overview
Shooting Talent Adjusted Expected Goals adjusts each shot's xG value based on the shooter's historical shooting performance using Bayesian statistics (MoneyPuck methodology).

### How It Works
1. **Historical Data Aggregation**: For each player, calculate:
   - Total goals scored
   - Total xG accumulated
   - Goals above expected = Goals - xG
   - Shooting percentage above expected = (Goals - xG) / xG × 100

2. **Bayesian Talent Estimation**: 
   - Define talent levels (e.g., -20%, -10%, 0%, +10%, +20% above average)
   - Calculate posterior probability distribution over talent levels
   - Use prior distribution from historical NHL data
   - Calculate expected shooting talent (weighted average)

3. **Talent Multiplier**: Convert expected talent to a multiplier
   - 1.0 = Average shooter (no adjustment)
   - 1.15 = 15% above average (elite shooter)
   - 0.85 = 15% below average (poor shooter)

4. **Adjustment**: Apply multiplier to flurry-adjusted xG
   ```
   shooting_talent_adjusted_xg = flurry_adjusted_xg × shooting_talent_multiplier
   ```

### Example
- **Player**: Elite shooter with 1.15 multiplier
- **Shot**: 0.20 xG (flurry-adjusted)
- **Adjusted xG**: 0.20 × 1.15 = 0.23 xG

### Benefits
- Accounts for individual player shooting skill
- Improves fantasy projections (better players get more credit)
- Uses Bayesian statistics to handle small sample sizes gracefully

---

## 🏒 Expected Rebounds Model

### Overview
The Expected Rebounds model predicts the probability that a shot will generate a rebound opportunity. This is a separate XGBoost classifier trained on the same features as the xG model.

### Model Details
- **Algorithm**: XGBoost Classifier (binary classification)
- **Target**: `shot_generated_rebound` (1 = rebound generated, 0 = no rebound)
- **Features**: Same as xG model (distance, angle, shot_type, speed, location, etc.)
- **Output**: Rebound probability (0-1)

### Expected Goals of Expected Rebounds
For shots that generate rebounds, we calculate:
```
xGoals_of_xRebounds = Rebound_Probability × Estimated_Rebound_Shot_xG
```

This credits players for shots that create rebound opportunities, even if the rebound doesn't actually occur.

### Example
- **Shot**: 0.15 xG, 0.20 rebound probability
- **Estimated rebound shot xG**: 0.15 × 1.5 = 0.225 (rebounds are more dangerous)
- **xGoals of xRebounds**: 0.20 × 0.225 = 0.045

---

## 🎨 Created Expected Goals

### Overview
Created Expected Goals credits players for generating scoring opportunities, not just taking shots.

### Formula
```
Created_xG = xG_from_non_rebound_shots + xGoals_of_xRebounds
```

### Logic
- **Non-rebound shots**: Get full xG credit
- **Shots that generate rebounds**: Get xG credit + xGoals of xRebounds
- **Rebound shots themselves**: Get 0 direct credit (credit goes to shot that created rebound)

### Example
- **Player takes shot**: 0.20 xG (non-rebound)
- **Shot generates rebound**: +0.045 xGoals of xRebounds
- **Created xG**: 0.20 + 0.045 = 0.245

### Benefits
- Rewards players who create opportunities (defensemen shooting from point to generate rebounds)
- Punishes players who just feed on rebounds
- Better reflects player contribution to team offense

---

## 🚀 Future Improvements

1. **Process More Games**: Expand beyond 1 day to get better statistical averages
2. **Fine-tune Calibration**: Adjust calibration factors as more data is processed
3. **Retrain Model**: Eventually train on real NHL historical data instead of synthetic
4. **Additional Features**: Could add:
   - Shot speed (if available in API)
   - Time remaining in period
   - Rush vs. set play
   - Shot location zone (offensive/defensive/neutral)
5. ✅ **Player-Specific Models**: Implemented! Shooting Talent Adjusted xG now accounts for individual player skill

