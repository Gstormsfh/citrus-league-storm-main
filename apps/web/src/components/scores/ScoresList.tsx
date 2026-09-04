/**
 * The day's list of games, with one row expanded at a time.
 *
 * Single-expansion is deliberate: at 393x852 an expanded panel is roughly two
 * thirds of the viewport, so allowing several open at once turns the screen
 * into a scroll maze with no scoreboard left in it. theScore avoids the
 * problem by navigating away; we avoid it by only ever holding one open.
 *
 * The component takes the games already ordered by the page, so a refetch
 * cannot reorder rows out from under a thumb mid-scroll.
 */

import type { ScoreboardGame } from '@citrus/shared';
import { ScoreboardGameRow } from './ScoreboardGameRow';
import { GameDetailPanel } from './GameDetailPanel';

interface ScoresListProps {
  games: ScoreboardGame[];
  leagueId: string | null;
  expandedGameId: number | null;
  onToggle: (gameId: number) => void;
}

export function ScoresList({ games, leagueId, expandedGameId, onToggle }: ScoresListProps) {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3" data-testid="scores-list">
      {games.map((game) => (
        <ScoreboardGameRow
          key={game.gameId}
          game={game}
          expanded={expandedGameId === game.gameId}
          onToggle={onToggle}
          detail={
            expandedGameId === game.gameId ? (
              <GameDetailPanel gameId={game.gameId} leagueId={leagueId} venue={game.venue} />
            ) : null
          }
        />
      ))}
    </div>
  );
}

export default ScoresList;
