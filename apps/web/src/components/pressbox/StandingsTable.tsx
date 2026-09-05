/**
 * THE PRESS BOX STANDINGS TABLE.
 *
 * Grid `16px 1fr 34px 42px 42px 26px 44px`, gap 4, `padding:8px 10px`, inside
 * a `#16241B` card with a 12px radius — all of it off the artboard, which also
 * settles three things a standings table usually gets wrong:
 *
 *   * THE TEAM CELL IS TWO LINES, not one. `Bench Bosses` in Barlow 700 13px
 *     over `@derekv · 78% PO` in 9px mono. The handle is who to needle in
 *     chat and the playoff odds are why the row matters; a single-line table
 *     has room for neither and ends up being a list of numbers nobody reads.
 *   * YOUR ROW IS TINTED AND RAILED, not bolded: `rgba(255,107,26,.08)` with
 *     `box-shadow: inset 3px 0 0 #FF6B1A`. An inset shadow rather than a
 *     border so the rail does not shift the grid by 3px on one row out of
 *     twelve — which is exactly the kind of misalignment that makes a table
 *     feel broken without anyone being able to say why.
 *   * LAST 5 IS FIVE 8px SQUARES, oldest first. Five glyphs read as a shape
 *     at a glance; `WLWWL` has to be spelled out.
 *
 * THE COLUMN HEADER IS 8px, which is below the 9px floor the rest of Press
 * Box holds and well below the app's 10px one. It is the artboard's value and
 * it is kept: these are two-to-six character abbreviations over the numbers
 * they name — `PF`, `PA`, `STK` — recognised by position in a table a manager
 * has read a hundred times, not read as words. Nothing else on this screen
 * goes below 9.
 *
 * THE PLAYOFF LINE is a row, not a border on the row above it: a centred 8px
 * label on a 6% orange-soft wash, no rule of its own. It sits AFTER the last
 * team that makes the cut, so the question "am I in" is answered by which
 * side of it you are on rather than by counting. A band rather than a border
 * because a border reads as "these two rows are separated" — which they are
 * not; they are ranked one after the other, with a threshold between them.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

export interface PressBoxStandingsRow {
  teamId: string;
  rank: number;
  name: string;
  /** `@derekv · 78% PO`. Absent renders the name alone. */
  subLine?: string | null;
  record: string;
  pointsFor?: number | null;
  pointsAgainst?: number | null;
  /** `W5` / `L1`. Sage when winning, grapefruit when losing. */
  streak?: string | null;
  /** Oldest first. `true` is a win. */
  lastFive?: boolean[];
  isYou?: boolean;
}

export interface PressBoxStandingsTableProps {
  rows: PressBoxStandingsRow[];
  /** Teams that make the playoffs. The line is drawn after this many rows. */
  playoffSpots?: number | null;
  onRowPress?: (row: PressBoxStandingsRow) => void;
  className?: string;
}

const GRID = 'grid grid-cols-[16px_1fr_34px_42px_42px_26px_44px] gap-1 px-2.5 py-2';
const MONO = 'font-plex tabular-nums';
const fig = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(1));

export function PressBoxStandingsTable({
  rows,
  playoffSpots,
  onRowPress,
  className,
}: PressBoxStandingsTableProps) {
  return (
    <div
      className={cn(
        PB_TYPE,
        'bg-pressbox-tile border border-white/[0.08] rounded-[12px] overflow-hidden',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          GRID,
          MONO,
          'font-semibold text-[8px] tracking-[0.06em] text-pressbox-text/45 border-b border-white/[0.08]',
        )}
      >
        <span>#</span>
        <span>TEAM</span>
        <span>W–L</span>
        <span className="text-right">PF</span>
        <span className="text-right">PA</span>
        <span className="text-center">STK</span>
        <span className="text-right">LAST 5</span>
      </div>

      {rows.map((r, i) => (
        <div key={r.teamId}>
          <button
            type="button"
            onClick={() => onRowPress?.(r)}
            aria-label={`${r.name}, ${r.record}${r.isYou ? ', your team' : ''}`}
            className={cn(
              GRID,
              MONO,
              'w-full items-center text-left font-medium text-[11px] border-b border-white/[0.05]',
              r.isYou && 'bg-pressbox-orange/[0.08] shadow-[inset_3px_0_0_theme(colors.pressbox.orange)]',
            )}
          >
            <span className="text-pressbox-text/60">{r.rank}</span>

            <span className="flex items-center gap-[7px] min-w-0">
              <span
                aria-hidden="true"
                className={cn(
                  'w-[26px] h-[26px] flex-none rounded-full flex items-center justify-center font-condensed font-bold text-[10px]',
                  r.isYou
                    ? 'bg-pressbox-orange/20 border-2 border-pressbox-orange text-pressbox-text'
                    : 'bg-[#2a3a30] text-pressbox-text',
                )}
              >
                {r.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block font-barlow font-bold text-[13px] truncate text-pressbox-text">
                  {r.name}
                  {r.isYou && (
                    <>
                      {' '}
                      <span className={cn(MONO, 'font-semibold text-[9px] text-pressbox-orange-soft')}>
                        YOU
                      </span>
                    </>
                  )}
                </span>
                {r.subLine && (
                  <span className={cn(MONO, 'block font-medium text-[9px] text-pressbox-text/45 truncate')}>
                    {r.subLine}
                  </span>
                )}
              </span>
            </span>

            <span className="font-semibold text-pressbox-text">{r.record}</span>
            <span className="text-right text-pressbox-text">{fig(r.pointsFor)}</span>
            <span className="text-right text-pressbox-text/60">{fig(r.pointsAgainst)}</span>
            <span
              className={cn(
                'text-center',
                r.streak?.startsWith('W') ? 'text-pressbox-sage' : 'text-pressbox-grapefruit-text',
              )}
            >
              {r.streak ?? ''}
            </span>

            <span className="flex gap-0.5 justify-end">
              {(r.lastFive ?? []).map((won, k) => (
                <span
                  key={k}
                  aria-hidden="true"
                  className={cn(
                    'w-2 h-2 rounded-[2px]',
                    won ? 'bg-pressbox-sage' : 'bg-pressbox-grapefruit',
                  )}
                />
              ))}
            </span>
          </button>

          {playoffSpots != null && i + 1 === playoffSpots && i + 1 < rows.length && (
            <div
              data-testid="playoff-line"
              className={cn(
                MONO,
                'px-2.5 py-[3px] text-center font-semibold text-[8px] tracking-[0.1em]',
                'text-pressbox-orange-soft bg-pressbox-orange-soft/[0.06]',
              )}
            >
              PLAYOFF LINE
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default PressBoxStandingsTable;
