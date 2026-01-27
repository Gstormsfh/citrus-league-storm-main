import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { CitrusLeaf } from "@/components/icons/CitrusIcons";

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
        <h2 className="text-xl font-varsity font-black flex items-center gap-2 text-citrus-forest uppercase tracking-tight">
          <CitrusLeaf className="w-5 h-5 text-citrus-sage" />
          Bench
          <Badge variant="outline" className="ml-2 font-display">
            {players.length} players
          </Badge>
        </h2>
      </div>

      <Card
        ref={setNodeRef}
        className={cn(
          "p-3 transition-all rounded-lg",
          "border-2",
          isOver && "border-citrus-sage bg-citrus-sage/10 shadow-lg",
          !isOver && "border-citrus-sage/30 bg-[#E8EED9]/50 backdrop-blur-sm shadow-sm"
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
            "flex items-center justify-center h-64 rounded-lg border-2 border-dashed relative overflow-hidden",
            isOver ? "border-citrus-sage bg-citrus-sage/10" : "border-citrus-sage/30 bg-[#E8EED9]/50 backdrop-blur-sm/50"
          )}>
            {/* Decorative citrus slices in background */}
            <CitrusLeaf className="absolute top-4 left-4 w-16 h-16 text-citrus-sage opacity-10 rotate-12" />
            <CitrusLeaf className="absolute bottom-4 right-4 w-20 h-20 text-citrus-peach opacity-10 -rotate-45" />
            
            <div className="text-center relative z-10">
              <CitrusLeaf className={cn(
                "w-12 h-12 mx-auto mb-3 transition-colors",
                isOver ? "text-citrus-sage" : "text-citrus-charcoal/40"
              )} />
              <p className={cn(
                "text-sm font-varsity font-bold mb-1 uppercase tracking-wide",
                isOver ? "text-citrus-forest" : "text-citrus-charcoal/60"
              )}>
                {isOver ? "Drop players here" : "No bench players"}
              </p>
              <p className="text-xs font-display text-citrus-charcoal/50">
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

