import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCircle, Shield, CalendarDays, Skull, Plus } from "lucide-react";
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
  projectedPoints?: number;
  
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
}

import { ErrorBoundary } from "@/components/ErrorBoundary";

const HockeyPlayerCardContent = ({ 
  player, 
  onClick, 
  draggable = true, 
  className,
  isInSlot = false 
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
      case 'currentWeek':
        data = cp?.projections?.currentWeek;
        break;
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
        if (['currentWeek', 'restOfSeason'].includes(view)) {
             return {
                goals: 0,
                assists: 0,
                points: 0,
                plusMinus: 0,
                shots: 0,
                gamesPlayed: 0,
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
    const gaa = data.icetime && parseFloat(String(data.icetime)) > 0 && data.goals 
       ? (parseFloat(String(data.goals)) * 3600) / parseFloat(String(data.icetime)) 
       : 0;
    const savePct = data.ongoal && parseFloat(String(data.ongoal)) > 0
       ? (parseFloat(String(data.ongoal)) - parseFloat(String(data.goals || 0))) / parseFloat(String(data.ongoal))
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

  const hasGameToday = player.nextGame?.isToday;
  const projectedPoints = hasGameToday ? (player.projectedPoints || 0) : 0;
  const maxProjectedPoints = 8; 
  const projectionPercentage = Math.min((projectedPoints / maxProjectedPoints) * 100, 100);

  const dragProps = draggable ? {
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
        "relative overflow-hidden cursor-grab active:cursor-grabbing transition-all",
        "border hover:shadow-md h-[110px] flex flex-col",
        isInSlot 
          ? "border-border/60 bg-card" 
          : "border-border/40 hover:border-primary/50",
        isDragging && "shadow-xl z-50 opacity-90",
        className
      )}
      onClick={onClick}
    >
      {/* Compact Header Section */}
      <div className="relative p-1.5 bg-muted/30 border-b border-border/30 flex items-center gap-1.5 min-h-[35px]">
        {getStatusBadge()}

        {/* Team Logo */}
        <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center bg-white rounded-full shadow-sm p-0.5">
           {!imageError ? (
             <img 
               src={teamLogoUrl} 
               alt={teamAbbr} 
               className="w-full h-full object-contain"
               onError={() => setImageError(true)}
             />
           ) : (
             <Shield className="w-4 h-4 text-muted-foreground/50" />
           )}
        </div>

        {/* Player Name and Team */}
        <div className="flex-1 min-w-0 pr-5">
          <h3 
            className="font-semibold text-[10px] leading-3 line-clamp-2 cursor-pointer hover:underline decoration-primary/50"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            {player.name}
          </h3>
          <div className="flex items-center text-[8px] text-muted-foreground mt-0.5 gap-1">
            <span className="font-medium">{teamAbbr}</span>
            <span>•</span>
            <span>#{player.number}</span>
            {(player.status === 'IR' || player.status === 'SUSP') && (
              <Plus className="w-3 h-3 text-red-500 ml-0.5 flex-shrink-0 stroke-[3]" />
            )}
          </div>
        </div>

        {/* Position Badge - absolute top right */}
        <Badge 
          variant="outline"
          className="absolute top-0.5 right-0.5 text-[8px] font-bold h-3 px-1 border-border/50 bg-background/50"
        >
          {positionAbbr}
        </Badge>
      </div>

      {/* Compact Stats Grid - Flex grow to fill space */}
      <div className="p-1 bg-card flex-1 flex items-center justify-center">
        {isGoalie ? (
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
        ) : (
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
        )}
      </div>

      {/* Projected Points / Game Bar */}
      <div className="px-1.5 pb-1.5 pt-1 bg-muted/20 flex flex-col justify-center gap-1 border-t border-border/30 min-h-[28px]">
        <div className="flex items-center justify-between h-3">
          <div className="flex items-center gap-1">
            {hasGameToday && player.nextGame ? (
              <>
                <CalendarDays className="w-2 h-2 text-green-600" />
                <span className="text-[8px] font-bold text-green-700 truncate max-w-[50px]">
                   {player.nextGame.opponent}
                </span>
                {player.nextGame.gameTime && (
                  <span className="text-[7px] text-green-600/80 font-medium">
                    {player.nextGame.gameTime}
                  </span>
                )}
              </>
            ) : (
               <span className="text-[8px] text-muted-foreground/50">No Game</span>
            )}
          </div>
          
          <div className="flex items-center gap-0.5">
             <span className="text-[7px] text-muted-foreground uppercase font-medium">PROJ</span>
             <span className={cn(
               "text-[9px] font-bold",
               hasGameToday ? "text-primary" : "text-muted-foreground"
             )}>
                 {projectedPoints.toFixed(1)}
             </span>
          </div>
        </div>
        
        <div className="h-1 bg-muted/50 rounded-full overflow-hidden border border-border/10 w-full">
          <div 
            className={cn("h-full rounded-full transition-all duration-500", 
              hasGameToday ? "bg-green-500" : "bg-transparent" 
            )}
            style={{ width: `${projectionPercentage}%` }}
          />
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
