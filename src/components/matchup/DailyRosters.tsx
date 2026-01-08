import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lock, Unlock } from 'lucide-react';
import { MatchupPlayer } from './types';
import { MatchupService, DailyLineupPlayer } from '@/services/MatchupService';

interface DailyRostersProps {
  matchupId: string;
  teamId: string;
  opponentTeamId: string | null;
  weekStart: string;
  weekEnd: string;
  myTeamRoster: MatchupPlayer[];       // Current roster (for today/future)
  opponentTeamRoster: MatchupPlayer[]; // Current roster (for today/future)
  myDailyPoints: number[];
  opponentDailyPoints: number[];
  selectedDate?: string | null;
}

// Internal state for each day's roster
interface DayRosterState {
  date: string;
  myLineup: DailyLineupPlayer[] | null;  // null = use current roster
  oppLineup: DailyLineupPlayer[] | null; // null = use current roster
  myDailyScore: number;
  oppDailyScore: number;
  isLocked: boolean;
  isLoading: boolean;
}

export const DailyRosters = ({
  matchupId,
  teamId,
  opponentTeamId,
  weekStart,
  weekEnd,
  myTeamRoster,
  opponentTeamRoster,
  myDailyPoints,
  opponentDailyPoints,
  selectedDate,
}: DailyRostersProps) => {
  const [dayRosters, setDayRosters] = useState<Map<string, DayRosterState>>(new Map());
  const [initialLoading, setInitialLoading] = useState(true);

  // Get all dates in the week
  const getWeekDates = (start: string, end: string): string[] => {
    const dates: string[] = [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    const current = new Date(startDate);

    while (current <= endDate) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const allDates = getWeekDates(weekStart, weekEnd);
  const datesToShow = selectedDate ? [selectedDate] : allDates;

  // Check if a date is in the past (before today)
  const isPastDate = (dateStr: string): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    return date < today;
  };

  // Fetch frozen lineups for past days using server-side RPC
  useEffect(() => {
    const fetchDailyLineups = async () => {
      setInitialLoading(true);
      const newDayRosters = new Map<string, DayRosterState>();

      for (let i = 0; i < allDates.length; i++) {
        const date = allDates[i];
        const isPast = isPastDate(date);

        if (isPast) {
          // PAST DAY: Fetch frozen lineup from server (Yahoo/Sleeper style)
          try {
            const [myLineup, oppLineup] = await Promise.all([
              MatchupService.getDailyLineup(teamId, matchupId, date),
              opponentTeamId 
                ? MatchupService.getDailyLineup(opponentTeamId, matchupId, date)
                : Promise.resolve([])
            ]);

            // Calculate daily score from the fetched lineup
            const myDailyScore = myLineup
              .filter(p => p.slot_type === 'active')
              .reduce((sum, p) => sum + p.daily_points, 0);
            const oppDailyScore = oppLineup
              .filter(p => p.slot_type === 'active')
              .reduce((sum, p) => sum + p.daily_points, 0);

            newDayRosters.set(date, {
              date,
              myLineup,
              oppLineup: opponentTeamId ? oppLineup : null,
              myDailyScore,
              oppDailyScore,
              isLocked: myLineup.some(p => p.is_locked) || true, // Past days are always locked
              isLoading: false
            });
          } catch (error) {
            console.error(`[DailyRosters] Error fetching lineup for ${date}:`, error);
            // Fallback to current roster if fetch fails
            newDayRosters.set(date, {
              date,
              myLineup: null,
              oppLineup: null,
              myDailyScore: myDailyPoints[i] || 0,
              oppDailyScore: opponentDailyPoints[i] || 0,
              isLocked: true,
              isLoading: false
            });
          }
        } else {
          // TODAY/FUTURE: Use current roster (null = use props)
          newDayRosters.set(date, {
            date,
            myLineup: null,  // Signal to use myTeamRoster prop
            oppLineup: null, // Signal to use opponentTeamRoster prop
            myDailyScore: myDailyPoints[i] || 0,
            oppDailyScore: opponentDailyPoints[i] || 0,
            isLocked: false,
            isLoading: false
          });
        }
      }

      setDayRosters(newDayRosters);
      setInitialLoading(false);
    };

    fetchDailyLineups();
  }, [matchupId, teamId, opponentTeamId, weekStart, weekEnd, allDates.join(',')]);

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) {
      return 'Today';
    }

    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  // Render a player badge - handles both frozen lineup and current roster
  const renderPlayerBadge = (
    player: DailyLineupPlayer | MatchupPlayer,
    variant: 'active' | 'bench' | 'ir'
  ) => {
    const name = 'player_name' in player ? player.player_name : player.name;
    const position = 'position' in player ? player.position : player.position;
    
    if (variant === 'active') {
      return (
        <Badge key={name} variant="default" className="text-xs">
          {name} ({position})
        </Badge>
      );
    } else if (variant === 'bench') {
      return (
        <Badge key={name} variant="outline" className="text-xs opacity-60">
          {name} ({position})
        </Badge>
      );
    } else {
      return (
        <Badge key={name} variant="destructive" className="text-xs">
          {name} ({position})
        </Badge>
      );
    }
  };

  if (initialLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading daily rosters...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!selectedDate && (
        <div className="text-sm text-muted-foreground mb-4">
          View daily roster snapshots for this matchup week. Past days show frozen lineups.
        </div>
      )}
      {selectedDate && (
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">
            Daily roster for {formatDate(selectedDate)}
          </div>
        </div>
      )}

      {datesToShow.map((date) => {
        const dayState = dayRosters.get(date);
        if (!dayState) return null;

        const isPast = isPastDate(date);
        
        // Determine which players to show
        // Past days: use frozen lineup from server
        // Today/Future: use current roster props
        const myActivePlayers = isPast && dayState.myLineup
          ? dayState.myLineup.filter(p => p.slot_type === 'active')
          : myTeamRoster.filter(p => p.isStarter);
        const myBenchPlayers = isPast && dayState.myLineup
          ? dayState.myLineup.filter(p => p.slot_type === 'bench')
          : myTeamRoster.filter(p => !p.isStarter && !p.isOnIR);
        const myIRPlayers = isPast && dayState.myLineup
          ? dayState.myLineup.filter(p => p.slot_type === 'ir')
          : myTeamRoster.filter(p => p.isOnIR);

        const oppActivePlayers = isPast && dayState.oppLineup
          ? dayState.oppLineup.filter(p => p.slot_type === 'active')
          : opponentTeamRoster.filter(p => p.isStarter);
        const oppBenchPlayers = isPast && dayState.oppLineup
          ? dayState.oppLineup.filter(p => p.slot_type === 'bench')
          : opponentTeamRoster.filter(p => !p.isStarter && !p.isOnIR);
        const oppIRPlayers = isPast && dayState.oppLineup
          ? dayState.oppLineup.filter(p => p.slot_type === 'ir')
          : opponentTeamRoster.filter(p => p.isOnIR);

        return (
          <Card key={date} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  {formatDate(date)}
                  {dayState.isLocked || isPast ? (
                    <Badge variant="outline" className="text-xs">
                      <Lock className="h-3 w-3 mr-1" />
                      {isPast ? 'Frozen' : 'Locked'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      <Unlock className="h-3 w-3 mr-1" />
                      Unlocked
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex gap-4 text-sm">
                  <div className="text-right">
                    <div className="text-muted-foreground text-xs">My Team</div>
                    <div className="font-bold text-[hsl(var(--vibrant-green))]">
                      {dayState.myDailyScore.toFixed(1)} pts
                    </div>
                  </div>
                  {opponentTeamId && (
                    <div className="text-right">
                      <div className="text-muted-foreground text-xs">Opponent</div>
                      <div className="font-bold text-foreground/80">
                        {dayState.oppDailyScore.toFixed(1)} pts
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* My Team */}
                <div>
                  <div className="text-xs font-semibold text-[hsl(var(--vibrant-green))] mb-3 uppercase tracking-wider">
                    My Team {isPast && dayState.myLineup && '(Frozen)'}
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Active ({myActivePlayers.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {myActivePlayers.map((player) => renderPlayerBadge(player, 'active'))}
                        {myActivePlayers.length === 0 && (
                          <span className="text-xs text-muted-foreground">No active players</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Bench ({myBenchPlayers.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {myBenchPlayers.map((player) => renderPlayerBadge(player, 'bench'))}
                        {myBenchPlayers.length === 0 && (
                          <span className="text-xs text-muted-foreground">No bench players</span>
                        )}
                      </div>
                    </div>
                    {myIRPlayers.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">
                          IR ({myIRPlayers.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {myIRPlayers.map((player) => renderPlayerBadge(player, 'ir'))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Opponent Team */}
                {opponentTeamId && (
                  <div>
                    <div className="text-xs font-semibold text-foreground/80 mb-3 uppercase tracking-wider">
                      Opponent {isPast && dayState.oppLineup && '(Frozen)'}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Active ({oppActivePlayers.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {oppActivePlayers.map((player) => renderPlayerBadge(player, 'active'))}
                          {oppActivePlayers.length === 0 && (
                            <span className="text-xs text-muted-foreground">No active players</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">
                          Bench ({oppBenchPlayers.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {oppBenchPlayers.map((player) => renderPlayerBadge(player, 'bench'))}
                          {oppBenchPlayers.length === 0 && (
                            <span className="text-xs text-muted-foreground">No bench players</span>
                          )}
                        </div>
                      </div>
                      {oppIRPlayers.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-2">
                            IR ({oppIRPlayers.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {oppIRPlayers.map((player) => renderPlayerBadge(player, 'ir'))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
