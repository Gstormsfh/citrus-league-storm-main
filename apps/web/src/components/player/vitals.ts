/**
 * THE BIO STRIP (2026-09-05): `AGE · HT · WT · SHOOTS` under the name on the
 * player card, from player_directory's shoots_catches, height_in, weight_lb
 * and birthdate. Pure, so the formatting is tested once.
 */
import { ageOn } from '@citrus/shared/playerWriteup/fromIndex';

export interface DirectoryVitalsRow {
  player_id: number | string;
  season?: number | null;
  shoots_catches?: string | null;
  height_in?: number | null;
  weight_lb?: number | null;
  birthdate?: string | null;
  is_goalie?: boolean | null;
  position_code?: string | null;
  /** CAREER (2026-09-05): the directory refresh's career document, when fetched. */
  career?: unknown;
}

export interface Vital {
  label: string;
  value: string;
}

/**
 * Moved to `@citrus/shared/playerWriteup/fromIndex` on 2026-09-11: the
 * server-rendered writeup needs a player's age too, and the strip and the
 * prose must never disagree about how old a man is. Re-exported here so
 * this module's callers and `__tests__/vitals.test.ts` keep their import.
 */
export { ageOn } from '@citrus/shared/playerWriteup/fromIndex';

export function heightLabel(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}

/** The strip in the artboard's order; a missing fact is left out, not dashed. */
export function vitalsFrom(row: DirectoryVitalsRow | null | undefined, today = new Date()): Vital[] {
  if (!row) return [];
  const out: Vital[] = [];
  const age = row.birthdate ? ageOn(row.birthdate, today) : null;
  if (age != null) out.push({ label: 'AGE', value: String(age) });
  if (row.height_in && row.height_in > 0) out.push({ label: 'HT', value: heightLabel(row.height_in) });
  if (row.weight_lb && row.weight_lb > 0) out.push({ label: 'WT', value: String(row.weight_lb) });
  if (row.shoots_catches) {
    const goalie = row.is_goalie === true || row.position_code === 'G';
    out.push({ label: goalie ? 'CATCHES' : 'SHOOTS', value: row.shoots_catches.toUpperCase() });
  }
  return out;
}

/** The newest season's row for a player, out of a directory read. */
export function newestRowFor(rows: DirectoryVitalsRow[], playerId: number | string): DirectoryVitalsRow | null {
  const mine = rows.filter((r) => String(r.player_id) === String(playerId));
  if (mine.length === 0) return null;
  return [...mine].sort((a, b) => (b.season ?? 0) - (a.season ?? 0))[0];
}
