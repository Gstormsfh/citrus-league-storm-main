/**
 * Where Stormy's phone sheet sits, and how tall it is.
 *
 * Founder, 2026-09-11: "Stormy opens in a fucked up way on mobile, it should
 * just be a small window, it's massive and you can't even see the top of the
 * screen." Two defects in one CSS rule. The sheet was pinned
 * `top: 8vh; bottom: 0`, so it owned 92% of the screen for a conversation
 * that is usually three lines long. And both edges were measured against the
 * LAYOUT viewport: in a WKWebView that viewport does not shrink when the
 * keyboard opens — the web view scrolls the page instead — so the composer
 * ran under the keyboard and the header went off the top with it.
 *
 * Pure on purpose: the geometry is the part worth pinning in a test, and it
 * is the part that was wrong.
 */

export interface StormySheetViewport {
  /** Layout viewport height in CSS px — `window.innerHeight`. */
  layoutHeight: number;
  /** Visible height once the keyboard is up, or null where the API is absent. */
  visibleHeight: number | null;
  /** Top offset of the visible area relative to the layout viewport. */
  offsetTop: number;
  /** True when the visible height is well short of the layout height. */
  keyboardOpen: boolean;
}

export interface StormySheetGeometry {
  /** Distance from the layout viewport's bottom edge, i.e. the keyboard. */
  bottom: number;
  height: string;
  maxHeight: string;
  paddingBottom: string | number;
}

/** Visible area left uncovered above the sheet, so it reads as a sheet. */
export const STORMY_SHEET_GAP_PX = 24;
/** Short stop: a header, one exchange and the composer still fit. */
export const STORMY_SHEET_MIN_PX = 240;
/** Tall stop. Past this, a three-line chat is a takeover, not a panel. */
export const STORMY_SHEET_MAX = '34rem';

export function stormySheetGeometry(vp: StormySheetViewport): StormySheetGeometry {
  const visible = vp.visibleHeight ?? vp.layoutHeight;
  // With no visualViewport API there is no keyboard inset to be had: sit on
  // the bottom edge and let the short height keep the header on screen.
  const keyboardInset =
    vp.visibleHeight === null
      ? 0
      : Math.max(0, Math.round(vp.layoutHeight - vp.visibleHeight - vp.offsetTop));
  const cap = Math.max(STORMY_SHEET_MIN_PX, Math.round(visible - STORMY_SHEET_GAP_PX));

  return {
    bottom: keyboardInset,
    height: `min(${cap}px, ${STORMY_SHEET_MAX})`,
    maxHeight: `${cap}px`,
    // The home indicator only needs clearing when the keyboard is not there.
    paddingBottom: vp.keyboardOpen ? 0 : 'var(--safe-area-inset-bottom,env(safe-area-inset-bottom))',
  };
}
