/**
 * THE Z-INDEX SCALE (2026-09-02).
 *
 * One ordered list of layers, named for what they ARE, and the only place a
 * stacking number is written down. `tailwind.config.ts` reads this module
 * and turns each entry into a utility (`z-page-header`, `z-sheet`,
 * `z-toast`), so a component never types a number and no two components can
 * disagree about what "on top" means.
 *
 * WHY, in the exact words the codebase left behind. `CitrusToaster` carried
 * this comment above a hand-picked `z-[10000]`:
 *
 *     "the roster sheets that FIRE the `move` toasts are z-[9999], and page
 *      chrome sits at z-40 through z-[80]. A notification hidden behind the
 *      sheet that produced it is not a notification."
 *
 * That is a correct fix and an unmaintainable one: it works because someone
 * read the whole codebase once and picked a bigger number. The next sheet
 * to want the top of the screen types 10001 and the toast is back
 * underneath it, with nothing to catch it.
 *
 * WHAT WAS ACTUALLY MEASURED (Chromium, the real app CSS, 2026-09-02):
 *
 *   * Seventy-five `fixed` / `sticky` layers across `src/`, carrying eleven
 *     distinct z values between 0 and 999999 and no ordering anyone had
 *     written down.
 *   * THREE DEAD RULES in `index.css` that looked like the ordering policy
 *     and matched nothing. `[data-radix-portal]`, `[data-radix-tooltip-
 *     content]` and `[data-radix-popover-content]` are attributes the
 *     installed Radix (`@radix-ui/react-portal` 1.x and friends) does not
 *     emit: its Portal renders a bare `<div>`, and floating content is
 *     wrapped in `[data-radix-popper-content-wrapper]`. So the
 *     `z-index: 9999 !important` that was supposed to hold tooltips and
 *     popovers at 9999 had never applied to anything.
 *   * Because of that, `ui/tooltip.tsx`'s `z-[999999]` is live, and Radix's
 *     popper COPIES the content's computed z-index onto its positioned
 *     wrapper — so a hover tooltip really does render above the toast
 *     layer. That is the one inversion the hand-picked 10000 could not fix,
 *     and the rule that was meant to fix it was inert.
 *   * The toast viewport itself is clean: `#root`, and every element between
 *     it and `<body>`, is `position: static; z-index: auto` with no
 *     transform, filter, opacity or containment, so nothing traps it in a
 *     local stacking context. Its z-index competes at the root, which is
 *     why raising the number worked at all.
 *
 * HOW THIS SCALE IS BUILT. Two kinds of rung:
 *
 *   OURS      layers this repo owns. Contiguous, ordered, renamed in place
 *             at the value they already had, so adopting the scale moved
 *             nothing except the sheets (9999 -> 9000, see below).
 *
 *   RESERVED  layers shadcn owns. `components/ui/**` is generated and
 *             CLAUDE.md forbids editing it, so those numbers are FIXED
 *             POINTS this scale has to be correct around, not choices. They
 *             are listed here anyway — a scale that omits the layers it has
 *             to interleave with is not a scale — and the guard test reads
 *             them back out of `components/ui/` so a shadcn regeneration
 *             that moves one fails loudly instead of silently reordering
 *             the app.
 *
 * THE ONE DELIBERATE MOVE. The roster sheets came down from 9999 to 9000,
 * BELOW the popover rung. They were tied with popovers at 9999 and the tie
 * was being broken by DOM order (the sheets render in `#root`, a portalled
 * popover lands later in `<body>`), which happens to give the right answer
 * today. A `<Select>` or a `<Popover>` opened from inside a sheet has to be
 * above the sheet, and now it is by construction. Nothing else in the app
 * sits between 100 and 9000, so the sheets lost no ground.
 *
 * THE OTHER MOVE. `toast` went 10000 -> 1000000, because `tooltip` is
 * 999999 in `ui/tooltip.tsx` and that file is not editable here. The number
 * is derived, not chosen: one above the highest reserved vendor rung, which
 * is a rule a reader can check and the guard does check. See the note on
 * the rung itself.
 */

/**
 * Every layer, in paint order. Read it top to bottom: later covers earlier.
 *
 * ADDING ONE: put it in this object, in order, with a comment saying what
 * it is and why it belongs above the rung beneath it. `zLayerScaleGuard`
 * fails on any `fixed` or `sticky` element in `src/` that carries a
 * z-index which is not one of these names.
 */
export const Z_LAYERS = {
  /** Decorative full-bleed art behind the page's own content. */
  'page-backdrop': 0,

  /**
   * The first layer above page content: anything pinned inside a scrolling
   * region. A sticky `<thead>`, a pinned first column, a panel's own sticky
   * header.
   */
  'sticky-base': 10,

  /**
   * A pinned element that has to cover another pinned element at the same
   * origin. The case that needs it is a table's corner cell, which sits
   * where a sticky column and a sticky header row cross and must beat both.
   */
  'sticky-raised': 20,

  /** A section header inside a page: filter bars, the draft board header. */
  'section-header': 30,

  /**
   * The page's own chrome: the phone header bar every in-app page carries,
   * the marketing nav, and the draft room's on-clock action bar. Above the
   * page, below anything that covers the page.
   */
  'page-header': 40,

  /**
   * App-wide navigation and page-level banners: the fixed navbar, the
   * mobile bottom nav, the cookie banner, the league-load error banner, the
   * full-screen loading screen.
   *
   * 45, not 50: shadcn's dialog overlay is 50, and a modal has to cover the
   * nav. It used to be 50 as well, and won only because Radix portals to
   * `<body>` — later in the document than `#root`. Ordering by DOM position
   * is ordering by accident.
   */
  'app-nav': 45,

  /** RESERVED — shadcn `dialog` and `alert-dialog`, overlay and content. */
  dialog: 50,

  /** RESERVED — shadcn `dropdown-menu` and `select` content. */
  menu: 60,

  /** The mobile navigation panel, which covers a menu it opened over. */
  'nav-panel': 70,

  /** The scrim behind that panel's own overlays. */
  'nav-scrim': 80,

  /**
   * Full-window takeovers: the native boot splash, the roster's
   * loading overlay, the floating assistant. Above the nav, below the
   * modal sheets.
   */
  overlay: 100,

  /**
   * The roster's bottom sheets (slot picker, fill slot, auto lineup). Below
   * `popover` on purpose, so a select or popover opened from inside a sheet
   * lands above it.
   */
  sheet: 9000,

  /**
   * RESERVED — shadcn `popover`, and every bespoke tooltip in the app that
   * overrides its content class down to this rung (`!z-popover` on the
   * matchup and cap tooltips).
   */
  popover: 9999,

  /** RESERVED — shadcn `tooltip`, straight out of `ui/tooltip.tsx`. */
  tooltip: 999999,

  /**
   * Notifications. The top rung, and the only one whose value is not the
   * value it already had.
   *
   * It has to be above `tooltip`, and `tooltip` is 999999 in a file this
   * repo does not edit (CLAUDE.md: "Do not modify
   * `apps/web/src/components/ui/`"). So the number here is not a bump, it
   * is a consequence: ONE ABOVE THE HIGHEST RESERVED VENDOR RUNG. That is
   * the whole rule, it is stated, and the guard asserts it — where the old
   * `z-[10000]` was a number picked by reading the codebase once.
   *
   * Above a tooltip on purpose. A tooltip is supplemental and follows the
   * pointer; a notification is an event the manager must not miss, and it
   * has nowhere else to appear.
   */
  toast: 1_000_000,
} as const;

export type ZLayer = keyof typeof Z_LAYERS;

/**
 * The rungs `components/ui/**` owns. The guard reads the real values out of
 * those files and compares them here, so a shadcn regeneration that moves
 * one is a failing test rather than a silently reordered app.
 */
export const VENDOR_LAYERS = {
  dialog: ['ui/dialog.tsx', 'ui/alert-dialog.tsx'],
  menu: ['ui/dropdown-menu.tsx', 'ui/select.tsx'],
  popover: ['ui/popover.tsx'],
  tooltip: ['ui/tooltip.tsx'],
} as const;

/** `{ 'page-header': '40', ... }` — the shape Tailwind's `zIndex` wants. */
export const tailwindZIndex = (): Record<string, string> =>
  Object.fromEntries(Object.entries(Z_LAYERS).map(([name, value]) => [name, String(value)]));

export default Z_LAYERS;
