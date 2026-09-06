import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { Plus } from "lucide-react";
import { CitrusSparkle } from "@/components/icons/CitrusIcons";

import { buildSlotConfig } from './slotConfig';
import type { PositionType } from "@/utils/rosterUtils";

interface PositionSlot {
  id: string;
  position: 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL' | 'F';
  label: string;
  maxPlayers: number;
}

const POSITION_LABELS: Record<string, string> = {
  C: 'Center',
  LW: 'Left Wing',
  RW: 'Right Wing',
  D: 'Defense',
  G: 'Goalie',
  UTIL: 'Utility',
  F: 'Forward',
};

// Create individual slots for a given position and count
const createIndividualSlots = (position: string, count: number): PositionSlot[] => {
  const label = POSITION_LABELS[position] || position;
  return Array.from({ length: count }, (_, i) => ({
    id: `slot-${position}-${i + 1}`,
    position: position as PositionSlot['position'],
    label: `${label} ${i + 1}`,
    maxPlayers: 1,
  }));
};

interface StartersGridProps {
  players: HockeyPlayer[];
  slotAssignments?: Record<string | number, string>; // Map of Player ID -> Slot ID
  onPlayerClick?: (player: HockeyPlayer) => void; // View player detail (name/headshot tap)
  onPlayerTap?: (player: HockeyPlayer) => void; // Tap-to-swap: select player, or complete a swap (card body tap)
  className?: string;
  lockedPlayerIds?: Set<string>; // Set of locked player IDs
  tapSelectedPlayerId?: string | number | null; // Tap-to-swap: currently selected player
  tapEligibleSlots?: Set<string>; // Tap-to-swap: slots this player can move to
  onSlotTap?: (slotId: string) => void; // Tap-to-swap: handler when an eligible slot is tapped
  positionType?: PositionType; // 'individual' (C/LW/RW/D/G) or 'forward' (F/D/G)
  rosterSlots?: Record<string, number>; // Custom roster slot counts
}

const StartersGrid = ({ players, slotAssignments = {}, onPlayerClick, onPlayerTap, className, lockedPlayerIds = new Set(), tapSelectedPlayerId = null, tapEligibleSlots = new Set(), onSlotTap, positionType = 'individual', rosterSlots }: StartersGridProps) => {

  const getPlayerInSlot = (slotId: string) => {
    // Look for key in slotAssignments where value is slotId
    // Cast key to string for comparison since Object.keys returns strings
    const playerId = Object.keys(slotAssignments).find(key => slotAssignments[key] === slotId);
    if (!playerId) return undefined;

    // Loose comparison to catch both string/number IDs
    return players.find(p => String(p.id) === String(playerId));
  };

  const renderSlot = (slot: PositionSlot) => {
     const player = getPlayerInSlot(slot.id);
     const slotPlayers = player ? [player] : [];
     const isFull = !!player;
     const isEmpty = !player;
     const isEligibleTarget = tapSelectedPlayerId != null && tapEligibleSlots.has(slot.id);
     const isSelected = player != null && player.id === tapSelectedPlayerId;

     return (
       <div key={slot.id} className="w-full">
         <PositionSlot
           slot={slot}
           players={slotPlayers}
           isFull={isFull}
           isEmpty={isEmpty}
           onPlayerClick={onPlayerClick}
           onPlayerTap={onPlayerTap}
           lockedPlayerIds={lockedPlayerIds}
           tapSelectedPlayerId={tapSelectedPlayerId}
           isEligibleTarget={isEligibleTarget}
           isSlotSelected={isSelected}
           onSlotTap={onSlotTap}
         />
       </div>
     );
  };

  // Get slot counts from rosterSlots prop or defaults
  const getCount = (pos: string, fallback: number) => rosterSlots?.[pos] ?? fallback;

  // Group slots by row for visual stacking
  const isForward = positionType === 'forward';

  // Row 1: Forwards
  const forwardRow = isForward
    ? createIndividualSlots('F', getCount('F', 6))
    : [
        ...createIndividualSlots('LW', getCount('LW', 2)),
        ...createIndividualSlots('C', getCount('C', 2)),
        ...createIndividualSlots('RW', getCount('RW', 2)),
      ];

  // Row 2: Defense
  const defenseRow = createIndividualSlots('D', getCount('D', 4));

  // Row 3: Goalies & Utility
  const slotConfig = buildSlotConfig(positionType, rosterSlots);
  const bottomRow = [
    ...createIndividualSlots('G', getCount('G', 2)),
    ...slotConfig.utilSlots.map(id => ({
      id,
      position: 'UTIL' as const,
      label: 'Utility',
      maxPlayers: 1,
    })),
  ];

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-varsity font-black flex items-center gap-2 text-pastel-cream uppercase tracking-tight">
          <CitrusSparkle className="w-5 h-5 text-citrus-orange" />
          Starting Lineup
        </h2>
      </div>

      {/* Visual Layout: Stacked Rows */}
      <div className="flex flex-col gap-6">

        {/* Row 1: Forwards (LW - C - RW) */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Forwards
          </h3>
          {/* DESKTOP DENSITY FIX (2026-08-24): md:grid-cols-6 crushed six
              forward cards into ~105px each inside the three-column app
              shell (~675px main column) — stat lines were unreadable soup.
              Three per row gives ~215px cards; forwards wrap to two rows. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2">
            {/* Position colour now lives on the card itself (its left spine) —
                consistent everywhere it renders, instead of a wrapper border
                that this row remembered to apply and the defense/goalie rows
                below did not. */}
            {forwardRow.map(slot => renderSlot(slot))}
          </div>
        </div>

        {/* Row 2: Defense */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Defense
          </h3>
          {/* Same density fix: 4-across defense was ~160px per card in the
              shell column — match the forwards' ~215px readable width. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2">
            {defenseRow.map(slot => renderSlot(slot))}
          </div>
        </div>

        {/* Row 3: Goalies & Utility */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Goalies & Utility
          </h3>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2">
            {bottomRow.map(slot => renderSlot(slot))}
          </div>
        </div>

      </div>
    </div>
  );
};

interface PositionSlotProps {
  slot: PositionSlot;
  players: HockeyPlayer[];
  isFull: boolean;
  isEmpty: boolean;
  onPlayerClick?: (player: HockeyPlayer) => void;
  onPlayerTap?: (player: HockeyPlayer) => void;
  lockedPlayerIds?: Set<string>;
  tapSelectedPlayerId?: string | number | null;
  isEligibleTarget?: boolean;
  isSlotSelected?: boolean;
  onSlotTap?: (slotId: string) => void;
}

const PositionSlot = ({
  slot,
  players,
  isFull,
  isEmpty,
  onPlayerClick,
  onPlayerTap,
  lockedPlayerIds = new Set(),
  tapSelectedPlayerId = null,
  isEligibleTarget = false,
  isSlotSelected = false,
  onSlotTap,
}: PositionSlotProps) => {
  const handleSlotTap = () => {
    if (isEligibleTarget && onSlotTap) {
      onSlotTap(slot.id);
    }
  };

  return (
    <Card
      className={cn(
        "p-2 transition-all rounded-lg w-full",
        "border-2",
        "min-h-[140px]",
        isEmpty && !isEligibleTarget && "border-dashed border-white/15 bg-white/[0.03]",
        isFull && !isSlotSelected && !isEligibleTarget && "border-citrus-sage/30 bg-white/5 shadow-sm",
        isSlotSelected && "!border-citrus-orange !bg-citrus-orange/10 shadow-lg",
        isEligibleTarget && !isSlotSelected && "!border-citrus-sage !bg-citrus-sage/15 !border-solid shadow-md cursor-pointer animate-pulse",
      )}
      // Only the outer Card handles the tap when the slot is EMPTY — when it's
      // full, the HockeyPlayerCard inside owns its own tap (onSwapTap below).
      // Wiring both here too would double-fire on click-bubble.
      onClick={isEmpty && isEligibleTarget ? handleSlotTap : undefined}
    >
      {/* Compact Slot Header */}
      <div className="flex items-center justify-between mb-1">
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] font-bold px-1 py-0 h-4",
            isEligibleTarget && !isSlotSelected ? "text-citrus-sage border-citrus-sage" :
            isEmpty ? "text-muted-foreground border-muted-foreground/30" : "text-foreground border-border"
          )}
        >
          {slot.position}
        </Badge>
        {isEligibleTarget && !isSlotSelected && (
          <span className="text-[8px] font-bold text-citrus-sage uppercase tracking-wide">Tap to move</span>
        )}
      </div>

      {/* Players Grid */}
      {players.length > 0 ? (
        <div className="space-y-1">
          {players.map((player) => (
            <HockeyPlayerCard
              key={player.id}
              player={player}
              isInSlot={true}
              isLocked={lockedPlayerIds.has(String(player.id))}
              onClick={() => onPlayerClick?.(player)}
              onSwapTap={() => onPlayerTap?.(player)}
              className="border-0 shadow-none bg-transparent"
              isSwapSelected={player.id === tapSelectedPlayerId}
              isSwapTarget={isEligibleTarget && player.id !== tapSelectedPlayerId}
            />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "flex items-center justify-center h-[130px] rounded border border-dashed transition-all",
            isEligibleTarget ? "border-citrus-sage bg-citrus-sage/10 border-2 cursor-pointer" : "border-muted-foreground/20 bg-muted/5"
          )}
        >
          <div className="text-center">
            <Plus className={cn(
              "h-4 w-4 mx-auto mb-1 transition-colors",
              isEligibleTarget ? "text-citrus-sage" : "text-muted-foreground/40"
            )} />
            <p className={cn(
              "text-[9px] font-medium",
              isEligibleTarget ? "text-citrus-sage" : "text-muted-foreground/40"
            )}>
              {isEligibleTarget ? "Move here" : "Empty"}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};

export default StartersGrid;
