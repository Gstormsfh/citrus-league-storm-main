// ONE FACE (2026-09-01, headshot slice follow-up).
//
// Free Agents had its own 28px `MugShot`: a bare <img> that set
// `display: none` on itself when the CDN failed — the row reflowed, the
// player lost his face, and there was no crest or initials behind it. Every
// other face in the app is the roster's `Mug` (headshot → crest → initials,
// fixed box, lazy). Free Agents now draws the same one, through the
// `Player`-shape adapter `mugFromDirectory`.
//
// FreeAgents.tsx itself cannot be mounted cheaply in jsdom (auth, league
// context, six services), so the page is held to a source contract and the
// fallback chain is exercised on exactly the element the page renders.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory, teamCrestUrl } from '@/components/roster/headshot';
import type { Player } from '@/services/PlayerService';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const strip = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const PAGE = strip(resolve(HERE, '..', 'FreeAgents.tsx'));
// 2026-09-02: the phone lists moved out of the page into the shared
// FreeAgentRow, so the "one face" contract follows them. Both files are held
// to it — the page for its desktop tables, the row for every phone list.
const ROW = strip(resolve(HERE, '..', '..', 'components', 'freeagents', 'FreeAgentRow.tsx'));

const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/TOR/8479318.png';

/** The directory shape the Free Agents lists carry — only the fields the face reads matter. */
const directoryPlayer = (over: Partial<Player> = {}): Pick<Player, 'full_name' | 'headshot_url' | 'team'> => ({
  full_name: 'Auston Matthews',
  headshot_url: MUG,
  team: 'TOR',
  ...over,
});

const box = (c: HTMLElement) => c.querySelector('[data-mug-state]') as HTMLElement;

describe('FreeAgents.tsx — the face is the shared Mug', () => {
  it('imports Mug and the directory adapter, and owns no private mugshot', () => {
    expect(PAGE).toMatch(/from ['"]@\/components\/roster\/Mug['"]/);
    expect(PAGE).toMatch(/import \{ mugFromDirectory \} from ['"]@\/components\/roster\/headshot['"]/);
    for (const src of [PAGE, ROW]) {
      expect(src).not.toMatch(/MugShot/);
      // No hand-rolled headshot <img>: nothing reads headshot_url into a src.
      // (The opponent crests in the schedule column are a different element
      // and keep their own onError; only the FACE is held to the Mug.)
      expect(src).not.toMatch(/src=\{[^}]*headshot_url/);
      expect(src).not.toMatch(/headshot_url[^\n]*onError/);
    }
  });

  it('every desktop table row draws the 28px face through the adapter', () => {
    const faces = PAGE.match(/<Mug\b[^>]*\/>/g) ?? [];
    // Trending table, Projected table, the main Available table. The phone
    // lists that used to sit beside them are FreeAgentRows now.
    expect(faces.length).toBeGreaterThanOrEqual(3);
    for (const tag of faces) {
      expect(tag).toMatch(/p=\{mugFromDirectory\(player\)\}/);
      expect(tag).toMatch(/size="xs"/);
    }
  });

  it('the phone row draws the 44px face through the same adapter', () => {
    expect(ROW).toMatch(/from ['"]@\/components\/roster\/Mug['"]/);
    expect(ROW).toMatch(/mugFromDirectory/);
    const faces = ROW.match(/<Mug\b[^>]*\/>/g) ?? [];
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatch(/p=\{mugFromDirectory\(player\)\}/);
    // 44px, as a NAMED size — not a className override, which would leave the
    // crest and initials fallbacks sized for a 28px box.
    expect(faces[0]).toMatch(/size="md"/);
    expect(faces[0]).not.toMatch(/className=/);
  });
});

describe('mugFromDirectory — Player → the face', () => {
  it('maps full_name / headshot_url / team onto name / image / team', () => {
    expect(mugFromDirectory(directoryPlayer())).toEqual({ name: 'Auston Matthews', image: MUG, team: 'TOR' });
  });

  it('normalises a missing headshot and team to null (never undefined, never "")', () => {
    expect(mugFromDirectory({ full_name: 'X', headshot_url: undefined })).toEqual({ name: 'X', image: null, team: null });
    expect(mugFromDirectory({ full_name: 'X', headshot_url: null, team: null })).toEqual({ name: 'X', image: null, team: null });
  });
});

describe('the Free Agents face — headshot → crest → initials, no reflow', () => {
  it('renders the headshot lazily in a fixed 28px box, crest ready behind it', () => {
    const { container } = render(<Mug p={mugFromDirectory(directoryPlayer())} size="xs" />);
    expect(box(container).getAttribute('data-mug-state')).toBe('image');
    expect(box(container).className).toContain('w-7 h-7');
    const img = screen.getByAltText('Auston Matthews') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(MUG);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('a CDN failure swaps in the crest, then the initials — the box never shrinks or hides', () => {
    const { container } = render(<Mug p={mugFromDirectory(directoryPlayer())} size="xs" />);

    fireEvent.error(screen.getByAltText('Auston Matthews'));
    expect(box(container).getAttribute('data-mug-state')).toBe('crest');
    expect(box(container).className).toContain('w-7 h-7');
    expect(screen.getByAltText('TOR').getAttribute('src')).toBe(teamCrestUrl('TOR'));
    expect(screen.queryByAltText('Auston Matthews')).toBeNull();

    fireEvent.error(screen.getByAltText('TOR'));
    expect(box(container).getAttribute('data-mug-state')).toBe('initials');
    expect(box(container).className).toContain('w-7 h-7');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Auston Matthews' }).textContent).toBe('AM');
    // Nothing in the tree is display:none — the old MugShot's failure mode.
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      expect(el.style.display).not.toBe('none');
    }
  });

  it('no headshot on the directory row: the crest carries it from the first paint', () => {
    const { container } = render(<Mug p={mugFromDirectory(directoryPlayer({ headshot_url: null }))} size="xs" />);
    expect(box(container).getAttribute('data-mug-state')).toBe('crest');
    expect(screen.getByAltText('TOR')).toBeTruthy();
  });

  it('no headshot and a team the crest CDN cannot name: initials, not a 404', () => {
    const { container } = render(
      <Mug p={mugFromDirectory(directoryPlayer({ headshot_url: null, team: 'Toronto Maple Leafs' }))} size="xs" />,
    );
    expect(box(container).getAttribute('data-mug-state')).toBe('initials');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Auston Matthews' }).textContent).toBe('AM');
  });
});
