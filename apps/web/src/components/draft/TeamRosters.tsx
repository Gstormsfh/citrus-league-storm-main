import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

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

    return (
      <Card className="p-3.5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: team.color }}
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm leading-tight truncate">{team.name}</h3>
              <p className="text-xs text-muted-foreground truncate">{team.owner}</p>
            </div>
          </div>
          <div className="flex items-baseline gap-1 flex-shrink-0">
            <span className="text-base font-bold leading-none">{picks.length}</span>
            <span className="text-[10px] text-muted-foreground">{picks.length === 1 ? 'pick' : 'picks'}</span>
          </div>
        </div>

        {/* Position Summary — single chip row (RAIL FIX 2026-08-23: the
            old 5-col grid + viewport-based lg:grid-cols-4 wrapper crushed
            these cards to ~60px inside the 300px sidebar). */}
        <div className="flex flex-wrap gap-1 mb-3">
          {Object.entries(positionCounts).map(([position, count]) => (
            <div
              key={position}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 ${count > 0 ? 'bg-white/10 ring-white/15' : 'bg-white/[0.03] ring-white/5'}`}
            >
              <span className={`text-[10px] font-bold tracking-wide ${count > 0 ? 'text-foreground/80' : 'text-muted-foreground/50'}`}>{position}</span>
              <span className={`text-[11px] font-semibold tabular-nums ${count > 0 ? '' : 'text-muted-foreground/50'}`}>{count}</span>
            </div>
          ))}
        </div>

        {/* Draft Picks List */}
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {picks.length > 0 ? (
            picks.map(pick => (
              <div
                key={pick.id}
                className={`flex items-center justify-between px-2 py-1.5 bg-muted/30 rounded ${onPlayerClick ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
                onClick={() => onPlayerClick?.(pick.playerId)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="text-[10px] tabular-nums text-muted-foreground w-7 flex-shrink-0">
                    {pick.round}.{pick.pick % teams.length || teams.length}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{pick.playerName}</div>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 ml-2">
                  {pick.position}
                </Badge>
              </div>
            ))
          ) : (
            <div className="text-center py-3 text-muted-foreground text-xs">
              No picks yet
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2 min-w-0">
          <Users className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="truncate">Team Rosters</span>
        </h2>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {draftHistory.length} total picks made
        </div>
      </div>

      {/* My Team Section */}
      {userTeam && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-primary">My Team</h3>
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
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">View Others</h3>
          <div className="grid grid-cols-1 gap-3">
            {otherTeams.map(team => (
              <TeamRosterCard key={team.id} team={team} onPlayerClick={onPlayerClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};