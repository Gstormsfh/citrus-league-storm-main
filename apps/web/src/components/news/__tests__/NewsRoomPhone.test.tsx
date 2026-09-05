// THE CITRUS NEWS ROOM ON A PHONE (2026-09-05). Pins the shape: two views in
// a segmented control, a chip per team with a story, stories grouped by day
// in one tile per day, each row the link to the writer with the players it
// names; the freshness line when the wires have been read; the empty states
// say which view is empty and why; a thin skeleton while loading.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { NewsRoomPhone } from '../NewsRoomPhone';
import type { WireNewsItem } from '@/services/NewsRoomService';

afterEach(() => {
  cleanup();
});

const NOW = Date.now();
/** A clock time on a local calendar day: grouping is by the viewer's day. */
const at = (daysAgo: number, hour: number): string => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};
const story = (n: number, over: Partial<WireNewsItem> = {}): WireNewsItem => ({
  id: `s${n}`,
  source_id: 'nhl',
  url: `https://www.nhl.com/news/${n}`,
  title: `Story ${n}`,
  snippet: 'The first line of the article.',
  summary: 'What happened, in one sentence.',
  author: null,
  image_url: null,
  team_abbrev: 'EDM',
  player_ids: [8478402],
  published_at: at(n >= 24 ? 1 : 0, n >= 24 ? 12 : 9 - n),
  ...over,
});

const NAMES: Record<number, string> = { 8478402: 'Connor McDavid', 8477934: 'Leon Draisaitl' };

const mount = (over: Partial<React.ComponentProps<typeof NewsRoomPhone>> = {}) => {
  const onSegment = vi.fn();
  const onTeam = vi.fn();
  const onSearchQuery = vi.fn();
  render(
    <NewsRoomPhone
      items={[
        story(1),
        story(2, { team_abbrev: 'TOR', player_ids: [], source_id: 'espn', author: 'Greg Wyshynski' }),
        story(30, { player_ids: [8478402, 8477934] }),
      ]}
      loading={false}
      health={{ lastRunAt: new Date(NOW - 12 * 60_000).toISOString(), sources: 7, seen24h: 100, inserted24h: 20, errors24h: 0 }}
      segment="all"
      onSegment={onSegment}
      hasRoster
      team="all"
      onTeam={onTeam}
      searchOpen={false}
      searchQuery=""
      onSearchQuery={onSearchQuery}
      nameOf={(id) => NAMES[id]}
      {...over}
    />,
  );
  return { onSegment, onTeam, onSearchQuery };
};

describe('NewsRoomPhone', () => {
  it('offers MY PLAYERS and ALL, and reports the pick through the caller', () => {
    const { onSegment } = mount();
    const group = screen.getByRole('group', { name: 'News Room view' });
    expect(within(group).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'MY PLAYERS' }));
    expect(onSegment).toHaveBeenCalledWith('mine');
  });

  it('earns a chip per team with a story, busiest first, and filters through the caller', () => {
    const { onTeam } = mount();
    const chips = screen.getByRole('group', { name: 'Team filter' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['ALL', 'EDM', 'TOR']);
    fireEvent.click(within(chips).getByRole('button', { name: 'TOR' }));
    expect(onTeam).toHaveBeenCalledWith('TOR');
  });

  it('groups stories by day, one tile per day, newest first', () => {
    mount();
    const list = screen.getByTestId('news-room-list');
    const days = within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(['Today', 'Yesterday']);
    expect(within(list).getAllByTestId('news-item')).toHaveLength(3);
  });

  it('every row is the link to the writer and names the players the story names', () => {
    mount();
    const rows = screen.getAllByTestId('news-item');
    expect(rows[0]).toHaveAttribute('href', 'https://www.nhl.com/news/1');
    expect(rows[0]).toHaveAttribute('target', '_blank');
    expect(rows[0]).toHaveTextContent('NHL.com');
    expect(rows[0]).toHaveTextContent('Connor McDavid');
    expect(rows[0]).toHaveTextContent('What happened, in one sentence.');
    expect(rows[1]).toHaveTextContent('ESPN');
    expect(rows[1]).toHaveTextContent('Greg Wyshynski');
    expect(rows[1]).not.toHaveTextContent('Connor McDavid');
    expect(rows[2]).toHaveTextContent('Connor McDavid · Leon Draisaitl');
  });

  it('prints when the wires were last read, and nothing when they never have been', () => {
    mount();
    expect(screen.getByTestId('news-room-freshness')).toHaveTextContent('Read 12m ago · 7 sources');
    cleanup();
    mount({ health: null });
    expect(screen.queryByTestId('news-room-freshness')).not.toBeInTheDocument();
  });

  it('narrows to a team and to a search, and counts what is left', () => {
    mount({ team: 'TOR' });
    expect(screen.getAllByTestId('news-item')).toHaveLength(1);
    cleanup();
    mount({ searchOpen: true, searchQuery: 'wyshynski' });
    expect(screen.getByTestId('news-room-search')).toHaveValue('wyshynski');
    expect(screen.getAllByTestId('news-item')).toHaveLength(1);
    expect(screen.getByText('Results')).toBeInTheDocument();
  });

  it('says which view is empty and why, and offers the way out of MY PLAYERS', () => {
    const { onSegment } = mount({ items: [], segment: 'mine', hasRoster: false });
    expect(screen.getByTestId('news-room-empty')).toHaveTextContent('No roster yet');
    fireEvent.click(screen.getByRole('button', { name: 'See everything on the wire' }));
    expect(onSegment).toHaveBeenCalledWith('all');
    cleanup();
    mount({ items: [], segment: 'mine', hasRoster: true });
    expect(screen.getByTestId('news-room-empty')).toHaveTextContent('Quiet on your guys');
    cleanup();
    mount({ items: [], segment: 'all' });
    expect(screen.getByTestId('news-room-empty')).toHaveTextContent('Nothing on the wire');
    expect(screen.queryByRole('button', { name: 'See everything on the wire' })).not.toBeInTheDocument();
    cleanup();
    mount({ team: 'BOS' });
    expect(screen.getByTestId('news-room-empty')).toHaveTextContent('Quiet in BOS');
  });

  it('shows a skeleton, not a spinner, while the wires load', () => {
    mount({ loading: true, items: [] });
    expect(screen.getByTestId('news-room-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('news-room-empty')).not.toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
