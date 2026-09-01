# Roster Components

Sleeper/ESPN/Yahoo-style tap-to-swap roster management. **There is no
drag-and-drop anywhere in this directory (removed 2026-08-25)** — lineup
changes are click/tap: select a player, its eligible slots highlight,
tap a highlighted slot (or another player) to swap. `@dnd-kit` remains an
`apps/web` dependency only because the draft room (`DraftQueue.tsx`) still
uses it directly — nothing in this directory imports from it.

## Components

### HockeyPlayerCard
Displays comprehensive hockey player statistics. The card itself owns two
things every consumer used to have to remember separately: a position
colour accent (`POSITION_ACCENT` — a left spine + badge tint, so a slot is
identifiable at a glance in starters, bench, and IR alike) and the
tap-to-swap interaction (card body = select/swap; name = view detail).

**Features:**
- Position-accented (colour by C/LW/RW/D/G/F/UTIL — see `POSITION_ACCENT`)
- Displays key stats: G, A, +/-, SOG, BLK, HIT, PPP, SHP
- TOI (Time On Ice) visual bar
- Status indicators: IR, SUSP, GTD, WVR (inline next to the name)
- Team abbreviation and position badge
- Goalie-specific stats display

**Props:**
```typescript
interface HockeyPlayerCardProps {
  player: HockeyPlayer;
  onClick?: () => void;      // View player detail (name/headshot tap)
  onSwapTap?: () => void;    // Select for swap, or complete one (card body tap)
  className?: string;
  isInSlot?: boolean;
  isLocked?: boolean;
  isSwapSelected?: boolean;
  isSwapTarget?: boolean;
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
- Tap-eligible-slot highlighting (via `tapSelectedPlayerId`/`tapEligibleSlots`)
- Shows slot capacity (current/max)
- Empty slot indicators, always rendered (the tap target for a swap)

### BenchGrid
A flexible grid for bench players.

**Features:**
- Responsive grid (2-6 columns based on screen size), every bench player
  itself a tap target once someone is selected
- Whole-bench tap target (`onBenchTap`) for the empty-bench case

### IRSlot
Three fixed IR slots. Tap-eligible like the others — `isPositionValid`
gates IR slots on `is_ir_eligible`, so only officially IR/LTIR players can
be tapped into one.

### MobileRosterList (phones and portrait tablets, `< 1024px`)
List rows: position chip · crest · name / team · opp · time / live line ·
tonight's number. The **position chip is the swap trigger** (Sleeper,
Yahoo and ESPN use the same gesture) and wears a `⇄` glyph to say so; a
locked player's chip goes neutral with a lock glyph (`LOCKED_CHIP` in
`slotChip.ts`) while the rest of his row stays fully legible. An **empty
starter row is one tap target**: with a player selected it is the move
target, with nothing selected it opens the Fill sheet. Pass `swapHint` on
editable lists to show the one-time "Tap a position to swap" toast
(`useSwapHint`, localStorage-backed, try/catch).

### SlotPickerMenu ("Line change") and FillSlotSheet ("Fill a spot")
Two directions of the same move, one bottom-sheet language. Line change is
player-first (tap a player, pick a destination — occupant and tonight's
number shown per row). Fill is slot-first (tap an empty row, pick who steps
in from the bench — games first, then projection; locked bench players
listed but disabled). Neither recomputes eligibility: both take the set
Roster.tsx judged legal (`tapEligibleSlots` / `fillCandidates`). Shared
pieces: `Mug` (headshot with initials fallback), `tonight()` (live vs
projected number), `chipClassFor()` / `slotLabel()`.

### TodayStrip + `computeTodaySummary`
The game-day readout beneath the day selector — `9/13 starters play · 2 on
bench with games · proj 41.6 · 3 locked`. Pure arithmetic over the page's
enriched roster (`todaySummary.ts`, tested on its own). Amber only when a
bench player has a game while a starter spot is empty or idle, and only on
an editable day; in that state it carries the Auto Lineup action inline.

## Usage Example

```tsx
import { StartersGrid, BenchGrid, IRSlot, HockeyPlayer } from '@/components/roster';

function RosterPage() {
  const [starters, setStarters] = useState<HockeyPlayer[]>([]);
  const [bench, setBench] = useState<HockeyPlayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const handlePlayerTap = (player: HockeyPlayer) => {
    // Select player, or — if one's already selected — attempt a swap
    // against this one. See Roster.tsx's handleMobileTapPlayer for the
    // full select/deselect/swap state machine (shared by mobile & desktop).
  };

  return (
    <>
      <StartersGrid
        players={starters}
        onPlayerClick={(player) => console.log('view detail', player)}
        onPlayerTap={handlePlayerTap}
        tapSelectedPlayerId={selectedId}
      />
      <BenchGrid
        players={bench}
        onPlayerClick={(player) => console.log('view detail', player)}
        onPlayerTap={handlePlayerTap}
        tapSelectedPlayerId={selectedId}
      />
    </>
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

## Status

Position validation, backend save (`LeagueService.saveLineup`), and
tap-to-swap are all live — see `Roster.tsx` for the orchestration
(`applyPlayerMove`, `tapEligibleSlots`, `isPositionValid`). Player
search/filter lives on the Free Agents page, not here.

Open items tracked outside this directory: per-player generated writeups,
and the "Games This Week" widget's all-zero data bug.

