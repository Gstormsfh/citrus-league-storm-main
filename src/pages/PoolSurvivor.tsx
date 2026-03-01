import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, SurvivorStanding } from '@/services/PoolService';
import { Loader2, Shield, Heart, Skull, CheckCircle, XCircle, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';

// NHL team data for selection grid
const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL',
  'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL',
  'NSH', 'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS',
  'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
];

const PoolSurvivor = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(() => PoolService.getCurrentWeek());
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [usedTeams, setUsedTeams] = useState<string[]>([]);
  const [pickHistory, setPickHistory] = useState<Array<{ week: number; team: string; is_correct: boolean | null }>>([]);
  const [isEliminated, setIsEliminated] = useState(false);
  const [standings, setStandings] = useState<SurvivorStanding[]>([]);
  const [lockedTeams, setLockedTeams] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState('pick');

  useEffect(() => {
    const loadData = async () => {
      if (!activeLeagueId || !user) {
        setLoading(false);
        return;
      }

      try {
        // Check elimination status
        const eliminated = await PoolService.isSurvivorEliminated(activeLeagueId, user.id);
        setIsEliminated(eliminated);

        // Load used teams and pick history
        const used = await PoolService.getSurvivorUsedTeams(activeLeagueId, user.id);
        setUsedTeams(used);

        // Load full pick history with results
        const history = await PoolService.getSurvivorPickHistory(activeLeagueId, user.id);
        setPickHistory(history);

        // Load standings
        const standingsData = await PoolService.getSurvivorStandings(activeLeagueId);
        setStandings(standingsData);

        // Determine which teams are game-locked (per-game lock enforcement)
        try {
          const weekGames = await PoolService.getWeekGames(currentWeek);
          const locked = new Set<string>();
          const now = new Date();
          for (const game of weekGames) {
            const gameStart = game.game_time ? new Date(`${game.game_date}T${game.game_time}`) : null;
            const isLocked = game.status === 'live' || game.status === 'final' || (gameStart && gameStart <= now);
            if (isLocked) {
              locked.add(game.home_team);
              locked.add(game.away_team);
            }
          }
          setLockedTeams(locked);
        } catch { /* non-critical */ }
      } catch (err) {
        logger.error('[PoolSurvivor] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [activeLeagueId, user, currentWeek]);

  const handleSubmitPick = async () => {
    if (!activeLeagueId || !user || !selectedTeam) return;
    setSubmitting(true);

    try {
      const result = await PoolService.submitSurvivorPick(
        activeLeagueId, user.id, currentWeek, selectedTeam
      );

      if (result.success) {
        toast({ title: 'Pick Submitted', description: `You picked ${selectedTeam} for Week ${currentWeek}.` });
        setUsedTeams([...usedTeams, selectedTeam]);
        setSelectedTeam(null);
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to submit pick', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to submit pick', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingScreen character="narwhal" message="Loading Survivor Pool..." />;
  }

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>

      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Survivor Pool</h1>
        </div>
      </div>

      <main className="w-full lg:pt-20 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto px-4">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8">
              <LeagueCreationCTA
                title="Join a Survivor Pool"
                description="Create or join a Survivor pool. Pick one team to win each week — get it wrong and you're out!"
              />
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Shield className="w-6 h-6 text-primary" />
                Survivor Pool
              </h2>
              <p className="text-muted-foreground text-sm">Pick one team to win each week. Can't repeat teams.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="outline" className="text-sm">Week {currentWeek}</Badge>
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeek(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              {isEliminated && (
                <Badge variant="destructive" className="text-sm">
                  <Skull className="w-3 h-3 mr-1" /> Eliminated
                </Badge>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="pick">Make Pick</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
              <TabsTrigger value="history">My History</TabsTrigger>
            </TabsList>

            <TabsContent value="pick">
              {isEliminated ? (
                <Card className="card-citrus border-none shadow-lg">
                  <CardContent className="py-12 text-center">
                    <Skull className="w-16 h-16 mx-auto mb-4 text-red-400 opacity-60" />
                    <h3 className="text-xl font-bold mb-2">You've Been Eliminated</h3>
                    <p className="text-muted-foreground">Better luck next season! Check standings to see who's still alive.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="card-citrus border-none shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-lg">Pick a Team for Week {currentWeek}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 mb-6">
                      {NHL_TEAMS.map(team => {
                        const isUsed = usedTeams.includes(team);
                        const isLocked = lockedTeams.has(team);
                        const isDisabled = isUsed || isLocked;
                        const isSelected = selectedTeam === team;

                        return (
                          <Button
                            key={team}
                            variant={isSelected ? 'default' : 'outline'}
                            size="sm"
                            className={`text-xs font-bold relative ${isUsed ? 'opacity-30 cursor-not-allowed line-through' : ''} ${isLocked && !isUsed ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={isDisabled}
                            onClick={() => setSelectedTeam(isSelected ? null : team)}
                            title={isLocked ? `${team}'s game has started` : isUsed ? `Already used ${team}` : `Pick ${team}`}
                          >
                            {team}
                            {isLocked && !isUsed && <Lock className="w-2.5 h-2.5 absolute top-0.5 right-0.5 text-red-400" />}
                          </Button>
                        );
                      })}
                    </div>

                    {usedTeams.length > 0 && (
                      <div className="mb-4 text-sm text-muted-foreground">
                        <span className="font-medium">Teams used:</span>{' '}
                        {usedTeams.join(', ')}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-4 border-t">
                      <span className="text-sm text-muted-foreground">
                        {selectedTeam ? `Selected: ${selectedTeam}` : 'Select a team above'}
                      </span>
                      <Button
                        onClick={handleSubmitPick}
                        disabled={!selectedTeam || submitting}
                      >
                        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Lock In Pick
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="standings">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg">Survivor Standings</CardTitle>
                </CardHeader>
                <CardContent>
                  {standings.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>No standings data yet.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Rank</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-center">Lives</TableHead>
                          <TableHead className="text-center">Weeks Survived</TableHead>
                          <TableHead className="text-right">Current Pick</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={s.user_id === user?.id ? 'bg-primary/5' : ''}>
                            <TableCell>
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${!s.is_eliminated ? 'bg-green-500 text-white' : 'bg-red-400 text-white'}`}>
                                {i + 1}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-[10px]">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center">
                              {s.is_eliminated ? (
                                <Badge variant="destructive" className="text-[10px]"><Skull className="w-3 h-3 mr-1" /> Out</Badge>
                              ) : (
                                <Badge variant="default" className="text-[10px] bg-green-500"><Heart className="w-3 h-3 mr-1" /> Alive</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {Array.from({ length: s.lives_remaining }).map((_, j) => (
                                <Heart key={j} className="w-4 h-4 inline text-red-500 fill-red-500" />
                              ))}
                            </TableCell>
                            <TableCell className="text-center font-bold">{s.teams_used.length}</TableCell>
                            <TableCell className="text-right font-medium">{s.current_pick || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader>
                  <CardTitle className="text-lg">Your Pick History</CardTitle>
                </CardHeader>
                <CardContent>
                  {pickHistory.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>No picks made yet. Make your first pick!</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pickHistory.map((pick) => (
                        <div key={pick.week} className="flex items-center justify-between p-3 rounded-lg bg-muted/20">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-muted-foreground">Week {pick.week}</span>
                            <span className="font-bold">{pick.team}</span>
                          </div>
                          {pick.is_correct === true && <CheckCircle className="w-5 h-5 text-green-500" />}
                          {pick.is_correct === false && <XCircle className="w-5 h-5 text-red-500" />}
                          {pick.is_correct === null && <span className="text-xs text-muted-foreground">Pending</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <div className="hidden lg:block"><Footer /></div>
    </div>
  );
};

export default PoolSurvivor;
