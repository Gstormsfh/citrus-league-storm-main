import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Trophy, Users, Clock } from 'lucide-react';
import { scheduleApi } from '@/api/schedule';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { format } from 'date-fns';
import { logger } from '@/utils/logger';
import { Navigate } from 'react-router-dom';
import { HockeyFooter } from '@/components/citrus2';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';
import { getTodayMST, getTodayMSTDate, formatDateToString } from '@/utils/timezoneUtils';

interface NhlGame {
  id: string | number;
  game_date: string;
  game_time: string;
  home_team: string;
  away_team: string;
  status: string;
}

const ScheduleManager = () => {
  const { user } = useAuth();
  const { activeLeagueId, userLeagueState, activeLeagueFormat } = useLeague();
  const [viewMode, setViewMode] = useState<'summary' | 'full'>('summary');
  const [nhlGames, setNhlGames] = useState<NhlGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRoster, setMyRoster] = useState<Record<string, unknown>[]>([]);

  const loadScheduleData = useCallback(async () => {
    setLoading(true);
    try {
      // Load this week's NHL games
      const todayStr = getTodayMST();
      const today = getTodayMSTDate();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = formatDateToString(nextWeek);

      const { data: games } = await scheduleApi.getGames({ startDate: todayStr, endDate: nextWeekStr }) as { data?: NhlGame[] };

      setNhlGames(games || []);

      // Load user's roster if logged in
      if (user && activeLeagueId) {
        const { data: team } = await leagueApi.getMyTeam(activeLeagueId) as { data?: { id: string } };

        if (team) {
          const { data: roster } = await rosterApi.getLineup(activeLeagueId, team.id) as { data?: Record<string, unknown> };

          setMyRoster(roster ? [roster] : []);
        }
      }
    } catch (error) {
      logger.error('Error loading schedule data:', error);
    } finally {
      setLoading(false);
    }
  }, [user, activeLeagueId]);

  useEffect(() => {
    loadScheduleData();
  }, [loadScheduleData]);

  // Redirect pool leagues to their pool page
  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  // Matchup data is loaded dynamically from Matchup/Standings pages.
  // This page focuses on the NHL schedule for lineup planning.
  const upcomingMatchups: { week: string; opponent: string; date: string; status: string; projection: string }[] = [];
  const recentResults: { week: string; opponent: string; score: string; result: string }[] = [];
  const currentMatchup = upcomingMatchups[0];

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Schedule</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))] relative z-10">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 relative">
              <div className="text-left">
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" />
                  ✦ Plan Your Week
                </div>
                <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none">Schedule Manager</h1>
                <p className="text-sm text-white/55 mt-2">
                  View upcoming NHL games and plan your lineup.
                </p>
              </div>

              {viewMode === 'summary' ? (
                <Button
                  onClick={() => setViewMode('full')}
                  className="w-full md:w-auto bg-pastel-orange text-[#0F1F15] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)] hover:shadow-[0_12px_32px_-8px_rgba(255,168,87,0.6)] transition-all"
                >
                  See Full Schedule
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setViewMode('summary')}
                  className="w-full md:w-auto bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                >
                  Back to Summary
                </Button>
              )}
            </div>

            {/* NHL Games This Week */}
            <Card className="mb-8 bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
              <CardHeader>
                <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                  <Clock className="w-5 h-5 text-pastel-orange" />
                  NHL Games This Week
                </CardTitle>
                <CardDescription className="text-white/55">
                  {loading ? 'Loading schedule…' : `${nhlGames.length} games scheduled`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 text-white/55">Loading games…</div>
                ) : nhlGames.length > 0 ? (
                  <div className="space-y-2">
                    {nhlGames.slice(0, 10).map((game, idx) => (
                      <div key={game.id || idx} className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/[0.07] transition-colors rounded-xl ring-1 ring-white/10">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold px-2 py-0.5 shrink-0">
                              {format(new Date(game.game_date.split('T')[0] + 'T00:00:00'), 'MMM d')}
                            </Badge>
                            <div className="font-bold text-pastel-cream truncate">
                              <span className="text-white/70">{game.away_team}</span>
                              <span className="text-white/40 mx-2">@</span>
                              <span className="text-pastel-cream">{game.home_team}</span>
                            </div>
                          </div>
                          <div className="text-xs text-white/55 mt-1 ml-1">
                            {game.game_time && format(new Date(game.game_time), 'h:mm a')}
                          </div>
                        </div>
                        <Badge variant="outline" className="font-jbmono text-[9px] uppercase tracking-[0.18em] bg-transparent border border-pastel-sage/40 text-pastel-sage-soft shrink-0">
                          {game.status || 'Scheduled'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-white/55">
                    No games scheduled this week
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary View */}
            {viewMode === 'summary' && (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Next Matchup Highlight */}
                <Card className="border-0 bg-[#1A2A20] ring-1 ring-pastel-orange/20 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
                  <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 bg-pastel-orange/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                  <CardHeader className="relative z-10">
                    <CardTitle className="flex items-center gap-2 text-pastel-cream font-calistoga text-xl">
                      <Calendar className="h-5 w-5 text-pastel-orange" />
                      Next Matchup
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="relative z-10">
                    {currentMatchup ? (
                      <div className="flex flex-col items-center justify-center py-6">
                        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">{currentMatchup.week}</div>
                        <div className="font-calistoga text-3xl text-pastel-cream mb-4">vs {currentMatchup.opponent}</div>
                        <div className="text-white/55 mb-6">{currentMatchup.date}</div>
                      </div>
                    ) : (
                      <div className="text-center py-6 text-white/55">
                        Visit the Matchup page to see your next matchup details.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Stats & Last Result */}
                <div className="space-y-6">
                  <Card className="border-0 bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold">Current Record</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-4 text-white/55">
                        Visit the Standings page to view your record.
                      </div>
                    </CardContent>
                  </Card>

                  {recentResults.length > 0 && (
                  <Card className="border-0 bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold">
                        <Trophy className="h-4 w-4 text-pastel-orange" />
                        Last Result ({recentResults[0].week})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-bold text-lg text-pastel-cream">vs {recentResults[0].opponent}</div>
                          <div className="text-sm text-white/55">{recentResults[0].score}</div>
                        </div>
                        <div className={`px-3 py-1 rounded-full font-jbmono text-[10px] uppercase tracking-[0.18em] font-bold ${recentResults[0].result === 'win' ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft' : 'bg-red-500/20 ring-1 ring-red-500/40 text-red-300'}`}>
                          {recentResults[0].result === 'win' ? 'Win' : 'Loss'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  )}
                </div>
              </div>
            )}

            {/* Full View */}
            {viewMode === 'full' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <Card className="border-0 bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-calistoga text-xl text-pastel-cream">
                      <Calendar className="h-5 w-5 text-pastel-orange" />
                      Upcoming Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {upcomingMatchups.length === 0 && (
                        <div className="text-center py-6 text-white/55 text-sm">
                          No upcoming matchups available — visit the Matchup page to see this week.
                        </div>
                      )}
                      {upcomingMatchups.map((matchup, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/[0.07] rounded-xl ring-1 ring-white/10 transition-colors">
                          <div className="flex items-center gap-4">
                            <Users className="h-5 w-5 text-pastel-orange shrink-0" />
                            <div>
                              <div className="font-bold text-pastel-cream">{matchup.week}</div>
                              <div className="text-sm text-white/55">vs {matchup.opponent}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-pastel-cream">{matchup.projection}</div>
                            <div className="text-xs text-white/55">{matchup.date}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-calistoga text-xl text-pastel-cream">
                      <Trophy className="h-5 w-5 text-pastel-orange" />
                      Past Results
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {recentResults.length === 0 && (
                        <div className="text-center py-6 text-white/55 text-sm">
                          No past results yet — your finished weeks will appear here.
                        </div>
                      )}
                      {recentResults.map((result, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-white/5 rounded-xl ring-1 ring-white/10">
                          <div className="flex items-center gap-4">
                            <div className={`w-1 h-12 rounded ${result.result === 'win' ? 'bg-pastel-sage' : 'bg-red-400'}`} />
                            <div>
                              <div className="font-bold text-pastel-cream">{result.week}</div>
                              <div className="text-sm text-white/55">vs {result.opponent}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-pastel-cream">{result.score}</div>
                            <div className={`text-xs font-jbmono uppercase tracking-[0.18em] font-bold ${result.result === 'win' ? 'text-pastel-sage-soft' : 'text-red-300'}`}>
                              {result.result === 'win' ? 'Win' : 'Loss'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <AdSpace size="300x250" label="Schedule Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter />
    </div>
  );
};

export default ScheduleManager;
