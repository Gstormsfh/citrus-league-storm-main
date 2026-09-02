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
  /**
   * Just the week select, as a small `Wk 5 ▾` trigger (2026-09-01, audit
   * R4). The phone roster chrome sits it beside the seven day chips so week
   * and day are one row; the prev/next buttons and the varsity bar are the
   * desktop's. Same items, same handler — only the trigger is smaller.
   */
  compact?: boolean;
}

export const MatchupScheduleSelector: React.FC<MatchupScheduleSelectorProps> = ({
  currentWeek,
  scheduleLength,
  availableWeeks,
  onWeekChange,
  firstWeekStart,
  compact = false,
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

  if (compact) {
    return (
      <Select
        value={currentWeek.toString()}
        onValueChange={(value) => onWeekChange(parseInt(value))}
      >
        <SelectTrigger
          aria-label={`Week ${currentWeek} of ${scheduleLength}`}
          data-testid="week-select-compact"
          className="h-8 w-auto shrink-0 gap-1 rounded-lg border-white/10 bg-white/5 px-2 py-0 font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-cream ring-offset-0 focus:ring-1 focus:ring-pastel-sage/60 focus:ring-offset-0 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-70"
        >
          <SelectValue>
            <span className="tabular-nums">Wk {currentWeek}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[300px] bg-[#1A2A20] border border-white/10 rounded-lg">
          {availableWeeks.map((week) => (
            <SelectItem
              key={week}
              value={week.toString()}
              className="cursor-pointer font-display text-xs hover:bg-pastel-sage/20 focus:bg-pastel-sage/20"
            >
              <span className="font-jbmono text-[10px] font-bold uppercase tracking-[0.12em] tabular-nums text-pastel-cream">
                Wk {week}
              </span>
              {firstWeekStart && (
                <span className="ml-2 text-white/55">{getWeekDateLabel(week, firstWeekStart)}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-citrus-sage/20 via-citrus-peach/10 to-citrus-sage/20 p-3 rounded-varsity border-3 border-citrus-sage/40 shadow-patch relative">
      {/* Vintage texture */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:24px_24px] opacity-5 rounded-varsity"></div>

      {/* Previous Week Button - Varsity Style */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handlePrevious}
        disabled={isFirstWeek}
        className="relative z-10 h-9 w-9 p-0 rounded-lg bg-white/5 border-2 border-citrus-sage/50 hover:bg-citrus-sage hover:scale-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
      >
        <ChevronLeft className="h-5 w-5 text-pastel-cream" aria-hidden="true" />
      </Button>

      {/* Week Display and Selector - Championship Style */}
      <div className="flex items-center gap-3 flex-1 relative z-10">
        <span className="font-varsity text-xs font-black text-pastel-cream uppercase tracking-wider">
          Week {currentWeek}/{scheduleLength}
        </span>
        <Select
          value={currentWeek.toString()}
          onValueChange={(value) => onWeekChange(parseInt(value))}
        >
          <SelectTrigger className="flex-1 h-9 border-2 border-citrus-sage/50 bg-white/5 hover:bg-citrus-sage/10 font-display font-bold text-xs rounded-lg shadow-sm text-pastel-cream">
            <SelectValue>
              {firstWeekStart ? getWeekDateLabel(currentWeek, firstWeekStart) : `Week ${currentWeek}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-[300px] bg-[#1A2A20] border-2 border-citrus-sage/40 rounded-lg shadow-varsity">
            {availableWeeks.map((week) => (
              <SelectItem
                key={week}
                value={week.toString()}
                className="cursor-pointer font-display text-xs hover:bg-citrus-sage/20 focus:bg-citrus-sage/20"
              >
                {firstWeekStart ? getWeekDateLabel(week, firstWeekStart) : `Week ${week}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Next Week Button - Varsity Style */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleNext}
        disabled={isLastWeek}
        className="relative z-10 h-9 w-9 p-0 rounded-lg bg-white/5 border-2 border-citrus-sage/50 hover:bg-citrus-sage hover:scale-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
      >
        <ChevronRight className="h-5 w-5 text-pastel-cream" aria-hidden="true" />
      </Button>
    </div>
  );
};

