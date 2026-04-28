import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi } from '@/api/leagues';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, AlertCircle, Calendar, ChevronRight, ShieldCheck, BarChart3 } from 'lucide-react';
import { Narwhal } from '@/components/icons/Narwhal';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService } from '@/services/LeagueService';
import { ScheduleService } from '@/services/ScheduleService';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';
import { Navigate } from 'react-router-dom';
import { HockeyFooter } from '@/components/citrus2';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

interface PositionStats {
  position: string;
  grade: string;
  score: number;
  avgPoints: number;
  leagueRank: number;
  description: string;
  strengths: string[];
  weaknesses: string[];
  suggestion?: string;
}

interface FreeAgentRec {
  id: number;
  name: string;
  position: string;
  team: string;
  pointsPerGame: number;
  gamesThisWeek: number;
  scheduleAdvantage: boolean;
  rostered: number;
}

const TeamAnalytics = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, isChangingLeague, activeLeagueFormat } = useLeague();
  const [freeAgentTargets, setFreeAgentTargets] = useState<FreeAgentRec[]>([]);
  const [loading, setLoading] = useState(true);

  const loadScheduleMaximizers = useCallback(async () => {
    try {
      setLoading(true);
      
      // DEMO MODE: For guests, show demo analytics
      if (isGuestMode(userLeagueState)) {
        try {
          const allPlayers = await PlayerService.getAllPlayers();
          // Show top free agents for demo
          const topPlayers = [...allPlayers]
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, 10);
          
          // Batch fetch games for all teams at once
          const uniqueTeams = [...new Set(topPlayers.map(p => p.team))];
          const today = new Date();
          const dayOfWeek = today.getDay();
          const wkStart = new Date(today);
          wkStart.setDate(today.getDate() - dayOfWeek);
          wkStart.setHours(0, 0, 0, 0);
          const wkEnd = new Date(wkStart);
          wkEnd.setDate(wkStart.getDate() + 6);
          wkEnd.setHours(23, 59, 59, 999);
          const { gamesByTeam } = await ScheduleService.getGamesForTeams(uniqueTeams, wkStart, wkEnd);

          const maximizers: FreeAgentRec[] = topPlayers.map(player => {
            const count = (gamesByTeam.get(player.team.toUpperCase()) || []).length;
            return {
              id: parseInt(player.id) || 0,
              name: player.full_name,
              position: player.position,
              team: player.team,
              pointsPerGame: (player.points || 0) / Math.max(1, player.games_played || 1),
              gamesThisWeek: count,
              scheduleAdvantage: count >= 4,
              rostered: 0
            };
          });
          
          maximizers.sort((a, b) => {
            if (b.gamesThisWeek !== a.gamesThisWeek) {
              return b.gamesThisWeek - a.gamesThisWeek;
            }
            return b.pointsPerGame - a.pointsPerGame;
          });
          
          setFreeAgentTargets(maximizers);
          setLoading(false);
          return;
        } catch (error) {
          logger.error('Error loading demo analytics:', error);
          setFreeAgentTargets([]);
          setLoading(false);
          return;
        }
      }
      
      // Get user's league ID - prioritize activeLeagueId from LeagueContext
      let currentLeagueId: string | undefined = activeLeagueId || undefined;
      
      // Fallback: if no activeLeagueId is set, query for user's first team
      if (!currentLeagueId && user) {
        try {
          // Try to get user's leagues and use the first one
          const { data: leagues } = await leagueApi.getUserLeagues();

          if (leagues && Array.isArray(leagues) && leagues.length > 0) {
            currentLeagueId = leagues[0].id;
          }
        } catch (error) {
          logger.error('Error fetching user leagues:', error);
          // Continue without league ID
        }
      }
      
      // Get free agents
      const allPlayers = await PlayerService.getAllPlayers();
      const { players: freeAgents } = await LeagueService.getFreeAgents(allPlayers, currentLeagueId, user.id);

      // Batch fetch games for all teams at once (instead of per-team for-loop)
      const top10 = freeAgents.slice(0, 10);
      const faUniqueTeams = [...new Set(top10.map(p => p.team))];
      const today = new Date();
      const dayOfWeek = today.getDay();
      const faWeekStart = new Date(today);
      faWeekStart.setDate(today.getDate() - dayOfWeek);
      faWeekStart.setHours(0, 0, 0, 0);
      const faWeekEnd = new Date(faWeekStart);
      faWeekEnd.setDate(faWeekStart.getDate() + 6);
      faWeekEnd.setHours(23, 59, 59, 999);
      const { gamesByTeam: faGamesByTeam } = await ScheduleService.getGamesForTeams(faUniqueTeams, faWeekStart, faWeekEnd);

      const maximizers: FreeAgentRec[] = top10.map(player => {
        const count = (faGamesByTeam.get(player.team.toUpperCase()) || []).length;
        return {
          id: parseInt(player.id) || 0,
          name: player.full_name,
          position: player.position,
          team: player.team,
          pointsPerGame: (player.points || 0) / Math.max(1, player.games_played || 1),
          gamesThisWeek: count,
          scheduleAdvantage: count >= 4,
          rostered: 0
        };
      });
      
      // Sort by games this week (descending), then by points per game
      maximizers.sort((a, b) => {
        if (b.gamesThisWeek !== a.gamesThisWeek) {
          return b.gamesThisWeek - a.gamesThisWeek;
        }
        return b.pointsPerGame - a.pointsPerGame;
      });
      
      setFreeAgentTargets(maximizers);
    } catch (error) {
      logger.error('Error loading schedule maximizers:', error);
      setFreeAgentTargets([]);
    } finally {
      setLoading(false);
    }
  }, [user, userLeagueState, activeLeagueId]);

  useEffect(() => {
    if (isChangingLeague) return;
    loadScheduleMaximizers();
  }, [isChangingLeague, loadScheduleMaximizers]);

  // Redirect pool leagues to their pool page
  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  // Mock Analysis Data
  const positionalAnalysis: PositionStats[] = [
    {
      position: "Centers",
      grade: "A+",
      score: 98,
      avgPoints: 14.2,
      leagueRank: 1,
      description: "Elite production. McDavid and Draisaitl provide an unmatched floor and ceiling.",
      strengths: ["Scoring", "Assists", "Consistency"],
      weaknesses: [],
      suggestion: "Hold steady. No improvements needed."
    },
    {
      position: "Wingers",
      grade: "B",
      score: 82,
      avgPoints: 8.5,
      leagueRank: 5,
      description: "Solid but inconsistent. Hyman is carrying the load, but secondary scoring is lacking.",
      strengths: ["Goal Scoring"],
      weaknesses: ["Assists", "+/-"],
      suggestion: "Look for a playmaking winger on waivers to balance the scoring dependence."
    },
    {
      position: "Defense",
      grade: "A-",
      score: 91,
      avgPoints: 9.8,
      leagueRank: 2,
      description: "Very strong top pair. Bouchard is performing like a top-5 option.",
      strengths: ["Power Play Points", "Blocks"],
      weaknesses: ["Depth"],
      suggestion: "Consider streaming a 4th defenseman for off-nights."
    },
    {
      position: "Goalies",
      grade: "C-",
      score: 72,
      avgPoints: 4.1,
      leagueRank: 9,
      description: "Underperforming significantly. Skinner has been volatile.",
      strengths: ["Saves"],
      weaknesses: ["GAA", "Wins"],
      suggestion: "Urgent upgrade recommended. Target a starter on a defensive team."
    }
  ];


  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return "text-pastel-sage-soft bg-pastel-sage/15 border-pastel-sage/30";
    if (grade.startsWith('B')) return "text-blue-300 bg-blue-400/15 border-blue-400/30";
    if (grade.startsWith('C')) return "text-amber-300 bg-amber-400/15 border-amber-400/30";
    return "text-red-300 bg-red-400/15 border-red-400/30";
  };

  const gradeBorderColor = (grade: string) => {
    if (grade.startsWith('A')) return '#A6D3A0';
    if (grade.startsWith('B')) return '#93C5FD';
    if (grade.startsWith('C')) return '#FCD34D';
    return '#FCA5A5';
  };

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Analytics</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
              <div>
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5" />
                  ✦ Stormy Analytics
                </div>
                <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none mb-2">
                  Roster Deep-Dive
                </h1>
                <p className="text-sm text-white/55 flex items-center gap-2">
                  <Narwhal className="h-4 w-4 text-pastel-orange" />
                  AI-Powered Roster Optimization
                </p>
              </div>
              <div className="flex gap-3">
                <Card className="px-5 py-3 bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_8px_24px_-12px_rgba(255,168,87,0.3)]">
                  <div className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold">Team Rating</div>
                  <div className="font-calistoga text-3xl text-pastel-cream mt-1 leading-none">
                    92.4 <span className="text-sm font-normal text-white/40 align-middle">/ 100</span>
                  </div>
                </Card>
              </div>
            </div>

            {/* Demo Mode Banner */}
            {isGuestMode(userLeagueState) && (
              <div className="mb-6">
                <LeagueCreationCTA 
                  title="You're viewing demo analytics"
                  description="Sign up to see personalized analytics for your team and get AI-powered recommendations."
                  variant="compact"
                />
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Main Positional Breakdown */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="font-calistoga text-2xl text-pastel-cream flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-pastel-orange" /> Positional Deep Dive
                </h2>

                <div className="space-y-4">
                  {positionalAnalysis.map((pos) => (
                    <Card
                      key={pos.position}
                      className="overflow-hidden border-0 bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] border-l-4"
                      style={{ borderLeftColor: gradeBorderColor(pos.grade) }}
                    >
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4 gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="font-calistoga text-xl text-pastel-cream">{pos.position}</h3>
                              <Badge variant="outline" className={`${getGradeColor(pos.grade)} font-jbmono text-[10px] uppercase tracking-[0.18em] font-bold`}>Grade: {pos.grade}</Badge>
                              <Badge variant="secondary" className="text-[10px] font-jbmono uppercase tracking-[0.18em] bg-white/5 ring-1 ring-white/10 text-white/70 hover:bg-white/10 border-0">Rank #{pos.leagueRank}</Badge>
                            </div>
                            <p className="text-sm text-white/55 leading-relaxed">{pos.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-calistoga text-3xl text-pastel-cream leading-none">{pos.avgPoints}</div>
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 mt-1">Avg Pts/Game</div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between items-center text-[10px] font-jbmono uppercase tracking-[0.22em] mb-1.5">
                              <span className="text-white/55">Performance Score</span>
                              <span className="text-pastel-cream font-bold tabular-nums">{pos.score}/100</span>
                            </div>
                            <Progress value={pos.score} className="h-1.5 bg-white/10" />
                          </div>

                          {pos.suggestion && (
                            <div className="bg-pastel-orange/8 ring-1 ring-pastel-orange/20 p-3 rounded-xl flex gap-3 items-start mt-3">
                              <Narwhal className="h-5 w-5 text-pastel-orange shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-orange-soft">Stormy's Suggestion</div>
                                <p className="text-xs text-white/70 leading-relaxed">{pos.suggestion}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Right Column: Stormy's Targets */}
              <div className="space-y-4">
                <h2 className="font-calistoga text-2xl text-pastel-cream flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-pastel-orange" /> AI Recommended Targets
                </h2>

                <Card className="bg-[#1A2A20] border-0 ring-1 ring-amber-400/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(251,191,36,0.15)] relative overflow-hidden">
                  <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 bg-amber-400/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                  <CardHeader className="relative z-10">
                    <CardTitle className="font-calistoga text-lg text-amber-300 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" /> Urgent: Goaltending
                    </CardTitle>
                    <CardDescription className="text-white/55">
                      Your goalie grade is C-. Improving this position is the #1 priority to increase win probability.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10">
                    <div className="space-y-3">
                      {freeAgentTargets.filter(p => p.position === 'G').length === 0 && (
                        <div className="text-center py-3 text-xs text-white/55">No goalie targets surfaced yet.</div>
                      )}
                      {freeAgentTargets.filter(p => p.position === 'G').map(player => (
                         <div key={player.id} className="bg-white/5 hover:bg-white/[0.07] transition-colors p-3 rounded-xl ring-1 ring-white/10">
                           <div className="flex justify-between items-start mb-3 gap-3">
                             <div className="min-w-0">
                               <div className="font-bold text-pastel-cream truncate">{player.name}</div>
                               <div className="text-xs text-white/55 mt-0.5">{player.team} · {player.position}</div>
                             </div>
                             <Button size="sm" className="h-7 text-xs bg-pastel-orange text-[#0F1F15] hover:bg-pastel-orange-soft font-bold shrink-0">Claim</Button>
                           </div>
                           <div className="grid grid-cols-2 gap-2 text-xs">
                             <div className="bg-black/30 ring-1 ring-white/5 p-1.5 rounded-lg flex flex-col items-center">
                               <span className="text-[9px] font-jbmono uppercase tracking-[0.18em] text-white/55">Avg Pts</span>
                               <span className="font-mono font-bold text-pastel-sage-soft tabular-nums">{player.pointsPerGame.toFixed(1)}</span>
                             </div>
                             <div className="bg-black/30 ring-1 ring-white/5 p-1.5 rounded-lg flex flex-col items-center relative overflow-hidden">
                               <span className="text-[9px] font-jbmono uppercase tracking-[0.18em] text-white/55">This Week</span>
                               <span className="font-mono font-bold text-pastel-cream tabular-nums">{player.gamesThisWeek} Gms</span>
                               {player.scheduleAdvantage && (
                                 <div className="absolute top-1 right-1 w-2 h-2 bg-pastel-sage rounded-full animate-pulse" />
                               )}
                             </div>
                           </div>
                         </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                   <CardHeader>
                     <CardTitle className="font-calistoga text-lg text-pastel-cream">Schedule Maximizers</CardTitle>
                     <CardDescription className="text-white/55">Free agents with favorable schedules this week</CardDescription>
                   </CardHeader>
                   <CardContent className="space-y-2">
                      {loading ? (
                        <div className="text-center py-4 text-sm text-white/55">Loading schedule data…</div>
                      ) : freeAgentTargets.filter(p => p.position !== 'G' && p.gamesThisWeek >= 3).length === 0 ? (
                        <div className="text-center py-4 text-sm text-white/55">No schedule maximizers found this week.</div>
                      ) : (
                        <>
                          {freeAgentTargets.filter(p => p.position !== 'G' && p.gamesThisWeek >= 3).slice(0, 5).map(player => (
                            <div key={player.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/[0.07] transition-colors group cursor-pointer ring-1 ring-white/10">
                               <div className="flex items-center gap-3 min-w-0">
                                 <div className="w-8 h-8 rounded-lg bg-pastel-orange/20 ring-1 ring-pastel-orange/30 flex items-center justify-center font-bold text-[10px] text-pastel-orange-soft shrink-0">
                                   {player.team.substring(0,2)}
                                 </div>
                                 <div className="min-w-0">
                                   <div className="font-bold text-sm text-pastel-cream truncate">{player.name}</div>
                                   <div className="text-xs text-white/55 flex items-center gap-1 mt-0.5">
                                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-jbmono uppercase tracking-[0.18em] bg-transparent border-pastel-sage/40 text-pastel-sage-soft">{player.position}</Badge>
                                   </div>
                                 </div>
                               </div>
                               <div className="text-right shrink-0">
                                 <div className={`text-xs font-bold flex items-center justify-end gap-1 tabular-nums ${player.gamesThisWeek >= 4 ? 'text-pastel-sage-soft' : 'text-white/55'}`}>
                                   <Calendar className="h-3 w-3" /> {player.gamesThisWeek} Gms
                                 </div>
                                 <div className="text-[10px] text-white/55 tabular-nums">{player.pointsPerGame.toFixed(1)} Pts/Gm</div>
                               </div>
                            </div>
                          ))}
                          <Button variant="ghost" className="w-full text-xs text-pastel-orange hover:text-pastel-orange-soft hover:bg-white/5 mt-2 font-jbmono uppercase tracking-[0.22em]" onClick={() => window.location.href = '/free-agents?tab=schedule'}>
                            View All Schedule Trends <ChevronRight className="h-3 w-3 ml-1" />
                          </Button>
                        </>
                      )}
                   </CardContent>
                </Card>
              </div>
            </div>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <AdSpace size="300x250" label="Analytics Sponsor" />
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

export default TeamAnalytics;
