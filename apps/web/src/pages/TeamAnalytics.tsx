import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi } from '@/api/leagues';
import Navbar from '@/components/Navbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { Narwhal } from '@/components/icons/Narwhal';
import { PlayerService, Player } from '@/services/PlayerService';
import { LeagueService } from '@/services/LeagueService';
import { ScheduleService } from '@/services/ScheduleService';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { logger } from '@/utils/logger';
import { Navigate } from 'react-router-dom';
import {
  HockeyFooter,
  XGModelIcon,
  CrossedSticksIcon,
  PuckIcon,
  MaskIcon,
  NetIcon,
  ScoreboardIcon,
  RangeIcon,
  MascotAvatar,
  MascotPeek,
} from '@/components/citrus2';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

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
  /** Six-week sparkline trend (mock until real data wired) */
  trend: number[];
  /** 5-axis radar values 0..100 — Score, Volume, Consistency, Streak, Schedule */
  radar: { score: number; volume: number; consistency: number; streak: number; schedule: number };
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

/**
 * Inline 5-axis radar chart — pure SVG, no chart library. Renders the team's
 * profile (filled pastel-orange polygon) over a faint league-avg shape (cream
 * outline). Position-card-sized, ~120px square.
 */
function PositionRadar({ values, leagueAvg = 60 }: { values: PositionStats['radar']; leagueAvg?: number }) {
  const labels = [
    { key: 'score', short: 'PTS' },
    { key: 'volume', short: 'VOL' },
    { key: 'consistency', short: 'CON' },
    { key: 'streak', short: 'STK' },
    { key: 'schedule', short: 'SCH' },
  ] as const;
  const cx = 60;
  const cy = 60;
  const radius = 48;
  // Compute points around a regular pentagon
  const angleFor = (i: number) => (Math.PI * 2 * i) / labels.length - Math.PI / 2;
  const teamPoints = labels
    .map((l, i) => {
      const v = values[l.key];
      const r = (v / 100) * radius;
      const x = cx + r * Math.cos(angleFor(i));
      const y = cy + r * Math.sin(angleFor(i));
      return `${x},${y}`;
    })
    .join(' ');
  const avgPoints = labels
    .map((_, i) => {
      const r = (leagueAvg / 100) * radius;
      const x = cx + r * Math.cos(angleFor(i));
      const y = cy + r * Math.sin(angleFor(i));
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" className="shrink-0" aria-hidden="true">
      {/* Concentric reference rings */}
      {[0.33, 0.66, 1].map((s, i) => (
        <polygon
          key={i}
          points={labels
            .map((_, idx) => {
              const r = s * radius;
              const x = cx + r * Math.cos(angleFor(idx));
              const y = cy + r * Math.sin(angleFor(idx));
              return `${x},${y}`;
            })
            .join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}
      {/* Spokes */}
      {labels.map((_, i) => {
        const x = cx + radius * Math.cos(angleFor(i));
        const y = cy + radius * Math.sin(angleFor(i));
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
      })}
      {/* League avg outline */}
      <polygon
        points={avgPoints}
        fill="rgba(255,234,205,0.05)"
        stroke="rgba(255,234,205,0.45)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      {/* Team polygon */}
      <polygon
        points={teamPoints}
        fill="rgba(255,168,87,0.30)"
        stroke="#FFA857"
        strokeWidth="1.5"
      />
      {/* Labels */}
      {labels.map((l, i) => {
        const r = radius + 10;
        const x = cx + r * Math.cos(angleFor(i));
        const y = cy + r * Math.sin(angleFor(i));
        return (
          <text
            key={l.key}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize="7"
            fontWeight="700"
            fill="rgba(255,255,255,0.55)"
            letterSpacing="1.5"
          >
            {l.short}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Inline 6-week sparkline — pure SVG. Shows trajectory color-coded by trend
 * direction (sage = up, red-300 = down, white/55 = flat).
 */
function Sparkline({ values, height = 32 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const w = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const step = w / (values.length - 1);
  const path = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  // Trend tone: compare last value to first
  const delta = values[values.length - 1] - values[0];
  const stroke = delta > 1 ? '#A6D3A0' : delta < -1 ? '#FCA5A5' : 'rgba(255,255,255,0.45)';
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} className="shrink-0" aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle
        cx={(values.length - 1) * step}
        cy={height - ((values[values.length - 1] - min) / range) * (height - 4) - 2}
        r="2.25"
        fill={stroke}
      />
    </svg>
  );
}

const POSITION_ICONS: Record<string, React.ElementType> = {
  Centers: CrossedSticksIcon,
  Wingers: PuckIcon,
  Defense: NetIcon,
  Goalies: MaskIcon,
};

const TeamAnalytics = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId, isChangingLeague, activeLeagueFormat } = useLeague();
  const [freeAgentTargets, setFreeAgentTargets] = useState<FreeAgentRec[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Mock Analysis Data — augmented with sparkline trend and 5-axis radar so
  // each positional card actually shows real visualization rather than just
  // a single Progress bar. Real data plumbs in via a future analytics API.
  const positionalAnalysis: PositionStats[] = [
    {
      position: "Centers",
      grade: "A+",
      score: 98,
      avgPoints: 14.2,
      leagueRank: 1,
      description: "Elite production. Top-line center duo provides an unmatched floor and ceiling.",
      strengths: ["Scoring", "Assists", "Consistency"],
      weaknesses: [],
      suggestion: "Hold steady. No improvements needed.",
      trend: [11.2, 12.8, 12.4, 13.5, 14.0, 14.2],
      radar: { score: 96, volume: 92, consistency: 88, streak: 90, schedule: 82 },
    },
    {
      position: "Wingers",
      grade: "B",
      score: 82,
      avgPoints: 8.5,
      leagueRank: 5,
      description: "Solid but inconsistent. Top-line wing carrying load, secondary scoring lacking.",
      strengths: ["Goal Scoring"],
      weaknesses: ["Assists", "+/-"],
      suggestion: "Look for a playmaking winger on waivers to balance the scoring dependence.",
      trend: [9.4, 8.8, 7.9, 9.1, 8.2, 8.5],
      radar: { score: 78, volume: 80, consistency: 60, streak: 55, schedule: 78 },
    },
    {
      position: "Defense",
      grade: "A-",
      score: 91,
      avgPoints: 9.8,
      leagueRank: 2,
      description: "Very strong top pair. Top-pair right-shot performing like a top-5 option.",
      strengths: ["Power Play Points", "Blocks"],
      weaknesses: ["Depth"],
      suggestion: "Consider streaming a 4th defenseman for off-nights.",
      trend: [8.1, 8.7, 9.2, 9.0, 9.6, 9.8],
      radar: { score: 88, volume: 84, consistency: 86, streak: 92, schedule: 70 },
    },
    {
      position: "Goalies",
      grade: "C-",
      score: 72,
      avgPoints: 4.1,
      leagueRank: 9,
      description: "Underperforming significantly. Starter has been volatile.",
      strengths: ["Saves"],
      weaknesses: ["GAA", "Wins"],
      suggestion: "Urgent upgrade recommended. Target a starter on a defensive team.",
      trend: [5.8, 5.2, 4.8, 4.3, 3.9, 4.1],
      radar: { score: 58, volume: 70, consistency: 42, streak: 35, schedule: 60 },
    }
  ];

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return "text-pastel-sage-soft bg-pastel-sage/15 border-pastel-sage/30";
    if (grade.startsWith('B')) return "text-blue-300 bg-blue-400/15 border-blue-400/30";
    if (grade.startsWith('C')) return "text-amber-300 bg-amber-400/15 border-amber-400/30";
    return "text-red-300 bg-red-400/15 border-red-400/30";
  };

  const gradeBorderColor = (grade: string) => {
    if (grade.startsWith('A')) return '#A6D3A0';
    if (grade.startsWith('B')) return '#93C5FD';
    if (grade.startsWith('C')) return '#FCD34D';
    return '#FCA5A5';
  };

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col relative">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Analytics</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
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
                  <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none mb-2">
                    Roster Deep-Dive
                  </h1>
                  <p className="text-sm text-white/55 flex items-center gap-2">
                    <Narwhal className="h-4 w-4 text-pastel-orange" />
                    AI-Powered Roster Optimization
                  </p>
                </div>
                <div className="flex gap-3">
                  <Card className="px-5 py-3 bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_8px_24px_-12px_rgba(255,168,87,0.3)]">
                    <div className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold">Team Rating</div>
                    <div className="font-calistoga text-3xl text-pastel-cream mt-1 leading-none tabular-nums">
                      92.4 <span className="text-sm font-normal text-white/40 align-middle">/ 100</span>
                    </div>
                  </Card>
                </div>
              </div>

              {isGuestMode(userLeagueState) && (
                <div className="mb-6 max-w-5xl mx-auto">
                  <LeagueCreationCTA
                    title="You're viewing demo analytics"
                    description="Sign up to see personalized analytics for your team and get AI-powered recommendations."
                    variant="compact"
                  />
                </div>
              )}

              <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-6">
                {/* Positional Deep Dive */}
                <div className="lg:col-span-2 space-y-4">
                  <h2 className="font-calistoga text-2xl text-pastel-cream flex items-center gap-2">
                    <ScoreboardIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} />
                    Positional Deep Dive
                  </h2>

                  <div className="space-y-4">
                    {positionalAnalysis.map((pos) => {
                      const PosIcon = POSITION_ICONS[pos.position] || PuckIcon;
                      return (
                        <Card
                          key={pos.position}
                          className="overflow-hidden border-0 bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] border-l-4"
                          style={{ borderLeftColor: gradeBorderColor(pos.grade) }}
                        >
                          <CardContent className="p-6">
                            {/* Top row: name + grade + avg pts */}
                            <div className="flex justify-between items-start mb-4 gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <PosIcon className="w-5 h-5 text-pastel-orange shrink-0" strokeWidth={2} />
                                  <h3 className="font-calistoga text-xl text-pastel-cream">{pos.position}</h3>
                                  <Badge variant="outline" className={`${getGradeColor(pos.grade)} font-jbmono text-[10px] uppercase tracking-[0.18em] font-bold`}>Grade: {pos.grade}</Badge>
                                  <Badge variant="secondary" className="text-[10px] font-jbmono uppercase tracking-[0.18em] bg-white/5 ring-1 ring-white/10 text-white/70 hover:bg-white/10 border-0">Rank #{pos.leagueRank}</Badge>
                                </div>
                                <p className="text-sm text-white/55 leading-relaxed">{pos.description}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-calistoga text-3xl text-pastel-cream leading-none tabular-nums">{pos.avgPoints}</div>
                                <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 mt-1">Avg Pts/Gm</div>
                              </div>
                            </div>

                            {/* Real data viz row: radar + sparkline + score breakdown */}
                            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4 items-center mb-3">
                              <PositionRadar values={pos.radar} />
                              <div className="space-y-3">
                                <div>
                                  <div className="flex justify-between items-end mb-1">
                                    <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 font-bold">Last 6 weeks</div>
                                    <Sparkline values={pos.trend} />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex justify-between items-center text-[10px] font-jbmono uppercase tracking-[0.22em] mb-1.5">
                                    <span className="text-white/55">Performance Score</span>
                                    <span className="text-pastel-cream font-bold tabular-nums">{pos.score}/100</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-pastel-orange"
                                      style={{ width: `${pos.score}%` }}
                                    />
                                  </div>
                                </div>
                                {/* Strengths / weaknesses chips — actual content, not implied */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {pos.strengths.map(s => (
                                    <span key={s} className="px-2 py-0.5 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/30 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold text-pastel-sage-soft">
                                      ↑ {s}
                                    </span>
                                  ))}
                                  {pos.weaknesses.map(w => (
                                    <span key={w} className="px-2 py-0.5 rounded-md bg-red-400/15 ring-1 ring-red-400/30 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold text-red-300">
                                      ↓ {w}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {pos.suggestion && (
                              <div className="bg-pastel-orange/8 ring-1 ring-pastel-orange/20 p-3 rounded-xl flex gap-3 items-start">
                                <Narwhal className="h-5 w-5 text-pastel-orange shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                  <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold text-pastel-orange-soft">Stormy's Suggestion</div>
                                  <p className="text-xs text-white/70 leading-relaxed">{pos.suggestion}</p>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                {/* Right Column: AI Recommended Targets */}
                <div className="space-y-4">
                  <h2 className="font-calistoga text-2xl text-pastel-cream flex items-center gap-2">
                    <RangeIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} />
                    AI Recommended Targets
                  </h2>

                  <Card className="bg-[#1A2A20] border-0 ring-1 ring-amber-400/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(251,191,36,0.15)] relative overflow-hidden">
                    <div aria-hidden="true" className="absolute top-0 right-0 w-48 h-48 bg-amber-400/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                    <CardHeader className="relative z-10">
                      <CardTitle className="font-calistoga text-lg text-amber-300 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" /> Urgent: Goaltending
                      </CardTitle>
                      <CardDescription className="text-white/55">
                        Your goalie grade is C-. Improving this position is the #1 priority to increase win probability.
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
                              <Button size="sm" className="h-7 text-xs bg-pastel-orange text-[#0F1F15] hover:bg-pastel-orange-soft font-bold shrink-0">Claim</Button>
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
                        <div className="text-center py-4 text-sm text-white/55">No schedule maximizers found this week.</div>
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
                          <Button variant="ghost" className="w-full text-xs text-pastel-orange hover:text-pastel-orange-soft hover:bg-white/5 mt-2 font-jbmono uppercase tracking-[0.22em]" onClick={() => window.location.href = '/free-agents?tab=schedule'}>
                            View All Schedule Trends <ChevronRight className="h-3 w-3 ml-1" />
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
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl p-5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden group">
                  <div aria-hidden="true" className="absolute -top-10 -right-10 w-36 h-36 bg-pastel-orange/15 rounded-full blur-3xl pointer-events-none" />
                  <MascotPeek id="lemon" position="bottom-right" size="sm" />
                  <div className="relative z-10">
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-3">
                      ✦ Team-strength radar
                    </div>
                    <div className="flex items-center justify-center mb-3">
                      <PositionRadar values={{ score: 92, volume: 86, consistency: 78, streak: 80, schedule: 74 }} leagueAvg={60} />
                    </div>
                    <div className="text-[10px] text-white/55 leading-relaxed text-center">
                      <span className="text-pastel-orange font-bold">Solid orange</span> = your team. <span className="text-white/70">Dashed</span> = league avg.
                    </div>
                  </div>
                </div>
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-3 mb-2">
                    <MascotAvatar id="lemon" size="sm" />
                    <div className="min-w-0">
                      <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-sage-soft font-bold">Lemon says</div>
                      <div className="font-bold text-sm text-pastel-cream truncate">Tape doesn't lie</div>
                    </div>
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">
                    Goalie's a 35/100 streak — the matchup model wants a swap. Centers carry the team; don't break them up.
                  </p>
                </div>
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
      <HockeyFooter />
    </div>
  );
};

export default TeamAnalytics;
