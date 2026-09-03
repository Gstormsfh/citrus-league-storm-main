import { useEffect, useSyncExternalStore } from 'react';
import { logger } from '@/utils/logger';

/**
 * ONE FETCH OF `/api/players/dashboard-index`, SHARED BY EVERY SURFACE.
 *
 * The endpoint returns the whole league in one array — directory + season
 * actuals + GAR components + xG talent + rolled-forward projections, merged
 * server-side and cached there for two minutes (see
 * `server/src/services/PlayerDashboardService.ts`). It is ~1–2k rows: cheap
 * to hold, expensive to fetch twice. Before this module the only consumer
 * was `pages/Players.tsx` with its own `useEffect`; now the advanced player
 * card wants the same payload from a modal that can open on eight different
 * pages, so the fetch has to live in exactly one place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS HAND-ROLLED AND NOT REACT QUERY
 *
 * `@tanstack/react-query` is a dependency and `App.tsx` mounts a
 * `QueryClientProvider`, so React Query was the first thing tried. It does
 * not fit, for one measured reason and one design reason.
 *
 * MEASURED: `useQuery` THROWS ("No QueryClient set") when it runs outside a
 * provider, and this hook's biggest consumer — `PlayerStatsModal` — renders
 * outside one in two places that matter. `apps/web/harness/` mounts real
 * components with no provider at all, and NOT ONE test file in
 * any `__tests__` directory under `apps/web/src` wraps its render in a
 * `QueryClientProvider`
 * (grepped 2026-09-02: zero hits across the whole suite). A component's
 * hooks run even when its dialog is closed, so `DraftRoomV2`, `FreeAgents`,
 * `Roster`, `Matchup`, `TradeAnalyzer`, `OtherTeam` and `PoolPlayoffRoster`
 * would all have started throwing in test the moment the card was added to
 * the modal. Adding a provider to every test and every harness entry is a
 * large, risky diff for a feature whose entire brief is "must not change how
 * the host surface behaves".
 *
 * DESIGN: the requirement is "at most once per session", which is not
 * React Query's model. `staleTime: Infinity` gets close, but the cache is
 * per-QueryClient, and this payload wants to survive a provider remount and
 * be readable by code that is not a component. A module-level store is the
 * simpler thing that is exactly the requirement.
 *
 * `useSyncExternalStore` rather than `useState` + a subscription: it is the
 * React 18 primitive for exactly this shape, and it guarantees every
 * consumer sees the same snapshot in the same commit — with a dozen cards
 * and a table reading one array, tearing is a real failure mode, not a
 * theoretical one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ENDPOINT IS BEHIND `authMiddleware`, AND THAT IS A NORMAL DAY
 *
 * `players.ts` registers `/dashboard-index` with `authMiddleware`, so a
 * guest, a demo-league visitor or anyone whose token has expired gets a 401.
 * That must be a silent no-op, never an error toast and never a broken
 * roster: `status` goes to `'error'`, `players` stays an empty array, and
 * every consumer renders exactly what it rendered before this feature
 * existed. The failure is logged at DEBUG, not ERROR, for the reason
 * `useCitrusPlayerNotes` gives about its own optional endpoint — a console
 * full of red for an optional enhancement trains people to ignore red.
 *
 * A failure is NOT retried on every mount. A guest opening forty player
 * cards must cost one 401, not forty. It IS retried after
 * `RETRY_AFTER_FAILURE_MS`, so a manager who signs in mid-session recovers
 * without a page reload, and `reload()` forces the issue immediately (that
 * is what the Players page's "Try again" button calls).
 */

/**
 * One row of `/api/players/dashboard-index`.
 *
 * The wire contract lives in `@citrus/shared` (packages/shared/src/types/
 * playerDashboard.ts) and the server imports the same type, so a column added
 * on one side is a type error on the other rather than a silent mismatch. It
 * used to be hand-copied here and kept in sync by comment; the copy is gone.
 */
import type { DashboardIndexEntry } from '@citrus/shared';
export type { DashboardIndexEntry };

export type DashboardIndexStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PlayerDashboardIndexState {
  players: readonly DashboardIndexEntry[];
  status: DashboardIndexStatus;
  /** True while the very first load is in flight, so a page can show a spinner. */
  loading: boolean;
  /** Human-readable message, or null. A 401 lands here like any other failure. */
  error: string | null;
}

/** One shared empty array so an unloaded snapshot is referentially stable. */
const EMPTY: readonly DashboardIndexEntry[] = Object.freeze([]);

/**
 * A failed load is re-attempted only after this long. Bounded so a guest
 * surface costs one request a minute at worst, not one per card open, while
 * a sign-in mid-session still recovers without a reload.
 */
const RETRY_AFTER_FAILURE_MS = 60_000;

let state: PlayerDashboardIndexState = {
  players: EMPTY,
  status: 'idle',
  loading: true,
  error: null,
};
let inFlight: Promise<void> | null = null;
let failedAt = 0;

const listeners = new Set<() => void>();

function setState(next: PlayerDashboardIndexState): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `useSyncExternalStore` requires a stable identity between changes. */
function getSnapshot(): PlayerDashboardIndexState {
  return state;
}

/**
 * Kick the fetch if it has not run. Safe to call from every consumer on
 * every mount — after the first success it does nothing at all.
 *
 * `@/api/client` is imported LAZILY, not at module scope, for the reason
 * `useCitrusPlayerNotes` documents: it pulls in the Supabase client, which
 * throws at module scope when `VITE_SUPABASE_*` is unset — and the vitest
 * config deliberately pins those to empty strings. A static import here
 * would take down every test that so much as imports a component in this
 * chain.
 */
function ensureLoaded(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force) {
    if (state.status === 'ready') return Promise.resolve();
    if (state.status === 'error' && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) {
      return Promise.resolve();
    }
  }

  setState({ players: state.players, status: 'loading', loading: true, error: null });

  inFlight = import('@/api/client')
    .then(({ apiClient }) => apiClient.get<DashboardIndexEntry[]>('/api/players/dashboard-index'))
    .then((response) => {
      // The route answers `ok(c, filtered)`, which wraps the array in
      // `{ data }`. The bare-array branch is the belt to that suspender —
      // `pages/Players.tsx` has carried it since the page shipped, and the
      // card must not be the one consumer that breaks if the envelope moves.
      const list = (response?.data ?? (response as unknown as DashboardIndexEntry[])) as DashboardIndexEntry[];
      setState({
        players: Array.isArray(list) ? list : [],
        status: 'ready',
        loading: false,
        error: null,
      });
    })
    .catch((err: unknown) => {
      failedAt = Date.now();
      // DEBUG, not ERROR: a 401 here is the expected shape of a guest
      // surface, and this payload is an enhancement on every surface but
      // /players.
      logger.debug('[player-dashboard-index] unavailable:', err);
      setState({
        players: EMPTY,
        status: 'error',
        loading: false,
        error: (err as { message?: string })?.message ?? 'Failed to load players.',
      });
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Force a fresh fetch and resolve when it settles. The Players page's
 * "Try again" button; nothing else should need it.
 */
export function reloadPlayerDashboardIndex(): Promise<void> {
  return ensureLoaded(true);
}

/**
 * Test hook — drop the module cache so each test starts from `idle`.
 * Mirrors `clearDashboardIndexCache()` on the server service.
 */
export function resetPlayerDashboardIndex(): void {
  inFlight = null;
  failedAt = 0;
  state = { players: EMPTY, status: 'idle', loading: true, error: null };
  // Deliberately notifies: a test that reset mid-render should re-render.
  for (const l of listeners) l();
}

/** Read the cache without subscribing. For non-component callers only. */
export function peekPlayerDashboardIndex(): PlayerDashboardIndexState {
  return state;
}

export interface UsePlayerDashboardIndexOptions {
  /**
   * Skip the fetch entirely. Consumers that know they cannot use the payload
   * (a closed modal, a surface with no player) pass `false` so a guest never
   * pays even the one 401.
   */
  enabled?: boolean;
}

/**
 * The shared payload, plus the two flags a UI needs to caveat it.
 *
 * Returns `players: []` on every failure path — a consumer that renders
 * nothing when the array is empty is automatically correct on 401, on a
 * network drop, and before the first load resolves.
 */
export function usePlayerDashboardIndex(
  options: UsePlayerDashboardIndexOptions = {},
): PlayerDashboardIndexState & { reload: () => Promise<void> } {
  const enabled = options.enabled ?? true;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    void ensureLoaded();
  }, [enabled]);

  return { ...snapshot, reload: reloadPlayerDashboardIndex };
}
