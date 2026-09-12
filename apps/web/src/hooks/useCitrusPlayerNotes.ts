import { useState, useEffect } from 'react';
import { logger } from '@/utils/logger';
import type { WireNewsItem } from '@/services/NewsRoomService';

/**
 * Citrus notes for a single player — the "Latest News" block on the player
 * card, the slot Sleeper fills with Rotowire copy.
 *
 * These come from the citrus_news table, generated server-side by
 * CitrusNewsService from our own shot-quality data. They are OURS: bylined
 * Citrus, never presented as anyone else's reporting.
 *
 * Fails soft by design. The endpoint requires a server deploy, and a player
 * card that throws because its optional news block 404s would be a worse bug
 * than one that quietly renders without news.
 */

export interface CitrusNote {
  id: string;
  kind: string;
  headline: string;
  body: string;
  analysis: string | null;
  severity: 'info' | 'positive' | 'caution';
  tags: string[];
  published_at: string;
  season: number;
}

/**
 * A wire story that names this player (NEWS ROOM, 2026-09-05): the headline,
 * a one-sentence summary, the source and the link out. Never the article.
 * The type lives with the News Room's client service; re-exported here so
 * the player card keeps one import.
 */
export type { WireNewsItem };

let clientModule: Promise<typeof import('@/api/client')> | null = null;
const loadClient = () => clientModule ??= import('@/api/client').catch(error => {
  clientModule = null;
  throw error;
});
const EMPTY = { notes: [] as CitrusNote[], items: [] as WireNewsItem[], loading: false };

export function useCitrusPlayerNotes(playerId: number | string | null | undefined, enabled = true) {
  const numericId = Number(playerId);
  const active = enabled && playerId != null && Number.isSafeInteger(numericId) && numericId > 0;
  const [stored, setStored] = useState<{ id: number; notes: CitrusNote[]; items: WireNewsItem[]; loading: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setRefresh(n => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [active, numericId]);

  useEffect(() => {
    if (!active) {
      setStored(null);
      return;
    }
    let cancelled = false;
    setStored(previous => previous?.id === numericId
      ? { ...previous, loading: true }
      : { ...EMPTY, id: numericId, loading: true });
    void loadClient()
      .then(({ apiClient }) => cancelled ? undefined : apiClient.get<{ notes: CitrusNote[]; items?: WireNewsItem[] }>(`/api/news/player/${numericId}`))
      .then(response => {
        if (cancelled) return;
        setStored({ id: numericId, loading: false,
          notes: Array.isArray(response?.data?.notes) ? response.data.notes : [],
          items: Array.isArray(response?.data?.items) ? response.data.items : [],
        });
      })
      .catch(error => {
        if (cancelled) return;
        logger.debug('[citrus-notes] unavailable:', error);
        setStored({ ...EMPTY, id: numericId });
      });
    return () => { cancelled = true; };
  }, [numericId, active, refresh]);

  // Hide stale news in the very render that changes identity or closes the
  // card, including while the previous player's request remains in flight.
  if (!active) return EMPTY;
  if (stored?.id !== numericId) return { ...EMPTY, loading: true };
  return { notes: stored.notes, items: stored.items, loading: stored.loading };
}
