/**
 * THE CITRUS NEWS ROOM (2026-09-05).
 *
 * Garrett: "we have access to ESPN, NHL, etc. There will be articles written
 * about our players and it should come through like Sleeper and Yahoo do,
 * where it summarizes and links the source."
 *
 * WHAT THIS DOES
 * --------------
 * Reads the wires in `news_sources` (the NHL.com content API, ESPN's public
 * news API, publishers' RSS feeds), keeps the headline, the first paragraph
 * and the link, matches every story against the season's player directory
 * by full name, writes a one-sentence summary for a fantasy manager, and
 * stores the row in `news_items`. Each source's run is recorded in
 * `news_ingest_runs` (seen / inserted / matched / errors) so the News Room
 * can print its own freshness and a dead job is visible, not silent.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * Store an article. We store what a link preview stores and link out; the
 * writer's work stays on the writer's page. A paywalled item (ESPN
 * `premium`) is dropped. A source that fails is a run row with an error,
 * not an exception that kills the others.
 *
 * The parsers are pure and exported so they are pinned by tests without a
 * network. The Anthropic call is optional: with no key, the summary is the
 * snippet clipped to a sentence.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger, getCurrentSeason } from '@citrus/shared';
import { plainDashes } from '../lib/stormy/plainDashes';

export interface NewsSourceRow {
  id: string;
  name: string;
  kind: 'nhl' | 'espn' | 'rss' | 'bluesky';
  url: string;
  team_abbrev: string | null;
  enabled: boolean;
}

export interface WireItem {
  sourceId: string;
  externalId: string | null;
  url: string;
  title: string;
  snippet: string;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string;
  /** Player ids the source itself tagged (NHL.com does). */
  taggedPlayerIds: number[];
}

export interface DirectoryName {
  playerId: number;
  fullName: string;
  teamAbbrev: string | null;
}

export interface NewsItemRow {
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

export interface IngestRun {
  sourceId: string;
  seen: number;
  inserted: number;
  matched: number;
  errors: number;
  error: string | null;
}

const FETCH_TIMEOUT_MS = 8000;
/** Stories older than this are not news. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** New summaries per run, so one busy morning cannot run up the bill. */
const MAX_SUMMARIES_PER_RUN = 40;
const SUMMARY_MODEL = 'claude-3-5-haiku-latest';

// ── Text ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8217': '’', '#8216': '‘',
  '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—', '#8230': '…',
};

export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e: string) => {
      if (ENTITIES[e] !== undefined) return ENTITIES[e];
      if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      if (/^#x[0-9a-f]+$/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentence, or the first 240 characters, whichever comes first. */
export function firstSentence(text: string, max = 240): string {
  const clean = plainDashes(stripHtml(text));
  if (!clean) return '';
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(clean);
  const s = m ? m[1] : clean;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ── Parsers (pure) ───────────────────────────────────────────────────

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1].trim() : null;
}

function attr(block: string, name: string, attribute: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]*)"`, 'i').exec(block);
  return m ? m[1] : null;
}

/**
 * RSS 2.0 and Atom, the two shapes every publisher's feed takes. Regex over
 * the item blocks: a dependency-free parser that reads titles, links,
 * descriptions and dates is all a headline feed needs, and it cannot be
 * broken by a namespace it has never seen.
 */
export function parseFeed(xml: string, sourceId: string): WireItem[] {
  const out: WireItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = stripHtml(tag(b, 'title'));
    let url = stripHtml(tag(b, 'link')) || attr(b, 'link', 'href') || '';
    if (!url) {
      const alt = /<link\b[^>]*rel="alternate"[^>]*href="([^"]*)"/i.exec(b);
      url = alt ? alt[1] : '';
    }
    if (!title || !/^https?:\/\//.test(url)) continue;
    const snippet = firstSentence(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content') ?? tag(b, 'content:encoded') ?? '');
    const date = tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date');
    const t = date ? new Date(stripHtml(date)).getTime() : NaN;
    const author = stripHtml(tag(b, 'dc:creator') ?? tag(b, 'author') ?? '') || null;
    const enclosure = attr(b, 'enclosure', 'url') ?? attr(b, 'media:content', 'url') ?? attr(b, 'media:thumbnail', 'url');
    out.push({
      sourceId,
      externalId: stripHtml(tag(b, 'guid') ?? tag(b, 'id') ?? '') || null,
      url,
      title,
      snippet,
      author: author && author.length <= 80 ? author.replace(/^.*\((.*)\)$/, '$1') : null,
      imageUrl: enclosure,
      publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(),
      taggedPlayerIds: [],
    });
  }
  return out;
}

/** The NHL.com content API (forge-dapi). Tags carry the player id when a story is about one. */
export function parseNhl(payload: unknown, sourceId: string): WireItem[] {
  const data = (payload ?? {}) as { items?: unknown[]; docs?: unknown[] };
  const items = (data.items || data.docs || []) as Array<Record<string, unknown>>;
  const out: WireItem[] = [];
  for (const item of items) {
    const fields = (item.fields || {}) as Record<string, unknown>;
    const headline = (item.headline || item.title || fields.headline) as string | undefined;
    if (!headline) continue;
    const slug = String(item.slug || item.contentUrl || fields.slug || '').replace(/^\/+/, '');
    if (!slug) continue;
    const summary = String(item.summary || item.subhead || fields.summary || '');
    const thumb = ((item.thumbnail as Record<string, unknown> | undefined)?.templateUrl ||
      (item.image as Record<string, unknown> | undefined)?.templateUrl || '') as string;
    const tags = (Array.isArray(item.tags) ? item.tags : []) as Array<Record<string, unknown>>;
    const taggedPlayerIds: number[] = [];
    for (const t of tags) {
      const extra = (t.extraData || {}) as Record<string, unknown>;
      const pid = Number(extra.playerId ?? (t.externalSourceName === 'player' ? t.externalId : NaN));
      if (Number.isFinite(pid) && pid > 0) taggedPlayerIds.push(pid);
    }
    const contributors = (Array.isArray(item.contributor) ? item.contributor : []) as Array<Record<string, unknown>>;
    const author = contributors.length ? String(contributors[0].name ?? contributors[0].title ?? '') || null : null;
    out.push({
      sourceId,
      externalId: String(item._entityId || item.id || slug),
      url: `https://www.nhl.com/news/${slug}`,
      title: stripHtml(String(headline)),
      snippet: firstSentence(summary),
      author,
      imageUrl: thumb ? thumb.replace('{formatInstructions}', 't_ratio16_9-size40/f_auto') : null,
      publishedAt: String(item.contentDate || item.date || fields.date || new Date().toISOString()),
      taggedPlayerIds,
    });
  }
  return out;
}

/** ESPN's public site API. Paywalled items are dropped, not linked. */
export function parseEspn(payload: unknown, sourceId: string): WireItem[] {
  const data = (payload ?? {}) as { articles?: Array<Record<string, unknown>> };
  const out: WireItem[] = [];
  for (const a of data.articles ?? []) {
    if (a.premium) continue;
    const headline = a.headline as string | undefined;
    const url = ((a.links as Record<string, Record<string, string>> | undefined)?.web?.href) ?? null;
    if (!headline || !url) continue;
    const images = (Array.isArray(a.images) ? a.images : []) as Array<Record<string, unknown>>;
    const best = images.find((img) => typeof img.width === 'number' && (img.width as number) >= 400) || images[0];
    const byline = a.byline as string | undefined;
    out.push({
      sourceId,
      externalId: a.id != null ? String(a.id) : null,
      url,
      title: stripHtml(headline),
      snippet: firstSentence(String(a.description ?? '')),
      author: byline ? stripHtml(byline) : null,
      imageUrl: best?.url ? String(best.url) : null,
      publishedAt: String(a.published || new Date().toISOString()),
      taggedPlayerIds: [],
    });
  }
  return out;
}

// ── Name matching (pure) ─────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Diacritics off, so "Fehérváry" in the directory meets "Fehervary" in a headline. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export interface NameIndex {
  entries: Array<{ playerId: number; teamAbbrev: string | null; re: RegExp; folded: string }>;
}

export function buildNameIndex(names: readonly DirectoryName[]): NameIndex {
  const entries = names
    .filter((n) => n.fullName && n.fullName.trim().split(/\s+/).length >= 2)
    .map((n) => {
      const folded = fold(n.fullName.trim());
      return {
        playerId: n.playerId,
        teamAbbrev: n.teamAbbrev,
        folded,
        re: new RegExp(`(^|[^a-z])${escapeRe(folded).replace(/\\?\s+/g, '\\s+')}(?=$|[^a-z])`, 'i'),
      };
    });
  return { entries };
}

/**
 * Every player whose full name appears in the text. Full names only: a
 * surname alone ("Hughes") is three players and a guess, and a story that
 * guesses at a player is worse than one that names nobody.
 */
export function matchPlayers(text: string, index: NameIndex): number[] {
  const hay = fold(text);
  const out: number[] = [];
  for (const e of index.entries) {
    if (hay.includes(e.folded) && e.re.test(hay)) out.push(e.playerId);
  }
  return Array.from(new Set(out));
}

/** The team a story is about, when every matched player shares one. */
export function teamOf(playerIds: readonly number[], index: NameIndex): string | null {
  const teams = new Set<string>();
  for (const id of playerIds) {
    const t = index.entries.find((e) => e.playerId === id)?.teamAbbrev;
    if (t) teams.add(t);
  }
  return teams.size === 1 ? [...teams][0] : null;
}

// ── The summary ──────────────────────────────────────────────────────

/**
 * One sentence for a fantasy manager, from the headline and the first
 * paragraph only (we never fetch the article). No key, no network, or any
 * failure: the snippet's first sentence stands in, which is honest and
 * cheap. Every summary passes plainDashes.
 */
export async function summarize(
  items: readonly WireItem[],
  fetchImpl: typeof fetch = fetch,
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of items) out.set(it.url, firstSentence(it.snippet || it.title));
  if (!apiKey || items.length === 0) return out;
  const batch = items.slice(0, MAX_SUMMARIES_PER_RUN);
  const list = batch.map((it, i) => `${i + 1}. ${it.title}\n${it.snippet}`).join('\n\n');
  const prompt =
    `You write one-line news summaries for fantasy hockey managers. For each numbered item below, write ONE sentence, ` +
    `under 30 words, plain, factual, present tense, naming the player and what changed. Never use an em dash. ` +
    `Never invent a detail the item does not state. Reply with the same numbers, one line each, nothing else.\n\n${list}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: SUMMARY_MODEL, max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }),
    });
    clearTimeout(timer);
    if (!resp.ok) {
      logger.warn(`[newsroom] summary model responded ${resp.status}; snippets stand in`);
      return out;
    }
    const data = (await resp.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)[.)]\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const it = batch[Number(m[1]) - 1];
      if (it && m[2].length >= 12) out.set(it.url, plainDashes(m[2]));
    }
  } catch (err) {
    logger.warn('[newsroom] summary call failed; snippets stand in:', err instanceof Error ? err.message : String(err));
  }
  return out;
}

// ── The service ──────────────────────────────────────────────────────

async function fetchText(url: string, accept: string, fetchImpl: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(url, { signal: controller.signal, headers: { accept, 'user-agent': 'CitrusNewsRoom/1.0 (+https://citrusfantasysports.com)' } });
    if (!resp.ok) throw new Error(`upstream ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export class NewsRoomService {
  constructor(private readonly supabase: SupabaseClient, private readonly fetchImpl: typeof fetch = fetch) {}

  async loadSources(): Promise<NewsSourceRow[]> {
    const { data, error } = await this.supabase.from('news_sources').select('*').eq('enabled', true);
    if (error) throw new Error(error.message);
    return (data ?? []) as NewsSourceRow[];
  }

  async loadNameIndex(): Promise<NameIndex> {
    const { data, error } = await this.supabase
      .from('player_directory')
      .select('player_id, full_name, team_abbrev')
      .eq('season', getCurrentSeason())
      .limit(5000);
    if (error) throw new Error(error.message);
    return buildNameIndex(
      ((data ?? []) as Array<{ player_id: number; full_name: string; team_abbrev: string | null }>).map((r) => ({
        playerId: r.player_id,
        fullName: r.full_name,
        teamAbbrev: r.team_abbrev,
      })),
    );
  }

  async fetchSource(src: NewsSourceRow): Promise<WireItem[]> {
    if (src.kind === 'nhl') return parseNhl(JSON.parse(await fetchText(src.url, 'application/json', this.fetchImpl)), src.id);
    if (src.kind === 'espn') return parseEspn(JSON.parse(await fetchText(src.url, 'application/json', this.fetchImpl)), src.id);
    if (src.kind === 'rss') return parseFeed(await fetchText(src.url, 'application/rss+xml, application/atom+xml, application/xml, text/xml', this.fetchImpl), src.id);
    return [];
  }

  /** Every enabled source, one run row each; a failing source never stops the rest. */
  async ingest(): Promise<IngestRun[]> {
    const [sources, index] = await Promise.all([this.loadSources(), this.loadNameIndex()]);
    const runs: IngestRun[] = [];
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const src of sources) {
      const run: IngestRun = { sourceId: src.id, seen: 0, inserted: 0, matched: 0, errors: 0, error: null };
      const startedAt = new Date().toISOString();
      try {
        const items = (await this.fetchSource(src)).filter((it) => new Date(it.publishedAt).getTime() > cutoff);
        run.seen = items.length;
        if (items.length) {
          const { data: existing } = await this.supabase.from('news_items').select('url').in('url', items.map((i) => i.url));
          const known = new Set(((existing ?? []) as Array<{ url: string }>).map((r) => r.url));
          const fresh = items.filter((i) => !known.has(i.url));
          const summaries = await summarize(fresh, this.fetchImpl);
          const rows = fresh.map((it) => {
            const matchedIds = Array.from(new Set([...it.taggedPlayerIds, ...matchPlayers(`${it.title}. ${it.snippet}`, index)]));
            if (matchedIds.length) run.matched += 1;
            return {
              source_id: src.id,
              external_id: it.externalId,
              url: it.url,
              title: it.title.slice(0, 300),
              snippet: it.snippet || null,
              summary: summaries.get(it.url) ?? null,
              author: it.author,
              image_url: it.imageUrl,
              team_abbrev: src.team_abbrev ?? teamOf(matchedIds, index),
              player_ids: matchedIds,
              published_at: it.publishedAt,
              updated_at: new Date().toISOString(),
            };
          });
          if (rows.length) {
            const { error } = await this.supabase.from('news_items').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
            if (error) throw new Error(error.message);
            run.inserted = rows.length;
          }
        }
      } catch (err) {
        run.errors = 1;
        run.error = err instanceof Error ? err.message : String(err);
        logger.warn(`[newsroom] ${src.id} failed: ${run.error}`);
      }
      await this.supabase.from('news_ingest_runs').insert({
        source_id: src.id,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        seen: run.seen,
        inserted: run.inserted,
        matched: run.matched,
        errors: run.errors,
        error: run.error,
      });
      runs.push(run);
    }
    return runs;
  }

  /** Newest first. Player ids narrow to stories that name one of them; a team narrows to its stories. */
  async list(opts: { playerIds?: number[]; team?: string | null; limit?: number; before?: string | null }): Promise<NewsItemRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
    let q = this.supabase
      .from('news_items')
      .select('id, source_id, url, title, snippet, summary, author, image_url, team_abbrev, player_ids, published_at')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (opts.playerIds && opts.playerIds.length) q = q.overlaps('player_ids', opts.playerIds);
    if (opts.team) q = q.eq('team_abbrev', opts.team.toUpperCase());
    if (opts.before) q = q.lt('published_at', opts.before);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as NewsItemRow[];
  }

  async forPlayer(playerId: number, limit = 10): Promise<NewsItemRow[]> {
    return this.list({ playerIds: [playerId], limit });
  }

  /**
   * The names behind the ids a page of stories carries, so the client can
   * label a row without holding the whole directory. One IN query per page;
   * a directory row is keyed by (player_id, season) so the newest season
   * wins when a player appears twice.
   */
  async namesFor(items: NewsItemRow[]): Promise<Array<{ id: number; name: string }>> {
    const ids = Array.from(new Set(items.flatMap((i) => i.player_ids ?? []))).filter((n) => Number.isFinite(n));
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('player_directory')
      .select('player_id, full_name, season')
      .in('player_id', ids)
      .order('season', { ascending: false });
    if (error) throw new Error(error.message);
    const seen = new Map<number, string>();
    for (const r of (data ?? []) as Array<{ player_id: number; full_name: string }>) {
      if (!seen.has(r.player_id)) seen.set(r.player_id, r.full_name);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }

  /** The freshness the News Room prints: the newest finished run and the last day's totals. */
  async health(): Promise<{ lastRunAt: string | null; sources: number; seen24h: number; inserted24h: number; errors24h: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await this.supabase
      .from('news_ingest_runs')
      .select('source_id, finished_at, seen, inserted, errors')
      .gte('started_at', since)
      .order('finished_at', { ascending: false })
      .limit(500);
    const rows = (data ?? []) as Array<{ source_id: string; finished_at: string | null; seen: number; inserted: number; errors: number }>;
    return {
      lastRunAt: rows[0]?.finished_at ?? null,
      sources: new Set(rows.map((r) => r.source_id)).size,
      seen24h: rows.reduce((s, r) => s + r.seen, 0),
      inserted24h: rows.reduce((s, r) => s + r.inserted, 0),
      errors24h: rows.reduce((s, r) => s + r.errors, 0),
    };
  }
}
