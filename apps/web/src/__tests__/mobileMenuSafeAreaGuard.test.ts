/**
 * MOBILE MENU SAFE-AREA GUARD (2026-09-09).
 *
 * TestFlight 16 regression: the hamburger panel is portaled to <body> and
 * z-ordered above the header, so any fixed `top` that ignores
 * env(safe-area-inset-top) paints the panel over the header's X button on
 * notched iPhones and the menu cannot be closed. The web never shows it
 * (inset is 0 there), so a test is the only thing that catches it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const NAVBAR = readFileSync(join(__dirname, '..', 'components', 'Navbar.tsx'), 'utf8');

describe('mobile menu safe-area guard', () => {
  it('anchors the portaled menu panel below the safe-area-aware header', () => {
    const panelTop = NAVBAR.match(/fixed inset-0 (top-\[[^\]]+\]) z-nav-panel/);
    expect(panelTop, 'mobile menu panel top class not found').not.toBeNull();
    expect(panelTop![1]).toContain('env(safe-area-inset-top)');
  });

  it('subtracts the top inset from the panel height so the bottom row stays reachable', () => {
    expect(NAVBAR).toMatch(/h-\[calc\(100dvh-56px-var\(--safe-area-inset-top,env\(safe-area-inset-top\)\)-var\(--safe-area-inset-bottom,env\(safe-area-inset-bottom\)\)[^\]]*\]/);
  });
});
