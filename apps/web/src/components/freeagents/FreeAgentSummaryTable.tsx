import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { playerEligiblePositionsLabel } from '@citrus/shared';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import type { Player } from '@/services/PlayerService';
import type { NHLGame } from '@/services/ScheduleService';
import { FreeAgentAddButton, type FreeAgentAddState } from './FreeAgentAddButton';

/**
 * THE TWO SUMMARY TABLES, ONE COMPONENT (2026-09-14).
 *
 * "Top Trending" and "Top Projected" sit side by side on desktop and were
 * two hand-written tables that had drifted: four columns against five, a
 * 40px add button against a 32px one, a header with a subtitle against one
 * without, so the rows never lined up across the gap. They now share this
 * component. Everything is identical except the ONE metric column each
 * card exists to show (adds this week, or the rest-of-week projection),
 * which the caller supplies as a header and a cell renderer.
 *
 * Column widths are fixed so the two tables align row for row: the player
 * cell takes the slack, the rest are pinned.
 *
 * WIDTH (2026-09-18, desktop QA). At the desktop width these cards get
 * (about 430px each, side by side between the two rails) the pinned
 * columns left the player cell 60px: every name truncated to one letter.
 * Position now rides on the player's second line ("NYR · LW") instead of
 * its own column, the schedule and metric columns are as narrow as their
 * content, and the metric cell never wraps.
 */
export interface FreeAgentSummaryMetric {
  header: string;
  /** Right-aligned like a number. */
  render: (player: Player & { games?: NHLGame[] }) => ReactNode;
}

export interface FreeAgentSummaryTableProps<P extends Player & { games?: NHLGame[] }> {
  players: readonly P[];
  metric: FreeAgentSummaryMetric;
  positionType: 'individual' | 'forward';
  isWatched: (player: P) => boolean;
  addState: (player: P) => FreeAgentAddState;
  /** The id of the player whose add is in flight, if any. Disables every button. */
  pendingPlayerId: number | null;
  onOpen: (player: P) => void;
  onToggleWatch: (player: P) => void;
  onAdd: (player: P) => void;
}

const numericId = (id: string | number) => (typeof id === 'string' ? parseInt(id, 10) : id);

/**
 * "A. Barkov" for the summary cards: the name cell is about 60px wide at
 * the desktop card width and a full name truncated to one letter there.
 * The full name stays in the title and on the tap-through.
 */
export function summaryShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/** This week's games as opponent chips, in date order. Shared by both cards. */
export function FreeAgentScheduleChips({ games, team }: { games?: NHLGame[] | null; team?: string | null }) {
  const sorted = (games ?? [])
    .filter((g) => g && g.game_date)
    .sort((a, b) => new Date(a.game_date.split('T')[0] + 'T00:00:00').getTime() - new Date(b.game_date.split('T')[0] + 'T00:00:00').getTime());
  if (sorted.length === 0) return <span className="text-xs text-white/55">-</span>;
  return (
    <div className="flex justify-center gap-1">
      {sorted.map((game, idx) => {
        const isHome = game.home_team === team;
        const opponent = isHome ? game.away_team : game.home_team;
        return (
          <div key={idx} className="flex items-center gap-0.5 bg-white/5 ring-1 ring-white/10 rounded px-1 py-0.5">
            <span className="text-[10px] text-white/55">{isHome ? 'vs' : '@'}</span>
            <img
              src={`https://assets.nhle.com/logos/nhl/svg/${opponent}_light.svg`}
              alt={opponent}
              loading="lazy"
              decoding="async"
              className="w-5 h-5"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function FreeAgentSummaryTable<P extends Player & { games?: NHLGame[] }>({
  players, metric, positionType, isWatched, addState, pendingPlayerId, onOpen, onToggleWatch, onAdd,
}: FreeAgentSummaryTableProps<P>) {
  return (
    <Table className="table-fixed [&_th]:px-1.5 [&_th]:py-2 [&_th]:text-xs [&_td]:px-1.5 [&_td]:py-1.5 [&_td]:tabular-nums" data-testid="fa-summary-table">
      <TableHeader>
        <TableRow>
          <TableHead>Player</TableHead>
          <TableHead className="w-[100px] text-center whitespace-nowrap">Schedule</TableHead>
          <TableHead className="w-[64px] text-right whitespace-nowrap">{metric.header}</TableHead>
          <TableHead className="w-[84px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.map((player) => {
          const watched = isWatched(player);
          return (
            <TableRow key={player.id} className="h-[52px]">
              <TableCell className="font-medium">
                <div className="flex items-center gap-2 min-w-0">
                  <Mug p={mugFromDirectory(player)} size="xs" />
                  <div className="flex flex-col min-w-0">
                    <span
                      className="hover:underline hover:text-pastel-orange cursor-pointer truncate text-[13px]"
                      title={player.full_name}
                      onClick={() => onOpen(player)}
                    >
                      {summaryShortName(player.full_name)}
                    </span>
                    <span className="text-xs text-white/55 whitespace-nowrap">
                      {player.team} · <span data-testid="fa-summary-pos">{playerEligiblePositionsLabel(player, positionType)}</span>
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-center"><FreeAgentScheduleChips games={player.games} team={player.team} /></TableCell>
              <TableCell className="text-right whitespace-nowrap">{metric.render(player)}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-8 w-8 ${watched ? 'text-yellow-500' : 'text-white/55'}`}
                    aria-label={watched ? `Remove ${player.full_name} from watch list` : `Add ${player.full_name} to watch list`}
                    aria-pressed={watched}
                    onClick={() => onToggleWatch(player)}
                  >
                    <Star className={`h-4 w-4 ${watched ? 'fill-current' : ''}`} />
                  </Button>
                  <FreeAgentAddButton
                    state={addState(player)}
                    playerName={player.full_name}
                    pending={pendingPlayerId === numericId(player.id)}
                    disabled={pendingPlayerId !== null}
                    onClick={() => onAdd(player)}
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
