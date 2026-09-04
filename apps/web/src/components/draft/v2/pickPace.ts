import { useEffect, useRef, useState } from 'react';

/**
 * HOW FAST THIS ROOM IS PICKING (2026-09-04).
 *
 * The off-clock bar says `NEXT PICK 4.06 · 11 PICKS AWAY · ~8 MIN`, and the
 * last figure has to come from somewhere real. The draft state carries no
 * pick timestamps (`RosterEntry.seq` is an order, and v1Adapters fakes a
 * clock from it), so the room measures the pace itself: the wall-clock
 * moment each new pick lands, kept for the newest few, and the MEDIAN gap
 * between them. Median, not mean — one manager who lets the clock run out
 * would otherwise drag the estimate for the next twenty picks.
 *
 * Before two picks have landed in THIS session there is no pace, and the
 * bar prints the ceiling the room's own clock allows (`≤ 17 MIN`) rather
 * than a guess. A pure module (no component) so react-refresh keeps working.
 */

/** Keep this many of the newest pick-to-pick gaps. */
export const PACE_WINDOW = 5;

/** Median of the gaps between consecutive stamps, in seconds; null under two stamps. */
export function medianGapSec(stampsMs: readonly number[]): number | null {
  if (stampsMs.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < stampsMs.length; i++) gaps.push((stampsMs[i] - stampsMs[i - 1]) / 1000);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * `~8 MIN` from a measured pace, `≤ 17 MIN` from the clock limit when there
 * is none yet, and null when neither is known. `picksAway` is how many picks
 * are made before the caller's — the caller's own is not waited for.
 */
export function etaLabel(
  picksAway: number,
  paceSec: number | null,
  pickTimeLimitSec: number | null,
): string | null {
  if (picksAway <= 0) return null;
  if (paceSec !== null && paceSec > 0) {
    const sec = picksAway * paceSec;
    return sec < 60 ? '<1 min' : `~${Math.ceil(sec / 60)} min`;
  }
  if (pickTimeLimitSec !== null && pickTimeLimitSec > 0) {
    return `≤ ${Math.ceil((picksAway * pickTimeLimitSec) / 60)} min`;
  }
  return null;
}

/**
 * Stamps `Date.now()` each time `picksMade` grows and returns the median gap
 * in seconds, or null until two picks have landed. The first value seen on
 * mount is a baseline, not a pick: joining a room at pick 30 says nothing
 * about how fast the first 29 went.
 */
export function usePickPace(picksMade: number | null): number | null {
  const lastSeen = useRef<number | null>(null);
  const stamps = useRef<number[]>([]);
  const [pace, setPace] = useState<number | null>(null);

  useEffect(() => {
    if (picksMade === null) return;
    if (lastSeen.current === null) {
      // The baseline is NOT a stamp: the pick on the clock at mount was
      // already part-way through, so a gap measured from here would be
      // short, and the first ETA optimistic.
      lastSeen.current = picksMade;
      return;
    }
    if (picksMade <= lastSeen.current) {
      // An undo or a resync that went backwards: the baseline moves, the
      // stamps do not, because nothing was picked.
      lastSeen.current = picksMade;
      return;
    }
    lastSeen.current = picksMade;
    stamps.current = [...stamps.current, Date.now()].slice(-(PACE_WINDOW + 1));
    setPace(medianGapSec(stamps.current));
  }, [picksMade]);

  return pace;
}
