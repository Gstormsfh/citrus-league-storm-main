import { cn } from '@/lib/utils';
// By file, never the `@/components/pressbox` barrel — it reaches LeagueContext
// and the Supabase client at module scope.
import { PB_TYPE } from '@/components/pressbox/rowScale';

/*
 * PRESS BOX (2026-09-04). Artboard 4a's MY TEAM tab, which it names and does
 * not draw, so it takes the league-menu tile and the standings row: one tile
 * per team, the manager's own first, position counts as chips, and each pick
 * as a row with its `round.pick` label in mono. The label formula and its
 * test are untouched — `pick % teams.length || teams.length` is the thing
 * TeamRosters.picklabel.test.tsx exists to hold.
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
}

interface Team {
  id: string;
  name: string;
  owner: string;
  color: string;
  picks: DraftPick[];
}

interface TeamRostersProps {
  teams: Team[];
  draftHistory: DraftPick[];
  userTeamId?: string | null;
  onPlayerClick?: (playerId: string) => void;
}

export const TeamRosters = ({ teams, draftHistory, userTeamId, onPlayerClick }: TeamRostersProps) => {
  const getTeamPicks = (teamId: string) => {
    return draftHistory.filter(pick => pick.teamId === teamId);
  };

  const getPositionCount = (picks: DraftPick[], position: string) => {
    return picks.filter(pick => pick.position === position).length;
  };

  // Separate user team from others
  const userTeam = userTeamId ? teams.find(t => t.id === userTeamId) : null;
  const otherTeams = teams.filter(t => t.id !== userTeamId);

  const TeamRosterCard = ({ team, onPlayerClick }: { team: Team; onPlayerClick?: (playerId: string) => void }) => {
    const picks = getTeamPicks(team.id);
    const positionCounts = {
      C: getPositionCount(picks, 'C'),
      LW: getPositionCount(picks, 'LW'),
      RW: getPositionCount(picks, 'RW'),
      D: getPositionCount(picks, 'D'),
      G: getPositionCount(picks, 'G'),
    };

    const mine = team.id === userTeamId;
    return (
      <div
        className={cn(
          'rounded-[12px] bg-pressbox-tile border px-3 py-2.5',
          mine ? 'border-pressbox-orange/35' : 'border-white/[0.08]',
        )}
        data-testid="team-roster-card"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              aria-hidden="true"
              className={cn(
                'w-[30px] h-[30px] flex-none rounded-full flex items-center justify-center font-condensed font-bold text-[11px] text-pressbox-text',
                mine ? 'bg-pressbox-orange/20 border-2 border-pressbox-orange' : 'bg-[#2a3a30]',
              )}
            >
              {team.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-barlow font-bold text-[13px] truncate text-pressbox-text">{team.name}</h3>
              <p className="font-plex font-medium text-[10px] truncate text-pressbox-text/55">{team.owner}</p>
            </div>
          </div>
          <div className="flex items-baseline gap-1 flex-none font-plex">
            <span className="font-semibold text-[15px] tabular-nums text-pressbox-text">{picks.length}</span>
            <span className="font-medium text-[9px] tracking-[0.06em] text-pressbox-text/45">{picks.length === 1 ? 'PICK' : 'PICKS'}</span>
          </div>
        </div>

        {/* Position Summary — single chip row (RAIL FIX 2026-08-23: the
            old 5-col grid + viewport-based lg:grid-cols-4 wrapper crushed
            these cards to ~60px inside the 300px sidebar). */}
        <div className="flex flex-wrap gap-1 mt-2">
          {Object.entries(positionCounts).map(([position, count]) => (
            <span
              key={position}
              className={cn(
                'px-1.5 py-px rounded-[4px] font-plex font-semibold text-[10px] tabular-nums',
                count > 0 ? 'bg-white/10 text-pressbox-text' : 'bg-white/[0.03] text-pressbox-text/35',
              )}
            >
              {position} {count}
            </span>
          ))}
        </div>

        {/* Draft Picks List */}
        <div className="mt-1.5 max-h-60 overflow-y-auto">
          {picks.length > 0 ? (
            picks.map(pick => (
              <div
                key={pick.id}
                className={cn(
                  'flex items-center gap-2 py-1.5 border-t border-white/[0.06]',
                  onPlayerClick && 'cursor-pointer active:bg-white/5',
                )}
                onClick={() => onPlayerClick?.(pick.playerId)}
              >
                <span className="w-7 flex-none font-plex font-semibold text-[10px] tabular-nums text-pressbox-text/50">
                  {pick.round}.{pick.pick % teams.length || teams.length}
                </span>
                <span className="min-w-0 flex-1 font-barlow font-semibold text-[13px] truncate text-pressbox-text">
                  {pick.playerName}
                </span>
                <span className="flex-none font-plex font-bold text-[10px] text-pressbox-text/70">
                  {pick.position}
                </span>
              </div>
            ))
          ) : (
            <div className="py-3 text-center font-barlow text-[12px] text-pressbox-text/55">
              No picks yet
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={cn(PB_TYPE, 'flex flex-col gap-3')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text truncate">
          Rosters
        </h2>
        <span className="font-plex font-medium text-[11px] text-pressbox-text/50 whitespace-nowrap">
          {draftHistory.length} PICKS MADE
        </span>
      </div>

      {/* My Team Section */}
      {userTeam && (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-orange-soft">MY TEAM</h3>
          <TeamRosterCard team={userTeam} onPlayerClick={onPlayerClick} />
        </div>
      )}

      {/* Other Teams Section.
          RAIL FIX (2026-08-23, found by Garrett on prod): this grid was
          `md:grid-cols-2 lg:grid-cols-4` — viewport breakpoints, but the
          only consumer is the v2 draft room's ~300px sidebar, so desktop
          windows crushed each card to ~60px of unreadable soup. The rail
          is single-column, full stop. */}
      {otherTeams.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-text/45">EVERYONE ELSE</h3>
          <div className="grid grid-cols-1 gap-1.5">
            {otherTeams.map(team => (
              <TeamRosterCard key={team.id} team={team} onPlayerClick={onPlayerClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};