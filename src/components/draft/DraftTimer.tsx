import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Clock, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraftTimerProps {
  timeRemaining: number;
  isActive: boolean;
  totalTime?: number;
}

export const DraftTimer = ({ timeRemaining, isActive, totalTime = 90 }: DraftTimerProps) => {
  const progress = ((totalTime - timeRemaining) / totalTime) * 100;
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const totalMinutes = Math.floor(totalTime / 60);
  const totalSeconds = totalTime % 60;
  
  const getTimerColor = () => {
    if (timeRemaining > totalTime * 0.33) return 'text-green-600';
    if (timeRemaining > totalTime * 0.11) return 'text-orange-600';
    return 'text-red-600';
  };

  const getProgressColor = () => {
    if (timeRemaining > totalTime * 0.33) return 'bg-green-500';
    if (timeRemaining > totalTime * 0.11) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <Card className="p-4 min-w-[140px]">
      <div className="flex items-center gap-2 mb-3">
        {isActive ? (
          <Clock className="h-4 w-4 text-primary" />
        ) : (
          <Pause className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {isActive ? 'Time Left' : 'Paused'}
        </span>
      </div>
      
      <div className="text-center mb-3">
        <div className={cn(
          'text-2xl font-bold tabular-nums',
          isActive ? getTimerColor() : 'text-muted-foreground'
        )}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
      </div>
      
      <div className="space-y-2">
        <Progress 
          value={progress} 
          className="h-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0:00</span>
          <span>{String(totalMinutes).padStart(2, '0')}:{String(totalSeconds).padStart(2, '0')}</span>
        </div>
      </div>
      
      {timeRemaining <= 10 && isActive && (
        <div className="mt-2 text-xs text-red-600 font-medium text-center animate-pulse">
          TIME RUNNING OUT!
        </div>
      )}
    </Card>
  );
};