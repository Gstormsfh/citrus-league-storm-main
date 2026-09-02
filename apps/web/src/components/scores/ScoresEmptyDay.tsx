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
import { shortDateLabel } from './scoresFormat';

interface ScoresEmptyDayProps {
  nearest: { before: string | null; after: string | null };
  onSelect: (date: string) => void;
}

export function ScoresEmptyDay({ nearest, onSelect }: ScoresEmptyDayProps) {
  return (
    <div
      data-testid="scores-empty-day"
      className="flex flex-col items-center text-center px-6 py-12"
    >
      <CalendarOff className="h-7 w-7 text-pastel-sage/40 mb-3" aria-hidden="true" />
      <p className="font-varsity text-base text-pastel-cream">No games on this date</p>
      <p className="font-display text-xs text-pastel-forest-dim mt-1.5 max-w-[260px] leading-snug">
        Nothing is scheduled. Jump to the closest day that has hockey.
      </p>

      {nearest.before || nearest.after ? (
        <div className="flex gap-2 mt-4">
          {nearest.before ? (
            <button
              type="button"
              onClick={() => onSelect(nearest.before as string)}
              className="px-3.5 py-2 rounded-full bg-pastel-surface-tile text-pastel-cream font-display text-xs active:bg-pastel-surface-high touch-manipulation"
            >
              Back to {shortDateLabel(nearest.before)}
            </button>
          ) : null}
          {nearest.after ? (
            <button
              type="button"
              onClick={() => onSelect(nearest.after as string)}
              className="px-3.5 py-2 rounded-full bg-pastel-orange text-pastel-surface font-display text-xs font-semibold active:opacity-90 touch-manipulation"
            >
              Next games {shortDateLabel(nearest.after)}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ScoresEmptyDay;
