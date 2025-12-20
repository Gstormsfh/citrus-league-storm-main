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
  // Format date in Mountain Time
  const mstDate = new Date(now.toLocaleString('en-US', { timeZone: MOUNTAIN_TIMEZONE }));
  const year = mstDate.getFullYear();
  const month = String(mstDate.getMonth() + 1).padStart(2, '0');
  const day = String(mstDate.getDate()).padStart(2, '0');
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
 */
export function getNowMST(): Date {
  const now = new Date();
  // Convert to MST string and back to Date
  const mstString = now.toLocaleString('en-US', { timeZone: MOUNTAIN_TIMEZONE });
  return new Date(mstString);
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
