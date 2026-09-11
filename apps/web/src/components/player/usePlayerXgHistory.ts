import { useEffect, useRef, useState } from 'react';
import type { PlayerWriteup, PlayerXgHistoryPayload, XgHistoryPoint } from '@citrus/shared';
import { logger } from '@/utils/logger';

/**
 * ONE PLAYER'S CAREER ARC, FROM `/api/players/:playerId/xg-history`.
 *
 * The condensed card's sparkline needs every `player_xg_season` season on
 * record for one player, and the index payload deliberately does not carry
 * that: nine seasons times ~1,900 players on a browse index every surface
 * holds for the session is the wrong place for it. So it is a second,
 * per-player read, made only by the `expanded` card (the modal), and only
 * once the index has resolved the player.
 *
 * Modelled on `hooks/usePlayerDashboard.ts` rather than the index hook:
 * per-player state keyed on the request, no module-level store, and the
 * server's two-minute cache (`PlayerDashboardService.getXgHistory`) is the
 * layer that de-duplicates across modal opens. Lives next to the card
 * rather than in `hooks/` because the card is its only consumer.
 *
 * `@/api/client` is imported LAZILY for the reason both dashboard hooks
 * document: a static import pulls in the Supabase client, which throws at
 * module scope when `VITE_SUPABASE_*` is unset, and the vitest config pins
 * those to empty strings.
 *
 * FAILURE IS SILENCE. The card's contract is that it never breaks its host,
 * and a missing trend is the same shape as a player with one season: the
 * band is simply not there. A 401 (guest, demo, expired token) is logged at
 * DEBUG like the index hook's, because on those surfaces it is the expected
 * shape of the day; anything else is logged at DEBUG too, because a chart
 * that is an enhancement on a card that is an enhancement must not paint
 * the console red.
 */

export type XgHistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface XgHistoryState {
  /** The merged per-season points, or null before/without a payload. */
  points: readonly XgHistoryPoint[] | null;
  status: XgHistoryStatus;
  asOf: string | null;
  /**
   * THE SERVER-RENDERED SCOUTING WRITEUP (2026-09-11), or null.
   *
   * Null covers every way this can be absent and they are all the same
   * thing to a caller: the request failed, the player has no index row, an
   * older API is deployed, the response was mocked. The one call site
   * reads `xgHistory.writeup ?? generatePlayerWriteup(player, extras)`, so
   * a null renders the copy that is still in the bundle.
   */
  writeup: PlayerWriteup | null;
}

export interface UsePlayerXgHistoryOptions {
  /** False skips the fetch entirely and holds the state at `idle`. */
  enabled?: boolean;
  /**
   * The league whose scoring the writeup's projection sentence is scored
   * with. Omitted, the server sends the writeup WITHOUT that sentence
   * rather than scoring it league-neutrally: there are 16 distinct scoring
   * shapes across the leagues in production, and a wrong projection on a
   * card someone is drafting from is worse than a missing one.
   */
  leagueId?: string | null;
}

const IDLE: XgHistoryState = { points: null, status: 'idle', asOf: null, writeup: null };

export function usePlayerXgHistory(
  playerId: number | null | undefined,
  options: UsePlayerXgHistoryOptions = {},
): XgHistoryState {
  const enabled = options.enabled ?? true;
  const leagueId = options.leagueId ?? null;
  const [state, setState] = useState<XgHistoryState>(IDLE);

  // A player change mid-flight must not let the OLD response win. Every
  // request carries a token; only the newest one is allowed to write.
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled || playerId == null || !Number.isFinite(Number(playerId))) {
      setState(IDLE);
      return;
    }

    const token = ++latest.current;
    let cancelled = false;
    const path = `/api/players/${Number(playerId)}/xg-history${
      leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : ''
    }`;

    setState({ points: null, status: 'loading', asOf: null, writeup: null });

    void import('@/api/client')
      .then(({ apiClient }) => apiClient.get<PlayerXgHistoryPayload>(path))
      .then((response) => {
        if (cancelled || token !== latest.current) return;
        // The route answers `ok(c, payload)`, which wraps in `{ data }`; the
        // bare branch is the belt to that suspender, as in both dashboard
        // hooks. A response with no `points` array (a mocked client, a
        // future envelope change) is "no history", never a crash.
        const payload = (response?.data ??
          (response as unknown as PlayerXgHistoryPayload)) as PlayerXgHistoryPayload | undefined;
        const points = payload && Array.isArray(payload.points) ? payload.points : [];
        setState({
          points,
          status: 'ready',
          asOf: payload && typeof payload.as_of === 'string' ? payload.as_of : null,
          // Shape-checked, not trusted: an old API, a mock, or a partial
          // body must read as "no writeup" and never as a half-rendered
          // card. `summary` is the field the modal paints first.
          writeup:
            payload && payload.writeup && typeof payload.writeup.summary === 'string'
              ? payload.writeup
              : null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled || token !== latest.current) return;
        logger.debug('[player-xg-history] unavailable:', path, err);
        setState({ points: null, status: 'error', asOf: null, writeup: null });
      });

    return () => {
      cancelled = true;
    };
  }, [playerId, enabled, leagueId]);

  return state;
}
