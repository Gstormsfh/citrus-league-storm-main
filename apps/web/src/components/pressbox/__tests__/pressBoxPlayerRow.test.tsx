/**
 * The Players row's second meta line (2026-09-05): `46% · 10% · WK 55.3 ·
 * 7 GP` under a head that names the percentages, and `WK PROJ 55.3 · 7 GP`
 * when there is no ownership on the page.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PressBoxPlayerRow } from '../PlayerRow';

afterEach(cleanup);

const mount = (over: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <PressBoxPlayerRow
        rank={1}
        player={{ id: 1, name: 'Nikita Kucherov', team: 'TBL', teamAbbreviation: 'TBL', position: 'RW', weekProjection: 55.3, gamesThisWeek: 7, ...over }}
        destination="FREE AGENT"
        action="add"
      />
    </MemoryRouter>,
  ).container;

describe('PressBoxPlayerRow · the second meta line', () => {
  it('carries the two percentages as bare numbers, then WK and the games', () => {
    const c = mount({ rosteredPct: 46, startedPct: 10 });
    expect(c.textContent).toContain('46% · 10% · WK 55.3 · 7 GP');
    expect(c.textContent).not.toContain('ROS 46%');
  });
  it('without ownership, says WK PROJ so the number has a name', () => {
    const c = mount();
    expect(c.textContent).toContain('WK PROJ 55.3 · 7 GP');
    expect(c.textContent).not.toMatch(/\d+% · \d+%/);
  });
});
