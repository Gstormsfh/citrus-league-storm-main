import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { Plus } from "lucide-react";
import { CitrusSparkle } from "@/components/icons/CitrusIcons";

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
  onPlayerClick?: (player: HockeyPlayer) => void;
  className?: string;
  lockedPlayerIds?: Set<string>; // Set of locked player IDs
  tapSelectedPlayerId?: string | number | null; // Mobile tap-to-swap: currently selected player
  tapEligibleSlots?: Set<string>; // Mobile tap-to-swap: slots this player can move to
  onSlotTap?: (slotId: string) => void; // Mobile tap-to-swap: handler when an eligible slot is tapped
  positionType?: PositionType; // 'individual' (C/LW/RW/D/G) or 'forward' (F/D/G)
  rosterSlots?: Record<string, number>; // Custom roster slot counts
}

const StartersGrid = ({ players, slotAssignments = {}, onPlayerClick, className, lockedPlayerIds = new Set(), tapSelectedPlayerId = null, tapEligibleSlots = new Set(), onSlotTap, positionType = 'individual', rosterSlots }: StartersGridProps) => {

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
  const utilCount = getCount('UTIL', 1);
  const bottomRow = [
    ...createIndividualSlots('G', getCount('G', 2)),
    ...Array.from({ length: utilCount }, (_, i) => ({
      id: 'slot-UTIL',
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
          <div className={cn(
            "grid gap-2",
            isForward
              ? "grid-cols-2 sm:grid-cols-3"
              : "grid-cols-2 sm:grid-cols-3"
          )}>
            {forwardRow.map(slot => {
              // Add colored left border based on position
              const getBorderColor = () => {
                if (slot.position === 'F') return 'border-l-2 border-emerald-500 pl-1';
                if (slot.position === 'LW') return 'border-l-2 border-blue-500 pl-1';
                if (slot.position === 'C') return 'border-l-2 border-primary pl-1';
                if (slot.position === 'RW') return 'border-l-2 border-purple-500 pl-1';
                return '';
              };

              return (
                <div key={slot.id} className={getBorderColor()}>
                  {renderSlot(slot)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Row 2: Defense */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Defense
          </h3>
          {/* Same density fix: 4-across defense was ~160px per card in the
              shell column — match the forwards' ~215px readable width. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {defenseRow.map(slot => renderSlot(slot))}
          </div>
        </div>

        {/* Row 3: Goalies & Utility */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Goalies & Utility
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2">
            {bottomRow.map(slot => {
              // Add colored left border for Utility
              if (slot.position === 'UTIL') {
                return (
                  <div key={slot.id} className="border-l-2 border-orange-500 pl-1">
                    {renderSlot(slot)}
                  </div>
                );
              }
              return renderSlot(slot);
            })}
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
  lockedPlayerIds = new Set(),
  tapSelectedPlayerId = null,
  isEligibleTarget = false,
  isSlotSelected = false,
  onSlotTap,
}: PositionSlotProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: slot.id,
    data: {
      type: 'starter-slot',
      position: slot.position,
      maxPlayers: slot.maxPlayers,
    },
  });

  const playerIds = players.map(p => p.id);

  // Position-specific styling
  const positionStyles: Record<string, string> = {
    'LW': 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30',
    'C': 'bg-primary/10 dark:bg-primary/5 border-primary/30 dark:border-primary/20',
    'RW': 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-800/30',
    'UTIL': 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200/50 dark:border-orange-800/30',
    'F': 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30',
  };

  const getPositionStyle = () => {
    if (isEmpty || isOver || isFull) return '';
    return positionStyles[slot.position] || 'border-border/50 bg-card/50';
  };

  const handleSlotTap = () => {
    if (isEligibleTarget && onSlotTap) {
      onSlotTap(slot.id);
    }
  };

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "p-2 transition-all rounded-lg w-full",
        "border-2",
        "min-h-[140px]",
        isOver && "border-citrus-sage bg-citrus-sage/10 shadow-lg",
        isEmpty && !isEligibleTarget && "border-dashed border-citrus-charcoal/20 bg-[#E8EED9]/50 backdrop-blur-sm/50",
        isFull && !isOver && !isSlotSelected && !isEligibleTarget && "border-citrus-sage/30 bg-[#E8EED9]/50 backdrop-blur-sm shadow-sm",
        isSlotSelected && "!border-citrus-orange !bg-citrus-orange/10 shadow-lg",
        isEligibleTarget && !isSlotSelected && "!border-citrus-sage !bg-citrus-sage/15 !border-solid shadow-md cursor-pointer animate-pulse",
      )}
      onClick={isEligibleTarget ? handleSlotTap : undefined}
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
        <SortableContext items={playerIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {players.map((player) => (
              <HockeyPlayerCard
                key={player.id}
                player={player}
                isInSlot={true}
                isLocked={lockedPlayerIds.has(String(player.id))}
                onClick={() => onPlayerClick?.(player)}
                className="border-0 shadow-none bg-transparent"
                isSwapSelected={player.id === tapSelectedPlayerId}
                isSwapTarget={isEligibleTarget && player.id !== tapSelectedPlayerId}
              />
            ))}
          </div>
        </SortableContext>
      ) : (
        <div
          className={cn(
            "flex items-center justify-center h-[130px] rounded border border-dashed transition-all",
            isEligibleTarget ? "border-citrus-sage bg-citrus-sage/10 border-2 cursor-pointer" :
            isOver ? "border-primary bg-primary/10 border-2" : "border-muted-foreground/20 bg-muted/5"
          )}
          onClick={isEligibleTarget ? handleSlotTap : undefined}
        >
          <div className="text-center">
            <Plus className={cn(
              "h-4 w-4 mx-auto mb-1 transition-colors",
              isEligibleTarget ? "text-citrus-sage" :
              isOver ? "text-primary" : "text-muted-foreground/40"
            )} />
            <p className={cn(
              "text-[9px] font-medium",
              isEligibleTarget ? "text-citrus-sage" :
              isOver ? "text-primary" : "text-muted-foreground/40"
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
