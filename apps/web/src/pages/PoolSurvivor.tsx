import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, SurvivorStanding } from '@/services/PoolService';
import { Loader2, Shield, Heart, Skull, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LoadingScreen from '@/components/LoadingScreen';
import { logger } from '@/utils/logger';
import { getTeamColor } from '@/utils/teamColors';

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
      if (!activeLeagueId || !user) { setLoading(false); return; }
      try {
        const [eliminated, used, history, standingsData] = await Promise.all([
          PoolService.isSurvivorEliminated(activeLeagueId, user.id),
          PoolService.getSurvivorUsedTeams(activeLeagueId, user.id),
          PoolService.getSurvivorPickHistory(activeLeagueId, user.id),
          PoolService.getSurvivorStandings(activeLeagueId),
        ]);
        setIsEliminated(eliminated);
        setUsedTeams(used);
        setPickHistory(history);
        setStandings(standingsData);

        try {
          const weekGames = await PoolService.getWeekGames(currentWeek);
          const locked = new Set<string>();
          const now = new Date();
          for (const game of weekGames) {
            const gameStart = game.game_time ? new Date(game.game_time) : null;
            const isLocked = game.status === 'live' || game.status === 'final' || (gameStart && gameStart <= now);
            if (isLocked) { locked.add(game.home_team); locked.add(game.away_team); }
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
      const result = await PoolService.submitSurvivorPick(activeLeagueId, user.id, currentWeek, selectedTeam);
      if (result.success) {
        toast({ title: 'Pick Locked In', description: `${selectedTeam} for Week ${currentWeek}.` });
        setUsedTeams([...usedTeams, selectedTeam]);
        setSelectedTeam(null);
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to submit pick', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to submit pick', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingScreen character="narwhal" message="Loading Survivor Pool..." />;

  return (
    <div className="min-h-screen bg-[#D4E8B8] relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">Survivor Pool</h1>
        </div>
      </div>

      <main className="w-full pt-16 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full px-3 sm:px-4 lg:px-6 xl:px-8">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Survivor Pool" description="Pick one team to win each week — get it wrong and you're out!" />
            </div>
          )}

          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="outline" className="text-sm font-varsity px-3 py-1">Week {currentWeek}</Badge>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentWeek(w => w + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              {isEliminated && <Badge variant="destructive" className="ml-2"><Skull className="w-3 h-3 mr-1" /> Eliminated</Badge>}
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList>
                <TabsTrigger value="pick">My Pick</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activeTab === 'pick' && (
            <>
              {isEliminated ? (
                <Card className="border-none shadow-lg max-w-xl mx-auto">
                  <CardContent className="py-16 text-center">
                    <Skull className="w-16 h-16 mx-auto mb-4 text-red-400 opacity-60" />
                    <h3 className="text-xl font-varsity font-bold mb-2 text-citrus-forest">You've Been Eliminated</h3>
                    <p className="text-muted-foreground">Better luck next season!</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Team grid with colors */}
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-11 gap-2 mb-4">
                    {NHL_TEAMS.map(team => {
                      const isUsed = usedTeams.includes(team);
                      const isLocked = lockedTeams.has(team);
                      const isDisabled = isUsed || isLocked;
                      const isSelected = selectedTeam === team;
                      const color = getTeamColor(team);

                      return (
                        <button
                          key={team}
                          className={`relative rounded-xl py-3 px-1 text-center font-varsity text-sm uppercase tracking-wide transition-all border-2 ${
                            isSelected ? 'text-white shadow-md scale-105'
                              : isUsed ? 'opacity-25 cursor-not-allowed line-through border-citrus-sage/10 bg-citrus-cream/30'
                              : isLocked ? 'opacity-40 cursor-not-allowed border-citrus-sage/10 bg-citrus-cream/30'
                              : 'border-citrus-sage/20 bg-white/60 hover:border-citrus-sage/40 hover:shadow-sm'
                          }`}
                          style={isSelected ? { background: color, borderColor: color } : {}}
                          disabled={isDisabled}
                          onClick={() => setSelectedTeam(isSelected ? null : team)}
                        >
                          {!isSelected && !isUsed && <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: color }} />}
                          <span className="font-bold">{team}</span>
                          {isLocked && !isUsed && <Lock className="w-2.5 h-2.5 absolute top-1 right-1 text-red-400" />}
                        </button>
                      );
                    })}
                  </div>

                  {usedTeams.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-display text-citrus-charcoal/50 mr-1">Used:</span>
                      {usedTeams.map(t => (
                        <Badge key={t} variant="outline" className="text-xs px-1.5 py-0 opacity-50">{t}</Badge>
                      ))}
                    </div>
                  )}

                  {/* Submit */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#D4E8B8]/95 backdrop-blur-sm border border-citrus-sage/20 rounded-xl py-3 px-4 flex items-center justify-between shadow-lg">
                    <span className="text-sm font-display text-citrus-charcoal/60">
                      {selectedTeam ? (
                        <span className="flex items-center gap-2">
                          Selected: <Badge style={{ background: getTeamColor(selectedTeam), color: '#fff', border: 'none' }}>{selectedTeam}</Badge>
                        </span>
                      ) : 'Tap a team to make your pick'}
                    </span>
                    <Button onClick={handleSubmitPick} disabled={!selectedTeam || submitting} className="font-varsity uppercase">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Lock In Pick
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'standings' && (
            <Card className="border-none shadow-lg overflow-hidden max-w-4xl mx-auto">
              <CardContent className="p-0">
                {standings.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Shield className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No standings yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="w-12 text-center">#</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-center hidden sm:table-cell">Lives</TableHead>
                          <TableHead className="text-center">Survived</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">Pick</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={s.user_id === user?.id ? 'bg-primary/5' : ''}>
                            <TableCell className="text-center">
                              <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-xs font-bold ${
                                !s.is_eliminated ? 'bg-green-500 text-white' : 'bg-red-400 text-white'
                              }`}>{i + 1}</span>
                            </TableCell>
                            <TableCell className="font-medium">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-xs">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center">
                              {s.is_eliminated
                                ? <Badge variant="destructive" className="text-xs"><Skull className="w-3 h-3 mr-0.5" /> Out</Badge>
                                : <Badge className="text-xs bg-green-500 border-0"><Heart className="w-3 h-3 mr-0.5" /> Alive</Badge>
                              }
                            </TableCell>
                            <TableCell className="text-center hidden sm:table-cell">
                              {Array.from({ length: s.lives_remaining }).map((_, j) => (
                                <Heart key={j} className="w-3.5 h-3.5 inline text-red-500 fill-red-500" />
                              ))}
                            </TableCell>
                            <TableCell className="text-center font-bold">{s.teams_used.length} wks</TableCell>
                            <TableCell className="text-right hidden sm:table-cell">
                              {s.current_pick ? (
                                <Badge variant="outline" className="text-xs font-varsity" style={{ borderColor: getTeamColor(s.current_pick), color: getTeamColor(s.current_pick) }}>
                                  {s.current_pick}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'history' && (
            <div className="max-w-2xl mx-auto">
              {pickHistory.length === 0 ? (
                <Card className="border-none shadow-lg">
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Shield className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No picks yet</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {pickHistory.map((pick) => {
                    const color = getTeamColor(pick.team);
                    return (
                      <div key={pick.week} className="flex items-center gap-3 p-3 rounded-xl bg-white/60 border border-citrus-sage/10">
                        <Badge variant="outline" className="text-xs font-display shrink-0">Wk {pick.week}</Badge>
                        <div className="flex items-center gap-2 flex-1">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                          <span className="font-varsity font-bold text-sm uppercase">{pick.team}</span>
                        </div>
                        {pick.is_correct === true && <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                        {pick.is_correct === false && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
                        {pick.is_correct === null && <span className="text-xs text-muted-foreground shrink-0">Pending</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <div className="hidden lg:block"><Footer /></div>
    </div>
  );
};

export default PoolSurvivor;
