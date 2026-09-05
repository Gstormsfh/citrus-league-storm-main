// THE NEWS TAB ON A PHONE (2026-09-04). Pins the shape: the first story is
// the lead with its picture, the rest are rows; the category chips filter
// through the caller; search is a row that appears on request; an empty
// wire says so; and the eyebrow's time is compact.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NewsPhone } from '../NewsPhone';
import { agoLabel } from '../newsFormat';
import type { NewsArticle } from '@/services/NewsService';

afterEach(() => {
  cleanup();
});

const story = (id: number, category: NewsArticle['category'], title: string, image = true): NewsArticle => ({
  id: String(id),
  title,
  description: 'What happened, in a line.',
  url: `https://example.com/${id}`,
  imageUrl: image ? `https://example.com/${id}.jpg` : '',
  source: 'The Wire',
  category,
  publishedAt: new Date(Date.now() - id * 3_600_000).toISOString(),
});

const CATS = [
  { key: 'all', label: 'All News' },
  { key: 'injury', label: 'Injuries' },
];

const mount = (over: Partial<React.ComponentProps<typeof NewsPhone>> = {}) => {
  const onCategory = vi.fn();
  const onSearchQuery = vi.fn();
  render(
    <NewsPhone
      articles={[story(1, 'top', 'Lead story'), story(2, 'injury', 'Second story', false), story(3, 'trade', 'Third story')]}
      loading={false}
      categories={CATS}
      category="all"
      onCategory={onCategory}
      searchOpen={false}
      searchQuery=""
      onSearchQuery={onSearchQuery}
      {...over}
    />,
  );
  return { onCategory, onSearchQuery };
};

describe('NewsPhone', () => {
  it('leads with the first story and rows the rest, each a link out', () => {
    mount();
    const lead = screen.getByTestId('news-phone-lead');
    expect(lead).toHaveAttribute('href', 'https://example.com/1');
    expect(lead).toHaveTextContent('Lead story');
    expect(lead.querySelector('img')).not.toBeNull();
    const list = screen.getByTestId('news-phone-list');
    expect(list.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByText('INJURY')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('On the wire · 3');
  });

  it('the chips change the category through the caller', () => {
    const { onCategory } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'INJURIES' }));
    expect(onCategory).toHaveBeenCalledWith('injury');
  });

  it('search is a row that appears on request and writes through', () => {
    mount();
    expect(screen.queryByTestId('news-phone-search')).toBeNull();
    cleanup();
    const { onSearchQuery } = mount({ searchOpen: true, searchQuery: 'Kap' });
    fireEvent.change(screen.getByTestId('news-phone-search'), { target: { value: 'Kapr' } });
    expect(onSearchQuery).toHaveBeenCalledWith('Kapr');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSearchQuery).toHaveBeenCalledWith('');
  });

  it('an empty wire says so; a search with no match says that instead', () => {
    mount({ articles: [] });
    expect(screen.getByTestId('news-phone-empty')).toHaveTextContent('Nothing on the wire');
    cleanup();
    mount({ articles: [], searchQuery: 'zzz' });
    expect(screen.getByTestId('news-phone-empty')).toHaveTextContent('Nothing matched');
  });

  it('loading is tiles, not a spinner', () => {
    mount({ loading: true, articles: [] });
    expect(screen.getByTestId('news-phone-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('news-phone-empty')).toBeNull();
  });

  it('agoLabel is compact', () => {
    const now = Date.parse('2026-09-04T18:00:00Z');
    expect(agoLabel('2026-09-04T17:48:00Z', now)).toBe('12M AGO');
    expect(agoLabel('2026-09-04T14:00:00Z', now)).toBe('4H AGO');
    expect(agoLabel('2026-09-02T18:00:00Z', now)).toBe('2D AGO');
    expect(agoLabel('nonsense', now)).toBe('');
  });
});
