import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCircle, Shield, CalendarDays, Skull, Lock } from "lucide-react";
import { useState, memo } from "react";

import { CitrusPuckPlayerData, AggregatedPlayerData } from "@/types/citruspuck";

export interface HockeyPlayer {
  id: number | string;
  name: string;
  position: string; // 'Centre', 'Right Wing', 'Left Wing', 'Defence', 'Goalie', 'C', 'RW', 'LW', 'D', 'G'
  eligible_positions?: string[]; // Dual-position eligibility (max 2), e.g., ['C', 'LW']
  number: number;
  starter: boolean;
  stats: {
    // Skater stats
    goals?: number;
    assists?: number;
    points?: number;
    plusMinus?: number;
    shots?: number;
    blockedShots?: number;
    hits?: number;
    powerPlayPoints?: number;
    shortHandedPoints?: number;
    pim?: number;
    gamesPlayed?: number;
    toi?: string; // Time on ice, e.g., "21:34"
    toiPercentage?: number; // Percentage of team's total TOI
    xGoals?: number;
    // Goalie stats
    wins?: number;
    losses?: number;
    otl?: number;
    gaa?: number;
    savePct?: number;
    shutouts?: number;
    saves?: number;
    goalsAgainst?: number;
    highDangerSavePct?: number;
    goalsSavedAboveExpected?: number;
    
    // Advanced / CitrusPuck stats can be mapped here or accessed via citrusPuckData
    // xGoals?: number; // Moved up
  };
  team: string;
  teamAbbreviation?: string; // e.g., "EDM", "COL"
  status?: 'IR' | 'SUSP' | 'GTD' | 'WVR' | null; // Injury Reserve, Suspended, Game Time Decision, Waiver
  roster_status?: string; // Official NHL roster status: ACT, IR, LTIR, etc.
  is_ir_eligible?: boolean; // True if player is on IR or LTIR and can be placed in IR slot
  height?: string;
  weight?: string;
  age?: number;
  experience?: string;
  image?: string;
  nextGame?: {
    opponent: string; // e.g. "vs BOS", "@ NYR"
    isToday: boolean;
    gameTime?: string; // e.g. "7:30 PM"
    gameStatus?: 'scheduled' | 'live' | 'intermission' | 'final'; // Game status from schedule
    score?: string; // e.g. "3-2" current score
  };
  projectedPoints?: number; // Legacy field - kept for backwards compatibility

  // Daily actual game stats (populated when game is live or final)
  daily_actual_points?: number;
  daily_actual_stats?: {
    goals?: number;
    assists?: number;
    points?: number;
    shots_on_goal?: number;
    blocks?: number;
    hits?: number;
    ppp?: number;
    shp?: number;
    pim?: number;
    // Goalie
    wins?: number;
    saves?: number;
    goals_against?: number;
    shutouts?: number;
  };
  
  // Daily projection from Citrus Projections 2.0 (matches Matchup tab structure)
  // Skater projection object with full projection data
  daily_projection?: {
    total_projected_points: number;
    projected_goals: number;
    projected_assists: number;
    projected_sog: number;
    projected_blocks: number;
    projected_ppp?: number;      // Power Play Points
    projected_shp?: number;      // Shorthanded Points
    projected_hits?: number;     // Hits
    projected_pim?: number;      // Penalty Minutes
    projected_xg: number;
    base_ppg: number;
    shrinkage_weight: number;
    finishing_multiplier: number;
    opponent_adjustment: number;
    b2b_penalty: number;
    home_away_adjustment: number;
    confidence_score: number;
    calculation_method: string;
    is_goalie?: boolean; // Flag to distinguish goalie vs skater
    // Monte Carlo uncertainty (Citrus 3.1)
    likely_low?: number;
    likely_high?: number;
    confidence_label?: string;
    dynamic_confidence?: number;
    projection_mean?: number;
    projection_std_dev?: number;
  };

  // Goalie-specific projection object (matches Matchup tab structure)
  goalieProjection?: {
    total_projected_points: number;
    projected_wins: number;
    projected_saves: number;
    projected_shutouts: number;
    projected_goals_against: number;
    projected_gaa: number;
    projected_save_pct: number;
    projected_gp: number;
    starter_confirmed: boolean;
    confidence_score: number;
    calculation_method: string;
  };
  
  // CitrusPuck Integration
  citrusPuckData?: {
    currentSeason?: AggregatedPlayerData;
    lastSeason?: AggregatedPlayerData;
    projections?: {
      currentWeek?: CitrusPuckPlayerData;
      restOfSeason?: CitrusPuckPlayerData;
    };
  };
  
  // View Control
  statView?: 'currentWeek' | 'seasonToDate' | 'lastSeason' | 'restOfSeason';
}

interface HockeyPlayerCardProps {
  player: HockeyPlayer;
  onClick?: () => void; // View player detail (name/headshot tap)
  onSwapTap?: () => void; // Tap-to-swap: select this player, or complete a swap against the selected one (card body tap). Falls back to onClick if not provided.
  className?: string;
  isInSlot?: boolean; // Whether the card is in a starter slot
  isLocked?: boolean; // Whether the player's game has started (locked from moves)
  isSwapSelected?: boolean; // Tap-to-swap: this player is selected for swap
  isSwapTarget?: boolean; // Tap-to-swap: this player's slot is a valid swap target
}

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { generatePlayerWriteup } from "@/utils/playerWriteup";

// Position group accent — the single source of truth for "which slot is this."
// Applied directly on the card (left spine + badge tint) so it's guaranteed
// present everywhere a card renders (starters, bench, IR), instead of relying
// on each grid to remember its own wrapper-level border colour.
const POSITION_ACCENT: Record<string, { spine: string; badge: string }> = {
  C:    { spine: 'before:bg-primary',        badge: 'from-primary to-primary' },
  LW:   { spine: 'before:bg-blue-500',       badge: 'from-blue-500 to-blue-600' },
  RW:   { spine: 'before:bg-purple-500',     badge: 'from-purple-500 to-purple-600' },
  D:    { spine: 'before:bg-slate-400',      badge: 'from-slate-400 to-slate-500' },
  G:    { spine: 'before:bg-amber-500',      badge: 'from-amber-500 to-amber-600' },
  F:    { spine: 'before:bg-emerald-500',    badge: 'from-emerald-500 to-emerald-600' },
  UTIL: { spine: 'before:bg-orange-500',     badge: 'from-orange-500 to-orange-600' },
};
const DEFAULT_ACCENT = { spine: 'before:bg-pastel-sage', badge: 'from-pastel-sage to-[#7CB518]' };

const HockeyPlayerCardContent = ({
  player,
  onClick,
  onSwapTap,
  className,
  isInSlot = false,
  isLocked = false,
  isSwapSelected = false,
  isSwapTarget = false,
}: HockeyPlayerCardProps) => {
  const [imageError, setImageError] = useState(false);
  // HEADSHOTS (2026-08-18) — try the player's mug first, fall back to the
  // team crest, then the Shield glyph. `player.image` is the NHL headshot
  // URL, set by every caller from headshot_url.
  const [headshotError, setHeadshotError] = useState(false);

  if (!player) return null;

  const getPositionAbbreviation = (position: string): string => {
    const pos = position?.toUpperCase() || '';
    if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
    if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
    if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
    if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
    if (['G', 'GOALIE'].includes(pos)) return 'G';
    return pos.substring(0, 2);
  };

  // Display dual-position eligibility (e.g., "C/LW") or single position
  const getPositionDisplay = (): string => {
    if (player.eligible_positions && player.eligible_positions.length > 1) {
      return player.eligible_positions.slice(0, 2).join('/');
    }
    return getPositionAbbreviation(player.position);
  };

  const getTeamAbbreviation = (): string => {
    if (player.teamAbbreviation) return player.teamAbbreviation;
    const words = (player.team || '').split(' ');
    return words[words.length - 1].substring(0, 3).toUpperCase();
  };

  const getStatusBadge = () => {
    if (!player.status) return null;
    
    const statusConfig = {
      'IR': { label: 'IR', variant: 'destructive' as const, color: 'bg-red-500', icon: Skull },
      'SUSP': { label: 'SUSP', variant: 'destructive' as const, color: 'bg-orange-500', icon: AlertCircle },
      'GTD': { label: 'GTD', variant: 'secondary' as const, color: 'bg-yellow-500', icon: AlertCircle },
      'WVR': { label: 'WVR', variant: 'outline' as const, color: 'bg-blue-500', icon: null },
    };

    const config = statusConfig[player.status];
    if (!config) return null;

    const Icon = config.icon;

    // Inline, next to the name — NOT absolutely positioned. This card now
    // carries two other corner badges (position top-right, and the
    // headshot itself grew to 44px) — a third floating badge has nowhere
    // left to sit without covering one of them. Matches MobileRosterList's
    // already-shipped pattern (status badge inline on the name row).
    return (
      <Badge
        variant={config.variant}
        className={cn("text-[7px] font-bold h-4 px-1 gap-0.5 flex items-center flex-shrink-0", config.color, "text-white")}
      >
        {Icon && <Icon className="w-2 h-2" />}
        {config.label}
      </Badge>
    );
  };

  const getDisplayStats = () => {
    const view = player.statView || 'seasonToDate';
    const cp = player.citrusPuckData;
    
    let data: CitrusPuckPlayerData | undefined;
    
    switch (view) {
      case 'restOfSeason':
        data = cp?.projections?.restOfSeason;
        break;
      case 'seasonToDate':
      default:
        data = cp?.currentSeason?.allSituation;
        break;
    }

    if (!data) {
        // If we are in a specific analytics view (projections) and have no data, show 0s
        if (['restOfSeason'].includes(view)) {
             return {
                goals: 0,
                assists: 0,
                points: 0,
                plusMinus: 0,
                shots: 0,
                gamesPlayed: 0,
                powerPlayPoints: 0,
                shortHandedPoints: 0,
                pim: 0,
                wins: 0,
                gaa: 0,
                savePct: 0
            };
        }
        // Fallback to existing stats for seasonToDate or default
        return player.stats;
    }

    // Calculate Assists (Primary + Secondary)
    // Ensure values are treated as numbers, as Supabase might return them as strings (e.g. "50.0")
    const primary = typeof data.I_F_primaryAssists === 'string' ? parseFloat(data.I_F_primaryAssists) : (data.I_F_primaryAssists || 0);
    const secondary = typeof data.I_F_secondaryAssists === 'string' ? parseFloat(data.I_F_secondaryAssists) : (data.I_F_secondaryAssists || 0);
    const assists = primary + secondary;

    // Map CP data to the stats structure expected by the card
    // Also ensure other fields are numbers for safety
    const goals = typeof data.I_F_goals === 'string' ? parseFloat(data.I_F_goals) : (data.I_F_goals || 0);
    const points = typeof data.I_F_points === 'string' ? parseFloat(data.I_F_points) : (data.I_F_points || 0);
    const shots = typeof data.I_F_shotsOnGoal === 'string' ? parseFloat(data.I_F_shotsOnGoal) : (data.I_F_shotsOnGoal || 0);
    const gamesPlayed = typeof data.games_played === 'string' ? parseInt(data.games_played) : (data.games_played || 0);
    const hits = typeof data.I_F_hits === 'string' ? parseFloat(data.I_F_hits) : (data.I_F_hits || 0);
    const blockedShots = typeof data.shotsBlockedByPlayer === 'string' ? parseFloat(data.shotsBlockedByPlayer) : (data.shotsBlockedByPlayer || 0);
    const xGoals = typeof data.I_F_xGoals === 'string' ? parseFloat(data.I_F_xGoals) : (data.I_F_xGoals || 0);
    // Note: Corsi/Fenwick are intentionally not shown/tracked in the app UI.
    
    // Goalie stats (derived if present in advanced data, otherwise fallback)
    const wins = 0; 
    const gaa = data.icetime && parseFloat(String(data.icetime)) > 0 && data.I_F_goals 
       ? (parseFloat(String(data.I_F_goals)) * 3600) / parseFloat(String(data.icetime)) 
       : 0;
    const savePct = data.I_F_shotsOnGoal && parseFloat(String(data.I_F_shotsOnGoal)) > 0
       ? (parseFloat(String(data.I_F_shotsOnGoal)) - parseFloat(String(data.I_F_goals || 0))) / parseFloat(String(data.I_F_shotsOnGoal))
       : 0;
    
    // Derived Advanced Goalie Stats
    const highDangerSavePct = data.I_F_highDangerShots && parseFloat(String(data.I_F_highDangerShots)) > 0
       ? (parseFloat(String(data.I_F_highDangerShots)) - parseFloat(String(data.I_F_highDangerGoals || 0))) / parseFloat(String(data.I_F_highDangerShots))
       : 0;

    const goalsSavedAboveExpected = data.I_F_xGoals && data.I_F_goals
       ? parseFloat(String(data.I_F_xGoals)) - parseFloat(String(data.I_F_goals))
       : 0;

    return {
        goals: Math.round(goals),
        assists: Math.round(assists),
        points: Math.round(points),
        // Prefer our pipeline season +/- when available on the player object
        plusMinus: player.stats?.plusMinus ?? 0,
        shots: Math.round(shots),
        gamesPlayed: gamesPlayed,
        hits: Math.round(hits),
        blockedShots: Math.round(blockedShots),
        xGoals: xGoals,
        // CRITICAL FIX: CitrusPuck data doesn't include PPP/SHP, so always use player.stats
        // These come from PlayerService which uses nhl_ppp and nhl_shp from database
        powerPlayPoints: player.stats?.powerPlayPoints ?? 0,
        shortHandedPoints: player.stats?.shortHandedPoints ?? 0,
        pim: player.stats?.pim ?? 0, // Also include PIM for consistency
        wins: wins, 
        gaa: gaa,
        savePct: savePct,
        highDangerSavePct: highDangerSavePct,
        goalsSavedAboveExpected: goalsSavedAboveExpected
    };
  };

  const displayStats = getDisplayStats();
  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const positionAbbr = getPositionDisplay();
  // Accent keys off the PRIMARY position (not the "C/LW" dual-eligible display
  // string) so it always resolves, even when getPositionDisplay() joins two.
  const accent = POSITION_ACCENT[getPositionAbbreviation(player.position)] || DEFAULT_ACCENT;
  // Pure arithmetic over player.stats — no fetch, no async, safe per render.
  const writeup = generatePlayerWriteup(player);
  const teamAbbr = getTeamAbbreviation();
  const teamLogoUrl = `https://assets.nhle.com/logos/nhl/svg/${player.teamAbbreviation || 'NHL'}_light.svg`;

  // CRITICAL: Use ONLY the new projection system (daily_projection/goalieProjection)
  // This is the SINGLE SOURCE OF TRUTH for projections - matches Matchup tab exactly
  // PROJECTION EXISTS = PLAYER HAS GAME ON SELECTED DATE
  const dailyProjection = isGoalie ? player.goalieProjection : player.daily_projection;
  
  // If projection exists, player has a game on this date
  const hasGameOnSelectedDate = dailyProjection !== undefined && dailyProjection !== null;
  
  // Get projected points from daily projection
  const projectedPoints = dailyProjection?.total_projected_points || 0;
  const maxProjectedPoints = 8; 
  const projectionPercentage = Math.min((projectedPoints / maxProjectedPoints) * 100, 100);

  // Card body = tap-to-swap (select, or complete a swap against the
  // selected player). Falls back to onClick so any caller that hasn't
  // wired the new prop yet still behaves like before.
  const handleCardTap = onSwapTap ?? onClick;

  return (
    <Card
      className={cn(
        "relative overflow-visible transition-all cursor-pointer",
        "min-h-[134px] flex flex-col",
        // Position spine — always present, regardless of which grid renders this card.
        "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-lg",
        accent.spine,
        isInSlot
          ? "border-0 bg-transparent shadow-none"
          : "border border-border/40 hover:border-primary/50 hover:shadow-md",
        isLocked && "opacity-75 bg-muted/30 cursor-not-allowed",
        isSwapSelected && "!ring-2 !ring-pastel-orange !ring-offset-1 !border-pastel-orange !shadow-lg",
        isSwapTarget && "!ring-2 !ring-pastel-sage !ring-offset-1 !border-pastel-sage animate-pulse",
        className
      )}
      onClick={handleCardTap}
    >
      {/* Lock Overlay */}
      {isLocked && (
        <div
          className="absolute inset-0 bg-background/60 backdrop-blur-[1px] z-20 flex items-center justify-center pointer-events-none"
          title="Player's game has started - cannot be moved"
        >
          <div className="flex flex-col items-center gap-1">
            <Lock className="w-5 h-5 text-muted-foreground" />
            <span className="text-[8px] font-semibold text-muted-foreground">LOCKED</span>
          </div>
        </div>
      )}

      {/* Surfer Varsity Header - MAXIMUM GREEN VIBES */}
      <div className="relative p-2 bg-gradient-to-r from-pastel-sage/25 via-pastel-sage/15 to-pastel-sage/25 border-b-2 border-pastel-sage/50 flex items-center gap-2 min-h-[46px] before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-1 before:bg-gradient-to-r before:from-pastel-sage before:via-[#7CB518] before:to-pastel-sage before:opacity-60">
        {/* Player headshot → team crest → Shield glyph */}
        <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-pastel-sage/20 to-pastel-sage/10 rounded-xl shadow-varsity p-1 border-2 border-pastel-sage relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-br before:from-transparent before:to-pastel-sage/20 hover:border-[#7CB518] hover:shadow-[0_0_12px_rgba(124,181,24,0.5)] transition-all">
           {player.image && !headshotError ? (
             <img
               src={player.image}
               alt={player.name}
               loading="lazy"
               decoding="async"
               className="w-full h-full object-cover rounded-lg"
               onError={() => setHeadshotError(true)}
             />
           ) : !imageError ? (
             <img
               src={teamLogoUrl}
               alt={teamAbbr}
               loading="lazy"
               decoding="async"
               className="w-full h-full object-contain"
               onError={() => setImageError(true)}
             />
           ) : (
             <Shield className="w-5 h-5 text-pastel-sage" />
           )}
        </div>

        {/* Player Name and Team - Varsity Typography */}
        <div className="flex-1 min-w-0 pr-5">
          <div className="flex items-center gap-1">
            <h3
              className="font-display font-bold text-[11px] leading-tight line-clamp-2 cursor-pointer hover:text-pastel-sage transition-colors text-pastel-cream"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClick?.();
              }}
            >
              {player.name}
            </h3>
            {getStatusBadge()}
          </div>
          <div className="flex items-center text-[9px] text-pastel-sage font-display font-bold mt-1 gap-1 uppercase tracking-wide">
            <span>{teamAbbr}</span>
            <span>•</span>
            <span>#{player.number}</span>
          </div>
        </div>

        {/* Position Badge - VARSITY PATCH absolute top right, tinted per position group
            so the slot is legible at a glance regardless of which grid renders the card. */}
        <Badge
          className={cn("absolute top-0.5 right-0.5 bg-gradient-to-br border-2 border-white/10 text-pastel-cream font-varsity shadow-patch text-[9px] tracking-wider font-black h-5 px-2", accent.badge)}
        >
          {positionAbbr}
        </Badge>
      </div>

      {/* Stats Grid — actuals for live/final, season stats otherwise */}
      <div className="p-2 bg-gradient-to-br from-pastel-sage/10 via-pastel-sage/5 to-pastel-sage/10 flex-1 flex items-center justify-center border-t-2 border-pastel-sage/40 relative before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:bg-gradient-to-r before:from-pastel-sage/50 before:via-[#7CB518] before:to-pastel-sage/50">
        {(() => {
          const gameStatus = player.nextGame?.gameStatus;
          const showActuals = hasGameOnSelectedDate && player.daily_actual_stats &&
            (gameStatus === 'live' || gameStatus === 'intermission' || gameStatus === 'final');

          if (isGoalie) {
            if (showActuals && player.daily_actual_stats) {
              const s = player.daily_actual_stats;
              return (
                <div className="grid grid-cols-3 gap-1.5 text-center w-full">
                  {[
                    { label: 'W', value: s.wins || 0 },
                    { label: 'SV', value: s.saves || 0 },
                    { label: 'GA', value: s.goals_against || 0 },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-gradient-to-br from-emerald-100/60 to-emerald-50/40 rounded-xl p-1.5 border-2 border-emerald-300/50">
                      <div className="text-[8px] text-emerald-800 font-display font-bold uppercase leading-none mb-1 tracking-wider">{stat.label}</div>
                      <div className="font-varsity text-[11px] text-emerald-800">{stat.value}</div>
                    </div>
                  ))}
                </div>
              );
            }
            // Season stats
            return (
              <div className="grid grid-cols-3 gap-0.5 text-center w-full">
                <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">W</div><div className="font-bold text-[9px]">{displayStats.wins || 0}</div></div>
                <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">GAA</div><div className="font-bold text-[9px]">{displayStats.gaa?.toFixed(2) || '0.00'}</div></div>
                <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">SV%</div><div className="font-bold text-[9px]">{displayStats.savePct ? (displayStats.savePct * 100).toFixed(2) : '0.00'}%</div></div>
              </div>
            );
          }

          // Skater
          if (showActuals && player.daily_actual_stats) {
            const s = player.daily_actual_stats;
            return (
              <div className="grid grid-cols-4 gap-1 text-center w-full">
                {[
                  { label: 'G', value: s.goals || 0 },
                  { label: 'A', value: s.assists || 0 },
                  { label: 'SOG', value: s.shots_on_goal || 0 },
                  { label: 'HIT', value: s.hits || 0 },
                ].map((stat) => (
                  <div key={stat.label} className="bg-gradient-to-br from-emerald-100/60 to-emerald-50/40 rounded-lg p-1 border-2 border-emerald-300/50">
                    <div className="text-[7px] text-emerald-800 font-display font-bold uppercase leading-none mb-0.5">{stat.label}</div>
                    <div className="font-varsity text-[9px] text-emerald-800">{stat.value}</div>
                  </div>
                ))}
              </div>
            );
          }
          // Season stats
          return (
            <div className="grid grid-cols-4 gap-0.5 text-center w-full">
              <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">GP</div><div className="font-bold text-[9px]">{displayStats.gamesPlayed || 0}</div></div>
              <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">G</div><div className="font-bold text-[9px]">{displayStats.goals || 0}</div></div>
              <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">A</div><div className="font-bold text-[9px]">{displayStats.assists || 0}</div></div>
              <div><div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">SOG</div><div className="font-bold text-[9px]">{displayStats.shots || 0}</div></div>
            </div>
          );
        })()}
      </div>

      {/* Scouting note — the Sleeper/Yahoo/ESPN one-liner under the stat line.
          Single row, truncated: the full writeup lives in the player modal.
          Derived from the same stats rendered above it, so the note and the
          numbers cannot disagree (see utils/playerWriteup). */}
      {writeup.cardNote && (
        <div className="px-2 py-0.5 bg-[#1A2A20]/50 border-t border-pastel-sage/25 flex items-center gap-1.5">
          <span
            className={cn(
              'w-1 h-1 rounded-full flex-shrink-0',
              writeup.cardTone === 'caution'
                ? 'bg-amber-400'
                : writeup.cardTone === 'positive'
                  ? 'bg-pastel-sage'
                  : 'bg-white/55',
            )}
            aria-hidden="true"
          />
          <span className="text-[8px] leading-tight font-display text-white/70 truncate">
            {writeup.cardNote}
          </span>
        </div>
      )}

      {/* Projected Points / Game Bar - VARSITY SCOREBOARD STYLE */}
      <div className="relative px-2 pb-2 pt-1.5 bg-gradient-to-br from-pastel-sage/18 via-pastel-sage/28 to-pastel-sage/12 flex flex-col justify-center gap-1.5 border-t-2 border-pastel-sage/40 min-h-[32px] before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-gradient-to-r before:from-transparent before:via-pastel-sage before:to-transparent before:opacity-60">
        <div className="flex items-center justify-between h-3.5">
          <div className="flex items-center gap-1.5">
            {hasGameOnSelectedDate ? (
              <>
                <div className="flex items-center gap-1 bg-pastel-sage/20 px-1.5 py-0.5 rounded-md border border-pastel-sage/40">
                  <CalendarDays className="w-2.5 h-2.5 text-pastel-cream" />
                  <span className="text-[8px] font-varsity font-bold text-pastel-cream tracking-wide truncate max-w-[50px]">
                     {player.nextGame?.opponent || 'Game'}
                  </span>
                  {player.nextGame?.gameTime && (
                    <span className="text-[7px] text-pastel-cream/70 font-display font-medium">
                      {player.nextGame.gameTime}
                    </span>
                  )}
                </div>
              </>
            ) : (
               <span className="text-[8px] font-display text-white/55 italic">No Game</span>
            )}
          </div>
          
          <div className="flex items-center gap-1 bg-pastel-sage/30 px-2 py-0.5 rounded-md border-2 border-pastel-sage/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
             <span className="text-[7px] text-white/55 uppercase font-varsity font-bold tracking-wider">PROJ</span>
             <span className={cn(
               "text-[10px] font-varsity font-black tracking-tight",
               hasGameOnSelectedDate ? "text-pastel-orange" : "text-white/55"
             )}>
                 {hasGameOnSelectedDate ? projectedPoints.toFixed(1) : '-'}
             </span>
          </div>
        </div>
        
        {/* Collegiate Progress Bar with Stitching */}
        <div className="relative h-2 bg-[#1A2A20] backdrop-blur-sm rounded-full overflow-hidden border-2 border-dashed border-pastel-sage/40 w-full shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)]">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-700 ease-out relative", 
              hasGameOnSelectedDate 
                ? "bg-gradient-to-r from-pastel-sage via-[#7CB518] to-pastel-sage shadow-[0_0_8px_rgba(124,181,24,0.4)]" 
                : "bg-transparent"
            )}
            style={{ width: `${projectionPercentage}%` }}
          >
            {hasGameOnSelectedDate && projectionPercentage > 20 && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

const HockeyPlayerCard = memo((props: HockeyPlayerCardProps) => (
  <ErrorBoundary>
    <HockeyPlayerCardContent {...props} />
  </ErrorBoundary>
));

HockeyPlayerCard.displayName = 'HockeyPlayerCard';

export default HockeyPlayerCard;
