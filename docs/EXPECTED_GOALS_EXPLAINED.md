# 🏒 Expected Goals (xG) Explained: The Complete Picture

## 🎯 What is Expected Goals?

**Expected Goals (xG)** is a number between 0 and 1 that tells you how likely a shot is to become a goal. Think of it like a weather forecast, but for hockey shots:

- **0.0** = 0% chance (impossible shot, like shooting from your own end)
- **0.5** = 50% chance (great scoring chance, like a breakaway)
- **1.0** = 100% chance (guaranteed goal, like an empty net tap-in)

**Example**: A shot from 10 feet directly in front of the net might have **0.30 xG** (30% chance), while a shot from 60 feet at a bad angle might have **0.05 xG** (5% chance).

---

## 🔄 The Complete Process: From Shot to xG Number

Here's how we turn a real hockey shot into an xG number, step by step:

```
1. NHL Game Happens
   ↓
2. We Scrape Play-by-Play Data (NHL API)
   ↓
3. We Extract Shot Information
   ↓
4. We Calculate Features (distance, angle, etc.)
   ↓
5. Machine Learning Model Predicts Base xG
   ↓
6. We Apply Adjustments (Flurry, Talent, Rebounds)
   ↓
7. We Store Final xG in Database
   ↓
8. We Aggregate by Player/Game/Season
```

Let's break down each step:

---

## Step 1: The Game Happens 🏒

A real NHL game is played. Players take shots, make passes, score goals.

**Example**: Connor McDavid takes a shot from 15 feet in front of the net during a power play.

---

## Step 2: We Get the Data 📡

We use the **NHL API** to get play-by-play data for every game. This tells us:
- When each shot happened
- Where on the ice it was taken
- Who took it
- What happened before it (pass, rebound, etc.)
- Game situation (power play, score, etc.)

**Code Location**: `data_acquisition.py` - `scrape_pbp_and_process()`

**What We Get**:
```python
{
  "typeCode": 505,  # Shot on goal
  "xCoord": 75,     # X coordinate on ice
  "yCoord": 10,     # Y coordinate on ice
  "playerId": 8478402,  # Connor McDavid
  "period": 2,
  "timeInPeriod": "12:34",
  "situationCode": "5v4"  # Power play
}
```

---

## Step 3: We Extract Shot Information 📊

For each shot, we pull out the key details:

- **Location**: X and Y coordinates on the ice
- **Player**: Who took the shot
- **Time**: When in the game it happened
- **Context**: Power play? Empty net? Score situation?
- **Previous Event**: What happened right before (pass, rebound, faceoff?)

**Code Location**: `data_acquisition.py` - lines ~1200-1450

---

## Step 4: We Calculate Features 🔢

This is where the magic starts. We turn raw data into **features** that our model understands.

### The Main Features:

#### 1. **Distance** (Most Important!)
- **What it is**: How far the shot is from the center of the net
- **How we calculate**: `√((89 - x)² + (0 - y)²)` feet
- **Why it matters**: Closer shots = higher xG
- **Example**: 15 feet away = high xG, 60 feet away = low xG

#### 2. **Angle**
- **What it is**: The angle from the center of the net to the shot location
- **How we calculate**: `arctan(distance to side / distance to net)`
- **Why it matters**: Shots from the center (0°) are better than shots from the side (90°)
- **Example**: 0° = straight on = high xG, 60° = bad angle = low xG

#### 3. **Shot Type**
- **What it is**: Wrist shot, slap shot, snap shot, backhand, tip-in, etc.
- **Why it matters**: Some shot types are more effective than others
- **Example**: Tip-ins have higher xG than slap shots from distance

#### 4. **Is Rebound?**
- **What it is**: Was this shot taken right after another shot (within 3 seconds)?
- **Why it matters**: Rebounds are more dangerous (goalie is out of position)
- **Example**: Shot 2 seconds after a save = rebound = higher xG

#### 5. **Game Situation**
- **Power Play**: Is the team on a power play? (More space = better shots)
- **Score Differential**: Is the team winning or losing? (Affects shot quality)
- **Empty Net**: Is the goalie pulled? (Much easier to score)

#### 6. **Pass Before Shot**
- **What it is**: Was there a pass right before this shot?
- **Why it matters**: Passes create better scoring chances
- **Features we calculate**:
  - **Pass Distance**: How far was the pass?
  - **Pass Quality**: How good was the pass? (location, timing, etc.)
  - **Time Since Pass**: How quickly was the shot taken? (one-timers are better)

#### 7. **Speed from Last Event**
- **What it is**: How fast did the play develop?
- **Why it matters**: Quick plays catch goalies off guard
- **Example**: Shot 1 second after a pass = fast = higher xG

#### 8. **Arena Adjustments**
- **What it is**: Different arenas have different coordinate systems
- **Why it matters**: We need to normalize coordinates across all arenas
- **How**: We adjust X/Y coordinates based on which arena the game is in

**Code Location**: `feature_calculations.py` - Various calculation functions

**Total Features**: ~15-20 features per shot

---

## Step 5: Machine Learning Model Predicts Base xG 🤖

Now we feed all those features into our **XGBoost machine learning model**.

### What is XGBoost?
Think of it like a super-smart calculator that learned from **thousands of historical shots**. It looks at all the features and says: "Based on shots I've seen before with similar features, this shot has a 0.25 xG (25% chance of being a goal)."

### How the Model Works:
1. **Training**: We trained the model on historical shot data (shots that went in vs. shots that didn't)
2. **Learning**: The model learned patterns like "shots from 10 feet = 30% goal rate" and "rebounds = 20% goal rate"
3. **Prediction**: For each new shot, the model combines all features and outputs a probability

**Model File**: `xg_model_moneypuck.joblib`
**Code Location**: `data_acquisition.py` - lines ~1500-1600

**Example**:
```python
# Input features
features = {
    'distance': 15.0,
    'angle': 10.0,
    'is_rebound': True,
    'shot_type': 'wrist',
    'is_power_play': True,
    ...
}

# Model prediction
base_xg = model.predict(features)  # Output: 0.28 (28% chance)
```

---

## Step 6: We Apply Adjustments ✨

This is where we make the xG even better! We apply **three MoneyPuck-inspired adjustments**:

### Adjustment 1: Flurry Adjustment ⚡

**What it is**: When teams take multiple shots in quick succession (a "flurry"), we reduce the xG of later shots.

**Why**: If a goalie just made a save, they're in position. The second shot in a flurry is less likely to go in.

**How it works**:
- If a shot comes within 3 seconds of another shot by the same team, we reduce its xG
- The reduction depends on how quickly the shot came (faster = bigger reduction)

**Example**:
- Shot 1: 0.20 xG (normal)
- Shot 2 (2 seconds later): 0.20 xG → **0.15 xG** (reduced by 25%)

**Code Location**: `feature_calculations.py` - `calculate_flurry_adjusted_xg()`

---

### Adjustment 2: Shooting Talent Adjustment 🎯

**What it is**: We adjust xG based on how good the shooter is historically.

**Why**: Some players are better shooters than others. Connor McDavid converts shots at a higher rate than average, so we give his shots a boost.

**How it works**:
1. We look at each player's historical performance: goals scored vs. xG expected
2. We use **Bayesian estimation** to calculate a "talent multiplier"
3. We multiply the flurry-adjusted xG by this multiplier

**Example**:
- Average player: 0.20 xG → 0.20 xG (multiplier = 1.0)
- Great shooter: 0.20 xG → **0.22 xG** (multiplier = 1.1, +10%)
- Poor shooter: 0.20 xG → **0.18 xG** (multiplier = 0.9, -10%)

**Code Location**: 
- Calculation: `calculate_shooting_talent.py`
- Application: `feature_calculations.py` - `calculate_shooting_talent_adjusted_xg()`

---

### Adjustment 3: Rebound Prediction & Created xG 🔄

**What it is**: We predict if a shot will create a rebound, and credit the shooter for that opportunity.

**Why**: Even if a shot doesn't go in, it might create a rebound that leads to a goal. We want to credit players for creating these opportunities.

**How it works**:

#### Step 3a: Predict Rebound Probability
- We use a separate **XGBoost model** to predict: "Will this shot create a rebound?"
- The model looks at shot location, shot type, goalie position, etc.
- Output: A probability between 0 and 1 (e.g., 0.25 = 25% chance of rebound)

**Rebound Model File**: `rebound_model.joblib`
**Code Location**: `data_acquisition.py` - lines ~2100-2200

#### Step 3b: Calculate Expected Goals of Expected Rebounds
- If a shot has a 25% chance of creating a rebound, and rebounds typically have 0.15 xG, then:
- **xGoals of xRebounds = 0.25 × 0.15 = 0.0375**
- This credits the shooter for creating a rebound opportunity worth 0.0375 expected goals

**Code Location**: `feature_calculations.py` - `calculate_expected_goals_of_expected_rebounds()`

#### Step 3c: Calculate Created Expected Goals
- **Created xG = Non-Rebound xG + xGoals of xRebounds**
- This gives players credit for:
  1. Their direct shot attempts
  2. The rebound opportunities they create

**Example**:
- Shot xG: 0.20
- Rebound probability: 0.25
- Rebound xG if it happens: 0.15
- xGoals of xRebounds: 0.25 × 0.15 = 0.0375
- **Created xG: 0.20 + 0.0375 = 0.2375**

**Code Location**: `feature_calculations.py` - `calculate_created_expected_goals()`

---

## Step 7: We Store Everything in the Database 💾

All the xG values (base, flurry-adjusted, talent-adjusted, created) are saved to our **Supabase database** in the `raw_shots` table.

**Database Table**: `raw_shots`
**Columns**:
- `xG_Value` - Base xG from model
- `flurry_adjusted_xg` - After flurry adjustment
- `shooting_talent_adjusted_xg` - After talent adjustment
- `created_expected_goals` - Created xG (includes rebounds)
- `expected_rebound_probability` - Rebound prediction
- `expected_goals_of_expected_rebounds` - xGoals of xRebounds
- Plus all the original shot data (location, player, time, etc.)

**Code Location**: `data_acquisition.py` - lines ~2400-2600

---

## Step 8: We Aggregate by Player/Game/Season 📈

Finally, we sum up all the xG values for each player in each game, and then for the whole season.

**Example**:
- Connor McDavid in Game 1:
  - Shot 1: 0.28 xG
  - Shot 2: 0.15 xG
  - Shot 3: 0.22 xG
  - **Total xG for game: 0.65**

- Connor McDavid Season Total:
  - Game 1: 0.65 xG
  - Game 2: 0.82 xG
  - Game 3: 0.45 xG
  - ...
  - **Season Total: 45.3 xG**

**Database Table**: `raw_player_stats`
**Code Location**: `data_acquisition.py` - lines ~2600-2800

---

## 🎯 The Final xG Variants

After all the processing, we have **four different xG numbers** for each shot:

### 1. **Base xG** (`xG_Value`)
- The raw prediction from the machine learning model
- No adjustments applied
- **Use for**: Basic shot quality assessment

### 2. **Flurry-Adjusted xG** (`flurry_adjusted_xg`)
- Base xG with flurry discounting applied
- Accounts for shot sequences
- **Use for**: More accurate shot quality in game context

### 3. **Talent-Adjusted xG** (`shooting_talent_adjusted_xg`)
- Flurry-adjusted xG × player shooting talent multiplier
- Accounts for player skill
- **Use for**: Player evaluation and prediction (BEST OVERALL PERFORMANCE)
- **Performance**: +37% improvement in shot-level R², +12.4% in player-level R²

### 4. **Created Expected Goals** (`created_expected_goals`)
- Non-rebound xG + xGoals of xRebounds
- Credits players for creating rebound opportunities
- **Use for**: Shot creation analysis, identifying playmakers

---

## 📊 Real Example: A Complete Shot

Let's trace one shot through the entire process:

### The Shot:
- **Player**: Connor McDavid
- **Location**: 15 feet from net, 10° angle
- **Situation**: Power play, 2 seconds after a pass
- **Type**: Wrist shot, one-timer

### Step-by-Step Processing:

1. **Data Extraction**: ✅ Got shot data from NHL API
2. **Feature Calculation**:
   - Distance: 15.0 feet
   - Angle: 10.0 degrees
   - Is rebound: False
   - Shot type: Wrist shot
   - Is power play: True
   - Pass before shot: Yes (2 seconds ago)
   - Speed from last event: High
3. **Base xG Prediction**: Model outputs **0.28** (28% chance)
4. **Flurry Adjustment**: Not in a flurry, so stays **0.28**
5. **Talent Adjustment**: McDavid has 1.1 multiplier → **0.28 × 1.1 = 0.308**
6. **Rebound Prediction**: Model predicts 0.20 (20% chance of rebound)
7. **xGoals of xRebounds**: 0.20 × 0.15 = **0.03**
8. **Created xG**: 0.28 + 0.03 = **0.31**

### Final Values Stored:
- `xG_Value`: 0.28
- `flurry_adjusted_xg`: 0.28
- `shooting_talent_adjusted_xg`: 0.308
- `created_expected_goals`: 0.31
- `expected_rebound_probability`: 0.20
- `expected_goals_of_expected_rebounds`: 0.03

---

## 🔧 The Technical Stack

### Models:
- **xG Model**: XGBoost classifier (predicts goal probability)
- **Rebound Model**: XGBoost classifier (predicts rebound probability)
- **Talent Model**: Bayesian estimation (calculates player multipliers)

### Files:
- **`data_acquisition.py`**: Main pipeline (scrapes, processes, saves)
- **`feature_calculations.py`**: All feature calculation functions
- **`calculate_shooting_talent.py`**: Calculates player talent multipliers
- **`train_rebound_model.py`**: Trains the rebound prediction model

### Database:
- **Supabase**: PostgreSQL database
- **Tables**: `raw_shots`, `raw_player_stats`

---

## 🎯 Key Takeaways

1. **xG is a probability**: It tells you how likely a shot is to become a goal
2. **Multiple features matter**: Distance, angle, shot type, game situation, etc.
3. **Machine learning learns patterns**: The model learned from thousands of historical shots
4. **Adjustments improve accuracy**: Flurry, talent, and rebound adjustments make xG more accurate
5. **Four variants for different uses**: Base, flurry-adjusted, talent-adjusted, and created xG
6. **Talent-adjusted is best**: Shows +37% improvement in accuracy

---

## 📈 Performance Results

Based on **41,524 shots** from the 2025-26 season:

### Shot-Level Performance:
- **Base xG**: R² = 0.0208, Correlation = 0.1854
- **Flurry-Adjusted xG**: R² = 0.0271 (+30%), Correlation = 0.1887
- **Talent-Adjusted xG**: R² = **0.0285 (+37%)**, Correlation = **0.1909** ⭐
- **Created xG**: R² = 0.0028, Correlation = 0.2294

### Player-Season Performance:
- **Base xG**: R² = 0.6358, Correlation = 0.8530
- **Flurry-Adjusted xG**: R² = 0.6711 (+5.5%), Correlation = 0.8554
- **Talent-Adjusted xG**: R² = **0.7149 (+12.4%)**, Correlation = **0.8772** ⭐
- **Created xG**: R² = 0.1236, Correlation = 0.8569

**Winner**: Talent-Adjusted xG performs best overall! 🏆

---

## 🚀 How to Use This System

### For New Games:
1. Run `python data_acquisition.py` with a date
2. The script will:
   - Scrape game data from NHL API
   - Calculate all features
   - Predict xG for all shots
   - Apply all adjustments
   - Save to database

### For Reprocessing:
1. Run `python reprocess_full_season.py` to reprocess all games
2. Or run `python reprocess_with_new_features.py` for a sample

### For Analysis:
1. Query the `raw_shots` table for shot-level data
2. Query the `raw_player_stats` table for player aggregates
3. Use any of the four xG variants depending on your needs

---

## 💡 Why This Matters

Expected Goals helps us:
- **Evaluate players fairly**: A player with 20 goals on 100 shots (20% conversion) is better than a player with 20 goals on 200 shots (10% conversion)
- **Identify undervalued players**: Players who generate high xG but low goals might be unlucky
- **Predict future performance**: High xG players are more likely to score in the future
- **Analyze team strategy**: Which plays generate the most xG?

---

*This system processes every shot from every NHL game, turning raw play-by-play data into sophisticated analytics that help us understand the game better.*

---

**Questions?** Check out:
- `FINAL_RESULTS_SUMMARY.md` - Full performance results
- `XG_MODEL_DOCUMENTATION.md` - Technical model details
- `COMPLETE_PIPELINE_EXPLANATION.md` - Advanced pipeline details

