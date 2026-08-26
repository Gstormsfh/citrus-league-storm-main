/**
 * teamGrades.ts — the numbers behind the Roster page's Trends & Analytics tab.
 *
 * Extracted from Roster.tsx on 2026-08-26. It lives here because it is pure
 * arithmetic over a roster and therefore testable, and because the thing it
 * replaced was four hardcoded letter grades inside a 4,000-line page component
 * where nobody was ever going to notice them.
 */
/**
 * ONE YARDSTICK FOR EVERY NUMBER ON THE TRENDS TAB.
 *
 * These are the production of a good NHL starter over a full 82-game season,
 * per position. Everything on the Trends tab — the radar and the four grades —
 * is expressed as a percentage of this table, so the chart and the letters can
 * never tell the user two different stories about the same roster.
 *
 * They are a stated judgement, not a measurement, and that is the honest
 * framing: "% of elite pace" is a claim we can defend and a user can argue
 * with. What was here before the 2026-08-26 sweep was four hardcoded letter
 * grades — A-, B, A, C+ — identical for every team in every league forever.
 */
export const SEASON_BASELINE = {
  C:  { goals: 25, assists: 45, shots: 200, hits: 80,  blocks: 40,  ppp: 15 },
  LW: { goals: 25, assists: 35, shots: 200, hits: 100, blocks: 40,  ppp: 12 },
  RW: { goals: 25, assists: 35, shots: 200, hits: 100, blocks: 40,  ppp: 12 },
  D:  { goals: 10, assists: 35, shots: 150, hits: 120, blocks: 130, ppp: 10 },
} as const;

/** Wins by a clear NHL starter over a full season. */
export const SEASON_BASELINE_GOALIE_WINS = 30;

const BASELINE_GAMES = 82;

export type SkaterGroupStats = {
  goals: number; assists: number; shots: number; hits: number;
  blocks: number; ppp: number; games: number;
};

/**
 * Percentage of elite pace for one category.
 *
 * Rates, not totals. A total-versus-season-baseline comparison reads ~15% in
 * late October for a roster that is on an Art Ross pace, which is why the
 * radar used to make every team look broken for the first third of a season.
 */
export function pctOfPace(total: number, games: number, seasonBaseline: number): number {
  if (!games || games <= 0 || !seasonBaseline) return 0;
  const perGame = total / games;
  const basePerGame = seasonBaseline / BASELINE_GAMES;
  if (!isFinite(perGame) || !isFinite(basePerGame) || basePerGame <= 0) return 0;
  return (perGame / basePerGame) * 100;
}


export type GoalieGroupStats = {
  wins: number; losses: number; saves: number; shutouts: number; games: number; count: number;
};

export type TeamCategoryStats = {
  C: SkaterGroupStats; LW: SkaterGroupStats; RW: SkaterGroupStats; D: SkaterGroupStats;
  G: GoalieGroupStats;
};

/** Letter for a percentage of elite pace. 100% = elite starter pace. */
export function gradeForPct(pct: number | null): string {
  if (pct === null || !isFinite(pct)) return '—';
  if (pct >= 110) return 'A+';
  if (pct >= 100) return 'A';
  if (pct >= 92) return 'A-';
  if (pct >= 84) return 'B+';
  if (pct >= 76) return 'B';
  if (pct >= 68) return 'B-';
  if (pct >= 60) return 'C+';
  if (pct >= 52) return 'C';
  if (pct >= 44) return 'C-';
  if (pct >= 36) return 'D+';
  if (pct >= 28) return 'D';
  return 'F';
}

export type TeamGrade = { label: string; grade: string; pct: number | null; detail: string };

const SKATER_GROUPS = ['C', 'LW', 'RW', 'D'] as const;

/** Games-weighted mean of a per-group percentage across the skater groups. */
export type PositionBaseline = {
  goals: number; assists: number; shots: number; hits: number; blocks: number; ppp: number;
};

function weightedSkaterPct(
  stats: TeamCategoryStats,
  pick: (g: SkaterGroupStats, base: PositionBaseline) => number[],
): number | null {
  let weighted = 0;
  let games = 0;
  for (const key of SKATER_GROUPS) {
    const g = stats[key] as SkaterGroupStats;
    if (!g || !g.games) continue;
    const values = pick(g, SEASON_BASELINE[key]);
    if (!values.length) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    weighted += mean * g.games;
    games += g.games;
  }
  return games > 0 ? weighted / games : null;
}

/**
 * The four grades on the Trends tab, all measured against SEASON_BASELINE.
 *
 * A null pct means "no games played yet" — the offseason, or a league whose
 * draft has not happened. That renders as an em dash and a line of copy, NOT
 * as an F: a roster nobody has played yet has not earned a bad grade, and
 * showing one is the same species of dishonesty as hardcoding an A-.
 */
export function calculateTeamGrades(starters: TeamCategoryStats, bench: TeamCategoryStats): TeamGrade[] {
  const offense = weightedSkaterPct(starters, (g, b) => [
    pctOfPace(g.goals, g.games, b.goals),
    pctOfPace(g.assists, g.games, b.assists),
    pctOfPace(g.ppp, g.games, b.ppp),
    pctOfPace(g.shots, g.games, b.shots),
  ]);

  // "Defense" here is the peripheral categories a fantasy manager drafts for,
  // not the D slot — blocks and hits come from forwards too.
  const defense = weightedSkaterPct(starters, (g, b) => [
    pctOfPace(g.blocks, g.games, b.blocks),
    pctOfPace(g.hits, g.games, b.hits),
  ]);

  const goalieGames = starters.G?.games || 0;
  const goaltending = goalieGames > 0
    ? pctOfPace(starters.G.wins, goalieGames, SEASON_BASELINE_GOALIE_WINS)
    : null;

  // Depth is the SAME yardstick pointed at the bench. An A means the players
  // waiting behind your lineup are producing at starter pace — which is what
  // depth actually means — rather than a comparison against your own starters,
  // where a weak team would score well for being uniformly weak.
  const depth = weightedSkaterPct(bench, (g, b) => [
    pctOfPace(g.goals, g.games, b.goals),
    pctOfPace(g.assists, g.games, b.assists),
    pctOfPace(g.shots, g.games, b.shots),
    pctOfPace(g.blocks, g.games, b.blocks),
    pctOfPace(g.hits, g.games, b.hits),
  ]);

  return [
    { label: 'Offense',    grade: gradeForPct(offense),     pct: offense,     detail: 'Goals, assists, PPP and shots by your starting skaters' },
    { label: 'Peripherals', grade: gradeForPct(defense),    pct: defense,     detail: 'Blocks and hits by your starting skaters' },
    { label: 'Goaltending', grade: gradeForPct(goaltending), pct: goaltending, detail: 'Wins per start by your starting goalies' },
    { label: 'Depth',      grade: gradeForPct(depth),       pct: depth,       detail: 'Your bench, measured against the same starter baseline' },
  ];
}

/** Badge colour by letter — green through red, no hardcoded per-category tint. */
export function gradeTone(grade: string): string {
  if (grade === '—') return 'bg-white/10 text-white/60 hover:bg-white/10';
  const head = grade[0];
  if (head === 'A') return 'bg-green-600 hover:bg-green-700 text-white';
  if (head === 'B') return 'bg-emerald-600 hover:bg-emerald-700 text-white';
  if (head === 'C') return 'bg-yellow-600 hover:bg-yellow-700 text-white';
  if (head === 'D') return 'bg-orange-600 hover:bg-orange-700 text-white';
  return 'bg-red-600 hover:bg-red-700 text-white';
}

