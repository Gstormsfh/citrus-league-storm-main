// Entry 40 A-lite lock (2026-08-10) — HockeyPlayerCard status-badge map.
//
// Locks the per-status color signal for player status badges. Statuses
// IR/SUSP/GTD/WVR each render a differentiated bg color; if drift ever
// collapses them onto a single color or reassigns a semantic (e.g. IR
// no longer red), correctness on the twelve/beta path is compromised.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const COMPONENT_PATH = resolve(HERE, '..', 'HockeyPlayerCard.tsx');

// Expected color contract for each status. These are correctness-
// critical: IR must scream "unavailable" (red), SUSP must scream
// "penalty" (orange), GTD must communicate "uncertain" (yellow), WVR
// must communicate "in-transit" (blue).
const EXPECTED_STATUS_COLOR: Record<string, string> = {
  IR: 'bg-red-500',
  SUSP: 'bg-orange-500',
  GTD: 'bg-yellow-500',
  WVR: 'bg-blue-500',
};

describe('HockeyPlayerCard — status-badge color map lock (Entry 40 A-lite)', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

  it.each(Object.entries(EXPECTED_STATUS_COLOR))(
    'statusConfig[%s].color === %s',
    (status, expectedClass) => {
      // Find the statusConfig block, extract this status's color field.
      // The pattern matches: 'IR': { label: 'IR', variant: '...', color: 'bg-red-500', icon: ... }
      const rowRegex = new RegExp(
        `['"]${status}['"]:\\s*\\{[^}]*color:\\s*['"]([^'"]+)['"]`,
        's',
      );
      const match = source.match(rowRegex);
      expect(match, `statusConfig[${status}] not found`).toBeTruthy();
      expect(match![1]).toBe(expectedClass);
    },
  );

  it('all four statuses (IR/SUSP/GTD/WVR) present in statusConfig', () => {
    expect(source).toMatch(/['"]IR['"]:\s*\{/);
    expect(source).toMatch(/['"]SUSP['"]:\s*\{/);
    expect(source).toMatch(/['"]GTD['"]:\s*\{/);
    expect(source).toMatch(/['"]WVR['"]:\s*\{/);
  });

  it('badge className adds text-white for contrast against bright status backgrounds', () => {
    // The badge className cn() must include "text-white" so the badge
    // text reads against red/orange/yellow/blue backgrounds. This is
    // correctness (readability), not palette drift.
    expect(source).toMatch(/config\.color,\s*['"]text-white['"]/);
  });
});
