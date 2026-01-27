/**
 * MatchupBadge Component
 * Displays a visual indicator of matchup difficulty (how favorable the opponent is)
 * 
 * Scale:
 * - 0.8-0.95: Easy (Green) - Weak opponent defense, favorable for fantasy
 * - 0.95-1.05: Average (Yellow) - Neutral matchup
 * - 1.05-1.2: Tough (Red) - Strong opponent defense, unfavorable for fantasy
 */

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MatchupBadgeProps {
  difficulty: number; // 0.8 to 1.2 scale
  opponent?: string; // Team abbreviation (e.g., "TOR")
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export const MatchupBadge = ({ 
  difficulty, 
  opponent, 
  size = 'sm',
  showLabel = false,
  className 
}: MatchupBadgeProps) => {
  // Determine color and label - CITRUS THEME COLORS!
  const getConfig = (diff: number) => {
    if (diff <= 0.95) {
      return { 
        color: 'bg-citrus-sage', 
        textColor: 'text-citrus-sage',
        borderColor: 'border-citrus-sage',
        label: 'Easy', 
        description: 'Favorable matchup - weak defense'
      };
    }
    if (diff <= 1.05) {
      return { 
        color: 'bg-citrus-peach', 
        textColor: 'text-citrus-orange',
        borderColor: 'border-citrus-peach',
        label: 'Avg', 
        description: 'Average matchup'
      };
    }
    return { 
      color: 'bg-citrus-orange', 
      textColor: 'text-citrus-orange',
      borderColor: 'border-citrus-orange',
      label: 'Tough', 
      description: 'Tough matchup - strong defense'
    };
  };

  const config = getConfig(difficulty);
  
  // PREMIUM SIZE VARIANTS - Surfer Varsity Style
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-1',
    md: 'text-[11px] px-2.5 py-1',
    lg: 'text-xs px-3 py-1.5'
  };

  const dotSizes = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3'
  };

  const badge = (
    <div 
      className={cn(
        "inline-flex items-center gap-1.5 rounded-varsity font-display font-bold transition-all duration-200 hover:scale-105",
        sizeClasses[size],
        showLabel 
          ? `${config.color} text-[#E8EED9] border-2 border-citrus-forest/20 shadow-patch` 
          : `border-2 ${config.borderColor} bg-[#E8EED9]/50 backdrop-blur-sm/80 backdrop-blur-sm`,
        className
      )}
    >
      {/* Premium Difficulty Dot with Glow */}
      <span className={cn(
        "rounded-full relative flex items-center justify-center",
        dotSizes[size],
        config.color,
        "shadow-sm"
      )}>
        {/* Inner shine */}
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-white/40 to-transparent"></span>
      </span>
      
      {/* Opponent/Label Text */}
      {showLabel ? (
        <span className="uppercase tracking-wide">{config.label}</span>
      ) : opponent ? (
        <span className={cn(config.textColor, "font-varsity font-black tracking-wide")}>@{opponent}</span>
      ) : null}
    </div>
  );

  // Wrap with tooltip for detailed info
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="bg-citrus-forest text-[#E8EED9] p-3 rounded-varsity shadow-varsity border-2 border-citrus-sage"
        >
          <div className="text-xs space-y-1.5">
            <div className="font-varsity flex items-center gap-2">
              <span className={cn("w-2.5 h-2.5 rounded-full shadow-sm", config.color)} />
              <span className="uppercase tracking-wide">{config.label} Matchup</span>
              {opponent && <span className="text-citrus-sage font-display">vs {opponent}</span>}
            </div>
            <div className="text-[#E8EED9]/90 font-display">{config.description}</div>
            <div className="text-citrus-sage text-[10px] font-display">
              Difficulty: {difficulty.toFixed(2)}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * Compact version for use in player cards
 */
export const MatchupDot = ({ difficulty }: { difficulty: number }) => {
  const color = 
    difficulty <= 0.95 ? 'bg-emerald-500' :
    difficulty <= 1.05 ? 'bg-amber-500' :
    'bg-rose-500';

  return <span className={cn("w-1.5 h-1.5 rounded-full inline-block", color)} />;
};

/**
 * ROSProjection Component
 * Displays rest-of-season projection summary
 */
interface ROSProjectionProps {
  totalPoints: number;
  gamesRemaining: number;
  avgPpg?: number;
  className?: string;
}

export const ROSProjection = ({ 
  totalPoints, 
  gamesRemaining, 
  avgPpg,
  className 
}: ROSProjectionProps) => {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div className={cn(
            "inline-flex items-center gap-1 text-xs bg-slate-800 px-2 py-1 rounded-md",
            className
          )}>
            <span className="text-slate-400">ROS:</span>
            <span className="font-bold text-white">{totalPoints.toFixed(1)}</span>
            <span className="text-slate-500">pts</span>
          </div>
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="bg-slate-900 text-white p-2 rounded-lg shadow-lg border-0"
        >
          <div className="text-xs space-y-1">
            <div className="font-semibold">Rest of Season Projection</div>
            <div className="grid grid-cols-2 gap-x-4 text-slate-300">
              <span>Total Points:</span>
              <span className="font-bold text-white">{totalPoints.toFixed(1)}</span>
              <span>Games Left:</span>
              <span className="font-bold text-white">{gamesRemaining}</span>
              {avgPpg !== undefined && (
                <>
                  <span>Avg PPG:</span>
                  <span className="font-bold text-white">{avgPpg.toFixed(2)}</span>
                </>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default MatchupBadge;

