import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import { positionChipClasses, positionChipKey } from '@/components/roster/positionChip';
import type { NHLGame } from '@/services/ScheduleService';
import { ROW_META, ROW_MICRO } from '@/components/phoneRowScale';
import {
  ACTION_GLYPH,
  FA_CHIP,
  FA_GAME,
  FA_NAME,
  FA_NO_GAME,
  FA_PROJ,
  FA_RANK,
  FA_ROW,
  FA_SUB,
  nextGameLine,
  statusChipFor,
  waiverClearsLabel,
  type FreeAgentAction,
} from './freeAgentRowKit';

/**
 * The minimum a Free Agents list knows about a player that is enough to
 * draw a row. Structural on purpose, the same trick `MugPlayer` uses:
 * `Player` (the directory shape every list on this page carries) satisfies
 * it without a mapping step, and a test can build one in four lines.
 */
export interface FreeAgentRowPlayer {
  id: string;
  full_name: string;
  position: string;
  team: string;
  headshot_url?: string | null;
  status?: string | null;
  is_on_waivers?: boolean;
  waiver_clears_at?: string | null;
}

export interface FreeAgentRowProps {
  /** 1-based position in the list. Printed, because a pool is a ranking. */
  rank: number;
  player: FreeAgentRowPlayer;
  /**
   * The league-scored projection for the rest of the week — the row's
   * headline number. The caller computes it through the page's own
   * `ScoringCalculator`/projection path; the row does not score anything
   * itself, because a second scoring path is a second set of numbers.
   */
  projection: number;
  /** This player's team's games for the week, as the page already fetched them. */
  games?: readonly NHLGame[];
  /** Today in MST ("YYYY-MM-DD") — the page's `getTodayMST()`. */
  todayStr: string;
  action: FreeAgentAction;
  /**
   * Percentage of leagues rostering this player. Takes the slot under the
   * projection when the page has it. It does not today — there is no
   * league-wide rostered-% read anywhere in the app — so callers pass
   * `subLabel` instead and this becomes live the day that read lands.
   */
  rosteredPct?: number | null;
  /** Fallback for the sub-slot: "3 games", "1,204 adds". */
  subLabel?: string;
  /** This row's add is in flight. */
  pending?: boolean;
  /** Some other row's add is in flight — the page allows one at a time. */
  disabled?: boolean;
  /** Tap anywhere that is not the button: open the player card. */
  onOpen: () => void;
  /** Tap the button: add, claim, or open the drop picker. */
  onAction: () => void;
}

/**
 * ONE FREE-AGENT ROW (2026-09-02).
 *
 * Every phone list on Free Agents draws this: Trending, Top Projected, and
 * the filtered/search list that "See All" opens. Before it, those three
 * were three different layouts — two thin custom flex rows and a 600px
 * table that scrolled sideways — and none of them showed the projection,
 * the game, or what the button was actually going to do.
 *
 * Reading order, left to right, is the order a manager decides in:
 * where he ranks → who he is → what he plays → who he plays tonight →
 * what he is worth → the tap that gets him.
 *
 * The whole row (bar the button) opens the player card, so the tap target
 * is 393x64 rather than the width of a name.
 */
export function FreeAgentRow({
  rank,
  player,
  projection,
  games,
  todayStr,
  action,
  rosteredPct,
  subLabel,
  pending = false,
  disabled = false,
  onOpen,
  onAction,
}: FreeAgentRowProps) {
  const game = nextGameLine(games, player.team, todayStr);
  const status = statusChipFor(player.status);
  const posKey = positionChipKey(player.position);
  const clears = action === 'claim' ? waiverClearsLabel(player.waiver_clears_at) : null;

  const actionLabel =
    action === 'claim'
      ? `Claim ${player.full_name}${clears ? `, ${clears}` : ''}`
      : action === 'swap'
        ? `Add ${player.full_name} with a drop`
        : `Add ${player.full_name}`;

  return (
    <div className={FA_ROW} data-testid="free-agent-row" data-action={action}>
      <span className={FA_RANK} data-testid="fa-rank">
        {rank}
      </span>

      {/* Name, position, team and tonight's game all open the card. A
          <button> would swallow the truncation and nest interactive
          elements; role+key handler is the pattern the page's other rows
          already use. */}
      <div
        data-testid="fa-open"
        className="flex flex-1 min-w-0 items-center gap-2.5 cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label={`Open ${player.full_name}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <Mug p={mugFromDirectory(player)} size="md" crest />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={FA_NAME}>{player.full_name}</span>
            {status && (
              <span
                data-testid="fa-status-chip"
                /* 8px -> the scale's MICRO rung (2026-09-02). This module's
                   own note above says a saturated chip at 8px next to a 15px
                   name reads as a smudge; the tint fixed the weight, 10px
                   fixes the size. */
                className={cn(
                  ROW_MICRO,
                  'leading-none font-bold px-1 py-px rounded-sm whitespace-nowrap flex-shrink-0',
                  status.cls,
                )}
              >
                {status.label}
              </span>
            )}
          </div>

          <div className={cn(ROW_META, 'flex items-center gap-1.5 mt-1 overflow-hidden')}>
            {/* The roster's own position palette, shrunk to fit a second
                line. `cn` is tailwind-merge, so the geometry classes here
                replace the chip's 32px box while every colour and ring in
                positionChip.ts survives untouched — one palette, two
                sizes, and no second map to drift. */}
            <span
              data-testid="fa-position-chip"
              className={cn(
                positionChipClasses(posKey),
                'w-auto h-[18px] min-w-[26px] px-1.5 rounded text-[10px]',
              )}
            >
              {posKey}
            </span>
            <span className="text-white/55 font-semibold shrink-0">{player.team}</span>
            {game ? (
              <>
                <span className="text-white/25 shrink-0" aria-hidden="true">
                  ·
                </span>
                <span className={cn(FA_GAME, 'shrink-0')} data-testid="fa-game-line">
                  {game.opponent}
                </span>
                {game.time && (
                  <span className="text-white/55 truncate" data-testid="fa-game-time">
                    {game.time}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-white/25 shrink-0" aria-hidden="true">
                  ·
                </span>
                <span className={cn(FA_NO_GAME, 'shrink-0')} data-testid="fa-no-game">
                  No game
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* The number the decision turns on. */}
      <div className="flex flex-col items-end shrink-0 text-right">
        <span className={FA_PROJ} data-testid="fa-projection">
          {projection.toFixed(1)}
        </span>
        {rosteredPct != null ? (
          <span className={FA_SUB} data-testid="fa-sub">
            {Math.round(rosteredPct)}% ros
          </span>
        ) : subLabel ? (
          <span className={FA_SUB} data-testid="fa-sub">
            {subLabel}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        data-testid="fa-action"
        aria-label={actionLabel}
        title={actionLabel}
        disabled={disabled || pending}
        onClick={onAction}
        className={cn(
          FA_CHIP,
          'flex flex-col items-center justify-center min-w-[44px] h-11 rounded-xl font-bold leading-none',
          'transition-transform active:scale-95 disabled:opacity-50',
          // Tinted, not solid. Measured at 393x852: ten solid orange pills
          // down the right edge out-shouted the projection column, which is
          // the number the row exists to show. The affordance still reads —
          // it is the only ringed, coloured control on the row — and the
          // hierarchy goes back to number first, action second.
          action === 'claim'
            ? 'bg-pastel-sage/15 ring-1 ring-pastel-sage/45 text-pastel-sage-soft px-2'
            : action === 'swap'
              ? 'bg-white/5 ring-1 ring-white/20 text-pastel-cream'
              : 'bg-pastel-orange/15 ring-1 ring-pastel-orange/50 text-pastel-orange-soft',
        )}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <>
            <span className="text-[17px] leading-none" aria-hidden="true">
              {ACTION_GLYPH[action]}
            </span>
            {clears && (
              <span className="font-jbmono text-[8px] mt-0.5 leading-none whitespace-nowrap">
                {clears}
              </span>
            )}
          </>
        )}
      </button>
    </div>
  );
}

export default FreeAgentRow;
