# Shift Tracking Model - Reverse Engineering Plan

## Current State Analysis

### Official Shifts (Ground Truth)
- **McDavid Game 2025020207**: 25 shifts, 25.22 minutes TOI
- **Our Calculated**: 15 shifts, 20.08 minutes TOI
- **Gap**: Missing 10 shifts (40%), missing 5.13 minutes (20%)

### Key Findings from Reverse Engineering

1. **Shift Start/End Patterns**:
   - Many shifts start/end with NO events in play-by-play
   - Shifts often start after stoppages, period starts, or line changes
   - Shifts end before stoppages or period ends

2. **Player Participation**:
   - Players are on ice for entire shifts, not just when they appear in events
   - Shift 1: 55 seconds, only 2 events (hit, giveaway)
   - Players can be on ice for 30-90 seconds without appearing in PBP

3. **Situation Code Changes**:
   - Situation codes change DURING shifts (5v5 → 5v4 → 4v5)
   - This means players stay on ice through situation changes
   - We need to track situation changes, not just infer from events

4. **Line Patterns**:
   - 12-16 players on ice at any time (6 per team + goalies)
   - Line changes happen frequently (every 30-90 seconds typically)
   - We need to track ALL players on ice, not just event participants

## The Fundamental Problem

**We cannot accurately infer shifts from play-by-play alone because:**
- PBP only shows events (goals, shots, hits, etc.)
- Players are on ice even when not in events
- Shifts start/end during stoppages not in PBP
- We don't know WHO is on ice, only HOW MANY (from situation codes)

## Proposed Solution: Multi-Layered Shift Inference Model

### Layer 1: Event-Based Tracking (Current - Incomplete)
- Track players who appear in events
- Credit time between appearances
- **Problem**: Misses players not in events, misses time between events

### Layer 2: Situation Code + Roster Inference (NEW)
- Use situation codes to know skater counts (5v5, 5v4, 4v5, etc.)
- Use roster data to know which players SHOULD be on ice
- Track line combinations from faceoffs and events
- Infer line changes from situation changes and time gaps

### Layer 3: Stoppage-Based Inference (NEW)
- Track all stoppages (faceoffs, penalties, goals, etc.)
- Infer line changes at stoppages
- Use time gaps to detect shift boundaries

### Layer 4: Period/Game State Tracking (NEW)
- Track period starts (all players start new shifts)
- Track period ends (all shifts end)
- Track overtime (different shift patterns)

## Implementation Strategy

### Phase 1: Enhanced Event Tracking
1. Track ALL players from ALL events (not just primary actors)
   - Goals: scorer, assists, goalie
   - Shots: shooter, goalie, blockers
   - Faceoffs: both centers
   - Penalties: committing player, drawn by player
   - Hits: hitter, hittee
   - Blocks: blocker, shooter
   - Takeaways/Giveaways: both players

2. Expand gap detection
   - Current: 60-second gap = line change
   - Enhanced: Variable gap based on situation
     - 5v5: 45-60 seconds
     - PP/PK: 30-45 seconds (shorter shifts)
     - Empty net: 20-30 seconds (very short shifts)

### Phase 2: Situation-Aware Tracking
1. Track situation code changes
2. When situation changes, infer line changes for affected team
3. Track power play units (PP1, PP2) separately
4. Track penalty kill units (PK1, PK2) separately

### Phase 3: Line Combination Inference
1. Track which players appear together in events
2. Build line combinations from faceoffs
3. When line changes occur, infer entire line change
4. Use roster data to validate line combinations

### Phase 4: Stoppage-Based Shift Boundaries
1. Track all stoppages (faceoffs, penalties, goals, icings, offsides)
2. Infer shift starts after stoppages
3. Infer shift ends before stoppages
4. Use time between stoppages to validate shift duration

## Validation Strategy

1. **Compare to Official Shifts** (when available):
   - For games with official shifts, compare our calculated shifts
   - Measure accuracy: shift count, TOI per game, shift duration
   - Target: 95%+ accuracy for games with official shifts

2. **Validate Against Known Patterns**:
   - Top players: 20-25 minutes per game
   - Bottom players: 5-10 minutes per game
   - PP specialists: Higher TOI on power play
   - PK specialists: Higher TOI on penalty kill

3. **Cross-Validate with Other Stats**:
   - TOI should correlate with other ice time metrics
   - Shift count should be reasonable (15-30 per game for top players)
   - Shift duration should be reasonable (30-90 seconds typically)

## Next Steps

1. **Build Enhanced Event Tracking** - Track all players from all events
2. **Implement Situation-Aware Tracking** - Use situation codes to infer line changes
3. **Add Stoppage-Based Boundaries** - Track stoppages to infer shift starts/ends
4. **Validate Against Official Shifts** - Compare to ground truth
5. **Iterate and Refine** - Adjust parameters until we match official shifts

## Success Criteria

- **Shift Count**: Match official shifts within 10% (25 official → 23-27 calculated)
- **TOI Accuracy**: Match official TOI within 5% (25.22 min → 24-26.5 min)
- **Coverage**: 100% of games have TOI data (no games with 0 TOI)
- **Top Players**: 20-25 minutes per game (McDavid, top defensemen)
- **Bottom Players**: 5-10 minutes per game (4th line, 7th defensemen)
