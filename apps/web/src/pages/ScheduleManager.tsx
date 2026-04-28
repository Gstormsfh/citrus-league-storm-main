import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Trophy, Users, ArrowRight, Clock } from 'lucide-react';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';
import { scheduleApi } from '@/api/schedule';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { format } from 'date-fns';
import { logger } from '@/utils/logger';
import { Navigate } from 'react-router-dom';
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
    <div className="min-h-screen bg-[#D4E8B8] flex flex-col relative">
      <CitrusBackground density="medium" />
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
              <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 relative">
              <CitrusLeaf className="absolute -top-4 -left-8 w-16 h-16 text-citrus-sage/15 rotate-12" />
              <div className="text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                  <Calendar className="w-8 h-8 text-citrus-orange" />
                  <h1 className="text-4xl font-varsity font-black text-citrus-forest uppercase tracking-tight">Schedule Manager</h1>
                  <CitrusSparkle className="w-6 h-6 text-citrus-sage animate-pulse" />
                </div>
                <p className="text-lg font-display text-citrus-charcoal">
                  View upcoming NHL games and plan your lineup
                </p>
              </div>
              
              {viewMode === 'summary' ? (
                <Button onClick={() => setViewMode('full')} className="bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest rounded-varsity shadow-patch font-varsity font-bold uppercase">
                  See Full Schedule
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setViewMode('summary')} className="border-2 border-citrus-sage rounded-varsity font-varsity">
                  Back to Summary
                </Button>
              )}
            </div>

            {/* NHL Games This Week */}
            <Card className="mb-8 bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[2rem] shadow-patch">
              <CardHeader>
                <CardTitle className="font-varsity font-black text-citrus-forest uppercase flex items-center gap-2">
                  <Clock className="w-5 h-5 text-citrus-orange" />
                  NHL Games This Week
                </CardTitle>
                <CardDescription className="font-display text-citrus-charcoal">
                  {loading ? 'Loading schedule...' : `${nhlGames.length} games scheduled`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 font-display text-citrus-charcoal">Loading games...</div>
                ) : nhlGames.length > 0 ? (
                  <div className="space-y-3">
                    {nhlGames.slice(0, 10).map((game, idx) => (
                      <div key={game.id || idx} className="flex items-center justify-between p-4 bg-gradient-to-r from-citrus-sage/10 to-citrus-peach/10 rounded-varsity border-2 border-citrus-sage/30">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <Badge className="bg-citrus-orange text-citrus-cream font-varsity font-bold">
                              {format(new Date(game.game_date.split('T')[0] + 'T00:00:00'), 'MMM d')}
                            </Badge>
                            <div className="font-varsity font-bold text-citrus-forest">
                              {game.away_team} @ {game.home_team}
                            </div>
                          </div>
                          <div className="text-sm font-display text-citrus-charcoal mt-1">
                            {game.game_time && format(new Date(game.game_time), 'h:mm a')}
                          </div>
                        </div>
                        <Badge variant="outline" className="font-mono text-xs border-citrus-sage">
                          {game.status || 'Scheduled'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 font-display text-citrus-charcoal">
                    No games scheduled this week
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary View */}
            {viewMode === 'summary' && (
              <div className="grid md:grid-cols-2 gap-8">
                {/* Next Matchup Highlight */}
                <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-primary">
                      <Calendar className="h-5 w-5" />
                      Next Matchup
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {currentMatchup ? (
                      <div className="flex flex-col items-center justify-center py-6">
                        <div className="text-xl font-semibold mb-2">{currentMatchup.week}</div>
                        <div className="text-3xl font-bold mb-4">vs {currentMatchup.opponent}</div>
                        <div className="text-muted-foreground mb-6">{currentMatchup.date}</div>
                      </div>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground">
                        Visit the Matchup page to see your next matchup details.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Stats & Last Result */}
                <div className="space-y-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Current Record</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-center py-4 text-muted-foreground">
                        Visit the Standings page to view your record.
                      </div>
                    </CardContent>
                  </Card>

                  {recentResults.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Trophy className="h-4 w-4" />
                        Last Result ({recentResults[0].week})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-lg">vs {recentResults[0].opponent}</div>
                          <div className="text-sm text-muted-foreground">{recentResults[0].score}</div>
                        </div>
                        <div className={`px-3 py-1 ${recentResults[0].result === 'win' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} rounded-full font-bold text-sm`}>
                          {recentResults[0].result === 'win' ? 'WIN' : 'LOSS'}
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
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Upcoming Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {upcomingMatchups.map((matchup, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <Users className="h-5 w-5 text-primary" />
                            <div>
                              <div className="font-semibold">{matchup.week}</div>
                              <div className="text-sm text-muted-foreground">vs {matchup.opponent}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium">{matchup.projection}</div>
                            <div className="text-xs text-muted-foreground">{matchup.date}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5" />
                      Past Results
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {recentResults.map((result, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                          <div className="flex items-center gap-4">
                            <div className={`w-2 h-12 rounded ${result.result === 'win' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <div>
                              <div className="font-semibold">{result.week}</div>
                              <div className="text-sm text-muted-foreground">vs {result.opponent}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">{result.score}</div>
                            <div className={`text-sm ${result.result === 'win' ? 'text-green-600' : 'text-red-600'}`}>
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
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ScheduleManager;
