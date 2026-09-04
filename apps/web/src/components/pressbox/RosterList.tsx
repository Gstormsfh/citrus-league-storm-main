/**
 * THE PRESS BOX ROSTER LIST (2026-09-04, direction 1a, spec section 4).
 *
 * Team card, action bar, day toggles, column header, STARTERS, BENCH. It owns
 * layout and nothing else: every figure arrives as a prop, so the list can be
 * rendered and asserted against without a network, and the page keeps sole
 * responsibility for where numbers come from.
 *
 * THE SECTION HEADER CARRIES A COUNT, NOT A CLAIM. `STARTERS · 13/13` is
 * filled-over-required, and both halves are passed in. A roster with a hole
 * reads `12/13`, which is the single most useful thing the screen can say
 * before puck drop -- and it is why the count is not derived from
 * `rows.length` here: a list that renders twelve rows and an empty one would
 * otherwise report 13/13 and hide the hole it is showing.
 *
 * THE BENCH NOTE IS DERIVED, NEVER DECORATIVE. `2 PLAYING TONIGHT · PTS DON'T
 * COUNT` only appears when at least one bench player actually has a game, and
 * the count is the count. With nobody playing there is nothing to warn about
 * and the note is absent rather than reading `0 PLAYING TONIGHT`.
 *
 * COLUMN HEADER AT 10px, NOT THE SPEC'S 9. Same floor `rowScale.ts` argues:
 * this repo carries ">= 10px" as a contract three test files assert by name,
 * and `PLAYER · TODAY · WK` is text a manager reads, not a glyph they
 * recognise. The row height is unaffected -- the header is its own 20px band.
 */
import { cn } from '@/lib/utils';

import { PressBoxRosterRow, type PressBoxRosterRowPlayer } from './RosterRow';
import { PB_ROW_MICRO } from './rowScale';

export interface PressBoxRosterSlotRow {
  /** Stable key. The slot id from the page, e.g. `c-1`, `bench-3`. */
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
  /** `THU` `FRI` `SAT` `WEEK` -- whatever the page is offering. */
  days: string[];
  activeDay: string;
  onDayChange?: (day: string) => void;
  starters: PressBoxRosterSlotRow[];
  bench: PressBoxRosterSlotRow[];
  /** Filled and required starter counts. Both from the page's slot plan. */
  startersFilled: number;
  startersRequired: number;
  /** How many bench players have a game on the selected day. */
  benchPlayingCount?: number;
  /**
   * Draw the WK column. Off until a page has a real per-player week total --
   * `HockeyPlayer` carries daily figures only. See `RosterRow.tsx`.
   */
  showWeek?: boolean;
  onSlotPress?: (slotId: string) => void;
  onNamePress?: (row: PressBoxRosterSlotRow) => void;
  onEmptyPress?: (slotId: string) => void;
  className?: string;
}

const SECTION =
  'font-condensed font-extrabold text-[15px] uppercase tracking-[0.08em] text-pressbox-text';

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
  onSlotPress,
  onNamePress,
  onEmptyPress,
  className,
}: PressBoxRosterListProps) {
  const renderRow = (row: PressBoxRosterSlotRow, countsForScoring: boolean) => (
    <PressBoxRosterRow
      key={row.slotId}
      player={row.player}
      slot={row.slot}
      countsForScoring={countsForScoring}
      showWeek={showWeek}
      locked={row.locked}
      dtd={row.dtd}
      selected={row.selected}
      eligibleTarget={row.eligibleTarget}
      onSlotPress={() => onSlotPress?.(row.slotId)}
      onNamePress={() => onNamePress?.(row)}
      onEmptyPress={() => onEmptyPress?.(row.slotId)}
    />
  );

  return (
    <div className={cn('bg-pressbox-surface', className)}>
      {/* STARTERS + the day toggles, on one line: which day you are looking at
          is the same question as which lineup you are looking at. */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className={SECTION}>
          Starters
          <span className="ml-1.5 font-plex font-medium text-[12px] tracking-normal text-pressbox-text/45">
            {startersFilled}/{startersRequired}
          </span>
        </h2>
        <div role="tablist" aria-label="Lineup day" className="flex items-center gap-1">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === activeDay}
              onClick={() => onDayChange?.(d)}
              className={cn(
                'font-plex font-medium text-[10px] uppercase tracking-[0.06em] px-2 h-6 rounded-md',
                d === activeDay
                  ? 'bg-pressbox-tile text-pressbox-text'
                  : 'text-pressbox-text/45',
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* The column header. Same five-column grid as the rows, so the labels
          land over the numbers they name rather than near them. */}
      <div
        aria-hidden="true"
        className={cn(
          'grid items-center gap-2 px-3 h-5 border-b border-white/[0.08]',
          showWeek ? 'grid-cols-[30px_30px_1fr_52px_44px]' : 'grid-cols-[30px_30px_1fr_52px]',
        )}
      >
        <span />
        <span />
        <span className={cn(PB_ROW_MICRO, 'uppercase tracking-[0.08em] text-pressbox-text/45')}>
          Player
        </span>
        <span className={cn(PB_ROW_MICRO, 'uppercase tracking-[0.08em] text-pressbox-text/45 text-right')}>
          Today
        </span>
        {showWeek && (
          <span className={cn(PB_ROW_MICRO, 'uppercase tracking-[0.08em] text-pressbox-text/45 text-right')}>
            Wk
          </span>
        )}
      </div>

      <div>{starters.map((r) => renderRow(r, true))}</div>

      <div className="flex items-center justify-between px-3 pt-4 pb-2">
        <h2 className={SECTION}>
          Bench
          <span className="ml-1.5 font-plex font-medium text-[12px] tracking-normal text-pressbox-text/45">
            {bench.length}
          </span>
        </h2>
        {benchPlayingCount > 0 && (
          <span className={cn(PB_ROW_MICRO, 'uppercase tracking-[0.06em] text-pressbox-orange-soft')}>
            {benchPlayingCount} playing tonight · pts don't count
          </span>
        )}
      </div>

      <div>{bench.map((r) => renderRow(r, false))}</div>
    </div>
  );
}

export default PressBoxRosterList;
