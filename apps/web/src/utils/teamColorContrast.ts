/**
 * Readable text on an NHL team colour.
 *
 * 2026-08-19 visual audit. Team chips across the playoff bracket, the
 * pools and the survivor board all painted the team's own primary colour
 * as a background and then hardcoded `text-white` on top of it. That is
 * fine for the two-thirds of the league whose primary is dark — Buffalo
 * navy, Tampa navy, Montreal red — and unreadable for the rest:
 *
 *   BOS  white on #FFB81C ....... 1.73:1
 *   PIT  white on #FCB514 ....... 1.73:1
 *   NSH  white on #FFB81C ....... 1.73:1
 *   VGK  white on #B4975A ....... 2.79:1
 *   ANA  white on #F47A38 ....... 2.73:1
 *   PHI  white on #F74902 ....... 3.55:1
 *
 * Measured on production; 11 failures on /nhl/playoffs alone. It is the
 * same defect as the on-clock action bar shipping white on lemon: a
 * FIXED text colour paired with a VARIABLE background. The only durable
 * fix is to derive the text colour from the background rather than
 * assume it.
 *
 * This picks whichever of cream or deep-forest actually reads better on
 * the given colour, so it stays correct for all 32 teams and for any
 * future palette change, including teams added later.
 */

/** Deep forest — the design system's text colour for light surfaces. */
const DARK_INK = '#0F1F15';
/** Cream — the text colour used on dark surfaces app-wide. */
const LIGHT_INK = '#FFF8F0';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number | null {
  const c = parseHex(hex);
  if (!c) return null;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio between two hex colours. Null if either is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The text colour to use on top of `background`.
 *
 * Returns cream on dark team colours and deep forest on light ones,
 * choosing whichever genuinely scores higher rather than guessing from a
 * fixed luminance threshold — several NHL golds sit close enough to the
 * midpoint that a hard cutoff picks wrong.
 *
 * Unparseable or missing input falls back to cream, matching the app's
 * dark default, so a bad colour can never produce invisible text.
 */
export function onTeamColor(background: string | null | undefined): string {
  if (!background) return LIGHT_INK;
  const lightC = contrastRatio(LIGHT_INK, background);
  const darkC = contrastRatio(DARK_INK, background);
  if (lightC === null || darkC === null) return LIGHT_INK;
  return darkC > lightC ? DARK_INK : LIGHT_INK;
}
