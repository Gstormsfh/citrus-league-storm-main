/**
 * Slot id -> the short label a manager recognises.
 *
 * Its own module rather than a named export from SlotPickerMenu.tsx: a file
 * that exports both a component and a plain function breaks react-refresh, so
 * editing the menu during dev would force a full reload instead of a hot swap.
 *
 * Unrecognised ids pass through unchanged. A slot scheme this does not know
 * about should render something wrong-looking that can be reported, not an
 * empty cell that reads as a rendering bug.
 */
/** `slot-C-2` -> `C2`, `slot-UTIL` -> `UTIL`, `ir-slot-1` -> `IR`. */
export function slotLabel(slotId: string): string {
  if (slotId === 'bench-grid') return 'Bench';
  const ir = /^ir-slot-(\d+)$/.exec(slotId);
  if (ir) return 'IR';
  const util = /^slot-UTIL(?:-(\d+))?$/.exec(slotId);
  if (util) return util[1] ? `UTIL${util[1]}` : 'UTIL';
  const pos = /^slot-([A-Z]+)-(\d+)$/.exec(slotId);
  if (pos) return `${pos[1]}${pos[2]}`;
  return slotId;
}
