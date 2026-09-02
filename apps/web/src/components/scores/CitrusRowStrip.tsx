/**
 * THE CITRUS FLARE — the strip under a collapsed game row.
 *
 * theScore and ESPN fill this exact space with a betting line. Citrus cannot:
 * `moneyline_home` and `implied_win_probability_home` are NULL on all 2,738
 * rows of `nhl_games` (audited 2026-09-02). So the space goes to the thing we
 * have and they do not, which is our own projection of who matters in this
 * game and how sure we are about it.
 *
 * The rules this component holds to:
 *
 *   · It renders nothing at all when there is no projection for the game.
 *     An empty strip saying "0 projected" would imply we looked at this game
 *     and found nobody worth naming, which is a different claim.
 *   · A player with no stat line shows a projection and no actual. Actuals
 *     only appear once `player_game_stats` has a row, which for every game
 *     the app can show today it does not.
 *   · When two goalies from the same club are in the list it says the starter
 *     is not confirmed, because `starter_confirmed` is false on every
 *     season-2026 projection row and ranking one above the other would be
 *     read as a start call we have not made.
 */

import { cn } from '@/lib/utils';
import type { ScoresGameCitrus, ScoresPlayerLine } from '@citrus/shared';
import { TeamChip } from '@/components/citrus2/TeamChip';
import { formatPoints, hasUnconfirmedGoalieDuel } from './scoresFormat';

/** Confidence label to a tone. Anything unrecognised gets the muted tone. */
function confidenceClass(label: string | null): string {
  switch ((label ?? '').trim().toLowerCase()) {
    case 'high':
      return 'text-pastel-sage';
    case 'medium':
      return 'text-pastel-butter';
    case 'low':
      return 'text-pastel-orange-soft';
    default:
      return 'text-pastel-forest-dim';
  }
}

function PlayerPill({ player }: { player: ScoresPlayerLine }) {
  const hasActual = player.actualPoints !== null;
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 min-w-0 flex-1 rounded-lg px-1.5 py-1',
        player.roster?.isMine ? 'bg-pastel-orange/15 ring-1 ring-pastel-orange/30' : 'bg-white/[0.03]',
      )}
    >
      {player.teamAbbrev ? <TeamChip abbrev={player.teamAbbrev} size="xs" /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="font-display text-[10px] text-pastel-cream truncate leading-tight">
            {player.name}
          </span>
          {player.position ? (
            <span className="font-jbmono text-[8px] text-pastel-sage/60 flex-shrink-0">
              {player.position}
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-1 leading-none mt-0.5">
          {hasActual ? (
            <>
              <span className="font-jbmono text-[11px] font-bold text-pastel-cream tabular-nums">
                {formatPoints(player.actualPoints)}
              </span>
              <span className="font-jbmono text-[8px] text-pastel-sage/60 tabular-nums">
                proj {formatPoints(player.projectedPoints)}
              </span>
            </>
          ) : (
            <>
              <span className="font-jbmono text-[11px] font-bold text-pastel-cream tabular-nums">
                {formatPoints(player.projectedPoints)}
              </span>
              <span
                className={cn('font-jbmono text-[8px]', confidenceClass(player.confidenceLabel))}
              >
                {player.confidenceLabel ?? 'no grade'}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CitrusRowStrip({ citrus }: { citrus: ScoresGameCitrus | null }) {
  // Nothing true to say, so say nothing.
  if (!citrus || citrus.players.length === 0) return null;

  const unconfirmedGoalies = hasUnconfirmedGoalieDuel(citrus.players);

  return (
    <div className="mt-2 pt-2 border-t border-pastel-sage/10">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="font-jbmono text-[8px] tracking-[0.2em] uppercase text-pastel-orange-soft">
          {citrus.hasActuals ? 'Citrus actual vs projected' : 'Citrus projections'}
        </span>
        {citrus.myCount !== null && citrus.myCount > 0 ? (
          <span className="font-jbmono text-[8px] px-1.5 py-0.5 rounded bg-pastel-orange/20 text-pastel-orange-soft">
            {citrus.myCount} yours
          </span>
        ) : null}
      </div>

      <div className="flex items-stretch gap-1">
        {citrus.players.map((p) => (
          <PlayerPill key={p.playerId} player={p} />
        ))}
      </div>

      {unconfirmedGoalies ? (
        <p className="font-display text-[9px] text-pastel-forest-dim mt-1.5 leading-tight">
          Two goalies projected for one club: the starter is not confirmed.
        </p>
      ) : null}
    </div>
  );
}

export default CitrusRowStrip;
