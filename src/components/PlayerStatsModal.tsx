import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Star, AlertCircle, Clock, Trash2, Flame, Snowflake, CalendarDays, Loader2 } from 'lucide-react';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { cn } from '@/lib/utils';
import { LeagueService } from '@/services/LeagueService';
import { ScheduleService } from '@/services/ScheduleService';
import { MatchupService } from '@/services/MatchupService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';
import { CitrusSparkle } from '@/components/icons/CitrusIcons';
import { getTodayMST } from '@/utils/timezoneUtils';

// ─── Types for week projections ─────────────────────────────────────
interface GameProjection {
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "Sun", "Mon"
  dateLabel: string; // e.g. "Feb 15"
  opponent: string; // e.g. "vs BOS" or "@ NYR"
  gameTime?: string;
  projectedPoints: number;
  projection: any; // Full projection object (skater or goalie)
  isGoalie: boolean;
  isPast: boolean;
  isToday: boolean;
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

  // Week projections state
  const [weekProjections, setWeekProjections] = useState<GameProjection[]>([]);
  const [weekProjectionsLoading, setWeekProjectionsLoading] = useState(false);
  const [weekTotalProjected, setWeekTotalProjected] = useState(0);
  const fetchedForPlayerRef = useRef<string | null>(null);

  // Fetch all future game projections for the current week when modal opens
  useEffect(() => {
    if (!isOpen || !player) {
      // Reset when modal closes
      if (!isOpen) {
        setWeekProjections([]);
        setWeekTotalProjected(0);
        fetchedForPlayerRef.current = null;
      }
      return;
    }

    const playerKey = `${player.id}-${player.team}`;
    if (fetchedForPlayerRef.current === playerKey) return; // Already fetched for this player
    fetchedForPlayerRef.current = playerKey;

    const fetchWeekProjections = async () => {
      const teamAbbrev = player.teamAbbreviation || player.team || '';
      if (!teamAbbrev) return;

      setWeekProjectionsLoading(true);
      try {
        const todayStr = getTodayMST();
        const today = new Date(todayStr + 'T00:00:00');

        // Calculate current week boundaries (Sunday-Saturday)
        const dayOfWeek = today.getDay(); // 0=Sun
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - dayOfWeek);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        // Fetch games for this team in the current week
        const { games } = await ScheduleService.getGamesForTeam(teamAbbrev, weekStart, weekEnd);
        
        if (!games || games.length === 0) {
          setWeekProjections([]);
          setWeekTotalProjected(0);
          setWeekProjectionsLoading(false);
          return;
        }

        const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        const projections: GameProjection[] = [];
        const playerIsGoalie = player.position === 'Goalie' || player.position === 'G';

        // For each game, fetch projections
        for (const game of games) {
          const gameDate = game.game_date.split('T')[0]; // YYYY-MM-DD
          const [gy, gm, gd] = gameDate.split('-').map(Number);
          const gameDateObj = new Date(gy, gm - 1, gd);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayLabel = dayNames[gameDateObj.getDay()];
          const dateLabel = gameDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          // Determine opponent string
          const isHome = game.home_team.toUpperCase() === teamAbbrev.toUpperCase();
          const opponent = isHome
            ? `vs ${game.away_team}`
            : `@ ${game.home_team}`;

          const isPast = gameDate < todayStr;
          const isToday = gameDate === todayStr;

          // Fetch projection for this date
          let projection: any = null;
          let projectedPoints = 0;
          try {
            const projMap = await MatchupService.getDailyProjectionsForMatchup([playerId], gameDate);
            const proj = projMap.get(playerId);
            if (proj) {
              projection = proj;
              projectedPoints = proj.total_projected_points || 0;
            }
          } catch {
            // Projection not available for this date - that's OK
          }

          projections.push({
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
          });
        }

        // Calculate week total (all games, including past for full context)
        const total = projections.reduce((sum, gp) => sum + gp.projectedPoints, 0);

        setWeekProjections(projections);
        setWeekTotalProjected(total);
      } catch (error) {
        console.error('[PlayerStatsModal] Error fetching week projections:', error);
      } finally {
        setWeekProjectionsLoading(false);
      }
    };

    fetchWeekProjections();
  }, [isOpen, player]);

  if (!player) return null;

  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const stats = player.stats || {};
  const posAbbr = getPositionAbbr(player.position);
  const posStyle = posColors[posAbbr] || posColors['C'];
  const teamAbbr = player.teamAbbreviation || player.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';
  const teamLogoUrl = `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbreviation || 'NHL'}_light.svg`;

  // Use week total for the hero banner if available, otherwise fall back to daily projection
  const dailyProj = isGoalie ? player.goalieProjection : player.daily_projection;
  const hasGame = weekProjections.length > 0 || dailyProj != null;
  const heroProjectedPts = weekProjections.length > 0 ? weekTotalProjected : (dailyProj?.total_projected_points || 0);
  const heroGameCount = weekProjections.length;

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
        toast({ title: "Error", description: error?.message || "Failed to drop player.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to drop player.", variant: "destructive" });
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
                      ? `${heroGameCount} game${heroGameCount !== 1 ? 's' : ''} this week`
                      : (player.nextGame?.opponent || 'Today')}
                  </span>
                </>
              ) : (
                <>
                  <Snowflake className="w-4 h-4 text-white/40" />
                  <span className="text-white/40 text-sm font-display italic">No games this week</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-white/50 text-[10px] font-display uppercase tracking-wider">
                {heroGameCount > 0 ? 'Week Proj' : 'Proj'}
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
              <TabsTrigger value="projections" className="text-xs font-display font-semibold rounded-lg data-[state=active]:bg-citrus-sage data-[state=active]:text-white">Projections</TabsTrigger>
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

            {/* ─── Projections Tab ─── */}
            <TabsContent value="projections" className="mt-0 space-y-4">
              {weekProjectionsLoading ? (
                <div className="text-center py-10">
                  <Loader2 className="w-8 h-8 text-citrus-sage/40 mx-auto mb-3 animate-spin" />
                  <p className="text-sm font-display text-citrus-charcoal/40">Loading projections…</p>
                </div>
              ) : weekProjections.length > 0 ? (
                <>
                  {/* Week total banner */}
                  <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-citrus-sage/10 to-citrus-peach/10 rounded-xl border border-citrus-sage/20">
                    <CalendarDays className="w-5 h-5 text-citrus-orange flex-shrink-0" />
                    <div>
                      <span className="text-sm font-display font-bold text-citrus-forest">
                        {weekProjections.length} Game{weekProjections.length !== 1 ? 's' : ''} This Week
                      </span>
                      <span className="text-xs text-citrus-charcoal/50 ml-2">
                        {weekProjections[0]?.dateLabel} – {weekProjections[weekProjections.length - 1]?.dateLabel}
                      </span>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-2xl font-varsity font-black text-citrus-orange">{weekTotalProjected.toFixed(1)}</div>
                      <div className="text-[9px] text-citrus-charcoal/40 font-display uppercase">week total</div>
                    </div>
                  </div>

                  {/* Game-by-game projections */}
                  <div className="space-y-2">
                    {weekProjections.map((gp) => (
                      <div
                        key={gp.date}
                        className={cn(
                          "rounded-xl border overflow-hidden transition-all",
                          gp.isToday ? "border-citrus-orange bg-citrus-peach/5" : gp.isPast ? "border-citrus-sage/15 bg-citrus-cream/20 opacity-60" : "border-citrus-sage/20 bg-[#E8EED9]/30"
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
                              <Flame className={cn("w-3.5 h-3.5", gp.isToday ? "text-citrus-orange" : "text-citrus-sage")} />
                              <span className="text-sm font-display font-bold text-citrus-forest">{gp.opponent}</span>
                              {gp.gameTime && <span className="text-[10px] text-citrus-charcoal/40 font-display">{gp.gameTime}</span>}
                            </div>
                            {gp.isToday && (
                              <Badge className="mt-0.5 bg-citrus-orange/90 text-white border-0 text-[8px] font-varsity font-black tracking-wider h-4 px-1.5">
                                TODAY
                              </Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <div className={cn(
                              "text-xl font-varsity font-black",
                              gp.projectedPoints > 0 ? "text-citrus-orange" : "text-citrus-charcoal/30"
                            )}>
                              {gp.projectedPoints > 0 ? gp.projectedPoints.toFixed(1) : '—'}
                            </div>
                            <div className="text-[8px] text-citrus-charcoal/40 font-display uppercase">proj pts</div>
                          </div>
                        </div>

                        {/* Stat breakdown row (expandable detail) */}
                        {gp.projection && gp.projectedPoints > 0 && (
                          <div className="px-3 pb-2 pt-0">
                            {gp.isGoalie ? (
                              <div className="grid grid-cols-6 gap-1">
                                {[
                                  { label: 'W', value: gp.projection.projected_wins?.toFixed(2) },
                                  { label: 'SV', value: gp.projection.projected_saves?.toFixed(0) },
                                  { label: 'SO', value: gp.projection.projected_shutouts?.toFixed(2) },
                                  { label: 'GA', value: gp.projection.projected_goals_against?.toFixed(2) },
                                  { label: 'GAA', value: gp.projection.projected_gaa?.toFixed(2) },
                                  { label: 'SV%', value: gp.projection.projected_save_pct ? `${(gp.projection.projected_save_pct * 100).toFixed(1)}` : '—' },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-[#E8EED9]/40 rounded border border-citrus-sage/10">
                                    <span className="text-[7px] font-display font-semibold text-citrus-charcoal/40 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-citrus-forest">{s.value ?? '—'}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="grid grid-cols-8 gap-1">
                                {[
                                  { label: 'G', value: gp.projection.projected_goals?.toFixed(2) },
                                  { label: 'A', value: gp.projection.projected_assists?.toFixed(2) },
                                  { label: 'SOG', value: gp.projection.projected_sog?.toFixed(1) },
                                  { label: 'BLK', value: gp.projection.projected_blocks?.toFixed(1) },
                                  { label: 'PPP', value: gp.projection.projected_ppp?.toFixed(2) },
                                  { label: 'SHP', value: gp.projection.projected_shp?.toFixed(2) },
                                  { label: 'HIT', value: gp.projection.projected_hits?.toFixed(1) },
                                  { label: 'PIM', value: gp.projection.projected_pim?.toFixed(1) },
                                ].map((s, i) => (
                                  <div key={i} className="flex flex-col items-center py-1 bg-[#E8EED9]/40 rounded border border-citrus-sage/10">
                                    <span className="text-[7px] font-display font-semibold text-citrus-charcoal/40 uppercase">{s.label}</span>
                                    <span className="text-[10px] font-varsity font-black text-citrus-forest">{s.value ?? '—'}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Confidence bar */}
                            {gp.projection.confidence_score != null && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[8px] font-display text-citrus-charcoal/40">Confidence</span>
                                <div className="flex-1 h-1.5 bg-citrus-sage/10 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full"
                                    style={{ width: `${Math.min(gp.projection.confidence_score * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[9px] font-varsity font-black text-citrus-forest">
                                  {(gp.projection.confidence_score * 100).toFixed(0)}%
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-10">
                  <Snowflake className="w-10 h-10 text-citrus-charcoal/20 mx-auto mb-3" />
                  <p className="text-sm font-display text-citrus-charcoal/40">No games scheduled this week</p>
                  <p className="text-xs font-display text-citrus-charcoal/30 mt-1">Projections appear when games are on the schedule</p>
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
