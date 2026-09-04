import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
// By file, never the `@/components/pressbox` barrel — it reaches LeagueContext
// and the Supabase client at module scope, and the draft room owns its own.
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';

/**
 * PRESS BOX (2026-09-04): the HISTORY tab of the draft room.
 *
 * Artboard 4b prints the newest picks as `round.pick` in mono, the name in
 * bold, `pos · club · who` beneath — LAST PICKS on the board. This is the
 * same row, all of them, newest first, with the face beside the label so a
 * manager scanning back through a 200-pick draft recognises players
 * instead of reading them. One list at every width: the desktop table this
 * replaced carried the same six facts in six columns, and the room's rail
 * is 320px wide, where six columns never fit anyway.
 *
 * `round.pick` needs the round size (`teamCount`); without it the label
 * falls back to the overall `#pick`, which is what v1's room still passes.
 * The face comes through `mugFor` because a history pick carries no
 * headshot URL — the v1Adapters pick shape is pinned by tests and the room
 * already holds `playersById`, so the lookup happens where the data is.
 *
 * 2026-08-19 visual audit (kept for the record): this panel was on the
 * ORIGINAL light theme inside a #0F1F15 room. It has been dark since.
 */

interface DraftPick {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  position: string;
  round: number;
  pick: number;
  timestamp: number;
  playerTeam?: string; // Optional: player's NHL team
}

interface DraftHistoryProps {
  draftHistory: DraftPick[];
  onPlayerClick?: (playerId: string) => void;
  /** Round size, for the `2.04` label. Omitted → `#16`. */
  teamCount?: number;
  /** The manager's own team: its picks wear the board's orange inset. */
  userTeamId?: string | null;
  /** The face for a pick, looked up by the caller that holds the directory. */
  mugFor?: (playerId: string) => MugPlayer | null | undefined;
}

const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

export const DraftHistory = ({
  draftHistory,
  onPlayerClick,
  teamCount,
  userTeamId = null,
  mugFor,
}: DraftHistoryProps) => {
  // Newest first — the same order the old panel used.
  const sortedHistory = useMemo(
    () => [...draftHistory].sort((a, b) => b.pick - a.pick),
    [draftHistory],
  );

  const pickLabel = (pick: DraftPick) =>
    teamCount && teamCount > 0
      ? `${pick.round}.${String(((pick.pick - 1) % teamCount) + 1).padStart(2, '0')}`
      : `#${pick.pick}`;

  return (
    <section className={PB_TYPE} data-testid="draft-history">
      <div className="px-3.5 pt-3 pb-1.5">
        <PressBoxSectionHead
          title="History"
          count={draftHistory.length > 0 ? `${draftHistory.length} picks` : null}
        />
      </div>

      {draftHistory.length > 0 ? (
        <ol className="border-b border-white/[0.06]" aria-label="Draft history, newest first">
          {sortedHistory.map((pick) => {
            const mine = userTeamId !== null && pick.teamId === userTeamId;
            const mug = mugFor?.(pick.playerId) ?? {
              name: pick.playerName,
              team: pick.playerTeam ?? null,
            };
            const rowClass = cn(
              'w-full grid grid-cols-[34px_36px_1fr_auto] items-center gap-2.5 min-h-[54px] px-3.5 text-left',
              'border-t border-white/[0.06] text-pressbox-text',
              onPlayerClick && 'focus-citrus',
              mine && 'bg-pressbox-orange/[0.06] shadow-[inset_3px_0_0_theme(colors.pressbox.orange)]',
            );
            const cells = (
              <>
                <span className="font-plex font-semibold text-[10px] tabular-nums text-pressbox-text/50">
                  {pickLabel(pick)}
                </span>
                <Mug p={mug} size="sm" crest />
                <span className="min-w-0">
                  <span className="block truncate font-barlow font-bold text-[14px]">{pick.playerName}</span>
                  <span className="block truncate mt-0.5 font-plex font-medium text-[10px] text-pressbox-text/50">
                    {normalizePosition(pick.position)}
                    {pick.playerTeam ? ` · ${pick.playerTeam}` : ''}
                  </span>
                </span>
                <span
                  className={cn(
                    'max-w-[124px] truncate text-right font-plex font-medium text-[10px] uppercase tracking-[0.02em]',
                    mine ? 'text-pressbox-orange-soft' : 'text-pressbox-text/60',
                  )}
                >
                  {mine ? 'You' : pick.teamName}
                </span>
              </>
            );
            return (
              <li key={pick.id} data-testid="draft-history-row">
                {onPlayerClick ? (
                  <button type="button" className={rowClass} onClick={() => onPlayerClick(pick.playerId)}>
                    {cells}
                  </button>
                ) : (
                  <div className={rowClass}>{cells}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="px-3.5 py-10 text-center" data-testid="draft-history-empty">
          <div className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">
            No picks made yet
          </div>
          <div className="mt-1 font-plex font-medium text-[10px] text-pressbox-text/45">
            History fills in as picks are made
          </div>
        </div>
      )}
    </section>
  );
};
