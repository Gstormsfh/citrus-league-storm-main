/**
 * Stormy's phone sheet geometry (2026-09-11). See sheetGeometry.ts.
 */
import { describe, it, expect } from 'vitest';
import { stormySheetGeometry, STORMY_SHEET_MAX } from '../sheetGeometry';

describe('stormySheetGeometry', () => {
  it('keyboard down: a panel, not a takeover', () => {
    const g = stormySheetGeometry({
      layoutHeight: 844,
      visibleHeight: 844,
      offsetTop: 0,
      keyboardOpen: false,
    });
    expect(g.bottom).toBe(0);
    expect(g.height).toBe(`min(820px, ${STORMY_SHEET_MAX})`);
    expect(g.maxHeight).toBe('820px');
    expect(g.paddingBottom).toBe('var(--safe-area-inset-bottom,env(safe-area-inset-bottom))');
  });

  it('keyboard up: the sheet sits on top of the keyboard and shrinks to what is visible', () => {
    const g = stormySheetGeometry({
      layoutHeight: 844,
      visibleHeight: 420,
      offsetTop: 0,
      keyboardOpen: true,
    });
    expect(g.bottom).toBe(424);
    expect(g.maxHeight).toBe('396px');
    // 396px caps the 34rem stop, so the header cannot be pushed off the top.
    expect(g.height).toBe(`min(396px, ${STORMY_SHEET_MAX})`);
    expect(g.paddingBottom).toBe(0);
  });

  it('a scrolled visual viewport is not counted twice', () => {
    const g = stormySheetGeometry({
      layoutHeight: 844,
      visibleHeight: 420,
      offsetTop: 100,
      keyboardOpen: true,
    });
    expect(g.bottom).toBe(324);
  });

  it('no visualViewport API: fall back to the layout viewport, still bounded', () => {
    const g = stormySheetGeometry({
      layoutHeight: 667,
      visibleHeight: null,
      offsetTop: 0,
      keyboardOpen: false,
    });
    expect(g.bottom).toBe(0);
    expect(g.maxHeight).toBe('643px');
  });

  it('a tiny visible area never collapses the sheet below its short stop', () => {
    const g = stormySheetGeometry({
      layoutHeight: 844,
      visibleHeight: 180,
      offsetTop: 0,
      keyboardOpen: true,
    });
    expect(g.maxHeight).toBe('240px');
  });
});
