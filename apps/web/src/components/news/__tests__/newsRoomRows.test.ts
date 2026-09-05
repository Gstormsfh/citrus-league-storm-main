import { describe, it, expect } from 'vitest';
import type { WireNewsItem } from '@/services/NewsRoomService';
import { filterMine, filterQuery, filterTeam, freshnessLine, groupByDay, namesFor, teamChips } from '../newsRoomRows';

// Local-time constructor: the grouping is by the viewer's calendar day, so
// the fixture must not drift across a zone boundary on a CI runner in UTC.
const NOW = new Date(2026, 8, 5, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let n = 0;
function item(over: Partial<WireNewsItem> = {}): WireNewsItem {
  n += 1;
  return {
    id: `i${n}`,
    source_id: 'nhl',
    url: `https://www.nhl.com/news/${n}`,
    title: `Story ${n}`,
    snippet: null,
    summary: null,
    author: null,
    image_url: null,
    team_abbrev: null,
    player_ids: [],
    published_at: NOW.toISOString(),
    ...over,
  };
}

describe('groupByDay', () => {
  it('labels today and yesterday by name and older days by date, newest day first', () => {
    const a = item({ published_at: hoursAgo(1) });
    const b = item({ published_at: hoursAgo(24) });
    const c = item({ published_at: hoursAgo(72) });
    const d = item({ published_at: hoursAgo(3) });
    const sections = groupByDay([a, d, b, c], NOW);
    expect(sections.map((s) => s.label)).toEqual(['Today', 'Yesterday', 'Wed, Sep 2']);
    expect(sections[0].items).toEqual([a, d]);
  });

  it('drops a story with an unreadable timestamp rather than inventing a day', () => {
    expect(groupByDay([item({ published_at: 'nope' })], NOW)).toEqual([]);
  });
});

describe('filterMine', () => {
  it('keeps only stories that name one of my players, and nothing when I hold nobody', () => {
    const mine = item({ player_ids: [8478402, 8471214] });
    const theirs = item({ player_ids: [8477934] });
    const team = item({ team_abbrev: 'EDM', player_ids: [] });
    expect(filterMine([mine, theirs, team], new Set([8471214]))).toEqual([mine]);
    expect(filterMine([mine, theirs, team], new Set())).toEqual([]);
  });
});

describe('teamChips / filterTeam', () => {
  it('earns a chip per team with a story, busiest first, ALL in front', () => {
    const items = [
      item({ team_abbrev: 'TOR' }),
      item({ team_abbrev: 'EDM' }),
      item({ team_abbrev: 'EDM' }),
      item({ team_abbrev: null }),
    ];
    expect(teamChips(items).map((c) => c.key)).toEqual(['all', 'EDM', 'TOR']);
    expect(filterTeam(items, 'TOR')).toHaveLength(1);
    expect(filterTeam(items, 'all')).toHaveLength(4);
  });
});

describe('filterQuery', () => {
  it('searches headline, summary, snippet and author, case-folded', () => {
    const a = item({ title: 'McDavid skates in full', summary: 'Back at practice.' });
    const b = item({ title: 'Lines', snippet: 'Draisaitl to the second unit' });
    const c = item({ title: 'Column', author: 'Elliotte Friedman' });
    expect(filterQuery([a, b, c], 'mcdavid')).toEqual([a]);
    expect(filterQuery([a, b, c], 'DRAISAITL')).toEqual([b]);
    expect(filterQuery([a, b, c], 'friedman')).toEqual([c]);
    expect(filterQuery([a, b, c], '  ')).toEqual([a, b, c]);
  });
});

describe('namesFor', () => {
  it('resolves ids to names in story order, skipping unknowns and repeats', () => {
    const names: Record<number, string> = { 1: 'Connor McDavid', 2: 'Leon Draisaitl' };
    expect(namesFor(item({ player_ids: [2, 9, 1, 2] }), (id) => names[id])).toEqual(['Leon Draisaitl', 'Connor McDavid']);
  });
});

describe('freshnessLine', () => {
  it('says when the wires were read and from how many sources', () => {
    const health = { lastRunAt: new Date(NOW.getTime() - 12 * 60_000).toISOString(), sources: 7, seen24h: 120, inserted24h: 30, errors24h: 0 };
    expect(freshnessLine(health, NOW)).toBe('Read 12m ago · 7 sources');
    expect(freshnessLine({ ...health, lastRunAt: hoursAgo(3), sources: 1 }, NOW)).toBe('Read 3h ago · 1 source');
    expect(freshnessLine({ ...health, lastRunAt: hoursAgo(72) }, NOW)).toBe('Read 3d ago · 7 sources');
  });

  it('says nothing, rather than a made-up time, when the wires have never been read', () => {
    expect(freshnessLine(null, NOW)).toBeNull();
    expect(freshnessLine({ lastRunAt: null, sources: 0, seen24h: 0, inserted24h: 0, errors24h: 0 }, NOW)).toBeNull();
  });
});
