import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Lock, Unlock } from 'lucide-react';
import { MatchupPlayer } from './types';

interface DailyRoster {
  roster_date: string;
  active_players: number[];
  bench_players: number[];
  ir_players: number[];
  is_locked: boolean;
  daily_score: number;
}

interface DailyRostersProps {
  matchupId: string;
  teamId: string;
  opponentTeamId: string | null;
  weekStart: string;
  weekEnd: string;
  myTeamRoster: MatchupPlayer[];
  opponentTeamRoster: MatchupPlayer[];
  myDailyPoints: number[];
  opponentDailyPoints: number[];
  selectedDate?: string | null; // Optional: show only selected date
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
  const [myDailyRosters, setMyDailyRosters] = useState<DailyRoster[]>([]);
  const [opponentDailyRosters, setOpponentDailyRosters] = useState<DailyRoster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDailyRosters = async () => {
      try {
        setLoading(true);

        // Fetch daily rosters for my team
        const { data: myRosters, error: myError } = await supabase
          .from('fantasy_daily_rosters')
          .select('roster_date, player_id, slot_type, is_locked')
          .eq('matchup_id', matchupId)
          .eq('team_id', teamId)
          .gte('roster_date', weekStart)
          .lte('roster_date', weekEnd)
          .order('roster_date', { ascending: true });

        if (myError) throw myError;

        // Fetch daily rosters for opponent team
        let opponentRosters: any[] = [];
        if (opponentTeamId) {
          const { data: oppRosters, error: oppError } = await supabase
            .from('fantasy_daily_rosters')
            .select('roster_date, player_id, slot_type, is_locked')
            .eq('matchup_id', matchupId)
            .eq('team_id', opponentTeamId)
            .gte('roster_date', weekStart)
            .lte('roster_date', weekEnd)
            .order('roster_date', { ascending: true });

          if (oppError) throw oppError;
          opponentRosters = oppRosters || [];
        }

        // Group by date
        const myGrouped = groupByDate(myRosters || [], myDailyPoints);
        const oppGrouped = groupByDate(opponentRosters, opponentDailyPoints);

        setMyDailyRosters(myGrouped);
        setOpponentDailyRosters(oppGrouped);
      } catch (error) {
        console.error('[DailyRosters] Error fetching daily rosters:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDailyRosters();
  }, [matchupId, teamId, opponentTeamId, weekStart, weekEnd, myDailyPoints, opponentDailyPoints]);

  const groupByDate = (rosters: any[], dailyPoints: number[]): DailyRoster[] => {
    const grouped: Record<string, DailyRoster> = {};
    const dates = getWeekDates(weekStart, weekEnd);

    // Initialize all dates
    dates.forEach((date, index) => {
      grouped[date] = {
        roster_date: date,
        active_players: [],
        bench_players: [],
        ir_players: [],
        is_locked: false,
        daily_score: dailyPoints[index] || 0,
      };
    });

    // Populate with actual data
    rosters.forEach((roster) => {
      const date = roster.roster_date;
      if (!grouped[date]) {
        grouped[date] = {
          roster_date: date,
          active_players: [],
          bench_players: [],
          ir_players: [],
          is_locked: false,
          daily_score: 0,
        };
      }

      const playerId = parseInt(roster.player_id);
      if (roster.slot_type === 'active') {
        grouped[date].active_players.push(playerId);
      } else if (roster.slot_type === 'bench') {
        grouped[date].bench_players.push(playerId);
      } else if (roster.slot_type === 'ir') {
        grouped[date].ir_players.push(playerId);
      }

      if (roster.is_locked) {
        grouped[date].is_locked = true;
      }
    });

    return Object.values(grouped).sort((a, b) => 
      new Date(a.roster_date).getTime() - new Date(b.roster_date).getTime()
    );
  };

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

  const getPlayerById = (playerId: number, roster: MatchupPlayer[]): MatchupPlayer | undefined => {
    return roster.find(p => p.id === playerId);
  };

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

  if (loading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading daily rosters...
      </div>
    );
  }

  const allDates = getWeekDates(weekStart, weekEnd);
  
  // Filter to show only selected date if provided
  const datesToShow = selectedDate ? [selectedDate] : allDates;

  return (
    <div className="space-y-6">
      {!selectedDate && (
        <div className="text-sm text-muted-foreground mb-4">
          View daily roster snapshots for this matchup week. Players are locked once their game starts.
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
        const index = allDates.indexOf(date);
        const myRoster = myDailyRosters[index];
        const oppRoster = opponentDailyRosters[index];

        return (
          <Card key={date} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  {formatDate(date)}
                  {myRoster?.is_locked && (
                    <Badge variant="outline" className="text-xs">
                      <Lock className="h-3 w-3 mr-1" />
                      Locked
                    </Badge>
                  )}
                  {!myRoster?.is_locked && (
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
                      {myRoster?.daily_score.toFixed(1) || '0.0'} pts
                    </div>
                  </div>
                  {opponentTeamId && (
                    <div className="text-right">
                      <div className="text-muted-foreground text-xs">Opponent</div>
                      <div className="font-bold text-foreground/80">
                        {oppRoster?.daily_score.toFixed(1) || '0.0'} pts
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
                    My Team
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Active ({myRoster?.active_players.length || 0})</div>
                      <div className="flex flex-wrap gap-2">
                        {myRoster?.active_players.map((playerId) => {
                          const player = getPlayerById(playerId, myTeamRoster);
                          return player ? (
                            <Badge key={playerId} variant="default" className="text-xs">
                              {player.name} ({player.position})
                            </Badge>
                          ) : null;
                        })}
                        {(!myRoster || myRoster.active_players.length === 0) && (
                          <span className="text-xs text-muted-foreground">No active players</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Bench ({myRoster?.bench_players.length || 0})</div>
                      <div className="flex flex-wrap gap-2">
                        {myRoster?.bench_players.map((playerId) => {
                          const player = getPlayerById(playerId, myTeamRoster);
                          return player ? (
                            <Badge key={playerId} variant="outline" className="text-xs opacity-60">
                              {player.name} ({player.position})
                            </Badge>
                          ) : null;
                        })}
                        {(!myRoster || myRoster.bench_players.length === 0) && (
                          <span className="text-xs text-muted-foreground">No bench players</span>
                        )}
                      </div>
                    </div>
                    {myRoster?.ir_players && myRoster.ir_players.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">IR ({myRoster.ir_players.length})</div>
                        <div className="flex flex-wrap gap-2">
                          {myRoster.ir_players.map((playerId) => {
                            const player = getPlayerById(playerId, myTeamRoster);
                            return player ? (
                              <Badge key={playerId} variant="destructive" className="text-xs">
                                {player.name} ({player.position})
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Opponent Team */}
                {opponentTeamId && (
                  <div>
                    <div className="text-xs font-semibold text-foreground/80 mb-3 uppercase tracking-wider">
                      Opponent
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">Active ({oppRoster?.active_players.length || 0})</div>
                        <div className="flex flex-wrap gap-2">
                          {oppRoster?.active_players.map((playerId) => {
                            const player = getPlayerById(playerId, opponentTeamRoster);
                            return player ? (
                              <Badge key={playerId} variant="outline" className="text-xs">
                                {player.name} ({player.position})
                              </Badge>
                            ) : null;
                          })}
                          {(!oppRoster || oppRoster.active_players.length === 0) && (
                            <span className="text-xs text-muted-foreground">No active players</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">Bench ({oppRoster?.bench_players.length || 0})</div>
                        <div className="flex flex-wrap gap-2">
                          {oppRoster?.bench_players.map((playerId) => {
                            const player = getPlayerById(playerId, opponentTeamRoster);
                            return player ? (
                              <Badge key={playerId} variant="outline" className="text-xs opacity-60">
                                {player.name} ({player.position})
                              </Badge>
                            ) : null;
                          })}
                          {(!oppRoster || oppRoster.bench_players.length === 0) && (
                            <span className="text-xs text-muted-foreground">No bench players</span>
                          )}
                        </div>
                      </div>
                      {oppRoster?.ir_players && oppRoster.ir_players.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-2">IR ({oppRoster.ir_players.length})</div>
                          <div className="flex flex-wrap gap-2">
                            {oppRoster.ir_players.map((playerId) => {
                              const player = getPlayerById(playerId, opponentTeamRoster);
                              return player ? (
                                <Badge key={playerId} variant="destructive" className="text-xs">
                                  {player.name} ({player.position})
                                </Badge>
                              ) : null;
                            })}
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
