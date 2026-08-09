import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { PoolService, SurvivorStanding } from '@/services/PoolService';
import { Loader2, Heart, Skull, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock, Check } from 'lucide-react';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { logger } from '@/utils/logger';
import { getTeamInfo, type NHLTeamInfo } from '@/types/captracker';
import { InvitePlayersButton } from '@/components/InvitePlayersButton';
import { PoolLeagueHub } from '@/components/PoolLeagueHub';
import {
  DarkLayout,
  HockeyFooter,
  StormyLoading,
  GlowCard,
  SurvivorIcon,
} from '@/components/citrus2';

const NHL_TEAMS = [
  'ANA','BOS','BUF','CGY','CAR','CHI','COL','CBJ','DAL','DET','EDM','FLA',
  'LAK','MIN','MTL','NSH','NJD','NYI','NYR','OTT','PHI','PIT','SJS','SEA',
  'STL','TBL','TOR','UTA','VAN','VGK','WPG','WSH',
];

function getInfo(abbrev: string): NHLTeamInfo {
  return getTeamInfo(abbrev) || { abbrev, name: abbrev, fullName: abbrev, conference: 'Eastern' as const, division: '', primaryColor: '#666', secondaryColor: '#999', logoUrl: '' };
}

const PoolSurvivor = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, activeLeague } = useLeague();
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
  const [records, setRecords] = useState<Record<string, { w: number; l: number; otl: number }>>({});
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
        setIsEliminated(eliminated); setUsedTeams(used); setPickHistory(history); setStandings(standingsData);
        try {
          const weekGames = await PoolService.getWeekGames(currentWeek);
          const locked = new Set<string>();
          const now = new Date();
          for (const g of weekGames) {
            const t = g.game_time ? new Date(g.game_time) : null;
            if (g.status === 'live' || g.status === 'final' || (t && t <= now)) { locked.add(g.home_team); locked.add(g.away_team); }
          }
          setLockedTeams(locked);
        } catch { /* non-critical */ }
        // Fetch team records
        try {
          const { records: tr } = await PoolService.getTeamRecordsAndH2H();
          setRecords(tr);
        } catch { /* supplementary */ }
      } catch (err) { logger.error('[PoolSurvivor] Error:', err); } finally { setLoading(false); }
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
        setUsedTeams([...usedTeams, selectedTeam]); setSelectedTeam(null);
      } else { toast({ title: "Pick Didn't Submit", description: result.error || "Couldn't submit your pick — try again in a moment.", variant: 'destructive' }); }
    } catch { toast({ title: "Pick Didn't Submit", description: "Couldn't reach the pool server — try again in a moment.", variant: 'destructive' }); }
    finally { setSubmitting(false); }
  };

  if (loading) return (
    <DarkLayout>
      <Navbar />
      <StormyLoading message="Loading Survivor Pool..." />
    </DarkLayout>
  );

  return (
    <DarkLayout>
      <Navbar />

      <main className="w-full pt-20 lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="flex lg:gap-0">
        <div className="flex-1 min-w-0 px-3 sm:px-4 lg:px-8 xl:px-12">
          {userLeagueState === 'logged-in-no-league' && (
            <div className="mb-8 max-w-3xl mx-auto">
              <LeagueCreationCTA title="Join a Survivor Pool" description="Pick one team to win each week — get it wrong and you're out!" />
            </div>
          )}

          {/* Hero banner — mascot acting in domain */}
          <div className="relative mb-6 mt-4 w-full aspect-[21/9] sm:aspect-[24/9] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
            <img
              src="/mascots/scene-survivor.webp"
              alt="Kiwi alone in the spotlight, last one standing"
              className="w-full h-full object-cover"
              loading="eager"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(15,31,21,0.85) 0%, transparent 45%)' }}
            />
            <div className="absolute bottom-4 left-5 sm:bottom-6 sm:left-8 z-10 max-w-[80%]">
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-1.5 font-bold flex items-center gap-2">
                <SurvivorIcon className="w-3 h-3" /> Survivor Pool
              </div>
              <h1 className="font-sans font-black text-[1.5rem] sm:text-[2rem] md:text-[2.5rem] tracking-[-0.025em] text-pastel-cream leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                One pick a week. <span className="text-pastel-orange">Don't lose.</span>
              </h1>
            </div>
          </div>

          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5 sticky top-[92px] z-30 bg-[#0F1F15]/95 backdrop-blur-md py-2 -mx-3 sm:-mx-4 lg:-mx-8 xl:-mx-12 px-3 sm:px-4 lg:px-8 xl:px-12 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#1A2A20] rounded-md ring-1 ring-white/10 overflow-hidden">
                <Button variant="ghost" size="icon" aria-label="Previous week" className="h-8 w-8 rounded-none text-pastel-cream hover:text-pastel-orange hover:bg-white/5" onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} disabled={currentWeek <= 1}>
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <div className="px-3 text-center border-x border-white/10">
                  <div className="text-[9px] font-jbmono text-white/45 uppercase tracking-widest leading-none">Week</div>
                  <div className="text-base font-bold text-pastel-cream leading-none tabular-nums">{currentWeek}</div>
                </div>
                <Button variant="ghost" size="icon" aria-label="Next week" className="h-8 w-8 rounded-none text-pastel-cream hover:text-pastel-orange hover:bg-white/5" onClick={() => setCurrentWeek(w => w + 1)}>
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
              {isEliminated && (
                <Badge className="ml-2 bg-red-500/20 text-red-300 border border-red-500/40 font-jbmono text-[10px] uppercase tracking-wider">
                  <Skull className="w-3 h-3 mr-1" aria-hidden="true" /> Eliminated
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeLeague?.join_code && (
                <InvitePlayersButton joinCode={activeLeague.join_code} leagueName={activeLeague.name} />
              )}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                <TabsList className="bg-[#1A2A20] h-9 ring-1 ring-white/10">
                  <TabsTrigger value="pick" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">My Pick</TabsTrigger>
                  <TabsTrigger value="standings" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">Standings</TabsTrigger>
                  <TabsTrigger value="history" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">History</TabsTrigger>
                  <TabsTrigger value="league" className="text-xs sm:text-sm px-2 sm:px-3 data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] text-white/70">League</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* ── Pick tab ── */}
          {activeTab === 'pick' && (
            <>
              {isEliminated ? (
                <GlowCard accent="orange" className="max-w-xl mx-auto">
                  <div className="py-16 text-center">
                    <Skull className="w-16 h-16 mx-auto mb-4 text-red-400/60" aria-hidden="true" />
                    <h3 className="font-sans font-black text-[1.75rem] tracking-[-0.025em] text-pastel-cream mb-2">
                      You've been <span className="text-pastel-orange">eliminated</span>.
                    </h3>
                    <p className="text-[14px] text-white/55">Better luck next season — the Squad's still on the bench.</p>
                  </div>
                </GlowCard>
              ) : (
                <>
                  {/* Team monogram grid */}
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-8 xl:grid-cols-11 gap-2.5 mb-4">
                    {NHL_TEAMS.map(team => {
                      const isUsed = usedTeams.includes(team);
                      const isLocked = lockedTeams.has(team);
                      const isDisabled = isUsed || isLocked;
                      const isSelected = selectedTeam === team;
                      const info = getInfo(team);

                      return (
                        <button
                          key={team}
                          className={`relative rounded-xl flex flex-col items-center justify-center py-3 gap-1 transition-all duration-200 ring-1 ${
                            isSelected ? 'scale-105 text-white ring-2 ring-white/40 shadow-[0_8px_24px_-12px_rgba(255,107,26,0.5)]'
                            : isUsed ? 'opacity-25 cursor-not-allowed grayscale ring-white/10 bg-white/5'
                            : isLocked ? 'opacity-40 cursor-not-allowed ring-white/10 bg-white/5'
                            : 'bg-[#1A2A20] ring-white/10 hover:ring-pastel-orange/50 hover:scale-[1.02] hover:shadow-[0_8px_24px_-12px_rgba(255,107,26,0.3)]'
                          }`}
                          style={isSelected ? {
                            background: info.primaryColor,
                            borderColor: info.secondaryColor,
                          } : {}}
                          disabled={isDisabled}
                          onClick={() => setSelectedTeam(isSelected ? null : team)}
                        >
                          {/* Monogram */}
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs tracking-wide shadow-sm ${
                              isSelected ? 'bg-white/20 text-white' : isUsed ? 'bg-white/10 text-white/30' : 'text-white'
                            }`}
                            style={!isSelected && !isUsed ? { background: info.primaryColor } : {}}
                          >
                            {team}
                          </div>
                          {/* Team name + record */}
                          <span className={`text-[10px] font-bold leading-tight ${
                            isSelected ? 'text-white/95' : isUsed ? 'text-white/30 line-through' : 'text-pastel-cream'
                          }`}>
                            {info.name}
                          </span>
                          {records[team] && !isUsed && (
                            <span className={`text-[8px] font-jbmono leading-none tabular-nums ${
                              isSelected ? 'text-white/65' : 'text-white/45'
                            }`}>
                              {records[team].w}-{records[team].l}-{records[team].otl}
                            </span>
                          )}
                          {isLocked && !isUsed && <Lock className="w-3 h-3 absolute top-1 right-1 text-red-400" aria-hidden="true" />}
                          {isSelected && <Check className="w-3.5 h-3.5 absolute top-1 right-1 text-white" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Used teams chips */}
                  {usedTeams.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      <span className="font-jbmono text-[10px] uppercase tracking-wider text-white/45 mr-1">Previously used:</span>
                      {usedTeams.map(t => {
                        const info = getInfo(t);
                        return (
                          <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-white/5 ring-1 ring-white/10 text-white/55">
                            <span className="w-2 h-2 rounded-full" style={{ background: info.primaryColor }} />
                            {t}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Submit bar */}
                  <div className="sticky bottom-20 lg:bottom-4 bg-[#1A2A20]/95 backdrop-blur-md ring-1 ring-pastel-orange/30 rounded-2xl py-3 px-4 flex items-center justify-between shadow-[0_24px_60px_-20px_rgba(255,107,26,0.4)]">
                    <span className="text-[13px] text-pastel-cream">
                      {selectedTeam ? (
                        <span className="flex items-center gap-2">
                          <span className="font-jbmono text-[10px] uppercase tracking-wider text-white/55">Selected:</span>
                          <span className="inline-flex items-center gap-1.5 font-bold text-white px-2.5 py-0.5 rounded-md text-xs"
                            style={{ background: getInfo(selectedTeam).primaryColor }}>
                            {selectedTeam} {getInfo(selectedTeam).name}
                          </span>
                        </span>
                      ) : <span className="text-white/55">Tap a team to make your pick</span>}
                    </span>
                    <Button onClick={handleSubmitPick} disabled={!selectedTeam || submitting} className="font-bold uppercase tracking-wider bg-pastel-orange hover:bg-pastel-orange-soft text-white border-0 active:scale-95 transition-all">
                      {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                      Lock In Pick
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Standings tab ── */}
          {activeTab === 'standings' && (
            <GlowCard accent="orange" className="max-w-4xl mx-auto">
              <div>
                {standings.length === 0 ? (
                  <div className="text-center py-16">
                    <SurvivorIcon className="w-12 h-12 mx-auto mb-4 text-pastel-orange-soft/60" />
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">
                      ✦ Everyone's still alive
                    </div>
                    <p className="font-bold text-pastel-cream text-base">Standings light up after the first slate wraps.</p>
                    <p className="text-[13px] text-white/55 mt-1 max-w-sm mx-auto">Lock in your team before puck drops — one wrong pick and you're out.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-black/20 border-white/10 hover:bg-black/20">
                          <TableHead className="w-12 text-center text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">#</TableHead>
                          <TableHead className="text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Player</TableHead>
                          <TableHead className="text-center text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Status</TableHead>
                          <TableHead className="text-center hidden sm:table-cell text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Lives</TableHead>
                          <TableHead className="text-center text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Survived</TableHead>
                          <TableHead className="text-right hidden sm:table-cell text-pastel-orange-soft font-jbmono uppercase text-[10px] tracking-wider">Pick</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {standings.map((s, i) => (
                          <TableRow key={s.user_id} className={`border-white/5 hover:bg-white/5 transition-colors ${s.user_id === user?.id ? 'bg-pastel-orange/10' : ''}`}>
                            <TableCell className="text-center">
                              <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${
                                !s.is_eliminated ? 'bg-pastel-sage text-[#0F1F15]' : 'bg-red-500/30 text-red-300'
                              }`}>{i + 1}</span>
                            </TableCell>
                            <TableCell className="font-bold text-pastel-cream">
                              {s.display_name}
                              {s.user_id === user?.id && <Badge variant="outline" className="ml-2 text-[9px] font-jbmono uppercase tracking-wider border-pastel-orange text-pastel-orange-soft">YOU</Badge>}
                            </TableCell>
                            <TableCell className="text-center">
                              {s.is_eliminated
                                ? <Badge className="text-[10px] bg-red-500/20 text-red-300 border border-red-500/40 font-jbmono uppercase tracking-wider"><Skull className="w-3 h-3 mr-0.5" aria-hidden="true" /> Out</Badge>
                                : <Badge className="text-[10px] bg-pastel-sage/20 text-pastel-sage-soft border border-pastel-sage/40 font-jbmono uppercase tracking-wider"><Heart className="w-3 h-3 mr-0.5" aria-hidden="true" /> Alive</Badge>}
                            </TableCell>
                            <TableCell className="text-center hidden sm:table-cell">
                              {Array.from({ length: s.lives_remaining }).map((_, j) => (
                                <Heart key={j} className="w-3.5 h-3.5 inline text-pastel-orange fill-pastel-orange" />
                              ))}
                            </TableCell>
                            <TableCell className="text-center font-bold text-pastel-cream tabular-nums">{s.teams_used.length} wks</TableCell>
                            <TableCell className="text-right hidden sm:table-cell">
                              {s.current_pick ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md text-white"
                                  style={{ background: getInfo(s.current_pick).primaryColor }}>
                                  {s.current_pick}
                                </span>
                              ) : <span className="text-white/30">-</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </GlowCard>
          )}

          {/* ── History tab ── */}
          {activeTab === 'history' && (
            <div className="max-w-2xl mx-auto">
              {pickHistory.length === 0 ? (
                <GlowCard accent="orange">
                  <div className="py-16 text-center">
                    <SurvivorIcon className="w-12 h-12 mx-auto mb-4 text-pastel-orange-soft/60" />
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">
                      ✦ Ready when you are
                    </div>
                    <p className="font-bold text-pastel-cream text-base">Your pick history is empty.</p>
                    <p className="text-[13px] text-white/55 mt-1 max-w-sm mx-auto">Head to the Picks tab and lock in this week's team — every choice you make lands here.</p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('picks')}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-pastel-orange text-[#581E00] text-sm font-bold hover:bg-pastel-orange-soft transition-colors"
                    >
                      Make your pick →
                    </button>
                  </div>
                </GlowCard>
              ) : (
                <div className="space-y-2">
                  {pickHistory.map((pick) => {
                    const info = getInfo(pick.team);
                    const ringClass = pick.is_correct === true ? 'ring-pastel-sage/40' : pick.is_correct === false ? 'ring-red-500/40' : 'ring-white/10';
                    return (
                      <div key={pick.week} className={`flex items-center gap-3 p-3 rounded-xl bg-[#1A2A20] ring-1 ${ringClass} hover:ring-pastel-orange/40 transition-all`}>
                        <Badge variant="outline" className="text-[10px] font-jbmono shrink-0 w-14 justify-center border-white/15 text-white/55 uppercase tracking-wider">Wk {pick.week}</Badge>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white shadow-sm shrink-0"
                          style={{ background: info.primaryColor }}>
                          {pick.team}
                        </div>
                        <span className="font-bold text-sm text-pastel-cream flex-1">{info.fullName}</span>
                        {pick.is_correct === true && <CheckCircle2 className="w-5 h-5 text-pastel-sage shrink-0" aria-hidden="true" />}
                        {pick.is_correct === false && <XCircle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />}
                        {pick.is_correct === null && <span className="font-jbmono text-[10px] uppercase tracking-wider text-white/45 shrink-0">Pending</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── League tab ── */}
          {activeTab === 'league' && activeLeague && (
            <PoolLeagueHub leagueId={activeLeagueId!} league={activeLeague as any} />
          )}
        </div>

        {/* Chat sidebar — pinned to right edge */}
        {activeLeagueId && (
          <div className="hidden lg:block w-72 xl:w-80 shrink-0 border-l border-white/5 bg-black/20">
            <div className="sticky top-24 h-[calc(100vh-6rem)] flex flex-col">
              <LeagueNotifications leagueId={activeLeagueId} />
            </div>
          </div>
        )}
        </div>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
};

export default PoolSurvivor;
