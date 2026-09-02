import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getTodayMST } from '@/utils/timezoneUtils';
import { CitrusSparkle } from '@/components/icons/CitrusIcons';
import { logger } from '@/utils/logger';
import { useIsMobile } from '@/hooks/useIsMobile';

interface WeeklyScheduleProps {
  weekStart: string; // Sunday date (YYYY-MM-DD)
  weekEnd: string; // Saturday date (YYYY-MM-DD)
  onDayClick: (date: string | null) => void; // null clears selection (returns to full week view)
  selectedDate: string | null;
  team1Name?: string; // Team 1 name for display
  team2Name?: string; // Team 2 name for display
  // SINGLE SOURCE OF TRUTH: Calculated totals from MatchupComparison
  calculatedDailyTotals?: Map<string, { myTotal: number; oppTotal: number }>;
  hideScores?: boolean; // If true, hide the points display (for Roster tab)
  /**
   * One-row day picker for the phone roster chrome (2026-09-01, audit R4):
   * seven chips, weekday + day number, no scores, no header row. The
   * "Viewing:" line and the Full Week button belong to the matchup page —
   * on a lineup there is no "full week" to return to, and the selected chip
   * already says which day is open. Day-state rings are unchanged: today =
   * orange, selected = sage (selected wins), otherwise white/10.
   */
  chips?: boolean;
  /**
   * Phone chrome (2026-09-01, Sleeper parity audit M8). Below the lg
   * breakpoint the "Week Overview" / "Viewing:" header row is dropped —
   * the seven day cards say what they are, and on a phone that row was
   * the third band of chrome between the sticky bar and the first player.
   * The way back to the full week has to survive its removal, so in
   * compact mode tapping the selected day again returns to the week, and
   * a one-line "Full week" link sits under the strip while a day is
   * selected. Desktop keeps the header row exactly as it was.
   */
  compact?: boolean;
}

export const WeeklySchedule = ({
  weekStart,
  weekEnd,
  onDayClick,
  selectedDate,
  team1Name,
  team2Name,
  calculatedDailyTotals,
  hideScores = false,
  compact = false,
  chips = false,
}: WeeklyScheduleProps) => {
  const todayStr = getTodayMST(); // Get today's date string in MST (YYYY-MM-DD)
  // Below the lg breakpoint — the same line index.css's mobile block draws.
  const isPhone = useIsMobile();

  // Generate all dates in the week (Sun-Sat)
  // Parse dates carefully to avoid timezone issues
  const dates: string[] = [];
  
  // Parse weekStart and weekEnd as date strings (YYYY-MM-DD)
  // Split to avoid timezone interpretation issues
  const [startYear, startMonth, startDay] = weekStart.split('-').map(Number);
  const [endYear, endMonth, endDay] = weekEnd.split('-').map(Number);
  
  const startDate = new Date(startYear, startMonth - 1, startDay); // Month is 0-indexed
  const endDate = new Date(endYear, endMonth - 1, endDay);
  
  // Verify that startDate is actually a Sunday (getDay() returns 0 for Sunday)
  const startDayOfWeek = startDate.getDay();
  if (startDayOfWeek !== 0) {
    logger.warn(`[WeeklySchedule] weekStart (${weekStart}) is not a Sunday! Day of week: ${startDayOfWeek} (0=Sun, 1=Mon, etc.)`);
  }
  
  // Verify that endDate is actually a Saturday (getDay() returns 6 for Saturday)
  const endDayOfWeek = endDate.getDay();
  if (endDayOfWeek !== 6) {
    logger.warn(`[WeeklySchedule] weekEnd (${weekEnd}) is not a Saturday! Day of week: ${endDayOfWeek} (0=Sun, 1=Mon, etc.)`);
  }
  
  const current = new Date(startDate);

  // Generate dates from Sunday to Saturday (7 days)
  while (current <= endDate) {
    // Format as YYYY-MM-DD to match database format
    // Use local date components to avoid timezone issues
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  
  // Ensure we have exactly 7 days (Sun-Sat)
  if (dates.length !== 7) {
    logger.warn(`[WeeklySchedule] Expected 7 days but got ${dates.length}. Week: ${weekStart} to ${weekEnd}`);
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

  // Compact mode on a phone: the selected card is also the way back to the
  // full week (the header row's "Full Week" button is hidden there).
  const handleDayClick = (dateStr: string) => {
    if (compact && isSelected(dateStr) && isPhone) {
      onDayClick(null);
      return;
    }
    onDayClick(dateStr);
  };

  const formatDayNumber = (dateStr: string): string => String(Number(dateStr.split('-')[2]));

  if (chips) {
    return (
      <div className="w-full" data-testid="weekly-schedule-compact">
        <div className="grid grid-cols-7 gap-1" role="group" aria-label="Day of the week">
          {dates.map((date) => {
            const isTodayDate = isToday(date);
            const isPastDate = isPast(date);
            const isSelectedDate = isSelected(date);
            return (
              <Card
                key={date}
                role="button"
                tabIndex={0}
                aria-pressed={isSelectedDate}
                aria-label={`${formatDayLabel(date)} ${formatDateLabel(date)}${isTodayDate ? ', today' : ''}`}
                data-today={isTodayDate ? 'true' : undefined}
                data-selected={isSelectedDate ? 'true' : undefined}
                className={cn(
                  "cursor-pointer transition-all rounded-lg overflow-hidden bg-[#1A2A20] active:scale-95",
                  isSelectedDate && "ring-2 ring-pastel-sage shadow-[0_8px_24px_-8px_rgba(132,165,125,0.4)]",
                  isTodayDate && !isSelectedDate && "ring-2 ring-pastel-orange",
                  !isSelectedDate && !isTodayDate && "ring-1 ring-white/10",
                  isPastDate && "opacity-75"
                )}
                onClick={() => onDayClick(date)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onDayClick(date);
                  }
                }}
              >
                <CardContent className="p-0 py-1.5">
                  <div className="flex flex-col items-center gap-0.5 leading-none">
                    <div className={cn(
                      "font-jbmono text-[8px] font-bold uppercase tracking-[0.12em]",
                      isTodayDate ? "text-pastel-orange" : "text-white/55"
                    )}>
                      {formatDayLabel(date)}
                    </div>
                    <div className={cn(
                      "font-jbmono text-[12px] font-bold tabular-nums",
                      isTodayDate ? "text-pastel-orange" : "text-pastel-cream"
                    )}>
                      {formatDayNumber(date)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full" data-compact={compact || undefined}>
      {/* Header row with view indicator and Full Week button. In compact
          mode it is desktop-only chrome. */}
      <div
        className={cn(
          'items-center justify-between mb-1.5 md:mb-3 p-1 md:p-2 bg-white/5 rounded-xl ring-1 ring-white/10',
          compact ? 'hidden lg:flex' : 'flex',
        )}
      >
        <div className="text-[9px] md:text-sm font-varsity font-bold text-pastel-cream flex items-center gap-1 md:gap-2">
          {selectedDate ? (
            <span className="flex items-center gap-1 md:gap-2">
              <CitrusSparkle className="w-3 h-3 md:w-4 md:h-4 text-pastel-orange" aria-hidden="true" />
              <span className="text-[9px] md:text-xs uppercase tracking-wide">Viewing:</span>
              <span className="text-pastel-orange">{formatDateLabel(selectedDate)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 md:gap-2">
              <CitrusSparkle className="w-3 h-3 md:w-4 md:h-4 text-pastel-orange" aria-hidden="true" />
              <span className="text-[9px] md:text-xs uppercase tracking-wide">Week Overview</span>
            </span>
          )}
        </div>
        {selectedDate && (
          <button
            onClick={() => onDayClick(null)}
            className="focus-citrus px-2 py-1 md:px-3 md:py-1.5 text-[9px] md:text-xs font-varsity font-bold uppercase rounded-xl
              bg-pastel-sage/15 hover:bg-pastel-sage/25
              text-pastel-cream ring-1 ring-pastel-sage/40
              transition-all flex items-center gap-1 shadow-sm hover:-translate-y-0.5"
          >
            <span aria-hidden="true">←</span>
            <span>Full Week</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1 md:gap-1.5 lg:gap-2">
        {dates.map((date, index) => {
          const isTodayDate = isToday(date);
          const isPastDate = isPast(date);
          const isSelectedDate = isSelected(date);
          
          // Get scores from calculatedDailyTotals (ONLY source of truth from MatchupComparison)
          // undefined means not calculated yet, 0 means calculated as 0
          const myDailyPointsForDay = calculatedDailyTotals?.get(date)?.myTotal;
          const oppDailyPointsForDay = calculatedDailyTotals?.get(date)?.oppTotal;

          return (
            <Card
              key={date}
              data-today={isTodayDate ? 'true' : undefined}
              data-selected={isSelectedDate ? 'true' : undefined}
              className={cn(
                "cursor-pointer transition-all hover:-translate-y-0.5 rounded-xl overflow-hidden bg-[#1A2A20]",
                isSelectedDate && "ring-2 ring-pastel-sage shadow-[0_8px_24px_-8px_rgba(132,165,125,0.4)]",
                isTodayDate && !isSelectedDate && "ring-2 ring-pastel-orange",
                !isSelectedDate && !isTodayDate && "ring-1 ring-white/10",
                isPastDate && "opacity-75"
              )}
              onClick={() => handleDayClick(date)}
            >
              <CardContent className="p-1 md:p-2 relative">
                <div className="flex flex-col items-center gap-0.5 md:gap-1 relative z-10">
                  {/* Day Label - Ultra Compact */}
                  <div className={cn(
                    "text-[8px] md:text-[10px] font-varsity font-black uppercase tracking-wider leading-none",
                    isTodayDate ? "text-pastel-orange" : "text-white/55"
                  )}>
                    {formatDayLabel(date)}
                  </div>

                  {/* Date - Compact */}
                  <div className={cn(
                    "text-[9px] md:text-xs font-varsity font-bold leading-tight tabular-nums",
                    isTodayDate ? "text-pastel-orange" : "text-pastel-cream"
                  )}>
                    {formatDateLabel(date)}
                  </div>

                  {/* Status Indicator - Minimal */}
                  {isTodayDate && !isPastDate && (
                    <Badge variant="default" className="text-[6px] md:text-[8px] py-0 md:py-0.5 px-1 md:px-1.5 h-3 md:h-4 bg-pastel-orange text-[#581E00] leading-none font-varsity font-bold shadow-sm border-0">
                      Today
                    </Badge>
                  )}

                  {/* Points Display - Streamlined (hidden if hideScores is true) */}
                  {!hideScores && (
                    <div className="w-full mt-1 md:mt-1.5 space-y-0.5 md:space-y-1">
                      {/* Team 1 */}
                      <div className="flex flex-col gap-0 md:gap-0.5 p-0.5 md:p-1 bg-white/5 rounded-md ring-1 ring-white/10">
                        <div className="text-[7px] md:text-[8px] font-display font-semibold text-white/55 leading-tight line-clamp-1 text-center px-0.5" title={team1Name || 'My Team'}>
                          {team1Name || 'My'}
                        </div>
                        <div className={cn(
                          "text-[10px] md:text-sm font-varsity font-black text-center leading-tight tabular-nums",
                          myDailyPointsForDay !== undefined && myDailyPointsForDay > 0 ? "text-pastel-cream" : "text-white/55"
                        )}>
                          {myDailyPointsForDay !== undefined ? myDailyPointsForDay.toFixed(1) : '-'}
                        </div>
                      </div>

                      {/* Divider - Subtle */}
                      <div aria-hidden="true" className="h-[1px] bg-white/10 w-full"></div>

                      {/* Team 2 */}
                      <div className="flex flex-col gap-0 md:gap-0.5 p-0.5 md:p-1 bg-white/5 rounded-md ring-1 ring-white/10">
                        <div className="text-[7px] md:text-[8px] font-display font-semibold text-white/55 leading-tight line-clamp-1 text-center px-0.5" title={team2Name || 'Opponent'}>
                          {team2Name || 'Opp'}
                        </div>
                        <div className={cn(
                          "text-[10px] md:text-sm font-varsity font-black text-center leading-tight tabular-nums",
                          oppDailyPointsForDay !== undefined && oppDailyPointsForDay > 0 ? "text-pastel-cream" : "text-white/55"
                        )}>
                          {oppDailyPointsForDay !== undefined ? oppDailyPointsForDay.toFixed(1) : '-'}
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
      {/* Compact + a day selected: the one line of chrome that earns its
          place — the way back. Phone only; desktop has the header row. */}
      {compact && selectedDate && (
        <div className="lg:hidden flex justify-end mt-1">
          <button
            type="button"
            data-testid="weekly-schedule-full-week"
            onClick={() => onDayClick(null)}
            className="focus-citrus inline-flex items-center gap-1 min-h-[32px] px-2.5 rounded-lg text-[10px] font-jbmono font-bold uppercase tracking-[0.22em] text-pastel-cream bg-pastel-sage/15 ring-1 ring-pastel-sage/40 active:bg-pastel-sage/25 transition-colors"
          >
            <span aria-hidden="true">←</span>
            <span>Full week</span>
          </button>
        </div>
      )}
    </div>
  );
};
