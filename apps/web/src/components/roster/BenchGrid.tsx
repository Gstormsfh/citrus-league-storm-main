import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HockeyPlayerCard, { HockeyPlayer } from "./HockeyPlayerCard";
import { CitrusLeaf } from "@/components/icons/CitrusIcons";

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


interface BenchGridProps {
  players: HockeyPlayer[];
  onPlayerClick?: (player: HockeyPlayer) => void; // View player detail (name/headshot tap)
  onPlayerTap?: (player: HockeyPlayer) => void; // Tap-to-swap: select player, or complete a swap (card body tap)
  className?: string;
  lockedPlayerIds?: Set<string>; // Set of locked player IDs
  tapSelectedPlayerId?: string | number | null;
  tapEligibleSlots?: Set<string>; // Tap-to-swap: slots the selected player can move to
  onBenchTap?: () => void; // Handler when the bench's empty space is tapped as a swap target
}

const BenchGrid = ({ players, onPlayerClick, onPlayerTap, className, lockedPlayerIds = new Set(), tapSelectedPlayerId = null, tapEligibleSlots = new Set(), onBenchTap }: BenchGridProps) => {
  // Bench accepts anyone, so it's "the" target the moment any player is
  // selected and bench is in their eligible set — individual cards below
  // are each their own target too (tap one to swap directly against them).
  const isEligibleTarget = tapSelectedPlayerId != null && tapEligibleSlots.has('bench-grid');

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-varsity font-black flex items-center gap-2 text-pastel-cream uppercase tracking-tight">
          <CitrusLeaf className="w-5 h-5 text-citrus-sage" />
          Bench
          <Badge variant="outline" className="ml-2 font-display">
            {players.length} players
          </Badge>
        </h2>
      </div>

      <Card
        className={cn(
          "p-3 transition-all rounded-lg",
          "border-2",
          isEligibleTarget && "!border-citrus-sage !bg-citrus-sage/15 shadow-md",
          !isEligibleTarget && "border-citrus-sage/30 bg-white/5 shadow-sm"
        )}
        onClick={isEligibleTarget && onBenchTap ? onBenchTap : undefined}
      >
        {isEligibleTarget && (
          <div className="text-center mb-2">
            <span className="text-[9px] font-bold text-citrus-sage uppercase tracking-wide">Tap a player or here to move to bench</span>
          </div>
        )}
        {players.length > 0 ? (
          /* Flexbox with fixed-width cards - centered when wrapping to new rows.
             168px, not 140px (2026-08-26): the card spends 8px + 44px headshot
             + 8px gap + 36px position-patch clearance = 96px before a single
             letter of the name is drawn. At 140px that left 44px, which is
             narrower than "Shesterkin" or "MacKinnon" — surnames were being
             clipped mid-glyph. 168px leaves 72px, which clears every surname
             in the league at this weight. It wraps to fewer cards per row;
             the row was already centred and wrapping, so nothing else moves. */
          <div className="flex flex-wrap justify-center gap-1.5">
            {players.map((player) => (
              <div key={player.id} className="flex-shrink-0 w-[168px]">
                <HockeyPlayerCard
                  player={player}
                  isInSlot={false}
                  isLocked={lockedPlayerIds.has(String(player.id))}
                  onClick={() => onPlayerClick?.(player)}
                  onSwapTap={() => onPlayerTap?.(player)}
                  isSwapSelected={player.id === tapSelectedPlayerId}
                  isSwapTarget={isEligibleTarget && player.id !== tapSelectedPlayerId}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={cn(
            "flex items-center justify-center h-[140px] rounded-lg border-2 border-dashed relative overflow-hidden",
            isEligibleTarget ? "border-citrus-sage bg-citrus-sage/10" : "border-citrus-sage/30 bg-white/[0.03]"
          )}>
            {/* Decorative citrus slices in background */}
            <CitrusLeaf className="absolute top-4 left-4 w-16 h-16 text-citrus-sage opacity-10 rotate-12" />
            <CitrusLeaf className="absolute bottom-4 right-4 w-20 h-20 text-citrus-peach opacity-10 -rotate-45" />

            <div className="text-center relative z-10">
              <CitrusLeaf className={cn(
                "w-12 h-12 mx-auto mb-3 transition-colors",
                isEligibleTarget ? "text-citrus-sage" : "text-pastel-cream/60"
              )} />
              <p className={cn(
                "text-sm font-varsity font-bold mb-1 uppercase tracking-wide",
                isEligibleTarget ? "text-pastel-cream" : "text-pastel-cream/70"
              )}>
                {isEligibleTarget ? "Tap to move here" : "No bench players"}
              </p>
              <p className="text-xs font-display text-pastel-cream/65">
                {isEligibleTarget ? "This player can be benched" : "Add players from free agents"}
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default BenchGrid;

