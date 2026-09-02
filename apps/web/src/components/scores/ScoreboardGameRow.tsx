/**
 * One game row.
 *
 * The layout is lifted from theScore, ESPN and the CBS Sports NHL scoreboard,
 * which all agree on the same four things, and all four are here:
 *
 *   1. AWAY ON TOP, HOME BELOW. CBS renders "visiting team first, then home
 *      team". It is the order the matchup is spoken in: Florida at Carolina.
 *   2. TWO TEAM LINES, each a team mark plus a name, with the score
 *      right-aligned in the largest type in the row. The score is why the
 *      screen was opened, so nothing may out-weigh it.
 *   3. ONE STATUS COLUMN on the right doing triple duty: start time when
 *      scheduled, clock and period when live, Final or Final/OT when over.
 *      That vocabulary is `gameStateLabel` in @citrus/shared, so the wording
 *      cannot drift from what the server believes.
 *   4. LIVE STAYS INLINE, marked with colour and a pulse instead of being
 *      hoisted into its own section, so rows do not move under the thumb as
 *      games start and end.
 *
 * The deliberate divergence: tapping expands IN PLACE instead of navigating
 * to a game page. theScore and ESPN push to a page with box score, plays and
 * lineups tabs. Citrus holds no play-by-play and no live box score, so that
 * page would be mostly empty. An accordion keeps the day's context, costs no
 * navigation, and is honest about how much detail we have.
 *
 * SCORES ARE NULLABLE ON PURPOSE. `nhl_games` stores 0/0 on scheduled rows;
 * the server nulls them, and this component renders the start time in that
 * space rather than a 0-0 nobody played.
 */

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScoreboardGame, ScoreboardTeam } from '@citrus/shared';
import { TeamChip } from '@/components/citrus2/TeamChip';
import { LivePulse } from '@/components/citrus2/LivePulse';
import {
  citrusSummaryText,
  leadingSide,
  rowStatusText,
  showsLivePulse,
  statusTone,
  teamDisplayName,
  teamFullName,
} from './scoresFormat';
import { CitrusRowStrip } from './CitrusRowStrip';

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  live: 'text-pastel-sage',
  urgent: 'text-pastel-orange',
  final: 'text-pastel-cream/60',
  scheduled: 'text-pastel-cream/80',
  muted: 'text-pastel-forest-dim',
};

function TeamLine({
  team,
  score,
  emphasised,
  dimmed,
}: {
  team: ScoreboardTeam;
  score: number | null;
  emphasised: boolean;
  dimmed: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <TeamChip abbrev={team.abbrev} size="sm" />
      <span
        className={cn(
          'font-display text-sm truncate flex-1 min-w-0',
          emphasised ? 'text-pastel-cream font-semibold' : dimmed ? 'text-pastel-cream/55' : 'text-pastel-cream/85',
        )}
        title={teamFullName(team)}
      >
        {teamDisplayName(team)}
      </span>
      {score !== null ? (
        <span
          className={cn(
            'font-varsity text-xl tabular-nums leading-none w-8 text-right',
            emphasised ? 'text-pastel-cream' : dimmed ? 'text-pastel-cream/55' : 'text-pastel-cream/85',
          )}
        >
          {score}
        </span>
      ) : null}
    </div>
  );
}

interface ScoreboardGameRowProps {
  game: ScoreboardGame;
  expanded: boolean;
  onToggle: (gameId: number) => void;
  /** Rendered under the row when expanded. Supplied by the page. */
  detail?: React.ReactNode;
}

export function ScoreboardGameRow({ game, expanded, onToggle, detail }: ScoreboardGameRowProps) {
  const tone = statusTone(game);
  const leader = leadingSide(game);
  const status = rowStatusText(game);
  const summary = citrusSummaryText(game);
  const hasScores = game.homeScore !== null && game.awayScore !== null;

  return (
    <div
      data-testid="scores-game-row"
      data-game-id={game.gameId}
      data-state={game.state}
      className={cn(
        'rounded-2xl bg-pastel-surface-tile overflow-hidden',
        game.state === 'live' && 'ring-1 ring-pastel-sage/30',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(game.gameId)}
        aria-expanded={expanded}
        aria-label={`${teamFullName(game.away)} at ${teamFullName(game.home)}, ${status}`}
        className="w-full text-left px-3 py-2.5 touch-manipulation active:bg-pastel-surface-high transition-colors"
      >
        <div className="flex items-stretch gap-2">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <TeamLine
              team={game.away}
              score={game.awayScore}
              emphasised={leader === 'away'}
              dimmed={hasScores && leader === 'home'}
            />
            <TeamLine
              team={game.home}
              score={game.homeScore}
              emphasised={leader === 'home'}
              dimmed={hasScores && leader === 'away'}
            />
          </div>

          <div className="w-[74px] flex-shrink-0 flex flex-col items-end justify-center gap-1 border-l border-pastel-sage/10 pl-2">
            <div className="flex items-center gap-1">
              {showsLivePulse(game) ? <LivePulse tone="sage" size="xs" /> : null}
              <span
                className={cn(
                  'font-jbmono text-[10px] tabular-nums text-right leading-tight',
                  TONE_CLASS[tone],
                )}
              >
                {status}
              </span>
            </div>
            {game.state === 'unknown' && game.statusRaw ? (
              <span className="font-jbmono text-[8px] text-pastel-forest-dim">
                {game.statusRaw}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-pastel-sage/50 transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </div>
        </div>

        {summary ? (
          <p className="font-display text-[10px] text-pastel-sage/70 mt-1.5 leading-tight">
            {summary}
          </p>
        ) : null}

        {!expanded ? <CitrusRowStrip citrus={game.citrus} /> : null}
      </button>

      {expanded ? <div className="border-t border-pastel-sage/10">{detail}</div> : null}
    </div>
  );
}

export default ScoreboardGameRow;
