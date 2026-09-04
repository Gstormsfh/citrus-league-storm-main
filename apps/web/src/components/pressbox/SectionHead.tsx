/**
 * THE PRESS BOX SECTION HEAD.
 *
 * `MATCHUPS` / `STARTERS · 13/13` / `BENCH · 6` — Barlow Condensed 700 at
 * 15px, uppercase, `.08em`. The count rides INSIDE the heading at 45%
 * opacity rather than beside it, because `STARTERS · 13/13` is one fact —
 * this section, and whether it is full — and splitting it into a heading plus
 * a badge makes a reader assemble it.
 *
 * The right slot is for the one action a section earns: `WEEK 1 ›` on the
 * League HQ matchups, the day tabs on the roster. Orange-soft when it is a
 * link, because on this screen it is the only thing that moves.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxSectionHeadProps {
  title: string;
  /** `13/13`, `6`. Rendered as `· count` inside the heading. */
  count?: string | number | null;
  /** `WEEK 1 ›`, or a control. Sits hard right. */
  action?: React.ReactNode;
  /** 14px instead of 15 — the artboard's size for a head inside a card stack. */
  sm?: boolean;
  className?: string;
}

export function PressBoxSectionHead({ title, count, action, sm, className }: PressBoxSectionHeadProps) {
  return (
    <div className={cn(PB_TYPE, 'flex items-center justify-between gap-2', className)}>
      <h2
        className={cn(
          'font-condensed font-bold uppercase tracking-[0.08em] text-pressbox-text truncate',
          sm ? 'text-[14px]' : 'text-[15px]',
        )}
      >
        {title}
        {count != null && count !== '' && (
          <span className="text-pressbox-text/45"> &middot; {count}</span>
        )}
      </h2>
      {action}
    </div>
  );
}

export default PressBoxSectionHead;
