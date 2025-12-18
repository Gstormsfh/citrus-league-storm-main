import { League } from '@/services/LeagueService';

/**
 * Get the date when the draft was completed
 * Uses the league's updated_at timestamp when draft_status is 'completed'
 */
export function getDraftCompletionDate(league: League): Date | null {
  if (league.draft_status !== 'completed') {
    return null;
  }
  return new Date(league.updated_at);
}

/**
 * Get the test first week start date (December 8, 2025 - Monday)
 * This is used for testing when today is December 8th, 2025
 */
export function getTestFirstWeekStartDate(): Date {
  // December 8, 2025 is a Monday
  const testDate = new Date('2025-12-08T00:00:00');
  testDate.setHours(0, 0, 0, 0);
  return testDate;
}

/**
 * Get the Monday of the first week after draft completion
 * If draft completes on Monday, that Monday is the start
 * Otherwise, it's the next Monday
 * 
 * For testing: If today is December 8, 2025 or later and draft was completed before/on that date,
 * use December 8, 2025 as the first week start
 */
export function getFirstWeekStartDate(draftCompletionDate: Date): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Test date: December 8, 2025 (Monday)
  const testDate = new Date('2025-12-08T00:00:00');
  testDate.setHours(0, 0, 0, 0);
  
  // If today is December 8, 2025 or later, and draft was completed on or before that date,
  // use December 8, 2025 as the first week start for testing
  if (today >= testDate) {
    const draftDate = new Date(draftCompletionDate);
    draftDate.setHours(0, 0, 0, 0);
    
    if (draftDate <= testDate) {
      return testDate;
    }
  }
  
  // Normal logic: calculate Monday after draft completion
  const date = new Date(draftCompletionDate);
  date.setHours(0, 0, 0, 0);
  
  // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayOfWeek = date.getDay();
  
  // Calculate days to add to get to Monday
  // If it's Monday (1), add 0 days
  // If it's Sunday (0), add 1 day
  // Otherwise, add (8 - dayOfWeek) days to get to next Monday
  const daysToAdd = dayOfWeek === 1 ? 0 : (dayOfWeek === 0 ? 1 : (8 - dayOfWeek));
  
  date.setDate(date.getDate() + daysToAdd);
  return date;
}

/**
 * Get the Monday date for a given week number (1-based)
 */
export function getWeekStartDate(weekNumber: number, firstWeekStart: Date): Date {
  const date = new Date(firstWeekStart);
  const daysToAdd = (weekNumber - 1) * 7;
  date.setDate(date.getDate() + daysToAdd);
  return date;
}

/**
 * Get the Sunday date for a given week number (1-based)
 */
export function getWeekEndDate(weekNumber: number, firstWeekStart: Date): Date {
  const startDate = getWeekStartDate(weekNumber, firstWeekStart);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6); // Sunday is 6 days after Monday
  return endDate;
}

/**
 * Get the current week number (1-based) based on the first week start date
 */
export function getCurrentWeekNumber(firstWeekStart: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const firstWeek = new Date(firstWeekStart);
  firstWeek.setHours(0, 0, 0, 0);
  
  // Calculate difference in days
  const diffTime = today.getTime() - firstWeek.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  // Calculate week number (1-based)
  const weekNumber = Math.floor(diffDays / 7) + 1;
  
  // Return at least week 1
  return Math.max(1, weekNumber);
}

/**
 * Get available weeks from first week until end of regular season (when playoffs begin)
 * 
 * NHL regular season typically runs from October to mid-April of the following year.
 * This function calculates all weeks from the first week start date until April 15,
 * which is when the regular season ends and playoffs typically begin.
 * 
 * Examples:
 * - Season starts Dec 8, 2025 → Regular season ends Apr 15, 2026 (≈18 weeks)
 * - Season starts Oct 7, 2025 → Regular season ends Apr 15, 2026 (≈27 weeks)
 * 
 * @param firstWeekStart - The Monday date of the first week of the season
 * @param currentYear - The current calendar year (used for context, but calculation is based on firstWeekStart)
 * @returns Array of week numbers (1-based) from week 1 to the last week of regular season
 */
export function getAvailableWeeks(firstWeekStart: Date, currentYear: number): number[] {
  const weeks: number[] = [];
  
  // Determine the season year based on when the first week starts
  // If first week is in Oct-Dec, season ends in April of next year
  // If first week is in Jan-Apr, season ends in April of same year
  const firstWeekYear = firstWeekStart.getFullYear();
  const firstWeekMonth = firstWeekStart.getMonth(); // 0-11 (Jan = 0, Dec = 11)
  
  // Regular season typically ends around April 15 (when playoffs begin)
  // If season starts Oct-Dec, regular season ends April of next year
  // If season starts Jan-Apr, regular season ends April of same year
  let regularSeasonEndYear = firstWeekYear;
  if (firstWeekMonth >= 9) { // October (9) through December (11)
    regularSeasonEndYear = firstWeekYear + 1; // Season ends next year
  }
  
  // Regular season ends around April 15 (when playoffs typically begin)
  const regularSeasonEnd = new Date(regularSeasonEndYear, 3, 15); // Month 3 = April
  regularSeasonEnd.setHours(23, 59, 59, 999);
  
  // Calculate how many weeks from first week to regular season end
  const diffTime = regularSeasonEnd.getTime() - firstWeekStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const totalWeeks = Math.floor(diffDays / 7) + 1;
  
  // Ensure we have at least 1 week
  const finalWeekCount = Math.max(1, totalWeeks);
  
  // Include all weeks up to regular season end (playoffs begin after this)
  for (let i = 1; i <= finalWeekCount; i++) {
    weeks.push(i);
  }
  
  return weeks;
}

/**
 * Get the total number of regular season weeks (schedule length)
 * This is the length of the array returned by getAvailableWeeks
 */
export function getScheduleLength(firstWeekStart: Date, currentYear: number): number {
  const weeks = getAvailableWeeks(firstWeekStart, currentYear);
  return weeks.length;
}

/**
 * Get formatted week label like "Week 1 • Jan 6-12"
 */
export function getWeekLabel(weekNumber: number, firstWeekStart: Date): string {
  const startDate = getWeekStartDate(weekNumber, firstWeekStart);
  const endDate = getWeekEndDate(weekNumber, firstWeekStart);
  
  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = startDate.getDate();
  
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
  const endDay = endDate.getDate();
  
  // If same month, show "Jan 6-12", otherwise "Jan 31 - Feb 6"
  if (startMonth === endMonth) {
    return `Week ${weekNumber} • ${startMonth} ${startDay}-${endDay}`;
  } else {
    return `Week ${weekNumber} • ${startMonth} ${startDay} - ${endMonth} ${endDay}`;
  }
}

/**
 * Get just the date portion from week label (e.g., "Jan 6-12" or "Jan 31 - Feb 6")
 */
export function getWeekDateLabel(weekNumber: number, firstWeekStart: Date): string {
  const startDate = getWeekStartDate(weekNumber, firstWeekStart);
  const endDate = getWeekEndDate(weekNumber, firstWeekStart);
  
  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = startDate.getDate();
  
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
  const endDay = endDate.getDate();
  
  // If same month, show "Jan 6-12", otherwise "Jan 31 - Feb 6"
  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  } else {
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
  }
}
