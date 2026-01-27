import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlertCircle, Shield, CalendarDays, Skull, Plus, Lock, Info } from "lucide-react";
import { useState } from "react";
import { CitrusPuckPlayerData, AggregatedPlayerData } from "@/types/citruspuck";

export interface HockeyPlayer {
  id: number | string;
  name: string;
  position: string; // 'Centre', 'Right Wing', 'Left Wing', 'Defence', 'Goalie', 'C', 'RW', 'LW', 'D', 'G'
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
  };
  projectedPoints?: number; // Legacy field - kept for backwards compatibility
  
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
  onClick?: () => void;
  draggable?: boolean;
  className?: string;
  isInSlot?: boolean; // Whether the card is in a starter slot
  isLocked?: boolean; // Whether the player's game has started (locked from moves)
}

import { ErrorBoundary } from "@/components/ErrorBoundary";

const HockeyPlayerCardContent = ({ 
  player, 
  onClick, 
  draggable = true, 
  className,
  isInSlot = false,
  isLocked = false
}: HockeyPlayerCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player?.id || 'unknown' });
  
  const [imageError, setImageError] = useState(false);

  if (!player) return null;

  const style = draggable ? {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  const getPositionAbbreviation = (position: string): string => {
    const pos = position?.toUpperCase() || '';
    if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
    if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
    if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
    if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
    if (['G', 'GOALIE'].includes(pos)) return 'G';
    return pos.substring(0, 2);
  };

  const getTeamAbbreviation = (): string => {
    if (player.teamAbbreviation) return player.teamAbbreviation;
    const words = player.team.split(' ');
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

    return (
      <Badge 
        variant={config.variant}
        className={cn("absolute top-0.5 right-0.5 text-[7px] font-bold h-4 px-1 z-10 gap-0.5 flex items-center", config.color, "text-white")}
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
  const positionAbbr = getPositionAbbreviation(player.position);
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

  // Disable drag if player is locked
  const canDrag = draggable && !isLocked;
  
  const dragProps = canDrag ? {
    ...attributes,
    ...listeners,
    isDragging // Ensure isDragging is passed or handled if used elsewhere
  } : {};

  return (
    <Card
      ref={draggable ? setNodeRef : undefined}
      style={style}
      {...dragProps}
      className={cn(
        "relative overflow-visible transition-all",
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed",
        "h-[130px] flex flex-col",
        isInSlot 
          ? "border-0 bg-transparent shadow-none" 
          : "border border-border/40 hover:border-primary/50 hover:shadow-md",
        isDragging && "shadow-xl z-50 opacity-90",
        isLocked && "opacity-75 bg-muted/30",
        className
      )}
      onClick={onClick}
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
      <div className="relative p-2 bg-gradient-to-r from-citrus-sage/25 via-citrus-sage/15 to-citrus-sage/25 border-b-2 border-citrus-sage/50 flex items-center gap-2 min-h-[42px] before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-1 before:bg-gradient-to-r before:from-citrus-sage before:via-[#7CB518] before:to-citrus-sage before:opacity-60">
        {getStatusBadge()}
        
        {/* Lock Icon Badge - Varsity Style */}
        {isLocked && (
          <Badge 
            variant="secondary"
            className="absolute top-1 left-1 text-[7px] font-bold h-5 px-1.5 z-10 gap-0.5 flex items-center bg-citrus-sage/30 text-citrus-forest border-2 border-citrus-sage rounded-lg shadow-sm"
            title="Player's game has started - cannot be moved"
          >
            <Lock className="w-3 h-3" />
          </Badge>
        )}

        {/* Team Logo - GREEN VARSITY BADGE */}
        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-citrus-sage/20 to-citrus-sage/10 rounded-xl shadow-varsity p-1 border-2 border-citrus-sage relative before:content-[''] before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-br before:from-transparent before:to-citrus-sage/20 hover:border-[#7CB518] hover:shadow-[0_0_12px_rgba(124,181,24,0.5)] transition-all">
           {!imageError ? (
             <img 
               src={teamLogoUrl} 
               alt={teamAbbr} 
               className="w-full h-full object-contain"
               onError={() => setImageError(true)}
             />
           ) : (
             <Shield className="w-5 h-5 text-citrus-sage" />
           )}
        </div>

        {/* Player Name and Team - Varsity Typography */}
        <div className="flex-1 min-w-0 pr-5">
          <h3 
            className="font-display font-bold text-[11px] leading-tight line-clamp-2 cursor-pointer hover:text-citrus-sage transition-colors text-citrus-forest"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            {player.name}
          </h3>
          <div className="flex items-center text-[9px] text-citrus-sage font-display font-bold mt-1 gap-1 uppercase tracking-wide">
            <span>{teamAbbr}</span>
            <span>•</span>
            <span>#{player.number}</span>
            {(player.status === 'IR' || player.status === 'SUSP') && (
              <Plus className="w-3 h-3 text-destructive ml-0.5 flex-shrink-0 stroke-[3]" />
            )}
          </div>
        </div>

        {/* Position Badge - GREEN VARSITY PATCH absolute top right */}
        <Badge 
          className="absolute top-0.5 right-0.5 bg-gradient-to-br from-citrus-sage to-[#7CB518] border-2 border-citrus-forest text-citrus-forest font-varsity shadow-patch text-[9px] tracking-wider font-black h-5 px-2"
        >
          {positionAbbr}
        </Badge>
      </div>

      {/* Surfer Stats Grid - MAXIMUM GREEN ENERGY */}
      <div className="p-2 bg-gradient-to-br from-citrus-sage/10 via-citrus-sage/5 to-citrus-sage/10 flex-1 flex items-center justify-center border-t-2 border-citrus-sage/40 relative before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:bg-gradient-to-r before:from-citrus-sage/50 before:via-[#7CB518] before:to-citrus-sage/50">
        {isGoalie ? (
          // GOALIE: Show projection stats with surfer badge styling
          hasGameOnSelectedDate && player.goalieProjection ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="grid grid-cols-3 gap-1.5 text-center w-full cursor-help">
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-xl p-1.5 border-2 border-citrus-sage/50 shadow-sm hover:shadow-patch hover:border-citrus-sage transition-all">
                    <div className="text-[8px] text-citrus-forest font-display font-bold uppercase leading-none mb-1 tracking-wider">W</div>
                    <div className="font-varsity text-[11px] text-citrus-forest">{player.goalieProjection.projected_wins?.toFixed(2) || '0.00'}</div>
                  </div>
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-xl p-1.5 border-2 border-citrus-sage/50 shadow-sm hover:shadow-patch hover:border-citrus-sage transition-all">
                    <div className="text-[8px] text-citrus-forest font-display font-bold uppercase leading-none mb-1 tracking-wider">SV</div>
                    <div className="font-varsity text-[10px] text-citrus-forest">{player.goalieProjection.projected_saves?.toFixed(0) || '0'}</div>
                  </div>
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-xl p-1.5 border-2 border-citrus-sage/50 shadow-sm hover:shadow-patch hover:border-citrus-sage transition-all">
                    <div className="text-[8px] text-citrus-forest font-display font-bold uppercase leading-none mb-1 tracking-wider">SO</div>
                    <div className="font-varsity text-[10px] text-citrus-forest">{player.goalieProjection.projected_shutouts?.toFixed(2) || '0.00'}</div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="p-3 bg-[#E8EED9]/50 backdrop-blur-sm border-2 border-citrus-sage rounded-varsity shadow-varsity z-[9999] max-w-xs">
                <h4 className="font-varsity text-sm text-citrus-forest border-b-2 border-citrus-sage/30 pb-1 mb-2">Projected Stats</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Wins:</span><span className="font-varsity text-citrus-forest">{player.goalieProjection.projected_wins?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Saves:</span><span className="font-varsity text-citrus-forest">{player.goalieProjection.projected_saves?.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Shutouts:</span><span className="font-varsity text-citrus-forest">{player.goalieProjection.projected_shutouts?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">GA:</span><span className="font-varsity text-citrus-forest">{player.goalieProjection.projected_goals_against?.toFixed(2)}</span></div>
                </div>
                <div className="mt-2 pt-1 border-t-2 border-citrus-sage/30 text-xs font-varsity font-bold text-citrus-sage">
                  Total: {player.goalieProjection.total_projected_points?.toFixed(1)} pts
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            // No projection - show season stats
            <div className="grid grid-cols-3 gap-0.5 text-center w-full">
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">W</div>
                <div className="font-bold text-[9px]">{displayStats.wins || 0}</div>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">GAA</div>
                <div className="font-bold text-[9px]">{displayStats.gaa?.toFixed(2) || '0.00'}</div>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">SV%</div>
                <div className="font-bold text-[9px]">
                  {displayStats.savePct ? (displayStats.savePct * 100).toFixed(2) : '0.00'}%
                </div>
              </div>
            </div>
          )
        ) : (
          // SKATER: Show projection stats (G, A, SOG, BLK) when available with tooltip for all 8
          hasGameOnSelectedDate && player.daily_projection ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="grid grid-cols-4 gap-1 text-center w-full cursor-help">
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-lg p-1 border-2 border-citrus-sage/50">
                    <div className="text-[7px] text-citrus-forest font-display font-bold uppercase leading-none mb-0.5">G</div>
                    <div className="font-varsity text-[9px] text-citrus-forest">{player.daily_projection.projected_goals?.toFixed(2) || '0.00'}</div>
                  </div>
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-lg p-1 border-2 border-citrus-sage/50">
                    <div className="text-[7px] text-citrus-forest font-display font-bold uppercase leading-none mb-0.5">A</div>
                    <div className="font-varsity text-[9px] text-citrus-forest">{player.daily_projection.projected_assists?.toFixed(2) || '0.00'}</div>
                  </div>
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-lg p-1 border-2 border-citrus-sage/50">
                    <div className="text-[7px] text-citrus-forest font-display font-bold uppercase leading-none mb-0.5">SOG</div>
                    <div className="font-varsity text-[9px] text-citrus-forest">{player.daily_projection.projected_sog?.toFixed(1) || '0.0'}</div>
                  </div>
                  <div className="bg-gradient-to-br from-citrus-sage/30 to-[#7CB518]/20 rounded-lg p-1 border-2 border-citrus-sage/50">
                    <div className="text-[7px] text-citrus-forest font-display font-bold uppercase leading-none mb-0.5">BLK</div>
                    <div className="font-varsity text-[9px] text-citrus-forest">{player.daily_projection.projected_blocks?.toFixed(1) || '0.0'}</div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="p-3 bg-[#E8EED9]/50 backdrop-blur-sm border-2 border-citrus-sage rounded-varsity shadow-varsity z-[9999] max-w-xs">
                <h4 className="font-varsity text-sm text-citrus-forest border-b-2 border-citrus-sage/30 pb-1 mb-2">Projected Stats</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Goals:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_goals?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Assists:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_assists?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">SOG:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_sog?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Blocks:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_blocks?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">PPP:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_ppp?.toFixed(2) || '0.00'}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">SHP:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_shp?.toFixed(2) || '0.00'}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">Hits:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_hits?.toFixed(2) || '0.00'}</span></div>
                  <div className="flex justify-between"><span className="text-citrus-charcoal font-display">PIM:</span><span className="font-varsity text-citrus-forest">{player.daily_projection.projected_pim?.toFixed(2) || '0.00'}</span></div>
                </div>
                <div className="mt-2 pt-1 border-t-2 border-citrus-sage/30 text-xs font-varsity font-bold text-citrus-sage">
                  Total: {player.daily_projection.total_projected_points?.toFixed(1)} pts
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            // No projection - show season stats
            <div className="grid grid-cols-4 gap-0.5 text-center w-full">
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">GP</div>
                <div className="font-bold text-[9px]">{displayStats.gamesPlayed || 0}</div>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">G</div>
                <div className="font-bold text-[9px]">{displayStats.goals || 0}</div>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">A</div>
                <div className="font-bold text-[9px]">{displayStats.assists || 0}</div>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground uppercase leading-none mb-0.5">SOG</div>
                <div className="font-bold text-[9px]">{displayStats.shots || 0}</div>
              </div>
            </div>
          )
        )}
      </div>

      {/* Projected Points / Game Bar - VARSITY SCOREBOARD STYLE */}
      <div className="relative px-2 pb-2 pt-1.5 bg-gradient-to-br from-citrus-sage/15 via-citrus-cream/50 to-citrus-peach/10 flex flex-col justify-center gap-1.5 border-t-2 border-citrus-sage/40 min-h-[32px] before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-gradient-to-r before:from-transparent before:via-citrus-sage before:to-transparent before:opacity-60">
        <div className="flex items-center justify-between h-3.5">
          <div className="flex items-center gap-1.5">
            {hasGameOnSelectedDate ? (
              <>
                <div className="flex items-center gap-1 bg-citrus-sage/20 px-1.5 py-0.5 rounded-md border border-citrus-sage/40">
                  <CalendarDays className="w-2.5 h-2.5 text-citrus-forest" />
                  <span className="text-[8px] font-varsity font-bold text-citrus-forest tracking-wide truncate max-w-[50px]">
                     {player.nextGame?.opponent || 'Game'}
                  </span>
                  {player.nextGame?.gameTime && (
                    <span className="text-[7px] text-citrus-forest/70 font-display font-medium">
                      {player.nextGame.gameTime}
                    </span>
                  )}
                </div>
              </>
            ) : (
               <span className="text-[8px] font-display text-citrus-charcoal/40 italic">No Game</span>
            )}
          </div>
          
          <div className="flex items-center gap-1 bg-citrus-peach/30 px-2 py-0.5 rounded-md border-2 border-citrus-peach/50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
             <span className="text-[7px] text-citrus-charcoal uppercase font-varsity font-bold tracking-wider">PROJ</span>
             <span className={cn(
               "text-[10px] font-varsity font-black tracking-tight",
               hasGameOnSelectedDate ? "text-citrus-orange" : "text-citrus-charcoal/40"
             )}>
                 {hasGameOnSelectedDate ? projectedPoints.toFixed(1) : '-'}
             </span>
          </div>
        </div>
        
        {/* Collegiate Progress Bar with Stitching */}
        <div className="relative h-2 bg-[#E8EED9]/50 backdrop-blur-sm rounded-full overflow-hidden border-2 border-dashed border-citrus-sage/40 w-full shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)]">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-700 ease-out relative", 
              hasGameOnSelectedDate 
                ? "bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage shadow-[0_0_8px_rgba(124,181,24,0.4)]" 
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

const HockeyPlayerCard = (props: HockeyPlayerCardProps) => (
  <ErrorBoundary>
    <HockeyPlayerCardContent {...props} />
  </ErrorBoundary>
);

export default HockeyPlayerCard;
