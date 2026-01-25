import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { supabase } from '@/integrations/supabase/client';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
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
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSparkle, CitrusBurst } from '@/components/icons/CitrusIcons';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import LoadingScreen from '@/components/LoadingScreen';

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
  const { userLeagueState, activeLeagueId, isChangingLeague } = useLeague();
  const [freeAgentTargets, setFreeAgentTargets] = useState<FreeAgentRec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Skip if league is changing
    if (isChangingLeague) {
      return;
    }
    
    loadScheduleMaximizers();
  }, [user, userLeagueState, activeLeagueId, isChangingLeague]);

  const loadScheduleMaximizers = async () => {
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
          
          const maximizers: FreeAgentRec[] = [];
          for (const player of topPlayers) {
            try {
              const { count } = await ScheduleService.getGamesThisWeek(player.team);
              maximizers.push({
                id: parseInt(player.id) || 0,
                name: player.full_name,
                position: player.position,
                team: player.team,
                pointsPerGame: (player.points || 0) / Math.max(1, player.games_played || 1),
                gamesThisWeek: count || 0,
                scheduleAdvantage: (count || 0) >= 4,
                rostered: 0
              });
            } catch (error) {
              // Skip players with schedule errors
              console.warn(`Error getting games for ${player.team}:`, error);
            }
          }
          
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
          console.error('Error loading demo analytics:', error);
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
          const { data: userTeamData } = await supabase
            .from('teams')
            .select('league_id')
            .eq('owner_id', user.id)
            .maybeSingle();
          
          if (userTeamData) {
            currentLeagueId = userTeamData.league_id;
          }
        } catch (error) {
          console.error('Error fetching user team:', error);
          // Continue without league ID
        }
      }
      
      // Get free agents
      const allPlayers = await PlayerService.getAllPlayers();
      const freeAgents = await LeagueService.getFreeAgents(allPlayers, currentLeagueId, user.id);
      
      // Calculate games this week for each free agent
      const maximizers: FreeAgentRec[] = [];
      for (const player of freeAgents.slice(0, 10)) { // Top 10 for preview
        const { count } = await ScheduleService.getGamesThisWeek(player.team);
        
        maximizers.push({
          id: parseInt(player.id) || 0,
          name: player.full_name,
          position: player.position,
          team: player.team,
          pointsPerGame: (player.points || 0) / Math.max(1, player.games_played || 1),
          gamesThisWeek: count,
          scheduleAdvantage: count >= 4,
          rostered: 0 // Would need to calculate from league data
        });
      }
      
      // Sort by games this week (descending), then by points per game
      maximizers.sort((a, b) => {
        if (b.gamesThisWeek !== a.gamesThisWeek) {
          return b.gamesThisWeek - a.gamesThisWeek;
        }
        return b.pointsPerGame - a.pointsPerGame;
      });
      
      setFreeAgentTargets(maximizers);
    } catch (error) {
      console.error('Error loading schedule maximizers:', error);
      setFreeAgentTargets([]);
    } finally {
      setLoading(false);
    }
  };

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
    if (grade.startsWith('A')) return "text-green-500 bg-green-500/10 border-green-500/20";
    if (grade.startsWith('B')) return "text-blue-500 bg-blue-500/10 border-blue-500/20";
    if (grade.startsWith('C')) return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    return "text-red-500 bg-red-500/10 border-red-500/20";
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <CitrusBackground density="light" />
      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px]">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
              {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
              <div>
                <h1 className="text-4xl md:text-5xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600">
                  Stormy Analytics
                </h1>
                <p className="text-lg text-muted-foreground flex items-center gap-2">
                  <Narwhal className="h-5 w-5 text-purple-500" />
                  AI-Powered Roster Optimization
                </p>
              </div>
              <div className="flex gap-3">
                <Card className="px-4 py-2 bg-purple-500/5 border-purple-500/20">
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Team Rating</div>
                  <div className="text-2xl font-bold text-purple-600">92.4 <span className="text-sm font-normal text-muted-foreground">/ 100</span></div>
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

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Main Positional Breakdown */}
              <div className="lg:col-span-2 space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" /> Positional Deep Dive
                </h2>
                
                <div className="space-y-4">
                  {positionalAnalysis.map((pos) => (
                    <Card key={pos.position} className="overflow-hidden border-l-4" style={{ borderLeftColor: pos.grade.startsWith('A') ? '#22c55e' : pos.grade.startsWith('B') ? '#3b82f6' : pos.grade.startsWith('C') ? '#eab308' : '#ef4444' }}>
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="text-xl font-bold">{pos.position}</h3>
                              <Badge variant="outline" className={getGradeColor(pos.grade)}>Grade: {pos.grade}</Badge>
                              <Badge variant="secondary" className="text-xs">Rank #{pos.leagueRank}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{pos.description}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold">{pos.avgPoints}</div>
                            <div className="text-xs text-muted-foreground">Avg Pts/Game</div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span>Performance Score</span>
                              <span>{pos.score}/100</span>
                            </div>
                            <Progress value={pos.score} className="h-2" />
                          </div>

                          {pos.suggestion && (
                            <div className="bg-muted/40 p-3 rounded-lg flex gap-3 items-start mt-3 border border-dashed">
                              <Narwhal className="h-5 w-5 text-purple-500 shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <div className="text-sm font-medium text-purple-700 dark:text-purple-400">Stormy's Suggestion</div>
                                <p className="text-xs text-muted-foreground leading-relaxed">{pos.suggestion}</p>
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
              <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" /> AI Recommended Targets
                </h2>

                <Card className="bg-slate-950 text-slate-50 border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-lg text-blue-400 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" /> Urgent: Goaltending
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      Your goalie grade is C-. Improving this position is the #1 priority to increase win probability.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {freeAgentTargets.filter(p => p.position === 'G').map(player => (
                         <div key={player.id} className="bg-white/5 p-3 rounded-lg border border-white/10">
                           <div className="flex justify-between items-start mb-2">
                             <div>
                               <div className="font-bold text-base">{player.name}</div>
                               <div className="text-xs text-slate-400">{player.team} • {player.position}</div>
                             </div>
                             <Button size="sm" variant="secondary" className="h-7 text-xs">Claim</Button>
                           </div>
                           <div className="grid grid-cols-2 gap-2 text-xs">
                             <div className="bg-black/20 p-1.5 rounded flex flex-col items-center">
                               <span className="text-slate-400">Avg Pts</span>
                               <span className="font-mono font-bold text-green-400">{player.pointsPerGame}</span>
                             </div>
                             <div className="bg-black/20 p-1.5 rounded flex flex-col items-center relative overflow-hidden">
                               <span className="text-slate-400">This Week</span>
                               <span className="font-mono font-bold text-white">{player.gamesThisWeek} Gms</span>
                               {player.scheduleAdvantage && (
                                 <div className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full m-1 animate-pulse" />
                               )}
                             </div>
                           </div>
                         </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                   <CardHeader>
                     <CardTitle className="text-base">Schedule Maximizers</CardTitle>
                     <CardDescription>Free agents with favorable schedules this week</CardDescription>
                   </CardHeader>
                   <CardContent className="space-y-3">
                      {loading ? (
                        <div className="text-center py-4 text-sm text-muted-foreground">Loading schedule data...</div>
                      ) : freeAgentTargets.filter(p => p.position !== 'G' && p.gamesThisWeek >= 3).length === 0 ? (
                        <div className="text-center py-4 text-sm text-muted-foreground">No schedule maximizers found this week.</div>
                      ) : (
                        <>
                          {freeAgentTargets.filter(p => p.position !== 'G' && p.gamesThisWeek >= 3).slice(0, 5).map(player => (
                            <div key={player.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors group cursor-pointer border">
                               <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center font-bold text-xs">
                                   {player.team.substring(0,2)}
                                 </div>
                                 <div>
                                   <div className="font-medium text-sm">{player.name}</div>
                                   <div className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Badge variant="outline" className="h-4 px-1 text-[9px]">{player.position}</Badge>
                                   </div>
                                 </div>
                               </div>
                               <div className="text-right">
                                 <div className={`text-xs font-bold flex items-center justify-end gap-1 ${player.gamesThisWeek >= 4 ? 'text-green-600' : 'text-muted-foreground'}`}>
                                   <Calendar className="h-3 w-3" /> {player.gamesThisWeek} Gms
                                 </div>
                                 <div className="text-[10px] text-muted-foreground">{player.pointsPerGame.toFixed(1)} Pts/Gm</div>
                               </div>
                            </div>
                          ))}
                          <Button variant="ghost" className="w-full text-xs text-primary mt-2" onClick={() => window.location.href = '/free-agents?tab=schedule'}>
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
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                <AdSpace size="300x250" label="Analytics Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
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

export default TeamAnalytics;
