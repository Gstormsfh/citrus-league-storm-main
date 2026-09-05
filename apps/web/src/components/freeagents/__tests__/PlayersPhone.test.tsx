// THE PLAYERS SCREEN, AS DRAWN (2026-09-04).
//
// Artboard 1a's fifth phone: six verbs in a tile, `TRENDING · 24H` with an
// ADDS/DROPS toggle, position chips, a column head, rows. These pin the
// words and the wiring — which cell switches which list, which two leave
// the screen, what the head and the column say for each view — and the two
// things the screen deliberately does NOT draw (`FA ONLY`, `ROS%`), so a
// future hand adding them back has to read why they were left out.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlayersPhone, type PlayersPhoneProps } from '../PlayersPhone';

afterEach(() => {
  cleanup();
});

type Row = { id: string; name: string };

function mount(over: Partial<PlayersPhoneProps<Row>> = {}) {
  const calls: string[] = [];
  const props: PlayersPhoneProps<Row> = {
    view: 'trend',
    onView: (v) => calls.push(`view:${v}`),
    leadersTo: '/players',
    tradeTo: '/trade-analyzer?league=L1',
    trendMode: 'adds',
    onTrendMode: (m) => calls.push(`trend:${m}`),
    availableMode: 'proj',
    onAvailableMode: (m) => calls.push(`avail:${m}`),
    searchOpen: false,
    onSearchOpen: (o) => calls.push(`search:${o}`),
    searchQuery: '',
    onSearchQuery: (q) => calls.push(`q:${q}`),
    positions: ['ALL', 'C', 'LW', 'RW', 'W', 'D', 'G'],
    positionFilter: 'ALL',
    onPosition: (p) => calls.push(`pos:${p}`),
    total: 2,
    rows: [
      { id: '1', name: 'Scott Wedgewood' },
      { id: '2', name: 'Brandon Hagel' },
    ],
    renderRow: (r) => (
      <div key={r.id} data-testid="row">
        {r.name}
      </div>
    ),
    empty: { title: 'No adds yet', body: 'Movers show here' },
    ...over,
  };
  const utils = render(
    <MemoryRouter>
      <PlayersPhone {...props} />
    </MemoryRouter>,
  );
  return { ...utils, calls };
}

describe('PlayersPhone', () => {
  it('draws the six verbs in the artboard order, two of them as routes', () => {
    mount();
    const tile = screen.getByRole('group', { name: 'Players actions' });
    const words = [...tile.querySelectorAll('button, a')].map((el) => el.textContent?.trim());
    expect(words).toEqual(['Search', 'Trend', 'Available', 'Leaders', 'Trade', 'Watch']);
    expect(screen.getByRole('link', { name: 'Leaders' })).toHaveAttribute('href', '/players');
    expect(screen.getByRole('link', { name: 'Trade' })).toHaveAttribute('href', '/trade-analyzer?league=L1');
    // The list on screen is the sage cell.
    expect(screen.getByRole('button', { name: 'Trend' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Available' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('TREND: `TRENDING · 24H`, the ADDS/DROPS toggle, and a 24H ADDS column', () => {
    const { calls, container } = mount();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/Trending\s*·\s*24H/);
    const toggle = screen.getByRole('group', { name: 'Trending direction' });
    expect(toggle.textContent).toContain('▲ ADDS');
    expect(toggle.textContent).toContain('▼ DROPS');
    fireEvent.click(screen.getByRole('button', { name: '▼ DROPS' }));
    expect(calls).toContain('trend:drops');
    const head = container.querySelector('[aria-hidden="true"].grid')!;
    expect(head.textContent).toMatch(/24H adds/i);
    // Without the ownership aggregate the head names no percentages.
    expect(head.textContent).not.toMatch(/ROS%/i);
    expect(screen.queryByRole('button', { name: /FA ONLY/i })).toBeNull();
  });

  it('with the ownership aggregate on the page, the head names ROS% / START% (2026-09-05)', () => {
    const { container } = mount({ ownership: true });
    const head = container.querySelector('[aria-hidden="true"].grid')!;
    expect(head.textContent).toMatch(/Player · Ros% \/ Start% · WK proj/i);
  });

  it('AVAILABLE: the count in the head, a PROJ/GAMES toggle, and the column follows it', () => {
    const { rerender, container } = mount({ view: 'available', total: 312 });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/Available\s*·\s*312/);
    expect(screen.getByRole('group', { name: 'Available order' })).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"].grid')!.textContent).toMatch(/WK proj/i);
    rerender(
      <MemoryRouter>
        <PlayersPhone
          view="available"
          onView={() => {}}
          leadersTo="/players"
          tradeTo="/trade-analyzer"
          trendMode="adds"
          onTrendMode={() => {}}
          availableMode="games"
          onAvailableMode={() => {}}
          searchOpen={false}
          onSearchOpen={() => {}}
          searchQuery=""
          onSearchQuery={() => {}}
          positions={['ALL', 'C']}
          positionFilter="ALL"
          onPosition={() => {}}
          total={1}
          rows={[{ id: '1', name: 'x' }]}
          renderRow={(r) => <div key={r.id}>{r.name}</div>}
          empty={{ title: 't', body: 'b' }}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('[aria-hidden="true"].grid')!.textContent).toMatch(/Games/);
  });

  it('the cells switch the list; SEARCH opens the field and focuses it', () => {
    const { calls, rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Available' }));
    fireEvent.click(screen.getByRole('button', { name: /Watch list/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Search players' }));
    expect(calls).toEqual(['view:available', 'view:watch', 'search:true']);
    expect(screen.queryByTestId('players-phone-search')).toBeNull();
    rerender(
      <MemoryRouter>
        <PlayersPhone
          view="trend"
          onView={() => {}}
          leadersTo="/players"
          tradeTo="/trade-analyzer"
          trendMode="adds"
          onTrendMode={() => {}}
          availableMode="proj"
          onAvailableMode={() => {}}
          searchOpen
          onSearchOpen={() => {}}
          searchQuery="vasi"
          onSearchQuery={() => {}}
          positions={['ALL']}
          positionFilter="ALL"
          onPosition={() => {}}
          total={1}
          rows={[{ id: '1', name: 'Andrei Vasilevskiy' }]}
          renderRow={(r) => <div key={r.id}>{r.name}</div>}
          empty={{ title: 't', body: 'b' }}
        />
      </MemoryRouter>,
    );
    const field = screen.getByTestId('players-phone-search') as HTMLInputElement;
    expect(field.value).toBe('vasi');
    expect(document.activeElement).toBe(field);
    // With a query the head says RESULTS and the toggles step aside.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/Results\s*·\s*1/);
    expect(screen.queryByRole('group', { name: 'Trending direction' })).toBeNull();
  });

  it('position chips are the league format list, W spelled WING', () => {
    const { calls } = mount();
    const chips = screen.getByRole('group', { name: 'Position filter' });
    expect([...chips.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'ALL', 'C', 'LW', 'RW', 'WING', 'D', 'G',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'D' }));
    expect(calls).toContain('pos:D');
  });

  it('rows, then `+ N MORE` only while more exist; empty state carries its action', () => {
    const { calls, rerender } = mount({ total: 42, onMore: () => calls.push('more') });
    expect(screen.getAllByTestId('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /\+ 40 more/i }));
    expect(calls).toContain('more');

    rerender(
      <MemoryRouter>
        <PlayersPhone
          view="watch"
          onView={() => {}}
          leadersTo="/players"
          tradeTo="/trade-analyzer"
          trendMode="adds"
          onTrendMode={() => {}}
          availableMode="proj"
          onAvailableMode={() => {}}
          searchOpen={false}
          onSearchOpen={() => {}}
          searchQuery=""
          onSearchQuery={() => {}}
          positions={['ALL']}
          positionFilter="ALL"
          onPosition={() => {}}
          total={0}
          rows={[]}
          renderRow={() => null}
          empty={{
            title: 'Your watch list is empty',
            body: 'Star players to keep track of them',
            action: { label: 'Browse available', onSelect: () => calls.push('browse') },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('players-phone-empty').textContent).toMatch(/Your watch list is empty/);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Watch list');
    fireEvent.click(screen.getByRole('button', { name: 'Browse available' }));
    expect(calls).toContain('browse');
  });
});
