/**
 * THE LEAGUE-WIDE SCORE TICKER (artboard 1a, home).
 *
 * A 40px rail with an orange `NHL` tag welded to its left edge and the real
 * games running past it in 11px mono. It is the one piece of Press Box that
 * is not about the user's fantasy team at all, and it sits second from the
 * top on purpose: a fantasy manager's first question in the evening is
 * whether hockey is on, and the answer should not be three taps away.
 *
 * The period clock is sage — it HAPPENED, or is happening — and a start time
 * is dimmed, because a scheduled game is information you cannot act on yet.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxTickerGame {
  id: string;
  /** `EDM 3 · TOR 2`, already assembled by the caller. */
  line: string;
  /** `3rd 4:12`. Sage when the game is live or final. */
  state?: string | null;
  live?: boolean;
}

export interface PressBoxScoreTickerProps {
  label?: string;
  games: PressBoxTickerGame[];
  className?: string;
}

export function PressBoxScoreTicker({ label = 'NHL', games, className }: PressBoxScoreTickerProps) {
  if (games.length === 0) return null;
  return (
    <div
      className={cn(
        PB_TYPE,
        'h-10 rounded-[10px] bg-pressbox-tile border border-white/[0.08] overflow-hidden',
        'flex items-center font-plex font-semibold text-[11px]',
        className,
      )}
    >
      <span className="h-full px-2.5 flex items-center flex-none bg-pressbox-orange text-pressbox-orange-ink tracking-[0.1em]">
        {label}
      </span>
      <div className="flex gap-[18px] px-3 whitespace-nowrap overflow-x-auto text-pressbox-text/85 scrollbar-none">
        {games.map((g) => (
          <span key={g.id}>
            {g.line}
            {g.state && (
              <span className={g.live ? ' text-pressbox-sage' : ' text-pressbox-text/50'}> {g.state}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export default PressBoxScoreTicker;
