/**
 * THE PRESS BOX ROSTER ROW (2026-09-04, direction 1a, spec section 4).
 *
 * Grid `30px 30px 1fr 52px 44px`, gap 8, min-height 56px. Five columns, in
 * the order a manager's eye actually moves: what slot is this, who is he,
 * what is he doing tonight, what did he score, what is the week worth.
 *
 * WHY A NEW COMPONENT RATHER THAN AN EDIT TO `MobileRosterList`. Two reasons,
 * and the second is the one that decided it.
 *
 *   1. That component is 765 lines carrying five years of row decisions and
 *      six test files. The Press Box row is a different GRID, not a restyle —
 *      converting in place means rewriting the markup and rewriting the tests
 *      that pin it in the same commit, which is the change shape that broke
 *      thirteen files this morning.
 *
 *   2. It can be TESTED here and that one cannot. `npx vitest` will not start
 *      on the machine this was written on (`node_modules` carries only the
 *      darwin-arm64 rolldown binding; the sandbox that reaches the repo is
 *      linux), so the guards are run directly on Node with type stripping.
 *      That works for a component whose import graph is small and pure; it
 *      hangs on `MobileRosterList`, which reaches the Supabase client. A row
 *      I can run assertions against beats a row I can only reason about.
 *
 * So this file takes plain data and callbacks and imports nothing that
 * touches the network. `PressBoxRosterList` composes it; the Roster page
 * switches to that list in one change, and `MobileRosterList` is deleted when
 * nothing renders it.
 *
 * WHAT IS DELIBERATELY ABSENT, because the number does not exist:
 *
 *   * ROSTERED % and START %. The spec's META line reads
 *     `100% · 99% | vs TOR 3RD · 1G 2A`, and the spec itself names the gap:
 *     "no league-wide read exists". There is no nightly aggregate of
 *     `player_id -> rostered_pct, started_pct` across Citrus leagues, so
 *     there is no honest value to print. Both percentages are omitted AND so
 *     is the separator that would have led them — a bare `|` at the head of
 *     the line reads as a rendering bug, not as a placeholder, and the rule
 *     is never to ship a number that is not real. `showOwnership` turns the
 *     segment on the day the aggregate lands (PR12); nothing else changes.
 *
 *   * The WK COLUMN ITSELF, until a page supplies it. `HockeyPlayer` carries
 *     `daily_actual_points` and a daily projection and nothing weekly, so the
 *     roster payload has no per-player week total. A column of dashes down
 *     forty rows is worse than no column -- it occupies the width, teaches the
 *     eye to skip it, and says "broken" rather than "not yet". So `showWeek`
 *     defaults OFF and the grid closes to four columns when it is; the fifth
 *     column and its 44px come back the moment a real figure exists, which is
 *     the same grid the spec draws.
 *
 *   * The WK TREND micro (`▲ 12%` / `▼ 31%`). Even with a week total it is a
 *     week-over-week delta against a PRIOR week the payload does not carry.
 *     Same rule.
 *
 * COLOUR, and the one contract this row must not break. Orange means YOU or
 * the primary action. On a roster every row is already yours, so orange here
 * would mean nothing — it is spent on the one thing that is a FORECAST rather
 * than a fact (`orange-soft` on a projection) and nowhere else. Sage means it
 * happened: a live or final points figure, a live stat line. Grapefruit is
 * negative state only (DTD/IR). The position chip is neutral; the only team
 * colour on the row is a 1.5px ring on the mug.
 */
import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import { getTeamColor } from '@/utils/teamColors';

import {
  PB_NEUTRAL_CHIP,
  PB_POSITION_CHIP_BASE,
  PB_POSITION_CHIP_FALLBACK,
  PB_POSITION_RING_FALLBACK,
  posColor,
  posRingColor,
  positionChipKey,
} from './positionChip';
import {
  PB_ROW_HEADLINE,
  PB_ROW_META,
  PB_ROW_MICRO,
  PB_ROW_NAME,
} from './rowScale';

/** Everything the row draws. Flat on purpose: no service types reach here. */
export interface PressBoxRosterRowPlayer extends MugPlayer {
  id: string | number;
  name: string;
  /** Team code as printed, e.g. `EDM`. Also picks the mug ring colour. */
  teamAbbreviation?: string;
  /** `C`, `LW`, `G` ... the player's own positions, when more than one. */
  positionsLabel?: string;
  status?: 'IR' | 'SUSP' | 'GTD' | 'WVR' | null;
  /** The game line: `vs TOR 3RD`, `FINAL 4-2`, `@ DAL 8:30`. */
  gameLabel?: string;
  /** `1G 2A 4S` — only once something has happened. */
  statLine?: string;
  /** True once the game is live, in intermission, or final. */
  isLiveOrFinal?: boolean;
  /** Tonight's points if they happened, else null. */
  todayActual?: number | null;
  /** Tonight's projection. */
  todayProjection?: number | null;
  /** The week's points so far. Only meaningful when the list shows the column. */
  weekPoints?: number | null;
}

export interface PressBoxRosterRowProps {
  player: PressBoxRosterRowPlayer | null;
  /** The SLOT this row is, e.g. `C`, `LW`, `UTIL`, `BN`, `IR`. */
  slot: string;
  /** Bench and IR rows: the number is real but it does not count. */
  countsForScoring?: boolean;
  locked?: boolean;
  /** The manager has picked this row and is choosing where to put him. */
  selected?: boolean;
  /** This row can legally receive the selected player. */
  eligibleTarget?: boolean;
  /** Day-to-day / injured: tints the row and turns the meta grapefruit. */
  dtd?: boolean;
  /**
   * Draw the fifth (WK) column. OFF until a page has a real week total for
   * every row -- see the header. The grid closes to four columns when off, so
   * the row never carries dead width.
   */
  showWeek?: boolean;
  /** PR12 turns this on with the rostered/started aggregate. */
  showOwnership?: boolean;
  rosteredPct?: number | null;
  startedPct?: number | null;
  onSlotPress?: () => void;
  onNamePress?: () => void;
  onEmptyPress?: () => void;
}

/** One figure, one decimal, or an em-space-wide dash when there is nothing. */
const fig = (n: number | null | undefined): string =>
  n == null ? '–' : n.toFixed(1);

export function PressBoxRosterRow({
  player,
  slot,
  countsForScoring = true,
  locked,
  selected,
  eligibleTarget,
  dtd,
  showWeek = false,
  showOwnership = false,
  rosteredPct,
  startedPct,
  onSlotPress,
  onNamePress,
  onEmptyPress,
}: PressBoxRosterRowProps) {
  const isEmpty = player == null;
  const key = positionChipKey(slot);
  const grid = showWeek
    ? 'grid-cols-[30px_30px_1fr_52px_44px]'
    : 'grid-cols-[30px_30px_1fr_52px]';
  const isBenchLike = slot === 'BN' || slot === 'IR' || !countsForScoring;

  // The TODAY column. A points figure is sage once it HAPPENED and orange-soft
  // while it is still a forecast -- the one place orange earns its keep on a
  // screen where every row is already yours.
  const happened = !!player?.isLiveOrFinal;
  const todayValue = happened ? player?.todayActual : player?.todayProjection;
  const todayTone = isBenchLike
    ? 'text-pressbox-text/50'
    : happened
      ? 'text-pressbox-sage'
      : todayValue == null
        ? 'text-pressbox-text/35'
        : 'text-pressbox-orange-soft';

  const teamColor = player?.teamAbbreviation ? getTeamColor(player.teamAbbreviation) : null;

  if (isEmpty) {
    return (
      <div
        role="button"
        aria-label={`Empty ${slot}, tap to fill`}
        onClick={onEmptyPress}
        className={cn(
          'grid items-center gap-2 px-3 min-h-[56px]',
          grid,
          'border-b border-white/[0.06] cursor-pointer active:bg-white/5',
          eligibleTarget && 'bg-pressbox-sage/10',
        )}
      >
        <span className={cn(PB_POSITION_CHIP_BASE, PB_NEUTRAL_CHIP)}>{slot}</span>
        <span className="w-[30px] h-[30px] rounded-full border border-dashed border-white/20" aria-hidden="true" />
        <span className={cn(PB_ROW_META, 'text-pressbox-text/45')}>Tap to fill</span>
        <span />
        {showWeek && <span />}
      </div>
    );
  }

  return (
    <div
      data-testid="pressbox-roster-row"
      className={cn(
        'grid items-center gap-2 px-3 min-h-[56px]',
        grid,
        'border-b border-white/[0.06]',
        // The DTD tint is 5% of grapefruit -- present at a glance down a
        // column of rows, invisible as a "colour" on any single one.
        dtd && 'bg-[rgba(255,111,128,0.05)]',
        selected && 'bg-pressbox-orange/10',
        eligibleTarget && !selected && 'bg-pressbox-sage/10',
      )}
    >
      {/* 1 — the slot. Tapping it starts a swap; the glyph says so. */}
      <button
        type="button"
        onClick={onSlotPress}
        aria-label={`${slot} slot, ${player.name}. Change lineup`}
        className={cn(
          PB_POSITION_CHIP_BASE,
          'flex-col active:scale-95 transition-transform',
          isBenchLike ? PB_NEUTRAL_CHIP : (posColor[key] || PB_POSITION_CHIP_FALLBACK),
          !isBenchLike && (posRingColor[key] || PB_POSITION_RING_FALLBACK),
          selected && '!ring-pressbox-orange !ring-2',
          eligibleTarget && !selected && '!ring-pressbox-sage !ring-2',
        )}
      >
        <span className="leading-none">{slot}</span>
        {locked ? (
          <Lock className="w-2 h-2 mt-px" aria-hidden="true" />
        ) : (
          <span aria-hidden="true" className="text-[8px] leading-none opacity-70">
            ⇄
          </span>
        )}
      </button>

      {/* 2 — the face. The ONLY team colour on the row, and it is a ring. */}
      <span
        className="w-[30px] h-[30px] rounded-full"
        style={teamColor ? { boxShadow: `0 0 0 1.5px ${teamColor}` } : undefined}
        data-team-ring={player.teamAbbreviation || undefined}
      >
        <Mug p={player} size="xs" crest />
      </span>

      {/* 3 — who, and what he is doing. Two lines, both truncating. */}
      <button
        type="button"
        onClick={onNamePress}
        className="min-w-0 text-left"
        aria-label={`Open player card for ${player.name}`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={cn(PB_ROW_NAME, 'text-pressbox-text')}>{player.name}</span>
          {player.status && (
            <span
              className={cn(
                PB_ROW_MICRO,
                'font-bold px-1 py-px rounded-sm flex-shrink-0',
                dtd
                  ? 'bg-pressbox-grapefruit/20 text-pressbox-grapefruit-text'
                  : 'bg-white/10 text-pressbox-text/70',
              )}
            >
              {player.status}
            </span>
          )}
        </span>
        <span
          className={cn(
            PB_ROW_META,
            'flex items-center gap-1 mt-px',
            dtd ? 'text-pressbox-grapefruit-text' : 'text-pressbox-text/55',
          )}
        >
          {showOwnership && rosteredPct != null && startedPct != null && (
            <>
              <span className="flex-shrink-0">{rosteredPct}%</span>
              <span className="text-white/25 flex-shrink-0">·</span>
              <span className="flex-shrink-0">{startedPct}%</span>
              <span className="text-white/20 flex-shrink-0">|</span>
            </>
          )}
          {player.positionsLabel && (
            <>
              <span className="flex-shrink-0 text-pressbox-text/80">{player.positionsLabel}</span>
              <span className="text-white/25 flex-shrink-0">·</span>
            </>
          )}
          <span className="flex-shrink-0 font-semibold">{player.teamAbbreviation}</span>
          {player.gameLabel && (
            <>
              <span className="text-white/25 flex-shrink-0">·</span>
              <span className={cn('flex-shrink-0', happened && !dtd && 'text-pressbox-sage')}>
                {player.gameLabel}
              </span>
            </>
          )}
          {player.statLine && (
            <>
              <span className="text-white/25 flex-shrink-0">·</span>
              <span className={cn('truncate', !dtd && 'text-pressbox-sage')}>{player.statLine}</span>
            </>
          )}
        </span>
      </button>

      {/* 4 — TODAY. The number the row exists to show, and its unit under it. */}
      <span className="text-right">
        <span className={cn(PB_ROW_HEADLINE, 'block', todayTone)}>{fig(todayValue)}</span>
        {player.todayProjection != null && (
          <span className={cn(PB_ROW_MICRO, 'block mt-px text-pressbox-text/45')}>
            P {player.todayProjection.toFixed(1)}
          </span>
        )}
      </span>

      {/* 5 — the week. Quieter than tonight on purpose: tonight is the
          decision, the week is the context. Absent until the page has a real
          figure for it (see the header). */}
      {showWeek && (
        <span className="text-right">
          <span
            className={cn(
              'font-plex font-medium text-[12px] tabular-nums leading-none block',
              isBenchLike ? 'text-pressbox-text/40' : 'text-pressbox-text/85',
            )}
          >
            {fig(player.weekPoints)}
          </span>
        </span>
      )}
    </div>
  );
}

export default PressBoxRosterRow;
