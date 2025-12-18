import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getWeekDateLabel } from '@/utils/weekCalculator';

interface MatchupScheduleSelectorProps {
  currentWeek: number;
  scheduleLength: number;
  availableWeeks: number[];
  onWeekChange: (week: number) => void;
  firstWeekStart: Date | null;
}

export const MatchupScheduleSelector: React.FC<MatchupScheduleSelectorProps> = ({
  currentWeek,
  scheduleLength,
  availableWeeks,
  onWeekChange,
  firstWeekStart
}) => {
  const isFirstWeek = currentWeek === 1;
  const isLastWeek = currentWeek === scheduleLength;

  const handlePrevious = () => {
    if (!isFirstWeek) {
      const prevWeek = availableWeeks[availableWeeks.indexOf(currentWeek) - 1];
      if (prevWeek) onWeekChange(prevWeek);
    }
  };

  const handleNext = () => {
    if (!isLastWeek) {
      const nextWeek = availableWeeks[availableWeeks.indexOf(currentWeek) + 1];
      if (nextWeek) onWeekChange(nextWeek);
    }
  };

  return (
    <div className="flex items-center gap-3 bg-primary/10 p-2 rounded-lg border border-primary/20">
      {/* Previous Week Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handlePrevious}
        disabled={isFirstWeek}
        className="h-8 w-8 p-0 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fantasy-primary/10"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {/* Week Display and Selector */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-sm font-medium text-muted-foreground">
          Week {currentWeek} of {scheduleLength}
        </span>
        <Select 
          value={currentWeek.toString()} 
          onValueChange={(value) => onWeekChange(parseInt(value))}
        >
          <SelectTrigger className="w-[180px] h-8 border-fantasy-primary/30 bg-primary/5 hover:bg-primary/10 text-xs">
            <SelectValue>
              {firstWeekStart ? getWeekDateLabel(currentWeek, firstWeekStart) : `Week ${currentWeek}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            {availableWeeks.map((week) => (
              <SelectItem 
                key={week} 
                value={week.toString()}
                className="cursor-pointer text-xs"
              >
                {firstWeekStart ? getWeekDateLabel(week, firstWeekStart) : `Week ${week}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Next Week Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleNext}
        disabled={isLastWeek}
        className="h-8 w-8 p-0 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-fantasy-primary/10"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

