# Brainstorm: Why Last Event Tracking Isn't Working

## What We Know

1. **NHL API HAS the data**: 82.7% of events have coordinates
   - FACEOFF: 60 events with coords
   - HIT: 37 events with coords  
   - BLOCK: 3 events with coords
   - SHOT/MISS/GOAL: All have coords
   - Average 1.2 events between coordinate events

2. **Our code logic**: Should be tracking state, but results show 99%+ zeros

## Potential Issues

### Issue 1: Time Validation Too Strict
**Problem**: Line 929 checks `current_time_seconds > 0`, but events at `00:00` might have time = 0
**Fix**: Change to `current_time_seconds is not None` (allow 0 for period start)

### Issue 2: State Not Persisting Across Games
**Problem**: `last_event_state` is initialized per game, but maybe it's being reset?
**Fix**: Verify state persists throughout entire game processing

### Issue 3: Coordinate Check Failing
**Problem**: `current_x is not None and current_y is not None` might fail if one is 0
**Fix**: Check for `is not None` only, not value (0 is valid coordinate)

### Issue 4: State Update Happening After Feature Calculation
**Problem**: We update state AFTER calculating features, but maybe we need to update BEFORE?
**Actually**: We calculate features using PREVIOUS state, then update state for NEXT shot - this is correct

### Issue 5: First Shot Always Has No Previous Event
**Problem**: First shot in game/period will always have no previous event
**Expected**: This is correct - first shots should have 0 distance/speed

## Alternative Approaches

### Approach 1: Use Previous Shot as Fallback
If no non-shot event found, use the previous shot's coordinates:
```python
# If state not initialized, try to use previous shot
if last_event_state['x_coord'] is None:
    # Look for previous shot in previous_plays
    for prev_play in reversed(previous_plays):
        if prev_play.get('typeCode') in [505, 506, 507]:
            prev_details = prev_play.get('details', {})
            prev_x = prev_details.get('xCoord')
            prev_y = prev_details.get('yCoord')
            if prev_x is not None and prev_y is not None:
                # Use previous shot as last event
                last_event_x = prev_x
                last_event_y = prev_y
                break
```

### Approach 2: Use Faceoff Location as Default
If no event found, use the most recent faceoff location:
```python
# Find most recent faceoff
for prev_play in reversed(previous_plays):
    if prev_play.get('typeCode') == 503:  # Faceoff
        prev_details = prev_play.get('details', {})
        prev_x = prev_details.get('xCoord')
        prev_y = prev_details.get('yCoord')
        if prev_x is not None and prev_y is not None:
            # Use faceoff as last event
            break
```

### Approach 3: Calculate from Shot Sequence
Track shot-to-shot distance even if no intermediate events:
```python
# Always track last shot location separately
last_shot_x = None
last_shot_y = None
last_shot_time = None

# When processing shot:
if last_shot_x is not None:
    # Calculate from last shot
    distance_from_last_shot = math.sqrt(...)
    time_since_last_shot = current_time - last_shot_time
    speed_from_last_shot = distance_from_last_shot / time_since_last_shot

# Update after processing
last_shot_x = shot_coord_x
last_shot_y = shot_coord_y
last_shot_time = current_time_seconds
```

### Approach 4: Debug with Print Statements
Add debug logging to see what's happening:
```python
if current_x is not None and current_y is not None:
    print(f"Event {type_code} has coords: ({current_x}, {current_y})")
    print(f"Updating state from {last_event_state['x_coord']} to {current_x}")
    last_event_state['x_coord'] = current_x
```

## Recommended Fix Strategy

1. **First**: Relax time validation (allow 0)
2. **Second**: Add debug logging to see if state is being updated
3. **Third**: If still not working, use Approach 3 (track last shot separately)
4. **Fourth**: As fallback, use previous shot if no other event found

## Quick Test

Add this debug code to see what's happening:
```python
# In the non-shot event handler
if current_x is not None and current_y is not None:
    print(f"DEBUG: Updating state for event {type_code}: ({current_x}, {current_y})")
    
# In the shot feature calculation
if last_event_state['x_coord'] is not None:
    print(f"DEBUG: Using state for shot: last_event=({last_event_state['x_coord']}, {last_event_state['y_coord']}), shot=({shot_coord_x}, {shot_coord_y})")
else:
    print(f"DEBUG: State not initialized for shot at ({shot_coord_x}, {shot_coord_y})")
```

