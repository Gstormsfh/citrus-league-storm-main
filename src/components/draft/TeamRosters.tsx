import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Trophy } from 'lucide-react';

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
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div 
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: team.color }}
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold truncate">{team.name}</h3>
              <p className="text-sm text-muted-foreground truncate">{team.owner}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0 ml-2">
            <div className="text-lg font-bold">{picks.length}</div>
            <div className="text-xs text-muted-foreground">picks</div>
          </div>
        </div>

        {/* Position Summary */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {Object.entries(positionCounts).map(([position, count]) => (
            <div key={position} className="text-center">
              <div className="text-xs text-muted-foreground">{position}</div>
              <div className="text-sm font-medium">{count}</div>
            </div>
          ))}
        </div>

        {/* Draft Picks List */}
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {picks.length > 0 ? (
            picks.map(pick => (
              <div 
                key={pick.id} 
                className={`flex items-center justify-between p-2 bg-muted/30 rounded ${onPlayerClick ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
                onClick={() => onPlayerClick?.(pick.playerId)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground w-8 flex-shrink-0">
                    {pick.round}.{pick.pick % teams.length || teams.length}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{pick.playerName}</div>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs flex-shrink-0 ml-2">
                  {pick.position}
                </Badge>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No picks yet
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Team Rosters
        </h2>
        <div className="text-sm text-muted-foreground">
          {draftHistory.length} total picks made
        </div>
      </div>

      {/* My Team Section */}
      {userTeam && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">My Team</h3>
          <TeamRosterCard team={userTeam} onPlayerClick={onPlayerClick} />
        </div>
      )}

      {/* Other Teams Section */}
      {otherTeams.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">View Others</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {otherTeams.map(team => (
              <TeamRosterCard key={team.id} team={team} onPlayerClick={onPlayerClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};