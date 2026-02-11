import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Target, Shield, Zap, Star, AlertCircle, Clock, Activity, Crosshair, Trash2, TrendingUp, TrendingDown, Flame, Snowflake } from 'lucide-react';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { cn } from '@/lib/utils';
import { LeagueService } from '@/services/LeagueService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { CitrusSparkle } from '@/components/icons/CitrusIcons';

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

  if (!player) return null;

  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const stats = player.stats || {};
  const posAbbr = getPositionAbbr(player.position);
  const posStyle = posColors[posAbbr] || posColors['C'];
  const teamAbbr = player.teamAbbreviation || player.team?.split(' ').pop()?.substring(0, 3).toUpperCase() || '';
  const teamLogoUrl = `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbreviation || 'NHL'}_light.svg`;

  const dailyProj = isGoalie ? player.goalieProjection : player.daily_projection;
  const hasGame = dailyProj != null;
  const projPts = dailyProj?.total_projected_points || 0;

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

          {/* Today's Projection Banner */}
          <div className="mt-4 flex items-center justify-between bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2.5 border border-white/10">
            <div className="flex items-center gap-2">
              {hasGame ? (
                <>
                  <Flame className="w-4 h-4 text-citrus-orange" />
                  <span className="text-white/80 text-sm font-display font-medium">
                    {player.nextGame?.opponent || 'Today'}
                    {player.nextGame?.gameTime && <span className="text-white/50 ml-1.5">{player.nextGame.gameTime}</span>}
                  </span>
                </>
              ) : (
                <>
                  <Snowflake className="w-4 h-4 text-white/40" />
                  <span className="text-white/40 text-sm font-display italic">No game today</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-white/50 text-[10px] font-display uppercase tracking-wider">Proj</span>
              <span className={cn(
                "text-xl font-varsity font-black",
                hasGame ? "text-citrus-orange" : "text-white/30"
              )}>
                {hasGame ? projPts.toFixed(1) : '—'}
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
              {hasGame ? (
                <>
                  {/* Game context */}
                  <div className="flex items-center gap-3 p-3 bg-citrus-sage/10 rounded-xl border border-citrus-sage/20">
                    <Flame className="w-5 h-5 text-citrus-orange flex-shrink-0" />
                    <div>
                      <span className="text-sm font-display font-bold text-citrus-forest">
                        {player.nextGame?.opponent || 'Game Today'}
                      </span>
                      {player.nextGame?.gameTime && (
                        <span className="text-xs text-citrus-charcoal/50 ml-2">{player.nextGame.gameTime}</span>
                      )}
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-2xl font-varsity font-black text-citrus-orange">{projPts.toFixed(1)}</div>
                      <div className="text-[9px] text-citrus-charcoal/40 font-display uppercase">projected pts</div>
                    </div>
                  </div>

                  {/* Projection breakdown */}
                  {isGoalie && player.goalieProjection ? (
                    <div className="grid grid-cols-3 gap-2">
                      <StatCell label="W" value={player.goalieProjection.projected_wins?.toFixed(2) ?? '—'} highlight />
                      <StatCell label="SV" value={player.goalieProjection.projected_saves?.toFixed(0) ?? '—'} />
                      <StatCell label="SO" value={player.goalieProjection.projected_shutouts?.toFixed(2) ?? '—'} />
                      <StatCell label="GA" value={player.goalieProjection.projected_goals_against?.toFixed(2) ?? '—'} />
                      <StatCell label="GAA" value={player.goalieProjection.projected_gaa?.toFixed(2) ?? '—'} />
                      <StatCell label="SV%" value={player.goalieProjection.projected_save_pct ? `${(player.goalieProjection.projected_save_pct * 100).toFixed(1)}` : '—'} />
                    </div>
                  ) : player.daily_projection ? (
                    <div className="grid grid-cols-4 gap-2">
                      <StatCell label="G" value={player.daily_projection.projected_goals?.toFixed(2) ?? '—'} highlight />
                      <StatCell label="A" value={player.daily_projection.projected_assists?.toFixed(2) ?? '—'} highlight />
                      <StatCell label="SOG" value={player.daily_projection.projected_sog?.toFixed(1) ?? '—'} />
                      <StatCell label="BLK" value={player.daily_projection.projected_blocks?.toFixed(1) ?? '—'} />
                      <StatCell label="PPP" value={player.daily_projection.projected_ppp?.toFixed(2) ?? '—'} />
                      <StatCell label="SHP" value={player.daily_projection.projected_shp?.toFixed(2) ?? '—'} />
                      <StatCell label="HIT" value={player.daily_projection.projected_hits?.toFixed(1) ?? '—'} />
                      <StatCell label="PIM" value={player.daily_projection.projected_pim?.toFixed(1) ?? '—'} />
                    </div>
                  ) : null}

                  {/* Confidence */}
                  {dailyProj?.confidence_score != null && (
                    <div className="flex items-center justify-between py-2 px-3 bg-citrus-cream/30 rounded-xl border border-citrus-sage/15">
                      <span className="text-xs font-display text-citrus-charcoal/50">Confidence</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-citrus-sage/15 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full"
                            style={{ width: `${Math.min(dailyProj.confidence_score * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-varsity font-black text-citrus-forest">
                          {(dailyProj.confidence_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-10">
                  <Snowflake className="w-10 h-10 text-citrus-charcoal/20 mx-auto mb-3" />
                  <p className="text-sm font-display text-citrus-charcoal/40">No game scheduled today</p>
                  <p className="text-xs font-display text-citrus-charcoal/30 mt-1">Projections are available on game days</p>
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
