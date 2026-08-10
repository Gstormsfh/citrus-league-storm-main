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

import type { PositionType } from "@/utils/rosterUtils";

const posColor: Record<string, string> = {
  LW: 'bg-pastel-sage-soft',
  C: 'bg-pastel-sage',
  RW: 'bg-pastel-orange',
  D: 'bg-[#1A2A20]',
  G: 'bg-pastel-sage/15 text-pastel-cream',
  UTIL: 'bg-pastel-sage',
  F: 'bg-emerald-600',
};

const posRingColor: Record<string, string> = {
  LW: 'ring-pastel-sage-soft/30',
  C: 'ring-pastel-sage/30',
  RW: 'ring-pastel-orange/30',
  D: 'ring-white/30',
  G: 'ring-pastel-sage/50',
  UTIL: 'ring-pastel-sage/30',
  F: 'ring-emerald-600/30',
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
  onPlayerNameTap?: (player: HockeyPlayer) => void;
  onSlotTap?: (slotId: string) => void;
  onBenchTap?: () => void;
  positionType?: PositionType;
  rosterSlots?: Record<string, number>;
}

/**
 * Build slot label map and slot arrays dynamically from position type and roster slots.
 */
function buildSlotConfig(positionType: PositionType = 'individual', rosterSlots?: Record<string, number>) {
  const labels: Record<string, string> = {};
  const allSlots: string[] = [];

  const posKeys = positionType === 'forward'
    ? ['F', 'D', 'G']
    : ['C', 'LW', 'RW', 'D', 'G'];

  const defaults: Record<string, number> = positionType === 'forward'
    ? { F: 6, D: 4, G: 2, UTIL: 1 }
    : { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };

  for (const pos of posKeys) {
    const count = rosterSlots?.[pos] ?? defaults[pos] ?? 0;
    for (let i = 1; i <= count; i++) {
      const slotId = `slot-${pos}-${i}`;
      labels[slotId] = pos;
      allSlots.push(slotId);
    }
  }

  // UTIL slot
  const utilCount = rosterSlots?.UTIL ?? defaults.UTIL ?? 1;
  for (let i = 0; i < utilCount; i++) {
    const slotId = utilCount === 1 ? 'slot-UTIL' : `slot-UTIL-${i + 1}`;
    labels[slotId] = 'UTIL';
    allSlots.push(slotId);
  }

  // Group by section
  const forwardSlots = positionType === 'forward'
    ? allSlots.filter(s => s.startsWith('slot-F-'))
    : allSlots.filter(s => s.startsWith('slot-LW-') || s.startsWith('slot-C-') || s.startsWith('slot-RW-'));
  const defenseSlots = allSlots.filter(s => s.startsWith('slot-D-'));
  const goalieSlots = allSlots.filter(s => s.startsWith('slot-G-'));
  const utilSlots = allSlots.filter(s => s.startsWith('slot-UTIL'));

  return { labels, allSlots, forwardSlots, defenseSlots, goalieSlots, utilSlots };
}

// ─── Format compact stat line from actual game stats (live/final only) ───
const formatStatLine = (player: HockeyPlayer): { text: string; isActual: boolean } | null => {
  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const gameStatus = player.nextGame?.gameStatus;
  const isLiveOrFinal = gameStatus === 'live' || gameStatus === 'intermission' || gameStatus === 'final';

  // Only show actual stats for live/final games — no projected decimals
  if (isLiveOrFinal && player.daily_actual_stats) {
    const s = player.daily_actual_stats;
    const parts: string[] = [];
    if (isGoalie) {
      if (s.saves) parts.push(`${s.saves} SV`);
      if (s.goals_against != null) parts.push(`${s.goals_against} GA`);
      if (s.wins) parts.push('W');
    } else {
      if (s.goals) parts.push(`${s.goals}G`);
      if (s.assists) parts.push(`${s.assists}A`);
      if (s.shots_on_goal) parts.push(`${s.shots_on_goal} SOG`);
      if (s.hits) parts.push(`${s.hits} HIT`);
    }
    return parts.length > 0 ? { text: parts.join(' · '), isActual: true } : null;
  }

  return null;
};

// ─── Game status badge ──────────────────────────────────────────────
const GameStatusBadge = ({ status, score }: { status?: string; score?: string }) => {
  if (!status || status === 'scheduled') return null;

  if (status === 'final') {
    return (
      <span className="text-[9px] font-varsity font-black tracking-wider px-1.5 py-0.5 rounded-sm bg-white/10 text-white/70 uppercase">
        Final{score ? ` ${score}` : ''}
      </span>
    );
  }

  if (status === 'live' || status === 'intermission') {
    return (
      <span className="text-[9px] font-varsity font-black tracking-wider px-1.5 py-0.5 rounded-sm bg-red-500/15 text-red-600 uppercase animate-pulse">
        {status === 'intermission' ? 'INT' : 'LIVE'}{score ? ` ${score}` : ''}
      </span>
    );
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
  onPositionTap?: () => void;
  onNameTap?: () => void;
  onEmptySlotTap?: () => void;
}

const PlayerRow = ({ player, slotId, slotPosition, isLocked, isSwapSelected, isEligibleTarget, onPositionTap, onNameTap, onEmptySlotTap }: PlayerRowProps) => {
  const [imgErr, setImgErr] = useState(false);

  const isGoalie = player ? (player.position === 'Goalie' || player.position === 'G') : slotPosition === 'G';
  const gameStatus = player?.nextGame?.gameStatus;
  const isLiveOrFinal = gameStatus === 'live' || gameStatus === 'intermission' || gameStatus === 'final';
  const dailyProj = player ? (isGoalie ? player.goalieProjection : player.daily_projection) : null;
  const hasGame = dailyProj != null || (player?.daily_actual_points != null && player.daily_actual_points > 0);
  const actualPts = player?.daily_actual_points ?? 0;
  const projPts = dailyProj?.total_projected_points || 0;
  const displayPts = isLiveOrFinal ? actualPts : projPts;
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
        "flex items-center gap-2.5 px-3 py-2 min-h-[52px] transition-all border-b border-pastel-sage/10",
        isSwapSelected && "!bg-pastel-orange/10 !border-pastel-orange/30",
        isEligibleTarget && !isSwapSelected && "!bg-pastel-sage/10 !border-pastel-sage/30",
        isLocked && "opacity-60",
      )}
    >
      {/* Position badge — tap to swap */}
      <div
        className={cn(
          "w-8 h-8 flex-shrink-0 rounded-md flex items-center justify-center text-white font-varsity text-[11px] font-black tracking-wide",
          "ring-1 active:scale-95 transition-transform cursor-pointer",
          posColor[slotPosition] || 'bg-white/40',
          posRingColor[slotPosition] || 'ring-white/20',
          isEligibleTarget && !isSwapSelected && "!ring-pastel-sage !ring-2 animate-pulse",
          isSwapSelected && "!ring-pastel-orange !ring-2",
        )}
        onClick={(e) => { e.stopPropagation(); onPositionTap?.(); }}
      >
        {slotPosition}
      </div>

      {player ? (
        <>
          {/* Team logo */}
          <div className="w-7 h-7 flex-shrink-0 rounded-full overflow-hidden bg-pastel-sage/10 border border-pastel-sage/20 relative">
            {!imgErr ? (
              <img
                src={teamLogoUrl}
                alt={teamAbbr}
                className="w-full h-full object-contain p-0.5"
                onError={() => setImgErr(true)}
              />
            ) : (
              <Shield className="w-4 h-4 text-pastel-sage absolute inset-0 m-auto" />
            )}
            {isLocked && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                <Lock className="w-2.5 h-2.5 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Player info — 2 lines max, tap to open card */}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={(e) => { e.stopPropagation(); onNameTap?.(); }}>
            {/* Line 1: Name + status badge */}
            <div className="flex items-center gap-1.5">
              <span className="font-display font-bold text-[13px] text-pastel-cream truncate leading-tight">
                {player.name}
              </span>
              {statusBadge && (
                <span className={cn("text-[8px] font-bold px-1 py-px rounded-sm leading-none flex-shrink-0", statusBadge.cls)}>
                  {statusBadge.label}
                </span>
              )}
            </div>
            {/* Line 2: Team · Opponent · Game status/time · Stats (single line, truncated) */}
            <div className="flex items-center gap-1 text-[11px] text-white/55 font-display leading-tight mt-0.5 overflow-hidden">
              <span className="font-semibold flex-shrink-0">{teamAbbr}</span>
              {player.nextGame?.opponent && (
                <>
                  <span className="text-white/25 flex-shrink-0">·</span>
                  <span className="text-pastel-sage font-semibold flex-shrink-0">
                    {player.nextGame.opponent}
                  </span>
                </>
              )}
              {player.nextGame && (
                <>
                  {isLiveOrFinal ? (
                    <>
                      <span className="text-white/25 flex-shrink-0">·</span>
                      <GameStatusBadge status={gameStatus} score={player.nextGame.score} />
                      {(() => {
                        const statInfo = formatStatLine(player);
                        if (!statInfo) return null;
                        return (
                          <>
                            <span className="text-white/25 flex-shrink-0">·</span>
                            <span className="text-emerald-700 font-semibold truncate">
                              {statInfo.text}
                            </span>
                          </>
                        );
                      })()}
                    </>
                  ) : player.nextGame.gameTime ? (
                    <>
                      <span className="text-white/25 flex-shrink-0">·</span>
                      <span className="text-white/45 font-medium flex-shrink-0">
                        {player.nextGame.gameTime}
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Points column */}
          <div className="flex-shrink-0 w-[52px] text-right">
            {hasGame ? (
              <div className="flex flex-col items-end">
                <span className={cn(
                  "font-varsity text-[15px] font-black leading-none",
                  isLiveOrFinal ? "text-emerald-700" : "text-pastel-orange"
                )}>
                  {displayPts.toFixed(1)}
                </span>
                <span className={cn(
                  "text-[9px] font-display font-semibold uppercase leading-tight mt-0.5",
                  isLiveOrFinal ? "text-emerald-600/70" : "text-white/40"
                )}>
                  {isLiveOrFinal ? (gameStatus === 'final' ? 'final' : 'live') : 'proj'}
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-white/30 font-display">—</span>
            )}
          </div>
        </>
      ) : (
        /* Empty slot */
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1.5 rounded-md border border-dashed",
            isEligibleTarget ? "border-pastel-sage bg-pastel-sage/5" : "border-white/10 bg-white/3",
          )}
          onClick={onEmptySlotTap}
        >
          <span className={cn(
            "text-xs font-display",
            isEligibleTarget ? "text-pastel-sage font-bold" : "text-white/25",
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
  <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-pastel-sage/20 via-pastel-sage/10 to-transparent border-b border-pastel-sage/25">
    {icon}
    <span className="text-sm font-varsity font-black text-pastel-cream uppercase tracking-wide">{label}</span>
    <Badge variant="outline" className="text-[10px] font-display h-4 px-1.5 ml-auto border-pastel-sage/30 text-white/60">
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
  onPlayerNameTap,
  onSlotTap,
  onBenchTap,
  positionType = 'individual',
  rosterSlots,
}: MobileRosterListProps) => {

  // Build dynamic slot config from position type
  const slotConfig = buildSlotConfig(positionType, rosterSlots);
  const slotLabel = slotConfig.labels;

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

  // Group starter slots by section (from dynamic config)
  const { forwardSlots, defenseSlots, goalieSlots, utilSlots } = slotConfig;

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
          onPositionTap={() => {
            if (player && onPlayerTap) onPlayerTap(player);
            else if (!player && onSlotTap) onSlotTap(slotId);
          }}
          onNameTap={() => player && onPlayerNameTap?.(player)}
          onEmptySlotTap={() => onSlotTap?.(slotId)}
        />
      );
    });

  const benchIsTarget = tapSelectedPlayerId != null && tapEligibleSlots.has('bench-grid');

  return (
    <div className="bg-card rounded-xl border border-pastel-sage/25 shadow-sm overflow-hidden">
      {/* Starters: Forwards */}
      <SectionHeader
        label="Forwards"
        count={forwardSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<CitrusSparkle className="w-4 h-4 text-pastel-orange" />}
      />
      {renderSlotRows(forwardSlots)}

      {/* Starters: Defense */}
      <SectionHeader
        label="Defense"
        count={defenseSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<Shield className="w-4 h-4 text-pastel-cream" />}
      />
      {renderSlotRows(defenseSlots)}

      {/* Starters: Goalies */}
      <SectionHeader
        label="Goalies"
        count={goalieSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<Shield className="w-4 h-4 text-pastel-cream" />}
      />
      {renderSlotRows(goalieSlots)}

      {/* Starters: Utility */}
      <SectionHeader
        label="Utility"
        count={utilSlots.filter(s => getPlayerInSlot(s) != null).length}
        icon={<CitrusSparkle className="w-4 h-4 text-pastel-sage" />}
      />
      {renderSlotRows(utilSlots)}

      {/* Bench */}
      <div
        className={cn(
          benchIsTarget && "bg-pastel-sage/5",
        )}
        onClick={benchIsTarget && bench.length === 0 ? onBenchTap : undefined}
      >
        <SectionHeader
          label="Bench"
          count={bench.length}
          icon={<CitrusLeaf className="w-4 h-4 text-pastel-sage" />}
        />
        {benchIsTarget && bench.length === 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs font-display text-pastel-sage font-bold">Tap to move to bench</span>
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
              onPositionTap={() => onPlayerTap?.(player)}
              onNameTap={() => onPlayerNameTap?.(player)}
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
                onPositionTap={() => onPlayerTap?.(player)}
                onNameTap={() => onPlayerNameTap?.(player)}
              />
            );
          })}
        </>
      )}
    </div>
  );
};

export default MobileRosterList;
