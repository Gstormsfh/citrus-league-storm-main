/** Missing or invalid official ice time is not a measured zero. */
export function normalizeToiSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
