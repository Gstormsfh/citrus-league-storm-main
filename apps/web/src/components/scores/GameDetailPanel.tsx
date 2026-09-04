/**
 * The expanded game panel.
 *
 * theScore and ESPN answer a tap by pushing to a game page with box score,
 * plays and lineups tabs. This panel is the deliberate divergence: Citrus
 * holds no play-by-play, no shot chart and no live box score, so that page
 * would be three empty tabs and a back button. Expanding in place keeps the
 * day's context and shows only what we actually have, which is the full
 * projected field for the game plus real stat lines once they exist.
 *
 * Grouped by club, skaters and goalies together, ordered the way the row is
 * ordered: your players, then the league's, then the best projections.
 *
 * WHAT THIS PANEL WILL NOT DO
 *   · It will not print a zero for a player with no stat row. Actuals live in
 *     `player_game_stats`, which holds seasons 2017 through 2025 and has no
 *     2026 row, so for every game the app can currently show it says plainly
 *     that actuals arrive when the game does.
 *   · It will not show a venue for a game that has none. `venue` is NULL on
 *     all 1,344 season-2026 rows, so the element is omitted rather than
 *     rendered blank.
 */

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { ScoresGameDetailResponse, ScoresPlayerLine } from '@citrus/shared';
import { TeamChip } from '@/components/citrus2/TeamChip';
import { scoresApi } from '@/api/scores';
import { formatPoints, formatToi, hasUnconfirmedGoalieDuel } from './scoresFormat';

function ConfidenceDot({ label }: { label: string | null }) {
  const key = (label ?? '').trim().toLowerCase();
  const tone =
    key === 'high'
      ? 'bg-pastel-sage'
      : key === 'medium'
        ? 'bg-pastel-butter'
        : key === 'low'
          ? 'bg-pastel-orange-soft'
          : 'bg-pastel-forest-dim';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('w-1.5 h-1.5 rounded-full', tone)} aria-hidden="true" />
      <span className="font-jbmono text-[9px] text-pastel-sage/70">{label ?? 'no grade'}</span>
    </span>
  );
}

function PlayerRow({ player }: { player: ScoresPlayerLine }) {
  const a = player.actuals;
  return (
    <div
      data-testid="scores-detail-player"
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-lg',
        player.roster?.isMine ? 'bg-pastel-orange/12' : 'odd:bg-white/[0.02]',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-display text-[11px] text-pastel-cream truncate">{player.name}</span>
          {player.position ? (
            <span className="font-jbmono text-[8px] text-pastel-sage/60 flex-shrink-0">
              {player.position}
            </span>
          ) : null}
          {player.roster ? (
            <span
              className={cn(
                'font-jbmono text-[8px] px-1 py-px rounded flex-shrink-0 truncate max-w-[86px]',
                player.roster.isMine
                  ? 'bg-pastel-orange/25 text-pastel-orange-soft'
                  : 'bg-white/5 text-pastel-sage/70',
              )}
            >
              {player.roster.isMine ? 'Your team' : (player.roster.teamName ?? 'Rostered')}
            </span>
          ) : null}
        </div>
        {a ? (
          <div className="font-jbmono text-[9px] text-pastel-sage/70 mt-0.5 tabular-nums">
            {player.isGoalie
              ? `${a.saves ?? 0} SV, ${a.goalsAgainst ?? 0} GA, ${formatToi(a.toiSeconds)} TOI`
              : `${a.goals}G ${a.assists}A ${a.shotsOnGoal}SOG ${a.blocks}BLK, ${formatToi(a.toiSeconds)} TOI`}
          </div>
        ) : (
          <div className="mt-0.5">
            <ConfidenceDot label={player.confidenceLabel} />
          </div>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        {player.actualPoints !== null ? (
          <>
            <div className="font-jbmono text-sm font-bold text-pastel-cream tabular-nums leading-none">
              {formatPoints(player.actualPoints)}
            </div>
            <div className="font-jbmono text-[8px] text-pastel-sage/60 tabular-nums mt-0.5">
              proj {formatPoints(player.projectedPoints)}
            </div>
          </>
        ) : (
          <>
            <div className="font-jbmono text-sm font-bold text-pastel-cream tabular-nums leading-none">
              {formatPoints(player.projectedPoints)}
            </div>
            <div className="font-jbmono text-[8px] text-pastel-sage/50 mt-0.5">proj</div>
          </>
        )}
      </div>
    </div>
  );
}

interface GameDetailPanelProps {
  gameId: number;
  leagueId: string | null;
  /** Set on every 2026 row, so the venue block is normally absent. */
  venue: string | null;
  /** How many players to show before the "and N more" line. */
  visibleLimit?: number;
}

export function GameDetailPanel({
  gameId,
  leagueId,
  venue,
  visibleLimit = 12,
}: GameDetailPanelProps) {
  const { data, isLoading, isError, error } = useQuery<ScoresGameDetailResponse>({
    queryKey: ['scores', 'game', gameId, leagueId],
    queryFn: () => scoresApi.getGame(gameId, { leagueId }),
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="px-3 py-4" data-testid="scores-detail-loading">
        <div className="h-3 w-24 rounded bg-pastel-surface-high animate-pulse mb-2" />
        <div className="h-3 w-full rounded bg-pastel-surface-high animate-pulse mb-1.5" />
        <div className="h-3 w-5/6 rounded bg-pastel-surface-high animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="px-3 py-4 font-display text-[11px] text-pastel-orange-soft">
        This game's detail did not load. {(error as Error | undefined)?.message ?? 'Try again.'}
      </p>
    );
  }

  const players = data.players;
  const shown = players.slice(0, visibleLimit);
  const remaining = players.length - shown.length;
  const anyActuals = players.some((p) => p.actualPoints !== null);

  return (
    <div className="px-2 py-2.5" data-testid="scores-detail">
      <div className="flex items-center justify-between px-1 mb-1.5">
        <span className="font-jbmono text-[8px] tracking-[0.2em] uppercase text-pastel-orange-soft">
          {anyActuals ? 'Actual vs projected' : 'Citrus projected field'}
        </span>
        <span className="font-jbmono text-[9px] text-pastel-sage/60">
          {players.length} projected
        </span>
      </div>

      {/* Venue only when it exists. NULL on every 2026 row, so normally absent. */}
      {venue ? (
        <p className="px-1 font-display text-[10px] text-pastel-forest-dim mb-1.5">{venue}</p>
      ) : null}

      {players.length === 0 ? (
        <p className="px-1 py-2 font-display text-[11px] text-pastel-cream/70">
          No Citrus projections exist for this game.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            {shown.map((p) => (
              <PlayerRow key={p.playerId} player={p} />
            ))}
          </div>
          {remaining > 0 ? (
            <p className="px-1 pt-1.5 font-jbmono text-[9px] text-pastel-sage/50">
              and {remaining} more projected in this game
            </p>
          ) : null}
        </>
      )}

      {!anyActuals && players.length > 0 ? (
        <p className="px-1 pt-2 font-display text-[10px] text-pastel-forest-dim leading-snug">
          Actual stat lines appear here once the game is played.
        </p>
      ) : null}

      {hasUnconfirmedGoalieDuel(players) ? (
        <p className="px-1 pt-1 font-display text-[10px] text-pastel-forest-dim leading-snug">
          Both goalies for a club are projected. Citrus does not have a confirmed starter.
        </p>
      ) : null}

      {leagueId && !data.league.rostersResolved ? (
        <p className="px-1 pt-1 font-display text-[10px] text-pastel-forest-dim leading-snug">
          Nobody from your league is in this game, so nothing is marked as yours.
        </p>
      ) : null}

      {data.truncated ? (
        <p className="px-1 pt-1 font-display text-[10px] text-pastel-orange-soft leading-snug">
          This list is incomplete: the projection read hit its row cap.
        </p>
      ) : null}
    </div>
  );
}

export default GameDetailPanel;
