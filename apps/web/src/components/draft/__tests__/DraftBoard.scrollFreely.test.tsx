/**
 * SCROLL FREELY (2026-09-14, Garrett's draft-room list, item 4).
 *
 * The board re-centred on the on-clock cell for every pick, dragging a
 * manager who was reading another column back each time anyone drafted. It
 * now centres once on mount and again only when the clock reaches the
 * manager's own pick.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DraftBoard } from '../DraftBoard';

type BoardTeam = React.ComponentProps<typeof DraftBoard>['teams'][number];
const teams = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i + 1}`, name: `Team ${i + 1}`, owner: `Owner ${i + 1}`, color: '#123456', picks: [],
})) as unknown as BoardTeam[];

// jsdom has no layout; give the scroller a width and each cell a position so
// the centring maths produces a number worth asserting on.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 80; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get() {
      const label = (this as HTMLElement).textContent ?? '';
      const m = label.match(/(\d+)\.(\d+)/);
      return m ? Number(m[2]) * 100 : 0; // cell for pick x.NN sits at NN*100px
    },
  });
});
afterEach(cleanup);

const scroller = () => document.querySelector('[data-testid="draft-board-on-clock"]')!.closest('.overflow-x-auto') as HTMLDivElement;

function renderBoard(currentPick: number, userTeamId = 't3') {
  return render(
    <MemoryRouter>
      <DraftBoard teams={teams} draftHistory={[]} currentPick={currentPick} currentRound={1} totalRounds={2} userTeamId={userTeamId} />
    </MemoryRouter>,
  );
}

describe('DraftBoard — the board scrolls freely', () => {
  it('centres on the on-clock cell once when it mounts', () => {
    renderBoard(6);
    // pick 1.06 sits at 600px; centred in a 600px scroller with an 80px cell → 340
    expect(scroller().scrollLeft).toBe(340);
  });

  it('leaves a manual scroll alone when someone else picks', () => {
    const view = renderBoard(6);
    scroller().scrollLeft = 900; // the manager went looking at column 10
    view.rerender(<MemoryRouter><DraftBoard teams={teams} draftHistory={[]} currentPick={7} currentRound={1} totalRounds={2} userTeamId="t3" /></MemoryRouter>);
    expect(scroller().scrollLeft).toBe(900);
    view.rerender(<MemoryRouter><DraftBoard teams={teams} draftHistory={[]} currentPick={8} currentRound={1} totalRounds={2} userTeamId="t3" /></MemoryRouter>);
    expect(scroller().scrollLeft).toBe(900);
  });

  it('brings the manager back when the clock reaches their own pick', () => {
    const view = renderBoard(1, 't3');
    scroller().scrollLeft = 900;
    view.rerender(<MemoryRouter><DraftBoard teams={teams} draftHistory={[]} currentPick={2} currentRound={1} totalRounds={2} userTeamId="t3" /></MemoryRouter>);
    expect(scroller().scrollLeft).toBe(900);
    // pick 3 in round 1 belongs to t3 (snake, odd round: team index 2)
    view.rerender(<MemoryRouter><DraftBoard teams={teams} draftHistory={[]} currentPick={3} currentRound={1} totalRounds={2} userTeamId="t3" /></MemoryRouter>);
    expect(scroller().scrollLeft).toBe(40); // 1.03 at 300px → 300 - 300 + 40
  });

  it('follows the snake: in round 2 the same team is on the clock at pick 22', () => {
    const view = renderBoard(20, 't3');
    scroller().scrollLeft = 900;
    view.rerender(<MemoryRouter><DraftBoard teams={teams} draftHistory={[]} currentPick={21} currentRound={2} totalRounds={2} userTeamId="t3" /></MemoryRouter>);
    expect(scroller().scrollLeft).toBe(900);
    view.rerender(<MemoryRouter><DraftBoard teams={teams} draftHistory={[]} currentPick={22} currentRound={2} totalRounds={2} userTeamId="t3" /></MemoryRouter>);
    expect(scroller().scrollLeft).not.toBe(900);
  });
});

describe('DraftBoard — the desktop window (viewportRows)', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get() {
        const m = ((this as HTMLElement).textContent ?? '').match(/(\d+)\.(\d+)/);
        return m ? 22 + (Number(m[1]) - 1) * 76 : 0; // round r sits at head + (r-1) desktop rows
      },
    });
  });

  it('caps the board at the requested rows on desktop and scrolls the clock into the window', () => {
    render(
      <MemoryRouter>
        <DraftBoard teams={teams} draftHistory={[]} currentPick={37} currentRound={4} totalRounds={10} userTeamId="t3" viewportRows={5} />
      </MemoryRouter>,
    );
    const sc = document.querySelector('[data-testid="draft-board-scroller"]') as HTMLDivElement;
    expect(sc.className).toMatch(/lg:max-h-\[var\(--board-viewport\)\]/);
    expect(sc.className).toMatch(/lg:overflow-y-auto/);
    expect(sc.style.getPropertyValue('--board-viewport')).toBe(`${22 + 5 * 76}px`);
    // pick 4.01 is in round 4: the window puts round 3 at the top under the heads
    expect(sc.scrollTop).toBe(22 + 3 * 76 - 76 - 22);
  });

  it('without viewportRows the board renders in flow: no cap, no vertical scroll', () => {
    render(
      <MemoryRouter>
        <DraftBoard teams={teams} draftHistory={[]} currentPick={37} currentRound={4} totalRounds={10} userTeamId="t3" />
      </MemoryRouter>,
    );
    const sc = document.querySelector('[data-testid="draft-board-scroller"]') as HTMLDivElement;
    expect(sc.className).not.toMatch(/overflow-y-auto/);
    expect(sc.style.getPropertyValue('--board-viewport')).toBe('');
    expect(sc.scrollTop).toBe(0);
  });
});
