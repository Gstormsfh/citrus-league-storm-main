# Feature Extraction Enhancement Plan
## Goal: Match MoneyPuck's 124 Features

### Current Status
- **Our columns**: ~25 features
- **MoneyPuck columns**: 124 features
- **Gap**: ~99 missing features

### Missing Feature Categories

#### 1. **Situation Features** (9 features) - PARTIALLY MISSING
- ✅ `is_power_play` - We have this
- ❌ `awaySkatersOnIce` - Need to parse situation_code
- ❌ `homeSkatersOnIce` - Need to parse situation_code  
- ❌ `awayEmptyNet` - Need to detect empty net situations
- ❌ `homeEmptyNet` - Need to detect empty net situations
- ❌ `awayPenalty1Length` - Need penalty info
- ❌ `homePenalty1Length` - Need penalty info
- ❌ `awayPenalty1TimeLeft` - Need penalty info
- ❌ `homePenalty1TimeLeft` - Need penalty info

**Available in API**: `situation_code` field contains this info (e.g., "5-4" = 5v4)

#### 2. **Last Event Features** (12 features) - MISSING
- ❌ `lastEventCategory` - Category of previous event (FAC, SHOT, etc.)
- ❌ `lastEventShotAngle` - Angle of last shot event
- ❌ `lastEventShotDistance` - Distance of last shot event
- ❌ `lastEventTeam` - Which team did last event
- ❌ `lastEventxCord` - X coordinate of last event
- ❌ `lastEventyCord` - Y coordinate of last event
- ❌ `distanceFromLastEvent` - Distance between last event and shot
- ❌ `speedFromLastEvent` - Speed/distance per second
- ❌ `timeSinceLastEvent` - Time between events
- ❌ `playerNumThatDidLastEvent` - Player who did last event

**Available in API**: We track `previous_play` but don't extract all these details

#### 3. **Rush Detection** (1 feature) - MISSING
- ❌ `shotRush` - Whether shot came from a rush (fast break)

**Available in API**: Can detect by checking if shot came from neutral/defensive zone quickly

#### 4. **Goalie Features** (3 features) - MISSING
- ❌ `goalieIdForShot` - Which goalie was in net
- ❌ `goalieNameForShot` - Goalie name
- ❌ `shotGoalieFroze` - Whether goalie froze the puck (outcome)

**Available in API**: `details.goalieInNetId` exists in play-by-play

#### 5. **Time on Ice Features** (46 features) - MISSING
- ❌ `shooterTimeOnIce` - Shooter's TOI
- ❌ `shooterTimeOnIceSinceFaceoff` - Shooter's TOI since faceoff
- ❌ `shootingTeamAverageTimeOnIce` - Team average TOI
- ❌ `shootingTeamMaxTimeOnIce` - Team max TOI
- ❌ `shootingTeamMinTimeOnIce` - Team min TOI
- ❌ `defendingTeamAverageTimeOnIce` - Opponent average TOI
- ... (many more TOI variants)

**Available in API**: Need to track shifts/TOI from roster data or shift changes

#### 6. **Shot Outcome Features** (7 features) - PARTIALLY MISSING
- ✅ `shotRebound` - We have `is_rebound`
- ❌ `shotGeneratedRebound` - Did this shot create a rebound?
- ❌ `shotGoalieFroze` - Did goalie freeze puck?
- ❌ `shotPlayStopped` - Did play stop after shot?
- ❌ `shotPlayContinuedInZone` - Did play continue in zone?
- ❌ `shotPlayContinuedOutsideZone` - Did play continue outside zone?
- ❌ `shotWasOnGoal` - Was shot on goal? (we have shot_type_code but not explicit flag)

**Available in API**: Need to look ahead in play sequence to see what happened next

#### 7. **Team Context Features** (57 features) - PARTIALLY MISSING
- ✅ `game_id` - We have this
- ✅ `is_goal` - We have this
- ❌ `teamCode` - Team abbreviation
- ❌ `isHomeTeam` - Home/away flag
- ❌ `period` - Period number
- ❌ `time` - Time in period
- ❌ `location` - Zone (HOMEZONE, AWAYZONE, NEUTRALZONE)
- ❌ `offWing` - Off-wing shot?
- ❌ `shooterLeftRight` - Shooter handedness
- ❌ `shooterName` - Player name
- ❌ `playerPositionThatDidEvent` - Position (C, LW, RW, D, G)

**Available in API**: Most of this is in play-by-play data

#### 8. **Arena-Adjusted Coordinates** - MISSING
- ❌ `arenaAdjustedXCord` - Arena-adjusted X
- ❌ `arenaAdjustedYCord` - Arena-adjusted Y
- ❌ `arenaAdjustedShotDistance` - Arena-adjusted distance

**Available in API**: Need arena adjustment logic (some arenas have different coordinate systems)

### Implementation Priority

#### Phase 1: Critical Features (High Impact, Easy to Extract)
1. **Situation parsing** - Parse `situation_code` for skaters on ice, empty net
2. **Last event details** - Extract full details from `previous_play`
3. **Goalie info** - Extract `goalieInNetId` from details
4. **Period/time** - Extract from `periodDescriptor` and `timeInPeriod`
5. **Team context** - Extract team codes, home/away, location
6. **Shot outcomes** - Look ahead to see what happened after shot

#### Phase 2: Advanced Features (Medium Impact, More Complex)
1. **Rush detection** - Analyze zone transitions and time
2. **Time on ice** - Track shifts from shift change events
3. **Arena adjustment** - Implement coordinate system adjustments

#### Phase 3: Nice-to-Have (Lower Impact)
1. **Advanced TOI metrics** - Team averages, min/max, since faceoff
2. **Player position** - Extract from roster data
3. **Handedness** - Extract from player data

### Next Steps

1. **Update `data_acquisition.py`** to extract all Phase 1 features
2. **Update `raw_shots` table schema** to store new features
3. **Re-run data pull** to populate new features
4. **Retrain model** with full feature set

