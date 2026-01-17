import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { DemoDataService } from '@/services/DemoDataService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeagueService, League, Team } from '@/services/LeagueService';
import { DraftService } from '@/services/DraftService';
import { PlayerService } from '@/services/PlayerService';
import { MatchupService } from '@/services/MatchupService';
import { Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import LoadingScreen from '@/components/LoadingScreen';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';
import { supabase } from '@/integrations/supabase/client';
import { AdSpace } from '@/components/AdSpace';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSlice, CitrusLeaf, CitrusSparkle } from '@/components/icons/CitrusIcons';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';

interface StandingsTeam {
  id: string;
  name: string;
  owner: string;
  logo: string;
  record: { wins: number; losses: number };
  points: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string;
  winPercentage: number;
  last5: { wins: number; losses: number };
}

const Standings = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, isChangingLeague } = useLeague();
  const { toast } = useToast();
  const [season, setSeason] = useState("2025");
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<StandingsTeam[]>([]);
  const [leagueTeams, setLeagueTeams] = useState<(Team & { owner_name?: string })[]>([]);
  const hasInitializedRef = useRef(false);
  const navigate = useNavigate();
  
  // Auto-complete matchups and load standings
  useEffect(() => {
    // Skip if league is changing
    if (isChangingLeague) {
      return;
    }
    
    const loadStandings = async () => {
      // Initialize loading state
      setLoading(true);
      
      try {
        // State 1: Guest - show demo data
        // State 2: Logged in, no league - show demo data (will show CTAs in UI)
        if (userLeagueState === 'guest' || userLeagueState === 'logged-in-no-league') {
          const demoTeams = DemoDataService.getDemoTeams();
          const standingsTeams: StandingsTeam[] = demoTeams.map(t => ({
            id: String(t.id),
            name: t.name,
            owner: t.owner,
            logo: t.logo,
            record: t.record,
            points: t.points,
            pointsFor: t.points, // Using points as pointsFor for demo
            pointsAgainst: Math.floor(t.points * 0.85), // Demo calculation
            streak: t.streak,
            winPercentage: 0,
            last5: { wins: 0, losses: 0 },
          }));
          setTeams(standingsTeams);
          setLoading(false);
          return;
        }

        // State 3: Active user - load real data
        if (userLeagueState === 'active-user' && user) {
          // Get user's leagues first
          const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
          if (leaguesError) throw leaguesError;

          if (userLeagues.length === 0) {
            // This shouldn't happen if userLeagueState is 'active-user', but handle gracefully
            setTeams([]);
            setLeagues([]);
            setLoading(false);
            return;
          }

          setLeagues(userLeagues);
          // Use activeLeagueId from LeagueContext (no local selectedLeagueId state needed)
          const leagueToUse = activeLeagueId || userLeagues[0].id;

          // CRITICAL: Auto-complete matchups and update scores BEFORE calculating standings
          // We MUST wait for scores to be updated before calculating standings
          // Otherwise standings will use old/wrong scores from the database
          // NOTE: If auto_complete_matchups fails, we still proceed with standings calculation
          // to ensure the page renders even if the RPC has issues
          try {
            // First, auto-complete matchups (this also updates scores for completed weeks)
            const { error: autoCompleteError } = await supabase.rpc('auto_complete_matchups');
            if (autoCompleteError) {
              console.warn('[Standings] Error auto-completing matchups (non-blocking):', autoCompleteError);
              // Don't block standings load if auto-complete fails - continue with score updates and standings calculation
            }
            
            // CRITICAL: Update all matchup scores and WAIT for completion
            // This uses the EXACT same calculation as the matchup tab (sum of 7 daily scores)
            // We MUST wait for this to complete before calculating standings
            const { error: updateScoresError, updatedCount } = await MatchupService.updateMatchupScores(leagueToUse);
            if (updateScoresError) {
              console.error('[Standings] Failed to update matchup scores:', updateScoresError);
              // Still show standings, but they may be outdated
            } else {
              console.log('[Standings] Score update completed:', {
                updatedCount: updatedCount || 0,
                leagueId: leagueToUse
              });
            }
          } catch (error) {
            console.error('[Standings] Exception updating scores:', error);
            // Still show standings, but they may be outdated
          }

          // Get league to check draft status
          const { league: leagueData, error: leagueError } = await LeagueService.getLeague(leagueToUse);
          if (leagueError) throw leagueError;

          // Get teams for selected league with owner information
          const { teams: leagueTeamsData, error: teamsError } = await LeagueService.getLeagueTeamsWithOwners(leagueToUse);
          if (teamsError) throw teamsError;

          // Store league teams for user team checking
          setLeagueTeams(leagueTeamsData);

          // Only calculate stats if draft is completed
          let teamStats: Record<string, { pointsFor: number; pointsAgainst: number; wins: number; losses: number }> = {};
          
          if (leagueData && leagueData.draft_status === 'completed') {
            // Get draft picks for this league to calculate team stats
            const { picks: draftPicks } = await DraftService.getDraftPicks(leagueToUse);
            
            if (draftPicks && draftPicks.length > 0) {
              // Get all players to calculate points
              const allPlayers = await PlayerService.getAllPlayers();

              // Calculate team standings from drafted players
              teamStats = await LeagueService.calculateTeamStandings(
                leagueToUse,
                leagueTeamsData,
                draftPicks,
                allPlayers
              );
            }
          }

          // Convert database teams to standings format with calculated stats
          const standingsTeams: StandingsTeam[] = leagueTeamsData.map((team, index) => {
            const stats = teamStats[team.id] || { 
              pointsFor: 0, 
              pointsAgainst: 0, 
              wins: 0, 
              losses: 0,
              streak: '-',
              last5: { wins: 0, losses: 0 }
            };
            
            // Calculate win percentage
            const totalGames = (stats.wins || 0) + (stats.losses || 0);
            const winPercentage = totalGames > 0 
              ? ((stats.wins || 0) / totalGames) * 100 
              : 0;

            return {
              id: team.id,
              name: team.team_name,
              owner: (team as any).owner_name || (team.owner_id ? 'User' : 'AI Team'),
              logo: team.team_name.substring(0, 2).toUpperCase(),
              record: { wins: stats.wins, losses: stats.losses },
              points: stats.pointsFor, // Total points for ranking
              pointsFor: parseFloat((stats.pointsFor || 0).toFixed(1)),
              pointsAgainst: parseFloat((stats.pointsAgainst || 0).toFixed(1)),
              streak: stats.streak || '-',
              winPercentage: winPercentage !== undefined && !isNaN(winPercentage) ? parseFloat(winPercentage.toFixed(1)) : 0,
              last5: stats.last5 || { wins: 0, losses: 0 },
            };
          });

          setTeams(standingsTeams);
          console.log('[Standings] Successfully set teams data:', {
            teamCount: standingsTeams.length,
            sampleTeam: standingsTeams[0]?.name || 'none'
          });
        } else {
          // No user or wrong state - set loading to false and show empty teams
          setTeams([]);
          setLeagues([]);
          console.log('[Standings] No active user or wrong state, showing empty teams');
        }
      } catch (err: any) {
        console.error('[Standings] Error loading standings:', err);
        toast({
          title: 'Error',
          description: err.message || 'Failed to load standings',
          variant: 'destructive',
        });
        // Fallback to empty teams on error - ensure component still renders
        setTeams([]);
        setLeagues([]);
      } finally {
        // CRITICAL: Always set loading to false to ensure component renders
        // Even if there were errors, we want to show the standings (or empty state)
        console.log('[Standings] Setting loading to false, component should render now');
        setLoading(false);
      }
    };

    // Only run if userLeagueState is defined (not loading)
    if (userLeagueState !== undefined) {
      loadStandings();
    } else {
      // If userLeagueState is still loading, keep loading state
      setLoading(true);
    }
  }, [user?.id, toast, userLeagueState, activeLeagueId]);

  // Animation observer setup
  // CRITICAL: Force animate class immediately for standings content to ensure visibility
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate');
          }
        });
      },
      { threshold: 0.1 }
    );

    const animatedElements = document.querySelectorAll('.animated-element');
    animatedElements.forEach(el => {
      observer.observe(el);
      // CRITICAL FIX: Immediately add animate class to ensure visibility
      // The IntersectionObserver might not trigger if elements are already in viewport
      // This prevents the opacity-0 issue that makes content invisible
      setTimeout(() => {
        el.classList.add('animate');
      }, 50);
    });

    return () => {
      animatedElements.forEach(el => observer.unobserve(el));
    };
  }, [teams.length]); // Re-run when teams change to ensure new elements get animated
  
  // Sort teams by winning record
  const sortedTeams = [...teams].sort((a, b) => {
    // First by wins
    if (b.record.wins !== a.record.wins) {
      return b.record.wins - a.record.wins;
    }
    // Then by points if wins are the same
    return b.points - a.points;
  });

  const selectedLeague = leagues.find(l => l.id === activeLeagueId);
  
  // CRITICAL: Debug logging to diagnose visibility issue
  console.log('[Standings] Render decision:', {
    loading,
    teamsLength: teams.length,
    leaguesLength: leagues.length,
    shouldShowLoading: loading && teams.length === 0 && leagues.length === 0,
    shouldShowContent: !loading || teams.length > 0 || leagues.length > 0
  });
  
  // Early return for loading - must be after all hooks are declared
  // CRITICAL: If teams exist, NEVER show LoadingScreen - content must render
  // This prevents the component from being stuck in loading state
  // UPDATED: More explicit check - only show LoadingScreen if we truly have no data
  // ABSOLUTE RULE: If teams.length > 0, NEVER show LoadingScreen, always render content
  const shouldShowLoadingScreen = teams.length === 0 && leagues.length === 0 && loading;
  
  // Apply minimum display time to prevent flash
  const displayLoading = useMinimumLoadingTime(shouldShowLoadingScreen, 800);
  
  if (displayLoading) {
    console.log('[Standings] Showing LoadingScreen - no data yet');
    return (
      <LoadingScreen
        character="narwhal"
        message="Loading Standings..."
      />
    );
  }
  
  // CRITICAL: If we reach here, we MUST render content (even if loading is still true but we have data)
  // This ensures content is always visible when data exists
  // Force render content if we have teams, regardless of loading state
  if (teams.length > 0) {
    console.log('[Standings] FORCING content render - teams exist, ignoring loading state');
  }
  
  // Log render state for debugging
  if (teams.length > 0) {
    console.log('[Standings] Rendering content with', teams.length, 'teams, loading:', loading);
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden" style={{ visibility: 'visible', opacity: 1 }}>
      {/* Citrus Background - Floating citrus elements */}
      <CitrusBackground density="light" animated={true} />
      
      {/* Decorative elements to match Home page */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[hsl(var(--vibrant-yellow))] rounded-full opacity-10 blur-3xl -z-10"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[hsl(var(--vibrant-green))] rounded-full opacity-10 blur-3xl -z-10"></div>

      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0" style={{ visibility: 'visible', opacity: 1, zIndex: 1 }}>
        <div className="w-full m-0 p-0" style={{ visibility: 'visible', opacity: 1 }}>
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px]">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
              <div className="max-w-3xl mx-auto text-center mb-10 animated-element animate relative" style={{ visibility: 'visible', opacity: 1 }}>
            {/* Citrus Decorations */}
            <CitrusSlice className="absolute -top-6 -left-6 w-12 h-12 text-citrus-orange/20 rotate-12" />
            <CitrusLeaf className="absolute -top-4 -right-8 w-10 h-10 text-citrus-sage/20 -rotate-45" />
            
            <div className="flex items-center justify-center gap-3 mb-4">
              <CitrusSparkle className="w-8 h-8 text-citrus-orange animate-pulse" />
              <h1 className="text-4xl md:text-5xl font-bold citrus-gradient-text" style={{ visibility: 'visible', opacity: 1 }}>League Standings</h1>
              <CitrusSparkle className="w-8 h-8 text-citrus-sage animate-pulse" style={{ animationDelay: '0.3s' }} />
            </div>
            <p className="text-lg text-muted-foreground" style={{ visibility: 'visible', opacity: 1 }}>Track your team's position in the league rankings.</p>
          </div>
          
          {userLeagueState === 'logged-in-no-league' && (
            <div className="max-w-3xl mx-auto mb-12">
              <LeagueCreationCTA 
                title="Your Standings Awaits"
                description="Create your league to start tracking your team's position, competing for the top spot, and climbing the rankings."
              />
            </div>
          )}
          
          <div className="flex flex-col md:flex-row items-center justify-between max-w-5xl mx-auto mb-8">
            <div className="mb-4 md:mb-0 animated-element animate">
              <h2 className="text-2xl font-bold text-foreground">
                {userLeagueState === 'active-user' && selectedLeague ? selectedLeague.name : 'CitrusSports League'}
              </h2>
              <p className="text-muted-foreground">Regular Season Standings</p>
              {/* League selector removed - use global Navbar selector instead */}
            </div>
            
            <div className="flex items-center space-x-4 animated-element animate">
              <div className="w-40">
                <Select defaultValue={season} onValueChange={setSeason}>
                  <SelectTrigger className="w-full bg-background rounded-full border-primary/20 hover:border-primary/50 transition-colors">
                    <SelectValue placeholder="Select Season" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    <SelectItem value="2023">2023 Season</SelectItem>
                    <SelectItem value="2024">2024 Season</SelectItem>
                    <SelectItem value="2025">2025 Season</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {userLeagueState === 'active-user' && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="rounded-full border-primary/20 hover:bg-primary/5 hover:text-primary"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      // Auto-complete matchups
                      if (activeLeagueId) {
                        await supabase.rpc('auto_complete_matchups');
                      }
                      // Reload standings
                      window.location.reload();
                    } catch (error) {
                      console.error('[Standings] Error refreshing:', error);
                      toast({
                        title: 'Error',
                        description: 'Failed to refresh standings',
                        variant: 'destructive',
                      });
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              )}
              <Button variant="outline" size="sm" className="rounded-full border-primary/20 hover:bg-primary/5 hover:text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export
              </Button>
            </div>
          </div>
          
          <Card className="max-w-5xl mx-auto overflow-hidden animated-element animate card-citrus p-0 border-none shadow-lg" style={{ visibility: 'visible', opacity: 1 }}>
            <div className="overflow-x-auto" style={{ visibility: 'visible', opacity: 1 }}>
              <Table style={{ visibility: 'visible', opacity: 1 }}>
                <thead className="bg-muted/30 border-b border-border/50">
                  <tr className="text-left">
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Rank</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Team</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Record</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Win %</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right">PF</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right">PA</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Streak</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Last 5</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40" style={{ visibility: 'visible', opacity: 1 }}>
                  {sortedTeams.length === 0 ? (
                    <tr style={{ visibility: 'visible', opacity: 1 }}>
                      <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground" style={{ visibility: 'visible', opacity: 1 }}>
                        No teams found in this league.
                      </td>
                    </tr>
                  ) : (
                    sortedTeams.map((team, index) => {
                      // Check if it's user's team by comparing with user's ID from teams data
                      const isUserTeam = user && leagueTeams.some(t => t.id === team.id && t.owner_id === user.id);
                    
                    return (
                      <tr 
                        key={team.id} 
                        className={`${isUserTeam ? 'bg-primary/5' : 'hover:bg-muted/30 cursor-pointer'} transition-colors`}
                        style={{ visibility: 'visible', opacity: 1 }}
                        onClick={() => navigate(`/team/${team.id}`)}
                      >
                        <td className="px-6 py-4 font-medium">
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index < 4 ? 'bg-primary text-white' : 'text-muted-foreground bg-muted'}`}>
                              {index + 1}
                            </span>
                            {index < 4 && (
                              <span className="text-[10px] font-bold text-primary tracking-tight">PO</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4" style={{ visibility: 'visible', opacity: 1 }}>
                          <div className="flex items-center gap-3" style={{ visibility: 'visible', opacity: 1 }}>
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center text-xs font-bold text-muted-foreground border border-white/20 shadow-sm" style={{ visibility: 'visible', opacity: 1 }}>
                              {team.logo}
                            </div>
                            <div style={{ visibility: 'visible', opacity: 1 }}>
                              <div className={`font-semibold ${isUserTeam ? 'text-primary' : 'text-foreground'}`} style={{ visibility: 'visible', opacity: 1, color: isUserTeam ? undefined : 'inherit' }}>
                                {team.name}
                                {isUserTeam && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">YOU</span>}
                              </div>
                              <div className="text-xs text-muted-foreground" style={{ visibility: 'visible', opacity: 1 }}>{team.owner}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center font-medium" style={{ visibility: 'visible', opacity: 1 }}>
                          {team.record.wins}-{team.record.losses}
                        </td>
                        <td className="px-6 py-4 text-center text-muted-foreground" style={{ visibility: 'visible', opacity: 1 }}>
                          {(team.winPercentage ?? 0).toFixed(1)}%
                        </td>
                        <td className="px-6 py-4 text-right font-bold tabular-nums" style={{ visibility: 'visible', opacity: 1 }}>
                          {team.pointsFor.toFixed(1)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium tabular-nums text-muted-foreground" style={{ visibility: 'visible', opacity: 1 }}>
                          {team.pointsAgainst.toFixed(1)}
                        </td>
                        <td className="px-6 py-4 text-center" style={{ visibility: 'visible', opacity: 1 }}>
                          <span className={`inline-flex px-2.5 py-1 text-[10px] font-bold rounded-full border ${
                            team.streak.startsWith('W') 
                              ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' 
                              : team.streak.startsWith('L')
                              ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
                              : 'bg-muted text-muted-foreground border-border'
                          }`} style={{ visibility: 'visible', opacity: 1 }}>
                            {team.streak}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-muted-foreground font-medium" style={{ visibility: 'visible', opacity: 1 }}>
                          {team.last5.wins}-{team.last5.losses}
                        </td>
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
          
          <div className="max-w-5xl mx-auto mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="animated-element animate card-citrus p-0 border-none shadow-md overflow-hidden h-full">
              <CardHeader className="bg-primary/5 pb-4 border-b border-border/40">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">🏆</span>
                  Playoff Picture
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {sortedTeams.slice(0, 4).map((team, i) => (
                    <div key={team.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors border border-transparent hover:border-primary/10">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shadow-sm">
                          {i+1}
                        </div>
                        <div className="font-semibold text-sm">{team.name}</div>
                      </div>
                      <div className="text-xs font-bold bg-white px-2 py-1 rounded-md shadow-sm border border-border/20">
                        {team.record.wins}-{team.record.losses}
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 pt-4 border-t border-border/40">
                    <div className="text-center text-xs text-muted-foreground font-medium flex items-center justify-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                      Top 4 teams qualify
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="animated-element animate card-citrus p-0 border-none shadow-md overflow-hidden h-full">
              <CardHeader className="bg-[hsl(var(--vibrant-orange))]/5 pb-4 border-b border-border/40">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-[hsl(var(--vibrant-orange))]/10 flex items-center justify-center text-[hsl(var(--vibrant-orange))]">🔥</span>
                  Points Leaders
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {[...teams].sort((a, b) => b.points - a.points).slice(0, 5).map((team, i) => (
                    <div key={team.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors border border-transparent hover:border-[hsl(var(--vibrant-orange))]/10">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground border border-white/40">
                          {team.logo}
                        </div>
                        <div className="font-semibold text-sm">{team.name}</div>
                      </div>
                      <div className="font-bold text-[hsl(var(--vibrant-orange))]">{team.points.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
              </div>
              </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                <AdSpace size="300x250" label="Standings Sponsor" />
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

export default Standings;
