// Entry 40 A-lite lock (2026-08-10) — MobileRosterList position-ring map.
//
// Locks the per-position color signal for roster slots. If a future
// palette drift silently flips e.g. LW→pastel-orange, this test
// catches it. Asserts BOTH the posColor and posRingColor maps' exact
// class values for every position (LW/C/RW/D/G/UTIL/F).

import { describe, it, expect } from 'vitest';

// Re-declaring the maps here mirrors the component internals — a
// deliberate duplicate to make drift IMPOSSIBLE without also updating
// this test. The component's imports/JSX aren't needed; we assert on
// the values that the component keys into.

// CONTRAST (2026-08-13) — every entry now carries its TEXT colour too.
//
// The badge base class used to hard-code `text-white`, which is only
// correct for the dark backgrounds. Measured on the live roster:
//
//   LW  #C8DCC4 + white ..... 1.11-1.45:1   invisible
//   C   #84A57D + white ..... 2.75:1        marginal
//   UTIL same as C .......... 2.75:1        marginal
//
// `G` already paired its own text colour, and that entry is the only
// one that kept passing when the others broke — the pattern was
// already here, it just wasn't applied consistently. Pairing them makes
// a background/foreground mismatch impossible to introduce by editing
// one map entry.
//
// RW stays white-on-orange (2.85:1): a brand accent, legible at this
// weight, and inverting it is a redesign rather than a legibility fix.
//
// SURFACE (2026-09-02) — D was `bg-[#1A2A20]`, the exact value of
// pastel-surface-tile, so the chip disappeared into any tile-coloured
// card (the new Free Agents row) and read as a bare outline on the
// roster. `bg-white/10` sits above both grounds and keeps D's "no
// colour" identity. This line is the regression test: the value is
// pinned here and in positionChip.ts, and drift in either fails.
const EXPECTED_POS_COLOR: Record<string, string> = {
  LW: 'bg-white/10 text-pressbox-text',
  C: 'bg-white/10 text-pressbox-text',
  RW: 'bg-white/10 text-pressbox-text',
  D: 'bg-white/10 text-pressbox-text',
  G: 'bg-white/10 text-pressbox-text',
  UTIL: 'bg-white/10 text-pressbox-text',
  F: 'bg-white/10 text-pressbox-text',
};

const EXPECTED_POS_RING_COLOR: Record<string, string> = {
  LW: 'ring-white/16',
  C: 'ring-white/16',
  RW: 'ring-white/16',
  D: 'ring-white/16',
  G: 'ring-white/16',
  UTIL: 'ring-white/16',
  F: 'ring-white/16',
};

// PRESS BOX (2026-09-04): every entry in both maps is now the SAME neutral
// pair, and that sameness is the invariant this lock now protects. Colour
// restraint in direction 1a says orange is the only saturated colour and
// means "you"; a coloured position chip spends the screen's one loud colour
// on something that carries no ownership. The letter carries the position.
//
// The maps were deliberately not collapsed into a single constant -- see the
// header of positionChip.ts. Seven identical lines are harder to quietly
// un-neutralise than one, and darkThemeContrastGuard fails anyone who tries.

// This test reads the shipped source to verify the maps match. If someone
// edits the maps but forgets to update this test, both the map assertion
// AND the source-read assertion catch it.
//
// 2026-09-01: the maps moved out of MobileRosterList.tsx into
// positionChip.ts so the mobile Matchup rows could wear the SAME chip
// (one palette, not two). The lock follows them; MobileRosterList is now
// checked for the opposite property — that it carries no local copy.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const COMPONENT_PATH = resolve(HERE, '..', 'positionChip.ts');
const LIST_PATH = resolve(HERE, '..', 'MobileRosterList.tsx');
const MATCHUP_CENTER_PATH = resolve(HERE, '..', '..', 'matchup', 'CenterColumn.tsx');

/**
 * Parse a `const <name>: Record<string, string> = { ... }` block out of
 * the component source into a real map, so invariants can be asserted
 * against what the component ACTUALLY ships rather than against this
 * file's own copy of it.
 */
function parseClassMap(source: string, name: string): Record<string, string> {
  const block = source.match(
    new RegExp(`const ${name}: Record<string, string> = \\{([^}]+)\\}`, 's'),
  );
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']*)'\s*,?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('MobileRosterList — position-ring map lock (Entry 40 A-lite)', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');
  const SOURCE_POS_COLOR = parseClassMap(source, 'posColor');

  it.each(Object.entries(EXPECTED_POS_COLOR))(
    'posColor[%s] === %s',
    (position, expectedClass) => {
      // Find the posColor block, extract this position's mapping.
      const posColorBlock = source.match(/const posColor: Record<string, string> = \{([^}]+)\}/s);
      expect(posColorBlock).toBeTruthy();
      const line = posColorBlock![1].split('\n').find((l) => l.trim().startsWith(`${position}:`));
      expect(line).toBeTruthy();
      expect(line).toContain(`'${expectedClass}'`);
    },
  );

  it.each(Object.entries(EXPECTED_POS_RING_COLOR))(
    'posRingColor[%s] === %s',
    (position, expectedClass) => {
      const posRingBlock = source.match(/const posRingColor: Record<string, string> = \{([^}]+)\}/s);
      expect(posRingBlock).toBeTruthy();
      const line = posRingBlock![1].split('\n').find((l) => l.trim().startsWith(`${position}:`));
      expect(line).toBeTruthy();
      expect(line).toContain(`'${expectedClass}'`);
    },
  );

  // CONTRAST (2026-08-13) — the invariant that actually prevents the bug.
  //
  // The original lock pinned each background but said nothing about the
  // text on it, so `text-white` could sit on a #C8DCC4 chip and every
  // assertion still passed. This one fails if ANY position ships a
  // background without deciding the foreground that survives on it.
  //
  // It reads the SOURCE map, not EXPECTED_POS_COLOR. Iterating the
  // expectation would be tautological: adding `P: 'bg-sky-200'` to the
  // component and nothing else left all 17 tests green when this was
  // written the easy way (measured, not assumed). Every other assertion
  // here is keyed BY position, so an unknown position is invisible to
  // all of them — this is the only test that can see one arrive.
  it('every position in the component pairs a background with a text colour', () => {
    expect(Object.keys(SOURCE_POS_COLOR).length).toBeGreaterThan(0);
    for (const [position, cls] of Object.entries(SOURCE_POS_COLOR)) {
      expect(cls, `${position} must set a bg-* class`).toMatch(/\bbg-/);
      expect(cls, `${position} must set its own text-* class`).toMatch(/\btext-/);
    }
  });

  // Guards the assumption the test above relies on: that the component's
  // key set is the one this file claims to cover. A position added to
  // the component without being added here would otherwise sail past
  // every `it.each` (they iterate the expectation, so they simply never
  // ask about it).
  it('the component ships exactly the positions this lock covers', () => {
    expect(Object.keys(SOURCE_POS_COLOR).sort()).toEqual(
      Object.keys(EXPECTED_POS_COLOR).sort(),
    );
  });

  // The base badge class must NOT reintroduce a blanket text colour —
  // that is exactly how the light chips ended up with white text.
  it('the badge base class does not hard-code a text colour', () => {
    const badgeBase = source.match(
      /'w-8 h-8 flex-shrink-0 rounded-md flex items-center justify-center[^']*'/,
    );
    expect(badgeBase).toBeTruthy();
    expect(badgeBase![0]).not.toMatch(/\btext-white\b/);
  });

  // ONE chip. The roster list and the matchup centre column both import the
  // maps from positionChip.ts; neither is allowed to grow a private copy,
  // because a private copy is exactly how the matchup page ended up with a
  // second position palette in the first place.
  it.each([
    ['MobileRosterList.tsx', LIST_PATH, /from ['"]\.\/positionChip['"]/],
    ['matchup/CenterColumn.tsx', MATCHUP_CENTER_PATH, /from ['"]@\/components\/roster\/positionChip['"]/],
  ])('%s imports the chip rather than redeclaring it', (_name, path, importRe) => {
    const consumer = readFileSync(path, 'utf8');
    expect(consumer).toMatch(importRe);
    expect(consumer).not.toMatch(/const posColor\s*[:=]/);
    expect(consumer).not.toMatch(/const posRingColor\s*[:=]/);
    expect(consumer).not.toMatch(/'w-\[30px\] h-\[30px\] flex-shrink-0 rounded-md/);
  });

  it('both maps cover the same position set (LW/C/RW/D/G/UTIL/F)', () => {
    const posColorKeys = Object.keys(EXPECTED_POS_COLOR).sort();
    const posRingKeys = Object.keys(EXPECTED_POS_RING_COLOR).sort();
    expect(posColorKeys).toEqual(posRingKeys);
    expect(posColorKeys).toEqual(['C', 'D', 'F', 'G', 'LW', 'RW', 'UTIL']);
  });
});
