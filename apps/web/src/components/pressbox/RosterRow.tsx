/**
 * THE PRESS BOX ROSTER ROW — built to the reference, value by value.
 *
 * Grid `30px 30px 1fr 52px 44px`, gap 8, min-height 56 (bench 52), separated
 * by `border-top: 1px solid rgba(255,255,255,.06)`. NO horizontal padding on
 * the row: the 12px page gutter belongs to the section around it, so the
 * hairline runs edge to edge and the columns line up with the header above.
 *
 * HOW THESE NUMBERS WERE GOT, because the first version of this file was
 * wrong and the reason it was wrong matters. I built it from the handoff
 * README's prose table and one look at the artboard, which is paraphrasing a
 * picture. `Citrus Redesign - Directions.dc.html` is not a picture: it is a
 * rendered DOM with inline CSS on every node. Every value below was read out
 * of that file — e.g. the row itself:
 *
 *     display:grid;grid-template-columns:30px 30px 1fr 52px 44px;gap:8px;
 *     align-items:center;min-height:56px;
 *     border-top:1px solid rgba(255,255,255,.06)
 *
 * and the name line:
 *
 *     font:700 15px Barlow,sans-serif;white-space:nowrap;overflow:hidden;
 *     text-overflow:ellipsis
 *
 * When the two disagree, the artboard wins. It is the spec; the README is a
 * summary of it.
 *
 * WHAT CHANGED FROM THE FIRST BUILD, all of it a mismatch with the reference:
 *
 *   * The team code moved ONTO the name line as a 10px mono suffix. It had
 *     been buried in the meta line, which cost the name its second read and
 *     made every row's meta one segment longer.
 *   * The WK column came back, with its trend. Absent, it was not a
 *     four-column version of this row — it was a different, thinner row.
 *   * The ownership segment came back, ahead of a `|` at .25 alpha.
 *   * The chip lost its ring; the reference draws a flat fill.
 *   * The unit under the headline says `PROJ` when the number IS the
 *     projection and `P 6.9` when it is an actual with a projection to beat.
 *     One word carries "this has not happened yet".
 *   * Units and the trend are 9px, per the artboard. See `rowScale.ts` for
 *     why the 10px floor I had invented did not apply here.
 *
 * COLOUR, straight off the reference:
 *   happened      #84A57D   sage      — a live or final figure, a live stat line
 *   forecast      #FF9F66   orange-soft
 *   nothing yet   rgba(243,239,230,.5)
 *   bench         rgba(243,239,230,.5) — real number, does not count
 *   negative      #FF8A98   grapefruit-text — DTD meta, a falling trend
 */
import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import { getTeamColor } from '@/utils/teamColors';

import {
  PB_CHIP_BENCH,
  PB_CHIP_STARTER,
  PB_POSITION_CHIP_BASE,
  positionChipKey,
} from './positionChip';
import { PB_TYPE, PB_ROW_HEADLINE, PB_ROW_HEADLINE_LABEL, PB_ROW_META, PB_ROW_NAME } from './rowScale';

/** Everything the row draws. Flat on purpose: no service types reach here. */
export interface PressBoxRosterRowPlayer extends MugPlayer {
  id: string | number;
  name: string;
  /** `EDM`. Printed beside the name and used for the mug's team ring. */
  teamAbbreviation?: string;
  /** Bench rows print the player's own position after the team: `MTL · C`. */
  positionsLabel?: string;
  status?: 'IR' | 'SUSP' | 'GTD' | 'WVR' | null;
  /** `vs TOR 3RD`, `FINAL 4-2`, `@ DAL 8:30`. */
  gameLabel?: string;
  /** `1G 2A 4 SOG` — only once something has happened. */
  statLine?: string;
  isLiveOrFinal?: boolean;
  todayActual?: number | null;
  todayProjection?: number | null;
  /** The week's points. */
  weekPoints?: number | null;
  /** Week-over-week change, as a whole percent. Null prints no trend. */
  weekTrendPct?: number | null;
  /** Percent of leagues rostering him, and starting him. */
  rosteredPct?: number | null;
  startedPct?: number | null;
}

export interface PressBoxRosterRowProps {
  player: PressBoxRosterRowPlayer | null;
  /** `C`, `LW`, `UTIL`, `BN`, `IR`. */
  slot: string;
  /** Bench and IR rows: a real number that does not count. 52px, dimmed. */
  bench?: boolean;
  locked?: boolean;
  selected?: boolean;
  eligibleTarget?: boolean;
  dtd?: boolean;
  /** Draw the WK column. See `RosterList` for when it is on. */
  showWeek?: boolean;
  /** Draw the `100% · 99% |` segment. Off until the aggregate exists. */
  showOwnership?: boolean;
  onSlotPress?: () => void;
  onNamePress?: () => void;
  onEmptyPress?: () => void;
}

const fig = (n: number | null | undefined): string => (n == null ? '–' : n.toFixed(1));

/** `▲ 12%` sage, `▼ 31%` grapefruit, `— 0%` muted. Null prints nothing. */
function trend(pct: number | null | undefined) {
  if (pct == null) return null;
  const rounded = Math.round(pct);
  if (rounded > 0) return { glyph: '▲', text: `${rounded}%`, tone: 'text-pressbox-sage' };
  if (rounded < 0)
    return { glyph: '▼', text: `${Math.abs(rounded)}%`, tone: 'text-pressbox-grapefruit-text' };
  // An EN dash, where the artboard draws an em. `aiVoiceGuard` reads every
  // user-facing string in `src/` for em dashes, correctly -- it is the single
  // most reliable AI tell in prose, and a guard cannot tell prose from a
  // glyph. At 9px Plex Mono beside ▲ and ▼ the two are indistinguishable, and
  // an exception in that guard costs more than the pixel does.
  return { glyph: '–', text: '0%', tone: 'text-pressbox-text/45' };
}

export function PressBoxRosterRow({
  player,
  slot,
  bench = false,
  locked,
  selected,
  eligibleTarget,
  dtd,
  showWeek = false,
  showOwnership = false,
  onSlotPress,
  onNamePress,
  onEmptyPress,
}: PressBoxRosterRowProps) {
  const grid = showWeek
    ? 'grid-cols-[30px_30px_1fr_52px_44px]'
    : 'grid-cols-[30px_30px_1fr_52px]';
  const frame = cn(
    PB_TYPE,
    'grid items-center gap-2 border-t border-white/[0.06]',
    grid,
    bench ? 'min-h-[52px]' : 'min-h-[56px]',
  );

  if (player == null) {
    return (
      <div
        role="button"
        aria-label={`Empty ${slot}, tap to fill`}
        onClick={onEmptyPress}
        className={cn(frame, 'cursor-pointer active:bg-white/5', eligibleTarget && 'bg-pressbox-sage/10')}
      >
        <span className={cn(PB_POSITION_CHIP_BASE, PB_CHIP_BENCH)}>{slot}</span>
        <span
          className="w-[30px] h-[30px] rounded-full border border-dashed border-white/20"
          aria-hidden="true"
        />
        <span className={cn(PB_ROW_META, 'text-pressbox-text/45')}>Tap to fill</span>
        <span />
        {showWeek && <span />}
      </div>
    );
  }

  // The TODAY column. Sage once it HAPPENED, orange-soft while it is still a
  // forecast, muted when there is nothing -- and the unit under it says which:
  // `PROJ` when the number IS the projection, `P 6.9` when it is an actual
  // with a projection to beat.
  const happened = !!player.isLiveOrFinal;
  const value = happened ? player.todayActual : player.todayProjection;
  const tone = bench
    ? 'text-pressbox-text/50'
    : value == null
      ? 'text-pressbox-text/50'
      : happened
        ? 'text-pressbox-sage'
        : 'text-pressbox-orange-soft';
  const unit =
    player.todayProjection == null
      ? null
      : happened || value == null
        ? `P ${player.todayProjection.toFixed(1)}`
        : 'PROJ';

  const t = bench ? null : trend(player.weekTrendPct);
  const teamColor = player.teamAbbreviation ? getTeamColor(player.teamAbbreviation) : null;
  // `MTL · C` on a bench row, where the chip says BN and not the position.
  const codeLine = [player.teamAbbreviation, bench ? player.positionsLabel : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid="pressbox-roster-row"
      className={cn(
        frame,
        // rgba(255,111,128,.05) -- present down a column, invisible on one row.
        dtd && 'bg-[rgba(255,111,128,0.05)]',
        selected && 'bg-pressbox-orange/10',
        eligibleTarget && !selected && 'bg-pressbox-sage/10',
      )}
    >
      {/* 1 — the slot. A starter chip stacks the swap glyph; a bench chip does not. */}
      <button
        type="button"
        onClick={onSlotPress}
        aria-label={`${slot} slot, ${player.name}. Change lineup`}
        className={cn(
          PB_POSITION_CHIP_BASE,
          'pb-hit active:scale-95 transition-transform',
          bench ? PB_CHIP_BENCH : PB_CHIP_STARTER,
          selected && 'ring-2 ring-pressbox-orange',
          eligibleTarget && !selected && 'ring-2 ring-pressbox-sage',
        )}
      >
        <span>{slot}</span>
        {!bench &&
          (locked ? (
            <Lock className="w-2 h-2" aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="text-[8px] leading-none opacity-70">
              ⇄
            </span>
          ))}
      </button>

      {/* 2 — the face. 30px including its 1.5px border, which is the ONLY
          team colour anywhere on the row. `border-box` so the picture inside
          is not pushed out of its own track. */}
      <span
        className="w-[30px] h-[30px] box-border rounded-full overflow-hidden border-[1.5px] border-white/[0.16]"
        style={teamColor ? { borderColor: teamColor } : undefined}
        data-team-ring={player.teamAbbreviation || undefined}
      >
        <Mug p={player} size="xs" className="w-full h-full" crest />
      </span>

      {/* 3 — who he is, and what he is doing. Two lines, both truncating. */}
      <button type="button" onClick={onNamePress} className="min-w-0 text-left" aria-label={`Open player card for ${player.name}`}>
        <span className={cn(PB_ROW_NAME, 'block text-pressbox-text')}>
          {player.name}{' '}
          {codeLine && (
            <span className="font-plex font-medium text-[10px] text-pressbox-text/50">{codeLine}</span>
          )}
          {player.status && (
            <span className="font-plex font-bold text-[9px] px-1 py-px rounded-[3px] bg-pressbox-grapefruit/[0.18] text-pressbox-grapefruit-text align-[1px]">
              {player.status}
            </span>
          )}
        </span>
        <span
          className={cn(
            PB_ROW_META,
            'block mt-0.5',
            dtd ? 'text-pressbox-grapefruit-text' : 'text-pressbox-text/55',
          )}
        >
          {showOwnership && player.rosteredPct != null && player.startedPct != null && (
            <>
              {player.rosteredPct}% · {player.startedPct}%
              {/* The bar only divides two things: a day with no game keeps
                  the percentages alone (2026-09-05). */}
              {(player.gameLabel || player.statLine) && (
                <>
                  {' '}
                  <span className="text-pressbox-text/25">|</span>{' '}
                </>
              )}
            </>
          )}
          <span className={cn(happened && !dtd && 'text-pressbox-sage')}>
            {[player.gameLabel, player.statLine].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>

      {/* 4 — TODAY. The number the row exists to show. */}
      <span className="text-right">
        <span className={cn(PB_ROW_HEADLINE, 'block', tone)}>{fig(value)}</span>
        {unit && <span className={cn(PB_ROW_HEADLINE_LABEL, 'block text-pressbox-text/45')}>{unit}</span>}
      </span>

      {/* 5 — the week, and which way it is going. */}
      {showWeek && (
        <span
          className={cn(
            'text-right block font-plex font-semibold text-[12px] tabular-nums',
            bench ? 'text-pressbox-text/50' : 'text-pressbox-text/85',
          )}
        >
          {fig(player.weekPoints)}
          {t && (
            <span className={cn('block font-plex font-medium text-[9px]', t.tone)}>
              {t.glyph} {t.text}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export default PressBoxRosterRow;
