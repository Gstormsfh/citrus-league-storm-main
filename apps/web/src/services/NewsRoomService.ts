/**
 * NewsRoomService (client) — the Citrus News Room's reads (2026-09-05).
 *
 * The News Room is a list of wire stories the API server has already read
 * from NHL.com, ESPN and the beat feeds, matched to the players they name,
 * and summarised in one plain sentence. Sleeper and Yahoo do the same: the
 * headline, the gist, the source, the link out. Nothing here is ours to
 * byline; every row leads to the writer.
 *
 * `@/api/client` is imported lazily for the same reason NewsService does:
 * it loads the Supabase client, which throws at module scope without the
 * VITE_* env, and a test that imports a page in this chain must not die
 * for it.
 */
import { logger } from '@/utils/logger';

/**
 * One stored wire story. Mirrors the API's `news_items` row; the server
 * keeps the article, we show the preview.
 */
export interface WireNewsItem {
  id: string;
  source_id: string;
  url: string;
  title: string;
  snippet: string | null;
  summary: string | null;
  author: string | null;
  image_url: string | null;
  team_abbrev: string | null;
  player_ids: number[];
  published_at: string;
}

/** `GET /api/news/health`: the affirmative signal that the wires are being read. */
export interface WireHealth {
  lastRunAt: string | null;
  sources: number;
  seen24h: number;
  inserted24h: number;
  errors24h: number;
}

export interface WireQuery {
  playerIds?: number[];
  team?: string | null;
  limit?: number;
  before?: string | null;
}

async function getApiClient() {
  const mod = await import('@/api/client');
  return mod.apiClient;
}

/** A page of stories and the names behind the player ids they carry. */
export interface WirePage {
  items: WireNewsItem[];
  players: Array<{ id: number; name: string }>;
}

const EMPTY_PAGE: WirePage = { items: [], players: [] };

/** Fetch stored wire stories, newest first. An empty page on any failure: render an empty state. */
export async function getWireItems(query: WireQuery = {}): Promise<WirePage> {
  const params = new URLSearchParams();
  if (query.playerIds && query.playerIds.length > 0) params.set('player_ids', query.playerIds.join(','));
  if (query.team) params.set('team', query.team);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.before) params.set('before', query.before);
  const qs = params.toString();
  try {
    const apiClient = await getApiClient();
    const response = await apiClient.get<WirePage>(`/api/news/items${qs ? `?${qs}` : ''}`);
    return { items: response.data?.items ?? [], players: response.data?.players ?? [] };
  } catch (error) {
    // Debug, not error: before the API deploy this 404s on every open.
    logger.debug('[news-room] items unavailable:', error);
    return EMPTY_PAGE;
  }
}

/** When the wires were last read. `null` when the endpoint is not there yet. */
export async function getWireHealth(): Promise<WireHealth | null> {
  try {
    const apiClient = await getApiClient();
    const response = await apiClient.get<WireHealth>('/api/news/health');
    return response.data ?? null;
  } catch (error) {
    logger.debug('[news-room] health unavailable:', error);
    return null;
  }
}
