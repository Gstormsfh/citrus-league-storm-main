// Position-accent map lock (2026-08-25) — companion to the Entry 40 A-lite
// status-badge lock in HockeyPlayerCard.status.test.tsx.
//
// POSITION_ACCENT is the fix for "you can't tell the difference between
// player slots" (roster overhaul, 2026-08-25): a colour accent that lives
// on the card itself instead of a wrapper div each grid had to remember to
// apply (StartersGrid forgot it for D/G rows; IRSlot never had one at all).
// If a future edit drops a position from this map, or two positions land
// on the same colour, the card silently stops being able to communicate
// "which slot is this" — exactly the bug this map exists to fix. Lock it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const COMPONENT_PATH = resolve(HERE, '..', 'HockeyPlayerCard.tsx');

const EXPECTED_POSITIONS = ['C', 'LW', 'RW', 'D', 'G', 'F', 'UTIL'];

describe('HockeyPlayerCard — position-accent map lock', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');
  const block = source.match(
    /const POSITION_ACCENT: Record<string, \{ spine: string; badge: string \}> = \{([\s\S]*?)\n\};/,
  );

  it('POSITION_ACCENT block exists', () => {
    expect(block, 'POSITION_ACCENT map not found in HockeyPlayerCard.tsx').toBeTruthy();
  });

  const body = block ? block[1] : '';

  it.each(EXPECTED_POSITIONS)('POSITION_ACCENT defines an entry for %s', (position) => {
    const rowRegex = new RegExp(`\\b${position}:\\s*\\{\\s*spine:\\s*'([^']+)',\\s*badge:\\s*'([^']+)'`);
    const match = body.match(rowRegex);
    expect(match, `POSITION_ACCENT[${position}] not found`).toBeTruthy();
  });

  it('every entry pairs a before:bg-* spine with a from-*/to-* badge gradient', () => {
    for (const position of EXPECTED_POSITIONS) {
      const rowRegex = new RegExp(`\\b${position}:\\s*\\{\\s*spine:\\s*'([^']+)',\\s*badge:\\s*'([^']+)'`);
      const match = body.match(rowRegex);
      expect(match, `POSITION_ACCENT[${position}] not found`).toBeTruthy();
      if (!match) continue;
      const [, spine, badge] = match;
      expect(spine, `${position} spine must set before:bg-*`).toMatch(/\bbefore:bg-/);
      expect(badge, `${position} badge must set a from-* gradient stop`).toMatch(/\bfrom-/);
      expect(badge, `${position} badge must set a to-* gradient stop`).toMatch(/\bto-/);
    }
  });

  it('no two positions share the same spine colour', () => {
    const seen = new Map<string, string>();
    for (const position of EXPECTED_POSITIONS) {
      const rowRegex = new RegExp(`\\b${position}:\\s*\\{\\s*spine:\\s*'([^']+)'`);
      const match = body.match(rowRegex);
      if (!match) continue;
      const spine = match[1];
      const priorOwner = seen.get(spine);
      expect(priorOwner, `${position} and ${priorOwner} both use spine "${spine}" — slots would be indistinguishable`).toBeUndefined();
      seen.set(spine, position);
    }
  });

  it('the card applies the spine as a left-edge pseudo-element on every render (position, not caller, decides the colour)', () => {
    expect(source).toMatch(/before:absolute before:left-0 before:top-0 before:bottom-0 before:w-\[3px\]/);
    expect(source).toMatch(/accent\.spine/);
    expect(source).toMatch(/accent\.badge/);
  });

  it('the accent key comes from the primary position, not the dual-eligible display string', () => {
    // Regression guard: keying off getPositionDisplay() (which can return
    // "C/LW") instead of getPositionAbbreviation() would make dual-eligible
    // players fall through to DEFAULT_ACCENT for no reason.
    expect(source).toMatch(/POSITION_ACCENT\[getPositionAbbreviation\(player\.position\)\]/);
  });
});
