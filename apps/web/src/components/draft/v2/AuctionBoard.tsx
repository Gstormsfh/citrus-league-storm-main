/**
 * THE AUCTION BOARD (2026-09-05). Reported from the first live auction:
 * "the board in auction needs to be different. Right now it shows as if
 * the person is drafting their nomination, but they aren't, so boards
 * fill at a different pace." The snake board is a pick matrix — R1 1.01
 * ON THE CLOCK — and a lot has no pick number a team was owed. Here each
 * team owns a column that fills from the top with the players it bought,
 * price under the name, and its budget in the column head; the slots it
 * still has to fill stay dashed. Nothing is "on the clock" on this board:
 * the lot lives in the panel above it.
 *
 * Presentational: rosters and prices come from the derived state the fold
 * writes (`RosterEntry.price`), budgets from the auction state.
 */
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import type { DerivedDraftState, RosterEntry } from '@/lib/draftClient/deriveDraftState';
import type { DerivedAuctionState } from '@/lib/draftClient/deriveAuctionState';
import type { FetchedTeam } from '@/lib/draftClient/v1Adapters';
import type { Player } from '@/services/PlayerService';

export interface AuctionBoardProps {
  teams: ReadonlyArray<FetchedTeam>;
  derived: DerivedDraftState;
  auction: DerivedAuctionState | null;
  playersById: ReadonlyMap<string, Player>;
  myTeamId: string | null;
  /** Roster slots each team fills — the engine's `totalPicks / teams`. */
  slotsPerTeam: number;
  onPlayerClick?: (playerId: string) => void;
}

const surname = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : fullName;
};

export function AuctionBoard({ teams, derived, auction, playersById, myTeamId, slotsPerTeam, onPlayerClick }: AuctionBoardProps) {
  // YOU first, then the room in its order — the column a manager looks for
  // is their own, and on a phone four columns fit.
  const ordered = useMemo(() => {
    if (!myTeamId) return [...teams];
    return [...teams.filter((t) => t.id === myTeamId), ...teams.filter((t) => t.id !== myTeamId)];
  }, [teams, myTeamId]);

  const rows = Math.max(slotsPerTeam, ...ordered.map((t) => derived.teamRosters.get(t.id)?.length ?? 0));
  const columns = `42px repeat(${ordered.length}, minmax(88px, 1fr))`;

  return (
    <div className={cn(PB_TYPE)} data-testid="auction-board">
      <div className="flex items-center justify-between gap-2 px-3.5">
        <h2 className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text">Board</h2>
        <span className="font-plex font-medium text-[11px] text-pressbox-text/50 whitespace-nowrap tabular-nums">
          {derived.picksMade} of {derived.totalPicks} sold
        </span>
      </div>

      <div className="relative mt-2 overflow-x-auto scrollbar-hide ios-scroll">
        <div className="grid gap-1 pr-3.5 min-w-max" style={{ gridTemplateColumns: columns }}>
          <div className="sticky left-0 z-sticky-base bg-pressbox-surface pl-3.5" />
          {ordered.map((team) => {
            const mine = team.id === myTeamId;
            const budget = auction?.budgets.get(team.id);
            return (
              <div key={team.id} className="pb-1 text-center min-w-0" title={team.team_name}>
                <div
                  className={cn(
                    'font-plex font-semibold text-[9px] truncate',
                    mine ? 'text-pressbox-orange-soft' : 'text-pressbox-text/50',
                  )}
                >
                  {mine ? 'YOU' : team.team_name.toUpperCase()}
                </div>
                <div className="font-plex font-semibold text-[11px] tabular-nums text-pressbox-text">
                  {budget ? `$${budget.remaining}` : '·'}
                </div>
              </div>
            );
          })}

          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="contents">
              <div className="sticky left-0 z-sticky-base flex items-center bg-pressbox-surface pl-3.5 font-plex font-semibold text-[9px] text-pressbox-text/40">
                {i + 1}
              </div>
              {ordered.map((team) => {
                const entry: RosterEntry | undefined = derived.teamRosters.get(team.id)?.[i];
                const mine = team.id === myTeamId;
                if (!entry) {
                  return (
                    <div
                      key={`${i}-${team.id}`}
                      className={cn(
                        'h-[54px] rounded-[8px] border border-dashed',
                        mine ? 'border-pressbox-orange-soft/40' : 'border-white/[0.12]',
                      )}
                    />
                  );
                }
                const player = playersById.get(String(entry.playerId));
                const name = player?.full_name ?? `#${entry.playerId}`;
                return (
                  <button
                    type="button"
                    key={`${i}-${team.id}`}
                    onClick={() => onPlayerClick?.(String(entry.playerId))}
                    aria-label={`${name}${entry.price != null ? `, $${entry.price}` : ''}`}
                    className={cn(
                      'h-[54px] rounded-[8px] bg-pressbox-tile px-[7px] py-1.5 text-left min-w-0 active:bg-pressbox-tile-high',
                      mine && 'shadow-[inset_0_0_0_1px_rgba(255,107,26,0.35)]',
                    )}
                  >
                    <span className="block font-barlow font-bold text-[12px] truncate text-pressbox-text">{surname(name)}</span>
                    <span className="mt-[3px] flex items-center justify-between gap-1 font-plex font-medium text-[8px] text-pressbox-text/50">
                      <span className="truncate">
                        {player?.position ?? ''}
                        {player?.team ? ` · ${player.team}` : ''}
                      </span>
                      {entry.price != null && (
                        <span className="flex-none font-semibold text-[10px] tabular-nums text-pressbox-orange-soft">${entry.price}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {ordered.length > 4 && (
        <p className="mt-2 text-center font-plex font-medium text-[9px] text-pressbox-text/40">Swipe for the other teams</p>
      )}
    </div>
  );
}

export default AuctionBoard;
