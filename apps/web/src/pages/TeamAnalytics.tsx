import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi } from '@/api/leagues';
import Navbar from '@/components/Navbar';
import { PressBoxLeagueChrome } from '@/components/pressbox/LeagueChrome';
import { Narwhal } from '@/components/icons/Narwhal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, Shield } from 'lucide-react';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService } from '@/services/LeagueService';
import { ScheduleService } from '@/services/ScheduleService';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { ProjectedVsActual } from '@/components/analytics/ProjectedVsActual';
import type { CategoryKey, CategoryPair } from '@/utils/teamAnalytics';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { logger } from '@/utils/logger';
import { Navigate, Link } from 'react-router-dom';
import {
  HockeyFooter,
  XGModelIcon,
  ScoreboardIcon,
  RangeIcon,
} from '@/components/citrus2';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

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

  // Projected vs actual for the user's own team. Kept in its own request and
  // its own state: it is the substance of this page, and it must not be held
  // hostage by the free-agent lookup below, which talks to a different set of
  // tables and fails independently.
  const [analytics, setAnalytics] = useState<{
    totals: Partial<Record<CategoryKey, CategoryPair>>;
    players: Array<{
      id: string | number; name: string; position: string;
      projectedPoints: number; actualPoints: number; games: number;
    }>;
    measuredPlayers: number;
    rosterSize: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isGuestMode(userLeagueState) || !activeLeagueId || !user) {
        setAnalytics(null);
        return;
      }
      try {
        const { team } = await LeagueService.getUserTeam(activeLeagueId, user.id);
        if (!team?.id || cancelled) return;
        const res = await leagueApi.getTeamAnalytics(activeLeagueId, String(team.id));
        if (!cancelled && res?.data) setAnalytics(res.data as typeof analytics);
      } catch (err) {
        // Non-fatal: the rest of the page still has something to say.
        logger.error('[TeamAnalytics] projected-vs-actual load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user, userLeagueState, activeLeagueId]);

  const loadScheduleMaximizers = useCallback(async () => {
    try {
      setLoading(true);

      if (isGuestMode(userLeagueState)) {
        try {
          const allPlayers = await PlayerService.getAllPlayers();
          const topPlayers = [...allPlayers]
            .sort((a, b) => (b.points || 0) - (a.points || 0))
            .slice(0, 10);

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

      let currentLeagueId: string | undefined = activeLeagueId || undefined;

      if (!currentLeagueId && user) {
        try {
          const { data: leagues } = await leagueApi.getUserLeagues();

          if (leagues && Array.isArray(leagues) && leagues.length > 0) {
            currentLeagueId = leagues[0].id;
          }
        } catch (error) {
          logger.error('Error fetching user leagues:', error);
        }
      }

      const allPlayers = await PlayerService.getAllPlayers();
      const { players: freeAgents } = await LeagueService.getFreeAgents(allPlayers, currentLeagueId, user.id);

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

  const _poolType = activeLeagueFormat?.leagueType;
  if (isPoolLeague(_poolType) && activeLeagueId) {
    return <Navigate to={getPoolRoute(_poolType!, activeLeagueId)} replace />;
  }

  /*
   * THE FABRICATED ROSTER DEEP-DIVE LIVED HERE UNTIL 2026-08-26.
   *
   * A `positionalAnalysis` literal: Centers A+ / 98 / 14.2 avg / league rank 1,
   * Wingers B, Defense A-, Goalies C-, each with a six-week sparkline, a
   * five-axis radar, hand-written strengths, weaknesses and a "Stormy's
   * Suggestion". Identical for every team in every league, forever. A
   * "Preview · live after opening night" chip covered the section heading and
   * nothing else — the 92.4/100 Team Rating, the sidebar radar, the "Your
   * goalie grade is C-" alert and the "Lemon says" tile all sat outside it.
   *
   * It is not rebuilt here. The Roster page's Trends & Analytics tab now
   * computes the same thing for real — per-game production against stated
   * per-position baselines, in utils/teamGrades.ts, with tests — and two
   * grades for one roster is one grade too many. This page keeps what it
   * always did honestly: the schedule-and-free-agent work below, which is
   * computed from real rosters and the real NHL schedule.
   */


  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col relative">
      <div className="hidden lg:block"><Navbar /></div>
      {/* PRESS BOX (2026-09-04): the league chrome — header, sub-tabs and
          the league menu — replaces the 09-01 title bar and its hamburger,
          which opened the old menu sheet. One menu in the app. */}
      <PressBoxLeagueChrome />
      <main className="w-full lg:pt-24 lg:pb-8 pb-app-chrome">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">

              {/* Header band */}
              <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
                    <XGModelIcon className="w-3.5 h-3.5" strokeWidth={2} />
                    ✦ Stormy Analytics
                  </div>
                  {/* Was "Roster Deep-Dive / AI-Powered Roster Optimization"
                      over a page whose deep-dive was a literal. What this page
                      actually does — and did honestly all along — is find free
                      agents whose teams play the most games this week. */}
                  <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none mb-2">
                    Team Analytics
                  </h1>
                  <p className="text-sm text-white/55 flex items-center gap-2">
                    <Narwhal className="h-4 w-4 text-pastel-orange" />
                    How your roster is tracking, and who to add next
                  </p>
                </div>
                {/* A "Team Rating 92.4 / 100" card stood here — a literal, on every
                    team, with no disclaimer. Removed 2026-08-26. */}
              </div>

              {isGuestMode(userLeagueState) && (
                <div className="mb-6 max-w-5xl mx-auto">
                  <LeagueCreationCTA
                    title="You're viewing demo analytics"
                    description="Sign up to see analytics for your own team."
                    variant="compact"
                  />
                </div>
              )}

              <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-6">
                {/* Where the fabricated Positional Deep-Dive used to be. The
                    real version of this — per-position production measured
                    against stated baselines — now lives on the Roster page and
                    is computed from the user's actual roster. */}
                <div className="lg:col-span-2 space-y-4">
                  {/* The page's actual substance. Where the fabricated
                      "Positional Deep-Dive" used to be — four hardcoded letter
                      grades identical for every team — and then, after that was
                      removed, a card whose whole content was a link to a
                      different page. This is computed from the user's own
                      roster: its season projection against what it produced. */}
                  {analytics && analytics.measuredPlayers > 0 && (
                    <>
                      <ProjectedVsActual
                        totals={analytics.totals}
                        players={analytics.players}
                      />
                      <p className="text-[10px] text-white/55 px-1">
                        Measured across {analytics.measuredPlayers} of {analytics.rosterSize} rostered
                        players. Those with both a season projection and games played.
                      </p>
                    </>
                  )}
                  {/* Was a section heading over a full-width card whose entire
                      content was a paragraph explaining that the real thing is on
                      another page. A signpost is not a section: it took the same
                      visual weight as the projected-vs-actual chart above it while
                      carrying none of the information, and on a phone it cost a
                      whole thumb-swipe to say "look elsewhere". Demoted to the one
                      line it always was. */}
                  <Link
                    to="/roster"
                    className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/10 transition-colors hover:bg-white/[0.06]"
                  >
                    <ScoreboardIcon className="h-4 w-4 shrink-0 text-pastel-orange" strokeWidth={2} />
                    <span className="min-w-0 flex-1 text-[13px] text-white/70">
                      Positional grades: offense, peripherals, goaltending and depth
                      <span className="text-white/55"> · on the Roster page</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/55" strokeWidth={2.5} />
                  </Link>
                </div>

                {/* Right Column: AI Recommended Targets */}
                <div className="space-y-4">
                  <h2 className="font-calistoga text-2xl text-pastel-cream flex items-center gap-2">
                    <RangeIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} />
                    Free agents worth a look
                  </h2>

                  {/* 2026-08-27 sweep: this card wore ring-amber-400/30, an
                      amber blur and an amber title — a fourth accent that exists
                      nowhere in the Citrus palette, on a page whose every other
                      surface is sage and orange on deep forest. Worse, amber is
                      the STATUS vocabulary's caution colour; spending it on a
                      routine list of available goalies means a real warning has
                      nothing left to say. It is a list, so it looks like its
                      sibling list. The blur went with it. */}
                  <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
                    <CardHeader className="relative z-10">
                      {/* Headed "Urgent: Goaltending" with the line "Your goalie
                          grade is C-. Improving this position is the #1 priority to
                          increase win probability." — a personalised diagnosis of a
                          roster nothing on this page had looked at. The list below
                          it is real: available goalies, ranked. Removed 2026-08-26. */}
                      <CardTitle className="font-calistoga text-lg text-pastel-cream flex items-center gap-2">
                        <Shield className="h-4 w-4 text-pastel-sage" /> Goalies on the wire
                      </CardTitle>
                      <CardDescription className="text-white/55">
                        Available goalies, by points per game and games this week.
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
                              <Button size="sm" className="h-7 text-xs bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shrink-0">Claim</Button>
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
                        <div className="text-center py-4 text-sm text-white/55">Nobody on the wire has three games this week.</div>
                      ) : (
                        <>
                          {freeAgentTargets.filter(p => p.position !== 'G' && p.gamesThisWeek >= 3).slice(0, 5).map(player => (
                            <div key={player.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/[0.07] transition-colors group cursor-pointer ring-1 ring-white/10">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-pastel-orange/20 ring-1 ring-pastel-orange/30 flex items-center justify-center font-bold text-[10px] text-pastel-orange-soft shrink-0">
                                  {player.team.substring(0, 2)}
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
                                  <ScoreboardIcon className="h-3 w-3" strokeWidth={2} /> {player.gamesThisWeek} Gms
                                </div>
                                <div className="text-[10px] text-white/55 tabular-nums">{player.pointsPerGame.toFixed(1)} Pts/Gm</div>
                              </div>
                            </div>
                          ))}
                          {/* SPA NAV (2026-09-01): was a full page reload —
                              a several-second white flash in the iOS shell
                              for an in-app route. Router link instead. */}
                          <Button asChild variant="ghost" className="w-full text-xs text-pastel-orange hover:text-pastel-orange-soft hover:bg-white/5 mt-2 font-jbmono uppercase tracking-[0.22em]">
                            <Link to="/free-agents?tab=schedule">
                              View All Schedule Trends <ChevronRight className="h-3 w-3 ml-1" />
                            </Link>
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>

            {/* Left Sidebar — AdSpace replaced with team-strength radar tile +
                a Lemon "studying tape" peek. Real visualization where the
                rented ad slot used to be. */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                {/* Two tiles stood here and both were invented:
                     - a "Team-strength radar" whose team shape was the constant
                       {score:92, volume:86, consistency:78, streak:80,
                       schedule:74} and whose "league avg" was a flat 60 on every
                       axis, with a legend telling the user which was which;
                     - a "Lemon says" tile reading "Goalie's a 35/100 streak — the
                       matchup model wants a swap", citing a model that was never
                       run.
                    Removed 2026-08-26. Real team shape is on the Roster page. */}
              </div>
            </aside>

            {/* Right Sidebar - Notifications */}
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
      <HockeyFooter variant="app" />
    </div>
  );
};

export default TeamAnalytics;
