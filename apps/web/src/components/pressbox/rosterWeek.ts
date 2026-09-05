/**
 * THE WK COLUMN, AND THE WIN BAR (2026-09-05, artboard 1a · Team).
 *
 * The artboard's roster row carries a week number with a trend under it
 * (`31.2 / ▲ 12%`) and the team card carries `64% WIN` with the live score
 * pair. The Press Box row and card have drawn both since PR4; the page
 * never fed them, because no per-player week total was on its payload.
 *
 * It is on two payloads that already exist:
 *  - /api/matchups/matchup-stats: each player's stats summed over the week
 *    so far (the matchup page's own read), scored here with the league's
 *    ScoringCalculator;
 *  - /api/players/projections/batch: each player's projection per date,
 *    for the week's dates.
 *
 * Per player: `actualToDate` (scored), `projToDate` (projections for the
 * days already played), `projRemaining` (today onward). The week number is
 * actual + remaining projection, the trend is actual against projection
 * over the played days -- null until a day has been played, which the row
 * prints as no trend rather than `— 0%`. Before the opener every WK cell
 * is the week's projection.
 *
 * Pure: the hook fetches, this file computes, the tests read this file.
 */
import { ScoringCalculator } from '@/utils/scoringUtils';

export interface RosterWeekPlayer {
  id: string | number;
  isGoalie: boolean;
}

export interface RosterWeekEntry {
  weekPoints: number;
  weekTrendPct: number | null;
  actualToDate: number;
  projToDate: number;
  projRemaining: number;
  /** Projected games from today onward; the win model's games-left count. */
  gamesRemaining: number;
}

export interface ProjectionRowLite {
  player_id: number | string;
  projection_date: string;
  total_projected_points: number | string | null;
}

export function weekEntries(
  players: RosterWeekPlayer[],
  weekStats: Map<number, Record<string, number>> | Record<string, Record<string, number>>,
  projections: ProjectionRowLite[],
  today: string,
  scoring?: unknown,
): Map<string, RosterWeekEntry> {
  const scorer = new ScoringCalculator(scoring as ConstructorParameters<typeof ScoringCalculator>[0]);
  const statsFor = (id: string): Record<string, number> | undefined =>
    weekStats instanceof Map ? weekStats.get(Number(id)) : weekStats[id];

  const projByPlayer = new Map<string, { toDate: number; remaining: number; gamesRemaining: number }>();
  for (const row of projections) {
    const id = String(row.player_id);
    const date = String(row.projection_date).slice(0, 10);
    const pts = Number(row.total_projected_points ?? 0) || 0;
    const agg = projByPlayer.get(id) ?? { toDate: 0, remaining: 0, gamesRemaining: 0 };
    if (date < today) agg.toDate += pts;
    else {
      agg.remaining += pts;
      agg.gamesRemaining += 1;
    }
    projByPlayer.set(id, agg);
  }

  const out = new Map<string, RosterWeekEntry>();
  for (const p of players) {
    const id = String(p.id);
    const stats = statsFor(id);
    const actualToDate = stats ? round1(scorer.calculatePoints(stats, p.isGoalie)) : 0;
    const proj = projByPlayer.get(id) ?? { toDate: 0, remaining: 0, gamesRemaining: 0 };
    const weekPoints = round1(actualToDate + proj.remaining);
    const weekTrendPct = proj.toDate > 0 ? Math.round(((actualToDate - proj.toDate) / proj.toDate) * 100) : null;
    out.set(id, {
      weekPoints,
      weekTrendPct,
      actualToDate,
      projToDate: round1(proj.toDate),
      projRemaining: round1(proj.remaining),
      gamesRemaining: proj.gamesRemaining,
    });
  }
  return out;
}

/** A side's expected final and games left, summed over its starters. */
export function sideOutlook(
  starterIds: Array<string | number>,
  entries: Map<string, RosterWeekEntry>,
): { expectedFinal: number; gamesLeft: number; banked: number } {
  let expectedFinal = 0;
  let gamesLeft = 0;
  let banked = 0;
  for (const id of starterIds) {
    const e = entries.get(String(id));
    if (!e) continue;
    expectedFinal += e.weekPoints;
    gamesLeft += e.gamesRemaining;
    banked += e.actualToDate;
  }
  return { expectedFinal: round1(expectedFinal), gamesLeft, banked: round1(banked) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
