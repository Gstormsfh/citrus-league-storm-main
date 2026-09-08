/**
 * Horizontal strips (chips, day tiles, the draft board) reveal their active
 * cell by moving their OWN scrollLeft. Never `element.scrollIntoView`: that
 * walks every scrollable ancestor and moves the page vertically too. On the
 * phone it scrolled the League settings sheet until the title was off the
 * top, re-centred the Scores day strip on every tap, and gave every chip
 * strip a vertical twitch (QA pass 1, 2026-09-09).
 */
export type StripAlign = 'nearest' | 'center';

export function scrollStripTo(
  strip: HTMLElement | null | undefined,
  cell: HTMLElement | null | undefined,
  align: StripAlign = 'nearest',
): void {
  if (!strip || !cell) return;
  const left = cell.offsetLeft - strip.offsetLeft;
  const right = left + cell.offsetWidth;
  const viewLeft = strip.scrollLeft;
  const viewRight = viewLeft + strip.clientWidth;
  if (align === 'center') {
    strip.scrollLeft = Math.max(0, left - strip.clientWidth / 2 + cell.offsetWidth / 2);
    return;
  }
  if (left >= viewLeft && right <= viewRight) return; // already fully visible
  strip.scrollLeft = left < viewLeft ? Math.max(0, left - 12) : right - strip.clientWidth + 12;
}
