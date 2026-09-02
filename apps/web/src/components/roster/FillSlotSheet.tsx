import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ChevronRight, Lock, X } from 'lucide-react';
import { CitrusLeaf } from '@/components/icons/CitrusIcons';
import type { HockeyPlayer } from './HockeyPlayerCard';
import { slotLabel } from './slotLabel';
import { chipClassFor, LOCKED_CHIP } from './slotChip';
import { Mug } from './Mug';
import { tonight } from './tonight';

/**
 * FILL SHEET (2026-09-01, Sleeper parity audit R2)
 *
 * The Line Change sheet is player-first: tap a player, pick where he goes.
 * An empty starter spot is the other way round — the manager is standing on
 * the hole and wants to know who can fill it. Sleeper answers an empty-slot
 * tap with the eligible bench list; Yahoo's "tap the position, then tap any
 * player from the listed options" is the same shape. Until now Citrus's
 * empty row said "Empty" and did nothing on tap unless a player was already
 * selected, so the most obvious gesture on the page was a dead one.
 *
 * Same bottom sheet as the Line Change sheet, same chips, same mugs, same
 * "tonight's number" — one visual language for both directions of the move.
 *
 * Eligibility is NOT recomputed here. `candidates` is Roster.tsx's judgement
 * (`isPositionValid` against this slot, games first, then projection), the
 * same single source the Line Change sheet trusts. Locked bench players are
 * listed but disabled, so "why isn't he here?" has an answer on screen.
 */

export interface FillSlotSheetProps {
  /** The empty starter slot being filled. Null renders nothing. */
  slotId: string | null;
  /** Bench players who may legally take the slot, in the order to offer them. */
  candidates: HockeyPlayer[];
  /** Players whose games have started — listed, but not offered. */
  lockedPlayerIds?: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (playerId: string | number) => void;
}

const teamOf = (p: HockeyPlayer) =>
  p.teamAbbreviation || p.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';

export function FillSlotSheet({
  slotId,
  candidates,
  lockedPlayerIds,
  open,
  onOpenChange,
  onPick,
}: FillSlotSheetProps) {
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

  if (!open || !slotId) return null;

  const label = slotLabel(slotId);
  const openCount = candidates.filter((p) => !lockedPlayerIds?.has(String(p.id))).length;

  const sheet = (
    <div className="fixed inset-0 z-[9999]" data-testid="fill-sheet-root">
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
        aria-label="Fill a spot"
        className={cn(
          'absolute bottom-0 inset-x-0 mx-auto max-w-md outline-none',
          'bg-pastel-surface-high border-t border-x border-white/10 rounded-t-2xl shadow-2xl',
          'max-h-[78dvh] flex flex-col',
          'animate-in slide-in-from-bottom-10 fade-in-0 duration-200',
        )}
      >
        {/* ── Header: the spot being filled ──────────────────────────── */}
        <div className="relative shrink-0 overflow-hidden rounded-t-2xl border-b border-white/10">
          <div className="pointer-events-none absolute -right-8 -top-10 w-36 h-36 rounded-full border-2 border-white/5" aria-hidden="true" />
          <div className="pointer-events-none absolute right-8 top-6 w-2 h-2 rounded-full bg-white/10" aria-hidden="true" />

          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20" aria-hidden="true" />
          <div className="flex items-center justify-between px-4 pt-1.5">
            <p className="font-jbmono text-[10px] font-bold uppercase tracking-[0.24em] text-pastel-sage">
              Fill a spot
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
            <span
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-md font-varsity text-[13px] font-black tracking-wide ring-1',
                chipClassFor(slotId),
              )}
            >
              {label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[17px] font-bold leading-tight text-pastel-cream">
                {label} is open
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-display text-white/55">
                <CitrusLeaf className="w-3.5 h-3.5 text-pastel-sage" aria-hidden="true" />
                {openCount === 0
                  ? 'Nobody on the bench can step in'
                  : openCount === 1
                    ? '1 bench player can step in'
                    : `${openCount} bench players can step in`}
              </p>
            </div>
          </div>
        </div>

        {/* ── Candidates ──────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),12px)]">
          {candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs font-display text-white/55">
              No one on your bench can play {label} right now. Check the free agents.
            </p>
          ) : (
            candidates.map((p) => {
              const locked = lockedPlayerIds?.has(String(p.id)) ?? false;
              const t = tonight(p);
              const hasGame = p.nextGame?.isToday === true;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    onPick(p.id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    'flex min-h-[56px] w-full items-center gap-3 border-b border-white/5 px-4 text-left transition-colors',
                    locked ? 'cursor-default' : 'hover:bg-white/5 active:bg-white/10',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md font-varsity text-[11px] font-black tracking-wide ring-1',
                      locked ? LOCKED_CHIP : chipClassFor(slotId),
                    )}
                  >
                    <span className="leading-none">{label}</span>
                    {locked && <Lock className="mt-0.5 w-2.5 h-2.5" aria-hidden="true" />}
                  </span>

                  <Mug p={p} size="sm" />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[14px] font-bold text-pastel-cream">
                      {p.name}
                    </span>
                    <span className="flex items-center gap-1 truncate text-[11px] font-display text-white/55">
                      <span className="font-semibold">{teamOf(p)}</span>
                      {locked ? (
                        <>
                          <span className="text-white/25" aria-hidden="true">·</span>
                          <span>Game started: can't move</span>
                        </>
                      ) : hasGame ? (
                        <>
                          {p.nextGame?.opponent && (
                            <>
                              <span className="text-white/25" aria-hidden="true">·</span>
                              <span className="text-pastel-sage font-semibold">{p.nextGame.opponent}</span>
                            </>
                          )}
                          {p.nextGame?.gameTime && !t.live && (
                            <>
                              <span className="text-white/25" aria-hidden="true">·</span>
                              <span>{p.nextGame.gameTime}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-white/25" aria-hidden="true">·</span>
                          <span>No game today</span>
                        </>
                      )}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        'block font-varsity text-[15px] font-black leading-none',
                        t.live ? 'text-emerald-500' : hasGame ? 'text-pastel-orange' : 'text-white/55',
                      )}
                    >
                      {t.pts != null && hasGame ? t.pts.toFixed(1) : '-'}
                    </span>
                    <span className="block text-[9px] font-display font-semibold uppercase text-white/55">
                      {t.live ? 'live' : 'proj'}
                    </span>
                  </span>

                  {locked ? (
                    <Lock className="w-4 h-4 shrink-0 text-white/55" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="w-4 h-4 shrink-0 text-white/55" aria-hidden="true" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

export default FillSlotSheet;
