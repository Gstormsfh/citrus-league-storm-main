// Mug (2026-09-01, audit M4 + R3) — the one headshot every mobile row wears.
//
// What this pins:
//   * headshot → team crest → initials, in that order, and a failed <img>
//     is REPLACED rather than left to paint a broken-image glyph;
//   * alt text is the player's name; the initials fallback is a labelled
//     role="img"; the crest badge is decorative and hidden from AT;
//   * lazy + async on every <img>, and a fixed box per size so a row never
//     reflows around the picture;
//   * a failed URL is remembered per URL — a new `image` gets its own try;
//   * the crest badge appears only over a real headshot, never over the
//     crest fallback (which would show the same crest twice).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { Mug } from '../Mug';
import { mugInitials, mugTeamAbbrev, teamCrestUrl } from '../headshot';

const MCDAVID = {
  name: 'Connor McDavid',
  image: 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png',
  team: 'EDM',
  teamAbbreviation: 'EDM',
};

const box = (container: HTMLElement) => container.querySelector('[data-mug-state]') as HTMLElement;

describe('Mug — fallback chain', () => {
  it('renders the headshot with the player name as alt text, lazily and async', () => {
    const { container } = render(<Mug p={MCDAVID} size="xs" />);
    const img = screen.getByAltText('Connor McDavid') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe(MCDAVID.image);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(box(container).getAttribute('data-mug-state')).toBe('image');
    expect(screen.queryByText('CM')).toBeNull();
  });

  it('a headshot that fails is replaced by the team crest', () => {
    const { container } = render(<Mug p={MCDAVID} size="xs" />);
    fireEvent.error(screen.getByAltText('Connor McDavid'));
    // The failed <img> is gone — no broken-image glyph.
    expect(screen.queryByAltText('Connor McDavid')).toBeNull();
    const crest = screen.getByAltText('EDM') as HTMLImageElement;
    expect(crest.getAttribute('src')).toBe(teamCrestUrl('EDM'));
    expect(crest.getAttribute('loading')).toBe('lazy');
    expect(box(container).getAttribute('data-mug-state')).toBe('crest');
  });

  it('a crest that fails too is replaced by the initials', () => {
    const { container } = render(<Mug p={MCDAVID} size="xs" />);
    fireEvent.error(screen.getByAltText('Connor McDavid'));
    fireEvent.error(screen.getByAltText('EDM'));
    expect(container.querySelector('img')).toBeNull();
    const initials = screen.getByRole('img', { name: 'Connor McDavid' });
    expect(initials.tagName).toBe('SPAN');
    expect(initials.textContent).toBe('CM');
    expect(box(container).getAttribute('data-mug-state')).toBe('initials');
  });

  it('no headshot on file: the crest, without a badge', () => {
    render(<Mug p={{ ...MCDAVID, image: undefined }} size="xs" crest />);
    expect(screen.getByAltText('EDM')).toBeTruthy();
    expect(screen.queryByTestId('mug-crest-badge')).toBeNull();
  });

  it('neither a headshot nor a team abbreviation: the initials, straight away', () => {
    const { container } = render(
      <Mug p={{ name: 'Leon Draisaitl', team: 'Edmonton Oilers' }} size="sm" crest />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Leon Draisaitl' }).textContent).toBe('LD');
    expect(box(container).getAttribute('data-mug-state')).toBe('initials');
  });

  it('an empty image string counts as no image', () => {
    render(<Mug p={{ ...MCDAVID, image: '' }} size="xs" />);
    expect(screen.queryByAltText('Connor McDavid')).toBeNull();
    expect(screen.getByAltText('EDM')).toBeTruthy();
  });

  it('remembers the failure per URL, so a fresh image gets its own try', () => {
    const { rerender } = render(<Mug p={MCDAVID} size="xs" />);
    fireEvent.error(screen.getByAltText('Connor McDavid'));
    expect(screen.queryByAltText('Connor McDavid')).toBeNull();
    // Enrichment arrives with a different URL — it is tried.
    rerender(<Mug p={{ ...MCDAVID, image: 'https://assets.nhle.com/mugs/nhl/latest/8478402.png' }} size="xs" />);
    expect((screen.getByAltText('Connor McDavid') as HTMLImageElement).getAttribute('src')).toBe(
      'https://assets.nhle.com/mugs/nhl/latest/8478402.png',
    );
    // The same failed URL again is not.
    rerender(<Mug p={MCDAVID} size="xs" />);
    expect(screen.queryByAltText('Connor McDavid')).toBeNull();
  });
});

describe('Mug — crest badge', () => {
  it('sits on a real headshot as a 14px decorative crest', () => {
    render(<Mug p={MCDAVID} size="xs" crest />);
    const badge = screen.getByTestId('mug-crest-badge') as HTMLImageElement;
    expect(badge.getAttribute('src')).toBe(teamCrestUrl('EDM'));
    expect(badge.getAttribute('alt')).toBe('');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.getAttribute('loading')).toBe('lazy');
    expect(badge.className).toMatch(/w-3\.5 h-3\.5/);
    expect(badge.className).toMatch(/absolute/);
  });

  it('is off by default (the sheets print the team beside the name)', () => {
    render(<Mug p={MCDAVID} size="sm" />);
    expect(screen.queryByTestId('mug-crest-badge')).toBeNull();
  });

  it('sits bottom-right by default and bottom-left when asked (the mirrored matchup card)', () => {
    const right = render(<Mug p={MCDAVID} size="xs" crest />);
    const rb = right.getByTestId('mug-crest-badge');
    expect(rb.getAttribute('data-side')).toBe('right');
    expect(rb.className).toContain('-right-0.5');
    expect(rb.className).toContain('-bottom-0.5');
    right.unmount();

    const left = render(<Mug p={MCDAVID} size="xs" crest crestSide="left" />);
    const lb = left.getByTestId('mug-crest-badge');
    expect(lb.getAttribute('data-side')).toBe('left');
    expect(lb.className).toContain('-left-0.5');
    expect(lb.className).not.toContain('-right-0.5');
  });

  it('disappears if its SVG fails, and the crest fallback is then skipped too', () => {
    render(<Mug p={MCDAVID} size="xs" crest />);
    fireEvent.error(screen.getByTestId('mug-crest-badge'));
    expect(screen.queryByTestId('mug-crest-badge')).toBeNull();
    // The headshot is untouched by the badge's failure.
    expect(screen.getByAltText('Connor McDavid')).toBeTruthy();
    // ...and if the headshot now fails, the known-bad crest is not retried.
    fireEvent.error(screen.getByAltText('Connor McDavid'));
    expect(screen.queryByAltText('EDM')).toBeNull();
    expect(screen.getByRole('img', { name: 'Connor McDavid' }).textContent).toBe('CM');
  });
});

describe('Mug — geometry', () => {
  it.each([
    ['xs', 'w-7 h-7'],
    ['sm', 'w-9 h-9'],
    ['lg', 'w-14 h-14'],
  ] as const)('%s is a fixed %s box that cannot shrink', (size, cls) => {
    const { container } = render(<Mug p={MCDAVID} size={size} />);
    const el = box(container);
    expect(el.className).toContain(cls);
    expect(el.className).toContain('shrink-0');
    // The picture fills the box; the box, not the picture, sets the size.
    expect(screen.getByAltText('Connor McDavid').className).toMatch(/w-full h-full object-cover/);
  });

  it('merges a caller className onto the box', () => {
    const { container } = render(<Mug p={MCDAVID} size="xs" className="player-mug lg:hidden" />);
    expect(box(container).className).toContain('player-mug');
    expect(box(container).className).toContain('lg:hidden');
  });
});

describe('headshot helpers', () => {
  it('mugInitials: two words → two letters; one word → one; empty → empty', () => {
    expect(mugInitials('Connor McDavid')).toBe('CM');
    expect(mugInitials('  Auston   Matthews  ')).toBe('AM');
    expect(mugInitials('Pelé')).toBe('P');
    expect(mugInitials('Jean-Gabriel Pageau')).toBe('JP');
    expect(mugInitials('')).toBe('');
  });

  it('mugTeamAbbrev: only a 2–4 letter code becomes a crest', () => {
    expect(mugTeamAbbrev({ name: 'x', teamAbbreviation: 'edm' })).toBe('EDM');
    expect(mugTeamAbbrev({ name: 'x', team: 'TOR' })).toBe('TOR');
    expect(mugTeamAbbrev({ name: 'x', team: 'Toronto Maple Leafs' })).toBeNull();
    expect(mugTeamAbbrev({ name: 'x', teamAbbreviation: '', team: 'NYR' })).toBe('NYR');
    expect(mugTeamAbbrev({ name: 'x' })).toBeNull();
  });
});
