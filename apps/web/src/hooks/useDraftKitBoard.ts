import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/utils/logger';
import type { DraftKitBoard } from '@/components/draftkit/types';

export const DRAFT_KIT_REFRESH_MS = 120_000;

/** Refresh the entitled board without blanking a successfully loaded league. */
export function useDraftKitBoard(leagueId?: string | null) {
  const request = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentBoard = useRef<DraftKitBoard | null>(null);
  const [board, setBoard] = useState<DraftKitBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (pending.current) return; // Focus and interval events share one request.
    const generation = ++request.current;
    const controller = new AbortController();
    pending.current = controller;
    // apiClient's automatic timeout is bypassed when a caller supplies a signal.
    const timeout = setTimeout(() => controller.abort(), 15_000);
    pendingTimeout.current = timeout;
    setLoading(currentBoard.current === null);
    setRefreshing(currentBoard.current !== null);
    setError(null);
    try {
      const { apiClient } = await import('@/api/client');
      if (controller.signal.aborted) return;
      const query = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : '';
      const res = await apiClient.get<DraftKitBoard>(`/api/draft-kit/board${query}`, { signal: controller.signal });
      if (generation !== request.current) return;
      if (!res.data) throw new Error('Draft Kit response contained no board');
      currentBoard.current = res.data;
      setBoard(res.data);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (generation !== request.current) return;
      logger.error('[draft-kit] board load failed:', err);
      const status = err && typeof err === 'object' && 'status' in err ? err.status : null;
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
        // Authorization/league validation failures are not transient refreshes.
        currentBoard.current = null;
        setBoard(null);
        setLastUpdatedAt(null);
      }
      setError(currentBoard.current
        ? 'Could not refresh the Draft Kit. Showing the last loaded board.'
        : 'Could not load the Draft Kit right now.');
    } finally {
      clearTimeout(timeout);
      if (generation === request.current) {
        pending.current = null;
        pendingTimeout.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [leagueId]);

  const reset = useCallback(() => {
    request.current++;
    pending.current?.abort();
    if (pendingTimeout.current !== null) clearTimeout(pendingTimeout.current);
    pendingTimeout.current = null;
    pending.current = null;
    currentBoard.current = null;
    setBoard(null);
    setLastUpdatedAt(null);
  }, []);

  useEffect(() => {
    reset();
    void load();
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    const interval = window.setInterval(refreshVisible, DRAFT_KIT_REFRESH_MS);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      reset();
    };
  }, [load, reset]);

  // A fetch timestamp is not a canonical publication revision. Older servers
  // omit this metadata, so their readiness remains unknown.
  const source = board?.projection_source;
  const published = source?.kind === 'canonical' && source.readiness === 'published'
    && !!source.revision && !!source.run_id && source.season === board?.projectionSeason;
  return { board, loading, refreshing, error, lastUpdatedAt, reload: load,
    canonicalRevision: published ? source.revision : null,
    canonicalReadiness: published ? 'published' as const : 'unknown' as const };

}
