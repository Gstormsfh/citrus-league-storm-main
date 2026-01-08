import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Lock, CheckCircle2 } from 'lucide-react';
import { getTodayMST } from '@/utils/timezoneUtils';

import { MatchupPlayer } from './types';

interface WeeklyScheduleProps {
  weekStart: string; // Monday date (YYYY-MM-DD)
  weekEnd: string; // Sunday date (YYYY-MM-DD)
  myStarters: MatchupPlayer[]; // Starting lineup players for my team
  opponentStarters: MatchupPlayer[]; // Starting lineup players for opponent team
  onDayClick: (date: string | null) => void; // null clears selection (returns to full week view)
  selectedDate: string | null;
  // Daily stats map: date -> player_id -> daily stats (including daily_total_points)
  dailyStatsByDate: Map<string, Map<number, { daily_total_points: number }>>;
  team1Name?: string; // Team 1 name for display
  team2Name?: string; // Team 2 name for display
  // Cached scores for past days (frozen, won't change when roster changes)
  cachedDailyScores?: Map<string, { myScore: number; oppScore: number; isLocked: boolean }>;
}

export const WeeklySchedule = ({
  weekStart,
  weekEnd,
  myStarters,
  opponentStarters,
  onDayClick,
  selectedDate,
  dailyStatsByDate,
  team1Name,
  team2Name,
  cachedDailyScores,
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
      {/* Header row with view indicator and Full Week button */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-muted-foreground">
          {selectedDate ? (
            <span className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider">Viewing:</span>
              <span className="text-foreground">{formatDateLabel(selectedDate)}</span>
            </span>
          ) : (
            <span className="text-xs uppercase tracking-wider">Week Overview</span>
          )}
        </div>
        {selectedDate && (
          <button
            onClick={() => onDayClick(null)}
            className="px-3 py-1.5 text-xs font-medium rounded-md 
              bg-muted hover:bg-muted/80 
              text-foreground border border-border
              transition-colors flex items-center gap-1"
          >
            <span>←</span>
            <span>Full Week</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1.5 md:gap-2">
        {dates.map((date, index) => {
          const isTodayDate = isToday(date);
          const isPastDate = isPast(date);
          const isSelectedDate = isSelected(date);
          
          // Yahoo/Sleeper-style scoring: Use cached scores for past days, live calculation for today/future
          const cachedScore = cachedDailyScores?.get(date);
          
          let myDailyPointsForDay: number;
          let oppDailyPointsForDay: number;
          
          if (isPastDate && cachedScore?.isLocked) {
            // Past day: Use frozen cached score (won't change when roster changes)
            myDailyPointsForDay = cachedScore.myScore;
            oppDailyPointsForDay = cachedScore.oppScore;
          } else {
            // Today or future: Calculate from current roster (reflects roster changes)
            const dayStats = dailyStatsByDate.get(date);
            myDailyPointsForDay = dayStats 
              ? myStarters.reduce((sum, player) => {
                  const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
                  const playerStats = dayStats.get(playerId);
                  return sum + (playerStats?.daily_total_points ?? 0);
                }, 0)
              : 0;
            oppDailyPointsForDay = dayStats
              ? opponentStarters.reduce((sum, player) => {
                  const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
                  const playerStats = dayStats.get(playerId);
                  return sum + (playerStats?.daily_total_points ?? 0);
                }, 0)
              : 0;
          }

          return (
            <Card
              key={date}
              className={cn(
                "cursor-pointer transition-all hover:shadow-sm",
                isSelectedDate && "ring-1.5 ring-[hsl(var(--vibrant-green))] shadow-md",
                isTodayDate && !isSelectedDate && "ring-1.5 ring-[hsl(var(--vibrant-orange))]",
                isPastDate && "opacity-70"
              )}
              onClick={() => onDayClick(date)}
            >
              <CardContent className="p-2">
                <div className="flex flex-col items-center gap-1">
                  {/* Day Label - Ultra Compact */}
                  <div className={cn(
                    "text-[9px] font-semibold uppercase tracking-wider leading-none",
                    isTodayDate ? "text-[hsl(var(--vibrant-orange))]" : "text-muted-foreground"
                  )}>
                    {formatDayLabel(date)}
                  </div>

                  {/* Date - Compact */}
                  <div className={cn(
                    "text-[10px] font-bold leading-tight",
                    isTodayDate ? "text-[hsl(var(--vibrant-orange))]" : "text-foreground"
                  )}>
                    {formatDateLabel(date)}
                  </div>

                  {/* Status Indicator - Minimal */}
                  {isTodayDate && !isPastDate && (
                    <Badge variant="default" className="text-[8px] py-0 px-1 h-3.5 bg-[hsl(var(--vibrant-orange))] leading-none">
                      Today
                    </Badge>
                  )}

                  {/* Points Display - Streamlined */}
                  <div className="w-full mt-1 space-y-1">
                    {/* Team 1 */}
                    <div className="flex flex-col gap-0">
                      <div className="text-[8px] text-muted-foreground/70 font-medium leading-tight line-clamp-2 min-h-[1.5rem] flex items-center justify-center text-center px-0.5" title={team1Name || 'My Team'}>
                        {team1Name || 'My'}
                      </div>
                      <div className={cn(
                        "text-xs font-bold text-center leading-tight",
                        myDailyPointsForDay > 0 ? "text-[hsl(var(--vibrant-green))]" : "text-muted-foreground/60"
                      )}>
                        {myDailyPointsForDay.toFixed(1)}
                      </div>
                    </div>
                    
                    {/* Divider - Subtle */}
                    <div className="h-[0.5px] bg-border/30 w-full"></div>
                    
                    {/* Team 2 */}
                    <div className="flex flex-col gap-0">
                      <div className="text-[8px] text-muted-foreground/70 font-medium leading-tight line-clamp-2 min-h-[1.5rem] flex items-center justify-center text-center px-0.5" title={team2Name || 'Opponent'}>
                        {team2Name || 'Opp'}
                      </div>
                      <div className={cn(
                        "text-xs font-bold text-center leading-tight",
                        oppDailyPointsForDay > 0 ? "text-foreground/70" : "text-muted-foreground/60"
                      )}>
                        {oppDailyPointsForDay.toFixed(1)}
                      </div>
                    </div>
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
