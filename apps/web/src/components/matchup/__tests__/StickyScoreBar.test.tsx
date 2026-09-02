// ONE-BAND MOBILE HEADER (2026-09-01, Sleeper parity audit M8).
//
// The phone's sticky bar used to carry two bare numbers and a "—" where a
// win chance should be, and everything else (avatars, names, projections,
// the chance) lived in chrome that scrolled away. This pins the compressed
// header: disc · name · win chance · score · proj on BOTH sides, mirrored,
// with the owner's avatar on the disc and the team initial when there is
// none; and the source contract that the page mounts it inside the sticky
// header with the menu button (mobileHeaderMenuGuard's intent, which the
// token-coloured Matchup bar is not covered by).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StickyScoreBar } from '../StickyScoreBar';

const baseProps = {
  week: 5,
  myTeamName: 'Citrus Crushers',
  myTeamPoints: '112.4',
  opponentTeamName: 'Thunder Titans',
  opponentTeamPoints: '96.1',
};

const left = () => screen.getByTestId('sticky-score-left');
const right = () => screen.getByTestId('sticky-score-right');

describe('StickyScoreBar — both sides carry disc · name · score · proj · win chance', () => {
  it('renders the name, score, projected final and win chance for each side', () => {
    render(
      <StickyScoreBar
        {...baseProps}
        myTeamExpectedFinal={118.26}
        opponentTeamExpectedFinal={104.04}
        winProbability={62.4}
        isOwnTeam
      />,
    );
    const l = left();
    const r = right();
    expect(l).toHaveTextContent('Citrus Crushers');
    expect(within(l).getByTestId('sticky-score-points')).toHaveTextContent('112.4');
    expect(within(l).getByTestId('sticky-score-proj')).toHaveTextContent('proj 118.3');
    expect(within(l).getByTestId('sticky-score-chance')).toHaveTextContent('62% win');

    expect(r).toHaveTextContent('Thunder Titans');
    expect(within(r).getByTestId('sticky-score-points')).toHaveTextContent('96.1');
    expect(within(r).getByTestId('sticky-score-proj')).toHaveTextContent('proj 104.0');
    // The right side shows the complement — both sides read their own chance.
    expect(within(r).getByTestId('sticky-score-chance')).toHaveTextContent('38% win');

    expect(screen.getByText('Wk 5')).toBeInTheDocument();
  });

  it('is mirrored: the opponent side runs score-first toward the centre', () => {
    render(<StickyScoreBar {...baseProps} />);
    expect(left().className).not.toContain('flex-row-reverse');
    expect(right().className).toContain('flex-row-reverse');
  });

  it('numbers are mono with tabular figures; the leader wears sage, never the identity orange', () => {
    render(<StickyScoreBar {...baseProps} isOwnTeam winProbability={70} />);
    const mine = within(left()).getByTestId('sticky-score-points');
    const theirs = within(right()).getByTestId('sticky-score-points');
    for (const n of [mine, theirs]) {
      expect(n).toHaveClass('font-jbmono');
      expect(n).toHaveClass('tabular-nums');
      expect(n.className).not.toMatch(/text-pastel-orange/);
    }
    expect(mine).toHaveClass('text-pastel-sage');
    expect(mine).toHaveAttribute('data-leading', 'true');
    expect(theirs).toHaveClass('text-white/70');
    expect(theirs).not.toHaveAttribute('data-leading');
  });

  it('a trailing viewer sees the opponent score in sage — standing, not identity', () => {
    render(<StickyScoreBar {...baseProps} myTeamPoints="60.0" opponentTeamPoints="90.0" isOwnTeam />);
    expect(within(left()).getByTestId('sticky-score-points')).toHaveClass('text-white/70');
    expect(within(right()).getByTestId('sticky-score-points')).toHaveClass('text-pastel-sage');
  });

  it('a tie lights neither score', () => {
    render(<StickyScoreBar {...baseProps} myTeamPoints="75.0" opponentTeamPoints="75.0" />);
    for (const id of ['sticky-score-left', 'sticky-score-right']) {
      expect(within(screen.getByTestId(id)).getByTestId('sticky-score-points')).toHaveClass('text-white/70');
    }
  });

  it('identity: the own side gets the orange name and disc; the opponent never does', () => {
    render(<StickyScoreBar {...baseProps} isOwnTeam />);
    expect(left()).toHaveAttribute('data-own', 'true');
    expect(within(left()).getByText('Citrus Crushers').className).toMatch(/text-pastel-orange-soft/);
    expect(within(left()).getByTestId('team-disc').className).toMatch(/ring-pastel-orange/);
    expect(right()).not.toHaveAttribute('data-own');
    expect(within(right()).getByText('Thunder Titans').className).toMatch(/text-pastel-cream/);
    expect(within(right()).getByTestId('team-disc').className).not.toMatch(/orange/);
  });

  it("a stranger's matchup claims nobody: no orange on either side", () => {
    render(<StickyScoreBar {...baseProps} />);
    expect(within(left()).getByText('Citrus Crushers').className).not.toMatch(/orange/);
    expect(within(left()).getByTestId('team-disc').className).not.toMatch(/orange/);
  });
});

describe('StickyScoreBar — discs: owner avatar → team initial', () => {
  it('shows the initial when no avatar is supplied', () => {
    render(<StickyScoreBar {...baseProps} />);
    expect(within(left()).getByTestId('team-disc')).toHaveAttribute('data-disc-state', 'initials');
    expect(within(left()).getByTestId('team-disc')).toHaveTextContent('C');
    expect(within(right()).getByTestId('team-disc')).toHaveTextContent('T');
  });

  it('shows the owner avatar when supplied, as a decorative image', () => {
    render(<StickyScoreBar {...baseProps} myTeamAvatarUrl="https://cdn/me.png" opponentTeamAvatarUrl="https://cdn/them.png" />);
    const l = within(left()).getByTestId('team-disc');
    expect(l).toHaveAttribute('data-disc-state', 'image');
    const img = l.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://cdn/me.png');
    expect(img).toHaveAttribute('alt', '');
    expect(l).not.toHaveTextContent('C');
    expect(within(right()).getByTestId('team-disc').querySelector('img')).toHaveAttribute('src', 'https://cdn/them.png');
  });

  it('falls back to the initial when the avatar fails to load — never a broken image', () => {
    render(<StickyScoreBar {...baseProps} myTeamAvatarUrl="https://cdn/gone.png" />);
    const disc = within(left()).getByTestId('team-disc');
    fireEvent.error(disc.querySelector('img')!);
    expect(disc).toHaveAttribute('data-disc-state', 'initials');
    expect(disc.querySelector('img')).toBeNull();
    expect(disc).toHaveTextContent('C');
  });

  it('a blank avatar url is no avatar', () => {
    render(<StickyScoreBar {...baseProps} myTeamAvatarUrl="   " />);
    expect(within(left()).getByTestId('team-disc')).toHaveAttribute('data-disc-state', 'initials');
  });
});

describe('StickyScoreBar — what it does not claim', () => {
  it('hides the chance line and the hairline bar while the page cannot say', () => {
    render(<StickyScoreBar {...baseProps} />);
    expect(screen.queryAllByTestId('sticky-score-chance')).toHaveLength(0);
    expect(screen.queryByTestId('sticky-score-chance-bar')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('hides proj when no final is supplied', () => {
    render(<StickyScoreBar {...baseProps} winProbability={50} />);
    expect(screen.queryAllByTestId('sticky-score-proj')).toHaveLength(0);
  });

  it('settled: says Final, drops the chances and the projections', () => {
    render(
      <StickyScoreBar
        {...baseProps}
        settled
        winProbability={100}
        myTeamExpectedFinal={112.4}
        opponentTeamExpectedFinal={96.1}
      />,
    );
    expect(screen.getByTestId('sticky-score-final')).toHaveTextContent('Final');
    expect(screen.queryAllByTestId('sticky-score-chance')).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-score-proj')).toHaveLength(0);
    expect(screen.queryByTestId('sticky-score-chance-bar')).toBeNull();
  });

  it('the hairline bar is the left team share, clamped and rounded', () => {
    render(<StickyScoreBar {...baseProps} winProbability={62.4} />);
    const fill = screen.getByTestId('sticky-score-chance-bar').firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('62%');
    expect(fill.className).toContain('bg-pastel-sage');
  });

  it('shows VS instead of a week when none is known', () => {
    render(<StickyScoreBar {...baseProps} week={undefined} />);
    expect(screen.getByText('VS')).toBeInTheDocument();
  });

  it('renders the menu slot at the trailing edge', () => {
    render(<StickyScoreBar {...baseProps} menu={<button type="button">menu</button>} />);
    const bar = screen.getByTestId('sticky-score-bar');
    const menu = screen.getByRole('button', { name: 'menu' });
    expect(bar.lastElementChild).toBe(menu.parentElement);
  });

  it('every label is at least 10px and muted text sits on the readable floor', () => {
    const { container } = render(
      <StickyScoreBar {...baseProps} winProbability={55} myTeamExpectedFinal={100} opponentTeamExpectedFinal={90} isOwnTeam />,
    );
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const m of el.className.toString().matchAll(/text-\[(\d+)px\]/g)) {
        expect(Number(m[1]), el.className.toString()).toBeGreaterThanOrEqual(10);
      }
      for (const m of el.className.toString().matchAll(/text-white\/(\d+)/g)) {
        expect(Number(m[1]), el.className.toString()).toBeGreaterThanOrEqual(50);
      }
    }
  });
});

describe('Matchup.tsx mounts the bar inside the sticky header (source contract)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(resolve(here, '../../../pages/Matchup.tsx'), 'utf-8');

  it('the sticky header renders StickyScoreBar with the menu button as its menu slot', () => {
    const header = page.indexOf('lg:hidden sticky top-0 z-40');
    expect(header).toBeGreaterThan(-1);
    const slice = page.slice(header, header + 1200);
    expect(slice).toContain('<StickyScoreBar');
    expect(slice).toContain('menu={<MobileMenuButton />}');
  });

  it('the bar names the VIEWED teams and feeds the same finals and win chance as the ScoreCard', () => {
    const start = page.indexOf('<StickyScoreBar');
    // The element's own props end at isOwnTeam; the menu slot's `/>` comes first.
    const end = page.indexOf('isOwnTeam={isOwnTeamOnLeft}', start);
    expect(end).toBeGreaterThan(start);
    const block = page.slice(start, end + 'isOwnTeam={isOwnTeamOnLeft}'.length);
    expect(block).toMatch(/myTeamName=\{[^}]*viewingTeamName/);
    expect(block).toMatch(/opponentTeamName=\{[^}]*viewingOpponentTeamName/);
    expect(block).toContain('myTeamExpectedFinal={projectedFinals?.my}');
    expect(block).toContain('opponentTeamExpectedFinal={projectedFinals?.opp}');
    expect(block).toContain('winProbability={matchupOutlook ? matchupOutlook.probability * 100 : undefined}');
    expect(block).toContain('myTeamAvatarUrl={myTeamAvatarUrl}');
    expect(block).toContain('opponentTeamAvatarUrl={opponentTeamAvatarUrl}');
    expect(block).toContain('isOwnTeam={isOwnTeamOnLeft}');
  });

  it('the page no longer hand-rolls a "—" placeholder or an orange score in the bar', () => {
    expect(page).not.toContain("winChanceLabel");
    expect(page).not.toMatch(/font-calistoga font-black text-pastel-orange tabular-nums/);
  });

  it('the day strip runs compact on the page and the ScoreCard receives the avatars', () => {
    const ws = page.indexOf('<WeeklySchedule');
    const wsBlock = page.slice(ws, page.indexOf('/>', ws));
    expect(wsBlock).toMatch(/\bcompact\b/);
    const sc = page.indexOf('<ScoreCard');
    const scBlock = page.slice(sc, page.indexOf('/>', sc));
    expect(scBlock).toContain('myTeamAvatarUrl={myTeamAvatarUrl}');
    expect(scBlock).toContain('opponentTeamAvatarUrl={opponentTeamAvatarUrl}');
    // Both scoreboard renders (phone strip + desktop rail) get the avatar map.
    expect((page.match(/teamAvatars=\{teamAvatars\}/g) ?? []).length).toBe(2);
  });
});
