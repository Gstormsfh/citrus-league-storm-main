/**
 * THE BIO STRIP (2026-09-05): `AGE · HT · WT · SHOOTS` under the name on the
 * player card, from player_directory's shoots_catches, height_in, weight_lb
 * and birthdate. Pure, so the formatting is tested once.
 */
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

export function ageOn(birthdate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  const beforeBirthday = today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 70 ? age : null;
}

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
