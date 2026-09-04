import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { ArrowRight, Lock, Wand2, X } from 'lucide-react';
import type { HockeyPlayer } from './HockeyPlayerCard';
import { slotLabel } from './slotLabel';
import { chipClassFor } from './slotChip';
import { BENCH, summarisePlans, type AutoLineupPlan, type LineupMove } from './autoLineup';
import { multiPositionLabel } from './positions';

/**
 * AUTO LINEUP SHEET (2026-09-01, Sleeper parity audit R6)
 *
 * Yahoo's Start Active Players and ESPN's Quick Lineup both fire blind: tap,
 * and the lineup is different, with no account of what changed. Citrus used
 * to do the same and toast "Lineup Optimized". This sheet shows the moves
 * and the projected gain BEFORE anything is saved:
 *
 *     AUTO LINEUP
 *     3 moves · proj +2.4
 *     41.6 → 44.0 tonight
 *     [ Today ] [ Rest of week ]
 *     C1 → BN   Leon Draisaitl        —
 *     BN → C1   Bo Horvat           4.8
 *     [ Apply 3 moves ]  Keep current
 *
 * Zero moves is a state, not an empty list: "Lineup already optimal" with
 * the projected total, and a single Done.
 *
 * Same bottom sheet as the Line Change and Fill sheets, same chips, so the
 * three read as one vocabulary. The planner (`autoLineup.ts`) decides what
 * the moves are; this component only shows them. Colour follows the page's
 * identity ≠ standing rule: orange is the primary action and a projection,
 * sage is a gain, muted white is everything that is merely information.
 */

export type AutoLineupScope = 'day' | 'week';

export interface AutoLineupDay {
  /** YYYY-MM-DD */
  date: string;
  /** 'Today' or the day, e.g. 'Thu Oct 16'. */
  label: string;
  plan: AutoLineupPlan;
}

export interface AutoLineupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: AutoLineupScope;
  onScopeChange: (scope: AutoLineupScope) => void;
  /** Label for the single-day option — 'Today', or the day being viewed. */
  dayLabel: string;
  /** The single day's plan. Null renders nothing. */
  day: AutoLineupPlan | null;
  /** Whether Rest of week can be offered (days ≥ today remain in the week). */
  weekAvailable: boolean;
  /** Rest-of-week plans, earliest first; null until computed. */
  week: AutoLineupDay[] | null;
  weekLoading?: boolean;
  weekError?: string | null;
  applying?: boolean;
  onApply: () => void;
  /**
   * No hockey today and none tomorrow (`SeasonStatus.isDormant`).
   *
   * OFFSEASON (2026-09-02). With zero moves this sheet said "Everyone with a
   * game is already starting. Nothing to change tonight." Nobody had a game;
   * the sentence asserted the opposite of the fact that produced it. The
   * word "tonight" is hardcoded for the Today case, so it also promised a
   * slate 27 days before one existed.
   *
   * A zero-move plan has two very different causes — the lineup is optimal,
   * or there is nothing to optimise. This is what tells them apart.
   */
  seasonDormant?: boolean;

}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
const gain = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const teamOf = (p: HockeyPlayer) =>
  p.teamAbbreviation || p.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';

function gameLine(p: HockeyPlayer): string {
  if (p.nextGame?.isToday !== true) return 'No game';
  const parts: string[] = [];
  if (p.nextGame.opponent && p.nextGame.opponent !== 'Game') parts.push(p.nextGame.opponent);
  if (p.nextGame.gameTime) parts.push(p.nextGame.gameTime);
  return parts.length > 0 ? parts.join(' · ') : 'Has a game';
}

function Chip({ slot }: { slot: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-varsity text-[10px] font-black tracking-wide ring-1',
        chipClassFor(slot),
      )}
    >
      {slot === BENCH ? 'BN' : slotLabel(slot)}
    </span>
  );
}

function MoveRow({ move }: { move: LineupMove }) {
  const p = move.player;
  const plays = p.nextGame?.isToday === true;
  const proj = Number(p.projectedPoints) || 0;
  // The planner already places a C/LW wherever the lineup is thinnest;
  // the row now says he is C/LW, so "BN -> LW2" for a centre reads as a
  // plan and not a mistake (gap A). Empty for a single-position player.
  const positions = multiPositionLabel(p);
  return (
    <li
      data-testid="auto-move"
      data-from={move.from}
      data-to={move.to}
      className="flex min-h-[56px] items-center gap-3 border-b border-white/5 px-4"
    >
      <span className="flex shrink-0 items-center gap-1" aria-label={`${slotLabel(move.from)} to ${slotLabel(move.to)}`}>
        <Chip slot={move.from} />
        <ArrowRight className="h-3.5 w-3.5 text-white/55" aria-hidden="true" />
        <Chip slot={move.to} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14px] font-bold text-pastel-cream">{p.name}</span>
        <span className="block truncate text-[11px] font-display text-white/55">
          {positions && (
            <>
              <span data-testid="move-positions" className="font-semibold text-pastel-cream/80">{positions}</span>
              <span className="text-white/25" aria-hidden="true"> · </span>
            </>
          )}
          <span className="font-semibold">{teamOf(p)}</span>
          <span className="text-white/25" aria-hidden="true"> · </span>
          {gameLine(p)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={cn(
            'block font-jbmono text-[15px] font-bold leading-none tabular-nums',
            plays ? 'text-pastel-orange' : 'text-white/55',
          )}
        >
          {plays ? fmt(proj) : '-'}
        </span>
        <span className="block text-[9px] font-display font-semibold uppercase text-white/55">proj</span>
      </span>
    </li>
  );
}

export function AutoLineupSheet({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  dayLabel,
  day,
  weekAvailable,
  week,
  weekLoading = false,
  weekError = null,
  applying = false,
  onApply,
  seasonDormant = false,
}: AutoLineupSheetProps) {
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

  if (!open || !day) return null;

  const isWeek = scope === 'week';
  const weekPlans = isWeek ? (week ?? []) : [];
  const summary = isWeek ? summarisePlans(weekPlans.map((d) => d.plan)) : { moves: day.moves.length, before: day.before, after: day.after };
  const failed = isWeek && !!weekError;
  const ready = !isWeek || (!weekLoading && week !== null && !failed);
  const totalMoves = summary.moves;
  const delta = summary.after - summary.before;
  const when = dayLabel === 'Today' ? 'tonight' : dayLabel;

  const headline = failed
    ? "Couldn't check the week"
    : !ready
      ? 'Checking the rest of the week…'
      : totalMoves === 0
        ? seasonDormant
          ? 'No games to set'
          : isWeek ? 'Week already set' : 'Lineup already optimal'
        : `${plural(totalMoves, 'move', 'moves')} · proj `;

  const subline = !ready
    ? ''
    : isWeek
      ? `${plural(weekPlans.length, 'day', 'days')} · ${fmt(summary.before)} → ${fmt(summary.after)}`
      : totalMoves === 0
        ? seasonDormant ? '' : `proj ${fmt(summary.after)} ${when}`
        : `${fmt(summary.before)} → ${fmt(summary.after)} ${when}`;

  const pinnedNote = (plan: AutoLineupPlan) =>
    plan.pinned.length > 0 ? (
      <p className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-display text-white/55">
        <Lock className="h-3 w-3" aria-hidden="true" />
        {plan.pinned.length === 1 ? '1 locked player stays put' : `${plan.pinned.length} locked players stay put`}
      </p>
    ) : null;

  const sheet = (
    <div className="fixed inset-0 z-sheet" data-testid="auto-sheet-root">
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
        aria-label="Auto lineup"
        className={cn(
          'absolute bottom-0 inset-x-0 mx-auto max-w-md outline-none',
          'bg-pastel-surface-high border-t border-x border-white/10 rounded-t-2xl shadow-2xl',
          'max-h-[82dvh] flex flex-col',
          'animate-in slide-in-from-bottom-10 fade-in-0 duration-200',
        )}
      >
        {/* ── Header: what will change ─────────────────────────────── */}
        <div className="relative shrink-0 overflow-hidden rounded-t-2xl border-b border-white/10">
          <div className="pointer-events-none absolute -right-8 -top-10 w-36 h-36 rounded-full border-2 border-white/5" aria-hidden="true" />
          <div className="pointer-events-none absolute right-8 top-6 w-2 h-2 rounded-full bg-white/10" aria-hidden="true" />

          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20" aria-hidden="true" />
          <div className="flex items-center justify-between px-4 pt-1.5">
            <p className="font-jbmono text-[10px] font-bold uppercase tracking-[0.24em] text-pastel-sage">
              Auto lineup
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
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-pastel-orange/10 text-pastel-orange-soft ring-1 ring-pastel-orange/40">
              <Wand2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                data-testid="auto-sheet-headline"
                className={cn(
                  'truncate font-display text-[17px] font-bold leading-tight text-pastel-cream',
                  !ready && !failed && 'animate-pulse',
                )}
              >
                {headline}
                {ready && totalMoves > 0 && (
                  <span data-testid="auto-sheet-gain" className="font-jbmono tabular-nums text-pastel-sage">
                    {gain(delta)}
                  </span>
                )}
              </p>
              {subline && (
                <p data-testid="auto-sheet-subline" className="mt-0.5 font-jbmono text-[11px] tabular-nums text-white/55">
                  {subline}
                </p>
              )}
            </div>
          </div>

          {weekAvailable && (
            <div
              role="group"
              aria-label="Scope"
              className="mx-4 mb-3 grid grid-cols-2 gap-0.5 rounded-lg bg-white/5 p-0.5"
            >
              {(['day', 'week'] as const).map((s) => {
                const active = scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    data-testid={`auto-scope-${s}`}
                    aria-pressed={active}
                    onClick={() => onScopeChange(s)}
                    className={cn(
                      'h-9 rounded-md font-display text-[12px] font-bold transition-colors',
                      active
                        ? 'bg-pastel-orange/15 text-pastel-orange-soft ring-1 ring-pastel-orange/40'
                        : 'text-white/55 hover:text-pastel-cream',
                    )}
                  >
                    {s === 'day' ? dayLabel : 'Rest of week'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── The moves ─────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!isWeek ? (
            <>
              {pinnedNote(day)}
              {day.moves.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs font-display text-white/55">
                  {seasonDormant
                    ? 'No games scheduled, so there is nothing to set. Lineups matter again when the season opens.'
                    : `Everyone with a game is already starting. Nothing to change ${when}.`}
                </p>
              ) : (
                <ul>
                  {day.moves.map((m) => (
                    <MoveRow key={`${m.player.id}-${m.to}`} move={m} />
                  ))}
                </ul>
              )}
            </>
          ) : weekError ? (
            <p className="px-4 py-6 text-center text-xs font-display text-white/55">{weekError}</p>
          ) : !ready ? (
            <p className="px-4 py-6 text-center text-xs font-display text-white/55">
              Loading projections for each day…
            </p>
          ) : (
            weekPlans.map((d) => (
              <section key={d.date} data-testid="auto-week-day" aria-label={d.label}>
                <div className="flex items-center gap-2 border-b border-pastel-sage/25 bg-gradient-to-r from-pastel-sage/20 via-pastel-sage/10 to-transparent px-4 py-1.5">
                  <span className="font-varsity text-[12px] font-black uppercase tracking-wide text-pastel-cream">
                    {d.label}
                  </span>
                  <span className="ml-auto font-jbmono text-[10px] font-bold tabular-nums text-white/55">
                    {d.plan.moves.length === 0 ? (
                      <>set · proj {fmt(d.plan.after)}</>
                    ) : (
                      <>
                        {plural(d.plan.moves.length, 'move', 'moves')} ·{' '}
                        <span className="text-pastel-sage">{gain(d.plan.after - d.plan.before)}</span>
                      </>
                    )}
                  </span>
                </div>
                {pinnedNote(d.plan)}
                {d.plan.moves.length > 0 && (
                  <ul>
                    {d.plan.moves.map((m) => (
                      <MoveRow key={`${d.date}-${m.player.id}-${m.to}`} move={m} />
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
        </div>

        {/* ── Apply / keep ──────────────────────────────────────────── */}
        <div className="shrink-0 space-y-2 border-t border-white/10 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          {!ready && !failed ? (
            <button
              type="button"
              disabled
              className="h-12 w-full rounded-xl bg-white/10 font-display text-[15px] font-bold text-white/55"
            >
              Checking…
            </button>
          ) : ready && totalMoves > 0 ? (
            <>
              <button
                type="button"
                data-testid="auto-sheet-apply"
                disabled={applying}
                onClick={onApply}
                className={cn(
                  'h-12 w-full rounded-xl bg-pastel-orange font-display text-[15px] font-bold text-[#0F1F15]',
                  'shadow-[0_8px_24px_-8px_rgba(255,107,26,0.6)] transition-transform active:scale-[0.98]',
                  'disabled:bg-white/10 disabled:text-white/55 disabled:shadow-none disabled:active:scale-100',
                )}
              >
                {applying ? 'Saving…' : `Apply ${plural(totalMoves, 'move', 'moves')}`}
              </button>
              <button
                type="button"
                data-testid="auto-sheet-keep"
                disabled={applying}
                onClick={() => onOpenChange(false)}
                className="h-10 w-full rounded-xl font-display text-[13px] font-semibold text-white/55 transition-colors hover:bg-white/5 hover:text-pastel-cream"
              >
                Keep current
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="auto-sheet-done"
              onClick={() => onOpenChange(false)}
              className="h-12 w-full rounded-xl bg-white/10 font-display text-[15px] font-bold text-pastel-cream ring-1 ring-white/15 transition-colors hover:bg-white/15"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}

export default AutoLineupSheet;
