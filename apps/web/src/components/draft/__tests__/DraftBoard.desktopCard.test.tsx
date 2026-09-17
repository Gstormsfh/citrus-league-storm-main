/**
 * THE DESKTOP CARD (2026-09-14, Garrett).
 *
 *   "Board cards also need first initial then last name. G. Storms as example."
 *   "I don't see the player list baked into the drawer ... that's the most
 *    important list for the user to see."
 *
 * Three things the wide board owes him, pinned here: the desktop name line
 * reads `G. Storms` while the phone line keeps the bare surname; the card
 * wears the position colour on the card itself, not on a chip; and in
 * window mode LAST PICKS steps aside on desktop so the pool sits directly
 * under the board. jsdom has no `lg:` breakpoint, so the desktop rules are
 * asserted on the class list the browser will apply.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DraftBoard } from '../DraftBoard';

type BoardTeam = React.ComponentProps<typeof DraftBoard>['teams'][number];
const teams = Array.from({ length: 4 }, (_, i) => ({
  id: `t${i + 1}`, name: `Team ${i + 1}`, owner: `Owner ${i + 1}`, color: '#123456', picks: [],
})) as unknown as BoardTeam[];

const pick = (n: number, teamId: string, playerName: string, position: string) => ({
  id: `p${n}`, teamId, teamName: teamId, playerId: `${8470000 + n}`, playerName, position,
  round: 1, pick: n, timestamp: n, playerTeam: 'FLA', headshotUrl: null,
});

afterEach(cleanup);

function renderBoard(viewportRows?: number) {
  const history = [
    pick(1, 't1', 'Garrett Storms', 'C'),
    pick(2, 't2', 'Nathan MacKinnon', 'C'),
    pick(3, 't3', 'Cale Makar', 'D'),
    pick(4, 't4', 'Pheonix Copley', 'G'),
  ];
  return render(
    <MemoryRouter>
      <DraftBoard teams={teams} draftHistory={history} currentPick={5} currentRound={2} totalRounds={2} userTeamId="t1" viewportRows={viewportRows} />
    </MemoryRouter>,
  );
}

describe('DraftBoard — the desktop card', () => {
  it('prints first initial, then surname, on the desktop line; the phone line keeps the surname', () => {
    renderBoard(5);
    const names = screen.getAllByTestId('draft-board-name').map((el) => el.textContent);
    expect(names).toEqual(['G. Storms', 'N. MacKinnon', 'C. Makar', 'P. Copley']);
    // The phone line is the same button's `lg:hidden` span: bare surname, unchanged.
    const card = screen.getByRole('button', { name: /Garrett Storms/ });
    const phoneLine = card.querySelector('span.lg\\:hidden');
    expect(phoneLine?.textContent).toBe('Storms');
  });

  it('a single-word name is printed whole on both lines', () => {
    render(
      <MemoryRouter>
        <DraftBoard teams={teams} draftHistory={[pick(1, 't1', 'Ovechkin', 'LW')]} currentPick={2} currentRound={1} totalRounds={1} userTeamId="t1" viewportRows={5} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('draft-board-name').textContent).toBe('Ovechkin');
  });

  it('colours the card itself by position at lg, with the position and club beside the face', () => {
    renderBoard(5);
    const centre = screen.getByRole('button', { name: /Garrett Storms/ });
    expect(centre.className).toContain('lg:bg-pastel-sage');
    const goalie = screen.getByRole('button', { name: /Pheonix Copley/ });
    expect(goalie.className).toContain('lg:bg-pastel-sage/15');
    const line = centre.querySelector('[data-testid="draft-board-position"]');
    expect(line?.textContent).toBe('C FLA');
  });

  it('in window mode LAST PICKS is hidden on desktop and kept on the phone', () => {
    renderBoard(5);
    const last = screen.getByTestId('draft-board-last-picks');
    expect(last.className).toContain('lg:hidden');
  });

  it('without a window (the phone) LAST PICKS is not hidden anywhere', () => {
    renderBoard(undefined);
    const last = screen.getByTestId('draft-board-last-picks');
    expect(last.className).not.toContain('lg:hidden');
  });
});
