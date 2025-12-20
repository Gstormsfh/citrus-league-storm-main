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
