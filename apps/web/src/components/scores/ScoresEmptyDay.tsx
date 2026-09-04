/**
 * The empty day.
 *
 * A scores screen spends a real part of the year with nothing on it: the NHL
 * offseason runs from mid-June to late September, and today (2026-09-02) sits
 * squarely inside it. The last game in `nhl_games` was 2026-06-14 and the next
 * is 2026-09-29.
 *
 * So this state does more than say "no games". The server already knows the
 * nearest date on either side that has games, and this offers both as one tap
 * each. Anything else leaves the reader guessing where the season went.
 */

import { CalendarOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { shortDateLabel } from './scoresFormat';

interface ScoresEmptyDayProps {
  nearest: { before: string | null; after: string | null };
  onSelect: (date: string) => void;
}

export function ScoresEmptyDay({ nearest, onSelect }: ScoresEmptyDayProps) {
  return (
    <div
      data-testid="scores-empty-day"
      className={cn(PB_TYPE, 'flex flex-col items-center text-center px-6 py-12')}
    >
      <CalendarOff className="h-7 w-7 text-pressbox-text/40 mb-3" aria-hidden="true" />
      <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">No games on this date</p>
      <p className="font-barlow text-[12px] text-pressbox-text/45 mt-1.5 max-w-[260px] leading-snug">
        Nothing is scheduled. Jump to the closest day that has hockey.
      </p>

      {nearest.before || nearest.after ? (
        <div className="flex gap-2 mt-4 font-plex font-semibold text-[10px] tracking-[0.06em]">
          {nearest.before ? (
            <button
              type="button"
              onClick={() => onSelect(nearest.before as string)}
              className="focus-citrus px-3.5 py-2 rounded-full bg-pressbox-tile border border-white/10 text-pressbox-text/70 touch-manipulation"
            >
              ‹ {shortDateLabel(nearest.before).toUpperCase()}
            </button>
          ) : null}
          {nearest.after ? (
            <button
              type="button"
              onClick={() => onSelect(nearest.after as string)}
              className="focus-citrus px-3.5 py-2 rounded-full bg-pressbox-text text-pressbox-surface touch-manipulation"
            >
              NEXT GAMES · {shortDateLabel(nearest.after).toUpperCase()} ›
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ScoresEmptyDay;
