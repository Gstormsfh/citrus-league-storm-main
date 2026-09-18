/**
 * Desktop matchup, sticky team header (2026-09-18, QA).
 *
 * The lineup column on desktop is its own scroll container
 * (Matchup.tsx: lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto), and a
 * sticky offset is measured against the nearest scroll container, not the
 * viewport. `top: 6rem` in the >=1024px rule therefore parked the header
 * 96px down inside the column, floating over the first row of player
 * cards. It must be `top: 0` there, and the column must stay a scroll
 * container (otherwise the offset would be right again for the wrong
 * reason and the header would hide under the navbar).
 *
 * The "embroidered corner" dot on `.player-unique-stats-box::before` sat
 * on the F PTS value with 3-5px of padding and read as a broken badge on
 * every card. It must not come back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const CSS = readFileSync(resolve(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const MATCHUP = readFileSync(resolve(SRC, 'pages/Matchup.tsx'), 'utf8');
const COMPARISON = readFileSync(resolve(SRC, 'components/matchup/MatchupComparison.tsx'), 'utf8');

function desktopHeaderRule(): string {
  const re = /@media\s*\(min-width:\s*1024px\)\s*\{\s*\.matchup-team-header\s*\{([^}]*)\}/g;
  const bodies = [...CSS.matchAll(re)].map((m) => m[1]);
  expect(bodies.length, 'one >=1024px rule for .matchup-team-header').toBe(1);
  return bodies[0];
}

describe('index.css desktop matchup — sticky header offset', () => {
  it('sticks to the top of its own scroll column, not 6rem into it', () => {
    const body = desktopHeaderRule();
    expect(body).toMatch(/top\s*:\s*0\s*;/);
    expect(body).not.toMatch(/top\s*:\s*6rem/);
  });

  it('the lineup column is still the scroll container the offset is measured against', () => {
    expect(MATCHUP).toMatch(/lg:max-h-\[calc\(100vh-7rem\)\]\s+lg:overflow-y-auto/);
    // Rounded board chrome must not introduce a nearer non-scrolling ancestor
    // that captures sticky positioning away from the scrolling lineup column.
    expect(COMPARISON).not.toContain('lg:overflow-hidden');
  });

  it('the stats box has no corner dot over its values', () => {
    expect(CSS).not.toMatch(/\.player-unique-stats-box::before/);
  });
});
