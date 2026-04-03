/**
 * Timezone utilities for Citrus Fantasy Sports
 * All dates/times should use Mountain Time (America/Denver)
 */

const MOUNTAIN_TIMEZONE = 'America/Denver';

/**
 * Get today's date string in Mountain Time (YYYY-MM-DD)
 * This ensures consistent date comparisons regardless of user's local timezone
 */
export function getTodayMST(): string {
  const now = new Date();
  // Use Intl.DateTimeFormat to get date components in Mountain Time
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  
  return `${year}-${month}-${day}`;
}

/**
 * Get today's Date object normalized to Mountain Time midnight
 */
export function getTodayMSTDate(): Date {
  const todayStr = getTodayMST();
  // Create date at midnight MST
  return new Date(`${todayStr}T00:00:00`);
}

/**
 * Get current time in Mountain Time as a Date object
 * Note: JavaScript Date objects are always in UTC internally, so this returns
 * a Date object that represents the current MST time, but stored as UTC
 */
export function getNowMST(): Date {
  const now = new Date();
  // Get MST time components
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1; // Month is 0-indexed
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0');
  
  // Create date in UTC that represents this MST time
  // MST is UTC-7 (or UTC-6 during DST), but we'll create it as if MST were UTC
  // This is just for comparison purposes - the actual timezone conversion happens in formatting
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * Check if a date string (YYYY-MM-DD) is today in Mountain Time
 */
export function isTodayMST(dateStr: string): boolean {
  return dateStr === getTodayMST();
}

/**
 * Format a date string to display in Mountain Time
 */
export function formatDateMST(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    timeZone: MOUNTAIN_TIMEZONE,
    ...options
  });
}

/**
 * Format a time string to display in Mountain Time
 */
export function formatTimeMST(timeStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(timeStr);
  return date.toLocaleTimeString('en-US', {
    timeZone: MOUNTAIN_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options
  });
}

/**
 * Format a waiver_process_time (e.g. "02:00:00") into a human-readable string like "2:00 AM MT".
 * Reads the time from league settings instead of hardcoding.
 */
export function formatWaiverProcessTime(processTime?: string | null): string {
  if (!processTime) return '2:00 AM MT';
  // processTime is a TIME like "02:00:00" or "14:30:00"
  const parts = processTime.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1] || '0', 10);
  if (isNaN(hours)) return '2:00 AM MT';
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minuteStr = minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : ':00';
  return `${hours}${minuteStr} ${ampm} MT`;
}

/**
 * CRITICAL: Parse a date string (YYYY-MM-DD) without timezone interpretation issues
 * This avoids the bug where new Date("2026-02-02") creates UTC midnight which is Feb 1st in MST
 * Returns a Date object at local midnight for the given date
 */
export function parseDateStringLocal(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  
  // Split the date string and create date with explicit components
  // This avoids UTC interpretation
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length !== 3) return new Date(NaN);
  
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
  const day = parseInt(parts[2], 10);
  
  // Create date at local midnight - NOT UTC
  return new Date(year, month, day, 0, 0, 0, 0);
}

/**
 * Format a Date object to YYYY-MM-DD string (local timezone, no UTC shift)
 */
export function formatDateToString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Compare two date strings (YYYY-MM-DD format)
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareDateStrings(a: string, b: string): number {
  const dateA = a.split('T')[0];
  const dateB = b.split('T')[0];
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}

/**
 * Check if a date string is within a range (inclusive)
 * All parameters should be YYYY-MM-DD format
 */
export function isDateInRange(dateStr: string, startStr: string, endStr: string): boolean {
  const date = dateStr.split('T')[0];
  const start = startStr.split('T')[0];
  const end = endStr.split('T')[0];
  return date >= start && date <= end;
}
