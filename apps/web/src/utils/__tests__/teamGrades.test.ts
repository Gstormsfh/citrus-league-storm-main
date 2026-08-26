// TRENDS & ANALYTICS (2026-08-26) — the Power Rankings card was fiction.
//
// Roster.tsx rendered four letter grades — Offense A-, Defense B, Goalie A,
// Depth C+ — as hardcoded JSX. Not derived from the roster, not derived from
// anything: the same four letters for every team in every league, permanently.
// A user comparing notes with a leaguemate finds that out immediately, and
// everything else on the page becomes suspect at the same moment.
//
// They are now computed against SEASON_BASELINE, the same table the radar beside
// them plots, so the chart and the letters cannot tell two different stories.
//
// The other half of the fix is RATES. The radar compared season-to-date totals
// against full-season baselines, so a roster on an Art Ross pace read about 15%
// in late October and every team in the app looked broken until roughly
// February. `pctOfPace` divides by games played on both sides.
import { describe, it, expect } from 'vitest';
import {
  SEASON_BASELINE,
  SEASON_BASELINE_GOALIE_WINS,
  pctOfPace,
  gradeForPct,
  gradeTone,
  calculateTeamGrades,
  type TeamCategoryStats,
  type SkaterGroupStats,
} from '../teamGrades';

const emptySkaters = (): SkaterGroupStats =>
  ({ goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, ppp: 0, games: 0 });

const emptyStats = (): TeamCategoryStats => ({
  C: emptySkaters(), LW: emptySkaters(), RW: emptySkaters(), D: emptySkaters(),
  G: { wins: 0, losses: 0, saves: 0, shutouts: 0, games: 0, count: 0 },
});

/** A group producing exactly `multiple` x elite pace over `games` player-games. */
function atPace(pos: 'C' | 'LW' | 'RW' | 'D', games: number, multiple = 1): SkaterGroupStats {
  const b = SEASON_BASELINE[pos];
  const f = (season: number) => (season / 82) * games * multiple;
  return {
    goals: f(b.goals), assists: f(b.assists), shots: f(b.shots),
    hits: f(b.hits), blocks: f(b.blocks), ppp: f(b.ppp), games,
  };
}

describe('pctOfPace', () => {
  it('reads 100 for a player producing exactly at the baseline', () => {
    expect(pctOfPace(25, 82, 25)).toBeCloseTo(100);
  });

  it('reads the same in October as in April for the same pace', () => {
    // The whole reason this is a rate. 20 games at baseline pace is still 100%.
    const twentyGames = (25 / 82) * 20;
    expect(pctOfPace(twentyGames, 20, 25)).toBeCloseTo(100);
    expect(pctOfPace(25, 82, 25)).toBeCloseTo(100);
  });

  it('is zero rather than Infinity or NaN when nobody has played', () => {
    expect(pctOfPace(0, 0, 25)).toBe(0);
    expect(pctOfPace(10, 0, 25)).toBe(0);
    expect(pctOfPace(10, 20, 0)).toBe(0);
  });

  it('scales linearly with production', () => {
    expect(pctOfPace(50, 82, 25)).toBeCloseTo(200);
    expect(pctOfPace(12.5, 82, 25)).toBeCloseTo(50);
  });
});

describe('gradeForPct', () => {
  it('maps elite pace to an A and no production to an F', () => {
    expect(gradeForPct(120)).toBe('A+');
    expect(gradeForPct(100)).toBe('A');
    expect(gradeForPct(80)).toBe('B');
    expect(gradeForPct(55)).toBe('C');
    expect(gradeForPct(0)).toBe('F');
  });

  it('shows an em dash — not an F — when there is nothing to grade', () => {
    // A roster nobody has played has not earned a bad grade. Printing one is
    // the same species of dishonesty as printing a hardcoded A-.
    expect(gradeForPct(null)).toBe('—');
    expect(gradeForPct(NaN)).toBe('—');
  });

  it('is monotonic', () => {
    const order = ['F','D','D+','C-','C','C+','B-','B','B+','A-','A','A+'];
    const seen = [0, 30, 38, 46, 54, 62, 70, 78, 86, 94, 102, 115].map(gradeForPct);
    expect(seen).toEqual(order);
  });
});

describe('calculateTeamGrades', () => {
  it('grades a team at elite pace an A across the board', () => {
    const starters = emptyStats();
    starters.C = atPace('C', 60);
    starters.LW = atPace('LW', 60);
    starters.RW = atPace('RW', 60);
    starters.D = atPace('D', 120);
    starters.G = { wins: (SEASON_BASELINE_GOALIE_WINS / 82) * 60, losses: 20, saves: 1500, shutouts: 3, games: 60, count: 2 };

    const bench = emptyStats();
    bench.C = atPace('C', 40);

    const grades = calculateTeamGrades(starters, bench);
    const by = Object.fromEntries(grades.map((g) => [g.label, g]));

    expect(by.Offense.grade).toBe('A');
    expect(by.Peripherals.grade).toBe('A');
    expect(by.Goaltending.grade).toBe('A');
    expect(by.Depth.grade).toBe('A');
  });

  it('grades a half-pace team well below a full-pace one', () => {
    const strong = emptyStats();
    strong.C = atPace('C', 60, 1);
    const weak = emptyStats();
    weak.C = atPace('C', 60, 0.5);

    const s = calculateTeamGrades(strong, emptyStats()).find((g) => g.label === 'Offense')!;
    const w = calculateTeamGrades(weak, emptyStats()).find((g) => g.label === 'Offense')!;

    expect(s.pct!).toBeGreaterThan(w.pct! * 1.9);
    expect(s.grade).toBe('A');
    expect(w.grade).toBe('C-'); // 50% of pace — the band below C, which starts at 52
  });

  it('does not hand out grades before anyone has played', () => {
    // The offseason. Every pct null, every grade an em dash, no F anywhere.
    const grades = calculateTeamGrades(emptyStats(), emptyStats());
    expect(grades).toHaveLength(4);
    for (const g of grades) {
      expect(g.pct).toBeNull();
      expect(g.grade).toBe('—');
    }
  });

  it('gives DIFFERENT teams different grades — the actual bug', () => {
    // Four hardcoded literals produced identical output for every roster ever
    // rendered. Any implementation that regresses to that fails here.
    const good = emptyStats();
    good.C = atPace('C', 60, 1.1);
    const bad = emptyStats();
    bad.C = atPace('C', 60, 0.3);

    const a = calculateTeamGrades(good, emptyStats()).map((g) => g.grade).join('');
    const b = calculateTeamGrades(bad, emptyStats()).map((g) => g.grade).join('');
    expect(a).not.toBe(b);
  });

  it('measures Depth off the bench, not the starters', () => {
    const starters = emptyStats();
    starters.C = atPace('C', 60, 1);
    const emptyBench = calculateTeamGrades(starters, emptyStats()).find((g) => g.label === 'Depth')!;
    expect(emptyBench.pct).toBeNull();

    const bench = emptyStats();
    bench.C = atPace('C', 30, 1);
    const stockedBench = calculateTeamGrades(starters, bench).find((g) => g.label === 'Depth')!;
    expect(stockedBench.pct).toBeGreaterThan(90);
  });

  it('weights position groups by the games they actually played', () => {
    // One elite centre with 60 games must not be outvoted by a single
    // 2-game call-up who happened to score once.
    const stats = emptyStats();
    stats.C = atPace('C', 60, 1);
    stats.LW = atPace('LW', 2, 3);
    const offense = calculateTeamGrades(stats, emptyStats()).find((g) => g.label === 'Offense')!;
    expect(offense.pct!).toBeGreaterThan(95);
    expect(offense.pct!).toBeLessThan(120);
  });

  it('grades goaltending off wins per start', () => {
    const stats = emptyStats();
    stats.G = { wins: 30, losses: 20, saves: 1500, shutouts: 4, games: 82, count: 1 };
    const g = calculateTeamGrades(stats, emptyStats()).find((x) => x.label === 'Goaltending')!;
    expect(g.pct).toBeCloseTo(100, 0);
    expect(g.grade).toBe('A');
  });

  it('explains every grade', () => {
    for (const g of calculateTeamGrades(emptyStats(), emptyStats())) {
      expect(g.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('gradeTone', () => {
  it('colours by letter, not by category', () => {
    // The old card tinted each row a fixed colour, which is how four constant
    // grades looked plausible. Colour now follows the letter.
    expect(gradeTone('A')).toContain('green');
    expect(gradeTone('F')).toContain('red');
    expect(gradeTone('—')).toContain('white/10');
    expect(gradeTone('A+')).toBe(gradeTone('A-'));
  });
});
