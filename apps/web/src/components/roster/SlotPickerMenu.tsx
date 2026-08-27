import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ArrowRightLeft, Check, ChevronRight, X, Shield, Skull } from 'lucide-react';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';
import type { HockeyPlayer } from './HockeyPlayerCard';
import { slotLabel } from './slotLabel';

/**
 * LINE CHANGE SHEET (2026-08-27, second pass)
 *
 * Reported as "it's still a bit complicated — we need to essentially click,
 * then open a mini menu of those available roster slots." The first pass was
 * a 256px anchored popover, and the founder's review was blunt: a critical
 * feature looked like a desktop context menu shrunk onto a phone, floating in
 * empty space. He was right. Sleeper, Yahoo and ESPN all express this exact
 * moment as a full-width bottom sheet, because on a phone the bottom edge is
 * the thumb's home and width is free information budget.
 *
 * So: a bottom sheet, styled like the roster it serves.
 *
 *   * The header carries the player being moved — headshot, team crest,
 *     tonight's matchup and projection — because "who am I holding?" should
 *     survive the menu opening.
 *   * Every destination row answers the two questions a manager actually has:
 *     WHO is there now (headshot + name + tonight's number, the same number
 *     the roster column leads with) and WHAT happens on tap ("Swaps to C1").
 *     The projection side-by-side is the comparison that decides the swap —
 *     information the old highlight flow could never show.
 *   * Section strips reuse the roster's own gradient-header treatment and
 *     icons, so the sheet reads as a continuation of the page underneath.
 *
 * Eligibility is NOT recomputed here. `eligibleSlots` comes from Roster.tsx's
 * `tapEligibleSlots`, which is the same set the highlight path uses and the
 * only place `isPositionValid` is consulted — including the `is_ir_eligible`
 * gate on IR slots. A second implementation would be a second thing to drift.
 *
 * DISMISSAL: the scrim and the ✕ both call `onOpenChange(false)` and the page
 * clears the selection — same effect as the cancel bar. There is no popper
 * positioning to fail (the sheet is fixed CSS), so the popover pass's
 * suppress-outside-dismiss machinery is gone along with the failure mode that
 * justified it. The desktop grids never render this component; their
 * highlight flow is untouched.
 */

export interface SlotPickerMenuProps {
  /** The player being moved. Null renders nothing. */
  player: HockeyPlayer | null;
  /** Slot ids this player may legally occupy — Roster.tsx's `tapEligibleSlots`. */
  eligibleSlots: Set<string>;
  /** playerId -> slotId. Bench players may have NO entry — that means bench. */
  slotAssignments: Record<string | number, string>;
  /** Every player on the roster, for occupant lookup. */
  allPlayers: HockeyPlayer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (slotId: string) => void;
}

type Group = { key: string; heading: string | null; icon: React.ReactNode; slots: string[] };

/**
 * Group in the order the roster itself reads top to bottom, with the same
 * icons its section headers use, so the sheet and the page underneath agree.
 */
function groupSlots(slots: string[]): Group[] {
  const isFwd = (s: string) => /^slot-(C|LW|RW|F)-/.test(s);
  const groups: Group[] = [
    { key: 'fwd', heading: 'Forwards', icon: <CitrusSparkle className="w-3.5 h-3.5 text-pastel-orange" />, slots: slots.filter(isFwd) },
    { key: 'def', heading: 'Defense', icon: <Shield className="w-3.5 h-3.5 text-pastel-cream" />, slots: slots.filter((s) => s.startsWith('slot-D-')) },
    { key: 'g', heading: 'Goalies', icon: <Shield className="w-3.5 h-3.5 text-pastel-cream" />, slots: slots.filter((s) => s.startsWith('slot-G-')) },
    { key: 'util', heading: 'Utility', icon: <CitrusSparkle className="w-3.5 h-3.5 text-pastel-sage" />, slots: slots.filter((s) => s.startsWith('slot-UTIL')) },
    {
      key: 'off',
      // Bench and IR are single destinations whose rows name themselves; a
      // group called "Bench" over one row called "Bench" reads as a bug.
      heading: null,
      icon: null,
      slots: [
        ...slots.filter((s) => s === 'bench-grid'),
        ...slots.filter((s) => s.startsWith('ir-slot-')),
      ],
    },
  ];
  return groups.filter((g) => g.slots.length > 0);
}

/** Same background/text pairs as MobileRosterList's posColor map — these must
 *  read as the SAME chips the roster rows wear. */
const CHIP: Record<string, string> = {
  LW: 'bg-pastel-sage-soft text-pastel-forest ring-pastel-sage-soft/30',
  C: 'bg-pastel-sage text-pastel-forest ring-pastel-sage/30',
  RW: 'bg-pastel-orange text-white ring-pastel-orange/30',
  D: 'bg-[#1A2A20] text-white ring-white/30',
  G: 'bg-pastel-sage/15 text-pastel-cream ring-pastel-sage/50',
  UTIL: 'bg-pastel-sage text-pastel-forest ring-pastel-sage/30',
  F: 'bg-emerald-600 text-white ring-emerald-600/30',
};

function chipClassFor(slotId: string): string {
  if (slotId === 'bench-grid') return 'bg-white/10 text-pastel-cream ring-white/20';
  if (slotId.startsWith('ir-slot-')) return 'bg-red-500/15 text-red-400 ring-red-500/30';
  const m = /^slot-([A-Z]+)/.exec(slotId);
  return (m && CHIP[m[1]]) || 'bg-white/15 text-pastel-cream ring-white/20';
}

/** Tonight's number for a player, computed the way the roster column does:
 *  actual points once the game is live/final, otherwise the projection. */
function tonight(p: HockeyPlayer): { pts: number | null; live: boolean } {
  const isG = p.position === 'Goalie' || p.position === 'G';
  const status = p.nextGame?.gameStatus;
  const live = status === 'live' || status === 'intermission' || status === 'final';
  if (live && p.daily_actual_points != null) return { pts: p.daily_actual_points, live: true };
  const proj = isG
    ? p.goalieProjection?.total_projected_points
    : p.daily_projection?.total_projected_points;
  return { pts: proj ?? null, live: false };
}

/** Headshot with a fallback that still looks designed: the player's initials
 *  on a forest disc. Real mugs load in production; the fallback carries the
 *  row when the CDN doesn't. */
function Mug({ p, size }: { p: HockeyPlayer; size: 'sm' | 'lg' }) {
  const [err, setErr] = useState(false);
  const initials = p.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const cls = size === 'lg' ? 'w-14 h-14' : 'w-9 h-9';
  return (
    <div
      className={cn(
        cls,
        'shrink-0 rounded-full overflow-hidden bg-pastel-sage/10 ring-1 ring-white/15 flex items-center justify-center',
      )}
    >
      {p.image && !err ? (
        <img
          src={p.image}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setErr(true)}
        />
      ) : (
        <span
          className={cn(
            'font-varsity font-black text-pastel-sage',
            size === 'lg' ? 'text-lg' : 'text-[11px]',
          )}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

export function SlotPickerMenu({
  player,
  eligibleSlots,
  slotAssignments,
  allPlayers,
  open,
  onOpenChange,
  onPick,
}: SlotPickerMenuProps) {
  /** slotId -> the player sitting in it. Bench holds many; it is not listed. */
  const occupants = useMemo(() => {
    const map = new Map<string, HockeyPlayer>();
    for (const p of allPlayers) {
      const slot = slotAssignments[p.id];
      if (slot && slot !== 'bench-grid') map.set(slot, p);
    }
    return map;
  }, [allPlayers, slotAssignments]);

  /** On the real page a bench player has NO slotAssignments entry at all —
   *  the bench is an array, not an assignment. Counting only explicit
   *  'bench-grid' values would report 0 forever. No entry ⇒ bench. */
  const benchCount = useMemo(
    () =>
      allPlayers.filter((p) => {
        const s = slotAssignments[p.id];
        return !s || s === 'bench-grid';
      }).length,
    [allPlayers, slotAssignments],
  );

  // Same page invariant read the other way round: starters and IR always
  // carry entries, so a missing entry means this player sits on the bench.
  const currentSlot = player ? (slotAssignments[player.id] ?? 'bench-grid') : undefined;

  const groups = useMemo(() => groupSlots([...eligibleSlots].sort()), [eligibleSlots]);

  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open || !player) return null;

  const fromLabel = currentSlot ? slotLabel(currentSlot) : '';
  const me = tonight(player);
  const teamAbbr =
    player.teamAbbreviation ||
    player.team?.split(' ').pop()?.substring(0, 3).toUpperCase() ||
    '';

  const sheet = (
    <div className="fixed inset-0 z-[9999]" data-testid="slot-sheet-root">
      {/* Scrim — tapping it is Cancel, same as the cancel bar. */}
      <div
        className="absolute inset-0 bg-black/60 animate-in fade-in-0 duration-150"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Line change"
        className={cn(
          'absolute bottom-0 inset-x-0 mx-auto max-w-md outline-none',
          // ELEVATION (research-applied 2026-08-27): dark-UI depth is lightness,
          // not shadow. The roster tiles sit at surface-tile; a modal is the top
          // layer, so it takes the family's top step. Same ladder, one rung up.
          'bg-pastel-surface-high border-t border-x border-white/10 rounded-t-2xl shadow-2xl',
          'max-h-[78dvh] flex flex-col',
          'animate-in slide-in-from-bottom-10 fade-in-0 duration-200',
        )}
      >
        {/* ── Header: the player being moved ─────────────────────────── */}
        <div className="relative shrink-0 overflow-hidden rounded-t-2xl border-b border-white/10">
          {/* Faceoff-circle watermark — rink texture that marks the header
              as "on the ice", not decoration for its own sake. */}
          <div className="pointer-events-none absolute -right-8 -top-10 w-36 h-36 rounded-full border-2 border-white/5" aria-hidden="true" />
          <div className="pointer-events-none absolute right-8 top-6 w-2 h-2 rounded-full bg-white/10" aria-hidden="true" />

          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20" aria-hidden="true" />
          <div className="flex items-center justify-between px-4 pt-1.5">
            <p className="font-jbmono text-[10px] font-bold uppercase tracking-[0.24em] text-pastel-sage">
              Line change
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Cancel"
              className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-white/55 hover:text-pastel-cream hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 px-4 pb-3">
            <Mug p={player} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[17px] font-bold leading-tight text-pastel-cream">
                {player.name}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-display text-white/55">
                <img
                  src={`https://assets.nhle.com/logos/nhl/svg/${teamAbbr || 'NHL'}_light.svg`}
                  alt=""
                  className="h-4 w-4 object-contain"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="font-semibold">{teamAbbr}</span>
                {fromLabel && (
                  <>
                    <span className="text-white/25">·</span>
                    <span className="font-jbmono font-bold text-pastel-sage">{fromLabel}</span>
                  </>
                )}
                {player.nextGame?.opponent && (
                  <>
                    <span className="text-white/25">·</span>
                    <span className="text-pastel-sage font-semibold">{player.nextGame.opponent}</span>
                  </>
                )}
                {player.nextGame?.gameTime && !me.live && (
                  <span className="text-white/55">{player.nextGame.gameTime}</span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={cn(
                  'font-varsity text-[22px] font-black leading-none',
                  me.live ? 'text-emerald-500' : 'text-pastel-orange',
                )}
              >
                {me.pts != null ? me.pts.toFixed(1) : '—'}
              </p>
              <p className="mt-0.5 font-display text-[9px] font-semibold uppercase text-white/55">
                {me.live ? 'live' : 'proj'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Destinations ───────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),12px)]">
          {groups.length === 0 ? (
            // Reachable: a locked player, or one whose only legal spot is the
            // one he already fills. Saying so beats an empty box.
            <p className="px-4 py-6 text-center text-xs font-display text-white/55">
              No other slots are open to {player.name} right now.
            </p>
          ) : (
            groups.map((group) => {
              const openCount = group.slots.filter(
                (s) => s !== 'bench-grid' && !occupants.get(s) && s !== currentSlot,
              ).length;
              return (
                <div key={group.key}>
                  {group.heading !== null ? (
                    // The roster page's own section-strip treatment.
                    <div className="flex items-center gap-2 border-b border-pastel-sage/25 bg-gradient-to-r from-pastel-sage/20 via-pastel-sage/10 to-transparent px-4 py-1.5">
                      {group.icon}
                      <span className="font-varsity text-[12px] font-black uppercase tracking-wide text-pastel-cream">
                        {group.heading}
                      </span>
                      {openCount > 0 && (
                        <span className="ml-auto font-jbmono text-[9px] font-bold uppercase tracking-[0.14em] text-pastel-sage">
                          {openCount} open
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="border-t border-white/10" />
                  )}
                  {group.slots.map((slotId) => {
                    const isBench = slotId === 'bench-grid';
                    const isIR = slotId.startsWith('ir-slot-');
                    const occupant = isBench ? undefined : occupants.get(slotId);
                    const isCurrent = slotId === currentSlot;
                    const occ = occupant ? tonight(occupant) : null;
                    return (
                      <button
                        key={slotId}
                        type="button"
                        disabled={isCurrent}
                        onClick={() => {
                          onPick(slotId);
                          onOpenChange(false);
                        }}
                        className={cn(
                          'flex min-h-[56px] w-full items-center gap-3 border-b border-white/5 px-4 text-left transition-colors',
                          isCurrent
                            ? 'opacity-55 cursor-default'
                            : 'hover:bg-white/5 active:bg-white/10',
                        )}
                      >
                        {/* Position chip — the same chip the roster rows wear. */}
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md font-varsity text-[11px] font-black tracking-wide ring-1',
                            chipClassFor(slotId),
                          )}
                        >
                          {isBench ? 'BN' : slotLabel(slotId)}
                        </span>

                        {occupant && <Mug p={occupant} size="sm" />}

                        <span className="min-w-0 flex-1">
                          {isBench ? (
                            <>
                              <span className="flex items-center gap-1.5 font-display text-[14px] font-bold text-pastel-cream">
                                <CitrusLeaf className="w-3.5 h-3.5 text-pastel-sage" />
                                Bench
                              </span>
                              <span className="block text-[11px] font-display text-white/55">
                                {benchCount === 1 ? '1 player' : `${benchCount} players`}
                              </span>
                            </>
                          ) : occupant ? (
                            <>
                              <span className="block truncate font-display text-[14px] font-bold text-pastel-cream">
                                {occupant.name}
                              </span>
                              <span className="block truncate text-[11px] font-display text-white/55">
                                {isCurrent ? 'Current spot' : `Swaps to ${fromLabel || 'Bench'}`}
                              </span>
                            </>
                          ) : (
                            <span className="flex items-center gap-1.5 font-display text-[14px] font-semibold text-pastel-sage">
                              {isIR && <Skull className="w-3.5 h-3.5 text-red-400" />}
                              Open spot
                            </span>
                          )}
                        </span>

                        {/* Tonight's number for the player already there — the
                            comparison that decides the swap. */}
                        {occupant && !isCurrent && (
                          <span className="shrink-0 text-right">
                            <span
                              className={cn(
                                'block font-varsity text-[15px] font-black leading-none',
                                occ?.live ? 'text-emerald-500' : 'text-pastel-orange',
                              )}
                            >
                              {occ?.pts != null ? occ.pts.toFixed(1) : '—'}
                            </span>
                            <span className="block text-[9px] font-display font-semibold uppercase text-white/55">
                              {occ?.live ? 'live' : 'proj'}
                            </span>
                          </span>
                        )}

                        {isCurrent ? (
                          <Check className="w-4 h-4 shrink-0 text-pastel-sage" aria-hidden="true" />
                        ) : occupant ? (
                          <ArrowRightLeft className="w-4 h-4 shrink-0 text-white/55" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-4 h-4 shrink-0 text-white/55" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

export default SlotPickerMenu;
