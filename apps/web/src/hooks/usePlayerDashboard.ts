import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/utils/logger';

/**
 * ONE PLAYER'S DASHBOARD, FROM `/api/players/:playerId/dashboard`.
 *
 * Sibling of `usePlayerDashboardIndex`, and deliberately NOT the same
 * shape. The index is one league-wide payload cached for the session, so it
 * lives in a module-level store; this is per-player, per-season and
 * per-game-type, so it is component state keyed on the request. The server
 * already caches it for two minutes
 * (`server/src/services/PlayerDashboardService.ts`), which is the layer that
 * should be doing that job.
 *
 * `@/api/client` is imported LAZILY for the reason the index hook
 * documents: a static import pulls in the Supabase client, which throws at
 * module scope when `VITE_SUPABASE_*` is unset — and the vitest config pins
 * those to empty strings, so a static import would take down every test
 * that so much as renders a component in this chain.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 401 IS A FIRST-CLASS STATE, NOT AN ERROR TO SWALLOW
 *
 * The route sits behind `authMiddleware`. On the browse index that means
 * "render nothing"; here it cannot, because the whole page IS this payload
 * and a shared link is the surface's whole point. So the status is carried
 * out separately: `unauthorized` gets its own flag and the page renders a
 * sign-in invitation rather than a scary failure, while any other failure
 * renders a retryable error. Conflating the two produces the worst
 * possible screen — "something went wrong" for a person whose only problem
 * is that they are not signed in.
 */

/** Mirrors `DashboardShot` in the server service. Feet, model frame. */
export interface DashboardShot {
  game_id: number;
  event_id: number;
  game_date: string | null;
  /** Feet. Goal line at 89. See `playerDashboardData.projectShot`. */
  x: number | null;
  /** Feet. 0 at centre ice, ±42.5 at the boards. */
  y: number | null;
  distance: number | null;
  angle: number | null;
  /** OUR model's expected-goals value for this shot. Modelled, not measured. */
  xg: number | null;
  is_goal: boolean;
  shot_type: string | null;
  event_type: string;
  is_rush: boolean;
  is_rebound: boolean;
  is_power_play: boolean;
  is_shorthanded: boolean;
  is_empty_net: boolean;
  strength_state: string | null;
}

/** Mirrors `DashboardSeasonRow` — one `player_xg_season` row. */
export interface DashboardSeasonRow {
  season: number;
  game_type: string;
  shots: number;
  sog: number;
  goals: number;
  xg: number;
  finishing: number;
  shots_ev: number;
  shots_pp: number;
  shots_pk: number;
  goals_ev: number;
  goals_pp: number;
  goals_sh: number;
  xg_ev: number;
  xg_pp: number;
  xg_pk: number;
  goals_en: number;
  xg_en: number;
  avg_dist: number | null;
  avg_xg_per_shot: number | null;
  rebounds_shot: number;
  rush_shots: number;
}

export interface DashboardGsax {
  season: number | null;
  shots_faced: number;
  xga: number;
  ga: number;
  raw_gsax: number;
  regressed_gsax: number;
  league_sv_pct: number | null;
}

export interface DashboardTalent {
  xg_per_60: number | null;
  xg_rating: string | null;
  vopa_score: number | null;
  avg_toi_per_game: number | null;
  positional_replacement_level: number | null;
  positional_std_dev: number | null;
}

export interface DashboardIdentity {
  player_id: number;
  name: string;
  team: string;
  position: string;
  jersey: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
}

export interface PlayerDashboardPayload {
  player_id: number;
  season: number;
  game_type: string;
  player: DashboardIdentity | null;
  shots: DashboardShot[];
  /** False ⇒ the shot read could not run. NOT the same as zero shots. */
  shots_available: boolean;
  shots_truncated: boolean;
  shots_cap: number;
  seasons: DashboardSeasonRow[];
  gsax: DashboardGsax | null;
  talent: DashboardTalent | null;
  /** Null ⇒ nothing read carried a timestamp ⇒ hide `StaleDataBadge`. */
  as_of: string | null;
}

export type PlayerDashboardStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PlayerDashboardState {
  data: PlayerDashboardPayload | null;
  status: PlayerDashboardStatus;
  loading: boolean;
  error: string | null;
  /** The endpoint answered 401. Its own flag — see the note above. */
  unauthorized: boolean;
  reload: () => void;
}

export interface UsePlayerDashboardOptions {
  season?: number;
  gameType?: 'regular' | 'playoff';
  enabled?: boolean;
}

export function usePlayerDashboard(
  playerId: number | null | undefined,
  options: UsePlayerDashboardOptions = {},
): PlayerDashboardState {
  const { season, gameType, enabled = true } = options;

  const [state, setState] = useState<{
    data: PlayerDashboardPayload | null;
    status: PlayerDashboardStatus;
    error: string | null;
    unauthorized: boolean;
  }>({ data: null, status: 'idle', error: null, unauthorized: false });

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // A season/gameType change mid-flight must not let the OLD response win.
  // Every request carries a token; only the newest one is allowed to write.
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled || playerId == null || !Number.isFinite(Number(playerId))) {
      setState({ data: null, status: 'idle', error: null, unauthorized: false });
      return;
    }

    const token = ++latest.current;
    let cancelled = false;

    const params = new URLSearchParams();
    if (season != null) params.set('season', String(season));
    if (gameType) params.set('gameType', gameType);
    const qs = params.toString();
    const path = `/api/players/${Number(playerId)}/dashboard${qs ? `?${qs}` : ''}`;

    setState((prev) => ({ ...prev, status: 'loading', error: null, unauthorized: false }));

    void import('@/api/client')
      .then(({ apiClient }) => apiClient.get<PlayerDashboardPayload>(path))
      .then((response) => {
        if (cancelled || token !== latest.current) return;
        // The route answers `ok(c, payload)`, which wraps in `{ data }`.
        // The bare branch is the belt to that suspender, matching what
        // `usePlayerDashboardIndex` already does with the same envelope.
        const payload = (response?.data ??
          (response as unknown as PlayerDashboardPayload)) as PlayerDashboardPayload;
        setState({
          data: payload && typeof payload === 'object' ? payload : null,
          status: 'ready',
          error: null,
          unauthorized: false,
        });
      })
      .catch((err: unknown) => {
        if (cancelled || token !== latest.current) return;
        const status = (err as { status?: number })?.status;
        const message = (err as { message?: string })?.message ?? 'Failed to load this player.';
        // 401 at DEBUG, everything else at ERROR: a signed-out visitor on a
        // shared link is an expected shape, and a console full of red for
        // an expected shape trains people to ignore red.
        if (status === 401) {
          logger.debug('[player-dashboard] unauthorized:', path);
        } else {
          logger.error('[player-dashboard] load failed:', message);
        }
        setState({ data: null, status: 'error', error: message, unauthorized: status === 401 });
      });

    return () => {
      cancelled = true;
    };
  }, [playerId, season, gameType, enabled, nonce]);

  // `idle` counts as loading only while a fetch is genuinely about to
  // happen — effects run after the first paint, so there is one frame at
  // `idle` that must show the skeleton, but a DISABLED hook must not sit at
  // "loading" forever.
  const willFetch = enabled && playerId != null && Number.isFinite(Number(playerId));

  return {
    data: state.data,
    status: state.status,
    loading: state.status === 'loading' || (willFetch && state.status === 'idle'),
    error: state.error,
    unauthorized: state.unauthorized,
    reload,
  };
}
