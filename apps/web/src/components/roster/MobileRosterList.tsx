import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Lock, Shield, CalendarDays, Skull, AlertCircle } from "lucide-react";
import { HockeyPlayer } from "./HockeyPlayerCard";
import { CitrusSparkle, CitrusLeaf } from "@/components/icons/CitrusIcons";
import { useState } from "react";

// ─── Position helpers ────────────────────────────────────────────────
const getPositionAbbr = (pos: string) => {
  const p = pos?.toUpperCase() || '';
  if (['C', 'CENTRE', 'CENTER'].includes(p)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(p)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(p)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(p)) return 'D';
  if (['G', 'GOALIE'].includes(p)) return 'G';
  return p.substring(0, 2);
};

const posColor: Record<string, string> = {
  LW: 'bg-citrus-green-dark',
  C: 'bg-citrus-sage',
  RW: 'bg-citrus-orange',
  D: 'bg-citrus-forest',
  G: 'bg-citrus-peach text-citrus-forest',
  UTIL: 'bg-citrus-green-medium',
};

const posRingColor: Record<string, string> = {
  LW: 'ring-citrus-green-dark/30',
  C: 'ring-citrus-sage/30',
  RW: 'ring-citrus-orange/30',
  D: 'ring-citrus-forest/30',
  G: 'ring-citrus-peach/50',
  UTIL: 'ring-citrus-green-medium/30',
};

// ─── Interfaces ──────────────────────────────────────────────────────
interface MobileRosterListProps {
  starters: HockeyPlayer[];
  bench: HockeyPlayer[];
  ir: HockeyPlayer[];
  slotAssignments: Record<string | number, string>;
  lockedPlayerIds?: Set<string>;
  tapSelectedPlayerId?: string | number | null;
  tapEligibleSlots?: Set<string>;
  onPlayerTap?: (player: HockeyPlayer) => void;
  onSlotTap?: (slotId: string) => void;
  onBenchTap?: () => void;
}

// Map slot IDs to display labels
const slotLabel: Record<string, string> = {
  'slot-LW-1': 'LW', 'slot-LW-2': 'LW',
  'slot-C-1': 'C', 'slot-C-2': 'C',
  'slot-RW-1': 'RW', 'slot-RW-2': 'RW',
  'slot-D-1': 'D', 'slot-D-2': 'D', 'slot-D-3': 'D', 'slot-D-4': 'D',
  'slot-G-1': 'G', 'slot-G-2': 'G',
  'slot-UTIL': 'UTIL',
};

const ALL_STARTER_SLOTS = [
  'slot-LW-1', 'slot-LW-2', 'slot-C-1', 'slot-C-2', 'slot-RW-1', 'slot-RW-2',
  'slot-D-1', 'slot-D-2', 'slot-D-3', 'slot-D-4',
  'slot-G-1', 'slot-G-2', 'slot-UTIL',
];

// ─── Format compact stat line from daily projection ─────────────────
const formatProjectedStatLine = (player: HockeyPlayer): string | null => {
  const isGoalie = player.position === 'Goalie' || player.position === 'G';

  if (isGoalie && player.goalieProjection) {
    const gp = player.goalieProjection;
    const parts: string[] = [];
    if (gp.projected_saves > 0) parts.push(`${Math.round(gp.projected_saves)} SV`);
    if (gp.projected_goals_against > 0) parts.push(`${gp.projected_goals_against.toFixed(1)} GA`);
    if (gp.projected_wins >= 0.5) parts.push(`W`);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (!isGoalie && player.daily_projection) {
    const dp = player.daily_projection;
    const parts: string[] = [];
    if (dp.projected_goals >= 0.3) parts.push(`${dp.projected_goals.toFixed(1)}G`);
    if (dp.projected_assists >= 0.3) parts.push(`${dp.projected_assists.toFixed(1)}A`);
    if (dp.projected_sog >= 1) parts.push(`${dp.projected_sog.toFixed(0)} SOG`);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  return null;
};

// ─── Single Row ──────────────────────────────────────────────────────
interface PlayerRowProps {
  player: HockeyPlayer | null;
  slotId: string;
  slotPosition: string;
  isLocked?: boolean;
  isSwapSelected?: boolean;
  isEligibleTarget?: boolean;
  onTap?: () => void;
}

const PlayerRow = ({ player, slotId, slotPosition, isLocked, isSwapSelected, isEligibleTarget, onTap }: PlayerRowProps) => {
  const [imgErr, setImgErr] = useState(false);

  const isGoalie = player ? (player.position === 'Goalie' || player.position === 'G') : slotPosition === 'G';
  const dailyProj = player ? (isGoalie ? player.goalieProjection : player.daily_projection) : null;
  const hasGame = dailyProj != null;
  const projPts = dailyProj?.total_projected_points || 0;
  const teamAbbr = player?.teamAbbreviation || (player?.team?.split(' ').pop()?.substring(0, 3).toUpperCase()) || '';
  const teamLogoUrl = player ? `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbreviation || 'NHL'}_light.svg` : '';

  const statusBadge = player?.status ? {
    IR: { label: 'IR', cls: 'bg-red-500 text-white' },
    SUSP: { label: 'SUSP', cls: 'bg-orange-500 text-white' },
    GTD: { label: 'GTD', cls: 'bg-yellow-500 text-white' },
    WVR: { label: 'WVR', cls: 'bg-blue-500 text-white' },
  }[player.status] : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 transition-all border-b border-citrus-sage/15",
        "active:bg-citrus-sage/10",
        isSwapSelected && "!bg-citrus-orange/10 !border-citrus-orange/30",
        isEligibleTarget && !isSwapSelected && "!bg-citrus-sage/10 !border-citrus-sage/30",
        isLocked && "opacity-60",
      )}
      onClick={onTap}
    >
      {/* Position badge */}
      <div className={cn(
        "w-10 h-10 flex-shrink-0 rounded-lg flex items-center justify-center text-white font-varsity text-xs font-black tracking-wide shadow-sm",
        "ring-2",
        posColor[slotPosition] || 'bg-citrus-charcoal/40',
        posRingColor[slotPosition] || 'ring-citrus-charcoal/20',
        isEligibleTarget && !isSwapSelected && "!ring-citrus-sage !ring-2 animate-pulse",
        isSwapSelected && "!ring-citrus-orange !ring-2",
      )}>
        {slotPosition}
      </div>

      {player ? (
        <>
          {/* Player photo */}
          <div className="w-9 h-9 flex-shrink-0 rounded-full overflow-hidden bg-citrus-sage/10 border-2 border-citrus-sage/30 relative">
            {!imgErr ? (
              <img
                src={teamLogoUrl}
                alt={teamAbbr}
                className="w-full h-full object-contain p-0.5"
                onError={() => setImgErr(true)}
              />
            ) : (
              <Shield className="w-5 h-5 text-citrus-sage absolute inset-0 m-auto" />
            )}
            {isLocked && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                <Lock className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Name + team/number + game info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-display font-bold text-[13px] text-citrus-forest truncate leading-tight">
                {player.name}
              </span>
              {statusBadge && (
                <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded-sm leading-none", statusBadge.cls)}>
                  {statusBadge.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-citrus-charcoal/60 font-display">
              <span className="font-semibold">{teamAbbr}</span>
              <span className="text-citrus-charcoal/30">|</span>
              <span>#{player.number}</span>
              {hasGame && player.nextGame?.opponent && (
                <>
                  <span className="text-citrus-charcoal/30">|</span>
                  <span className="text-citrus-sage font-semibold">{player.nextGame.opponent}</span>
                </>
              )}
            </div>
            {/* Game time + projected stat line */}
            {hasGame && player.nextGame && (
              <div className="flex items-center gap-1.5 mt-0.5">
                {player.nextGame.gameTime && (
                  <span className="text-[10px] font-display font-semibold text-citrus-charcoal/50">
                    {player.nextGame.gameTime}
                  </span>
                )}
                {(() => {
                  const statLine = formatProjectedStatLine(player);
                  if (!statLine) return null;
                  return (
                    <>
                      {player.nextGame.gameTime && <span className="text-citrus-charcoal/20 text-[10px]">·</span>}
                      <span className="text-[10px] font-display text-citrus-charcoal/45 italic truncate">
                        {statLine}
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Projected points */}
          <div className={cn(
            "flex-shrink-0 w-14 text-right",
          )}>
            {hasGame ? (
              <div className="flex flex-col items-end">
                <span className="font-varsity text-base font-black text-citrus-orange leading-none">
                  {projPts.toFixed(1)}
                </span>
                <span className="text-[10px] text-citrus-charcoal/50 font-display font-medium uppercase">proj</span>
              </div>
            ) : (
              <span className="text-xs text-citrus-charcoal/40 font-display italic">No game</span>
            )}
          </div>
        </>
      ) : (
        /* Empty slot */
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1 rounded-lg border border-dashed",
            isEligibleTarget ? "border-citrus-sage bg-citrus-sage/5" : "border-citrus-charcoal/15 bg-citrus-charcoal/5",
          )}
        >
          <span className={cn(
            "text-xs font-display",
            isEligibleTarget ? "text-citrus-sage font-bold" : "text-citrus-charcoal/30",
          )}>
            {isEligibleTarget ? "Tap to move here" : "Empty"}
          </span>
        </div>
      )}
    </div>
  );
};

// ─── Section header ──────────────────────────────────────────────────
const SectionHeader = ({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) => (
  <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-transparent border-b border-citrus-sage/25">
    {icon}
    <span className="text-sm font-varsity font-black text-citrus-forest uppercase tracking-wide">{label}</span>
    <Badge variant="outline" className="text-[10px] font-display h-4 px-1.5 ml-auto border-citrus-sage/30 text-citrus-charcoal/60">
      {count}
    </Badge>
  </div>
);

// ─── Main Component ──────────────────────────────────────────────────
const MobileRosterList = ({
  starters,
  bench,
  ir,
  slotAssignments,
  lockedPlayerIds = new Set(),
  tapSelectedPlayerId = null,
  tapEligibleSlots = new Set(),
  onPlayerTap,
  onSlotTap,
  onBenchTap,
}: MobileRosterListProps) => {

  // Build slot → player map from assignments
  const getPlayerInSlot = (slotId: string): HockeyPlayer | null => {
    const playerId = Object.keys(slotAssignments).find(key => slotAssignments[key] === slotId);
    if (!playerId) return null;
    return starters.find(p => String(p.id) === String(playerId)) || null;
  };

  const handleRowTap = (player: HockeyPlayer | null, slotId: string) => {
    if (player && onPlayerTap) {
      onPlayerTap(player);
    } else if (!player && onSlotTap) {
      onSlotTap(slotId);
    }
  };

  // Group starter slots by section
  const forwardSlots = ['slot-LW-1', 'slot-LW-2', 'slot-C-1', 'slot-C-2', 'slot-RW-1', 'slot-RW-2'];
  const defenseSlots = ['slot-D-1', 'slot-D-2', 'slot-D-3', 'slot-D-4'];
  const goalieSlots = ['slot-G-1', 'slot-G-2'];
  const utilSlots = ['slot-UTIL'];

  const renderSlotRows = (slots: string[]) =>
    slots.map(slotId => {
      const player = getPlayerInSlot(slotId);
      const pos = slotLabel[slotId] || 'UTIL';
      const isSelected = player != null && player.id === tapSelectedPlayerId;
      const isTarget = tapSelectedPlayerId != null && tapEligibleSlots.has(slotId) && !isSelected;

      return (
        <PlayerRow
          key={slotId}
          player={player}
          slotId={slotId}
          slotPosition={pos}
          isLocked={player ? lockedPlayerIds.has(String(player.id)) : false}
          isSwapSelected={isSelected}
          isEligibleTarget={isTarget}
          onTap={() => handleRowTap(player, slotId)}
        />
      );
    });

  const benchIsTarget = tapSelectedPlayerId != null && tapEligibleSlots.has('bench-grid');

  return (
    <div className="bg-card rounded-xl border border-citrus-sage/25 shadow-sm overflow-hidden">
      {/* Starters: Forwards */}
      <SectionHeader
        label="Forwards"
        count={forwardSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<CitrusSparkle className="w-4 h-4 text-citrus-orange" />}
      />
      {renderSlotRows(forwardSlots)}

      {/* Starters: Defense */}
      <SectionHeader
        label="Defense"
        count={defenseSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<Shield className="w-4 h-4 text-citrus-forest" />}
      />
      {renderSlotRows(defenseSlots)}

      {/* Starters: Goalies */}
      <SectionHeader
        label="Goalies"
        count={goalieSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<Shield className="w-4 h-4 text-citrus-peach" />}
      />
      {renderSlotRows(goalieSlots)}

      {/* Starters: Utility */}
      <SectionHeader
        label="Utility"
        count={utilSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<CitrusSparkle className="w-4 h-4 text-citrus-green-medium" />}
      />
      {renderSlotRows(utilSlots)}

      {/* Bench */}
      <div
        className={cn(
          benchIsTarget && "bg-citrus-sage/5",
        )}
        onClick={benchIsTarget && bench.length === 0 ? onBenchTap : undefined}
      >
        <SectionHeader
          label="Bench"
          count={bench.length}
          icon={<CitrusLeaf className="w-4 h-4 text-citrus-sage" />}
        />
        {benchIsTarget && bench.length === 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs font-display text-citrus-sage font-bold">Tap to move to bench</span>
          </div>
        )}
        {bench.map(player => {
          const pos = getPositionAbbr(player.position);
          const isSelected = player.id === tapSelectedPlayerId;
          return (
            <PlayerRow
              key={player.id}
              player={player}
              slotId="bench-grid"
              slotPosition={pos}
              isLocked={lockedPlayerIds.has(String(player.id))}
              isSwapSelected={isSelected}
              isEligibleTarget={benchIsTarget && !isSelected}
              onTap={() => onPlayerTap?.(player)}
            />
          );
        })}
      </div>

      {/* IR */}
      {ir.length > 0 && (
        <>
          <SectionHeader
            label="Injured Reserve"
            count={ir.length}
            icon={<Skull className="w-4 h-4 text-red-400" />}
          />
          {ir.map(player => {
            const pos = getPositionAbbr(player.position);
            const irSlot = slotAssignments[player.id] || 'ir-slot-1';
            return (
              <PlayerRow
                key={player.id}
                player={player}
                slotId={irSlot}
                slotPosition={pos}
                isLocked={lockedPlayerIds.has(String(player.id))}
                isSwapSelected={player.id === tapSelectedPlayerId}
                onTap={() => onPlayerTap?.(player)}
              />
            );
          })}
        </>
      )}
    </div>
  );
};

export default MobileRosterList;
