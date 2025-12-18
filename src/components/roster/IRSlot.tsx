import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { Plus, AlertCircle } from "lucide-react";

interface IRSlotProps {
  players: HockeyPlayer[];
  slotAssignments?: Record<string | number, string>; // Map of Player ID -> Slot ID
  onPlayerClick?: (player: HockeyPlayer) => void;
  className?: string;
}

interface IndividualIRSlotProps {
  slotId: string;
  slotNumber: number;
  player: HockeyPlayer | undefined;
  isEmpty: boolean;
  onPlayerClick?: (player: HockeyPlayer) => void;
}

const IndividualIRSlot = ({ 
  slotId, 
  slotNumber,
  player, 
  isEmpty,
  onPlayerClick 
}: IndividualIRSlotProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: {
      type: 'ir-slot',
      slotNumber,
    },
  });

  const playerIds = player ? [player.id] : [];

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "p-2 transition-all rounded-md min-h-[110px] w-full",
        "border-2",
        isOver && "border-red-500 bg-red-500/10 shadow-md",
        isEmpty && !isOver && "border-dashed border-red-300/50 bg-red-50/30 dark:bg-red-950/10",
        !isEmpty && !isOver && "border-red-500/30 bg-red-500/5"
      )}
    >
      {/* Slot Header */}
      <div className="flex items-center justify-between mb-1">
        <Badge 
          variant="outline" 
          className={cn(
            "text-[9px] font-bold px-1 py-0 h-4",
            isEmpty ? "text-muted-foreground border-muted-foreground/30" : "text-red-600 border-red-500/50 bg-red-500/10"
          )}
        >
          IR {slotNumber}
        </Badge>
      </div>

      {/* Player or Empty State */}
      {player ? (
        <SortableContext items={playerIds} strategy={verticalListSortingStrategy}>
          <HockeyPlayerCard
            player={player}
            isInSlot={true}
            onClick={() => onPlayerClick?.(player)}
            className="border-0 shadow-none bg-transparent"
          />
        </SortableContext>
      ) : (
        <div className={cn(
          "flex items-center justify-center h-[80px] rounded border border-dashed transition-all",
          isOver ? "border-red-500 bg-red-500/10 border-2" : "border-red-300/30 bg-red-50/20 dark:bg-red-950/5"
        )}>
          <div className="text-center">
            <Plus className={cn(
              "h-4 w-4 mx-auto mb-1 transition-colors",
              isOver ? "text-red-500" : "text-muted-foreground/40"
            )} />
            <p className={cn(
              "text-[9px] font-medium",
              isOver ? "text-red-500" : "text-muted-foreground/60"
            )}>
              {isOver ? "Drop here" : "Empty"}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};

const IRSlot = ({ players, slotAssignments = {}, onPlayerClick, className }: IRSlotProps) => {
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
          return (
            <IndividualIRSlot
              key={slot.id}
              slotId={slot.id}
              slotNumber={slot.number}
              player={player}
              isEmpty={!player}
              onPlayerClick={onPlayerClick}
            />
          );
        })}
      </div>
    </div>
  );
};

export default IRSlot;

