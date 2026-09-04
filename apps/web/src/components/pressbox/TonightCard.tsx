/**
 * TONIGHT ON YOUR ROSTERS (artboard 1a, home).
 *
 * Three cards, one line each: the game state, the name, and the number. It is
 * the home screen's answer to "is anything happening for me right now", and
 * the artboard deliberately does not make it a list — three is what fits
 * without scrolling, and the fourth-most-interesting player tonight is not
 * worth a swipe from a screen whose job is to send you somewhere else.
 *
 * A played number is sage with its stat line beside it; an unplayed one is
 * orange with `PROJ`. Same rule as every other Press Box surface: sage is
 * what happened, orange is what is still yours to change.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxTonightPlayer {
  id: string;
  /** `EDM · 3RD`, or `COL · 8:00`. */
  gameLine: string;
  name: string;
  points?: number | null;
  /** `1G 2A`, or `PROJ`. */
  unit?: string | null;
  played?: boolean;
}

export interface PressBoxTonightCardsProps {
  players: PressBoxTonightPlayer[];
  className?: string;
}

export function PressBoxTonightCards({ players, className }: PressBoxTonightCardsProps) {
  if (players.length === 0) return null;
  return (
    <div className={cn(PB_TYPE, 'grid grid-cols-3 gap-2', className)}>
      {players.slice(0, 3).map((p) => (
        <div key={p.id} className="p-2.5 rounded-[12px] bg-pressbox-tile border border-white/[0.08]">
          <p className="font-plex font-semibold text-[10px] text-pressbox-text/50 truncate">{p.gameLine}</p>
          <p className="mt-1 font-barlow font-bold text-[14px] text-pressbox-text truncate">{p.name}</p>
          <p
            className={cn(
              'mt-0.5 font-plex font-semibold text-[15px] tabular-nums',
              p.played ? 'text-pressbox-sage' : 'text-pressbox-orange-soft',
            )}
          >
            {p.points == null ? '–' : p.points.toFixed(1)}
            {p.unit && <span className="ml-1 text-[9px] text-pressbox-text/50">{p.unit}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

export default PressBoxTonightCards;
