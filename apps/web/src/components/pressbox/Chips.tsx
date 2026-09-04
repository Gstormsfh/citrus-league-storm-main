/**
 * THE PRESS BOX FILTER CHIPS.
 *
 * The third and last of the artboard's selection treatments, and the one that
 * has to be told apart from the other two on sight:
 *
 *   PressBoxTabs      underline bar   — NAVIGATION. The tab is a place.
 *   PressBoxSegmented pills in a well — ONE VIEW of one dataset, four ways.
 *   PressBoxChips     free pills      — A FILTER over a list that stays the
 *                                       same list. Position, availability,
 *                                       starred. Any of them can be off.
 *
 * Fully rounded (`999px`) rather than the segmented control's 6px, and NOT
 * inside a well — the chips float on the surface, so the row can breathe and
 * a trailing chip can be pushed to the far edge with `trailing`, which is
 * where the artboard puts the starred count on the draft pool.
 *
 * Cream fill on the active chip, for the same reason the segmented control
 * takes it: sage is where you are, orange is what you are doing, and a filter
 * is neither.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxChip {
  key: string;
  label: string;
  /** Pushed to the far end of the row. The artboard's starred count. */
  trailing?: boolean;
}

export interface PressBoxChipsProps {
  chips: PressBoxChip[];
  activeKey: string;
  onSelect?: (key: string) => void;
  /** Names the row for a screen reader. `Position filter`, not `Chips`. */
  label: string;
  /**
   * The settings screen's chip: a hairline around the inactive ones. There
   * the row scrolls off the right edge with six sections in it, and the
   * outline is what tells you the chips continue past the fold — the draft's
   * six fit, so they do not need it.
   */
  outlined?: boolean;
  /**
   * The Players screen's row: `5px 10px` where the settings screen's is
   * `6px 10px`. One pixel, and the artboard is explicit about it on both.
   */
  compact?: boolean;
  className?: string;
}

export function PressBoxChips({ chips, activeKey, onSelect, label, outlined, compact, className }: PressBoxChipsProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        PB_TYPE,
        'flex gap-1.5 font-plex font-semibold text-[10px] tracking-[0.06em]',
        className,
      )}
    >
      {chips.map((c) => {
        const active = c.key === activeKey;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect?.(c.key)}
            className={cn(
              'rounded-full whitespace-nowrap',
              outlined ? (compact ? 'px-2.5 py-[5px]' : 'px-2.5 py-1.5') : 'px-[11px] py-[5px]',
              c.trailing && 'ml-auto',
              active
                ? 'bg-pressbox-text text-pressbox-surface'
                : cn('bg-pressbox-tile text-pressbox-text/70', outlined && 'border border-white/10'),
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

export default PressBoxChips;
