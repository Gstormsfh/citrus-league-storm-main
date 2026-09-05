/**
 * PRESS BOX CHROME GEOMETRY (2026-09-04).
 *
 * The four pieces of chrome that wrap every league page have heights the
 * screens have to know about: a page that does not reserve them puts its last
 * row under the chat bar, which is the one bug you cannot see in a screenshot
 * of the top of the screen.
 *
 * A `.ts` and not constants inside the components, for the reason
 * `phoneRowScale.ts` gives: a module exporting both a component and plain
 * values breaks react-refresh. It also means `zLayerScaleGuard` can read the
 * rungs without importing JSX.
 *
 * The spec fixes these: chat bar 40px + nav 76px (+ safe area). The header is
 * 30px crest row + sub-tab strip; measured from the reference at 393px it is
 * 52 + 34.
 */

/** Row 1 of LeagueHeader: crest, league name, week label, settings. */
export const HEADER_ROW1_H = 52;
/** Row 2: the four-column sub-tab strip. */
export const HEADER_SUBTAB_H = 34;
/** Both header rows. Screens offset their sticky sub-headers by this. */
export const HEADER_H = HEADER_ROW1_H + HEADER_SUBTAB_H;

/** Persistent chat bar, directly above the nav. */
export const CHATBAR_H = 40;
/** Five-tab bottom nav, excluding the home-indicator safe area. */
export const BOTTOMNAV_H = 76;

/**
 * What a scrolling league page must leave at the bottom so its final row
 * clears both bars. Safe area is added in CSS (`env(safe-area-inset-bottom)`)
 * rather than here, because it is a runtime value and this file is static.
 */
export const BOTTOM_CHROME_H = CHATBAR_H + BOTTOMNAV_H;

/**
 * The only "retro" in the system, per the spec: a 1px scanline every 3px on
 * the header band. Inline because it is a computed gradient, which is the one
 * exception the styling rule allows.
 */
export const SCANLINE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(180deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px)',
};
