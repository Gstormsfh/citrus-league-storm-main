// LEAGUE HQ ON A PHONE (2026-09-04) — artboard 1a's LEAGUE tab.
//
// The layout is the component's; the data is the page's. These pin what the
// screen says in each state the page can hand it: a week with matchups, a
// week with none, no week at all (offseason, pre-draft), and the draft card
// in its hot and ghost states — plus the two rules a future hand is most
// likely to break: the caller's card is drawn first, and nothing here draws
// a figure it was not given.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BarChart3, Settings } from 'lucide-react';
import { LeagueHQPhone } from '../LeagueHQPhone';
import type { PressBoxTileProps } from '@/components/pressbox/Tile';

afterEach(() => {
  cleanup();
});

const tiles: PressBoxTileProps[] = [
  { title: 'Standings', to: '/standings?league=L1', Icon: BarChart3, stat: null },
  { title: 'League settings', onPress: () => {}, Icon: Settings },
];

const mount = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('LeagueHQPhone', () => {
  it('draws the week, three cards, and + N MORE — with no bar where no chance was given', () => {
    const { container } = mount(
      <LeagueHQPhone
        week={{ number: 5, to: '/matchup/L1/5' }}
        matchups={[
          { id: 'a', home: { name: 'Bench Bosses', points: 104.7 }, away: { name: 'Sin Bin Saints', points: 103.9 }, to: '/matchup/L1/5' },
          { id: 'b', home: { name: 'Gstorms', points: 118.4, isYou: true }, away: { name: 'Puck Norris', points: 96.1 }, to: '/matchup/L1/5' },
          { id: 'c', home: { name: 'A', points: 1 }, away: { name: 'B', points: 2 }, to: '/matchup/L1/5' },
          { id: 'd', home: { name: 'C', points: 1 }, away: { name: 'D', points: 2 }, to: '/matchup/L1/5' },
          { id: 'e', home: { name: 'E', points: 1 }, away: { name: 'F', points: 2 }, to: '/matchup/L1/5' },
        ]}
        tiles={tiles}
      />,
    );
    expect(screen.getByRole('link', { name: /WEEK 5/ })).toHaveAttribute('href', '/matchup/L1/5');
    const cards = container.querySelectorAll('a[aria-label*="versus"]');
    expect(cards).toHaveLength(3);
    expect(screen.getByRole('link', { name: '+ 2 MORE MATCHUPS' })).toBeTruthy();
    // No win chance was passed, so no bar is drawn: `style="width"` is the bar's only inline style.
    expect(container.querySelectorAll('a[aria-label*="versus"] [style*="width"]')).toHaveLength(0);
    expect(cards[0].textContent).toContain('118.4');
  });

  it('says why there are no cards: offseason, pre-draft, or an empty week', () => {
    const { rerender } = mount(<LeagueHQPhone week={null} seasonOpensOn="Sep 29" tiles={tiles} />);
    expect(screen.getByTestId('league-hq-no-week').textContent).toMatch(/Season opens Sep 29/);
    rerender(
      <MemoryRouter>
        <LeagueHQPhone
          week={null}
          tiles={tiles}
          draft={{ label: 'Enter draft lobby', hot: false, description: 'Waiting on the commissioner.', to: '/draft-v2/L1' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('league-hq-no-week').textContent).toMatch(/once the draft is done/);
    rerender(
      <MemoryRouter>
        <LeagueHQPhone week={{ number: 2, to: '/matchup/L1/2' }} matchups={[]} tiles={tiles} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('league-hq-no-matchups').textContent).toMatch(/week 2/);
  });

  it('shows the draft as the top action, orange only when pressing it is the next real move', () => {
    const { rerender } = mount(
      <LeagueHQPhone
        week={null}
        tiles={tiles}
        draft={{
          label: 'Join draft room',
          hot: true,
          description: 'The draft is live.',
          to: '/draft-v2/L1',
          mock: { label: 'Run a mock draft', to: '/armchair-gm?tab=mockdraft', note: 'Nothing there touches this league.' },
        }}
      />,
    );
    const cta = screen.getByRole('link', { name: 'Join draft room' });
    expect(cta).toHaveAttribute('href', '/draft-v2/L1');
    expect(cta.className).toContain('bg-pressbox-orange');
    expect(screen.getByRole('link', { name: 'Run a mock draft' })).toHaveAttribute('href', '/armchair-gm?tab=mockdraft');
    // The draft card precedes the matchups head in the document.
    const card = screen.getByTestId('league-hq-draft');
    const head = screen.getByRole('heading', { level: 2, name: /Matchups/ });
    expect(card.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(
      <MemoryRouter>
        <LeagueHQPhone
          week={null}
          tiles={tiles}
          draft={{ label: 'Enter draft lobby', hot: false, description: 'x', to: '/draft-v2/L1', note: 'Once the commissioner starts' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Enter draft lobby' }).className).not.toContain('bg-pressbox-orange');
    expect(screen.getByTestId('league-hq-draft').textContent).toContain('Once the commissioner starts');
  });

  it('tiles route or act, and the teams list marks yours', () => {
    let pressed = 0;
    mount(
      <LeagueHQPhone
        week={null}
        tiles={[
          { title: 'Standings', to: '/standings?league=L1', Icon: BarChart3, stat: null },
          { title: 'League settings', onPress: () => { pressed += 1; }, Icon: Settings },
        ] satisfies PressBoxTileProps[]}
        teams={[
          { id: 't1', name: 'Bench Bosses', owner: 'Manager', rosterCount: 18, to: '/team/t1' },
          { id: 't2', name: 'Gstorms', owner: 'You', rosterCount: 17, isYou: true, to: '/team/t2' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Standings' })).toHaveAttribute('href', '/standings?league=L1');
    screen.getByRole('button', { name: 'League settings' }).click();
    expect(pressed).toBe(1);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('YOU');
    expect(rows[1].textContent).toContain('17 players');
    expect(screen.getByRole('heading', { level: 2, name: /Teams/ }).textContent).toMatch(/2/);
  });
});
