import { startDeferredRead } from './deferredRead';

/** A local read receipt; never shared between route loads or written to state. */
export interface ScopedRead<T> {
  scope: string | null;
  consume: () => Promise<T>;
}

export function normalizedPlayerScope(ids: Array<string | number>, dateScope: string): string | null {
  const normalized = ids.map(id => typeof id === 'number' ? id
    : /^\d+$/.test(id.trim()) ? Number(id) : NaN);
  if (normalized.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
  return JSON.stringify([dateScope, [...new Set(normalized)].sort((a, b) => a - b)]);
}

export function startScopedRead<T>(scope: string | null, read: () => Promise<T>): ScopedRead<T> | undefined {
  return scope === null ? undefined : { scope, consume: startDeferredRead(read) };
}

/** Consume at the original error boundary, and refetch if construction changed scope. */
export function consumeScopedRead<T>(prefetch: ScopedRead<T> | undefined, scope: string | null,
  fallback: () => Promise<T>): Promise<T> {
  return scope !== null && prefetch?.scope === scope ? prefetch.consume() : fallback();
}
