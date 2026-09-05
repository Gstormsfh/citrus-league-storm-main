/**
 * THE NEWS ROOM'S ARITHMETIC (2026-09-05), kept out of the component so it
 * can be tested without a DOM: which stories a segment shows, how they are
 * grouped by day, which team chips the row earns, what the freshness line
 * says. The component draws; this decides.
 */
import type { WireHealth, WireNewsItem } from '@/services/NewsRoomService';

export type NewsSegment = 'mine' | 'all';

/** The wire's source ids, as a reader knows them. A Bluesky handle prints as itself. */
export const SOURCE_LABEL: Record<string, string> = {
  nhl: 'NHL.com',
  espn: 'ESPN',
  dailyfaceoff: 'Daily Faceoff',
  dobber: 'DobberHockey',
  tsn: 'TSN',
  sportsnet: 'Sportsnet',
  thn: 'The Hockey News',
};

export function sourceLabel(id: string): string {
  return SOURCE_LABEL[id] ?? id.replace(/^bsky:/, '@');
}

/** "2h", "3d", "Sep 2": the compact form a feed uses. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface NewsDaySection {
  /** `Today`, `Yesterday`, `Wed, Sep 2`. */
  label: string;
  /** `YYYY-MM-DD` in the viewer's zone; stable key. */
  key: string;
  items: WireNewsItem[];
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Newest day first; each day's stories in the order given (already newest first). */
export function groupByDay(items: WireNewsItem[], now: Date = new Date()): NewsDaySection[] {
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date(now.getTime() - 86_400_000));
  const sections = new Map<string, NewsDaySection>();
  for (const item of items) {
    const t = new Date(item.published_at);
    if (!Number.isFinite(t.getTime())) continue;
    const key = localDayKey(t);
    let section = sections.get(key);
    if (!section) {
      const label =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      section = { key, label, items: [] };
      sections.set(key, section);
    }
    section.items.push(item);
  }
  return [...sections.values()];
}

/**
 * The stories about the players a manager holds. A story is theirs when it
 * names at least one of their players; a team story that names nobody is
 * not (it would put every EDM headline on every McDavid owner's feed).
 */
export function filterMine(items: WireNewsItem[], myPlayerIds: ReadonlySet<number>): WireNewsItem[] {
  if (myPlayerIds.size === 0) return [];
  return items.filter((i) => i.player_ids.some((id) => myPlayerIds.has(id)));
}

/** One chip per team that has a story in the list, busiest first, `ALL` in front. */
export function teamChips(items: WireNewsItem[]): Array<{ key: string; label: string }> {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!i.team_abbrev) continue;
    const t = i.team_abbrev.toUpperCase();
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const teams = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => ({ key: t, label: t }));
  return [{ key: 'all', label: 'ALL' }, ...teams];
}

export function filterTeam(items: WireNewsItem[], team: string): WireNewsItem[] {
  if (team === 'all') return items;
  return items.filter((i) => (i.team_abbrev ?? '').toUpperCase() === team);
}

/** Headline, summary, snippet, author; case-folded. */
export function filterQuery(items: WireNewsItem[], query: string): WireNewsItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) =>
    [i.title, i.summary ?? '', i.snippet ?? '', i.author ?? ''].some((s) => s.toLowerCase().includes(q)),
  );
}

/** The player names a row calls out, in the order the story named them. */
export function namesFor(item: WireNewsItem, nameOf: (id: number) => string | undefined): string[] {
  const out: string[] = [];
  for (const id of item.player_ids) {
    const n = nameOf(id);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The line under the section head. An affirmative signal, per the schema
 * review's first question: not "no errors", but "read 12 minutes ago from
 * 7 sources". Silent wires say so.
 */
export function freshnessLine(health: WireHealth | null, now: Date = new Date()): string | null {
  if (!health || !health.lastRunAt) return null;
  const t = new Date(health.lastRunAt).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  const sources = health.sources === 1 ? '1 source' : `${health.sources} sources`;
  return `Read ${ago} · ${sources}`;
}
