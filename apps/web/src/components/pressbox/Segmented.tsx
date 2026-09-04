/**
 * THE PRESS BOX SEGMENTED CONTROL.
 *
 * A pill GROUP, not a full-width tab bar: a `#16241B` well at 8px radius with
 * 2px of padding, segments sized to their own words at `5px 10px`, and the
 * active one taking the cream fill (`#F3EFE6`) with surface-dark ink.
 *
 * Cream is deliberate and it is the artboard's rule, not a spare colour. Sage
 * is where you ARE (live, happened, positive). Orange is what you are DOING
 * (your team, the primary action). A filter is neither — it changes what the
 * screen is showing without asserting anything about the league — so it gets
 * the neutral high-contrast fill and stays out of the semantic palette.
 *
 * SIZING TO THE WORDS is the other half. Four equal quarters make `POWER` and
 * `PLAYOFF ODDS` read as the same weight of choice and stretch the group to a
 * width the options never earned; intrinsic segments end where the options
 * end and leave the rest of the row for whatever sits beside it — on
 * Standings, the sort control.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxSegment {
  key: string;
  label: string;
}

export interface PressBoxSegmentedProps {
  segments: PressBoxSegment[];
  activeKey: string;
  onSelect?: (key: string) => void;
  /** Names the group for a screen reader. `Standings view`, not `Tabs`. */
  label: string;
  className?: string;
}

export function PressBoxSegmented({
  segments,
  activeKey,
  onSelect,
  label,
  className,
}: PressBoxSegmentedProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        PB_TYPE,
        'inline-flex gap-0.5 p-0.5 rounded-[8px] bg-pressbox-tile',
        'font-plex font-semibold text-[10px] tracking-[0.06em]',
        className,
      )}
    >
      {segments.map((s) => {
        const active = s.key === activeKey;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect?.(s.key)}
            className={cn(
              'px-2.5 py-[5px] whitespace-nowrap',
              active
                ? 'rounded-[6px] bg-pressbox-text text-pressbox-surface'
                : 'text-pressbox-text/60',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export default PressBoxSegmented;
