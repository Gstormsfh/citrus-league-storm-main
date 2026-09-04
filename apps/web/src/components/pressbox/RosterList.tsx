/**
 * THE PRESS BOX ROSTER LIST — team card, day toggles, column header,
 * STARTERS, BENCH. Layout only: every figure arrives as a prop, so the list
 * renders and is asserted against without a network.
 *
 * THE GUTTER LIVES HERE, NOT ON THE ROW. The reference wraps the whole
 * section in `padding:10px 12px 0` and gives the rows no horizontal padding
 * of their own, so the hairline between rows runs the full width of the
 * column and the header's labels sit exactly over the numbers they name. A
 * row that carried its own `px-3` would inset every rule by 12px and break
 * both.
 *
 * Section header, off the artboard:
 *   `font:700 15px 'Barlow Condensed';text-transform:uppercase;
 *    letter-spacing:.08em`, with the count in `rgba(243,239,230,.45)`;
 *   `padding:0 2px`, and `margin-top:8px;padding:8px 2px;border-top:1px solid
 *   rgba(255,255,255,.08)` on the BENCH one, which is what separates the two
 *   halves of the roster without a heavier rule.
 *
 * Column header: `font:500 9px 'IBM Plex Mono';color:rgba(243,239,230,.4);
 * letter-spacing:.06em`, on the row's own grid, `padding:8px 2px 4px`.
 *
 * THE STARTERS COUNT IS FILLED-OVER-REQUIRED, and it is passed in. A list
 * that draws twelve players and one empty slot must read `12/13`; derived
 * from `rows.length` it would read `13/13` and hide the hole it is rendering,
 * which is the one thing that header exists to surface.
 *
 * THE BENCH NOTE IS DERIVED OR ABSENT. `2 PLAYING TONIGHT · PTS DON'T COUNT`
 * appears only when a bench player actually has a game. Nobody playing means
 * no note, never `0 PLAYING TONIGHT`.
 */
import { cn } from '@/lib/utils';

import { PressBoxRosterRow, type PressBoxRosterRowPlayer } from './RosterRow';

export interface PressBoxRosterSlotRow {
  slotId: string;
  /** What the chip prints: `C`, `LW`, `UTIL`, `BN`, `IR`. */
  slot: string;
  player: PressBoxRosterRowPlayer | null;
  locked?: boolean;
  dtd?: boolean;
  selected?: boolean;
  eligibleTarget?: boolean;
}

export interface PressBoxRosterListProps {
  days: string[];
  activeDay: string;
  onDayChange?: (day: string) => void;
  starters: PressBoxRosterSlotRow[];
  bench: PressBoxRosterSlotRow[];
  startersFilled: number;
  startersRequired: number;
  /** Bench players with a game on the day being shown. */
  benchPlayingCount?: number;
  /** Draw the WK column. Off until a page has a real per-player week total. */
  showWeek?: boolean;
  /** Draw the `100% · 99%` segment. Off until the ownership aggregate exists. */
  showOwnership?: boolean;
  /** Rendered above STARTERS. Omit on a surface that has no team card. */
  teamCard?: React.ReactNode;
  onSlotPress?: (slotId: string) => void;
  onNamePress?: (row: PressBoxRosterSlotRow) => void;
  onEmptyPress?: (slotId: string) => void;
  className?: string;
}

const SECTION =
  'font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text';
const COUNT = 'text-pressbox-text/45';
const COLHEAD =
  'font-plex font-medium text-[9px] uppercase tracking-[0.06em] text-pressbox-text/40';

export function PressBoxRosterList({
  days,
  activeDay,
  onDayChange,
  starters,
  bench,
  startersFilled,
  startersRequired,
  benchPlayingCount = 0,
  showWeek = false,
  showOwnership = false,
  teamCard,
  onSlotPress,
  onNamePress,
  onEmptyPress,
  className,
}: PressBoxRosterListProps) {
  const grid = showWeek
    ? 'grid-cols-[30px_30px_1fr_52px_44px]'
    : 'grid-cols-[30px_30px_1fr_52px]';

  const renderRow = (row: PressBoxRosterSlotRow, isBench: boolean) => (
    <PressBoxRosterRow
      key={row.slotId}
      player={row.player}
      slot={row.slot}
      bench={isBench}
      locked={row.locked}
      dtd={row.dtd}
      selected={row.selected}
      eligibleTarget={row.eligibleTarget}
      showWeek={showWeek}
      showOwnership={showOwnership}
      onSlotPress={() => onSlotPress?.(row.slotId)}
      onNamePress={() => onNamePress?.(row)}
      onEmptyPress={() => onEmptyPress?.(row.slotId)}
    />
  );

  return (
    <div className={cn('bg-pressbox-surface border-t border-white/[0.08] px-3 pt-2.5', className)}>
      {teamCard}

      <div className="flex items-center justify-between mt-3 px-0.5">
        <h2 className={SECTION}>
          Starters <span className={COUNT}>· {startersFilled}/{startersRequired}</span>
        </h2>
        <div role="tablist" aria-label="Lineup day" className="flex gap-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === activeDay}
              onClick={() => onDayChange?.(d)}
              className={cn(
                'font-plex font-semibold text-[10px] px-2 py-[3px] rounded-[4px]',
                d === activeDay ? 'bg-pressbox-tile text-pressbox-text' : 'text-pressbox-text/50',
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* The row's own grid, so every label lands over its column. */}
      <div aria-hidden="true" className={cn('grid gap-2 pt-2 pb-1 px-0.5', grid, COLHEAD)}>
        <span />
        <span />
        <span>Player{showOwnership && ' · Ros% / Start%'}</span>
        <span className="text-right">Today</span>
        {showWeek && <span className="text-right">Wk</span>}
      </div>

      <div>{starters.map((r) => renderRow(r, false))}</div>

      <div className="flex items-center justify-between mt-2 py-2 px-0.5 border-t border-white/[0.08]">
        <h2 className={SECTION}>
          Bench <span className={COUNT}>· {bench.length}</span>
        </h2>
        {benchPlayingCount > 0 && (
          <span className="font-plex font-medium text-[10px] uppercase tracking-[0.02em] text-pressbox-orange-soft whitespace-nowrap">
            {benchPlayingCount} playing tonight · pts don't count
          </span>
        )}
      </div>

      <div>{bench.map((r) => renderRow(r, true))}</div>
    </div>
  );
}

export default PressBoxRosterList;
