/**
 * The card's numbers and its one sentence, tested without a DOM.
 *
 * The verdict line is prose derived from data, which is exactly the shape of
 * content `src/__tests__/noFabricatedContent.test.ts` exists to police. So
 * every branch of it is pinned here, along with the guards that stop a
 * coalesced zero from being printed as a measurement.
 */
import { describe, it, expect } from 'vitest';
import type { DashboardIndexEntry, XgHistoryPoint } from '@citrus/shared';
import {
  COHORT_NOUN,
  COMPACT_METRIC_COUNT,
  GOALIE_METRICS,
  MIN_TREND_SEASONS,
  SKATER_METRICS,
  buildAdvancedCardData,
  deploymentParts,
  deriveVerdict,
  findDashboardPlayer,
  finishing,
  fmt1,
  fmt2,
  fmtInt,
  fmtSavePct,
  fmtSigned1,
  fmtSigned2,
  metricsFor,
  normalizeSavePct,
  ordinal,
  playerDashboardHref,
  xgTrend,
  finishingTrend,
  VERDICT_MAX_CHARS,
  type CardEntry,
} from '../playerAdvancedMetrics';

// ── Fixtures ────────────────────────────────────────────────────────

let nextId = 1;
function entry(over: Partial<CardEntry> = {}): CardEntry {
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
    pim: 0,
    shp: 0,
    toi_seconds: 0,
    losses: 0,
    ot_losses: 0,
    goals_against: 0,
    xg_per_60: 1.0,
    xg_rating: null,
    gar_per_60: 0.5,
    gar_evo: 0.3,
    gar_evd: 0.1,
    gar_ppo: 0.08,
    gar_ppd: 0.0,
    gar_pen: 0.02,
    // The 2026-09-03 server columns. Null by default: a fixture that
    // silently carried a GSAx or a VOPA would hide a guard that fails
    // open.
    toi_total_minutes: null,
    avg_toi_per_game: null,
    vopa_score: null,
    gsax_raw: null,
    gsax_regressed: null,
    gsax_shots_faced: null,
    gsax_xga: null,
    gsax_ga: null,
    as_of: null,
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

function goalie(over: Partial<CardEntry> = {}): CardEntry {
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

  it('fmtSigned2 prints VOPA to two decimals, signed, and never minus zero', () => {
    expect(fmtSigned2(3.114)).toBe('+3.11');
    expect(fmtSigned2(-0.456)).toBe('-0.46');
    expect(fmtSigned2(-0.001)).toBe('0.00');
    expect(fmtSigned2(null)).toBe('-');
  });

  it('fmtInt prints counts with a thousands separator and no decimals', () => {
    expect(fmtInt(1884.8)).toBe('1,885');
    expect(fmtInt(97)).toBe('97');
    expect(fmtInt(2515)).toBe('2,515');
    expect(fmtInt(null)).toBe('-');
    expect(fmtInt(NaN)).toBe('-');
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

  it('leads the goalie set with GSAx and reads the REGRESSED value', () => {
    // The regressed value is what the projection system consumes and what
    // the modal's own GSAx cell (PlayerService -> regressed_gsax) prints
    // directly under this card. One label, one number, one screen.
    expect(GOALIE_METRICS[0].key).toBe('gsax');
    expect(GOALIE_METRICS[0].label).toBe('GSAx');
    expect(GOALIE_METRICS[0].select(goalie({ gsax_raw: -7.6, gsax_regressed: -4.1 }))).toBe(-4.1);
    expect(GOALIE_METRICS[0].format(-4.1)).toBe('-4.1');
    // A goalie the join did not cover is "no data", never a zero.
    expect(GOALIE_METRICS[0].select(goalie())).toBeNull();
    // ...and it is inside the compact budget, so the embedded card shows it.
    expect(GOALIE_METRICS.slice(0, COMPACT_METRIC_COUNT).map((m) => m.key)).toContain('gsax');
    expect(GOALIE_METRICS.map((m) => m.key)).toEqual(['gsax', 'save_pct', 'gaa', 'wins', 'shutouts']);
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

  it('places a goalie\'s GSAx against goalies only, and an unjoined goalie reads no data', () => {
    const tendies = [
      goalie({ gsax_regressed: -4.1, gsax_shots_faced: 1421 }),
      goalie({ gsax_regressed: 2.3, gsax_shots_faced: 1500 }),
      goalie({ gsax_regressed: 8.2, gsax_shots_faced: 1204 }),
    ];
    // A skater with a (nonsense) GSAx must not join the goalie scale.
    const stray = entry({ position: 'C', gsax_regressed: 99 });
    const pool = [...league, ...tendies, stray];

    const best = buildAdvancedCardData(tendies[2], pool);
    const g = best.metrics.find((m) => m.spec.key === 'gsax')!;
    expect(best.cohort).toBe('G');
    expect(g.display).toBe('+8.2');
    expect(g.percentile).toBe(100);
    // Three goalies with GSAx set the scale, not the two league goalies
    // without a row and not the stray skater.
    expect(g.cohortSize).toBe(3);

    const none = buildAdvancedCardData(league[7], pool);
    const g2 = none.metrics.find((m) => m.spec.key === 'gsax')!;
    expect(g2.value).toBeNull();
    expect(g2.display).toBe('-');
    expect(g2.percentile).toBeNull();
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
    // No brand in the prose (2026-09-05, Garrett: "don't mention Citrus at
    // all; just mention stats"); the fantasy call is stated.
    expect(v).not.toContain('Citrus');
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
    expect(v).toBe('Value is mostly even-strength defence: 0.42 GAR/60 there, 91st among defencemen.');
  });

  it('names the biggest negative component as the drag', () => {
    const m = metrics({
      gar_pen: { value: -0.31, percentile: 6 },
      gar_evo: { value: 0.05, percentile: 40 },
    });
    const v = deriveVerdict(entry({ gp: 40 }), 'F', m, null, null)!;
    expect(v).toBe('Penalties drawn is the drag: -0.31 GAR/60, 6th among forwards.');
  });

  it('falls back to total impact when no component stands out', () => {
    const m = metrics({
      gar_per_60: { value: 0.4, percentile: 72 },
      gar_evo: { value: 0.2, percentile: 50 },
    });
    const v = deriveVerdict(entry({ gp: 41 }), 'F', m, null, null)!;
    expect(v).toBe('72nd-percentile GAR/60 for total impact among forwards over 41 games.');
  });

  it('returns null when nothing at all is known', () => {
    expect(deriveVerdict(entry({ gp: 40 }), 'F', metrics({}), null, null)).toBeNull();
  });

  const SAVE_PCT_SPEC = GOALIE_METRICS.find((m) => m.key === 'save_pct')!;
  const GSAX_SPEC = GOALIE_METRICS.find((m) => m.key === 'gsax')!;

  it('gives goalies their own three save-rate readings when there is no GSAx', () => {
    const g = (percentile: number) => [
      {
        spec: SAVE_PCT_SPEC,
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

  it('leads a goalie with GSAx, names the source, the sample and the cohort', () => {
    const g = (value: number, percentile: number) => [
      { spec: GSAX_SPEC, value, display: fmtSigned1(value), percentile, cohortSize: 60, lowSample: false },
      { spec: SAVE_PCT_SPEC, value: 0.918, display: '.918', percentile: 50, cohortSize: 60, lowSample: false },
    ];
    const tendy = goalie({ gp: 40, gsax_regressed: 8.2, gsax_shots_faced: 1204 });

    const hi = deriveVerdict(tendy, 'G', g(8.2, 88), null, null)!;
    expect(hi).toBe(
      'Stopping more than his share. Stopping 8.2 goals more than expected on 1,204 primary shots, 88th among goalies.',
    );

    const lo = deriveVerdict(goalie({ gp: 40, gsax_shots_faced: 640 }), 'G', g(-4.2, 12), null, null)!;
    expect(lo).toBe(
      'Leaking more than he should. Conceding 4.2 goals more than expected on 640 primary shots, 12th among goalies.',
    );

    const mid = deriveVerdict(goalie({ gp: 40, gsax_shots_faced: 900 }), 'G', g(1.2, 54), null, null)!;
    expect(mid).toBe('Stopping 1.2 goals more than expected on 900 primary shots, 54th among goalies.');

    const level = deriveVerdict(goalie({ gp: 40, gsax_shots_faced: 900 }), 'G', g(0.02, 50), null, null)!;
    expect(level).toMatch(/level with expected/i);

    // GSAx outranks the save rate, so none of these are the save-rate line.
    for (const v of [hi, lo, mid, level]) expect(v).not.toContain('save rate');
  });

  it('falls back to the save rate when the GSAx join is empty', () => {
    // The bullet may carry a value while the row has no shots-faced count
    // (an old payload, a partial row). No denominator, no GSAx sentence.
    const m = [
      { spec: GSAX_SPEC, value: 8.2, display: '+8.2', percentile: 88, cohortSize: 60, lowSample: false },
      { spec: SAVE_PCT_SPEC, value: 0.918, display: '.918', percentile: 84, cohortSize: 60, lowSample: false },
    ];
    const v = deriveVerdict(goalie({ gp: 40 }), 'G', m, null, null)!;
    expect(v).toContain('.918 save rate');
    expect(v).not.toContain('GSAx');
  });

  it('keeps the goalie GSAx line inside the budget at its worst-case numbers', () => {
    // Four-digit shots, two-digit GSAx, three-digit percentile: the longest
    // sentence this branch can build. 133 characters as written.
    const m = [
      { spec: GSAX_SPEC, value: 12.3, display: '+12.3', percentile: 100, cohortSize: 60, lowSample: false },
    ];
    const v = deriveVerdict(goalie({ gp: 60, gsax_shots_faced: 2515 }), 'G', m, null, null)!;
    expect(v).toContain('2,515 primary shots');
    expect(v.length).toBeLessThanOrEqual(VERDICT_MAX_CHARS);
    const neg = deriveVerdict(
      goalie({ gp: 60, gsax_shots_faced: 2515 }),
      'G',
      [{ spec: GSAX_SPEC, value: -12.3, display: '-12.3', percentile: 1, cohortSize: 60, lowSample: false }],
      null,
      null,
    )!;
    expect(neg.length).toBeLessThanOrEqual(VERDICT_MAX_CHARS);
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

// ── The career trend ────────────────────────────────────────────────

describe('xgTrend', () => {
  const point = (season: number, xg: number, over: Partial<XgHistoryPoint> = {}): XgHistoryPoint => ({
    season,
    game_type: 'regular',
    shots: 200,
    sog: 120,
    goals: 20,
    xg,
    finishing: 20 - xg,
    teams: 1,
    ...over,
  });

  it('draws nothing below two seasons: a one-point line is a made-up line', () => {
    expect(MIN_TREND_SEASONS).toBe(2);
    expect(xgTrend(null)).toBeNull();
    expect(xgTrend(undefined)).toBeNull();
    expect(xgTrend([])).toBeNull();
    expect(xgTrend([point(2025, 40.47)])).toBeNull();
    // A second season that is a PLAYOFF row does not count toward the two.
    expect(xgTrend([point(2025, 40.47), point(2024, 3.1, { game_type: 'playoff' })])).toBeNull();
  });

  it('plots one point per season, ascending, labelled the way the season is spoken', () => {
    const t = xgTrend([point(2025, 40.47), point(2023, 31.9), point(2024, 38.12)])!;
    expect(t.points.map((p) => p.x)).toEqual([2023, 2024, 2025]);
    expect(t.points.map((p) => p.y)).toEqual([31.9, 38.12, 40.47]);
    expect(t.points.map((p) => p.gameDate)).toEqual(['2023-24', '2024-25', '2025-26']);
    expect(t.endpoint).toBe('40.47');
    expect(t.firstSeason).toBe(2023);
    expect(t.lastSeason).toBe(2025);
    expect(t.seasons).toBe(3);
  });

  it('sums a season it is handed twice rather than drawing two points for one year', () => {
    // The server merges a traded player's team rows; this is the belt to
    // that suspender, so no payload shape can produce a doubled x.
    const t = xgTrend([point(2024, 10.25, { teams: 1 }), point(2024, 5.5, { teams: 1 }), point(2025, 20)])!;
    expect(t.points).toHaveLength(2);
    expect(t.points[0]).toMatchObject({ x: 2024, y: 15.75 });
  });

  it('filters to the requested game type', () => {
    const rows = [point(2024, 30), point(2025, 33), point(2024, 4, { game_type: 'playoff' }), point(2025, 6, { game_type: 'playoff' })];
    expect(xgTrend(rows)!.points.map((p) => p.y)).toEqual([30, 33]);
    expect(xgTrend(rows, 'playoff')!.points.map((p) => p.y)).toEqual([4, 6]);
  });
});

// ── Deployment ──────────────────────────────────────────────────────

describe('deploymentParts', () => {
  it('prints games and the minutes the per-60 rates are divided by', () => {
    expect(deploymentParts(entry({ gp: 82, toi_total_minutes: 1884.8 }))).toEqual(['82 GP', '1,885 min']);
  });

  it('prints only what the payload carries: no row, no number, no zero', () => {
    // Every 2025 production row has NULL vopa_score and avg_toi_per_game
    // (0 of 940 non-null on 2026-09-03), so this is the line the card
    // prints today for every player with a GAR row.
    expect(deploymentParts(entry({ gp: 40, toi_total_minutes: null }))).toEqual(['40 GP']);
    expect(deploymentParts(entry({ gp: 0, toi_total_minutes: null }))).toEqual([]);
    expect(deploymentParts(entry({ gp: 40, toi_total_minutes: 0 }))).toEqual(['40 GP']);
    // An old payload with none of the new columns at all.
    const old = { ...entry({ gp: 40 }) } as Record<string, unknown>;
    delete old.toi_total_minutes;
    delete old.avg_toi_per_game;
    delete old.vopa_score;
    expect(deploymentParts(old as unknown as CardEntry)).toEqual(['40 GP']);
  });

  it('adds minutes a night and VOPA the day the pipeline fills them', () => {
    expect(
      deploymentParts(entry({ gp: 82, toi_total_minutes: 1884.8, avg_toi_per_game: 22.98, vopa_score: 3.114 })),
    ).toEqual(['82 GP', '1,885 min', '23.0 min/GP', 'VOPA +3.11']);
    expect(deploymentParts(entry({ gp: 12, vopa_score: -0.42 }))).toEqual(['12 GP', 'VOPA -0.42']);
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

describe('finishingTrend (2026-09-05)', () => {
  const pt = (season: number, goals: number, xg: number, game_type: 'regular' | 'playoff' = 'regular') =>
    ({ season, game_type, shots: 0, sog: 0, goals, xg, finishing: goals - xg, teams: 1 });

  it('plots goals over expected per regular season and reads the newest season both ways', () => {
    const t = finishingTrend([pt(2024, 20, 24), pt(2025, 39, 31), pt(2025, 3, 2, 'playoff')]);
    expect(t).not.toBeNull();
    expect(t!.points.map((p) => p.y)).toEqual([-4, 8]);
    expect(t!.endpoint).toBe('+8.0');
    expect(t!.pctOfExpected).toBe('126%');
    expect(t!.seasons).toBe(2);
  });

  it('merges a traded season into one point', () => {
    const t = finishingTrend([pt(2024, 10, 12), pt(2025, 10, 8), pt(2025, 5, 4)]);
    expect(t!.points.map((p) => p.y)).toEqual([-2, 3]);
    expect(t!.pctOfExpected).toBe('125%');
  });

  it('refuses one season', () => {
    expect(finishingTrend([pt(2025, 39, 31)])).toBeNull();
    expect(finishingTrend(null)).toBeNull();
  });
});
