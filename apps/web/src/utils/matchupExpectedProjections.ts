import { expectedDailyProjection } from '@citrus/shared';

/** Derived view over raw RPC caches; scoring changes never refetch or mutate them. */
export function expectedMatchupProjections<T extends { is_goalie?: boolean }>(
  raw: ReadonlyMap<string, ReadonlyMap<number, T>>, scoring: unknown,
): { projections: Map<string, Map<number, T>>; unavailable: Map<string, Set<number>> } {
  const projections = new Map<string, Map<number, T>>();
  const unavailable = new Map<string, Set<number>>();
  for (const [date, rows] of raw) {
    const day = new Map<number, T>();
    const missing = new Set<number>();
    for (const [id, row] of rows) {
      const expected = expectedDailyProjection(row as Record<string, unknown>, scoring, row.is_goalie === true);
      if (expected) day.set(id, expected as unknown as T);
      else missing.add(id);
    }
    projections.set(date, day);
    unavailable.set(date, missing);
  }
  return { projections, unavailable };
}
