import { useState, useEffect } from 'react';
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
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import LoadingScreen from '@/components/LoadingScreen';

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
}

const Standings = () => {
  const { user } = useAuth();
  const { userLeagueState } = useLeague();
  const { toast } = useToast();
  const [season, setSeason] = useState("2025");
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [teams, setTeams] = useState<StandingsTeam[]>([]);
  const [leagueTeams, setLeagueTeams] = useState<(Team & { owner_name?: string })[]>([]);
  const navigate = useNavigate();
  
  // Load user's leagues and teams
  useEffect(() => {
    const loadStandings = async () => {
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
        }));
        setTeams(standingsTeams);
        setLoading(false);
        return;
      }

      // State 3: Active user - load real data
      if (userLeagueState === 'active-user' && user) {
      try {
        setLoading(true);
        
        // Get user's leagues
        const { leagues: userLeagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
        if (leaguesError) throw leaguesError;

        if (userLeagues.length === 0) {
            // This shouldn't happen if userLeagueState is 'active-user', but handle gracefully
            setTeams([]);
          setLoading(false);
          return;
        }

        setLeagues(userLeagues);
        const leagueToUse = selectedLeagueId || userLeagues[0].id;
        setSelectedLeagueId(leagueToUse);

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
          const stats = teamStats[team.id] || { pointsFor: 0, pointsAgainst: 0, wins: 0, losses: 0 };
          
          // Calculate streak (simple: based on recent performance)
          let streak = '-';
          if (stats.wins > stats.losses) {
            const winDiff = stats.wins - stats.losses;
            streak = `W${Math.min(winDiff, 10)}`;
          } else if (stats.losses > stats.wins) {
            const lossDiff = stats.losses - stats.wins;
            streak = `L${Math.min(lossDiff, 10)}`;
          }

          return {
            id: team.id,
            name: team.team_name,
            owner: (team as any).owner_name || (team.owner_id ? 'User' : 'AI Team'),
            logo: team.team_name.substring(0, 2).toUpperCase(),
            record: { wins: stats.wins, losses: stats.losses },
            points: stats.pointsFor, // Total points for ranking
            pointsFor: Math.round(stats.pointsFor),
            pointsAgainst: Math.round(stats.pointsAgainst),
            streak: streak,
          };
        });

        setTeams(standingsTeams);
      } catch (err: any) {
        console.error('Error loading standings:', err);
        toast({
          title: 'Error',
          description: err.message || 'Failed to load standings',
          variant: 'destructive',
        });
        // Fallback to demo data
        const demoTeams = LeagueService.getAllTeams();
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
        }));
        setTeams(standingsTeams);
      } finally {
        setLoading(false);
        }
      }
    };

    loadStandings();
  }, [user, selectedLeagueId, toast, userLeagueState]);

  // Animation observer setup
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
    animatedElements.forEach(el => observer.observe(el));

    return () => {
      animatedElements.forEach(el => observer.unobserve(el));
    };
  }, []);
  
  // Sort teams by winning record
  const sortedTeams = [...teams].sort((a, b) => {
    // First by wins
    if (b.record.wins !== a.record.wins) {
      return b.record.wins - a.record.wins;
    }
    // Then by points if wins are the same
    return b.points - a.points;
  });

  const selectedLeague = leagues.find(l => l.id === selectedLeagueId);
  
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Decorative elements to match Home page */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[hsl(var(--vibrant-yellow))] rounded-full opacity-10 blur-3xl -z-10"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[hsl(var(--vibrant-green))] rounded-full opacity-10 blur-3xl -z-10"></div>

      <Navbar />
      <main className="pt-28 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-10 animated-element">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 citrus-gradient-text">League Standings</h1>
            <p className="text-lg text-muted-foreground">Track your team's position in the league rankings.</p>
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
            <div className="mb-4 md:mb-0 animated-element">
              <h2 className="text-2xl font-bold text-foreground">
                {userLeagueState === 'active-user' && selectedLeague ? selectedLeague.name : 'CitrusSports League'}
              </h2>
              <p className="text-muted-foreground">Regular Season Standings</p>
              {userLeagueState === 'active-user' && leagues.length > 1 && (
                <Select value={selectedLeagueId || ''} onValueChange={setSelectedLeagueId}>
                  <SelectTrigger className="w-64 mt-2">
                    <SelectValue placeholder="Select League" />
                  </SelectTrigger>
                  <SelectContent>
                    {leagues.map(league => (
                      <SelectItem key={league.id} value={league.id}>
                        {league.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            
            <div className="flex items-center space-x-4 animated-element">
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
              
              <Button variant="outline" size="sm" className="rounded-full border-primary/20 hover:bg-primary/5 hover:text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export
              </Button>
            </div>
          </div>
          
          <Card className="max-w-5xl mx-auto overflow-hidden animated-element card-citrus p-0 border-none shadow-lg">
            <div className="overflow-x-auto">
              <Table>
                <thead className="bg-muted/30 border-b border-border/50">
                  <tr className="text-left">
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Rank</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Team</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Record</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Win %</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right">PF</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right">PA</th>
                    <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center">Streak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <LoadingScreen
                          character="narwhal"
                          message="Loading Standings..."
                        />
                      </td>
                    </tr>
                  ) : sortedTeams.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                        No teams found in this league.
                      </td>
                    </tr>
                  ) : (
                    sortedTeams.map((team, index) => {
                      // Check if it's user's team by comparing with user's ID from teams data
                      const isUserTeam = user && leagueTeams.some(t => t.id === team.id && t.owner_id === user.id);
                    const winPercentage = ((team.record.wins / (team.record.wins + team.record.losses)) * 100).toFixed(1);
                    
                    return (
                      <tr 
                        key={team.id} 
                        className={`${isUserTeam ? 'bg-primary/5' : 'hover:bg-muted/30 cursor-pointer'} transition-colors`}
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
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center text-xs font-bold text-muted-foreground border border-white/20 shadow-sm">
                              {team.logo}
                            </div>
                            <div>
                              <div className={`font-semibold ${isUserTeam ? 'text-primary' : 'text-foreground'}`}>
                                {team.name}
                                {isUserTeam && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">YOU</span>}
                              </div>
                              <div className="text-xs text-muted-foreground">{team.owner}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center font-medium">
                          {team.record.wins}-{team.record.losses}
                        </td>
                        <td className="px-6 py-4 text-center text-muted-foreground">
                          {winPercentage}%
                        </td>
                        <td className="px-6 py-4 text-right font-bold tabular-nums">
                          {team.pointsFor.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right font-medium tabular-nums text-muted-foreground">
                          {team.pointsAgainst.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex px-2.5 py-1 text-[10px] font-bold rounded-full border ${
                            team.streak.startsWith('W') 
                              ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' 
                              : 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
                          }`}>
                            {team.streak}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
          
          <div className="max-w-5xl mx-auto mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="animated-element card-citrus p-0 border-none shadow-md overflow-hidden h-full">
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
            
            <Card className="animated-element card-citrus p-0 border-none shadow-md overflow-hidden h-full">
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
            
            <Card className="animated-element card-citrus p-0 border-none shadow-md overflow-hidden h-full">
              <CardHeader className="bg-[hsl(var(--vibrant-purple))]/5 pb-4 border-b border-border/40">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-[hsl(var(--vibrant-purple))]/10 flex items-center justify-center text-[hsl(var(--vibrant-purple))]">📊</span>
                  League Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="p-3 bg-muted/20 rounded-xl border border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">Total Teams</div>
                    <div className="text-2xl font-bold">{teams.length}</div>
                  </div>
                  
                  <div className="p-3 bg-muted/20 rounded-xl border border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">Avg Points For</div>
                    <div className="text-2xl font-bold">
                      {teams.length > 0 
                        ? Math.round(teams.reduce((sum, t) => sum + t.pointsFor, 0) / teams.length).toLocaleString()
                        : '0'}
                    </div>
                  </div>
                  
                  <div className="p-3 bg-muted/20 rounded-xl border border-border/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">Avg Points Against</div>
                    <div className="text-2xl font-bold">
                      {teams.length > 0 
                        ? Math.round(teams.reduce((sum, t) => sum + t.pointsAgainst, 0) / teams.length).toLocaleString()
                        : '0'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Standings;
