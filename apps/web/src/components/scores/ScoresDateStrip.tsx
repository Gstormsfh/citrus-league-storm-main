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
import { PB_TYPE } from '@/components/pressbox/rowScale';
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
    /* PRESS BOX (2026-09-04): the Match screen's `‹ WK 1 ›` in day form —
       condensed label between chevrons, then the strip of day tiles with
       the selected one in cream on the dark ground, the way the artboard
       draws every selected pill. */
    <div className={cn(PB_TYPE, 'bg-pressbox-surface/95 backdrop-blur-sm border-b border-white/[0.06]')}>
      <div className="flex items-center justify-between px-3.5 pt-2 pb-1">
        <button
          type="button"
          onClick={() => onSelect(shiftDate(selected, -1))}
          aria-label="Previous day"
          className="focus-citrus relative p-1.5 -ml-1.5 rounded-full text-pressbox-text/60 after:absolute after:-inset-2 after:content-['']"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text">
          {friendlyDateLabel(selected)}
        </span>
        <button
          type="button"
          onClick={() => onSelect(shiftDate(selected, 1))}
          aria-label="Next day"
          className="focus-citrus relative p-1.5 -mr-1.5 rounded-full text-pressbox-text/60 after:absolute after:-inset-2 after:content-['']"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Choose a date"
        // `scrollbar-hide` is the repo's own utility in src/index.css, not a
        // Tailwind default. It covers Firefox and WebKit in one class.
        className="flex gap-1.5 overflow-x-auto px-3.5 pb-2.5 scrollbar-hide snap-x"
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
                'focus-citrus flex flex-col items-center justify-center flex-shrink-0 snap-center',
                'w-[46px] h-[52px] rounded-[10px] touch-manipulation transition-colors',
                isSelected
                  ? 'bg-pressbox-text text-pressbox-surface'
                  : 'bg-pressbox-tile border border-white/[0.08] text-pressbox-text/70',
              )}
            >
              <span
                className={cn(
                  'font-plex font-medium text-[9px] tracking-[0.14em] leading-none',
                  isSelected ? 'text-pressbox-surface/70' : 'text-pressbox-text/45',
                )}
              >
                {d.weekday}
              </span>
              <span className="font-plex font-semibold text-[16px] tabular-nums leading-none mt-1">{d.day}</span>
              <span className="h-1 mt-0.5 flex items-center">
                {d.isToday ? (
                  <span
                    className={cn(
                      'block w-1 h-1 rounded-full',
                      isSelected ? 'bg-pressbox-surface' : 'bg-pressbox-orange-soft',
                    )}
                    aria-label="Today"
                  />
                ) : hasGames ? (
                  <span
                    className={cn(
                      'block w-1 h-1 rounded-full',
                      isSelected ? 'bg-pressbox-surface/60' : 'bg-pressbox-sage/50',
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
