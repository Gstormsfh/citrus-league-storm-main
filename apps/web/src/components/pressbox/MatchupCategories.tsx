/**
 * The CATEGORIES tab of the Match screen (2026-09-05). See
 * categoryRows.ts for the arithmetic. One row per category: your
 * total on the left, theirs on the right, the leader in sage, the
 * trailing side at .55, a 3px bar between them split by share. The tally
 * heads the list.
 */
import { cn } from '@/lib/utils';
import type { MatchupPlayer } from '@/components/matchup/types';
import { PB_TYPE } from './rowScale';
import { categoryRows, categoryTally, leader } from './categoryRows';

export interface PressBoxMatchupCategoriesProps {
  yours: MatchupPlayer[];
  theirs: MatchupPlayer[];
  yourName: string;
  theirName: string;
  className?: string;
}

export function PressBoxMatchupCategories({ yours, theirs, yourName, theirName, className }: PressBoxMatchupCategoriesProps) {
  const rows = categoryRows(yours, theirs);
  const tally = categoryTally(rows);
  return (
    <div className={cn(PB_TYPE, className)} data-testid="matchup-categories">
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
        <span className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45 truncate">{yourName}</span>
        <span className="font-plex font-semibold text-[12px] tabular-nums text-pressbox-text" data-testid="matchup-categories-tally">
          <span className="text-pressbox-sage">{tally.you}</span>
          <span className="text-pressbox-text/45"> – </span>
          {tally.them}
          <span className="text-pressbox-text/45"> – {tally.even}</span>
        </span>
        <span className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45 truncate text-right">{theirName}</span>
      </div>
      <ul>
        {rows.map((r) => {
          const who = leader(r);
          const total = r.yours + r.theirs;
          const share = total > 0 ? (r.yours / total) * 100 : 50;
          return (
            <li
              key={r.key}
              data-testid="matchup-category-row"
              data-leader={who}
              className="grid grid-cols-[52px_1fr_52px] items-center gap-3 px-3 min-h-[44px] border-t border-white/[0.06]"
            >
              <span className={cn('font-plex font-semibold text-[17px] tabular-nums leading-none', who === 'you' ? 'text-pressbox-sage' : 'text-pressbox-text/55')}>
                {r.yours.toFixed(r.decimals)}
              </span>
              <span className="min-w-0">
                <span className="block text-center font-plex font-semibold text-[9px] tracking-[0.12em] uppercase text-pressbox-text/45">{r.label}</span>
                <span className="mt-1.5 block h-[3px] rounded-full bg-pressbox-ice/60 overflow-hidden" aria-hidden="true">
                  <span className="block h-full bg-pressbox-orange transition-[width] duration-700 ease-out" style={{ width: `${share}%` }} />
                </span>
              </span>
              <span className={cn('text-right font-plex font-semibold text-[17px] tabular-nums leading-none', who === 'them' ? 'text-pressbox-sage' : 'text-pressbox-text/55')}>
                {r.theirs.toFixed(r.decimals)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PressBoxMatchupCategories;
