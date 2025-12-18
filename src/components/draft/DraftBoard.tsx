import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface DraftBoardProps {
  teams: Team[];
  draftHistory: DraftPick[];
  currentPick: number;
  currentRound: number;
  totalRounds?: number; // Optional prop for total rounds (defaults to 16 if not provided)
  onPlayerClick?: (playerId: string) => void; // Callback when player name is clicked
}

// Position colors for entire card
const getPositionColor = (position: string) => {
  const normalized = normalizePosition(position);
  switch (normalized) {
    case 'C': return 'bg-fantasy-primary/20 border-fantasy-primary/30';
    case 'LW': return 'bg-fantasy-secondary/20 border-fantasy-secondary/30';
    case 'RW': return 'bg-fantasy-tertiary/20 border-fantasy-tertiary/30';
    case 'D': return 'bg-blue-200/40 border-blue-300/40';
    case 'G': return 'bg-purple-200/40 border-purple-300/40';
    default: return 'bg-muted/20 border-border';
  }
};

const normalizePosition = (pos: string): string => {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  return upper;
};

export const DraftBoard = ({ teams, draftHistory, currentPick, currentRound, totalRounds = 16, onPlayerClick }: DraftBoardProps) => {
  const totalPicks = teams.length * totalRounds;

  // Calculate pick number based on round and team index (serpentine draft)
  // Odd rounds: team order is normal (0, 1, 2, ...)
  // Even rounds: team order is reversed (..., 2, 1, 0)
  const getPickNumber = (round: number, teamIndex: number): number => {
    const isOddRound = round % 2 === 1;
    const actualTeamIndex = isOddRound ? teamIndex : (teams.length - 1 - teamIndex);
    return (round - 1) * teams.length + actualTeamIndex + 1;
  };

  const getDraftPick = (round: number, teamIndex: number): DraftPick | null => {
    const pickNumber = getPickNumber(round, teamIndex);
    return draftHistory.find(pick => pick.pick === pickNumber) || null;
  };

  const isPendingPick = (round: number, teamIndex: number): boolean => {
    const pickNumber = getPickNumber(round, teamIndex);
    return pickNumber === currentPick;
  };

  // Helper to split name into first and last
  const splitName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName };
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Draft Board
        </h2>
        <div className="text-sm text-muted-foreground">
          {draftHistory.length} of {totalPicks} picks made
        </div>
      </div>

      <div className="overflow-x-auto max-h-[calc(100vh-250px)] overflow-y-auto">
        <div className="inline-block min-w-full">
          {/* Header - All teams in one row */}
          <div 
            className="grid gap-1.5 mb-2 sticky top-0 bg-background z-10 pb-2"
            style={{ gridTemplateColumns: `60px repeat(${teams.length}, minmax(80px, 1fr))` }}
          >
            <div className="font-medium text-xs text-muted-foreground flex items-center">Round</div>
            {teams.map((team) => (
              <div key={team.id} className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <div 
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="text-[10px] font-medium truncate">{team.name}</span>
                </div>
                <div className="text-[9px] text-muted-foreground truncate">
                  {team.owner}
                </div>
              </div>
            ))}
          </div>

          {/* Draft Grid - All teams in one row per round - Show ALL rounds */}
          <div className="space-y-1">
            {Array.from({ length: totalRounds }, (_, roundIndex) => {
              const round = roundIndex + 1;
              return (
                <div 
                  key={round} 
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: `60px repeat(${teams.length}, minmax(80px, 1fr))` }}
                >
                  <div className="flex items-center justify-center bg-muted/50 rounded p-1.5">
                    <span className="text-xs font-medium">{round}</span>
                  </div>
                  
                  {teams.map((team, teamIndex) => {
                    const pick = getDraftPick(round, teamIndex);
                    const isPending = isPendingPick(round, teamIndex);
                    const pickNumber = (round - 1) * teams.length + teamIndex + 1;
                    const nameParts = pick ? splitName(pick.playerName) : null;
                    
                    return (
                      <div key={`${round}-${team.id}`} className="relative">
                        <Card className={cn(
                          "p-1.5 h-16 flex flex-col items-center justify-center text-center transition-all cursor-pointer hover:opacity-80",
                          pick ? getPositionColor(pick.position) : 'bg-muted/20',
                          isPending && 'ring-2 ring-primary bg-primary/5'
                        )}
                        onClick={() => pick && onPlayerClick && onPlayerClick(pick.playerId)}
                        >
                          {isPending && (
                            <div className="absolute -top-0.5 -right-0.5">
                              <div className="w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />
                            </div>
                          )}
                          
                          {pick ? (
                            <div className="space-y-0 w-full px-0.5">
                              <div className="text-[9px] font-medium leading-tight truncate" style={{ fontSize: 'clamp(7px, 1vw, 10px)' }}>
                                {nameParts?.firstName || pick.playerName}
                              </div>
                              {nameParts?.lastName && (
                                <div className="text-[8px] font-medium leading-tight truncate" style={{ fontSize: 'clamp(6px, 0.9vw, 9px)' }}>
                                  {nameParts.lastName}
                                </div>
                              )}
                              <div className="text-[7px] text-muted-foreground leading-tight mt-0.5" style={{ fontSize: 'clamp(6px, 0.8vw, 8px)' }}>
                                {normalizePosition(pick.position)} • R{pick.round}
                              </div>
                            </div>
                          ) : isPending ? (
                            <div className="space-y-0.5">
                              <Clock className="h-3 w-3 text-primary mx-auto" />
                              <div className="text-[8px] text-primary font-medium">
                                On Clock
                              </div>
                            </div>
                          ) : (
                            <div className="text-[8px] text-muted-foreground">
                              #{pickNumber}
                            </div>
                          )}
                        </Card>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
};
