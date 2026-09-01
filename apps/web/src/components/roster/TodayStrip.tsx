import { cn } from '@/lib/utils';
import { Lock, Wand2 } from 'lucide-react';
import type { TodaySummary } from './todaySummary';

/**
 * TODAY STRIP (2026-09-01, Sleeper parity audit R1 + R5)
 *
 * One row beneath the day selector, the first thing a manager reads on a
 * game day:
 *
 *   TODAY  9/13 starters play · 2 on bench with games · proj 41.6
 *
 * It turns amber — pastel-orange-soft, the design system's warning accent —
 * only when the arithmetic says points are being left on the bench (a bench
 * player has a game while a starter spot is empty or idle), and in that
 * state it carries the Auto Lineup action inline, so the fix sits next to
 * the diagnosis instead of two scrolls up in the header card.
 *
 * When any player is locked the count folds in here too ("3 locked"), which
 * retires the blue banner that used to say the same thing in two sentences.
 * The row chips carry the lock glyph; this row carries the number.
 *
 * Numbers are jbmono + tabular-nums; words are the muted display face at the
 * text-white/55 floor. Plain fan language throughout.
 *
 * LAYOUT (measured in Chromium at 393px, harness/today.html): every piece —
 * eyebrow, each stat, the action — is a direct child of ONE wrapping flex
 * row, so the strip wraps per segment. A calm day is one line; an amber day
 * with locks is two, with Auto Lineup sharing the last line. Each segment
 * carries its own leading "·" inside its nowrap span, so a wrapped line
 * never opens with a stray dot.
 */

export interface TodayStripProps {
  summary: TodaySummary;
  /** Eyebrow — "Today" or the selected day ("Tue Oct 14"). */
  dayLabel: string;
  /** Past days read "played"; today and later read "play". */
  tense?: 'past' | 'present';
  /**
   * True while the selected date's projections are still loading. The strip
   * would otherwise read "0/13 starters play · proj 0.0" for a second and
   * flash amber on its way to the truth.
   */
  pending?: boolean;
  /**
   * Whether the manager can change this lineup right now (own team, not a
   * demo, not a past date, not best ball). Gates the amber state and the
   * inline action — a warning nobody can act on is noise.
   */
  editable?: boolean;
  /** Inline "Auto Lineup" — the page's existing handler. Hidden when absent. */
  onAutoLineup?: () => void;
  className?: string;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

const NUM = 'font-jbmono text-[12px] font-bold tabular-nums';
const DOT = <span className="text-white/25" aria-hidden="true">· </span>;

export function TodayStrip({
  summary,
  dayLabel,
  tense = 'present',
  pending = false,
  editable = false,
  onAutoLineup,
  className,
}: TodayStripProps) {
  const attention = !pending && editable && summary.needsAttention;
  const state = pending ? 'pending' : attention ? 'attention' : 'calm';
  const verb = tense === 'past' ? 'played' : 'play';
  const showAction = attention && typeof onAutoLineup === 'function';
  const wasted = summary.idleStarters + summary.emptySlots > 0;

  return (
    <div
      data-testid="today-strip"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl px-3 py-2 ring-1 transition-colors',
        'font-display text-[11px] leading-none text-white/55',
        // Calm sits one elevation step above the tab card it lives in
        // (surface-high, the family's hover/active rung) — dark-UI depth is
        // lightness, not shadow. Amber is the warning accent at a tint.
        attention
          ? 'bg-pastel-orange-soft/10 ring-pastel-orange-soft/40'
          : 'bg-pastel-surface-high ring-white/10',
        className,
      )}
    >
      <span
        className={cn(
          'mr-1 font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] leading-none',
          attention ? 'text-pastel-orange-soft' : 'text-pastel-sage',
        )}
      >
        {dayLabel}
      </span>

      {pending ? (
        <span>Checking who plays…</span>
      ) : (
        <>
          <span className="whitespace-nowrap">
            <span
              data-testid="strip-starters"
              className={cn(NUM, attention && wasted ? 'text-pastel-orange-soft' : 'text-pastel-cream')}
            >
              {summary.startersPlaying}/{summary.starterSlots}
            </span>{' '}
            starters {verb}
          </span>

          <span className="whitespace-nowrap">
            {DOT}
            <span
              data-testid="strip-bench"
              className={cn(NUM, attention ? 'text-pastel-orange-soft' : 'text-pastel-cream')}
            >
              {summary.benchPlaying}
            </span>{' '}
            on bench with {summary.benchPlaying === 1 ? 'a game' : 'games'}
          </span>

          <span className="whitespace-nowrap">
            {DOT}
            proj{' '}
            <span data-testid="strip-proj" className={cn(NUM, 'text-pastel-orange')}>
              {fmt(summary.projected)}
            </span>
          </span>

          {summary.locked > 0 && (
            <span
              data-testid="strip-locked"
              className="inline-flex items-baseline gap-1 whitespace-nowrap"
              title="Players whose games have started can't be moved until tomorrow."
            >
              {DOT}
              <Lock className="w-2.5 h-2.5 self-center" aria-hidden="true" />
              <span className={cn(NUM, 'text-pastel-cream')}>{summary.locked}</span> locked
            </span>
          )}
        </>
      )}

      {showAction && (
        <button
          type="button"
          onClick={onAutoLineup}
          className="ml-auto inline-flex items-center gap-1 self-center rounded-md bg-pastel-orange/10 px-2 py-1 font-display text-[11px] font-bold leading-none text-pastel-orange-soft ring-1 ring-pastel-orange/40 transition-transform active:scale-95 hover:bg-pastel-orange/20"
        >
          <Wand2 className="w-3 h-3" aria-hidden="true" />
          Auto Lineup
        </button>
      )}
    </div>
  );
}

export default TodayStrip;
