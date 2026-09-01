import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Lock, Shield, CalendarDays, Skull, AlertCircle } from "lucide-react";
import { HockeyPlayer } from "./HockeyPlayerCard";
import { CitrusSparkle, CitrusLeaf } from "@/components/icons/CitrusIcons";
import { generatePlayerWriteup } from "@/utils/playerWriteup";
import { SlotPickerMenu } from "./SlotPickerMenu";
// Aliased: the list body already names its slot->position map `slotLabel`.
import { slotLabel as labelForSlot } from "./slotLabel";
import { LOCKED_CHIP } from "./slotChip";
import { Mug } from "./Mug";
import { useSwapHint } from "@/hooks/useSwapHint";
import { useMemo } from "react";
// The chip (geometry, per-position colour + ring, raw-position -> key) lives
// in its own module so the mobile Matchup rows wear the identical chip. The
// contrast rationale for the colour pairs is documented there.
import {
  POSITION_CHIP_BASE,
  POSITION_CHIP_FALLBACK,
  POSITION_RING_FALLBACK,
  posColor,
  posRingColor,
  positionChipKey,
} from "./positionChip";

import type { PositionType } from "@/utils/rosterUtils";

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
  /** Clear the tap selection. Fired when the slot menu is dismissed. */
  onCancelSelection?: () => void;
  /**
   * An EMPTY starter row was tapped with nothing selected — the manager is
   * standing on the hole and wants to fill it. The page opens the Fill
   * sheet with the bench players who can legally take the slot. (With a
   * player already selected the same tap is a move, via `onSlotTap`.)
   */
  onFillSlot?: (slotId: string) => void;
  /**
   * Show the one-time "Tap a position to swap" hint when this list is
   * editable. Off by default so read-only surfaces (demo league, guests)
   * never promise a gesture that only toasts "read only".
   */
  swapHint?: boolean;
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
// whitespace-nowrap + flex-shrink-0 (2026-08-26): this chip sits in a
// `flex items-center gap-1 overflow-hidden` row where every other child is
// already shrink-0. Being the one shrinkable item, it absorbed the whole
// squeeze and wrapped — "FINAL 4-2" rendered as "FINAL 4-" over "2", which
// doubled the row height and broke the list's rhythm. A status chip is
// atomic: it is either shown whole or the row truncates something else.
const GameStatusBadge = ({ status, score }: { status?: string; score?: string }) => {
  if (!status || status === 'scheduled') return null;

  if (status === 'final') {
    return (
      <span className="text-[9px] font-varsity font-black tracking-wider px-1.5 py-0.5 rounded-sm bg-white/10 text-white/70 uppercase whitespace-nowrap flex-shrink-0">
        Final{score ? ` ${score}` : ''}
      </span>
    );
  }

  if (status === 'live' || status === 'intermission') {
    return (
      <span className="text-[9px] font-varsity font-black tracking-wider px-1.5 py-0.5 rounded-sm bg-red-500/15 text-red-400 uppercase animate-pulse whitespace-nowrap flex-shrink-0">
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
  const isGoalie = player ? (player.position === 'Goalie' || player.position === 'G') : slotPosition === 'G';
  const gameStatus = player?.nextGame?.gameStatus;
  const isLiveOrFinal = gameStatus === 'live' || gameStatus === 'intermission' || gameStatus === 'final';
  const dailyProj = player ? (isGoalie ? player.goalieProjection : player.daily_projection) : null;
  const hasGame = dailyProj != null || (player?.daily_actual_points != null && player.daily_actual_points > 0);
  const actualPts = player?.daily_actual_points ?? 0;
  const projPts = dailyProj?.total_projected_points || 0;
  const displayPts = isLiveOrFinal ? actualPts : projPts;
  const teamAbbr = player?.teamAbbreviation || (player?.team?.split(' ').pop()?.substring(0, 3).toUpperCase()) || '';
  // Same one-liner the desktop card carries, so the roster reads identically
  // on both surfaces. Pure arithmetic over player.stats — no fetch.
  const writeup = player ? generatePlayerWriteup(player) : null;

  const statusBadge = player?.status ? {
    IR: { label: 'IR', cls: 'bg-red-500 text-white' },
    SUSP: { label: 'SUSP', cls: 'bg-orange-500 text-white' },
    GTD: { label: 'GTD', cls: 'bg-yellow-500 text-white' },
    WVR: { label: 'WVR', cls: 'bg-blue-500 text-white' },
  }[player.status] : null;

  // EMPTY ROW = ONE TARGET (2026-09-01, audit R2). The dashed box used to be
  // the only tappable part of an empty row, and with nothing selected the
  // tap did nothing at all. Now the whole row is the control: with a player
  // selected it is the move target it always was; with nothing selected it
  // opens the Fill sheet. The label says which.
  const isEmpty = player == null;
  const emptyLabel = isEligibleTarget
    ? `Move here: ${labelForSlot(slotId)}`
    : `Empty ${labelForSlot(slotId)} — tap to fill`;

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 min-h-[52px] transition-all border-b border-pastel-sage/10",
        isSwapSelected && "!bg-pastel-orange/10 !border-pastel-orange/30",
        isEligibleTarget && !isSwapSelected && "!bg-pastel-sage/10 !border-pastel-sage/30",
        // LOCKED ROWS STAY LEGIBLE (audit R5): no row-level dimming. The
        // players scoring RIGHT NOW were the hardest to read at 60%; the
        // chip carries the lock instead (see below).
        isEmpty && "cursor-pointer active:bg-white/5",
      )}
      role={isEmpty ? 'button' : undefined}
      aria-label={isEmpty ? emptyLabel : undefined}
      onClick={isEmpty ? onEmptySlotTap : undefined}
    >
      {/* Position badge — tap to swap. The ⇄ glyph (audit R2) says so; on a
          locked player the lock takes its place (audit R5). Both live in
          CHILD spans: the base class and the posColor/posRingColor maps are
          pinned by MobileRosterList.positionRing.test.tsx and stay as they are. */}
      <div
        className={cn(
          // No `text-white` in the base — posColor owns the text colour so
          // it can never disagree with its own background (see positionChip).
          POSITION_CHIP_BASE,
          // flex-col: the roster chip stacks the label over the swap/lock glyph.
          "flex-col active:scale-95 transition-transform cursor-pointer",
          // Locked players wear the neutral locked chip (audit R5); the
          // fallback pair lives beside the maps in positionChip.
          isLocked ? LOCKED_CHIP : (posColor[slotPosition] || POSITION_CHIP_FALLBACK),
          !isLocked && (posRingColor[slotPosition] || POSITION_RING_FALLBACK),
          isEligibleTarget && !isSwapSelected && "!ring-pastel-sage !ring-2 animate-pulse",
          isSwapSelected && "!ring-pastel-orange !ring-2",
        )}
        data-locked={isLocked ? 'true' : undefined}
        onClick={(e) => { e.stopPropagation(); (isEmpty ? onEmptySlotTap : onPositionTap)?.(); }}
      >
        <span className="leading-none">{slotPosition}</span>
        {isLocked ? (
          <span data-testid="chip-lock" className="mt-px flex items-center justify-center leading-none" aria-hidden="true">
            <Lock className="w-2.5 h-2.5" />
          </span>
        ) : (
          <span data-testid="chip-swap-glyph" className="-mt-px font-sans text-[10px] leading-none opacity-80" aria-hidden="true">
            ⇄
          </span>
        )}
      </div>

      {player ? (
        <>
          {/* Headshot (2026-09-01, audit R3) — the face, where the team crest
              used to be. The same 28px box, so nothing else on the row moved;
              the crest survives as a 14px badge on the mug's shoulder. Falls
              back crest → initials, never a broken image (see Mug). */}
          <Mug p={player} size="xs" crest />

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
                      <span className="text-white/55 font-medium flex-shrink-0">
                        {player.nextGame.gameTime}
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </div>
            {/* Line 3: scouting note — the Sleeper/Yahoo/ESPN player-row note.
                Availability (IR/GTD/SUSP) wins this line when it applies, since
                that is the decision the manager is actually making. */}
            {writeup?.cardNote && (
              <div className="flex items-center gap-1 mt-0.5 overflow-hidden">
                <span
                  className={cn(
                    'w-1 h-1 rounded-full flex-shrink-0',
                    writeup.cardTone === 'caution'
                      ? 'bg-amber-400'
                      : writeup.cardTone === 'positive'
                        ? 'bg-pastel-sage'
                        : 'bg-pastel-cream/70',
                  )}
                  aria-hidden="true"
                />
                <span className="text-[10px] font-display text-white/55 truncate leading-tight">
                  {writeup.cardNote}
                </span>
              </div>
            )}
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
                  isLiveOrFinal ? "text-emerald-600/70" : "text-white/55"
                )}>
                  {isLiveOrFinal ? (gameStatus === 'final' ? 'final' : 'live') : 'proj'}
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-white/55 font-display">—</span>
            )}
          </div>
        </>
      ) : (
        /* Empty slot — the row itself is the target (see the wrapper). */
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1.5 rounded-md border border-dashed",
            isEligibleTarget ? "border-pastel-sage bg-pastel-sage/5" : "border-white/10 bg-white/[0.03]",
          )}
        >
          {isEligibleTarget ? (
            <span className="text-xs font-display text-pastel-sage font-bold">Tap to move here</span>
          ) : (
            <span className="text-xs font-display text-white/55">
              Empty
              <span className="text-white/25" aria-hidden="true"> · </span>
              <span className="text-pastel-sage font-semibold">tap to fill</span>
            </span>
          )}
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
  onCancelSelection,
  onFillSlot,
  swapHint = false,
  positionType = 'individual',
  rosterSlots,
}: MobileRosterListProps) => {

  // First-visit hint (audit R2) — once, and only when there is a roster to
  // swap within. The hook owns the storage flag and the toast.
  useSwapHint(swapHint && starters.length + bench.length > 0);

  // Build dynamic slot config from position type
  const slotConfig = buildSlotConfig(positionType, rosterSlots);
  const slotLabel = slotConfig.labels;

  // Build slot → player map from assignments
  const getPlayerInSlot = (slotId: string): HockeyPlayer | null => {
    const playerId = Object.keys(slotAssignments).find(key => slotAssignments[key] === slotId);
    if (!playerId) return null;
    return starters.find(p => String(p.id) === String(playerId)) || null;
  };

  // Everyone on the roster, so the menu can name who currently holds a slot.
  const allPlayers = useMemo(() => [...starters, ...bench, ...ir], [starters, bench, ir]);

  /**
   * LINE CHANGE SHEET (2026-08-27)
   *
   * Reported as "it's still a bit complicated — we need to essentially click,
   * then open a mini menu of those available roster slots."
   *
   * Selecting a player used to light eligible slots up elsewhere on this list,
   * which on a phone is several screens long: you scroll hunting a highlight
   * having lost sight of the player you picked. The sheet anchors the choice
   * to the bottom edge — the thumb's home — and names each destination's
   * occupant with tonight's number, so a swap's consequence is legible BEFORE
   * the tap.
   *
   * One instance, rendered at the list level (the sheet portals to body, so
   * nothing needs per-row anchoring). `open` is derived from
   * `tapSelectedPlayerId` rather than held here, so the sheet cannot disagree
   * with the highlight state underneath it — there is one selection, and both
   * read it.
   */
  const selectedPlayer = useMemo(
    () => allPlayers.find((p) => p.id === tapSelectedPlayerId) ?? null,
    [allPlayers, tapSelectedPlayerId],
  );

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

      // An empty row is a MOVE target while a player is selected and a
      // FILL trigger otherwise — one gesture, read against the page's state.
      const fillOrMove = () => {
        if (tapSelectedPlayerId != null) onSlotTap?.(slotId);
        else onFillSlot?.(slotId);
      };

      const row = (
        <PlayerRow
          key={slotId}
          player={player}
          slotId={slotId}
          slotPosition={pos}
          isLocked={player ? lockedPlayerIds.has(String(player.id)) : false}
          isSwapSelected={isSelected}
          isEligibleTarget={isTarget}
          onPositionTap={() => { if (player) onPlayerTap?.(player); }}
          onNameTap={() => player && onPlayerNameTap?.(player)}
          onEmptySlotTap={fillOrMove}
        />
      );
      return row;
    });

  const benchIsTarget = tapSelectedPlayerId != null && tapEligibleSlots.has('bench-grid');

  // CONTRAST (2026-08-13) — was `bg-card`, which resolves to the LIGHT
  // theme token (--card: 85 40% 90% => #E7F0DB). Every text token in
  // this component is a DARK-surface token: text-pastel-cream for
  // names, and eleven separate text-white/xx values for the secondary
  // line, separators and badges. Cream (#FFF8F0) on #E7F0DB measures
  // **1.11:1** — WCAG AA wants 4.5:1 — so player names, "FORWARDS" and
  // "DEFENSE" were effectively invisible. Field-reported 2026-08-13
  // with a screenshot; 26 text nodes affected on one roster.
  // The component was never wrong — its container was. `surface-tile`
  // is the design system's own documented "card / tile surface" for v2
  // (#1A2A20, tailwind.config.ts), the same family as the page shell
  // this list already sits inside. On it, cream measures ~14:1 and
  // text-white/55 ~4.9:1. Fixing one container beats overriding
  // eleven text tokens, and it keeps the component honest: it renders
  // light-on-dark, and now it is actually on dark.
  return (
    <div className="bg-pastel-surface-tile rounded-xl border border-white/10 shadow-sm overflow-hidden">
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
          const pos = positionChipKey(player.position);
          const isSelected = player.id === tapSelectedPlayerId;
          const row = (
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
          return row;
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
            const pos = positionChipKey(player.position);
            const irSlot = slotAssignments[player.id] || 'ir-slot-1';
            const row = (
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
            return row;
          })}
        </>
      )}

      {/* The Line Change sheet — portals to body; scrim/✕ cancel the
          selection, picking reports the slot id to the page's own handler. */}
      <SlotPickerMenu
        player={selectedPlayer}
        // Never recomputed here. `tapEligibleSlots` is Roster.tsx's, and it is
        // the only place `is_ir_eligible` gates an IR slot.
        eligibleSlots={tapEligibleSlots}
        slotAssignments={slotAssignments}
        allPlayers={allPlayers}
        open={selectedPlayer != null}
        onOpenChange={(next) => { if (!next) onCancelSelection?.(); }}
        onPick={(slotId) => onSlotTap?.(slotId)}
      />
    </div>
  );
};

export default MobileRosterList;
