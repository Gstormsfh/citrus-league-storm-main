import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Lock, CheckCircle2 } from 'lucide-react';
import { getTodayMST } from '@/utils/timezoneUtils';
import { CitrusSparkle } from '@/components/icons/CitrusIcons';

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
  // DIRECT daily breakdown from myTeamPoints/opponentTeamPoints calculation (SINGLE SOURCE OF TRUTH)
  myDailyBreakdown?: Map<string, number>;
  oppDailyBreakdown?: Map<string, number>;
  hideScores?: boolean; // If true, hide the points display (for Roster tab)
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
  myDailyBreakdown,
  oppDailyBreakdown,
  hideScores = false,
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
      <div className="flex items-center justify-between mb-3 p-2 bg-gradient-to-r from-citrus-sage/10 via-citrus-cream to-citrus-peach/10 rounded-xl border-2 border-citrus-sage/30">
        <div className="text-sm font-varsity font-bold text-citrus-forest flex items-center gap-2">
          {selectedDate ? (
            <span className="flex items-center gap-2">
              <CitrusSparkle className="w-4 h-4 text-citrus-orange" />
              <span className="text-xs uppercase tracking-wide">Viewing:</span>
              <span className="text-citrus-orange">{formatDateLabel(selectedDate)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <CitrusSparkle className="w-4 h-4 text-citrus-orange" />
              <span className="text-xs uppercase tracking-wide">Week Overview</span>
            </span>
          )}
        </div>
        {selectedDate && (
          <button
            onClick={() => onDayClick(null)}
            className="px-3 py-1.5 text-xs font-varsity font-bold uppercase rounded-xl 
              bg-citrus-sage/20 hover:bg-citrus-sage 
              text-citrus-forest border-2 border-citrus-sage hover:text-citrus-cream
              transition-all flex items-center gap-1 shadow-sm hover:shadow-patch hover:-translate-y-0.5"
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
          
          // USE DIRECT BREAKDOWN - from the exact same calculation that drives bottom totals
          // undefined means not calculated yet, 0 means calculated as 0
          const myDailyPointsForDay = myDailyBreakdown?.get(date);
          const oppDailyPointsForDay = oppDailyBreakdown?.get(date);

          return (
            <Card
              key={date}
              className={cn(
                "cursor-pointer transition-all hover:shadow-patch hover:-translate-y-1 border-3 rounded-xl overflow-hidden bg-citrus-cream",
                isSelectedDate && "ring-4 ring-citrus-sage shadow-varsity border-citrus-sage",
                isTodayDate && !isSelectedDate && "ring-3 ring-citrus-orange border-citrus-orange",
                !isSelectedDate && !isTodayDate && "border-citrus-sage/40",
                isPastDate && "opacity-75"
              )}
              onClick={() => onDayClick(date)}
            >
              <CardContent className="p-2 relative">
                {/* Subtle corduroy texture */}
                <div className="absolute inset-0 opacity-10 corduroy-texture pointer-events-none"></div>
                
                <div className="flex flex-col items-center gap-1 relative z-10">
                  {/* Day Label - Ultra Compact */}
                  <div className={cn(
                    "text-[10px] font-varsity font-black uppercase tracking-wider leading-none",
                    isTodayDate ? "text-citrus-orange" : "text-citrus-charcoal"
                  )}>
                    {formatDayLabel(date)}
                  </div>

                  {/* Date - Compact */}
                  <div className={cn(
                    "text-xs font-varsity font-bold leading-tight",
                    isTodayDate ? "text-citrus-orange" : "text-citrus-forest"
                  )}>
                    {formatDateLabel(date)}
                  </div>

                  {/* Status Indicator - Minimal */}
                  {isTodayDate && !isPastDate && (
                    <Badge variant="default" className="text-[8px] py-0.5 px-1.5 h-4 bg-citrus-orange border-2 border-citrus-forest text-citrus-cream leading-none font-varsity font-bold shadow-sm">
                      Today
                    </Badge>
                  )}

                  {/* Points Display - Streamlined (hidden if hideScores is true) */}
                  {!hideScores && (
                    <div className="w-full mt-1.5 space-y-1">
                      {/* Team 1 */}
                      <div className="flex flex-col gap-0.5 p-1 bg-citrus-sage/10 rounded-md border border-citrus-sage/30">
                        <div className="text-[8px] font-display font-semibold text-citrus-charcoal leading-tight line-clamp-1 text-center px-0.5" title={team1Name || 'My Team'}>
                          {team1Name || 'My'}
                        </div>
                        <div className={cn(
                          "text-sm font-varsity font-black text-center leading-tight",
                          myDailyPointsForDay !== undefined && myDailyPointsForDay > 0 ? "text-citrus-sage" : "text-citrus-charcoal/50"
                        )}>
                          {myDailyPointsForDay !== undefined ? myDailyPointsForDay.toFixed(1) : '--'}
                        </div>
                      </div>
                      
                      {/* Divider - Subtle */}
                      <div className="h-[1px] bg-citrus-sage/20 w-full"></div>
                      
                      {/* Team 2 */}
                      <div className="flex flex-col gap-0.5 p-1 bg-citrus-peach/10 rounded-md border border-citrus-peach/30">
                        <div className="text-[8px] font-display font-semibold text-citrus-charcoal leading-tight line-clamp-1 text-center px-0.5" title={team2Name || 'Opponent'}>
                          {team2Name || 'Opp'}
                        </div>
                        <div className={cn(
                          "text-sm font-varsity font-black text-center leading-tight",
                          oppDailyPointsForDay !== undefined && oppDailyPointsForDay > 0 ? "text-citrus-peach" : "text-citrus-charcoal/50"
                        )}>
                          {oppDailyPointsForDay !== undefined ? oppDailyPointsForDay.toFixed(1) : '--'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
