# Roster Components - Phase 1

This directory contains the Phase 1 components for the hockey roster management system with drag-and-drop functionality.

## Components

### HockeyPlayerCard
A draggable card component that displays comprehensive hockey player statistics.

**Features:**
- Drag-and-drop ready with dnd-kit
- Displays key stats: G, A, +/-, SOG, BLK, HIT, PPP, SHP
- TOI (Time On Ice) visual bar
- Status indicators: IR, SUSP, GTD, WVR
- Team abbreviation and position badges
- Goalie-specific stats display

**Props:**
```typescript
interface HockeyPlayerCardProps {
  player: HockeyPlayer;
  onClick?: () => void;
  draggable?: boolean;
  className?: string;
  isInSlot?: boolean;
}
```

### StartersGrid
A responsive grid layout with fixed position slots for starting lineup.

**Position Slots:**
- C (Center) - 2 slots
- LW (Left Wing) - 2 slots
- RW (Right Wing) - 2 slots
- D (Defense) - 4 slots
- G (Goalie) - 2 slots
- UTIL (Utility) - 1 slot

**Features:**
- Drop targets for each position
- Visual feedback when dragging over slots
- Shows slot capacity (current/max)
- Empty slot indicators

### BenchGrid
A flexible grid for bench players with drag-and-drop support.

**Features:**
- Responsive grid (2-6 columns based on screen size)
- Drop target for moving players from starters
- Visual feedback during drag operations

## Usage Example

```tsx
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { StartersGrid, BenchGrid, HockeyPlayer } from '@/components/roster';

function RosterPage() {
  const [starters, setStarters] = useState<HockeyPlayer[]>([]);
  const [bench, setBench] = useState<HockeyPlayer[]>([]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Handle drag logic here
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <StartersGrid 
        players={starters}
        onPlayerClick={(player) => console.log(player)}
      />
      <BenchGrid 
        players={bench}
        onPlayerClick={(player) => console.log(player)}
      />
    </DndContext>
  );
}
```

## Data Structure

The `HockeyPlayer` interface expects:

```typescript
interface HockeyPlayer {
  id: number;
  name: string;
  position: string; // 'Centre', 'Right Wing', 'Left Wing', 'Defence', 'Goalie'
  number: number;
  starter: boolean;
  stats: {
    goals?: number;
    assists?: number;
    points?: number;
    plusMinus?: number;
    shots?: number;
    blockedShots?: number;
    hits?: number;
    powerPlayPoints?: number;
    shortHandedPoints?: number;
    gamesPlayed?: number;
    toi?: string; // e.g., "21:34"
    toiPercentage?: number; // 0-100
    // Goalie stats
    wins?: number;
    losses?: number;
    otl?: number;
    gaa?: number;
    savePct?: number;
    shutouts?: number;
  };
  team: string;
  teamAbbreviation?: string;
  status?: 'IR' | 'SUSP' | 'GTD' | 'WVR' | null;
  // ... other optional fields
}
```

## Next Steps (Phase 2)

- Implement full drag-and-drop logic
- Add position validation
- Integrate with backend API
- Add player search/filter functionality
- Implement save lineup functionality

