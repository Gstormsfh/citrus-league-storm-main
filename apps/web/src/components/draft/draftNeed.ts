/**
 * STORMY'S NEED LINE IN THE POOL (2026-09-05, artboard 4a): `Need 2 D · 4
 * of the top-8 D go before your next pick`. Both halves are arithmetic on
 * what the room already holds -- the league's roster slots per position,
 * the positions of the picks you have made, the pool in its own
 * projection order, and how many picks are made before your turn comes
 * round -- so the line is a derivation, never a guess. "Go before your
 * next pick" assumes the room drafts in rank order, which it does not
 * exactly; the line says how many of the position's top eight sit inside
 * the picks ahead of you, which is the honest form of that warning.
 */
import { positionChipKey } from '@/components/roster/positionChip';

export interface DraftNeedInput {
  /** Roster slots per position, e.g. `{ C: 2, LW: 2, RW: 2, D: 4, G: 2 }`. */
  caps: Record<string, number> | null;
  /** Positions of the picks you have already made. */
  myPositions: string[];
  /** Available player ids in the pool's overall order, best first. */
  orderedIds: string[];
  positionOf: (id: string) => string | null | undefined;
  /** Picks made before your next turn; null when the room does not know. */
  picksAway: number | null;
  /** Optional: display name for an id, so the line can name the best available. */
  nameOf?: (id: string) => string | null | undefined;
}

export interface DraftNeed {
  position: string;
  need: number;
  /** Of the position's top eight available, how many sit inside the picks ahead of you. */
  topEightGone: number | null;
  text: string;
  /**
   * 2026-09-08: a second, shorter line built for the phone (≤ ~48 chars) that
   * reads the room: urgency when the position is about to run dry, the best
   * name at that position when it is not, and the best overall value when
   * nothing is pressing. `text` stays as it was for existing consumers.
   */
  phoneText: string;
  /** `now` = draft the position on this pick, `wait` = it will keep, `open` = no pressing need. */
  urgency: 'now' | 'wait' | 'open';
}

const TOP = 8;

export function draftNeedLine(input: DraftNeedInput): DraftNeed | null {
  if (!input.caps) return null;
  const filled = new Map<string, number>();
  for (const p of input.myPositions) {
    const key = positionChipKey(p);
    if (key) filled.set(key, (filled.get(key) ?? 0) + 1);
  }
  let best: { position: string; need: number } | null = null;
  for (const [pos, cap] of Object.entries(input.caps)) {
    const need = cap - (filled.get(pos) ?? 0);
    if (need <= 0) continue;
    if (!best || need > best.need) best = { position: pos, need };
  }
  if (!best) return null;

  let topEightGone: number | null = null;
  if (input.picksAway !== null && input.picksAway >= 0) {
    let seen = 0;
    let gone = 0;
    for (let i = 0; i < input.orderedIds.length && seen < TOP; i++) {
      if (positionChipKey(input.positionOf(input.orderedIds[i])) !== best.position) continue;
      seen += 1;
      if (i < input.picksAway) gone += 1;
    }
    topEightGone = seen > 0 ? gone : null;
  }

  const head = `Need ${best.need} ${best.position}`;
  const tail =
    topEightGone === null
      ? null
      : topEightGone === 0
        ? `none of the top-${TOP} ${best.position} go before your next pick`
        : `${topEightGone} of the top-${TOP} ${best.position} go before your next pick`;

  // Best available at the needed position, and best overall, by the pool's order.
  const bestAtPositionId = input.orderedIds.find((id) => positionChipKey(input.positionOf(id)) === best!.position) ?? null;
  const name = (id: string | null) => (id && input.nameOf ? shortName(input.nameOf(id)) : null);
  const bestAtPosition = name(bestAtPositionId);
  const bestOverall = name(input.orderedIds[0] ?? null);
  const bestOverallPos = input.orderedIds[0] ? positionChipKey(input.positionOf(input.orderedIds[0])) : null;

  let urgency: 'now' | 'wait' | 'open';
  let phoneText: string;
  if (topEightGone !== null && topEightGone >= Math.max(best.need, 3)) {
    urgency = 'now';
    phoneText = bestAtPosition
      ? `${best.position} runs dry before your pick — take ${bestAtPosition} now`
      : `${best.position} runs dry before your pick — take one now`;
  } else if (topEightGone !== null && topEightGone === 0) {
    urgency = 'wait';
    phoneText = bestOverall && bestOverallPos && bestOverallPos !== best.position
      ? `${best.position} will keep — ${bestOverall} (${bestOverallPos}) is the value here`
      : `${best.position} will keep — all top-${TOP} still there next pick`;
  } else {
    urgency = 'open';
    phoneText = bestAtPosition
      ? `Need ${best.need} ${best.position} — ${bestAtPosition} is the best left`
      : head;
  }
  return { position: best.position, need: best.need, topEightGone, text: tail ? `${head} · ${tail}` : head, phoneText, urgency };
}

/** "Connor McDavid" -> "McDavid"; keeps single-token names as-is. */
function shortName(full: string | null | undefined): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
}
