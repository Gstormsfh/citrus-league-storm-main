import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Clock, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraftTimerProps {
  timeRemaining: number;
  isActive: boolean;
  totalTime?: number;
}

export const DraftTimer = memo(({ timeRemaining, isActive, totalTime = 90 }: DraftTimerProps) => {
  const clamped = Math.max(0, timeRemaining);
  const progress = Math.min(100, ((totalTime - clamped) / totalTime) * 100);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
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
    <>
      {/* Mobile: Compact inline timer */}
      <div className="md:hidden flex items-center gap-1.5" role="timer" aria-label={`Draft timer: ${minutes} minutes ${seconds} seconds remaining`}>
        {isActive ? (
          <Clock className="h-3.5 w-3.5 text-primary flex-shrink-0" aria-hidden="true" />
        ) : (
          <Pause className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        )}
        <div className={cn(
          'text-lg font-bold tabular-nums leading-none',
          isActive ? getTimerColor() : 'text-muted-foreground'
        )}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
        {timeRemaining <= 10 && isActive && (
          <span className="sr-only" aria-live="assertive">
            {timeRemaining} seconds remaining
          </span>
        )}
      </div>

      {/* Desktop: Full card timer */}
      <Card className="hidden md:block p-4 min-w-[140px]" role="timer" aria-label={`Draft timer: ${minutes} minutes ${seconds} seconds remaining`}>
        <div className="flex items-center gap-2 mb-3">
          {isActive ? (
            <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <Pause className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-sm font-medium">
            {isActive ? 'Time Left' : 'Paused'}
          </span>
        </div>

        {timeRemaining <= 10 && isActive && (
          <span className="sr-only" aria-live="assertive">
            {timeRemaining} seconds remaining
          </span>
        )}

        <div className="text-center mb-3">
          <div className={cn(
            'text-2xl font-bold tabular-nums',
            isActive ? getTimerColor() : 'text-muted-foreground'
          )} aria-hidden="true">
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
    </>
  );
});
