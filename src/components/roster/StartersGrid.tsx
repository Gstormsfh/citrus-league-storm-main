import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { Plus } from "lucide-react";
import { CitrusSparkle } from "@/components/icons/CitrusIcons";

interface PositionSlot {
  id: string;
  position: 'C' | 'LW' | 'RW' | 'D' | 'G' | 'UTIL';
  label: string;
  maxPlayers: number;
}

const positionSlots: PositionSlot[] = [
  { id: 'slot-C', position: 'C', label: 'Center', maxPlayers: 2 },
  { id: 'slot-LW', position: 'LW', label: 'Left Wing', maxPlayers: 2 },
  { id: 'slot-RW', position: 'RW', label: 'Right Wing', maxPlayers: 2 },
  { id: 'slot-D', position: 'D', label: 'Defense', maxPlayers: 4 },
  { id: 'slot-G', position: 'G', label: 'Goalie', maxPlayers: 2 },
  { id: 'slot-UTIL', position: 'UTIL', label: 'Utility', maxPlayers: 1 },
];

// Create individual slots for defense (4 slots) and goalies (2 slots)
const createIndividualSlots = (position: 'D' | 'G' | 'C' | 'LW' | 'RW', count: number): PositionSlot[] => {
  const baseSlot = positionSlots.find(s => s.position === position);
  if (!baseSlot) return [];
  
  return Array.from({ length: count }, (_, i) => ({
    ...baseSlot,
    id: `${baseSlot.id}-${i + 1}`,
    label: `${baseSlot.label} ${i + 1}`,
    maxPlayers: 1, // Each individual slot holds 1 player
  }));
};

interface StartersGridProps {
  players: HockeyPlayer[];
  slotAssignments?: Record<string | number, string>; // Map of Player ID -> Slot ID
  onPlayerClick?: (player: HockeyPlayer) => void;
  className?: string;
  lockedPlayerIds?: Set<string>; // Set of locked player IDs
}

const StartersGrid = ({ players, slotAssignments = {}, onPlayerClick, className, lockedPlayerIds = new Set() }: StartersGridProps) => {
  
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

     return (
       <div key={slot.id} className="w-full">
         <PositionSlot
           slot={slot}
           players={slotPlayers}
           isFull={isFull}
           isEmpty={isEmpty}
           onPlayerClick={onPlayerClick}
           lockedPlayerIds={lockedPlayerIds}
         />
       </div>
     );
  };

  // Group slots by row for visual stacking
  // Row 1: LW, C, RW (Top Left, Middle, Top Right)
  const forwardRow = [
    ...createIndividualSlots('LW', 2),
    ...createIndividualSlots('C', 2),
    ...createIndividualSlots('RW', 2)
  ];
  
  // Row 2: Defense (Centered below)
  const defenseRow = createIndividualSlots('D', 4);

  // Row 3: Goalies & Utility (Bottom)
  const bottomRow = [
    ...createIndividualSlots('G', 2),
    ...positionSlots.filter(slot => slot.position === 'UTIL')
  ];

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-varsity font-black flex items-center gap-2 text-citrus-forest uppercase tracking-tight">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {forwardRow.map(slot => {
              // Add colored left border based on position
              const getBorderColor = () => {
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
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:w-2/3 lg:mx-auto gap-2">
            {defenseRow.map(slot => renderSlot(slot))}
          </div>
        </div>

        {/* Row 3: Goalies & Utility */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Goalies & Utility
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:w-1/2 lg:mx-auto gap-2">
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
}

const PositionSlot = ({ 
  slot, 
  players, 
  isFull, 
  isEmpty, 
  onPlayerClick,
  lockedPlayerIds = new Set()
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
  };

  const getPositionStyle = () => {
    if (isEmpty || isOver || isFull) return '';
    return positionStyles[slot.position] || 'border-border/50 bg-card/50';
  };

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "p-2 transition-all rounded-lg min-h-[110px] w-full", 
        "border-2",
        isOver && "border-citrus-sage bg-citrus-sage/10 shadow-lg",
        isEmpty && "border-dashed border-citrus-charcoal/20 bg-citrus-cream/50",
        isFull && !isOver && "border-citrus-sage/30 bg-citrus-cream shadow-sm"
      )}
    >
      {/* Compact Slot Header */}
      <div className="flex items-center justify-between mb-1">
        <Badge 
          variant="outline" 
          className={cn(
            "text-[9px] font-bold px-1 py-0 h-4",
            isEmpty ? "text-muted-foreground border-muted-foreground/30" : "text-foreground border-border"
          )}
        >
          {slot.position}
        </Badge>
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
              />
            ))}
          </div>
        </SortableContext>
      ) : (
        <div className={cn(
          "flex items-center justify-center h-[80px] rounded border border-dashed transition-all",
          isOver ? "border-primary bg-primary/10 border-2" : "border-muted-foreground/20 bg-muted/5"
        )}>
          <div className="text-center">
            <Plus className={cn(
              "h-4 w-4 mx-auto mb-1 transition-colors",
              isOver ? "text-primary" : "text-muted-foreground/40"
            )} />
            <p className={cn(
              "text-[9px] font-medium",
              isOver ? "text-primary" : "text-muted-foreground/60"
            )}>
              Empty
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};

export default StartersGrid;
