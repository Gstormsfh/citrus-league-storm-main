import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LeagueService, League, Team } from '@/services/LeagueService';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Trophy, Users, Calendar, Settings, Play, Copy, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const LeagueDashboard = () => {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    if (!leagueId) {
      setError('Invalid league ID');
      setLoading(false);
      return;
    }

    loadLeagueData();
  }, [leagueId, user, navigate]);

  // Reload data when page becomes visible again (user navigates back)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && leagueId && user) {
        console.log('LeagueDashboard: Page visible again, reloading data');
        loadLeagueData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [leagueId, user]);

  const loadLeagueData = async () => {
    if (!leagueId || !user) return;

    try {
      setLoading(true);
      setError(null);

      // Load league
      const { league: leagueData, error: leagueError } = await LeagueService.getLeague(leagueId);
      if (leagueError) throw leagueError;
      if (!leagueData) throw new Error('League not found');
      setLeague(leagueData);

      // Load teams
      const { teams: teamsData, error: teamsError } = await LeagueService.getLeagueTeams(leagueId);
      if (teamsError) {
        console.error('Error loading teams:', teamsError);
        throw teamsError;
      }
      console.log('Loaded teams:', teamsData);
      console.log('Team count:', teamsData?.length || 0);
      setTeams(teamsData || []);
      
      // Log button visibility conditions
      console.log('Button visibility check:', {
        draftStatus: leagueData.draft_status,
        teamsLength: teamsData?.length || 0,
        isCommissioner: leagueData.commissioner_id === user.id,
        willShowButton: leagueData.draft_status === 'not_started' && (teamsData?.length || 0) >= 12
      });

      // Load user's team
      const { team: userTeamData } = await LeagueService.getUserTeam(leagueId, user.id);
      setUserTeam(userTeamData);
    } catch (err: any) {
      setError(err.message || 'Failed to load league data');
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateFill = async () => {
    if (!leagueId) {
      console.error('handleSimulateFill: No leagueId');
      return;
    }

    // Prevent multiple simultaneous calls
    if (simulating) {
      console.log('handleSimulateFill: Already simulating, ignoring duplicate call');
      return;
    }

    console.log('handleSimulateFill: Starting for league', leagueId);
    setSimulating(true);
    
    try {
      const { error: simError } = await LeagueService.simulateLeagueFill(leagueId, 12);
      
      if (simError) {
        console.error('handleSimulateFill: Error from simulateLeagueFill:', simError);
        const errorMessage = simError.message || JSON.stringify(simError) || 'Failed to simulate teams';
        toast({
          title: 'Error Creating Teams',
          description: errorMessage,
          variant: 'destructive',
        });
        return;
      }

      console.log('handleSimulateFill: Teams created successfully, reloading...');
      
      toast({
        title: 'Teams Created',
        description: 'Simulated teams have been added to the league.',
      });

      // Wait a moment for the database to update and ensure consistency
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reload teams - try a few times in case of eventual consistency
      let teamsData;
      let reloadError;
      let retries = 3;
      
      while (retries > 0) {
        const result = await LeagueService.getLeagueTeams(leagueId);
        teamsData = result.teams;
        reloadError = result.error;
        
        if (!reloadError && teamsData && teamsData.length > 0) {
          break; // Successfully loaded teams
        }
        
        retries--;
        if (retries > 0) {
          console.log('handleSimulateFill: Retrying team reload, attempts left:', retries);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      if (reloadError) {
        console.error('handleSimulateFill: Error reloading teams:', reloadError);
        toast({
          title: 'Warning',
          description: 'Teams were created but could not be reloaded. Please refresh the page.',
          variant: 'destructive',
        });
      } else {
        console.log('handleSimulateFill: Reloaded teams:', teamsData);
        setTeams(teamsData || []);
        
        if (teamsData && teamsData.length > 0) {
          toast({
            title: 'Success',
            description: `${teamsData.length} teams are now in the league.`,
          });
        }
      }
    } catch (err: any) {
      console.error('handleSimulateFill: Exception:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to simulate teams',
        variant: 'destructive',
      });
    } finally {
      setSimulating(false);
    }
  };

  const copyJoinCode = () => {
    if (!league?.join_code) return;
    navigator.clipboard.writeText(league.join_code);
    toast({
      title: 'Copied!',
      description: 'Join code copied to clipboard',
    });
  };

  const isCommissioner = league?.commissioner_id === user?.id;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Error</CardTitle>
              <CardDescription>{error || 'League not found'}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/')}>Go Home</Button>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 pt-24 pb-20 px-4">
        <div className="container mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-4xl font-bold mb-2">{league.name}</h1>
                <div className="flex items-center gap-2">
                  <Badge variant={league.draft_status === 'completed' ? 'default' : 'secondary'}>
                    {league.draft_status === 'not_started' && 'Not Started'}
                    {league.draft_status === 'in_progress' && 'In Progress'}
                    {league.draft_status === 'completed' && 'Completed'}
                  </Badge>
                  {isCommissioner && (
                    <Badge variant="outline">Commissioner</Badge>
                  )}
                </div>
              </div>
              {isCommissioner && (
                <Button variant="outline" onClick={copyJoinCode}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Join Code
                </Button>
              )}
            </div>
          </div>

          {/* League Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Teams
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{teams.length}</div>
                <p className="text-xs text-muted-foreground">Total teams in league</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Trophy className="h-4 w-4" />
                  Roster Size
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{league.roster_size}</div>
                <p className="text-xs text-muted-foreground">Players per team</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Draft Rounds
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{league.draft_rounds}</div>
                <p className="text-xs text-muted-foreground">Total draft rounds</p>
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {isCommissioner && (
              <>
                {teams.length < 12 && league.draft_status === 'not_started' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Simulate League Fill</CardTitle>
                      <CardDescription>
                        Add simulated teams to fill the league to 12 teams for testing
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button 
                        onClick={handleSimulateFill} 
                        disabled={simulating}
                        className="w-full"
                      >
                        {simulating ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                            Creating Teams...
                          </>
                        ) : (
                          <>
                            <Users className="mr-2 h-4 w-4" />
                            Fill to 12 Teams
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Always show draft room button if commissioner and draft hasn't started */}
                {league.draft_status === 'not_started' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Draft Room</CardTitle>
                      <CardDescription>
                        {teams.length >= 12 
                          ? 'All teams are ready. Begin the draft when ready.'
                          : `Need ${12 - teams.length} more teams to start the draft.`
                        }
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button 
                        onClick={() => {
                          if (!leagueId) {
                            console.error('LeagueDashboard: No leagueId available!');
                            toast({
                              title: 'Error',
                              description: 'League ID is missing. Please refresh the page.',
                              variant: 'destructive',
                            });
                            return;
                          }
                          console.log('LeagueDashboard: Navigating to draft room with leagueId:', leagueId);
                          const draftUrl = `/draft-room?league=${leagueId}`;
                          console.log('LeagueDashboard: Draft URL:', draftUrl);
                          navigate(draftUrl);
                        }}
                        className="w-full"
                        disabled={!leagueId}
                        variant={teams.length >= 12 ? "default" : "outline"}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        {teams.length >= 12 ? 'Go to Draft Room' : `Go to Draft Room (${teams.length}/12 teams)`}
                      </Button>
                      {teams.length < 12 && (
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          You can still access the draft room, but you'll need 12 teams to start
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {userTeam && (
              <Card>
                <CardHeader>
                  <CardTitle>Your Team</CardTitle>
                  <CardDescription>{userTeam.team_name}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Button 
                      asChild
                      variant="outline" 
                      className="w-full"
                    >
                      <Link to="/roster">View Roster</Link>
                    </Button>
                    <Button 
                      asChild
                      variant="outline" 
                      className="w-full"
                    >
                      <Link to="/gm-office">GM Office</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Teams List */}
          <Card>
            <CardHeader>
              <CardTitle>Teams</CardTitle>
              <CardDescription>All teams in this league</CardDescription>
            </CardHeader>
            <CardContent>
              {teams.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No teams found in this league.</p>
                  <p className="text-sm mt-2">Teams will appear here once they join.</p>
                </div>
              ) : (
              <div className="space-y-2">
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <div className="font-medium">{team.team_name}</div>
                      {team.owner_id ? (
                        <div className="text-sm text-muted-foreground">Owner: {team.owner_id === user?.id ? 'You' : 'User'}</div>
                      ) : (
                        <div className="text-sm text-muted-foreground">AI Team</div>
                      )}
                    </div>
                    {team.owner_id === user?.id && (
                      <Badge variant="outline">Your Team</Badge>
                    )}
                  </div>
                ))}
              </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default LeagueDashboard;

