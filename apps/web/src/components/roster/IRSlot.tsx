import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { Plus, AlertCircle } from "lucide-react";

interface IRSlotProps {
  players: HockeyPlayer[];
  slotAssignments?: Record<string | number, string>; // Map of Player ID -> Slot ID
  onPlayerClick?: (player: HockeyPlayer) => void; // View player detail (name/headshot tap)
  onPlayerTap?: (player: HockeyPlayer) => void; // Tap-to-swap: select player, or complete a swap (card body tap)
  className?: string;
  lockedPlayerIds?: Set<string>; // Set of locked player IDs
  tapSelectedPlayerId?: string | number | null; // Tap-to-swap: currently selected player
  tapEligibleSlots?: Set<string>; // Tap-to-swap: slots the selected player can move to (IR-eligible players only)
  onSlotTap?: (slotId: string) => void; // Tap-to-swap: handler when an eligible empty IR slot is tapped
}

interface IndividualIRSlotProps {
  slotId: string;
  slotNumber: number;
  player: HockeyPlayer | undefined;
  isEmpty: boolean;
  onPlayerClick?: (player: HockeyPlayer) => void;
  onPlayerTap?: (player: HockeyPlayer) => void;
  lockedPlayerIds?: Set<string>;
  isEligibleTarget?: boolean;
  isSlotSelected?: boolean;
  onSlotTap?: (slotId: string) => void;
}

const IndividualIRSlot = ({
  slotId,
  slotNumber,
  player,
  isEmpty,
  onPlayerClick,
  onPlayerTap,
  lockedPlayerIds = new Set(),
  isEligibleTarget = false,
  isSlotSelected = false,
  onSlotTap,
}: IndividualIRSlotProps) => {
  const handleSlotTap = () => {
    if (isEligibleTarget && onSlotTap) {
      onSlotTap(slotId);
    }
  };

  return (
    <Card
      className={cn(
        "p-2 transition-all rounded-lg min-h-[140px] w-full",
        "border-2",
        isEmpty && !isEligibleTarget && "border-dashed border-red-400/30 bg-white/[0.03]",
        !isEmpty && !isSlotSelected && !isEligibleTarget && "border-red-400/30 bg-white/5 shadow-sm",
        isSlotSelected && "!border-citrus-orange !bg-citrus-orange/10 shadow-lg",
        isEligibleTarget && !isSlotSelected && "!border-citrus-sage !bg-citrus-sage/15 !border-solid shadow-md cursor-pointer animate-pulse",
      )}
      // Only the outer Card handles the tap when the slot is EMPTY — when it's
      // full, the HockeyPlayerCard inside owns its own tap (onSwapTap below).
      onClick={isEmpty && isEligibleTarget ? handleSlotTap : undefined}
    >
      {/* Slot Header */}
      <div className="flex items-center justify-between mb-1">
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] font-bold px-1 py-0 h-4",
            isEligibleTarget && !isSlotSelected ? "text-citrus-sage border-citrus-sage" :
            isEmpty ? "text-muted-foreground border-muted-foreground/30" : "text-red-400 border-red-500/50 bg-red-500/10"
          )}
        >
          IR {slotNumber}
        </Badge>
        {isEligibleTarget && !isSlotSelected && (
          <span className="text-[8px] font-bold text-citrus-sage uppercase tracking-wide">Tap to move</span>
        )}
      </div>

      {/* Player or Empty State */}
      {player ? (
        <HockeyPlayerCard
          player={player}
          isInSlot={true}
          isLocked={lockedPlayerIds.has(String(player.id))}
          onClick={() => onPlayerClick?.(player)}
          onSwapTap={() => onPlayerTap?.(player)}
          className="border-0 shadow-none bg-transparent"
          isSwapSelected={isSlotSelected}
          isSwapTarget={isEligibleTarget && !isSlotSelected}
        />
      ) : (
        <div className={cn(
          "flex items-center justify-center h-[110px] rounded border border-dashed transition-all",
          isEligibleTarget ? "border-citrus-sage bg-citrus-sage/10 border-2" : "border-red-300/30 bg-red-950/20"
        )}>
          <div className="text-center">
            <Plus className={cn(
              "h-4 w-4 mx-auto mb-1 transition-colors",
              isEligibleTarget ? "text-citrus-sage" : "text-muted-foreground/40"
            )} />
            <p className={cn(
              "text-[9px] font-medium",
              isEligibleTarget ? "text-citrus-sage" : "text-muted-foreground/60"
            )}>
              {isEligibleTarget ? "Move here" : "Empty"}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};

const IRSlot = ({ players, slotAssignments = {}, onPlayerClick, onPlayerTap, className, lockedPlayerIds = new Set(), tapSelectedPlayerId = null, tapEligibleSlots = new Set(), onSlotTap }: IRSlotProps) => {
  const getPlayerInSlot = (slotId: string) => {
    const playerId = Object.keys(slotAssignments).find(key => slotAssignments[key] === slotId);
    if (!playerId) return undefined;
    return players.find(p => String(p.id) === String(playerId));
  };

  const irSlots = [
    { id: 'ir-slot-1', number: 1 },
    { id: 'ir-slot-2', number: 2 },
    { id: 'ir-slot-3', number: 3 },
  ];

  const filledSlots = irSlots.filter(slot => getPlayerInSlot(slot.id)).length;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-500" />
          Injured Reserve
          <Badge variant="outline" className="ml-2 text-xs">
            {filledSlots}/3
          </Badge>
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {irSlots.map((slot) => {
          const player = getPlayerInSlot(slot.id);
          const isEligibleTarget = tapSelectedPlayerId != null && tapEligibleSlots.has(slot.id);
          const isSlotSelected = player != null && player.id === tapSelectedPlayerId;
          return (
            <IndividualIRSlot
              key={slot.id}
              slotId={slot.id}
              slotNumber={slot.number}
              player={player}
              isEmpty={!player}
              onPlayerClick={onPlayerClick}
              onPlayerTap={onPlayerTap}
              lockedPlayerIds={lockedPlayerIds}
              isEligibleTarget={isEligibleTarget}
              isSlotSelected={isSlotSelected}
              onSlotTap={onSlotTap}
            />
          );
        })}
      </div>
    </div>
  );
};

export default IRSlot;

