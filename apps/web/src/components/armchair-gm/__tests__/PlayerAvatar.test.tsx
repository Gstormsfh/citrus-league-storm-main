// ARMCHAIR GM WEARS A FACE (2026-09-03 headshot audit).
//
// The founder's complaint months ago was "Can we ensure we're using
// headshots?? Not just little dots with initials". Most of the app was
// fixed; this component was the one that still shipped the literal thing he
// described. It drew a gradient disc with initials and a jersey number, and
// its props did not include an image at all, so there was NO code path in
// /armchair-gm where a face could render. The page is linked from the main
// nav, the mobile menu, the homepage hero CTA and the footer, which made it
// the most visible surviving instance in the product.
//
// What this file pins:
//   * a headshot renders when one is supplied, which is the capability that
//     did not exist before;
//   * the fallback is `roster/Mug`'s chain (headshot -> team crest ->
//     initials), not a private one, so a CDN failure still leaves a
//     designed face and never a broken-image glyph;
//   * the position colour survived the swap, as a ring from the SHARED
//     `posRingColor` map rather than this component's old private palette;
//   * every armchair-gm call site actually threads the image and the team.
//     A component that CAN show a face is worth nothing if the four places
//     that render it still pass only a name.
//
// The call-site assertions are a source contract, in the idiom
// `FreeAgents.mug.test.tsx` established: CapPlayerCard, TradeSimulator and
// BuyoutCalculator each pull a live cap query, a team selector and the
// tooltip/popover stack in behind them, which is a lot of scaffolding to
// prove a prop is spelled.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import PlayerAvatar from '../PlayerAvatar';
import { teamCrestUrl } from '@/components/roster/headshot';
import { posRingColor } from '@/components/roster/positionChip';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const strip = (name: string) =>
  readFileSync(resolve(HERE, '..', name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const AVATAR = strip('PlayerAvatar.tsx');
const CALL_SITES = {
  'CapPlayerCard.tsx': strip('CapPlayerCard.tsx'),
  'TradeSimulator.tsx': strip('TradeSimulator.tsx'),
  'BuyoutCalculator.tsx': strip('BuyoutCalculator.tsx'),
};

const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png';
const box = (c: HTMLElement) => c.querySelector('[data-mug-state]') as HTMLElement;

describe('PlayerAvatar draws a real headshot', () => {
  it('renders the supplied headshot, named for the player', () => {
    const { container } = render(
      <PlayerAvatar name="Connor McDavid" position="C" image={MUG} team="EDM" size="md" />,
    );
    const img = screen.getByAltText('Connor McDavid') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(MUG);
    expect(box(container).getAttribute('data-mug-state')).toBe('image');
    // The old disc: initials over a gradient. Not while a face is loading.
    expect(screen.queryByText('CM')).toBeNull();
  });

  it('falls back headshot to crest to initials, never to a hole', () => {
    const { container } = render(
      <PlayerAvatar name="Connor McDavid" position="C" image={MUG} team="EDM" size="md" />,
    );

    fireEvent.error(screen.getByAltText('Connor McDavid'));
    expect(screen.queryByAltText('Connor McDavid')).toBeNull();
    expect((screen.getByAltText('EDM') as HTMLImageElement).getAttribute('src')).toBe(
      teamCrestUrl('EDM'),
    );
    expect(box(container).getAttribute('data-mug-state')).toBe('crest');

    fireEvent.error(screen.getByAltText('EDM'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Connor McDavid' }).textContent).toBe('CM');
    expect(box(container).getAttribute('data-mug-state')).toBe('initials');
  });

  it('draws the team crest when no headshot is on file, which is the cap sheet today', () => {
    // `PlayerContract.headshot` is declared but never populated by the static
    // contract data, so this is the state /armchair-gm actually renders. A
    // crest is not a face, but it is a picture of the right team rather than
    // two letters on a coloured disc.
    const { container } = render(<PlayerAvatar name="Cale Makar" position="D" team="COL" />);
    expect(screen.getByAltText('COL')).toBeTruthy();
    expect(box(container).getAttribute('data-mug-state')).toBe('crest');
  });

  it('falls straight to initials when neither picture can be resolved', () => {
    const { container } = render(<PlayerAvatar name="Igor Shesterkin" position="G" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Igor Shesterkin' }).textContent).toBe('IS');
  });

  it('keeps the position colour, from the shared ring map', () => {
    const { container } = render(<PlayerAvatar name="Cale Makar" position="D" team="COL" />);
    expect(box(container).className).toContain(posRingColor.D);

    // Spelled-out positions resolve too: the cap data carries "Defence" and
    // "Goalie" as well as the codes.
    const goalie = render(<PlayerAvatar name="Igor Shesterkin" position="Goalie" />);
    expect(box(goalie.container).className).toContain(posRingColor.G);
  });
});

describe('PlayerAvatar owns no private headshot chain', () => {
  it('delegates to roster/Mug instead of drawing its own disc', () => {
    expect(AVATAR).toMatch(/from ['"]@\/components\/roster\/Mug['"]/);
    expect(AVATAR).toContain('<Mug');
    // The exact things the founder objected to.
    expect(AVATAR).not.toMatch(/getInitials/);
    expect(AVATAR).not.toMatch(/bg-gradient-to-br \$\{/);
    expect(AVATAR).not.toMatch(/jerseyNumber/);
    // And no fourth fallback chain hiding behind the delegation.
    expect(AVATAR).not.toMatch(/<img/);
    expect(AVATAR).not.toMatch(/onError/);
  });

  it('takes the position ring from positionChip rather than redefining one', () => {
    expect(AVATAR).toMatch(/from ['"]@\/components\/roster\/positionChip['"]/);
    expect(AVATAR).not.toMatch(/const positionColors/);
    expect(AVATAR).not.toMatch(/const posRingColor\s*[:=]/);
  });
});

describe('every armchair-gm call site threads the picture through', () => {
  it.each(Object.keys(CALL_SITES))('%s passes image and team to every avatar', (file) => {
    const tags = CALL_SITES[file as keyof typeof CALL_SITES].match(/<PlayerAvatar\b[\s\S]*?\/>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toMatch(/image=\{player\.headshot\}/);
      expect(tag).toMatch(/team=\{player\.team\}/);
    }
  });

  it('no call site still passes the jersey number the avatar cannot draw', () => {
    for (const src of Object.values(CALL_SITES)) {
      const tags = src.match(/<PlayerAvatar\b[\s\S]*?\/>/g) ?? [];
      for (const tag of tags) expect(tag).not.toMatch(/jerseyNumber/);
    }
  });
});
