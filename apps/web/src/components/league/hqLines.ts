/**
 * THE STANDINGS TILE'S LINE (2026-09-05, artboard 1a · League HQ).
 *
 * `You're 2nd · 1.5 GB · 588.9 PF`, from the ranked standings the
 * Standings page reads (`GET /api/leagues/:id/standings`, ordered by wins
 * then points for). Games back is the usual half-game arithmetic against
 * the leader; a leader reads `You're 1st · 588.9 PF`, and a league with
 * nothing played yet reads its place and `0.0 PF` -- the honest state of
 * week one on a Sunday.
 */

export interface StandingsLineRow {
  team_id: string;
  wins: number;
  losses: number;
  ties?: number;
  pointsFor: number;
}

const ORDINAL = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

/** Games behind the leader: half a game per win short, half per loss over. */
export function gamesBack(leader: StandingsLineRow, row: StandingsLineRow): number {
  return ((leader.wins - row.wins) + (row.losses - leader.losses)) / 2;
}

export function standingsLine(rows: StandingsLineRow[], teamId: string): string | null {
  if (!rows.length) return null;
  const index = rows.findIndex((r) => r.team_id === teamId);
  if (index < 0) return null;
  const row = rows[index];
  const gb = gamesBack(rows[0], row);
  const parts = [`You're ${ORDINAL(index + 1)}`];
  if (index > 0 && gb > 0) parts.push(`${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} GB`);
  parts.push(`${Number(row.pointsFor ?? 0).toFixed(1)} PF`);
  return parts.join(' · ');
}

/** `2nd` — the team's place in the ranked table, or null when it is not there. */
export function placeOf(rows: StandingsLineRow[], teamId: string): string | null {
  const index = rows.findIndex((r) => r.team_id === teamId);
  return index < 0 ? null : ORDINAL(index + 1);
}
