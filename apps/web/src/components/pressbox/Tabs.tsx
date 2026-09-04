/**
 * THE PRESS BOX UNDERLINE TABS.
 *
 * The artboard has two tab treatments and they are not interchangeable.
 * `PressBoxSegmented` is a pill group in a well — that is a FILTER: it
 * re-sorts or re-cuts what is already on screen (Standings / Power / Playoff
 * Odds / Median are four views of one table). This one is an underline bar in
 * Barlow Condensed at 12px with `.12em` tracking, and it is NAVIGATION: each
 * tab swaps the content beneath it for something else entirely (Lineups /
 * Categories / Bench / Tonight). Orange marks where you are, because unlike a
 * filter, a tab IS a place.
 *
 * `padding:0 12px; gap:14px` and `padding:8px 0` per tab, off artboard 1a.
 * The active tab's 2px orange rule sits directly on the strip's own 1px
 * hairline rather than replacing it, so the row keeps its full-width edge
 * whichever tab is selected.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxTab {
  key: string;
  label: string;
}

export interface PressBoxTabsProps {
  tabs: PressBoxTab[];
  activeKey: string;
  onSelect?: (key: string) => void;
  /** Names the bar for a screen reader. `Matchup view`, not `Tabs`. */
  label: string;
  className?: string;
}

export function PressBoxTabs({ tabs, activeKey, onSelect, label, className }: PressBoxTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        PB_TYPE,
        'flex px-3 gap-[14px] border-b border-white/[0.08]',
        'font-condensed font-bold text-[12px] tracking-[0.12em] uppercase text-pressbox-text/50',
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect?.(t.key)}
            className={cn(
              'py-2 whitespace-nowrap',
              active && 'text-pressbox-text border-b-2 border-pressbox-orange',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default PressBoxTabs;
