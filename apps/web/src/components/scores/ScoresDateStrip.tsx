/**
 * The date strip.
 *
 * Copied from theScore and the CBS Sports NHL scoreboard, both of which put a
 * horizontal, scrollable run of days above the list rather than a picker you
 * have to open. A scores screen is one query over one day, so the day is the
 * primary axis and earns persistent chrome: you can always see where you are
 * and move one day without a modal.
 *
 * The selected cell scrolls itself into view on mount and on every change, so
 * arriving from a deep link three weeks out does not land you staring at a
 * strip scrolled to today.
 */

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildDateStrip, shiftDate, friendlyDateLabel } from './scoresFormat';

interface ScoresDateStripProps {
  selected: string;
  onSelect: (date: string) => void;
  /** Dates that have at least one game, when known. Used only for the dot. */
  datesWithGames?: Set<string>;
}

export function ScoresDateStrip({ selected, onSelect, datesWithGames }: ScoresDateStripProps) {
  const days = buildDateStrip(selected);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selected]);

  return (
    <div className="bg-pastel-surface/95 backdrop-blur-sm border-b border-pastel-sage/15">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <button
          type="button"
          onClick={() => onSelect(shiftDate(selected, -1))}
          aria-label="Previous day"
          className="p-1.5 -ml-1.5 rounded-full text-pastel-sage/70 active:bg-pastel-surface-high touch-manipulation"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-varsity text-sm text-pastel-cream tracking-wide">
          {friendlyDateLabel(selected)}
        </span>
        <button
          type="button"
          onClick={() => onSelect(shiftDate(selected, 1))}
          aria-label="Next day"
          className="p-1.5 -mr-1.5 rounded-full text-pastel-sage/70 active:bg-pastel-surface-high touch-manipulation"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Choose a date"
        // `scrollbar-hide` is the repo's own utility in src/index.css, not a
        // Tailwind default. It covers Firefox and WebKit in one class.
        className="flex gap-1.5 overflow-x-auto px-3 pb-2.5 scrollbar-hide snap-x"
      >
        {days.map((d) => {
          const isSelected = d.date === selected;
          const hasGames = datesWithGames?.has(d.date);
          return (
            <button
              key={d.date}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="tab"
              aria-selected={isSelected}
              data-date={d.date}
              onClick={() => onSelect(d.date)}
              className={cn(
                'flex flex-col items-center justify-center flex-shrink-0 snap-center',
                'w-[46px] h-[52px] rounded-xl touch-manipulation transition-colors',
                isSelected
                  ? 'bg-pastel-orange text-pastel-surface'
                  : 'bg-pastel-surface-tile text-pastel-cream/70 active:bg-pastel-surface-high',
              )}
            >
              <span
                className={cn(
                  'font-jbmono text-[9px] tracking-[0.14em] leading-none',
                  isSelected ? 'text-pastel-surface/80' : 'text-pastel-sage/70',
                )}
              >
                {d.weekday}
              </span>
              <span className="font-varsity text-base leading-none mt-1">{d.day}</span>
              <span className="h-1 mt-0.5 flex items-center">
                {d.isToday ? (
                  <span
                    className={cn(
                      'block w-1 h-1 rounded-full',
                      isSelected ? 'bg-pastel-surface' : 'bg-pastel-orange',
                    )}
                    aria-label="Today"
                  />
                ) : hasGames ? (
                  <span
                    className={cn(
                      'block w-1 h-1 rounded-full',
                      isSelected ? 'bg-pastel-surface/60' : 'bg-pastel-sage/50',
                    )}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ScoresDateStrip;
