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
 *
 * TWO SHAPES, because the artboard has two. Inside a screen (1a's matchup)
 * the tabs sit left, sized to their words, at 12px/.12em — they are a minor
 * control under a scoreboard that outranks them. When the tabs ARE the
 * screen's navigation (4a's draft: Players / Queue / Board / My team) they
 * divide the full width in four centred columns at 13px/.14em, and the active
 * rule is pulled down a pixel so it lands ON the strip's hairline instead of
 * above it. `fill` picks the second.
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
  /** Four equal centred columns at 13px, for a screen's own navigation. */
  fill?: boolean;
  className?: string;
}

export function PressBoxTabs({ tabs, activeKey, onSelect, label, fill, className }: PressBoxTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        PB_TYPE,
        'flex border-b border-white/[0.08]',
        'font-condensed font-bold uppercase text-pressbox-text/50',
        fill
          ? 'text-[13px] tracking-[0.14em] lg:gap-7 lg:px-1'
          : 'px-3 gap-[14px] text-[12px] tracking-[0.12em]',
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
              'pb-hit-y whitespace-nowrap uppercase',
              /* `fill` divides a PHONE's width. From lg the same strip goes
                 back to word-sized tabs on the left: three words spread
                 across a 900px column is the artboard's rule applied to a
                 screen it was never drawn for. */
              fill ? 'flex-1 text-center pt-2 pb-2.5 -mb-px lg:flex-none lg:text-left' : 'py-2',
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
