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
  /** News, source seasons or effective scoring changed while the card is open. */
  revision?: string;
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

// Keep imports lazy while sharing an in-flight module load across revisions.
// Loading scoring/news can invalidate the first request before import resolves.
let clientModule: Promise<typeof import('@/api/client')> | null = null;
const loadClient = () => clientModule ??= import('@/api/client').catch(error => {
  clientModule = null;
  throw error;
});

function completeWriteup(value: unknown): value is PlayerWriteup {
  if (!value || typeof value !== 'object') return false;
  const w = value as Partial<PlayerWriteup>;
  return typeof w.headline === 'string' && typeof w.summary === 'string'
    && typeof w.analysis === 'string' && typeof w.cardNote === 'string'
    && ['positive', 'neutral', 'caution'].includes(w.cardTone ?? '')
    && typeof w.hasEnoughData === 'boolean' && Array.isArray(w.tags)
    && w.tags.every(t => t && typeof t.label === 'string' && ['positive', 'neutral', 'caution'].includes(t.tone));
}

export function usePlayerXgHistory(
  playerId: number | null | undefined,
  options: UsePlayerXgHistoryOptions = {},
): XgHistoryState {
  const numericId = Number(playerId);
  const enabled = (options.enabled ?? true) && playerId != null && Number.isSafeInteger(numericId) && numericId > 0;
  const leagueId = options.leagueId ?? null;
  const revision = options.revision ?? '';
  const key = JSON.stringify([numericId, leagueId, revision]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setRefresh(n => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [enabled, numericId]);
  const [stored, setStored] = useState<{ key: string; state: XgHistoryState } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStored(null);
      return;
    }
    const token = ++latest.current;
    let cancelled = false;
    const path = `/api/players/${numericId}/xg-history${leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : ''}`;
    // Same-context polling keeps the established server copy visible. A new
    // player, scoring revision or news revision uses the current fallback.
    setStored(previous => previous?.key === key ? previous : { key, state: { ...IDLE, status: 'loading' } });
    void loadClient()
      .then(({ apiClient }) => cancelled ? undefined : apiClient.get<PlayerXgHistoryPayload>(path))
      .then(response => {
        if (cancelled || token !== latest.current) return;
        const payload = (response?.data ?? response) as PlayerXgHistoryPayload | undefined;
        setStored({ key, state: {
          points: payload && Array.isArray(payload.points) ? payload.points : [],
          status: 'ready',
          asOf: payload && typeof payload.as_of === 'string' ? payload.as_of : null,
          writeup: completeWriteup(payload?.writeup) ? payload.writeup : null,
        } });
      })
      .catch((error: unknown) => {
        if (cancelled || token !== latest.current) return;
        logger.debug('[player-xg-history] unavailable:', path, error);
        setStored({ key, state: { ...IDLE, status: 'error' } });
      });
    return () => { cancelled = true; };
  }, [enabled, numericId, leagueId, key, refresh]);

  // Effects run after paint: do not expose the previous player's payload in
  // the render before the new effect clears it.
  return !enabled ? IDLE : stored?.key === key ? stored.state : { ...IDLE, status: 'loading' };
}
