import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/utils/logger';
import type { DraftKitBoard } from '@/components/draftkit/types';

/**
 * One call for the whole Draft Kit section.
 *
 * The board that comes back is already shaped by the caller's entitlement:
 * the server built a smaller object for an unentitled user rather than a full
 * one with a flag on it. There is therefore nothing for this hook to filter
 * and nothing for a component to accidentally reveal. `board.locked` says
 * which shape arrived so the UI can offer the upgrade path.
 */
export function useDraftKitBoard() {
  const [board, setBoard] = useState<DraftKitBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Lazy import: @/api/client loads the Supabase client, which throws at
      // module scope without VITE_SUPABASE_* set. Keeping it inside the call
      // makes this hook safe to import from a test that never fetches.
      const { apiClient } = await import('@/api/client');
      const res = await apiClient.get<DraftKitBoard>('/api/draft-kit/board');
      setBoard(res.data ?? null);
    } catch (err) {
      logger.error('[draft-kit] board load failed:', err);
      setError('Could not load the Draft Kit right now.');
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { board, loading, error, reload: load };
}
