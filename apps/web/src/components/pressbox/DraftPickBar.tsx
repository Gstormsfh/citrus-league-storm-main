/**
 * THE DRAFT PICK BAR (artboard 4a/4b).
 *
 * The only piece of the draft room that is always on screen, so the artboard
 * gives it everything a drafter needs when the clock is the loudest thing in
 * the room:
 *
 *   * A 3px SAGE PROGRESS RULE across the top — how far through the draft the
 *     room is. Sage because it is what has HAPPENED; the bar is a record, not
 *     a warning.
 *   * `YOUR PICK · 3.07` in orange-soft over the clock at 34px/1. The label
 *     is the answer to "when", the clock to "how long", and they are stacked
 *     rather than side by side so the number can be read from a phone on a
 *     table.
 *   * ONE ACTION, full width of what is left, orange, with the pick spelled
 *     out under it: `DRAFT MAKAR` over `QUEUE #1 · D · 612`. A draft room
 *     that puts two buttons here makes you read before you tap, and the
 *     clock is running.
 *
 * THE CLOCK IS SAGE, not orange, and that is deliberate on the artboard: the
 * timer is a fact about the room, and orange is reserved for the thing you
 * are about to DO. When time is nearly gone the page passes `urgent` and the
 * clock turns grapefruit — the only state where a number here shouts.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxDraftPickBarProps {
  /** 0–1. The share of the draft's picks already made. */
  progress: number;
  /** `YOUR PICK · 3.07`, or `ON THE CLOCK`, or whose turn it is. */
  eyebrow: React.ReactNode;
  /** `1:12`. The page formats it; this only renders it. */
  clock: string;
  urgent?: boolean;
  /** `Draft Makar`. Absent renders the bar without an action. */
  actionLabel?: React.ReactNode;
  onAction?: () => void;
  actionDisabled?: boolean;
  /** Not `fixed`: the caller owns the bar's position. */
  inline?: boolean;
  /** Anything the room adds under the main row — a decision line, chips. */
  children?: React.ReactNode;
  /** Test ids the room's contract pins. */
  clockTestId?: string;
  actionTestId?: string;
  /** Accessible name for the clock. */
  clockLabel?: string;
  /** `QUEUE #1 · D · 612`. Rendered inside the action, under the label. */
  actionDetail?: React.ReactNode;
  className?: string;
}

export function PressBoxDraftPickBar({
  progress,
  eyebrow,
  clock,
  urgent,
  actionLabel,
  actionDetail,
  onAction,
  actionDisabled,
  inline,
  children,
  clockTestId,
  actionTestId,
  clockLabel,
  className,
}: PressBoxDraftPickBarProps) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div
      className={cn(
        PB_TYPE,
        !inline && 'fixed bottom-0 left-0 right-0 z-app-nav lg:hidden',
        'bg-pressbox-surface border-t border-white/[0.08]',
        className,
      )}
    >
      <div className="h-[3px] bg-white/[0.08]" aria-hidden="true">
        <div className="h-full bg-pressbox-sage" style={{ width: `${pct}%` }} />
      </div>

      <div className={cn('flex items-center gap-3 px-3.5 pt-3', children ? 'pb-2' : 'pb-[max(26px,env(safe-area-inset-bottom))]')}>
        <div>
          <p className="font-condensed font-bold text-[10px] uppercase tracking-[0.14em] text-pressbox-orange-soft">
            {eyebrow}
          </p>
          <p
            className={cn(
              'mt-0.5 font-plex font-semibold text-[34px] leading-none tabular-nums tracking-[-0.02em]',
              urgent ? 'text-pressbox-grapefruit-text' : 'text-pressbox-sage',
            )}
            data-testid={clockTestId}
            aria-label={clockLabel}
          >
            {clock}
          </p>
        </div>

        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            data-testid={actionTestId}
            className={cn(
              'focus-citrus flex-1 h-[52px] rounded-[12px] bg-pressbox-orange text-pressbox-orange-ink',
              'flex flex-col items-center justify-center leading-[1.1] disabled:opacity-40',
              /* The verb takes what the clock leaves on a PHONE. In a desktop
                 column that is 430px of orange; from lg it stops at a hand's
                 width and the row sits left. */
              'lg:max-w-[320px]',
            )}
          >
            <span className="font-condensed font-bold text-[14px] uppercase tracking-[0.1em]">
              {actionLabel}
            </span>
            {actionDetail && (
              <span className="mt-0.5 font-plex font-medium text-[9px] opacity-75">{actionDetail}</span>
            )}
          </button>
        )}
      </div>
      {children && <div className="px-3.5 pb-[max(26px,env(safe-area-inset-bottom))]">{children}</div>}
    </div>
  );
}

export default PressBoxDraftPickBar;
