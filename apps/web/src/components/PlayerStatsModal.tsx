import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Star, AlertCircle, Clock, Trash2, Flame, Snowflake, CalendarDays, Loader2, CheckCircle2 } from 'lucide-react';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { cn } from '@/lib/utils';
import { LeagueService } from '@/services/LeagueService';
import { ScheduleService } from '@/services/ScheduleService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import { CitrusSparkle } from '@/components/icons/CitrusIcons';
import { getTodayMST } from '@/utils/timezoneUtils';
import { logger } from '@/utils/logger';
import { playerApi } from '@/api/players';
import { MatchupService } from '@/services/MatchupService';
import { matchupApi } from '@/api/matchups';

// ─── Types for game log entries ──────────────────────────────────────
interface GameLogEntry {
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "Sun", "Mon"
  dateLabel: string; // e.g. "Feb 15"
  opponent: string; // e.g. "vs BOS" or "@ NYR"
  gameTime?: string;
  projectedPoints: number;
  projection: Record<string, unknown> | null; // Full projection object (skater or goalie)
  isGoalie: boolean;
  isPast: boolean;
  isToday: boolean;
  computedConfidence: number; // 0.0-1.0, computed fresh on the frontend
  // Actual stats for played games
  actualPoints?: number;
  actualStats?: Record<string, unknown>;
}

/** Compute a meaningful confidence score from projection data + temporal distance */
function computeConfidence(projection: Record<string, unknown>, gameDate: string, todayStr: string): number {
  if (!projection) return 0;

  // Base confidence from sample size (games played proxy: shrinkage_weight)
  // shrinkage_weight is 0.0-1.0 based on GP/sample — use directly as base
  const shrinkage = Number(projection.shrinkage_weight || 0);
  const baseConfidence = shrinkage > 0 ? Math.min(shrinkage / 0.9, 1.0) : 0.7;

  // Temporal decay: games farther out are less confident
  // ~1.0 for tomorrow, ~0.85 at 30 days, ~0.70 at 60 days
  const gameMs = new Date(gameDate + 'T00:00:00').getTime();
  const todayMs = new Date(todayStr + 'T00:00:00').getTime();
  const daysOut = Math.max(0, (gameMs - todayMs) / 86400000);
  const temporalFactor = Math.max(0.50, 1.0 - (daysOut * 0.005));

  // Opponent factor: extreme opponent adjustments = less confidence
  const oppAdj = Number(projection.opponent_adjustment || 1.0);
  const oppDeviation = Math.abs(oppAdj - 1.0);
  const opponentFactor = Math.max(0.75, 1.0 - oppDeviation);

  return Math.round(baseConfidence * temporalFactor * opponentFactor * 100) / 100;
}

interface PlayerStatsModalProps {
  player: HockeyPlayer | null;
  isOpen: boolean;
  onClose: () => void;
  leagueId?: string | null;
  isOnRoster?: boolean;
  onPlayerDropped?: () => void;
}

// ─── Position color mapping ──────────────────────────────────────────
const posColors: Record<string, { bg: string; text: string; border: string }> = {
  C:  { bg: 'bg-citrus-sage', text: 'text-white', border: 'border-citrus-sage' },
  LW: { bg: 'bg-citrus-green-dark', text: 'text-white', border: 'border-citrus-green-dark' },
  RW: { bg: 'bg-citrus-orange', text: 'text-white', border: 'border-citrus-orange' },
  D:  { bg: 'bg-citrus-forest', text: 'text-white', border: 'border-citrus-forest' },
  G:  { bg: 'bg-citrus-peach', text: 'text-citrus-forest', border: 'border-citrus-peach' },
};

const getPositionAbbr = (pos: string) => {
  const p = pos?.toUpperCase() || '';
  if (['C', 'CENTRE', 'CENTER'].includes(p)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(p)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(p)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(p)) return 'D';
  if (['G', 'GOALIE'].includes(p)) return 'G';
  return p.substring(0, 2);
};

// ─── Stat cell helper ────────────────────────────────────────────────
const StatCell = ({ label, value, highlight, sub }: { label: string; value: string | number; highlight?: boolean; sub?: string }) => (
  <div className="flex flex-col items-center p-3 bg-[#E8EED9]/40 rounded-xl border border-citrus-sage/20">
    <span className="text-[10px] font-display font-semibold text-citrus-charcoal/50 uppercase tracking-wider mb-1">{label}</span>
    <span className={cn(
      "text-xl font-varsity font-black leading-none",
      highlight ? "text-citrus-orange" : "text-citrus-forest"
    )}>
      {value}
    </span>
    {sub && <span className="text-[9px] text-citrus-charcoal/40 font-display mt-0.5">{sub}</span>}
  </div>
);

// ─── Main Component ──────────────────────────────────────────────────
const PlayerStatsModal = ({ player, isOpen, onClose, leagueId, isOnRoster = false, onPlayerDropped }: PlayerStatsModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isDropping, setIsDropping] = useState(false);
  const [imgErr, setImgErr] = useState(false);

  // Game log state (all 82 games: actuals for played + projections for future)
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [gameLogLoading, setGameLogLoading] = useState(false);
  const [totalProjected, setTotalProjected] = useState(0);
  const [totalActual, setTotalActual] = useState(0);
  const fetchedForPlayerRef = useRef<string | null>(null);

  // Fetch full season game log when modal opens (actuals for played games + projections for future)
  useEffect(() => {
    if (!isOpen || !player) {
      if (!isOpen) {
        setGameLog([]);
        setTotalProjected(0);
        setTotalActual(0);
        fetchedForPlayerRef.current = null;
      }
      return;
    }

    const playerKey = `${player.id}-${player.team}`;
    if (fetchedForPlayerRef.current === playerKey) return;
    fetchedForPlayerRef.current = playerKey;

    const fetchGameLog = async () => {
      const teamAbbrev = player.teamAbbreviation || player.team || '';
      if (!teamAbbrev) return;

      setGameLogLoading(true);
      try {
        const todayStr = getTodayMST();
        const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        const playerIsGoalie = player.position === 'Goalie' || player.position === 'G';

        // Fetch ALL games for this team this season (past + future)
        const seasonStart = new Date('2025-10-04T00:00:00'); // NHL season start
        const { games } = await ScheduleService.getGamesForTeam(teamAbbrev, seasonStart);

        if (!games || games.length === 0) {
          setGameLog([]);
          setTotalProjected(0);
          setTotalActual(0);
          setGameLogLoading(false);
          return;
        }

        // Separate past and future games
        const pastGames = games.filter((g: any) => g.game_date.split('T')[0] < todayStr);
        const futureGames = games.filter((g: any) => g.game_date.split('T')[0] >= todayStr);

        // Fetch actual stats for past games (batch by date)
        const actualStatsMap = new Map<string, any>();
        if (pastGames.length > 0) {
          try {
            const pastDates = [...new Set(pastGames.map((g: any) => g.game_date.split('T')[0]))];
            // Fetch in batches of 10 dates to avoid overwhelming the API
            const batchSize = 10;
            for (let i = 0; i < pastDates.length; i += batchSize) {
              const batch = pastDates.slice(i, i + batchSize);
              const results = await Promise.all(
                batch.map(async (date) => {
                  try {
                    const response = await matchupApi.getDailyGameStats([playerId], date);
                    const statsArray = response?.data || response || [];
                    const stat = Array.isArray(statsArray)
                      ? statsArray.find((s: any) => s.player_id === playerId)
                      : null;
                    return { date, stat };
                  } catch { return { date, stat: null }; }
                })
              );
              for (const { date, stat } of results) {
                if (stat) actualStatsMap.set(date, stat);
              }
            }
          } catch (err) {
            logger.warn('[PlayerStatsModal] Could not fetch past game stats:', err);
          }
        }

        // Fetch projections for future games
        const projectionMap = new Map<string, any>();
        if (futureGames.length > 0) {
          try {
            const futureDates = [...new Set(futureGames.map((g: any) => g.game_date.split('T')[0]))];
            const results = await Promise.all(
              futureDates.map(async (date) => {
                const projMap = await MatchupService.getDailyProjectionsForMatchup([playerId], date);
                return { date, projection: projMap.get(playerId) || null };
              })
            );
            for (const { date, projection } of results) {
              if (projection) projectionMap.set(date, projection);
            }
          } catch (err) {
            logger.warn('[PlayerStatsModal] Projections not available:', err);
          }
        }

        // Build game log entries
        const entries: GameLogEntry[] = [];
        let projTotal = 0;
        let actTotal = 0;

        for (const game of games) {
          const gameDate = game.game_date.split('T')[0];
          const [gy, gm, gd] = gameDate.split('-').map(Number);
          const gameDateObj = new Date(gy, gm - 1, gd);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayLabel = dayNames[gameDateObj.getDay()];
          const dateLabel = gameDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          const isHome = game.home_team.toUpperCase() === teamAbbrev.toUpperCase();
          const opponent = isHome ? `vs ${game.away_team}` : `@ ${game.home_team}`;
          const isPast = gameDate < todayStr;
          const isToday = gameDate === todayStr;

          const actualStat = actualStatsMap.get(gameDate);
          const projection = projectionMap.get(gameDate) || null;
          const projectedPoints = Number(projection?.total_projected_points || 0);
          const actualPoints = actualStat
            ? Number(actualStat.total_points || actualStat.fantasy_points || 0)
            : undefined;

          if (isPast && actualPoints != null) actTotal += actualPoints;
          if (!isPast) projTotal += projectedPoints;

          const mcConfidence = Number(projection?.dynamic_confidence || 0);
          const confidence = mcConfidence > 0 ? mcConfidence : (projection ? computeConfidence(projection, gameDate, todayStr) : 0);

          entries.push({
            date: gameDate,
            dayLabel,
            dateLabel,
            opponent,
            gameTime: game.game_time ? (() => {
              try {
                return new Date(game.game_time).toLocaleTimeString('en-US', {
                  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Denver'
                });
              } catch { return undefined; }
            })() : undefined,
            projectedPoints,
            projection,
            isGoalie: playerIsGoalie,
            isPast,
            isToday,
            computedConfidence: confidence,
            actualPoints,
            actualStats: actualStat || undefined,
          });
        }

        setGameLog(entries);
        setTotalProjected(projTotal);
        setTotalActual(actTotal);
      } catch (error) {
        logger.error('[PlayerStatsModal] Error fetching game log:', error);
      } finally {
        setGameLogLoading(false);
      }
    };

    fetchGameLog();
  }, [isOpen, player]);

  if (!player) return null;

  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const stats = player.stats || {};
  const posAbbr = getPositionAbbr(player.position);
  const posStyle = posColors[posAbbr] || posColors['C'];
  const teamAbbr = player.teamAbbreviation || player.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';
  const teamLogoUrl = `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbreviation || 'NHL'}_light.svg`;

  // Use game log totals for the hero banner
  const dailyProj = isGoalie ? player.goalieProjection : player.daily_projection;
  const futureGames = gameLog.filter(g => !g.isPast);
  const pastGames = gameLog.filter(g => g.isPast);
  const hasGame = gameLog.length > 0 || dailyProj != null;
  const heroProjectedPts = futureGames.length > 0 ? totalProjected : (dailyProj?.total_projected_points || 0);
  const heroGameCount = futureGames.length;

  const statusConfig: Record<string, { label: string; cls: string; icon: typeof AlertCircle }> = {
    IR:   { label: 'Injury Reserve', cls: 'bg-red-500/10 text-red-600 border-red-200', icon: AlertCircle },
    SUSP: { label: 'Suspended', cls: 'bg-orange-500/10 text-orange-600 border-orange-200', icon: AlertCircle },
    GTD:  { label: 'Game Time Decision', cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-200', icon: Clock },
    WVR:  { label: 'Waiver', cls: 'bg-blue-500/10 text-blue-600 border-blue-200', icon: AlertCircle },
  };
  const statusInfo = player.status ? statusConfig[player.status] : null;

  const handleDropPlayer = async () => {
    if (!user || !leagueId || !player?.id) {
      toast({ title: "Error", description: "Unable to drop player. Missing required information.", variant: "destructive" });
      return;
    }
    if (!confirm(`Are you sure you want to drop ${player.name}?`)) return;
    setIsDropping(true);
    try {
      const { success, error } = await LeagueService.dropPlayer(leagueId, user.id, String(player.id), 'Roster Tab');
      if (success) {
        toast({ title: "Player Dropped", description: `${player.name} has been dropped from your roster.` });
        onPlayerDropped?.();
        onClose();
      } else {
        toast({ title: "Error", description: (error as { message?: string })?.message || "Failed to drop player.", variant: "destructive" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to drop player.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsDropping(false);
    }
  };

  // Compute shooting % safely
  const shootingPct = stats.shots && stats.goals ? ((stats.goals / stats.shots) * 100).toFixed(1) : null;
  const plusMinus = stats.plusMinus ?? 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg sm:max-w-2xl p-0 overflow-hidden border-citrus-sage/30 rounded-2xl">

        {/* ═══ Hero Header ═══ */}
        <div className="relative bg-gradient-to-br from-citrus-forest via-citrus-green-dark to-citrus-sage px-5 pt-6 pb-5 overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/5" />
          <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-white/5" />

          <div className="relative flex items-start gap-4">
            {/* Team logo / player avatar */}
            <div className="w-16 h-16 flex-shrink-0 rounded-2xl bg-white/15 backdrop-blur-sm border-2 border-white/20 flex items-center justify-center overflow-hidden shadow-lg">
              {!imgErr ? (
                <img src={teamLogoUrl} alt={teamAbbr} className="w-12 h-12 object-contain" onError={() => setImgErr(true)} />
              ) : (
                <span className="text-2xl font-varsity font-black text-white/80">{player.number}</span>
              )}
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl sm:text-2xl font-varsity font-black text-white leading-tight tracking-tight truncate">
                {player.name}
              </h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge className={cn("text-[10px] font-varsity font-black px-2 h-5 tracking-wider border", posStyle.bg, posStyle.text, posStyle.border)}>
                  {posAbbr}
                </Badge>
                <span className="text-white/70 text-sm font-display font-medium">{player.team}</span>
                <span className="text-white/40 text-sm">#{player.number}</span>
              </div>
              {/* Status badge */}
              {statusInfo && (
                <div className="mt-2">
                  <Badge variant="outline" className={cn("text-[10px] font-semibold gap-1 border", statusInfo.cls)}>
                    <statusInfo.icon className="w-3 h-3" />
                    {statusInfo.label}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Week Projection Banner */}
          <div className="mt-4 flex items-center justify-between bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-white/10">
            <div className="flex items-center gap-2">
              {hasGame ? (
                <>
                  <CalendarDays className="w-4 h-4 text-citrus-orange" />
                  <span className="text-white/80 text-sm font-display font-medium">
                    {heroGameCount > 0
                      ? `${heroGameCount} upcoming game${heroGameCount !== 1 ? 's' : ''}`
                      : (player.nextGame?.opponent || 'Today')}
                  </span>
                </>
              ) : (
                <>
                  <Snowflake className="w-4 h-4 text-white/40" />
                  <span className="text-white/40 text-sm font-display italic">No upcoming games</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-white/50 text-[10px] font-display uppercase tracking-wider">
                {heroGameCount > 0 ? 'Total Proj' : 'Proj'}
              </span>
              <span className={cn(
                "text-xl font-varsity font-black",
                hasGame ? "text-citrus-orange" : "text-white/30"
              )}>
                {hasGame ? heroProjectedPts.toFixed(1) : '—'}
              </span>
            </div>
          </div>

          {/* Starter badge */}
          {player.starter && (
            <div className="absolute top-4 right-4">
              <Badge className="bg-citrus-orange/90 text-white border-0 text-[9px] font-varsity font-black tracking-wider gap-1">
                <Star className="w-3 h-3 fill-white" />
                STARTER
              </Badge>
            </div>
          )}
        </div>

        {/* ═══ Body ═══ */}
        <div className="px-5 py-4 max-h-[55vh] overflow-y-auto">
          <Tabs defaultValue="stats">
            <TabsList className="grid w-full grid-cols-3 bg-citrus-cream/60 border border-citrus-sage/20 rounded-xl h-9 mb-4">
              <TabsTrigger value="stats" className="text-xs font-display font-semibold rounded-lg data-[state=active]:bg-citrus-sage data-[state=active]:text-white">Overview</TabsTrigger>
              <TabsTrigger value="advanced" className="text-xs font-display font-semibold rounded-lg data-[state=active]:bg-citrus-sage data-[state=active]:text-white">Detailed</TabsTrigger>
              <TabsTrigger value="gamelog" className="text-xs font-display font-semibold rounded-lg data-[state=active]:bg-citrus-sage data-[state=active]:text-white">Game Log</TabsTrigger>
            </TabsList>

            {/* ─── Overview Tab ─── */}
            <TabsContent value="stats" className="mt-0 space-y-4">
              {/* Key stats grid */}
              {isGoalie ? (
                <div className="grid grid-cols-3 gap-2">
                  <StatCell label="W" value={stats.wins ?? 0} highlight />
                  <StatCell label="GAA" value={stats.gaa?.toFixed(2) ?? '0.00'} />
                  <StatCell label="SV%" value={stats.savePct ? `${(stats.savePct * 100).toFixed(1)}` : '0.0'} />
                  <StatCell label="SO" value={stats.shutouts ?? 0} />
                  <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                  <StatCell label="SV" value={stats.saves ?? 0} />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <StatCell label="G" value={stats.goals ?? 0} highlight />
                  <StatCell label="A" value={stats.assists ?? 0} highlight />
                  <StatCell label="PTS" value={stats.points ?? ((stats.goals ?? 0) + (stats.assists ?? 0))} highlight />
                  <StatCell label="+/−" value={`${plusMinus > 0 ? '+' : ''}${plusMinus}`} />
                  <StatCell label="SOG" value={stats.shots ?? 0} sub={shootingPct ? `${shootingPct}% SH` : undefined} />
                  <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                </div>
              )}

              {/* Secondary stats row */}
              {!isGoalie && (
                <div className="grid grid-cols-4 gap-2">
                  <StatCell label="PPP" value={stats.powerPlayPoints ?? 0} />
                  <StatCell label="HIT" value={stats.hits ?? 0} />
                  <StatCell label="BLK" value={stats.blockedShots ?? 0} />
                  <StatCell label="PIM" value={stats.pim ?? 0} />
                </div>
              )}

              {/* Bio quick view */}
              {(player.age || player.height || player.weight) && (
                <div className="flex items-center gap-4 py-2.5 px-3 bg-citrus-cream/30 rounded-xl border border-citrus-sage/15 text-sm">
                  {player.age && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-citrus-charcoal/40 text-xs font-display">Age</span>
                      <span className="font-display font-bold text-citrus-forest">{player.age}</span>
                    </div>
                  )}
                  {player.height && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-citrus-charcoal/40 text-xs font-display">Ht</span>
                      <span className="font-display font-bold text-citrus-forest">{player.height}</span>
                    </div>
                  )}
                  {player.weight && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-citrus-charcoal/40 text-xs font-display">Wt</span>
                      <span className="font-display font-bold text-citrus-forest">{player.weight}</span>
                    </div>
                  )}
                  {player.experience && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-citrus-charcoal/40 text-xs font-display">Exp</span>
                      <span className="font-display font-bold text-citrus-forest">{player.experience}</span>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ─── Detailed Stats Tab ─── */}
            <TabsContent value="advanced" className="mt-0 space-y-4">
              {isGoalie ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCell label="SV%" value={stats.savePct ? `${(stats.savePct * 100).toFixed(3)}` : '0.000'} />
                    <StatCell label="GAA" value={stats.gaa?.toFixed(2) ?? '0.00'} />
                    <StatCell label="HD SV%" value={stats.highDangerSavePct ? `${(stats.highDangerSavePct * 100).toFixed(1)}` : '—'} />
                    <StatCell label="GSAx" value={
                      stats.goalsSavedAboveExpected
                        ? `${stats.goalsSavedAboveExpected > 0 ? '+' : ''}${stats.goalsSavedAboveExpected.toFixed(1)}`
                        : '—'
                    } highlight={!!(stats.goalsSavedAboveExpected && stats.goalsSavedAboveExpected > 0)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <StatCell label="W" value={stats.wins ?? 0} />
                    <StatCell label="L" value={stats.losses ?? 0} />
                    <StatCell label="OTL" value={stats.otl ?? 0} />
                    <StatCell label="SO" value={stats.shutouts ?? 0} />
                    <StatCell label="SV" value={stats.saves ?? 0} />
                    <StatCell label="GP" value={stats.gamesPlayed ?? 0} />
                  </div>
                </>
              ) : (
                <>
                  {/* Full stat grid */}
                  <div className="rounded-xl border border-citrus-sage/20 overflow-hidden">
                    <div className="grid grid-cols-4 gap-px bg-citrus-sage/15">
                      {[
                        { label: 'G', value: stats.goals ?? 0 },
                        { label: 'A', value: stats.assists ?? 0 },
                        { label: 'PTS', value: stats.points ?? (stats.goals ?? 0) + (stats.assists ?? 0) },
                        { label: '+/−', value: `${plusMinus > 0 ? '+' : ''}${plusMinus}` },
                        { label: 'SOG', value: stats.shots ?? 0 },
                        { label: 'HIT', value: stats.hits ?? 0 },
                        { label: 'BLK', value: stats.blockedShots ?? 0 },
                        { label: 'PIM', value: stats.pim ?? 0 },
                        { label: 'PPP', value: stats.powerPlayPoints ?? 0 },
                        { label: 'SHP', value: stats.shortHandedPoints ?? 0 },
                        { label: 'GP', value: stats.gamesPlayed ?? 0 },
                        { label: 'TOI/G', value: stats.toi ?? '—' },
                      ].map((item, i) => (
                        <div key={i} className="bg-card p-2.5 flex flex-col items-center text-center">
                          <span className="text-[9px] font-display font-semibold text-citrus-charcoal/40 uppercase tracking-wider">{item.label}</span>
                          <span className="text-base font-varsity font-black text-citrus-forest mt-0.5">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Advanced metrics */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-display font-bold text-citrus-charcoal/50 uppercase tracking-wider flex items-center gap-1.5">
                      <CitrusSparkle className="w-3.5 h-3.5 text-citrus-orange" />
                      Advanced
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      <StatCell
                        label="xGoals"
                        value={stats.xGoals?.toFixed(1) ?? '—'}
                        sub={stats.xGoals && stats.goals != null ? `${((stats.goals - stats.xGoals) > 0 ? '+' : '')}${(stats.goals - stats.xGoals).toFixed(1)} diff` : undefined}
                      />
                      <StatCell
                        label="SH%"
                        value={shootingPct ? `${shootingPct}%` : '—'}
                      />
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            {/* ─── Game Log Tab ─── */}
            <TabsContent value="gamelog" className="mt-0 space-y-4">
              {gameLogLoading ? (
                <div className="text-center py-10">
                  <Loader2 className="w-8 h-8 text-citrus-sage/40 mx-auto mb-3 animate-spin" />
                  <p className="text-sm font-display text-citrus-charcoal/40">Loading game log…</p>
                </div>
              ) : gameLog.length > 0 ? (
                <>
                  {/* Season summary banner */}
                  <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-citrus-sage/10 to-citrus-peach/10 rounded-xl border border-citrus-sage/20">
                    <CalendarDays className="w-5 h-5 text-citrus-orange flex-shrink-0" />
                    <div>
                      <span className="text-sm font-display font-bold text-citrus-forest">
                        {gameLog.length} Game{gameLog.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-citrus-charcoal/50 ml-2">
                        {pastGames.length} played · {futureGames.length} remaining
                      </span>
                    </div>
                    <div className="ml-auto text-right">
                      {totalActual > 0 && (
                        <div className="text-lg font-varsity font-black text-citrus-forest leading-tight">{totalActual.toFixed(1)}<span className="text-[9px] text-citrus-charcoal/40 font-display uppercase ml-1">actual</span></div>
                      )}
                      {futureGames.length > 0 && (
                        <div className="text-sm font-varsity font-black text-citrus-orange leading-tight">{totalProjected.toFixed(1)}<span className="text-[9px] text-citrus-charcoal/40 font-display uppercase ml-1">proj</span></div>
                      )}
                    </div>
                  </div>

                  {/* Game-by-game log — most recent first */}
                  <div className="space-y-2">
                    {[...gameLog].reverse().map((gp) => {
                      const hasActuals = gp.isPast && gp.actualStats != null;
                      const displayPoints = hasActuals ? (gp.actualPoints ?? 0) : gp.projectedPoints;
                      const as = gp.actualStats || {};

                      return (
                      <div
                        key={gp.date}
                        className={cn(
                          "rounded-xl border overflow-hidden transition-all",
                          gp.isToday ? "border-citrus-orange bg-citrus-peach/5"
                            : hasActuals ? "border-citrus-sage/20 bg-card"
                            : gp.isPast ? "border-citrus-sage/15 bg-citrus-cream/20 opacity-50"
                            : "border-citrus-sage/20 bg-[#E8EED9]/30"
                        )}
                      >
                        {/* Game header row */}
                        <div className="flex items-center gap-3 px-3 py-2">
                          <div className="flex flex-col items-center min-w-[40px]">
                            <span className={cn(
                              "text-[10px] font-varsity font-black uppercase tracking-wider",
                              gp.isToday ? "text-citrus-orange" : "text-citrus-charcoal/50"
                            )}>
                              {gp.dayLabel}
                            </span>
                            <span className="text-xs font-display font-bold text-citrus-forest">{gp.dateLabel}</span>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              {hasActuals ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-citrus-sage" />
                              ) : (
                                <Flame className={cn("w-3.5 h-3.5", gp.isToday ? "text-citrus-orange" : "text-citrus-sage/50")} />
                              )}
                              <span className="text-sm font-display font-bold text-citrus-forest">{gp.opponent}</span>
                              {!hasActuals && gp.gameTime && <span className="text-[10px] text-citrus-charcoal/40 font-display">{gp.gameTime}</span>}
                            </div>
                            {gp.isToday && (
                              <Badge className="mt-0.5 bg-citrus-orange/90 text-white border-0 text-[10px] font-varsity font-black tracking-wider h-4 px-1.5">
                                TODAY
                              </Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <div className={cn(
                              "text-xl font-varsity font-black",
                              hasActuals ? "text-citrus-forest" : (displayPoints > 0 ? "text-citrus-orange" : "text-citrus-charcoal/30")
                            )}>
                              {displayPoints > 0 ? displayPoints.toFixed(1) : (gp.isPast && !hasActuals ? 'DNP' : '—')}
                            </div>
                            <div className="text-[10px] text-citrus-charcoal/40 font-display uppercase">
                              {hasActuals ? 'pts' : (gp.isPast ? '' : 'proj')}
                            </div>
                          </div>
                        </div>

                        {/* Stat breakdown row */}
                        {hasActuals ? (
                          /* ACTUAL STATS for played games */
                          <div className="px-3 pb-2 pt-0">
                            {gp.isGoalie ? (
                              <div className="grid grid-cols-6 gap-1">
                                {[
                                  { label: 'W', value: Number(as.wins || 0) },
                                  { label: 'SV', value: Number(as.saves || 0) },
                                  { label: 'SO', value: Number(as.shutouts || 0) },
                                  { label: 'GA', value: Number(as.goals_against || 0) },
                                  { label: 'GAA', value: as.gaa != null ? Number(as.gaa).toFixed(2) : '—' },
                                  { label: 'SV%', value: as.save_pct != null ? `${(Number(as.save_pct) * 100).toFixed(1)}` : '—' },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-citrus-sage/10 rounded border border-citrus-sage/15">
                                    <span className="text-[9px] font-display font-semibold text-citrus-charcoal/40 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-citrus-forest">{s.value}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="grid grid-cols-8 gap-1">
                                {[
                                  { label: 'G', value: Number(as.goals || 0) },
                                  { label: 'A', value: Number(as.assists || 0) },
                                  { label: 'SOG', value: Number(as.shots_on_goal || 0) },
                                  { label: 'BLK', value: Number(as.blocks || 0) },
                                  { label: 'PPP', value: Number(as.ppp || 0) },
                                  { label: 'SHP', value: Number(as.shp || 0) },
                                  { label: 'HIT', value: Number(as.hits || 0) },
                                  { label: 'PIM', value: Number(as.pim || 0) },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-citrus-sage/10 rounded border border-citrus-sage/15">
                                    <span className="text-[9px] font-display font-semibold text-citrus-charcoal/40 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-citrus-forest">{s.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : gp.projection && gp.projectedPoints > 0 ? (
                          /* PROJECTED STATS for future games */
                          <div className="px-3 pb-2 pt-0">
                            {gp.isGoalie ? (
                              <div className="grid grid-cols-6 gap-1">
                                {[
                                  { label: 'W', value: (gp.projection.projected_wins as number | undefined)?.toFixed(2) },
                                  { label: 'SV', value: (gp.projection.projected_saves as number | undefined)?.toFixed(0) },
                                  { label: 'SO', value: (gp.projection.projected_shutouts as number | undefined)?.toFixed(2) },
                                  { label: 'GA', value: (gp.projection.projected_goals_against as number | undefined)?.toFixed(2) },
                                  { label: 'GAA', value: (gp.projection.projected_gaa as number | undefined)?.toFixed(2) },
                                  { label: 'SV%', value: gp.projection.projected_save_pct ? `${(Number(gp.projection.projected_save_pct) * 100).toFixed(1)}` : '—' },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-[#E8EED9]/40 rounded border border-citrus-sage/10">
                                    <span className="text-[9px] font-display font-semibold text-citrus-charcoal/40 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-citrus-forest">{s.value ?? '—'}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="grid grid-cols-8 gap-1">
                                {[
                                  { label: 'G', value: (gp.projection.projected_goals as number | undefined)?.toFixed(2) },
                                  { label: 'A', value: (gp.projection.projected_assists as number | undefined)?.toFixed(2) },
                                  { label: 'SOG', value: (gp.projection.projected_sog as number | undefined)?.toFixed(1) },
                                  { label: 'BLK', value: (gp.projection.projected_blocks as number | undefined)?.toFixed(1) },
                                  { label: 'PPP', value: (gp.projection.projected_ppp as number | undefined)?.toFixed(2) },
                                  { label: 'SHP', value: (gp.projection.projected_shp as number | undefined)?.toFixed(2) },
                                  { label: 'HIT', value: (gp.projection.projected_hits as number | undefined)?.toFixed(1) },
                                  { label: 'PIM', value: (gp.projection.projected_pim as number | undefined)?.toFixed(1) },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-[#E8EED9]/40 rounded border border-citrus-sage/10">
                                    <span className="text-[9px] font-display font-semibold text-citrus-charcoal/40 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-citrus-forest">{s.value ?? '—'}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Likely Range + Confidence for future games */}
                            {gp.projection?.likely_low != null && gp.projection?.likely_high != null && (
                              <div className="flex items-center justify-between mt-1.5 px-1">
                                <span className="text-[10px] font-display text-citrus-charcoal/40">Likely Range</span>
                                <span className="text-[9px] font-varsity font-black text-citrus-forest">
                                  {Number(gp.projection.likely_low).toFixed(1)} – {Number(gp.projection.likely_high).toFixed(1)} pts
                                </span>
                              </div>
                            )}
                            {gp.computedConfidence > 0 && (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] font-display text-citrus-charcoal/40">Confidence</span>
                                <div className="flex-1 h-1.5 bg-citrus-sage/10 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full"
                                    style={{ width: `${Math.min(gp.computedConfidence * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[9px] font-varsity font-black text-citrus-forest">
                                  {Math.round(gp.computedConfidence * 100)}%
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );})}
                  </div>
                </>
              ) : (
                <div className="text-center py-10">
                  <Snowflake className="w-10 h-10 text-citrus-charcoal/20 mx-auto mb-3" />
                  <p className="text-sm font-display text-citrus-charcoal/40">No games scheduled</p>
                  <p className="text-xs font-display text-citrus-charcoal/30 mt-1">Game log appears when games are on the schedule</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ═══ Footer Actions ═══ */}
        {leagueId && user && isOnRoster && (
          <div className="px-5 py-3 border-t border-citrus-sage/15 bg-citrus-cream/30">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDropPlayer}
              disabled={isDropping}
              className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 font-display font-semibold"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDropping ? 'Dropping...' : 'Drop Player'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PlayerStatsModal;
