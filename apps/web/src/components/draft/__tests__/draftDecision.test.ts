/**
 * `draftDecision` — the arithmetic behind everything the draft room says
 * while a manager is on the clock.
 *
 * These are the numbers a manager acts on with twenty seconds left, so the
 * tests are about TRUTH before they are about behaviour: what the module
 * refuses to print, which categories a projection actually covers, and
 * whether the scarcity count errs in the safe direction.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SCORING, ScoringCalculator, type ScoringSettings } from '@citrus/shared';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import {
  DRAFT_POSITIONS,
  buildDraftProjectionMap,
  buildQualityScales,
  normalizeDraftPosition,
  ordinalPercentile,
  picksUntilNextTurn,
  projectedGoalsAgainst,
  projectionFor,
  qualitySignalFor,
  qualitySignalLine,
  scarcityStrip,
  startersLeft,
} from '../draftDecision';

function entry(over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
  return {
    id: 8478402,
    name: 'Test Player',
    team: 'EDM',
    position: 'C',
    jersey: 97,
    headshot_url: null,
    is_goalie: false,
    roster_status: null,
    gp: 60,
    goals: 30,
    assists: 40,
    points: 70,
    sog: 200,
    hits: 40,
    blocks: 30,
    ppp: 25,
    plus_minus: 10,
    x_goals: 25,
    wins: 0,
    saves: 0,
    save_pct: 0,
    gaa: 0,
    shutouts: 0,
    xg_per_60: 1.1,
    xg_rating: null,
    gar_per_60: 0.5,
    gar_evo: 0.3,
    gar_evd: 0.1,
    gar_ppo: 0.05,
    gar_ppd: 0.02,
    gar_pen: 0.03,
    proj_gp: 20,
    proj_fantasy_points: 200,
    proj_fantasy_ppg: 10,
    proj_goals: 10,
    proj_assists: 14,
    proj_sog: 70,
    proj_ppp: 8,
    proj_blocks: 12,
    proj_hits: 15,
    proj_wins: null,
    proj_saves: null,
    proj_shutouts: null,
    ...over,
  };
}

const DEFAULT_SCORER = new ScoringCalculator(null);

describe('normalizeDraftPosition', () => {
  it('folds the wire spellings onto the five roster positions', () => {
    expect(normalizeDraftPosition('L')).toBe('LW');
    expect(normalizeDraftPosition('Right')).toBe('RW');
    expect(normalizeDraftPosition('centre')).toBe('C');
    expect(normalizeDraftPosition('Defenseman')).toBe('D');
    expect(normalizeDraftPosition('goaltender')).toBe('G');
  });

  it('returns empty for anything it does not recognise, never a guess', () => {
    // A garbled position must drop out of the scarcity counts rather than
    // land in one of them and skew a number a manager drafts on.
    expect(normalizeDraftPosition('F')).toBe('');
    expect(normalizeDraftPosition('')).toBe('');
    expect(normalizeDraftPosition(null)).toBe('');
    expect(normalizeDraftPosition(undefined)).toBe('');
  });
});

describe('projectionFor — a skater', () => {
  it('scores every category the payload projects, through league scoring', () => {
    const p = projectionFor(entry(), DEFAULT_SCORER, null)!;
    const expected =
      10 * DEFAULT_SCORING.skater.goals +
      14 * DEFAULT_SCORING.skater.assists +
      8 * DEFAULT_SCORING.skater.power_play_points +
      70 * DEFAULT_SCORING.skater.shots_on_goal +
      12 * DEFAULT_SCORING.skater.blocks +
      15 * DEFAULT_SCORING.skater.hits;
    expect(p.total).toBeCloseTo(expected, 6);
    expect(p.gamesRemaining).toBe(20);
    expect(p.perGp).toBeCloseTo(expected / 20, 6);
  });

  it('BLOCKS ARE IN THE TOTAL — the whole reason the server field was exposed', () => {
    // Blocks are 1 point in DEFAULT_SCORING. `PlayerDashboardService` selected
    // projected_blocks and dropped it, so any consumer scoring the projection
    // through league categories was short every skater's blocks. If this
    // assertion ever passes with the blocks term missing, the field has been
    // dropped again somewhere between the table and this module.
    const withBlocks = projectionFor(entry({ proj_blocks: 40 }), DEFAULT_SCORER, null)!;
    const withoutBlocks = projectionFor(entry({ proj_blocks: 0 }), DEFAULT_SCORER, null)!;
    expect(withBlocks.total - withoutBlocks.total).toBeCloseTo(
      40 * DEFAULT_SCORING.skater.blocks,
      6,
    );
  });

  it('follows a custom league rather than the default set', () => {
    const custom: ScoringSettings = {
      skater: { ...DEFAULT_SCORING.skater, goals: 1, assists: 1, shots_on_goal: 0, blocks: 0 },
      goalie: { ...DEFAULT_SCORING.goalie },
    };
    const p = projectionFor(entry(), new ScoringCalculator(custom), custom)!;
    // 10 G + 14 A at a point each, plus 8 PPP at the default 2, plus hits at 0.
    expect(p.total).toBeCloseTo(10 + 14 + 8 * 2, 6);
  });

  it('returns null when the pipeline has no projection row for the player', () => {
    expect(projectionFor(entry({ proj_gp: null }), DEFAULT_SCORER, null)).toBeNull();
    expect(projectionFor(entry({ proj_gp: 0 }), DEFAULT_SCORER, null)).toBeNull();
    expect(projectionFor(null, DEFAULT_SCORER, null)).toBeNull();
  });

  it('treats a missing projected category as absent, not as an error', () => {
    // A null column contributes nothing and the rest of the projection still
    // renders. Returning null for the whole player would hide six good
    // numbers because one is missing.
    const p = projectionFor(entry({ proj_hits: null, proj_blocks: null }), DEFAULT_SCORER, null)!;
    expect(p.total).toBeGreaterThan(0);
  });
});

describe('projectedGoalsAgainst', () => {
  it('inverts the save rate: 900 saves at .900 means 100 went in', () => {
    expect(projectedGoalsAgainst(900, 0.9)).toBeCloseTo(100, 6);
  });

  it('accepts the per-mille shape the column also arrives in', () => {
    expect(projectedGoalsAgainst(900, 900)).toBeCloseTo(100, 6);
  });

  it('treats a perfect 1.000 as a rate, not as per-mille', () => {
    // REGRESSION: the `< 1` boundary lifted from `normalizeSavePct` read
    // 1.000 as per-mille, divided by 1000, and projected 899,100 goals
    // against. A real number the room would have printed straight onto the
    // most important surface in the product.
    expect(projectedGoalsAgainst(900, 1)).toBeCloseTo(0, 6);
    expect(projectedGoalsAgainst(900, 1000)).toBeCloseTo(0, 6);
  });

  it('refuses rather than guesses when the rate is missing or impossible', () => {
    expect(projectedGoalsAgainst(900, null)).toBeNull();
    expect(projectedGoalsAgainst(900, 0)).toBeNull();
    expect(projectedGoalsAgainst(900, 1001)).toBeNull();
    expect(projectedGoalsAgainst(900, -0.5)).toBeNull();
    expect(projectedGoalsAgainst(null, 0.9)).toBeNull();
  });
});

describe('projectionFor — a goalie', () => {
  const keeper = (over: Partial<DashboardIndexEntry> = {}) =>
    entry({
      is_goalie: true,
      position: 'G',
      proj_gp: 30,
      proj_wins: 18,
      proj_saves: 900,
      proj_shutouts: 2,
      save_pct: 0.9,
      proj_goals: null,
      proj_assists: null,
      proj_sog: null,
      proj_ppp: null,
      proj_blocks: null,
      proj_hits: null,
      ...over,
    });

  it('charges the projected goals against under default scoring', () => {
    const p = projectionFor(keeper(), DEFAULT_SCORER, null)!;
    const expected =
      18 * DEFAULT_SCORING.goalie.wins +
      900 * DEFAULT_SCORING.goalie.saves +
      2 * DEFAULT_SCORING.goalie.shutouts +
      100 * DEFAULT_SCORING.goalie.goals_against;
    expect(p.total).toBeCloseTo(expected, 6);
    // And the number that would have shipped without the derivation is
    // materially higher — this is the inflation the module exists to avoid.
    const naive = expected - 100 * DEFAULT_SCORING.goalie.goals_against;
    expect(naive / p.total).toBeGreaterThan(1.3);
  });

  it('applies the default weight when the league passes no settings at all', () => {
    // REGRESSION: reading `settings?.goalie?.goals_against` and treating
    // undefined as "not scored" skipped the derivation for every league on
    // default settings, which is most of them.
    const withNull = projectionFor(keeper(), DEFAULT_SCORER, null)!;
    const withExplicitDefaults = projectionFor(
      keeper(),
      new ScoringCalculator(DEFAULT_SCORING),
      DEFAULT_SCORING,
    )!;
    expect(withNull.total).toBeCloseTo(withExplicitDefaults.total, 6);
  });

  it('prints nothing rather than an inflated number when the rate is unknown', () => {
    expect(projectionFor(keeper({ save_pct: 0 }), DEFAULT_SCORER, null)).toBeNull();
  });

  it('still projects a goalie in a league that does not score goals against', () => {
    const noGa: ScoringSettings = {
      skater: { ...DEFAULT_SCORING.skater },
      goalie: { ...DEFAULT_SCORING.goalie, goals_against: 0 },
    };
    const p = projectionFor(keeper({ save_pct: 0 }), new ScoringCalculator(noGa), noGa)!;
    expect(p.total).toBeGreaterThan(0);
  });
});

describe('buildDraftProjectionMap', () => {
  it('keys on the STRING player id the draft pool uses', () => {
    const map = buildDraftProjectionMap([entry({ id: 8478402 })], null);
    expect(map.has('8478402')).toBe(true);
    expect(map.has(8478402 as unknown as string)).toBe(false);
  });

  it('omits an unprojectable player rather than storing a zero', () => {
    // The pool renders "-" for a miss and "0.0" for a zero. Those are
    // different claims and only one of them is true.
    const map = buildDraftProjectionMap([entry({ id: 1, proj_gp: null })], null);
    expect(map.size).toBe(0);
  });

  it('is empty for an empty payload, which is the guest path', () => {
    expect(buildDraftProjectionMap([], null).size).toBe(0);
  });
});

describe('startersLeft', () => {
  it('counts the league-wide starter demand that is still on the board', () => {
    // 12 teams x 2 C = 24 starting centres; 6 are gone; 100 are available.
    expect(startersLeft({ teamCount: 12, slots: 2, draftedAtPosition: 6, availableAtPosition: 100 }))
      .toBe(18);
  });

  it('never claims more starters than there are players left', () => {
    expect(startersLeft({ teamCount: 12, slots: 2, draftedAtPosition: 0, availableAtPosition: 5 }))
      .toBe(5);
  });

  it('floors at zero once demand is met', () => {
    expect(startersLeft({ teamCount: 12, slots: 2, draftedAtPosition: 30, availableAtPosition: 40 }))
      .toBe(0);
  });

  it('is zero rather than NaN for a league with no teams or no slots', () => {
    expect(startersLeft({ teamCount: 0, slots: 2, draftedAtPosition: 0, availableAtPosition: 9 }))
      .toBe(0);
    expect(startersLeft({ teamCount: 12, slots: 0, draftedAtPosition: 0, availableAtPosition: 9 }))
      .toBe(0);
  });
});

describe('scarcityStrip', () => {
  const base = {
    teamCount: 12,
    startingSlots: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
    availableByPosition: { C: 90, LW: 90, RW: 90, D: 120, G: 40 },
    draftedByPosition: { C: 6, LW: 4, RW: 4, D: 6, G: 3 },
    myFilledByPosition: {},
    picksUntilNextTurn: null,
  };

  it('drops positions the manager has already filled', () => {
    const rows = scarcityStrip({ ...base, myFilledByPosition: { C: 2, LW: 2, RW: 2, D: 4 } });
    expect(rows.map((r) => r.position)).toEqual(['G']);
  });

  it('drops positions the league does not start', () => {
    const rows = scarcityStrip({ ...base, startingSlots: { C: 2, G: 1 } });
    expect(rows.map((r) => r.position).sort()).toEqual(['C', 'G']);
  });

  it('reports open slots net of what the manager already has', () => {
    const rows = scarcityStrip({ ...base, myFilledByPosition: { D: 1 } });
    expect(rows.find((r) => r.position === 'D')!.openSlots).toBe(3);
  });

  it('makes no urgency claim when the turn order is unknown', () => {
    const rows = scarcityStrip({ ...base, availableByPosition: { ...base.availableByPosition, G: 1 } });
    expect(rows.every((r) => r.urgent === false)).toBe(true);
  });

  it('marks a position urgent when the run outlasts the wait for your next pick', () => {
    // 2 goalies left on the board, 21 picks until this manager is up again.
    const rows = scarcityStrip({
      ...base,
      availableByPosition: { ...base.availableByPosition, G: 2 },
      picksUntilNextTurn: 21,
    });
    const g = rows.find((r) => r.position === 'G')!;
    expect(g.startersLeft).toBe(2);
    expect(g.urgent).toBe(true);
    // ...and the comfortable positions are not.
    expect(rows.find((r) => r.position === 'D')!.urgent).toBe(false);
  });

  it('puts the urgent positions first, then the scarcest', () => {
    const rows = scarcityStrip({
      ...base,
      availableByPosition: { C: 90, LW: 3, RW: 90, D: 120, G: 2 },
      picksUntilNextTurn: 4,
    });
    expect(rows[0].position).toBe('G');
    expect(rows[1].position).toBe('LW');
  });

  it('is empty when the league has no roster settings to work from', () => {
    expect(scarcityStrip({ ...base, startingSlots: {} })).toEqual([]);
  });

  it('only ever reports the five roster positions', () => {
    const rows = scarcityStrip(base);
    for (const row of rows) expect(DRAFT_POSITIONS).toContain(row.position);
  });
});

describe('picksUntilNextTurn', () => {
  const matrix = [
    { pickNumber: 22, teamId: 'b' },
    { pickNumber: 23, teamId: 'c' },
    { pickNumber: 24, teamId: 'a' },
    { pickNumber: 25, teamId: 'a' },
    { pickNumber: 45, teamId: 'a' },
  ];

  it('measures the gap to this team’s next slot, not its current one', () => {
    expect(picksUntilNextTurn(matrix, 'a', 24)).toBe(1);
    expect(picksUntilNextTurn(matrix, 'a', 25)).toBe(20);
  });

  it('returns null when this team has no pick left', () => {
    expect(picksUntilNextTurn(matrix, 'a', 45)).toBeNull();
  });

  it('returns null rather than a number it cannot support', () => {
    expect(picksUntilNextTurn(null, 'a', 24)).toBeNull();
    expect(picksUntilNextTurn(matrix, null, 24)).toBeNull();
    expect(picksUntilNextTurn(matrix, 'a', null)).toBeNull();
  });
});

describe('qualitySignalFor', () => {
  /** A cohort big enough to have a distribution, all with 60 GP. */
  const forwards = Array.from({ length: 40 }, (_, i) =>
    entry({ id: 100 + i, position: 'C', xg_per_60: 0.5 + i * 0.05, gar_per_60: 0.1 + i * 0.02 }),
  );
  const defence = Array.from({ length: 20 }, (_, i) =>
    entry({ id: 200 + i, position: 'D', xg_per_60: 0.2 + i * 0.01, gar_per_60: 0.05 + i * 0.01 }),
  );
  const goalies = Array.from({ length: 20 }, (_, i) =>
    entry({ id: 300 + i, position: 'G', is_goalie: true, save_pct: 0.88 + i * 0.002, xg_per_60: null, gar_per_60: null }),
  );
  const pool = [...forwards, ...defence, ...goalies];
  const scales = buildQualityScales(pool);

  it('leads with xG/60 for a skater and names the cohort', () => {
    const s = qualitySignalFor(forwards[39], scales)!;
    expect(s.metric).toBe('xG/60');
    expect(s.shortMetric).toBe('xG');
    expect(s.cohortNoun).toBe('forwards');
    expect(s.percentile).toBe(100);
    expect(s.cohortSize).toBe(40);
  });

  it('places a defenceman against defencemen, never against forwards', () => {
    // The best defenceman here has a LOWER xG/60 than the worst forward. On a
    // pooled scale he would read bottom-of-the-league; on his own cohort he
    // is the best there is, which is the comparison a D slot actually makes.
    const s = qualitySignalFor(defence[19], scales)!;
    expect(s.cohortNoun).toBe('defencemen');
    expect(s.cohortSize).toBe(20);
    expect(s.percentile).toBe(100);
  });

  it('gives a goalie save rate, because the payload has no xG or GAR for him', () => {
    const s = qualitySignalFor(goalies[0], scales)!;
    expect(s.metric).toBe('SV%');
    expect(s.cohortNoun).toBe('goalies');
    expect(s.value).toBe('.880');
  });

  it('falls back to GAR/60 when the talent table has no xG row', () => {
    const s = qualitySignalFor(entry({ xg_per_60: null, gar_per_60: 0.4 }), scales)!;
    expect(s.metric).toBe('GAR/60');
    expect(s.shortMetric).toBe('GAR');
  });

  it('returns null when there is nothing honest to say', () => {
    expect(qualitySignalFor(entry({ xg_per_60: null, gar_per_60: null }), scales)).toBeNull();
    expect(qualitySignalFor(null, scales)).toBeNull();
    // An empty payload builds empty scales, and every placement is null.
    expect(qualitySignalFor(forwards[0], buildQualityScales([]))).toBeNull();
  });

  it('flags a player whose own sample is too thin to have set the scale', () => {
    const s = qualitySignalFor(entry({ gp: 3, xg_per_60: 1.5 }), scales)!;
    expect(s.lowSample).toBe(true);
    expect(qualitySignalLine(s)).toContain('thin sample');
  });
});

describe('qualitySignalLine', () => {
  it('always carries the cohort, because a percentile without one is not a fact', () => {
    const line = qualitySignalLine({
      metric: 'xG/60',
      shortMetric: 'xG',
      percentile: 88,
      cohortNoun: 'forwards',
      cohortSize: 600,
      lowSample: false,
      value: '0.92',
    });
    expect(line).toBe('xG/60 0.92 · 88th of forwards');
  });

  it('is null for a null signal, so the caller renders nothing', () => {
    expect(qualitySignalLine(null)).toBeNull();
  });
});

describe('ordinalPercentile', () => {
  it('handles the teens, which is where every naive implementation breaks', () => {
    expect(ordinalPercentile(11)).toBe('11th');
    expect(ordinalPercentile(12)).toBe('12th');
    expect(ordinalPercentile(13)).toBe('13th');
    expect(ordinalPercentile(21)).toBe('21st');
    expect(ordinalPercentile(2)).toBe('2nd');
    expect(ordinalPercentile(3)).toBe('3rd');
    expect(ordinalPercentile(100)).toBe('100th');
  });
});
