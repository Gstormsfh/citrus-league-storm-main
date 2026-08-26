// ROSTER CARD NAME LAYOUT (2026-08-26) — reported as "roster card design".
//
// Measured in Chromium at 393x852 against the real component and real
// Tailwind, rendering the bench grid at its shipped card width. Two defects
// stacked on top of each other, and both destroyed the one piece of
// information a roster card exists to carry: who the player is.
//
// 1. THE STATUS BADGE STARVED THE NAME.
//    The name <h3> and the IR/GTD/SUSP/WVR badge shared one flex row. The
//    badge is flex-shrink-0. The name carries line-clamp-2, which implies
//    overflow:hidden, which gives a flex item an automatic minimum size of
//    zero — so in a width contest the name loses everything and the badge
//    loses nothing. Measured on a 140px bench card: the <h3> resolved to a
//    9px box holding 32px of text. "Cale Makar" rendered as "C" over "M".
//
// 2. THE POSITION PATCH OVERLAPPED THE NAME.
//    The patch is absolutely positioned at right-0.5 and is ~33px wide for a
//    two-letter position. The name column reserved pr-5 — 20px — for it, so
//    ~13px of every long name ran underneath the patch and was clipped with
//    text-overflow:clip, i.e. sliced mid-glyph with no ellipsis:
//    "Nathan MacKinnc", "Igor Shesterki".
//
// Underneath both: 140px could not hold the card's own furniture. 8px pad +
// 44px headshot + 8px gap + 36px patch clearance = 96px before a letter of
// the name is drawn, leaving 44px — narrower than "Shesterkin" at this
// weight. The width is now 168px and the arithmetic is asserted below.
//
// jsdom has no layout engine, so the pixel findings above cannot be
// re-measured here. What IS assertable, and is what actually broke, is the
// DOM structure: the name must not share a shrink contest with the badge.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import HockeyPlayerCard, { HockeyPlayer } from '../HockeyPlayerCard';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CARD_SRC = readFileSync(resolve(HERE, '..', 'HockeyPlayerCard.tsx'), 'utf8');
const BENCH_SRC = readFileSync(resolve(HERE, '..', 'BenchGrid.tsx'), 'utf8');

const player = (over: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({
    id: 1,
    name: 'Cale Makar',
    position: 'D',
    number: 8,
    starter: true,
    team: 'Colorado Avalanche',
    teamAbbreviation: 'COL',
    stats: { goals: 21, assists: 71, points: 92, gamesPlayed: 80, shots: 216 },
    ...over,
  }) as HockeyPlayer;

describe('HockeyPlayerCard — the name never loses a width contest', () => {
  it('renders the full name, not a truncated string, into the DOM', () => {
    render(<HockeyPlayerCard player={player({ name: 'Igor Shesterkin', position: 'G' })} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Igor Shesterkin');
  });

  it('the status badge is NOT a sibling of the name — that is the defect', () => {
    const { container } = render(<HockeyPlayerCard player={player({ status: 'GTD' })} />);
    const h3 = container.querySelector('h3')!;
    const badge = screen.getByText('GTD');
    expect(h3).toBeTruthy();
    // The badge must not share the name's flex row. If it is ever moved back
    // alongside the <h3>, the two become flex siblings again and the name —
    // shrinkable to zero because line-clamp implies overflow:hidden — loses
    // every pixel to a shrink-0 badge.
    expect(badge.parentElement!.contains(h3)).toBe(false);
    // And the name owns its row outright: no element siblings to contend with.
    expect(h3.parentElement!.querySelectorAll(':scope > *').length).toBeGreaterThan(0);
    expect(Array.from(h3.parentElement!.children).indexOf(h3)).toBe(0);
    expect(h3.nextElementSibling!.contains(badge)).toBe(true);
  });

  it.each(['IR', 'SUSP', 'GTD', 'WVR'] as const)(
    '%s badge sits on the meta row and drops the jersey number rather than truncating it',
    (status) => {
      const { container } = render(<HockeyPlayerCard player={player({ status })} />);
      const badge = screen.getByText(status);
      const metaRow = badge.parentElement!;
      expect(metaRow.textContent).toContain('COL');
      // No dangling "COL • " with the number guillotined off by a truncate.
      expect(metaRow.textContent).not.toContain('#');
      expect(container.querySelector('h3')!.textContent).toBe('Cale Makar');
    },
  );

  it('with no status badge the meta row keeps team and jersey number', () => {
    const { container } = render(<HockeyPlayerCard player={player()} />);
    expect(container.textContent).toContain('COL • #8');
  });
});

describe('HockeyPlayerCard — the card reserves real space for its furniture', () => {
  it('the header clears the absolutely-positioned position patch', () => {
    // The patch is right-0.5 and ~33px wide for a two-letter position.
    // pr-9 is 36px. pr-5 (20px) was not enough and let names run under it.
    const header = CARD_SRC.match(/className="relative p-2 (pr-\d+) bg-gradient-to-r from-pastel-sage\/25/);
    expect(header, 'card header padding class not found').toBeTruthy();
    const px = Number(header![1].replace('pr-', '')) * 4;
    expect(px).toBeGreaterThanOrEqual(34);
  });

  it('the name column no longer carries its own guessed patch clearance', () => {
    expect(CARD_SRC).not.toMatch(/flex-1 min-w-0 pr-5/);
  });

  it('the name wraps instead of being sliced mid-glyph', () => {
    expect(CARD_SRC).toMatch(/line-clamp-2 break-words/);
  });
});

describe('BenchGrid — the card is wide enough for a surname', () => {
  it('bench card width leaves at least 60px for the name', () => {
    const m = BENCH_SRC.match(/flex-shrink-0 w-\[(\d+)px\]/);
    expect(m, 'bench card width class not found').toBeTruthy();
    const width = Number(m![1]);
    // 8px left pad + 44px headshot + 8px gap + 36px patch clearance.
    const FURNITURE = 8 + 44 + 8 + 36;
    expect(width - FURNITURE).toBeGreaterThanOrEqual(60);
  });
});
