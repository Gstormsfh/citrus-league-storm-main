/**
 * CATEGORIES (2026-09-05, artboard 1a · Match). The tab strip reads
 * LINEUPS · CATEGORIES · BENCH · TONIGHT; the reference draws only the
 * first. This is the second: each side's starters summed by counting
 * category for the week, from the `matchupStats` the matchup page already
 * carries on every player (fantasy_matchup_lines / the week RPC). Nothing
 * is invented: a category no starter has recorded is still a row, at 0,
 * because 0 is the honest total of a week nobody has scored in yet.
 */
import type { MatchupPlayer } from '@/components/matchup/types';

export interface CategoryRow {
  key: string;
  label: string;
  yours: number;
  theirs: number;
  /** `lower` for GAA-style categories; every counting stat is `higher`. */
  better: 'higher' | 'lower';
  /** Decimals when printed. */
  decimals: number;
}

const SKATER: Array<{ key: keyof NonNullable<MatchupPlayer['matchupStats']>; label: string }> = [
  { key: 'goals', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'sog', label: 'SOG' },
  { key: 'ppp', label: 'PPP' },
  { key: 'shp', label: 'SHP' },
  { key: 'hits', label: 'HIT' },
  { key: 'blocks', label: 'BLK' },
  { key: 'pim', label: 'PIM' },
];
const GOALIE: Array<{ key: keyof NonNullable<MatchupPlayer['matchupStats']>; label: string }> = [
  { key: 'wins', label: 'W' },
  { key: 'saves', label: 'SV' },
  { key: 'shutouts', label: 'SO' },
  { key: 'goals_against', label: 'GA' },
];

const isGoalie = (p: MatchupPlayer) => p.isGoalie === true || p.position === 'G' || p.position === 'Goalie';

/**
 * A goalie's week arrives as `goalieMatchupStats` (wins/saves/shutouts/
 * goalsAgainst) from the service and as `matchupStats` only on a selected
 * day, so a goalie row reads whichever is present. `MatchupService` never
 * sets `matchupStats` for a goalie in the weekly view.
 */
const GOALIE_ALIAS: Partial<Record<string, keyof NonNullable<MatchupPlayer['goalieMatchupStats']>>> = {
  wins: 'wins',
  saves: 'saves',
  shutouts: 'shutouts',
  goals_against: 'goalsAgainst',
};

function statOf(p: MatchupPlayer, key: keyof NonNullable<MatchupPlayer['matchupStats']>): number | undefined {
  const direct = p.matchupStats?.[key];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const alias = GOALIE_ALIAS[key];
  const viaGoalie = alias ? p.goalieMatchupStats?.[alias] : undefined;
  return typeof viaGoalie === 'number' && Number.isFinite(viaGoalie) ? viaGoalie : undefined;
}

function sum(players: MatchupPlayer[], key: keyof NonNullable<MatchupPlayer['matchupStats']>, goalies: boolean): number {
  let n = 0;
  for (const p of players) {
    if (isGoalie(p) !== goalies) continue;
    const v = statOf(p, key);
    if (v !== undefined) n += v;
  }
  return n;
}

export function categoryRows(yours: MatchupPlayer[], theirs: MatchupPlayer[]): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const c of SKATER) {
    rows.push({ key: c.key, label: c.label, yours: sum(yours, c.key, false), theirs: sum(theirs, c.key, false), better: 'higher', decimals: 0 });
  }
  for (const c of GOALIE) {
    rows.push({ key: c.key, label: c.label, yours: sum(yours, c.key, true), theirs: sum(theirs, c.key, true), better: c.key === 'goals_against' ? 'lower' : 'higher', decimals: 0 });
  }
  return rows;
}

/** Who leads a row: `you`, `them`, or `even`. */
export function leader(row: CategoryRow): 'you' | 'them' | 'even' {
  if (row.yours === row.theirs) return 'even';
  const youBetter = row.better === 'higher' ? row.yours > row.theirs : row.yours < row.theirs;
  return youBetter ? 'you' : 'them';
}

/** `7 – 4 – 1` across the rows, the way a categories league reads a week. */
export function categoryTally(rows: CategoryRow[]): { you: number; them: number; even: number } {
  const t = { you: 0, them: 0, even: 0 };
  for (const r of rows) t[leader(r)] += 1;
  return t;
}
