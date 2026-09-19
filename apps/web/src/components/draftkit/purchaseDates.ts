/** Purchase terms use Edmonton calendar days, not the UTC date prefix. */
export function purchaseDate(value: string | null): string {
  if (!value) return 'not yet confirmed';
  const calendarDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(calendarDay ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return 'not yet confirmed';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: calendarDay ? 'UTC' : 'America/Edmonton',
  }).format(date);
}
