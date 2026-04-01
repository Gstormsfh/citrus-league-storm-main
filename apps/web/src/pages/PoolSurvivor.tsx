import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, SurvivorStanding } from '@/services/PoolService';
import { Loader2, Shield, Heart, Skull, CheckCircle, XCircle, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';

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
        const eliminated = await PoolService.isSurvivorEliminated(activeLeagueId, user.id);
        setIsEliminated(eliminated);

        const used = await PoolService.getSurvivorUsedTeams(activeLeagueId, user.id);
        setUsedTeams(used);

        const history = await PoolService.getSurvivorPickHistory(activeLeagueId, user.id);
        setPickHistory(history);

        const standingsData = await PoolService.getSurvivorStandings(activeLeagueId);
        setStandings(standingsData);

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
        <div className="max-w-4xl mx-auto px-2 sm:px-4">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-6">
              <LeagueCreationCTA
                title="Join a Survivor Pool"
                description="Create or join a Survivor pool. Pick one team to win each week — get it wrong and you're out!"
              />
            </div>
          )}

          {/* Header: stacks on mobile */}
          <div className="flex flex-col gap-2 mb-4 sm:mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
                <h2 className="text-lg sm:text-2xl font-bold leading-tight">Survivor Pool</h2>
              </div>
              {isEliminated && (
                <Badge variant="destructive" className="text-[10px] sm:text-sm shrink-0">
                  <Skull className="w-3 h-3 mr-0.5" /> Eliminated
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs sm:text-sm">Pick one team to win each week.</p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Badge variant="outline" className="text-xs sm:text-sm whitespace-nowrap">Week {currentWeek}</Badge>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 sm:mb-6 w-full sm:w-auto">
              <TabsTrigger value="pick" className="flex-1 sm:flex-none text-xs sm:text-sm">Make Pick</TabsTrigger>
              <TabsTrigger value="standings" className="flex-1 sm:flex-none text-xs sm:text-sm">Standings</TabsTrigger>
              <TabsTrigger value="history" className="flex-1 sm:flex-none text-xs sm:text-sm">History</TabsTrigger>
            </TabsList>

            <TabsContent value="pick">
              {isEliminated ? (
                <Card className="card-citrus border-none shadow-lg">
                  <CardContent className="py-10 sm:py-12 text-center px-4">
                    <Skull className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-red-400 opacity-60" />
                    <h3 className="text-lg sm:text-xl font-bold mb-2">You've Been Eliminated</h3>
                    <p className="text-muted-foreground text-sm">Better luck next season! Check standings to see who's still alive.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="card-citrus border-none shadow-lg">
                  <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
                    <CardTitle className="text-base sm:text-lg">Pick a Team for Week {currentWeek}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 sm:px-6 pb-4">
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 sm:gap-2 mb-4 sm:mb-6">
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
                            className={`text-[10px] sm:text-xs font-bold relative h-8 sm:h-9 px-1 sm:px-2 ${isUsed ? 'opacity-30 cursor-not-allowed line-through' : ''} ${isLocked && !isUsed ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={isDisabled}
                            onClick={() => setSelectedTeam(isSelected ? null : team)}
                            title={isLocked ? `${team}'s game has started` : isUsed ? `Already used ${team}` : `Pick ${team}`}
                          >
                            {team}
                            {isLocked && !isUsed && <Lock className="w-2 h-2 sm:w-2.5 sm:h-2.5 absolute top-0.5 right-0.5 text-red-400" />}
                          </Button>
                        );
                      })}
                    </div>

                    {usedTeams.length > 0 && (
                      <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-muted-foreground">
                        <span className="font-medium">Used:</span>{' '}
                        {usedTeams.join(', ')}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 sm:pt-4 border-t">
                      <span className="text-xs sm:text-sm text-muted-foreground">
                        {selectedTeam ? `Selected: ${selectedTeam}` : 'Select a team'}
                      </span>
                      <Button
                        onClick={handleSubmitPick}
                        disabled={!selectedTeam || submitting}
                        size="sm"
                        className="text-xs sm:text-sm"
                      >
                        {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        Lock In Pick
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="standings">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
                  <CardTitle className="text-base sm:text-lg">Survivor Standings</CardTitle>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  {standings.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground px-4">
                      <p>No standings data yet.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs sm:text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2 px-2 w-8">#</th>
                            <th className="text-left py-2 px-2">Player</th>
                            <th className="text-center py-2 px-2">Status</th>
                            <th className="text-center py-2 px-2 hidden sm:table-cell">Lives</th>
                            <th className="text-center py-2 px-2">Wks</th>
                            <th className="text-right py-2 px-2">Pick</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.user_id} className={`border-b last:border-0 ${s.user_id === user?.id ? 'bg-primary/5' : ''}`}>
                              <td className="py-2 px-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${!s.is_eliminated ? 'bg-green-500 text-white' : 'bg-red-400 text-white'}`}>
                                  {i + 1}
                                </span>
                              </td>
                              <td className="py-2 px-2 font-medium truncate max-w-[100px] sm:max-w-none">
                                {s.display_name}
                                {s.user_id === user?.id && <Badge variant="outline" className="ml-1 text-[8px] px-1 hidden sm:inline-flex">YOU</Badge>}
                              </td>
                              <td className="py-2 px-2 text-center">
                                {s.is_eliminated ? (
                                  <Badge variant="destructive" className="text-[8px] sm:text-[10px] px-1"><Skull className="w-2.5 h-2.5 mr-0.5" /> Out</Badge>
                                ) : (
                                  <Badge variant="default" className="text-[8px] sm:text-[10px] px-1 bg-green-500"><Heart className="w-2.5 h-2.5 mr-0.5" /> Alive</Badge>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center hidden sm:table-cell">
                                {Array.from({ length: s.lives_remaining }).map((_, j) => (
                                  <Heart key={j} className="w-3 h-3 inline text-red-500 fill-red-500" />
                                ))}
                              </td>
                              <td className="py-2 px-2 text-center font-bold">{s.teams_used.length}</td>
                              <td className="py-2 px-2 text-right font-medium">{s.current_pick || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history">
              <Card className="card-citrus border-none shadow-lg">
                <CardHeader className="px-3 sm:px-6 py-3 sm:py-4">
                  <CardTitle className="text-base sm:text-lg">Your Pick History</CardTitle>
                </CardHeader>
                <CardContent className="px-2 sm:px-6 pb-4">
                  {pickHistory.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>No picks made yet. Make your first pick!</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 sm:space-y-2">
                      {pickHistory.map((pick) => (
                        <div key={pick.week} className="flex items-center justify-between p-2.5 sm:p-3 rounded-lg bg-muted/20">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <span className="text-xs sm:text-sm font-medium text-muted-foreground">Wk {pick.week}</span>
                            <span className="font-bold text-sm sm:text-base">{pick.team}</span>
                          </div>
                          {pick.is_correct === true && <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" />}
                          {pick.is_correct === false && <XCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-500" />}
                          {pick.is_correct === null && <span className="text-[10px] sm:text-xs text-muted-foreground">Pending</span>}
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
