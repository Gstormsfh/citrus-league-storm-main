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

export function useCitrusPlayerNotes(playerId: number | string | null | undefined, enabled = true) {
  const [notes, setNotes] = useState<CitrusNote[]>([]);
  const [items, setItems] = useState<WireNewsItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const numericId = typeof playerId === 'string' ? Number.parseInt(playerId, 10) : playerId;
    if (!enabled || !numericId || !Number.isFinite(numericId)) {
      setNotes([]);
      setItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Lazy import for the same reason NewsService uses one: `@/api/client`
    // loads the Supabase client, which throws at module scope without
    // VITE_SUPABASE_* set, taking down any test that renders a component in
    // this import chain. Keeping it inside the effect makes this hook safe to
    // import anywhere.
    import('@/api/client')
      .then(({ apiClient }) => apiClient.get<{ notes: CitrusNote[]; items?: WireNewsItem[] }>(`/api/news/player/${numericId}`))
      .then((response) => {
        if (cancelled) return;
        setNotes(response.data?.notes ?? []);
        setItems(response.data?.items ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        // Debug, not error: pre-deploy this 404s on every card open, and a
        // console full of red for an optional block trains people to ignore it.
        logger.debug('[citrus-notes] unavailable:', error);
        setNotes([]);
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerId, enabled]);

  return { notes, items, loading };
}
