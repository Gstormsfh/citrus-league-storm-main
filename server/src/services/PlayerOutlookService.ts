import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seasonOutlookWriteup, EDITORIAL_NEWS_MAX_AGE_MS, type DashboardIndexEntry, type EditorialNewsItem } from '@citrus/shared';
import { PlayerDashboardService } from './PlayerDashboardService';
import type { GeneratedNote } from './CitrusNewsService';

export class PlayerOutlookService {
  constructor(private supabase: SupabaseClient, private dashboard = new PlayerDashboardService(supabase)) {}

  render(entry: DashboardIndexEntry, items: readonly EditorialNewsItem[], now = new Date()): GeneratedNote | null {
    const writeup = seasonOutlookWriteup(entry, items, now);
    if (!writeup || writeup.sourceContext?.projectionSeason == null) return null;
    const sourceContext = { ...writeup.sourceContext, newsSources: writeup.newsSources ?? [],
      availability: entry.availability, currentAffiliation: entry.current_affiliation, projectionTeam: entry.projection_team };
    const content = { headline: writeup.headline, body: writeup.summary, analysis: writeup.analysis,
      severity: writeup.cardTone === 'caution' ? 'caution' as const : 'info' as const,
      tags: writeup.tags.map(tag => tag.label), editorialVersion: writeup.editorialVersion, sourceContext };
    return { ...content, kind: 'season-outlook', playerId: entry.id,
      season: writeup.sourceContext.projectionSeason,
      dedupeKey: `season-outlook:${writeup.sourceContext.projectionSeason}:${entry.id}`,
      contentRevision: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
  }

  async forPlayer(playerId: number, items: readonly EditorialNewsItem[], now = new Date()): Promise<GeneratedNote | null> {
    const result = await this.dashboard.getDashboardIndex();
    if (result.error) throw result.error;
    const entry = result.players.find(p => p.id === playerId);
    return entry ? this.render(entry, items, now) : null;
  }

  async persist(notes: readonly GeneratedNote[], now = new Date()): Promise<{ inserted: number; updated: number; unchanged: number }> {
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (let i = 0; i < notes.length; i += 200) {
      const chunk = notes.slice(i, i + 200);
      const { data, error } = await this.supabase.from('citrus_news')
        .select('dedupe_key,published_at,content_revision,is_current').in('dedupe_key', chunk.map(n => n.dedupeKey));
      if (error) throw new Error(`Outlook revision read failed: ${error.message}`);
      const previous = new Map((data ?? []).map(n => [n.dedupe_key, n]));
      const changed = chunk.filter(n => previous.get(n.dedupeKey)?.content_revision !== n.contentRevision || previous.get(n.dedupeKey)?.is_current === false);
      counts.unchanged += chunk.length - changed.length;
      if (!changed.length) continue;
      const rows = changed.map(n => ({ dedupe_key: n.dedupeKey, kind: n.kind, player_id: n.playerId, season: n.season,
        headline: n.headline, body: n.body, analysis: n.analysis, severity: n.severity, tags: n.tags,
        editorial_version: n.editorialVersion, content_revision: n.contentRevision, source_context: n.sourceContext,
        published_at: previous.get(n.dedupeKey)?.published_at ?? now.toISOString(), updated_at: now.toISOString(), is_current: true }));
      const saved = await this.supabase.from('citrus_news').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: false }).select('id');
      if (saved.error) throw new Error(`Outlook revision write failed: ${saved.error.message}`);
      if ((saved.data ?? []).length !== rows.length) throw new Error('Outlook revision write returned incomplete coverage');
      counts.updated += changed.filter(n => previous.has(n.dedupeKey)).length;
      counts.inserted += changed.filter(n => !previous.has(n.dedupeKey)).length;
    }
    return counts;
  }

  /** Retire obsolete standing notes after a complete successful refresh;
   * retain their prose and original dates for audit/rollback. */
  async retireMissing(notes: readonly GeneratedNote[], now = new Date()): Promise<number> {
    if (!notes.length || new Set(notes.map(n => n.season)).size !== 1) throw new Error('Cannot retire outlooks without a complete single-season corpus');
    const ids = new Set(notes.map(n => n.playerId)); const missing: string[] = [];
    let complete = false;
    for (let page = 0; page < 25; page++) {
      const { data, error } = await this.supabase.from('citrus_news').select('id,player_id')
        .eq('kind', 'season-outlook').eq('season', notes[0].season).eq('is_current', true)
        .order('id').range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(`Outlook retirement read failed: ${error.message}`);
      missing.push(...(data ?? []).filter(n => !ids.has(n.player_id)).map(n => n.id));
      if ((data ?? []).length < 1000) { complete = true; break; }
    }
    if (!complete) throw new Error('Outlook retirement read exceeded pagination limit');
    for (let i = 0; i < missing.length; i += 200) {
      const { data, error } = await this.supabase.from('citrus_news').update({ is_current: false, updated_at: now.toISOString() })
        .in('id', missing.slice(i, i + 200)).select('id');
      if (error || (data ?? []).length !== missing.slice(i, i + 200).length) throw new Error(`Outlook retirement failed: ${error?.message ?? 'incomplete write'}`);
    }
    return missing.length;
  }

  /** A single paged source read for the corpus, never one query per player. */
  async generate(now = new Date()): Promise<GeneratedNote[]> {
    const [index, items] = await Promise.all([this.dashboard.getDashboardIndex(), this.recentNews(now)]);
    if (index.error) throw index.error;
    if (!index.players.length) throw new Error('Outlook index is empty; refusing corpus refresh');
    const byPlayer = new Map<number, EditorialNewsItem[]>();
    for (const item of items) for (const id of item.player_ids ?? []) {
      const list = byPlayer.get(id) ?? []; list.push(item); byPlayer.set(id, list);
    }
    return index.players.flatMap(entry => {
      const note = this.render(entry, byPlayer.get(entry.id) ?? [], now);
      return note ? [note] : [];
    });
  }

  private async recentNews(now: Date): Promise<EditorialNewsItem[]> {
    const result: EditorialNewsItem[] = [];
    for (let page = 0; page < 25; page++) {
      const { data, error } = await this.supabase.from('news_items')
        .select('id,player_ids,title,snippet,url,source_id,published_at')
        .gte('published_at', new Date(now.getTime() - EDITORIAL_NEWS_MAX_AGE_MS).toISOString())
        .lte('published_at', now.toISOString()).order('id').range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(`Outlook news read failed: ${error.message}`);
      result.push(...(data ?? []));
      if ((data ?? []).length < 1000) return result;
    }
    throw new Error('Outlook news pagination exceeded limit');
  }
}
