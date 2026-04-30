import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { scheduleApi } from '@/api/schedule';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { format } from 'date-fns';
import { logger } from '@/utils/logger';
import { Navigate } from 'react-router-dom';
import {
  HockeyFooter,
  SlateIcon,
  ScoreboardIcon,
  ShiftIcon,
  MaskIcon,
  CrossedSticksIcon,
  PuckIcon,
  CupIcon,
} from '@/components/citrus2';
import { MASCOTS } from '@/constants/mascots';
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

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

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
      const todayStr = getTodayMST();
      const today = getTodayMSTDate();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = formatDateToString(nextWeek);

      const { data: games } = await scheduleApi.getGames({ startDate: todayStr, endDate: nextWeekStr }) as { data?: NhlGame[] };

      setNhlGames(games || []);

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

  // ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURN.
  // Game-density derived data — pure transform of nhlGames, no new API
  // calls; safe to compute even for pool leagues that early-return below.
  const teamGameCounts = useMemo(() => {
    const counts = new Map<string, { team: string; games: number; days: Set<string> }>();
    for (const g of nhlGames) {
      const dateKey = g.game_date.split('T')[0];
      for (const team of [g.home_team, g.away_team]) {
        if (!team) continue;
        const existing = counts.get(team) || { team, games: 0, days: new Set<string>() };
        existing.games += 1;
        existing.days.add(dateKey);
        counts.set(team, existing);
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.games - a.games);
  }, [nhlGames]);

  // Back-to-back detection — teams whose game dates contain two consecutive
  // calendar days. Returns the first such pair per team for display.
  const backToBacks = useMemo(() => {
    const byTeam = new Map<string, string[]>();
    for (const g of nhlGames) {
      const dateKey = g.game_date.split('T')[0];
      for (const team of [g.home_team, g.away_team]) {
        if (!team) continue;
        const arr = byTeam.get(team) || [];
        if (!arr.includes(dateKey)) arr.push(dateKey);
        byTeam.set(team, arr);
      }
    }
    const out: { team: string; from: string; to: string }[] = [];
    for (const [team, dates] of byTeam) {
      const sorted = dates.slice().sort();
      for (let i = 0; i < sorted.length - 1; i++) {
        const d1 = new Date(sorted[i] + 'T00:00:00');
        const d2 = new Date(sorted[i + 1] + 'T00:00:00');
        if ((d2.getTime() - d1.getTime()) === 86400000) {
          out.push({ team, from: sorted[i], to: sorted[i + 1] });
          break;
        }
      }
    }
    return out;
  }, [nhlGames]);

  // Per-day game counts (for the slate-density mini bar chart)
  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of nhlGames) {
      const d = new Date(g.game_date.split('T')[0] + 'T00:00:00');
      const key = DAY_KEYS[d.getDay()];
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [nhlGames]);

  // Redirect pool leagues to their pool page (must come AFTER all hooks).
  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  const maxDayCount = Math.max(1, ...Object.values(dayCounts));
  const maxTeamGames = Math.max(1, ...teamGameCounts.map(t => t.games));

  // Matchup data is loaded dynamically from Matchup/Standings pages.
  const upcomingMatchups: { week: string; opponent: string; date: string; status: string; projection: string }[] = [];
  const recentResults: { week: string; opponent: string; score: string; result: string }[] = [];
  const currentMatchup = upcomingMatchups[0];

  return (
    <div className="min-h-screen bg-pastel-surface text-pastel-cream flex flex-col relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-pastel-surface/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Schedule</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))] relative z-10">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">

              {/* Header band — view-mode toggle and small section title */}
              <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
                <div className="flex items-center gap-3">
                  <SlateIcon className="w-5 h-5 text-pastel-orange" strokeWidth={2} />
                  <div>
                    <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">
                      ✦ The Slate
                    </div>
                    <p className="text-sm text-white/55 mt-0.5">
                      {loading ? 'Pulling the schedule…' : `${nhlGames.length} NHL games over the next 7 days`}
                    </p>
                  </div>
                </div>

                {viewMode === 'summary' ? (
                  <Button
                    onClick={() => setViewMode('full')}
                    className="w-full md:w-auto bg-pastel-orange text-pastel-surface hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)] hover:shadow-[0_12px_32px_-8px_rgba(255,168,87,0.6)] transition-all"
                  >
                    Full slate view
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setViewMode('summary')}
                    className="w-full md:w-auto bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                  >
                    Back to summary
                  </Button>
                )}
              </div>

              {/* GAME DENSITY THIS WEEK — actual data viz, not a placeholder
                  list. Per-day bar chart up top, then a horizontal bar list
                  of top teams sorted by game count. */}
              <Card className="max-w-5xl mx-auto mb-6 bg-pastel-surface-tile border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                <CardHeader>
                  <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                    <ScoreboardIcon className="w-5 h-5 text-pastel-orange" strokeWidth={2} />
                    Game Density · This Week
                  </CardTitle>
                  <CardDescription className="text-white/55">
                    Where the volume is. Stack streamers on heavy days, plan benchings around the dead ones.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* 7-day mini bar chart */}
                  <div className="mb-6">
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-white/55 font-bold mb-3">
                      Games per day
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {DAY_KEYS.map(day => {
                        const count = dayCounts[day] || 0;
                        const heightPct = (count / maxDayCount) * 100;
                        const tone = count >= 8 ? 'bg-pastel-orange' : count >= 4 ? 'bg-pastel-sage-soft' : count >= 1 ? 'bg-white/30' : 'bg-white/10';
                        return (
                          <div key={day} className="flex flex-col items-center gap-1.5">
                            <div className="w-full h-20 flex items-end">
                              <div
                                className={`w-full rounded-t-md ${tone} transition-all`}
                                style={{ height: `${Math.max(heightPct, count > 0 ? 8 : 4)}%` }}
                                aria-label={`${day}: ${count} games`}
                              />
                            </div>
                            <div className="font-jbmono text-[9px] uppercase tracking-[0.18em] text-white/55 font-bold">{day}</div>
                            <div className="font-mono text-[11px] tabular-nums text-pastel-cream font-bold">{count}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Top-teams horizontal bar list */}
                  <div>
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-white/55 font-bold mb-3">
                      Most games scheduled
                    </div>
                    {teamGameCounts.length === 0 ? (
                      <div className="text-sm text-white/55 py-4 text-center">No games loaded yet.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {teamGameCounts.slice(0, 8).map(({ team, games }) => {
                          const widthPct = (games / maxTeamGames) * 100;
                          const tone = games >= 4 ? 'bg-pastel-orange/70' : games >= 3 ? 'bg-pastel-sage/70' : 'bg-white/20';
                          return (
                            <div key={team} className="flex items-center gap-3 group">
                              <div className="w-12 shrink-0 font-jbmono text-[11px] tabular-nums uppercase tracking-[0.18em] text-pastel-cream font-bold">
                                {team}
                              </div>
                              <div className="flex-1 h-5 bg-white/5 rounded-md overflow-hidden ring-1 ring-white/10">
                                <div
                                  className={`h-full ${tone} group-hover:brightness-125 transition-all`}
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                              <div className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-pastel-cream font-bold">
                                {games}<span className="text-white/40 ml-0.5 font-normal">G</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* BACK-TO-BACK WATCH — Pineapple (goalie) IS the icon. B2Bs
                  hit goalies hardest (they typically split starts), so the
                  card title and every b2b row is led by his canonical avatar.
                  Character is doing the icon job for the section he owns. */}
              <Card className="max-w-5xl mx-auto mb-6 bg-pastel-surface-tile border-0 ring-1 ring-amber-400/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(251,191,36,0.12)] relative overflow-hidden">
                <div aria-hidden="true" className="absolute -top-12 -right-12 w-44 h-44 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
                <CardHeader className="relative z-10">
                  <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                    <img
                      src={MASCOTS.pineapple.image}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover ring-2 ring-amber-400/40"
                      loading="lazy"
                    />
                    Back-to-Back Watch
                  </CardTitle>
                  <CardDescription className="text-white/55">
                    Teams playing consecutive nights. Goalies typically split, skaters often log fewer minutes.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10">
                  {backToBacks.length === 0 ? (
                    <div className="text-sm text-white/55 py-4 text-center">
                      {loading ? 'Scanning…' : 'No back-to-backs in this slate.'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {backToBacks.slice(0, 12).map(b2b => (
                        <div
                          key={`${b2b.team}-${b2b.from}`}
                          className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-400/10 ring-1 ring-amber-400/30"
                        >
                          <img
                            src={MASCOTS.pineapple.image}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover ring-1 ring-amber-400/40 shrink-0"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-jbmono text-[11px] tabular-nums uppercase tracking-[0.18em] text-pastel-cream font-bold">
                              {b2b.team}
                            </div>
                            <div className="font-mono text-[10px] text-amber-300 tabular-nums">
                              {format(new Date(b2b.from + 'T00:00:00'), 'MMM d')}
                              <span className="text-white/40 mx-1">→</span>
                              {format(new Date(b2b.to + 'T00:00:00'), 'MMM d')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* GAME LIST — the original schedule list, kept for the "I just
                  want to scroll the games" use case. Now treated as the
                  detail layer beneath the data viz cards. */}
              <Card className="max-w-5xl mx-auto mb-8 bg-pastel-surface-tile border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                <CardHeader>
                  <CardTitle className="font-calistoga text-xl text-pastel-cream flex items-center gap-2">
                    <PuckIcon className="w-5 h-5 text-pastel-orange" strokeWidth={2} />
                    Up Next
                  </CardTitle>
                  <CardDescription className="text-white/55">
                    {loading ? 'Loading schedule…' : `${nhlGames.length} games scheduled`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="text-center py-8 text-white/55">Loading games…</div>
                  ) : nhlGames.length > 0 ? (
                    <div className="space-y-2">
                      {nhlGames.slice(0, 10).map((game, idx) => (
                        <div key={game.id || idx} className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/[0.07] transition-colors rounded-xl ring-1 ring-white/10">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold px-2 py-0.5 shrink-0">
                                {format(new Date(game.game_date.split('T')[0] + 'T00:00:00'), 'MMM d')}
                              </Badge>
                              <div className="font-bold text-pastel-cream truncate flex items-center gap-2">
                                <span className="text-white/70 font-jbmono tabular-nums uppercase tracking-[0.18em]">{game.away_team}</span>
                                <span className="text-pastel-orange/60 mx-1" aria-hidden="true">@</span>
                                <span className="text-pastel-cream font-jbmono tabular-nums uppercase tracking-[0.18em]">{game.home_team}</span>
                              </div>
                            </div>
                            <div className="text-xs text-white/55 mt-1 ml-1 tabular-nums">
                              {game.game_time && format(new Date(game.game_time), 'h:mm a')}
                            </div>
                          </div>
                          <Badge variant="outline" className="font-jbmono text-[9px] uppercase tracking-[0.18em] bg-transparent border border-pastel-sage/40 text-pastel-sage-soft shrink-0">
                            {game.status || 'Scheduled'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-white/55">
                      No games scheduled this week
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Summary View */}
              {viewMode === 'summary' && (
                <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
                  <Card className="border-0 bg-pastel-surface-tile ring-1 ring-pastel-orange/20 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
                    <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 bg-pastel-orange/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                    <CardHeader className="relative z-10">
                      <CardTitle className="flex items-center gap-2 text-pastel-cream font-calistoga text-xl">
                        <CrossedSticksIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} />
                        Next Matchup
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="relative z-10">
                      {currentMatchup ? (
                        <div className="flex flex-col items-center justify-center py-6">
                          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">{currentMatchup.week}</div>
                          <div className="font-calistoga text-3xl text-pastel-cream mb-4">vs {currentMatchup.opponent}</div>
                          <div className="text-white/55 mb-6">{currentMatchup.date}</div>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-white/55">
                          Visit the Matchup page to see your next matchup details.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="space-y-6">
                    <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold">Current Record</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-center py-4 text-white/55">
                          Visit the Standings page to view your record.
                        </div>
                      </CardContent>
                    </Card>

                    {recentResults.length > 0 && (
                      <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold">
                            <CupIcon className="h-4 w-4 text-pastel-orange" strokeWidth={2} />
                            Last Result ({recentResults[0].week})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex justify-between items-center">
                            <div>
                              <div className="font-bold text-lg text-pastel-cream">vs {recentResults[0].opponent}</div>
                              <div className="text-sm text-white/55">{recentResults[0].score}</div>
                            </div>
                            <div className={`px-3 py-1 rounded-full font-jbmono text-[10px] uppercase tracking-[0.18em] font-bold ${recentResults[0].result === 'win' ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft' : 'bg-red-500/20 ring-1 ring-red-500/40 text-red-300'}`}>
                              {recentResults[0].result === 'win' ? 'Win' : 'Loss'}
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
                <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-xl text-pastel-cream">
                        <CrossedSticksIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} />
                        Upcoming Schedule
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {upcomingMatchups.length === 0 && (
                          <div className="text-center py-6 text-white/55 text-sm">
                            No upcoming matchups available — visit the Matchup page to see this week.
                          </div>
                        )}
                        {upcomingMatchups.map((matchup, index) => (
                          <div key={index} className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/[0.07] rounded-xl ring-1 ring-white/10 transition-colors">
                            <div className="flex items-center gap-4">
                              <CrossedSticksIcon className="h-5 w-5 text-pastel-orange shrink-0" strokeWidth={2} />
                              <div>
                                <div className="font-bold text-pastel-cream">{matchup.week}</div>
                                <div className="text-sm text-white/55">vs {matchup.opponent}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold text-pastel-cream tabular-nums">{matchup.projection}</div>
                              <div className="text-xs text-white/55">{matchup.date}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-xl text-pastel-cream">
                        <CupIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} />
                        Past Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {recentResults.length === 0 && (
                          <div className="text-center py-6 text-white/55 text-sm">
                            No past results yet — your finished weeks will appear here.
                          </div>
                        )}
                        {recentResults.map((result, index) => (
                          <div key={index} className="flex items-center justify-between p-4 bg-white/5 rounded-xl ring-1 ring-white/10">
                            <div className="flex items-center gap-4">
                              <div className={`w-1 h-12 rounded ${result.result === 'win' ? 'bg-pastel-sage' : 'bg-red-400'}`} />
                              <div>
                                <div className="font-bold text-pastel-cream">{result.week}</div>
                                <div className="text-sm text-white/55">vs {result.opponent}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-pastel-cream tabular-nums">{result.score}</div>
                              <div className={`text-xs font-jbmono uppercase tracking-[0.18em] font-bold ${result.result === 'win' ? 'text-pastel-sage-soft' : 'text-red-300'}`}>
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

            {/* Left Sidebar — AdSpace replaced with a Pineapple "tonight's
                slate" tile that summarizes today's heaviest game day. Real
                content where the rented ad slot used to be. */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                {/* Sleeper-style slate tile — function-first, no portrait.
                    Pineapple is now the icon for Back-to-Back Watch on the
                    main side, so the rail earns its space with real data. */}
                <div className="bg-pastel-surface-tile ring-1 ring-pastel-sage/30 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-3">
                    <SlateIcon className="w-4 h-4 text-pastel-sage-soft" strokeWidth={2} />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-sage-soft font-bold">This week's slate</div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Total games</span>
                      <span className="font-calistoga text-2xl text-pastel-cream tabular-nums leading-none">
                        {nhlGames.length}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Back-to-backs</span>
                      <span className="font-calistoga text-lg text-amber-300 tabular-nums leading-none">
                        {backToBacks.length}
                      </span>
                    </div>
                    <div className="h-px bg-white/10" />
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-white/55">Heaviest day</span>
                      <span className="font-jbmono text-[11px] text-pastel-orange tabular-nums font-bold">
                        {Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'}
                        <span className="text-white/40 ml-1">
                          ({Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[1] || 0})
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
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

export default ScheduleManager;
