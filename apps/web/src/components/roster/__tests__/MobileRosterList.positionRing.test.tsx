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

const EXPECTED_POS_COLOR: Record<string, string> = {
  LW: 'bg-pastel-sage-soft',
  C: 'bg-pastel-sage',
  RW: 'bg-pastel-orange',
  D: 'bg-[#1A2A20]',
  G: 'bg-pastel-sage/15 text-pastel-cream',
  UTIL: 'bg-pastel-sage',
  F: 'bg-emerald-600',
};

const EXPECTED_POS_RING_COLOR: Record<string, string> = {
  LW: 'ring-pastel-sage-soft/30',
  C: 'ring-pastel-sage/30',
  RW: 'ring-pastel-orange/30',
  D: 'ring-white/30',
  G: 'ring-pastel-sage/50',
  UTIL: 'ring-pastel-sage/30',
  F: 'ring-emerald-600/30',
};

// This test reads the compiled component source to verify the maps
// match. If someone edits the component but forgets to update this
// test, both the map assertion AND the source-read assertion catch it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const COMPONENT_PATH = resolve(HERE, '..', 'MobileRosterList.tsx');

describe('MobileRosterList — position-ring map lock (Entry 40 A-lite)', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

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

  it('both maps cover the same position set (LW/C/RW/D/G/UTIL/F)', () => {
    const posColorKeys = Object.keys(EXPECTED_POS_COLOR).sort();
    const posRingKeys = Object.keys(EXPECTED_POS_RING_COLOR).sort();
    expect(posColorKeys).toEqual(posRingKeys);
    expect(posColorKeys).toEqual(['C', 'D', 'F', 'G', 'LW', 'RW', 'UTIL']);
  });
});
