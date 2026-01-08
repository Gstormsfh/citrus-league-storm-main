import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";

interface BenchGridProps {
  players: HockeyPlayer[];
  onPlayerClick?: (player: HockeyPlayer) => void;
  className?: string;
  lockedPlayerIds?: Set<string>; // Set of locked player IDs
}

// Helper to normalize position to standard abbreviations
const normalizePosition = (position: string): string => {
  const pos = position?.toUpperCase() || '';
  
  if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
  if (['G', 'GOALIE'].includes(pos)) return 'G';
  
  return pos.substring(0, 2);
};

// Get position border color (matching StartersGrid)
const getPositionBorderColor = (position: string): string => {
  const pos = normalizePosition(position);
  switch (pos) {
    case 'LW': return 'border-l-2 border-blue-500';
    case 'C': return 'border-l-2 border-primary';
    case 'RW': return 'border-l-2 border-purple-500';
    case 'D': return 'border-l-2 border-slate-400';
    case 'G': return 'border-l-2 border-amber-500';
    default: return 'border-l-2 border-border';
  }
};

const BenchGrid = ({ players, onPlayerClick, className, lockedPlayerIds = new Set() }: BenchGridProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'bench-grid',
    data: {
      type: 'bench',
    },
  });

  const playerIds = players.map(p => p.id);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          Bench
          <Badge variant="outline" className="ml-2">
            {players.length} players
          </Badge>
        </h2>
      </div>

      <Card
        ref={setNodeRef}
        className={cn(
          "p-3 transition-all",
          "border-2",
          isOver && "border-primary bg-primary/5 border-dashed",
          !isOver && "border-border"
        )}
      >
        {players.length > 0 ? (
          <SortableContext items={playerIds} strategy={rectSortingStrategy}>
            {/* Flexbox with fixed-width cards - centered when wrapping to new rows */}
            <div className="flex flex-wrap justify-center gap-1.5">
              {players.map((player) => {
                const borderColor = getPositionBorderColor(player.position);
                return (
                  <div key={player.id} className={cn(borderColor, "pl-1 flex-shrink-0 w-[140px]")}>
                    <HockeyPlayerCard
                      player={player}
                      isInSlot={false}
                      isLocked={lockedPlayerIds.has(String(player.id))}
                      onClick={() => onPlayerClick?.(player)}
                    />
                  </div>
                );
              })}
            </div>
          </SortableContext>
        ) : (
          <div className={cn(
            "flex items-center justify-center h-64 rounded-lg border-2 border-dashed",
            isOver ? "border-primary bg-primary/10" : "border-muted-foreground/20 bg-muted/10"
          )}>
            <div className="text-center">
              <p className={cn(
                "text-sm font-medium mb-1",
                isOver ? "text-primary" : "text-muted-foreground"
              )}>
                {isOver ? "Drop players here" : "No bench players"}
              </p>
              <p className="text-xs text-muted-foreground">
                Drag players from starters or add from free agents
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default BenchGrid;

