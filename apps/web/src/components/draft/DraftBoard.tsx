import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
// By file, never the `@/components/pressbox` barrel — it reaches LeagueContext
// and the Supabase client at module scope.
import { PB_TYPE } from '@/components/pressbox/rowScale';

/*
 * THE BOARD, PRESS BOX (2026-09-04) — artboard 4b.
 *
 * A 28px round rail and one 54px cell per pick, `#16241B` at 8px radius, the
 * name in Barlow 700 12px over `pos · team` in 8px mono. Three cells say
 * something the others do not:
 *
 *   * YOUR COLUMN is outlined — a 1px inset at 35% orange on every one of
 *     your cells, and `YOU` for the column head — so you can find your
 *     picks in a 12-wide grid without reading twelve names.
 *   * THE CELL ON THE CLOCK is solid orange with the pick number in it. On a
 *     board that is otherwise dark tiles and dashed outlines it is the one
 *     thing you cannot miss, which is the point.
 *   * A FUTURE PICK is a dashed outline with its number, `4.06`, so the
 *     board reads as a plan and not only as a record; yours are dashed in
 *     orange-soft.
 *
 * The grid scrolls sideways with the round rail pinned, four teams to a
 * phone width. Under it, LAST PICKS: the newest three, `round.pick` in mono,
 * the name in bold, `pos · team · who`. The artboard prints ADP and a
 * REACH / VALUE / EVEN verdict beside each; this codebase carries no ADP,
 * so that column is omitted rather than invented.
 *
 * `getPickNumber` (snake / linear) and the `n of N picks made` line are
 * unchanged — DraftBoard.totalRounds.test.tsx exists to hold the second.
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
  /** The NHL club, `EDM`. v1Adapters sets it; v1's own picks may not. */
  playerTeam?: string;
}

interface Team {
  id: string;
  name: string;
  owner: string;
  color: string;
  picks: DraftPick[];
}

interface DraftBoardProps {
  teams: Team[];
  draftHistory: DraftPick[];
  currentPick: number;
  currentRound: number;
  totalRounds?: number; // Optional prop for total rounds (defaults to 16 if not provided)
  onPlayerClick?: (playerId: string) => void; // Callback when player name is clicked
  draftType?: 'snake' | 'linear'; // Draft type — linear keeps same order every round
  /** The manager's own team: its column is outlined and headed `YOU`. */
  userTeamId?: string | null;
  /** How many of the newest picks LAST PICKS lists. 0 hides the section. */
  lastPicks?: number;
}

const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

export const DraftBoard = ({
  teams,
  draftHistory,
  currentPick,
  currentRound,
  totalRounds = 16,
  onPlayerClick,
  draftType = 'snake',
  userTeamId = null,
  lastPicks = 3,
}: DraftBoardProps) => {
  const totalPicks = teams.length * totalRounds;
  const isLinear = draftType === 'linear';

  // PERF: Memoize picks into a Map for O(1) lookups instead of O(n) Array.find per cell
  const picksMap = useMemo(() => {
    return new Map(draftHistory.map(p => [p.pick, p]));
  }, [draftHistory]);

  // Calculate pick number based on round and team index
  // Snake: reverse order on even rounds. Linear: same order every round.
  const getPickNumber = (round: number, teamIndex: number): number => {
    const isOddRound = round % 2 === 1;
    const actualTeamIndex = (isLinear || isOddRound) ? teamIndex : (teams.length - 1 - teamIndex);
    return (round - 1) * teams.length + actualTeamIndex + 1;
  };

  const getDraftPick = (round: number, teamIndex: number): DraftPick | null => {
    const pickNumber = getPickNumber(round, teamIndex);
    return picksMap.get(pickNumber) || null;
  };

  const isPendingPick = (round: number, teamIndex: number): boolean => {
    const pickNumber = getPickNumber(round, teamIndex);
    return pickNumber === currentPick;
  };

  /** `Draisaitl` from `Leon Draisaitl`; `J. Hughes` when two share a name is the caller's job. */
  const surname = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    return parts.length === 1 ? parts[0] : parts.slice(1).join(' ');
  };
  /** `BENCH` from `Bench Bosses`: the first word, uppercased, or `YOU`. */
  const columnHead = (team: Team) =>
    team.id === userTeamId ? 'YOU' : team.name.trim().split(/\s+/)[0].toUpperCase();
  const pickLabel = (round: number, pickNumber: number) =>
    `${round}.${String(((pickNumber - 1) % teams.length) + 1).padStart(2, '0')}`;

  const recent = useMemo(
    () => [...draftHistory].sort((a, b) => b.pick - a.pick).slice(0, lastPicks),
    [draftHistory, lastPicks],
  );
  const teamNameById = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  /* 42 = the artboard's 28px rail plus the 14px gutter, which the rail
     carries itself: the scroller has no padding of its own, because a
     padded scroll container scrolls its padding away and Chrome then pins
     a `sticky; left:0` rail 14px off the screen. */
  const columns = `42px repeat(${teams.length}, minmax(80px, 1fr))`;

  /* The board opens on the pick that is live. Four columns fit a phone and
     the clock may be in the eleventh; scrolling to it — the on-clock cell,
     centred — is what the artboard shows and what a manager is looking
     for. Re-runs as the pick moves. */
  const onClockRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const cell = onClockRef.current;
    const scroller = scrollerRef.current;
    if (!cell || !scroller) return;
    // The scroller's OWN scrollLeft, never `scrollIntoView`: that walks every
    // scrollable ancestor and dragged the whole page sideways, header and
    // tabs with it, the first time this ran.
    const target = cell.offsetLeft - scroller.clientWidth / 2 + cell.offsetWidth / 2;
    scroller.scrollLeft = Math.max(0, target);
  }, [currentPick]);

  return (
    <div className={cn(PB_TYPE)} data-testid="draft-board">
      <div className="flex items-center justify-between gap-2 px-3.5">
        <h2 className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text">
          Board
        </h2>
        <span className="font-plex font-medium text-[11px] text-pressbox-text/50 whitespace-nowrap">
          {draftHistory.length} of {totalPicks} picks made
        </span>
      </div>

      <div ref={scrollerRef} className="relative mt-2 overflow-x-auto scrollbar-hide ios-scroll">
        {/* `min-w-max`: a block-level grid is only as wide as the scroller
            (393) while its tracks overflow to 1060, and a sticky rail can
            never leave its containing block's box — so it stuck at the
            box's far edge, 56px off screen. The grid must be as wide as its
            tracks for `left:0` to mean the screen edge. */}
        <div className="grid gap-1 pr-3.5 min-w-max" style={{ gridTemplateColumns: columns }}>
          {/* Column heads. The round rail's corner is sticky too, so the
              heads never slide under a floating label. */}
          <div className="sticky left-0 z-sticky-base bg-pressbox-surface pl-3.5" />
          {teams.map((team) => (
            <div
              key={team.id}
              className={cn(
                'pb-1 text-center font-plex font-semibold text-[9px] truncate',
                team.id === userTeamId ? 'text-pressbox-orange-soft' : 'text-pressbox-text/50',
              )}
              title={`${team.name} · ${team.owner}`}
            >
              {columnHead(team)}
            </div>
          ))}

          {Array.from({ length: totalRounds }, (_, roundIndex) => {
            const round = roundIndex + 1;
            return (
              <div key={round} className="contents">
                <div className="sticky left-0 z-sticky-base flex items-center bg-pressbox-surface pl-3.5 font-plex font-semibold text-[9px] text-pressbox-text/40">
                  R{round}
                </div>
                {teams.map((team, teamIndex) => {
                  const pick = getDraftPick(round, teamIndex);
                  const isPending = isPendingPick(round, teamIndex);
                  const pickNumber = getPickNumber(round, teamIndex);
                  const mine = team.id === userTeamId;

                  if (isPending) {
                    return (
                      <div
                        key={`${round}-${team.id}`}
                        ref={onClockRef}
                        className="h-[54px] rounded-[8px] bg-pressbox-orange text-pressbox-orange-ink flex flex-col items-center justify-center px-[7px] py-1.5"
                        data-testid="draft-board-on-clock"
                      >
                        <span className="font-plex font-semibold text-[18px] leading-none tabular-nums">
                          {pickLabel(round, pickNumber)}
                        </span>
                        <span className="mt-[3px] font-plex font-semibold text-[8px] opacity-80">ON THE CLOCK</span>
                      </div>
                    );
                  }

                  if (pick) {
                    return (
                      <button
                        type="button"
                        key={`${round}-${team.id}`}
                        onClick={() => onPlayerClick?.(pick.playerId)}
                        aria-label={`${pick.playerName}, pick ${pickLabel(round, pickNumber)}`}
                        className={cn(
                          'h-[54px] rounded-[8px] bg-pressbox-tile px-[7px] py-1.5 text-left min-w-0 active:bg-pressbox-tile-high',
                          mine && 'shadow-[inset_0_0_0_1px_rgba(255,107,26,0.35)]',
                        )}
                      >
                        <span className="block font-barlow font-bold text-[12px] truncate text-pressbox-text">
                          {surname(pick.playerName)}
                        </span>
                        <span className="block mt-[3px] font-plex font-medium text-[8px] text-pressbox-text/50 truncate">
                          {normalizePosition(pick.position)}
                          {pick.playerTeam ? ` · ${pick.playerTeam}` : ''}
                        </span>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={`${round}-${team.id}`}
                      className={cn(
                        'h-[54px] rounded-[8px] border border-dashed px-[7px] py-1.5 font-plex font-medium text-[8px]',
                        mine
                          ? 'border-pressbox-orange-soft/40 text-pressbox-orange-soft'
                          : 'border-white/[0.12] text-pressbox-text/35',
                      )}
                    >
                      {pickLabel(round, pickNumber)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {teams.length > 4 && (
        <p className="mt-2 text-center font-plex font-medium text-[9px] text-pressbox-text/40">
          SWIPE FOR ALL {teams.length} TEAMS{onPlayerClick ? ' · TAP A PICK FOR THE CARD' : ''}
        </p>
      )}

      {lastPicks > 0 && recent.length > 0 && (
        <div className="mt-3.5 px-3.5">
          <h3 className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text">
            Last picks
          </h3>
          <div className="mt-1.5">
            {recent.map((pick, i) => (
              <div
                key={pick.id}
                className={cn(
                  'flex items-center gap-2.5 min-h-[44px] border-t border-white/[0.06] font-barlow text-[13px] text-pressbox-text',
                  i === recent.length - 1 && 'border-b',
                )}
                onClick={() => onPlayerClick?.(pick.playerId)}
              >
                <span className="w-[30px] flex-none font-plex font-semibold text-[10px] tabular-nums text-pressbox-text/50">
                  {pickLabel(pick.round, pick.pick)}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  <b>{surname(pick.playerName)}</b>{' '}
                  <span className="font-plex font-medium text-[10px] text-pressbox-text/50">
                    {normalizePosition(pick.position)}
                    {pick.playerTeam ? ` · ${pick.playerTeam}` : ''} · {teamNameById.get(pick.teamId) ?? pick.teamName}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
