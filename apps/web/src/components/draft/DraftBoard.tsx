import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
// By file, never the `@/components/pressbox` barrel — it reaches LeagueContext
// and the Supabase client at module scope.
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { positionChipKey } from '@/components/roster/positionChip';
import { Mug } from '@/components/roster/Mug';
import type { PositionType } from '@/utils/rosterUtils';

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
 * phone width.
 *
 * DESKTOP (2026-09-10). At `lg` and up the same grid stops forcing its
 * max-content width and lets every team share the row instead: `min-w-max`
 * is dropped and the tracks fall to `minmax(56px, 1fr)`. A 14-team league in
 * the room's main column lands near 65px per cell, which holds a surname at
 * the current 12px type. Reading the whole board at once is the entire point
 * of a board, and four columns of it was a phone layout being stretched.
 *
 * The scroller itself is UNCHANGED at every width. `overflow-x` stays `auto`
 * rather than becoming `visible` on desktop, for two reasons: a league wide
 * enough to defeat the 56px floor still scrolls instead of overflowing its
 * container, and `overflow-x` on this element decides whether it is a scroll
 * container at all, which is what every `position: sticky` inside it resolves
 * against (see `__tests__/stickyScrollContainerGuard.test.ts`). Nothing about
 * the round rail's pinning changes.
 *
 * Under it, LAST PICKS: the newest three, `round.pick` in mono,
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
  /** The NHL headshot; the desktop card draws it as the face (2026-09-14). */
  headshotUrl?: string | null;
}

interface Team {
  id: string;
  name: string;
  owner: string;
  color: string;
  picks: DraftPick[];
}

interface DraftBoardProps {
  /** The league's position format: an F/D/G board prints F under a forward. */
  positionType?: PositionType;
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
  /**
   * KEEPERS (2026-09-05): `${teamId}:${round}` → kept player's name for the
   * slots spoken for before their picks land. Drawn as a KEEPER cell.
   */
  keeperSlots?: ReadonlyMap<string, string>;
  /**
   * THE BOARD AS A WINDOW (2026-09-14, Garrett, desktop only): show this
   * many rounds and scroll the rest inside the board, so the pool can sit
   * directly beneath it. The column heads stay pinned; the window follows
   * the clock by the same rule as the horizontal centring (once on mount,
   * again on your own pick). Unset (the phone) renders every round in flow.
   */
  viewportRows?: number;
}

/**
 * THE LETTER UNDER A NAME (2026-09-10). This was a third private copy of
 * "what is this position called", and like the other two it only knew the
 * individual codes: an F/D/G board printed `C · EDM` under a player whose
 * slot is F. It now defers to `positionChipKey`, the one the chips read,
 * with the league's format passed in. No colour here on purpose — the board
 * cell is an 8px line on a Press Box surface, where orange means "your
 * pick" and nothing else.
 */
/** One DESKTOP board row: the 72px cell plus the 4px grid gap; the head row is the 11px label plus its padding. (Only the desktop window reads these.) */
const BOARD_ROW_PX = 76;
const BOARD_HEAD_PX = 22;

const normalizePosition = (pos: string, positionType: PositionType): string =>
  positionChipKey(pos, positionType);

export const DraftBoard = ({
  positionType = 'individual',
  teams,
  draftHistory,
  currentPick,
  currentRound,
  totalRounds = 16,
  onPlayerClick,
  draftType = 'snake',
  userTeamId = null,
  lastPicks = 3,
  keeperSlots,
  viewportRows,
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

  /**
   * THE CARD IS THE COLOUR (2026-09-14, Garrett: "the cards themselves
   * should be the citrus colours, not the positional highlight"). On a
   * wide board a made pick's whole card wears the roster's position
   * colour — sage C, sage-soft LW, orange RW, grey D, muted G — with the
   * name in that colour's own ink. Every class is `lg:`-prefixed: the
   * phone board keeps its 8px monochrome line.
   */
  const boardCard: Record<string, string> = {
    LW: 'lg:bg-pastel-sage-soft lg:text-pastel-forest',
    C: 'lg:bg-pastel-sage lg:text-pastel-forest',
    RW: 'lg:bg-pastel-orange lg:text-white',
    D: 'lg:bg-white/10 lg:text-pastel-cream',
    G: 'lg:bg-pastel-sage/15 lg:text-pastel-cream',
    UTIL: 'lg:bg-pastel-sage lg:text-pastel-forest',
    F: 'lg:bg-pastel-orange lg:text-white',
  };
  const cardTone = (label: string): string => boardCard[label.toUpperCase()] ?? 'lg:bg-white/15 lg:text-pastel-cream';

  /** `Draisaitl` from `Leon Draisaitl`; `J. Hughes` when two share a name is the caller's job. */
  const surname = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    return parts.length === 1 ? parts[0] : parts.slice(1).join(' ');
  };
  /** `L. Draisaitl` from `Leon Draisaitl` (2026-09-14, Garrett: "first initial then last name. G. Storms"). Desktop cards only. */
  const initialSurname = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0].charAt(0).toUpperCase()}. ${parts.slice(1).join(' ')}`;
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
  /* Desktop drops the 80px floor to 56px so the tracks can divide the width
     they are given rather than demanding more than there is. The floor is not
     removed entirely: at `minmax(0, 1fr)` a 20-team league would squeeze to
     unreadable slivers instead of scrolling. */
  const columnsWide = `42px repeat(${teams.length}, minmax(56px, 1fr))`;

  /* The board opens on the pick that is live. Four columns fit a phone and
     the clock may be in the eleventh; scrolling to it — the on-clock cell,
     centred — is what the artboard shows and what a manager is looking
     for. Re-runs as the pick moves. */
  const onClockRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // SCROLL FREELY (2026-09-14, Garrett): this used to re-centre on the
  // on-clock cell for EVERY pick, so a manager reading three columns over
  // was dragged back each time anyone drafted. Now it centres once, when the
  // board first mounts, and again only when the clock lands on YOUR pick,
  // which is the one moment the board owes you its attention. Every other
  // pick leaves the scroll position exactly where the manager put it.
  const centredOnceRef = useRef(false);
  const onClockTeamId = useMemo(() => {
    if (!currentPick || teams.length === 0) return null;
    const round = Math.ceil(currentPick / teams.length);
    const indexInRound = (currentPick - 1) % teams.length;
    const isOddRound = round % 2 === 1;
    const teamIndex = (isLinear || isOddRound) ? indexInRound : (teams.length - 1 - indexInRound);
    return teams[teamIndex]?.id ?? null;
  }, [currentPick, teams, isLinear]);
  useEffect(() => {
    const cell = onClockRef.current;
    const scroller = scrollerRef.current;
    if (!cell || !scroller) return;
    const myPick = userTeamId != null && onClockTeamId === userTeamId;
    if (centredOnceRef.current && !myPick) return;
    centredOnceRef.current = true;
    // The scroller's OWN scrollLeft, never `scrollIntoView`: that walks every
    // scrollable ancestor and dragged the whole page sideways, header and
    // tabs with it, the first time this ran.
    const target = cell.offsetLeft - scroller.clientWidth / 2 + cell.offsetWidth / 2;
    scroller.scrollLeft = Math.max(0, target);
    if (viewportRows) {
      // Keep the on-clock round one row below the pinned heads, so the round
      // above stays readable and four more sit beneath it.
      const rowTop = cell.offsetTop - BOARD_ROW_PX - BOARD_HEAD_PX;
      scroller.scrollTop = Math.max(0, rowTop);
    }
  }, [currentPick, onClockTeamId, userTeamId, viewportRows]);

  return (
    <div className={cn(PB_TYPE)} data-testid="draft-board">
      <div className="flex items-center justify-between gap-2 px-3.5">
        <h2 className="font-condensed font-bold text-[15px] lg:text-[18px] uppercase tracking-[0.08em] text-pressbox-text">
          Board
        </h2>
        <span className="font-plex font-medium text-[11px] text-pressbox-text/50 whitespace-nowrap">
          {draftHistory.length} of {totalPicks} picks made
        </span>
      </div>

      <div
        ref={scrollerRef}
        className={cn('relative mt-2 overflow-x-auto scrollbar-hide ios-scroll', viewportRows && 'lg:overflow-y-auto lg:max-h-[var(--board-viewport)] lg:scrollbar-pressbox')}
        style={viewportRows ? ({ '--board-viewport': `${BOARD_HEAD_PX + viewportRows * BOARD_ROW_PX}px` } as React.CSSProperties) : undefined}
        data-testid="draft-board-scroller"
      >
        {/* `min-w-max`: a block-level grid is only as wide as the scroller
            (393) while its tracks overflow to 1060, and a sticky rail can
            never leave its containing block's box — so it stuck at the
            box's far edge, 56px off screen. The grid must be as wide as its
            tracks for `left:0` to mean the screen edge. */}
        <div
          className={cn(
            'grid gap-1 pr-3.5',
            viewportRows && 'lg:[&>.board-head]:sticky lg:[&>.board-head]:top-0 lg:[&>.board-head]:z-sticky-raised lg:[&>.board-head]:bg-pressbox-surface',
            // `min-w-max` is what makes the phone board wider than its
            // scroller (and what lets `left:0` mean the screen edge). On
            // desktop that is exactly what has to go.
            'min-w-max lg:min-w-0',
            '[grid-template-columns:var(--board-cols)]',
            'lg:[grid-template-columns:var(--board-cols-wide)]',
          )}
          style={
            {
              '--board-cols': columns,
              '--board-cols-wide': columnsWide,
            } as React.CSSProperties
          }
        >
          {/* Column heads. The round rail's corner is sticky too, so the
              heads never slide under a floating label. */}
          <div className="board-head sticky left-0 z-sticky-base bg-pressbox-surface pl-3.5" />
          {teams.map((team) => (
            <div
              key={team.id}
              className={cn(
                'board-head pb-1 text-center font-plex font-semibold text-[9px] lg:text-[11px] truncate',
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
                <div className="sticky left-0 z-sticky-base flex items-center bg-pressbox-surface pl-3.5 font-plex font-semibold text-[9px] lg:text-[11px] text-pressbox-text/40">
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
                        className="h-[54px] lg:h-[72px] rounded-[8px] bg-pressbox-orange text-pressbox-orange-ink flex flex-col items-center justify-center px-[7px] py-1.5"
                        data-testid="draft-board-on-clock"
                      >
                        <span className="font-plex font-semibold text-[18px] lg:text-[22px] leading-none tabular-nums">
                          {pickLabel(round, pickNumber)}
                        </span>
                        <span className="mt-[3px] font-plex font-semibold text-[8px] lg:text-[10px] opacity-80">ON THE CLOCK</span>
                      </div>
                    );
                  }

                  if (pick) {
                    const posLabel = normalizePosition(pick.position, positionType);
                    const tone = cardTone(posLabel);
                    return (
                      <button
                        type="button"
                        key={`${round}-${team.id}`}
                        onClick={() => onPlayerClick?.(pick.playerId)}
                        aria-label={`${pick.playerName}, pick ${pickLabel(round, pickNumber)}`}
                        data-position={posLabel}
                        className={cn(
                          'h-[54px] rounded-[8px] bg-pressbox-tile px-[7px] py-1.5 text-left min-w-0 active:bg-pressbox-tile-high',
                          'lg:h-[72px] lg:px-1.5 lg:py-2',
                          tone,
                          mine && 'shadow-[inset_0_0_0_1px_rgba(255,107,26,0.35)] lg:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.55)]',
                        )}
                      >
                        {/* THE FACE (2026-09-14, Garrett: "headshots as the initial
                            circle, much like mobile"). Desktop only: the shared Mug,
                            headshot → crest → initials, then the club and position,
                            then the surname across the card's whole width. */}
                        <span className="hidden lg:block min-w-0">
                          <span className="flex items-center gap-1 min-w-0">
                            <Mug p={{ name: pick.playerName, image: pick.headshotUrl ?? null, team: pick.playerTeam ?? null }} size="xs" className="flex-none" />
                            <span className="min-w-0 font-plex font-semibold text-[10px] uppercase tracking-[0.04em] opacity-80 truncate" data-testid="draft-board-position">
                              {posLabel}{pick.playerTeam ? ` ${pick.playerTeam}` : ''}
                            </span>
                          </span>
                          <span className="block mt-1 font-barlow font-bold text-[13px] leading-tight tracking-tight truncate" data-testid="draft-board-name">
                            {initialSurname(pick.playerName)}
                          </span>
                        </span>
                        {/* Phone: exactly the line it had. */}
                        <span className="block font-barlow font-bold text-[12px] truncate text-pressbox-text lg:hidden">
                          {surname(pick.playerName)}
                        </span>
                        <span className="block mt-[3px] font-plex font-medium text-[8px] text-pressbox-text/50 truncate lg:hidden">
                          {posLabel}
                          {pick.playerTeam ? ` · ${pick.playerTeam}` : ''}
                        </span>
                      </button>
                    );
                  }

                  const keeperName = keeperSlots?.get(`${team.id}:${round}`);
                  if (keeperName) {
                    return (
                      <div
                        key={`${round}-${team.id}`}
                        className={cn(
                          'h-[54px] lg:h-[72px] rounded-[8px] bg-pressbox-tile/60 border border-pressbox-sage/40 px-[7px] py-1.5 min-w-0',
                          mine && 'shadow-[inset_0_0_0_1px_rgba(255,107,26,0.35)]',
                        )}
                        data-testid="draft-board-keeper"
                      >
                        <span className="block font-barlow font-bold text-[12px] truncate text-pressbox-text/80">{surname(keeperName)}</span>
                        <span className="block mt-[3px] font-plex font-semibold text-[8px] tracking-[0.1em] text-pressbox-sage">KEEPER</span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${round}-${team.id}`}
                      className={cn(
                        'h-[54px] lg:h-[72px] rounded-[8px] border border-dashed px-[7px] py-1.5 font-plex font-medium text-[8px] lg:text-[11px]',
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
        <p className="mt-2 text-center font-plex font-medium text-[9px] text-pressbox-text/40 lg:hidden">
          SWIPE FOR ALL {teams.length} TEAMS{onPlayerClick ? ' · TAP A PICK FOR THE CARD' : ''}
        </p>
      )}

      {/* In window mode the player list sits directly under the board
          (Garrett: "that's the most important list for the user to see"),
          so LAST PICKS steps aside on desktop. The phone keeps it. */}
      {lastPicks > 0 && recent.length > 0 && (
        <div className={cn('mt-3.5 px-3.5', viewportRows && 'lg:hidden')} data-testid="draft-board-last-picks">
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
                    {normalizePosition(pick.position, positionType)}
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
