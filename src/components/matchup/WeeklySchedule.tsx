import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Lock, CheckCircle2 } from 'lucide-react';
import { getTodayMST } from '@/utils/timezoneUtils';

interface WeeklyScheduleProps {
  weekStart: string; // Monday date (YYYY-MM-DD)
  weekEnd: string; // Sunday date (YYYY-MM-DD)
  myDailyPoints: number[];
  opponentDailyPoints: number[];
  onDayClick: (date: string) => void;
  selectedDate: string | null;
}

export const WeeklySchedule = ({
  weekStart,
  weekEnd,
  myDailyPoints,
  opponentDailyPoints,
  onDayClick,
  selectedDate,
}: WeeklyScheduleProps) => {
  const todayStr = getTodayMST(); // Get today's date string in MST (YYYY-MM-DD)

  // Generate all dates in the week (Mon-Sun)
  // Parse dates carefully to avoid timezone issues
  const dates: string[] = [];
  
  // Parse weekStart and weekEnd as date strings (YYYY-MM-DD)
  // Split to avoid timezone interpretation issues
  const [startYear, startMonth, startDay] = weekStart.split('-').map(Number);
  const [endYear, endMonth, endDay] = weekEnd.split('-').map(Number);
  
  const startDate = new Date(startYear, startMonth - 1, startDay); // Month is 0-indexed
  const endDate = new Date(endYear, endMonth - 1, endDay);
  
  // Verify that startDate is actually a Monday (getDay() returns 1 for Monday)
  const startDayOfWeek = startDate.getDay();
  if (startDayOfWeek !== 1) {
    console.warn(`[WeeklySchedule] weekStart (${weekStart}) is not a Monday! Day of week: ${startDayOfWeek} (0=Sun, 1=Mon, etc.)`);
  }
  
  // Verify that endDate is actually a Sunday (getDay() returns 0 for Sunday)
  const endDayOfWeek = endDate.getDay();
  if (endDayOfWeek !== 0) {
    console.warn(`[WeeklySchedule] weekEnd (${weekEnd}) is not a Sunday! Day of week: ${endDayOfWeek} (0=Sun, 1=Mon, etc.)`);
  }
  
  const current = new Date(startDate);

  // Generate dates from Monday to Sunday (7 days)
  while (current <= endDate) {
    // Format as YYYY-MM-DD to match database format
    // Use local date components to avoid timezone issues
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  
  // Ensure we have exactly 7 days (Mon-Sun)
  if (dates.length !== 7) {
    console.warn(`[WeeklySchedule] Expected 7 days but got ${dates.length}. Week: ${weekStart} to ${weekEnd}`, {
      dates,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      todayStr
    });
  }
  
  // Debug: Log first and last day to verify Monday-Sunday
  if (dates.length > 0) {
    // Parse dates consistently to avoid timezone issues
    const [firstYear, firstMonth, firstDay] = dates[0].split('-').map(Number);
    const [lastYear, lastMonth, lastDay] = dates[dates.length - 1].split('-').map(Number);
    const firstDayDate = new Date(firstYear, firstMonth - 1, firstDay);
    const lastDayDate = new Date(lastYear, lastMonth - 1, lastDay);
    const firstDayName = firstDayDate.toLocaleDateString('en-US', { weekday: 'long' });
    const lastDayName = lastDayDate.toLocaleDateString('en-US', { weekday: 'long' });
    console.log(`[WeeklySchedule] Week: ${dates[0]} (${firstDayName}) to ${dates[dates.length - 1]} (${lastDayName}), Today: ${todayStr}`);
  }

  const formatDayLabel = (dateStr: string): string => {
    // Parse date string (YYYY-MM-DD) to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // Month is 0-indexed
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  };

  const formatDateLabel = (dateStr: string): string => {
    // Parse date string (YYYY-MM-DD) to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // Month is 0-indexed
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isToday = (dateStr: string): boolean => {
    return dateStr === todayStr;
  };

  const isPast = (dateStr: string): boolean => {
    if (dateStr === todayStr) return false; // Today is not past
    // Compare date strings directly (YYYY-MM-DD format)
    return dateStr < todayStr;
  };

  const isSelected = (dateStr: string): boolean => {
    return selectedDate === dateStr;
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-7 gap-2 md:gap-3">
        {dates.map((date, index) => {
          const isTodayDate = isToday(date);
          const isPastDate = isPast(date);
          const isSelectedDate = isSelected(date);
          
          // Calculate cumulative week-to-date points (Monday + Tuesday + ... + this day)
          const myCumulativePoints = myDailyPoints.slice(0, index + 1).reduce((sum, pts) => sum + pts, 0);
          const oppCumulativePoints = opponentDailyPoints.slice(0, index + 1).reduce((sum, pts) => sum + pts, 0);
          const totalCumulativePoints = myCumulativePoints + oppCumulativePoints;
          
          // Also get just this day's points for reference
          const myDailyPointsForDay = myDailyPoints[index] || 0;
          const oppDailyPointsForDay = opponentDailyPoints[index] || 0;

          return (
            <Card
              key={date}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md",
                isSelectedDate && "ring-2 ring-[hsl(var(--vibrant-green))] shadow-lg",
                isTodayDate && !isSelectedDate && "ring-2 ring-[hsl(var(--vibrant-orange))]",
                isPastDate && "opacity-75"
              )}
              onClick={() => onDayClick(date)}
            >
              <CardContent className="p-3 md:p-4">
                <div className="flex flex-col items-center gap-2">
                  {/* Day Label */}
                  <div className={cn(
                    "text-xs font-semibold uppercase tracking-wider",
                    isTodayDate ? "text-[hsl(var(--vibrant-orange))]" : "text-muted-foreground"
                  )}>
                    {formatDayLabel(date)}
                  </div>

                  {/* Date */}
                  <div className={cn(
                    "text-sm font-bold",
                    isTodayDate ? "text-[hsl(var(--vibrant-orange))]" : "text-foreground"
                  )}>
                    {formatDateLabel(date)}
                  </div>

                  {/* Status Indicator */}
                  {isTodayDate && !isPastDate && (
                    <Badge variant="default" className="text-xs py-0.5 px-2 bg-[hsl(var(--vibrant-orange))]">
                      Today
                    </Badge>
                  )}

                  {/* Points Display - Cumulative Week-to-Date */}
                  <div className="w-full mt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">My</span>
                      <span className={cn(
                        "font-bold",
                        myCumulativePoints > 0 ? "text-[hsl(var(--vibrant-green))]" : "text-muted-foreground"
                      )}>
                        {myCumulativePoints.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Opp</span>
                      <span className={cn(
                        "font-bold",
                        oppCumulativePoints > 0 ? "text-foreground/80" : "text-muted-foreground"
                      )}>
                        {oppCumulativePoints.toFixed(1)}
                      </span>
                    </div>
                    {totalCumulativePoints > 0 && (
                      <div className="pt-1 border-t border-border/50">
                        <div className="text-center text-xs font-semibold text-foreground">
                          {totalCumulativePoints.toFixed(1)} total
                        </div>
                        <div className="text-center text-[10px] text-muted-foreground mt-0.5">
                          Week-to-date
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
