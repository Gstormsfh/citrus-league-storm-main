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
  // Determine color and label based on difficulty
  const getConfig = (diff: number) => {
    if (diff <= 0.95) {
      return { 
        color: 'bg-emerald-500', 
        textColor: 'text-emerald-500',
        borderColor: 'border-emerald-500',
        label: 'Easy', 
        description: 'Favorable matchup - weak defense'
      };
    }
    if (diff <= 1.05) {
      return { 
        color: 'bg-amber-500', 
        textColor: 'text-amber-500',
        borderColor: 'border-amber-500',
        label: 'Avg', 
        description: 'Average matchup'
      };
    }
    return { 
      color: 'bg-rose-500', 
      textColor: 'text-rose-500',
      borderColor: 'border-rose-500',
      label: 'Tough', 
      description: 'Tough matchup - strong defense'
    };
  };

  const config = getConfig(difficulty);
  
  // Size variants
  const sizeClasses = {
    sm: 'text-[9px] px-1 py-0.5',
    md: 'text-[10px] px-1.5 py-0.5',
    lg: 'text-xs px-2 py-1'
  };

  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5'
  };

  const badge = (
    <div 
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold",
        sizeClasses[size],
        showLabel ? `${config.color} text-white` : `border ${config.borderColor} bg-transparent`,
        className
      )}
    >
      {/* Difficulty indicator dot */}
      <span className={cn(
        "rounded-full",
        dotSizes[size],
        config.color
      )} />
      
      {/* Opponent abbreviation or label */}
      {showLabel ? (
        <span>{config.label}</span>
      ) : opponent ? (
        <span className={config.textColor}>@{opponent}</span>
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
          className="bg-slate-900 text-white p-2 rounded-lg shadow-lg border-0"
        >
          <div className="text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", config.color)} />
              {config.label} Matchup
              {opponent && <span className="text-slate-400">vs {opponent}</span>}
            </div>
            <div className="text-slate-300">{config.description}</div>
            <div className="text-slate-400 text-[10px]">
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

