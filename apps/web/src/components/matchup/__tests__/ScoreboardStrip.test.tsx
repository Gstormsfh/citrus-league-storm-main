// LEAGUE SCOREBOARD STRIP (2026-09-01, Sleeper parity audit M7)
//
// What would be wrong rather than ugly: a chip missing or duplicated, the
// orange identity ring on a stranger's matchup, sage on the trailing score,
// a tap that switches to the wrong matchup (or re-loads the one on screen),
// and a strip that claims LIVE or FINAL when it is neither. The rules are
// pinned in scoreboard.test.ts; this file pins how the strip draws them and
// what a tap does.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ScoreboardStrip } from '../ScoreboardStrip';
import type { WeekMatchupRow } from '../scoreboard';

const TODAY = '2026-10-14';

const rows: WeekMatchupRow[] = [
  {
    id: 'm1', team1_id: 't1', team2_id: 't2', team1_score: 12.4, team2_score: 9.8,
    status: 'in_progress', week_end_date: '2026-10-17', team1_name: 'Citrus Crushers', team2_name: 'Thunder Titans',
  },
  {
    id: 'm2', team1_id: 't3', team2_id: 't4', team1_score: '31.0', team2_score: '44.5',
    status: 'in_progress', week_end_date: '2026-10-17', team1_name: 'Puck Dynasty', team2_name: 'Ice Wolves',
  },
  {
    id: 'm3', team1_id: 't5', team2_id: 't6', team1_score: 0, team2_score: 0,
    status: 'in_progress', week_end_date: '2026-10-17', team1_name: 'Rink Rats', team2_name: 'Slapshot Society',
  },
];

const chips = () => screen.getAllByTestId('scoreboard-chip');
const chip = (id: string) => chips().find((c) => c.getAttribute('data-matchup-id') === id)!;

describe('ScoreboardStrip — one chip per matchup', () => {
  it('renders every matchup once, both teams and both scores in each chip', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    expect(chips()).toHaveLength(3);
    const first = chip('m1');
    expect(first).toHaveTextContent('Citrus Crushers');
    expect(first).toHaveTextContent('Thunder Titans');
    expect(first).toHaveTextContent('12.4');
    expect(first).toHaveTextContent('9.8');
    // Numeric-string scores print like numbers.
    expect(chip('m2')).toHaveTextContent('44.5');
  });

  it('renders nothing at all with no matchups', () => {
    const { container } = render(<ScoreboardStrip matchups={[]} onSelect={() => {}} today={TODAY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a one-matchup league still gets its strip (two-team league, or a bye pair)', () => {
    render(<ScoreboardStrip matchups={[rows[0]]} onSelect={() => {}} today={TODAY} />);
    expect(chips()).toHaveLength(1);
    expect(screen.getByTestId('scoreboard-strip')).toBeInTheDocument();
  });

  it('a bye shows the lone team and says so instead of inventing an opponent', () => {
    render(
      <ScoreboardStrip
        matchups={[{ ...rows[0], id: 'bye', team2_id: null, team2_name: undefined, team2_score: null }]}
        onSelect={() => {}}
        today={TODAY}
      />,
    );
    const c = chip('bye');
    expect(within(c).getByTestId('scoreboard-team2')).toHaveAttribute('data-bye', 'true');
    expect(c).toHaveTextContent(/Bye week/);
    // Nobody leads a bye.
    expect(within(c).queryAllByTestId('scoreboard-score').some((s) => s.hasAttribute('data-leading'))).toBe(false);
  });

  it('every score is set in the mono face with tabular figures', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    for (const el of screen.getAllByTestId('scoreboard-score')) {
      expect(el).toHaveClass('font-jbmono');
      expect(el).toHaveClass('tabular-nums');
    }
  });
});

describe('ScoreboardStrip — identity ≠ standing', () => {
  it('rings only the viewer’s own matchup in orange, and colours only their name inside it', () => {
    render(<ScoreboardStrip matchups={rows} ownMatchupId="m1" ownTeamId="t2" onSelect={() => {}} today={TODAY} />);
    const mine = chip('m1');
    expect(mine).toHaveAttribute('data-own', 'true');
    expect(mine.className).toMatch(/ring-pastel-orange/);
    expect(chip('m2').className).not.toMatch(/orange/);
    expect(chip('m3').className).not.toMatch(/orange/);
    // Inside my chip: my side (team2) is orange, the opponent is not.
    expect(within(mine).getByTestId('scoreboard-team2')).toHaveAttribute('data-own', 'true');
    expect(within(mine).getByTestId('scoreboard-team1')).not.toHaveAttribute('data-own');
    expect(mine.getAttribute('aria-label')).toMatch(/your matchup/);
    expect(chip('m2').getAttribute('aria-label')).not.toMatch(/your matchup/);
  });

  it('paints the leading score sage and the trailing one muted — never orange', () => {
    render(<ScoreboardStrip matchups={rows} ownMatchupId="m1" ownTeamId="t2" onSelect={() => {}} today={TODAY} />);
    const mine = within(chip('m1'));
    const [s1, s2] = mine.getAllByTestId('scoreboard-score');
    // I (team2, 9.8) am LOSING: my opponent's score is sage, mine is not.
    expect(s1).toHaveAttribute('data-leading', 'true');
    expect(s1).toHaveClass('text-pastel-sage');
    expect(s2).not.toHaveAttribute('data-leading');
    expect(s2).not.toHaveClass('text-pastel-sage');
    expect(s2.className).not.toMatch(/orange/);

    const [o1, o2] = within(chip('m2')).getAllByTestId('scoreboard-score');
    expect(o1).not.toHaveClass('text-pastel-sage');
    expect(o2).toHaveClass('text-pastel-sage');
  });

  it('a tie lights neither score', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    for (const s of within(chip('m3')).getAllByTestId('scoreboard-score')) {
      expect(s).not.toHaveClass('text-pastel-sage');
    }
  });

  it('marks the matchup on screen as current, separately from ownership', () => {
    render(<ScoreboardStrip matchups={rows} ownMatchupId="m1" viewedMatchupId="m2" onSelect={() => {}} today={TODAY} />);
    expect(chip('m2')).toHaveAttribute('aria-current', 'true');
    expect(chip('m2')).toHaveAttribute('data-viewed', 'true');
    expect(chip('m2').className).not.toMatch(/orange/);
    expect(chip('m1')).not.toHaveAttribute('aria-current');
    expect(chip('m1').className).toMatch(/ring-pastel-orange/);
  });
});

describe('ScoreboardStrip — tapping', () => {
  it('calls the switch handler with the tapped matchup id', () => {
    const onSelect = vi.fn();
    render(<ScoreboardStrip matchups={rows} ownMatchupId="m1" viewedMatchupId="m1" onSelect={onSelect} today={TODAY} />);
    fireEvent.click(chip('m2'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('m2');
    fireEvent.click(chip('m3'));
    expect(onSelect).toHaveBeenLastCalledWith('m3');
  });

  it('does not re-load the matchup already on screen', () => {
    const onSelect = vi.fn();
    render(<ScoreboardStrip matchups={rows} viewedMatchupId="m2" onSelect={onSelect} today={TODAY} />);
    fireEvent.click(chip('m2'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('every chip is a real button with an accessible name naming both teams', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute('aria-label', expect.stringMatching(/Citrus Crushers 12\.4, Thunder Titans 9\.8/));
  });
});

describe('ScoreboardStrip — week state', () => {
  it('reads FINAL once every matchup is settled, and tags each chip', () => {
    const done = rows.map((r) => ({ ...r, status: 'completed' }));
    render(<ScoreboardStrip matchups={done} onSelect={() => {}} today={TODAY} />);
    expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-state', 'final');
    expect(screen.getByTestId('scoreboard-state')).toHaveTextContent(/Final/);
    for (const c of chips()) expect(c).toHaveAttribute('data-final', 'true');
  });

  it('reads FINAL for a week that ended on the calendar even if the status column lags', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today="2026-10-20" />);
    expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-state', 'final');
  });

  it('shows the LIVE dot only when told a game is in progress', () => {
    const { rerender } = render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-state', 'open');
    expect(screen.queryByTestId('scoreboard-state')).toBeNull();
    rerender(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} live />);
    expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-state', 'live');
    expect(screen.getByTestId('scoreboard-state')).toHaveTextContent(/Live/);
    expect(screen.getByTestId('scoreboard-state').className).toMatch(/text-pastel-sage/);
  });

  it('a settled week never claims LIVE', () => {
    const done = rows.map((r) => ({ ...r, status: 'completed' }));
    render(<ScoreboardStrip matchups={done} onSelect={() => {}} today={TODAY} live />);
    expect(screen.getByTestId('scoreboard-state')).toHaveTextContent(/Final/);
  });

  it('names the week in the eyebrow', () => {
    render(<ScoreboardStrip matchups={rows} week={5} onSelect={() => {}} today={TODAY} />);
    expect(screen.getByTestId('scoreboard-strip')).toHaveTextContent(/Scoreboard/);
    expect(screen.getByTestId('scoreboard-strip')).toHaveTextContent(/Wk 5/);
  });
});

describe('ScoreboardStrip — where the strip scrolls itself', () => {
  // jsdom has no layout, so positions are all 0; what can be pinned is WHEN
  // the strip moves itself: on mount and on an outside change of the viewed
  // matchup, never right after the user tapped a chip they can already see.
  const proto = Element.prototype as unknown as { scrollTo?: (...args: unknown[]) => void };

  it('scrolls to your chip on mount, stays put after a tap, and follows an outside switch', () => {
    const original = proto.scrollTo;
    const scrollTo = vi.fn();
    proto.scrollTo = scrollTo;
    try {
      const { rerender } = render(
        <ScoreboardStrip matchups={rows} ownMatchupId="m2" viewedMatchupId="m2" onSelect={() => {}} today={TODAY} />,
      );
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'auto' });

      fireEvent.click(chip('m3'));
      rerender(<ScoreboardStrip matchups={rows} ownMatchupId="m2" viewedMatchupId="m3" onSelect={() => {}} today={TODAY} />);
      expect(scrollTo).toHaveBeenCalledTimes(1);

      rerender(<ScoreboardStrip matchups={rows} ownMatchupId="m2" viewedMatchupId="m1" onSelect={() => {}} today={TODAY} />);
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo.mock.calls[1][0]).toMatchObject({ behavior: 'smooth' });
    } finally {
      proto.scrollTo = original;
    }
  });

  it('a score refresh (same matchups, new numbers) leaves the strip where the reader put it; a new week moves it', () => {
    const original = proto.scrollTo;
    const scrollTo = vi.fn();
    proto.scrollTo = scrollTo;
    try {
      const { rerender } = render(
        <ScoreboardStrip matchups={rows} ownMatchupId="m2" viewedMatchupId="m2" onSelect={() => {}} today={TODAY} />,
      );
      expect(scrollTo).toHaveBeenCalledTimes(1);

      // The 120s tick: same ids, fresh scores, a new array.
      const refreshed = rows.map((r) => ({ ...r, team1_score: 99 }));
      rerender(<ScoreboardStrip matchups={refreshed} ownMatchupId="m2" viewedMatchupId="m2" onSelect={() => {}} today={TODAY} />);
      expect(scrollTo).toHaveBeenCalledTimes(1);

      // Next week: new matchup ids, same count — the strip must still find the new chip.
      const nextWeek = rows.map((r, i) => ({ ...r, id: `w2-${i}` }));
      rerender(<ScoreboardStrip matchups={nextWeek} ownMatchupId="w2-1" viewedMatchupId="w2-1" onSelect={() => {}} today={TODAY} />);
      expect(scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      proto.scrollTo = original;
    }
  });

  it('the rail never scrolls anything', () => {
    const original = proto.scrollTo;
    const scrollTo = vi.fn();
    proto.scrollTo = scrollTo;
    try {
      render(<ScoreboardStrip layout="rail" matchups={rows} ownMatchupId="m2" viewedMatchupId="m2" onSelect={() => {}} today={TODAY} />);
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      proto.scrollTo = original;
    }
  });
});

describe('ScoreboardStrip — layouts', () => {
  it('the strip scrolls inside its own box with scroll-snap; the page never becomes the scroller', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    const scroller = screen.getByTestId('scoreboard-scroller');
    expect(scroller).toHaveClass('overflow-x-auto');
    expect(scroller).toHaveClass('snap-x');
    expect(scroller.className).not.toMatch(/overflow-x-hidden/);
    // Edge fades exist so a hidden scrollbar still reads as scrollable.
    expect(screen.getByTestId('scoreboard-fade-right')).toBeInTheDocument();
    expect(screen.getByTestId('scoreboard-fade-left')).toBeInTheDocument();
    // Chips keep a fixed ticker width in the strip.
    expect(chip('m1').className).toMatch(/w-\[150px\]/);
  });

  it('the rail stacks the same chips full-width for the desktop aside', () => {
    render(<ScoreboardStrip matchups={rows} layout="rail" onSelect={() => {}} today={TODAY} />);
    expect(screen.getByTestId('scoreboard-strip')).toHaveAttribute('data-layout', 'rail');
    expect(screen.queryByTestId('scoreboard-scroller')).toBeNull();
    expect(chips()).toHaveLength(3);
    expect(chip('m1').className).toMatch(/w-full/);
  });
});

// 2026-09-03: the league endpoint serves a projected final per side for the
// viewed week. What would be wrong: a projection printed for a row that has
// none (a 0 where the server said null), a projection on a FINAL chip or a
// bye, the projection stealing the headline (sage or orange), or the score
// losing its own colour to it.
describe('ScoreboardStrip: projected finals', () => {
  const projected: WeekMatchupRow[] = [
    { ...rows[0], team1_projected_total: 118.34, team2_projected_total: '104.2' },
    { ...rows[1], team1_projected_total: null, team2_projected_total: null },
    { ...rows[2] },
  ];

  it('prints "proj N" under each score that has one, one decimal, in the mono face', () => {
    render(<ScoreboardStrip matchups={projected} onSelect={() => {}} today={TODAY} />);
    const c = chip('m1');
    const projs = within(c).getAllByTestId('scoreboard-proj');
    expect(projs).toHaveLength(2);
    expect(projs[0]).toHaveTextContent(/^proj\s*118\.3$/);
    expect(projs[1]).toHaveTextContent(/^proj\s*104\.2$/);
    // Each sits inside its own team line, under that team's score.
    expect(within(within(c).getByTestId('scoreboard-team1')).getByTestId('scoreboard-proj')).toHaveTextContent('118.3');
    expect(within(within(c).getByTestId('scoreboard-team2')).getByTestId('scoreboard-proj')).toHaveTextContent('104.2');
    const number = projs[0].querySelector('.font-jbmono');
    expect(number).not.toBeNull();
    expect(number).toHaveClass('tabular-nums');
    // The live score is still there, still the headline.
    expect(within(c).getAllByTestId('scoreboard-score')[0]).toHaveTextContent('12.4');
  });

  it('a null projection renders nothing at all, never 0', () => {
    render(<ScoreboardStrip matchups={projected} onSelect={() => {}} today={TODAY} />);
    expect(within(chip('m2')).queryAllByTestId('scoreboard-proj')).toEqual([]);
    expect(within(chip('m3')).queryAllByTestId('scoreboard-proj')).toEqual([]);
    expect(chip('m2')).not.toHaveTextContent(/proj/);
    expect(chip('m2')).not.toHaveTextContent(/0\.0/);
  });

  it('is secondary: the muted ROW_META rung, never orange, never sage', () => {
    render(<ScoreboardStrip matchups={projected} ownMatchupId="m1" ownTeamId="t1" onSelect={() => {}} today={TODAY} />);
    for (const el of within(chip('m1')).getAllByTestId('scoreboard-proj')) {
      expect(el).toHaveClass('text-[12px]');
      expect(el).toHaveClass('leading-none');
      expect(el).toHaveClass('text-white/55');
      expect(el.className).not.toMatch(/orange/);
      expect(el.className).not.toMatch(/sage/);
      expect(el.className).not.toMatch(/font-bold/);
    }
    // ...and the score keeps its own colour: team1 (mine, 12.4) leads, so it is sage.
    const [s1, s2] = within(chip('m1')).getAllByTestId('scoreboard-score');
    expect(s1).toHaveClass('text-pastel-sage');
    expect(s2).toHaveClass('text-white/70');
  });

  it('a final chip shows no projection even if the row still carries one', () => {
    const done = projected.map((r) => ({ ...r, status: 'completed' }));
    render(<ScoreboardStrip matchups={done} onSelect={() => {}} today={TODAY} />);
    expect(screen.queryAllByTestId('scoreboard-proj')).toEqual([]);
    // Same for a week that ended on the calendar.
    render(<ScoreboardStrip matchups={projected} onSelect={() => {}} today="2026-10-20" />);
    expect(screen.queryAllByTestId('scoreboard-proj')).toEqual([]);
  });

  it('a bye projects the lone team only', () => {
    render(
      <ScoreboardStrip
        matchups={[{ ...projected[0], id: 'bye', team2_id: null, team2_name: undefined, team2_score: null, team2_projected_total: 50 }]}
        onSelect={() => {}}
        today={TODAY}
      />,
    );
    const c = chip('bye');
    expect(within(c).getAllByTestId('scoreboard-proj')).toHaveLength(1);
    expect(within(within(c).getByTestId('scoreboard-team1')).getByTestId('scoreboard-proj')).toHaveTextContent('118.3');
    expect(within(c).getByTestId('scoreboard-team2')).not.toHaveTextContent(/proj/);
  });

  it('the accessible name says the projection where there is one, and only there', () => {
    render(<ScoreboardStrip matchups={projected} onSelect={() => {}} today={TODAY} />);
    expect(chip('m1')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Citrus Crushers 12\.4 proj 118\.3, Thunder Titans 9\.8 proj 104\.2/),
    );
    expect(chip('m2')).toHaveAttribute('aria-label', expect.stringMatching(/^Puck Dynasty 31\.0, Ice Wolves 44\.5/));
    expect(chip('m2').getAttribute('aria-label')).not.toMatch(/proj/);
  });
});

describe('ScoreboardStrip — owner avatars on the discs (audit M8)', () => {
  it('draws the owner picture from the team-avatar map and the initial for everyone else', () => {
    const teamAvatars = new Map<string, string | null>([['t1', 'https://cdn/owner1.png'], ['t2', null]]);
    render(
      <ScoreboardStrip matchups={rows} ownTeamId="t1" ownMatchupId="m1" onSelect={() => {}} today={TODAY} teamAvatars={teamAvatars} />,
    );
    const discs = within(chip('m1')).getAllByTestId('team-disc');
    expect(discs).toHaveLength(2);
    expect(discs[0]).toHaveAttribute('data-disc-state', 'image');
    expect(discs[0].querySelector('img')).toHaveAttribute('src', 'https://cdn/owner1.png');
    // Identity ring stays on the picture: orange means you, with or without a face.
    expect(discs[0].className).toMatch(/ring-pastel-orange/);
    expect(discs[1]).toHaveAttribute('data-disc-state', 'initials');
    expect(discs[1]).toHaveTextContent('T');
    // Chips for teams the map does not know keep their initials.
    for (const d of within(chip('m2')).getAllByTestId('team-disc')) {
      expect(d).toHaveAttribute('data-disc-state', 'initials');
    }
  });

  it('without the map the strip is unchanged: every disc is an initial', () => {
    render(<ScoreboardStrip matchups={rows} onSelect={() => {}} today={TODAY} />);
    for (const d of screen.getAllByTestId('team-disc')) expect(d).toHaveAttribute('data-disc-state', 'initials');
  });
});
