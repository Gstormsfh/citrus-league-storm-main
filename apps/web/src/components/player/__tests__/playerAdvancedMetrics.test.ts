/**
 * The card's numbers and its one sentence, tested without a DOM.
 *
 * The verdict line is prose derived from data, which is exactly the shape of
 * content `src/__tests__/noFabricatedContent.test.ts` exists to police. So
 * every branch of it is pinned here, along with the guards that stop a
 * coalesced zero from being printed as a measurement.
 */
import { describe, it, expect } from 'vitest';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import {
  COHORT_NOUN,
  COMPACT_METRIC_COUNT,
  GOALIE_METRICS,
  SKATER_METRICS,
  buildAdvancedCardData,
  deriveVerdict,
  findDashboardPlayer,
  finishing,
  fmt1,
  fmt2,
  fmtSavePct,
  fmtSigned1,
  metricsFor,
  normalizeSavePct,
  ordinal,
  playerDashboardHref,
  VERDICT_MAX_CHARS,
} from '../playerAdvancedMetrics';

// ── Fixtures ────────────────────────────────────────────────────────

let nextId = 1;
function entry(over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
  return {
    id: nextId++,
    name: 'Test Player',
    team: 'EDM',
    position: 'C',
    jersey: 97,
    headshot_url: null,
    is_goalie: false,
    roster_status: null,
    gp: 40,
    goals: 20,
    assists: 25,
    points: 45,
    sog: 150,
    hits: 20,
    blocks: 10,
    ppp: 12,
    plus_minus: 5,
    x_goals: 18,
    wins: 0,
    saves: 0,
    save_pct: 0,
    gaa: 0,
    shutouts: 0,
    xg_per_60: 1.0,
    xg_rating: null,
    gar_per_60: 0.5,
    gar_evo: 0.3,
    gar_evd: 0.1,
    gar_ppo: 0.08,
    gar_ppd: 0.0,
    gar_pen: 0.02,
    proj_gp: 40,
    proj_fantasy_points: 300,
    proj_fantasy_ppg: 7.5,
    proj_goals: 18,
    proj_assists: 24,
    proj_sog: 130,
    proj_ppp: 10,
    proj_blocks: 40,
    proj_hits: 30,
    proj_wins: null,
    proj_saves: null,
    proj_shutouts: null,
    ...over,
  };
}

function goalie(over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
  return entry({
    position: 'G',
    is_goalie: true,
    gp: 40,
    goals: 0,
    assists: 0,
    points: 0,
    x_goals: 0,
    xg_per_60: null,
    gar_per_60: null,
    gar_evo: null,
    gar_evd: null,
    gar_ppo: null,
    gar_ppd: null,
    gar_pen: null,
    wins: 24,
    saves: 1000,
    save_pct: 0.918,
    gaa: 2.4,
    shutouts: 3,
    proj_wins: 18,
    proj_saves: 800,
    proj_shutouts: 2,
    ...over,
  });
}

// ── Formatters ──────────────────────────────────────────────────────

describe('formatters — precision is a truth claim', () => {
  it('fmt2 prints modelled rates to two decimals and nothing to none', () => {
    expect(fmt2(1.239)).toBe('1.24');
    expect(fmt2(-0.1)).toBe('-0.10');
    expect(fmt2(null)).toBe('-');
    expect(fmt2(undefined)).toBe('-');
    expect(fmt2(NaN)).toBe('-');
  });

  it('fmt1 prints counting-derived numbers to one decimal', () => {
    expect(fmt1(18.44)).toBe('18.4');
    expect(fmt1(null)).toBe('-');
  });

  it('fmtSigned1 always carries a sign, and never prints minus zero', () => {
    expect(fmtSigned1(4.21)).toBe('+4.2');
    expect(fmtSigned1(-3.06)).toBe('-3.1');
    expect(fmtSigned1(0)).toBe('0.0');
    // Ties round toward +∞ (`Math.round(-30.5) === -30`), the same as the
    // `f1`/`f2` helpers `pages/Players.tsx` has always used. Pinned so the
    // two surfaces cannot drift by a tenth on the same player.
    expect(fmtSigned1(-3.05)).toBe('-3.0');
    // -0.02 rounds to -0, which would render "-0.0" and read as a deficit.
    expect(fmtSigned1(-0.02)).toBe('0.0');
    expect(fmtSigned1(null)).toBe('-');
  });

  it('normalizeSavePct accepts both units the column ships in', () => {
    expect(normalizeSavePct(0.918)).toBeCloseTo(0.918);
    expect(normalizeSavePct(918)).toBeCloseTo(0.918);
    // A zero is "no sample", not "stopped nothing".
    expect(normalizeSavePct(0)).toBeNull();
    expect(normalizeSavePct(null)).toBeNull();
  });

  it('fmtSavePct prints the hockey convention', () => {
    expect(fmtSavePct(0.918)).toBe('.918');
    expect(fmtSavePct(918)).toBe('.918');
    expect(fmtSavePct(0)).toBe('-');
  });

  it('ordinal handles the teens and every ones digit', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(100)).toBe('100th');
    expect(ordinal(0)).toBe('0th');
  });
});

// ── Finishing ───────────────────────────────────────────────────────

describe('finishing (G − xG)', () => {
  it('is goals minus expected goals', () => {
    expect(finishing(entry({ goals: 20, x_goals: 15.5 }))).toBeCloseTo(4.5);
  });

  it('is null when we have no xG for the player', () => {
    // PlayerDashboardService coalesces a missing stats row to x_goals: 0, so
    // this guard is the difference between "no data" and a card announcing
    // "+20.0 goals over expected" about a player nothing was modelled for.
    expect(finishing(entry({ goals: 20, x_goals: 0 }))).toBeNull();
    expect(finishing(entry({ goals: 20, x_goals: NaN }))).toBeNull();
  });

  it('is null for goalies', () => {
    expect(finishing(goalie())).toBeNull();
  });
});

// ── Metric sets ─────────────────────────────────────────────────────

describe('metric sets', () => {
  it('gives goalies their own set — never an empty skater card', () => {
    expect(metricsFor('G')).toBe(GOALIE_METRICS);
    expect(metricsFor('F')).toBe(SKATER_METRICS);
    expect(metricsFor('D')).toBe(SKATER_METRICS);
    // The skater set is entirely xG/GAR, none of which a goalie has.
    expect(GOALIE_METRICS.map((m) => m.key)).not.toContain('xg_per_60');
    expect(GOALIE_METRICS.map((m) => m.key)).not.toContain('gar_per_60');
  });

  it('carries the full GAR decomposition — the part Sleeper cannot print', () => {
    const keys = SKATER_METRICS.map((m) => m.key);
    expect(keys).toEqual([
      'xg_per_60',
      'gar_per_60',
      'gar_evo',
      'gar_evd',
      'gar_ppo',
      'gar_ppd',
      'gar_pen',
    ]);
  });

  it('marks GAA as lower-is-better so an elite goalie does not read as the floor', () => {
    expect(GOALIE_METRICS.find((m) => m.key === 'gaa')?.direction).toBe('lower');
    expect(GOALIE_METRICS.find((m) => m.key === 'save_pct')?.direction).toBe('higher');
  });

  it('keeps the compact card within its PWS-1 height budget', () => {
    expect(COMPACT_METRIC_COUNT).toBe(4);
    expect(SKATER_METRICS.length).toBeGreaterThan(COMPACT_METRIC_COUNT);
  });

  it('names cohorts in Canadian spelling, per the STYLEGUIDE', () => {
    expect(COHORT_NOUN.D).toBe('defencemen');
  });
});

// ── buildAdvancedCardData ───────────────────────────────────────────

describe('buildAdvancedCardData', () => {
  const league: DashboardIndexEntry[] = [
    entry({ position: 'C', xg_per_60: 0.6, gar_per_60: 0.1, goals: 10, x_goals: 12 }),
    entry({ position: 'C', xg_per_60: 0.8, gar_per_60: 0.3, goals: 14, x_goals: 13 }),
    entry({ position: 'LW', xg_per_60: 1.0, gar_per_60: 0.5, goals: 20, x_goals: 18 }),
    entry({ position: 'RW', xg_per_60: 1.2, gar_per_60: 0.7, goals: 26, x_goals: 20 }),
    entry({ position: 'D', xg_per_60: 0.3, gar_per_60: 0.2, goals: 5, x_goals: 4 }),
    entry({ position: 'D', xg_per_60: 0.4, gar_per_60: 0.4, goals: 8, x_goals: 6 }),
    goalie({ save_pct: 0.905 }),
    goalie({ save_pct: 0.918 }),
  ];

  it('places a forward against forwards only', () => {
    const subject = league[3]; // the RW, best xG among forwards
    const data = buildAdvancedCardData(subject, league);
    expect(data.cohort).toBe('F');
    expect(data.cohortSize).toBe(4);
    expect(data.metrics.find((m) => m.spec.key === 'xg_per_60')?.percentile).toBe(100);
  });

  it('places a defenceman against defencemen only', () => {
    const subject = league[5];
    const data = buildAdvancedCardData(subject, league);
    expect(data.cohort).toBe('D');
    expect(data.cohortSize).toBe(2);
    // 0.4 is the top of the two-man D cohort. Pooled with forwards it would
    // have been the bottom.
    expect(data.metrics.find((m) => m.spec.key === 'xg_per_60')?.percentile).toBe(100);
  });

  it('gives a goalie the goalie metric set and no skater rows', () => {
    const data = buildAdvancedCardData(league[7], league);
    expect(data.cohort).toBe('G');
    expect(data.metrics.map((m) => m.spec.key)).toEqual(GOALIE_METRICS.map((m) => m.key));
    expect(data.finishing).toBeNull();
    expect(data.metrics.find((m) => m.spec.key === 'save_pct')?.display).toBe('.918');
  });

  it('excludes un-modelled players from the finishing distribution', () => {
    const withGhost = [...league, entry({ position: 'C', goals: 30, x_goals: 0 })];
    const data = buildAdvancedCardData(league[3], withGhost);
    // The ghost's +30 must not have become the finishing ceiling.
    expect(data.finishing?.percentile).toBe(100);
  });

  it('flags a thin sample without refusing to place the player', () => {
    const callup = entry({ position: 'C', gp: 3, xg_per_60: 5, goals: 4, x_goals: 1 });
    const data = buildAdvancedCardData(callup, [...league, callup]);
    expect(data.lowSample).toBe(true);
    expect(data.metrics.find((m) => m.spec.key === 'xg_per_60')?.percentile).toBe(100);
    // …and he did not join the cohort that set the scale.
    expect(data.cohortSize).toBe(4);
  });

  it('returns null metrics rather than zeros when the payload has no advanced row', () => {
    const bare = entry({ xg_per_60: null, gar_per_60: null, gar_evo: null, gar_evd: null, gar_ppo: null, gar_ppd: null, gar_pen: null });
    const data = buildAdvancedCardData(bare, [...league, bare]);
    for (const m of data.metrics) {
      expect(m.value).toBeNull();
      expect(m.display).toBe('-');
      expect(m.percentile).toBeNull();
    }
  });
});

// ── The verdict line ────────────────────────────────────────────────

describe('deriveVerdict — derived, or nothing', () => {
  /** Build the resolved metrics the verdict reads, with explicit percentiles. */
  function metrics(spec: Record<string, { value: number | null; percentile: number | null }>) {
    return SKATER_METRICS.map((s) => ({
      spec: s,
      value: spec[s.key]?.value ?? null,
      display: s.format(spec[s.key]?.value ?? null),
      percentile: spec[s.key]?.percentile ?? null,
      cohortSize: 100,
      lowSample: false,
    }));
  }

  it('says nothing at all about a player under the sample floor', () => {
    // Ten games is where this module is willing to call a rate a trait. Below
    // it, every sentence would be describing noise in a confident voice.
    const m = metrics({ xg_per_60: { value: 2, percentile: 99 } });
    expect(deriveVerdict(entry({ gp: 9 }), 'F', m, 6, 99)).toBeNull();
    expect(deriveVerdict(entry({ gp: 10 }), 'F', m, 6, 99)).not.toBeNull();
  });

  it('calls out elite chances that are not being buried — the buy-low read', () => {
    const m = metrics({ xg_per_60: { value: 1.4, percentile: 88 } });
    const v = deriveVerdict(entry({ gp: 40 }), 'F', m, -3.1, 12)!;
    expect(v).toContain('Elite looks, cold stick');
    expect(v).toContain('88th-percentile');
    expect(v).toContain('3.1 goals under expected');
    // The source is named and the fantasy call is stated, per the
    // 2026-09-02 voice brief. Both are the point of the sentence.
    expect(v).toContain('Citrus xG');
    expect(v).toContain('Buy low');
    expect(v.length).toBeLessThanOrEqual(VERDICT_MAX_CHARS);
  });

  it('calls out elite chances that ARE being buried', () => {
    const m = metrics({ xg_per_60: { value: 1.4, percentile: 91 } });
    const v = deriveVerdict(entry({ gp: 40 }), 'F', m, 4.2, 96)!;
    expect(v).toContain('burying them');
    expect(v).toContain('+4.2 goals over expected');
  });

  it('calls out a hot stick on thin chances — the sell read', () => {
    const m = metrics({ xg_per_60: { value: 0.4, percentile: 22 } });
    const v = deriveVerdict(entry({ gp: 40 }), 'F', m, 5.0, 94)!;
    expect(v).toContain('Outrunning his chances');
    expect(v).toContain('22nd-percentile');
    expect(v).toContain('Sell high');
  });

  it('does not fire the finishing rules on a difference inside the noise', () => {
    const m = metrics({
      xg_per_60: { value: 1.4, percentile: 88 },
      gar_evo: { value: 0.42, percentile: 91 },
    });
    const v = deriveVerdict(entry({ gp: 40 }), 'F', m, 0.9, 60)!;
    expect(v).not.toContain('cold stick');
    expect(v).toContain('even-strength offence');
  });

  it('names the biggest positive GAR component as the driver', () => {
    const m = metrics({
      gar_evd: { value: 0.42, percentile: 91 },
      gar_evo: { value: 0.05, percentile: 40 },
    });
    const v = deriveVerdict(entry({ gp: 40 }), 'D', m, null, null)!;
    expect(v).toBe('Value is mostly even-strength defence. Citrus GAR has him at 0.42 there, 91st among defencemen.');
  });

  it('names the biggest negative component as the drag', () => {
    const m = metrics({
      gar_pen: { value: -0.31, percentile: 6 },
      gar_evo: { value: 0.05, percentile: 40 },
    });
    const v = deriveVerdict(entry({ gp: 40 }), 'F', m, null, null)!;
    expect(v).toBe('Penalties drawn is the drag. Citrus GAR has him at -0.31, 6th among forwards.');
  });

  it('falls back to total impact when no component stands out', () => {
    const m = metrics({
      gar_per_60: { value: 0.4, percentile: 72 },
      gar_evo: { value: 0.2, percentile: 50 },
    });
    const v = deriveVerdict(entry({ gp: 41 }), 'F', m, null, null)!;
    expect(v).toBe('Citrus GAR puts him 72nd-percentile for total impact among forwards over 41 games.');
  });

  it('returns null when nothing at all is known', () => {
    expect(deriveVerdict(entry({ gp: 40 }), 'F', metrics({}), null, null)).toBeNull();
  });

  it('gives goalies their own three readings', () => {
    const g = (percentile: number) => [
      {
        spec: GOALIE_METRICS[0],
        value: 0.918,
        display: '.918',
        percentile,
        cohortSize: 60,
        lowSample: false,
      },
    ];
    expect(deriveVerdict(goalie({ gp: 40 }), 'G', g(84), null, null)).toContain(
      'Stopping more than his share',
    );
    expect(deriveVerdict(goalie({ gp: 40 }), 'G', g(12), null, null)).toContain(
      'Leaking more than he should',
    );
    expect(deriveVerdict(goalie({ gp: 40 }), 'G', g(50), null, null)).toContain(
      '40 appearances',
    );
  });

  it('never mentions a metric it was not given', () => {
    // The guard against the classic template bug: a sentence with an
    // undefined slot in it. Every branch must be gated on its own inputs.
    for (const gp of [10, 25, 82]) {
      for (const fin of [null, -4, 0, 4]) {
        const v = deriveVerdict(entry({ gp }), 'F', metrics({}), fin, null);
        if (v) {
          expect(v).not.toMatch(/undefined|NaN|null|—/);
        }
      }
    }
  });

  it('stays inside the PWS-1 length budget across every branch', () => {
    const cases: Array<[Parameters<typeof deriveVerdict>[2], number | null, number | null]> = [
      [metrics({ xg_per_60: { value: 1.4, percentile: 88 } }), -3.1, 12],
      [metrics({ xg_per_60: { value: 1.4, percentile: 91 } }), 4.2, 96],
      [metrics({ xg_per_60: { value: 0.4, percentile: 22 } }), 5.0, 94],
      [metrics({ xg_per_60: { value: 0.4, percentile: 18 } }), -2.5, 8],
      [metrics({ gar_evd: { value: 0.42, percentile: 91 } }), null, null],
      [metrics({ gar_pen: { value: -0.31, percentile: 6 } }), null, null],
      [metrics({ gar_per_60: { value: 0.4, percentile: 72 } }), null, null],
    ];
    for (const [m, fin, finPct] of cases) {
      const v = deriveVerdict(entry({ gp: 41 }), 'F', m, fin, finPct);
      expect(v).toBeTruthy();
      expect(v!.length).toBeLessThanOrEqual(VERDICT_MAX_CHARS);
    }
  });
});

// ── Lookup ──────────────────────────────────────────────────────────

describe('findDashboardPlayer', () => {
  const index = [entry({ id: 8478402 }), entry({ id: 8477492 })];

  it('joins on the NHL player id, string or number', () => {
    expect(findDashboardPlayer(index, 8478402)?.id).toBe(8478402);
    expect(findDashboardPlayer(index, '8478402')?.id).toBe(8478402);
  });

  it('returns null rather than the wrong player for anything unusable', () => {
    expect(findDashboardPlayer(index, null)).toBeNull();
    expect(findDashboardPlayer(index, undefined)).toBeNull();
    expect(findDashboardPlayer(index, 'roster-row-uuid')).toBeNull();
    expect(findDashboardPlayer(index, 999)).toBeNull();
    expect(findDashboardPlayer([], 8478402)).toBeNull();
  });
});

describe('playerDashboardHref', () => {
  it('links to the real player dashboard route', () => {
    // Was `/players?player=<id>` until Component 6.5, because the route
    // PWS-1 names did not exist. `App.tsx` now registers
    // `/players/:playerId` OUTSIDE the import.meta.env.DEV gate, so the
    // card's "Full dashboard →" finally goes to the dashboard.
    expect(playerDashboardHref(8478402)).toBe('/players/8478402');
  });
});
