import { describe, it, expect } from 'vitest';
import type { DashboardShot } from '@/hooks/usePlayerDashboard';
import {
  GOALIE_METRICS,
  SKATER_METRICS,
  VERDICT_MAX_CHARS,
  deriveVerdict,
  fmtSigned1,
  type CardEntry,
} from '../playerAdvancedMetrics';
import {
  GOAL_LINE_X,
  deriveGoalieVerdict,
  deriveShotVerdict,
  summariseShots,
} from '../playerDashboardData';

/**
 * REGISTER CONFORMANCE FOR THE DERIVED WRITEUPS (2026-09-02 voice pass).
 *
 * Three functions in this directory write English that ships on a player
 * card: `deriveVerdict` (the one-line card verdict), `deriveShotVerdict` and
 * `deriveGoalieVerdict` (the floating hero verdicts on the dashboard). Their
 * neighbouring suites pin WHAT each branch says. This file pins HOW all of
 * them say it, across every branch at once, against the founder's copy brief:
 *
 *   * no em dash;
 *   * none of the stock AI phrasebook;
 *   * the Citrus source named in the sentence, because a number a reader
 *     cannot attribute is a number they cannot check;
 *   * no projection-accuracy claim, ever. There is no benchmark in this repo
 *     comparing Citrus projections to anyone else's, and the founder's
 *     standing instruction is no accuracy claims without data.
 *
 * The same rules run over the whole UI in
 * `src/__tests__/aiVoiceGuard.test.ts`, which scans string LITERALS. That
 * guard structurally cannot see these sentences: they are assembled at
 * runtime from template fragments plus numbers, so the finished sentence
 * exists only when the function runs. This file is the half of the coverage
 * a static scan cannot reach.
 */

const EM_DASH = /—/;

const BANNED_PHRASES: Array<[string, RegExp]> = [
  ["it's not just X, it's Y", /\b(?:it'?s|this is|that'?s|we'?re)\s+not\s+(?:just|only)\b/i],
  ["let's dive in", /\b(?:let'?s\s+)?dive\s+in\b/i],
  ["in today's fast-paced world", /\bfast[- ]paced\b/i],
  ['game-changer', /\bgame[-\s]?chang(?:er|ers|ing)\b/i],
  ['unlock', /\bunlock(?:s|ed|ing)?\b/i],
  ['leverage (as a verb)', /\bleverag(?:e|es|ed|ing)\b/i],
  ['delve', /\bdelv(?:e|es|ed|ing)\b/i],
  ['tapestry', /\btapestry\b/i],
  ['landscape (as metaphor)', /\blandscape\b/i],
  ['testament to', /\btestament\s+to\b/i],
  ['navigate the complexities', /\bnavigat\w*\s+the\s+complexit/i],
];

const ACCURACY_CLAIMS: Array<[string, RegExp]> = [
  ['most/wildly accurate', /\b(?:most|wildly|insanely|scary|freakishly)\s+accurate\b/i],
  ['a numeric accuracy figure', /\d\s*%\s*accura|accuracy\s*[:=]?\s*\d/i],
  ['beats a named competitor', /\bbeat(?:s|ing)?\s+(?:espn|yahoo|sleeper|fantrax)\b/i],
];

/**
 * The brand, in any of the forms the copy used to ship it in. Reversed
 * 2026-09-05: a writeup quotes the number and never the brand.
 */
const CITRUS_SOURCE = /Citrus (?:xG|GAR|GSAx|ROS projection)|on the Citrus board|\bCitrus\b/;

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
    gp: 41,
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
    xg_per_60: 1,
    xg_rating: null,
    gar_per_60: 0.5,
    gar_evo: 0.2,
    gar_evd: 0.1,
    gar_ppo: 0.1,
    gar_ppd: 0.05,
    gar_pen: 0.05,
    ...over,
  } as CardEntry;
}

function skaterMetrics(spec: Record<string, { value: number | null; percentile: number | null }>) {
  return SKATER_METRICS.map((s) => ({
    spec: s,
    value: spec[s.key]?.value ?? null,
    display: s.format(spec[s.key]?.value ?? null),
    percentile: spec[s.key]?.percentile ?? null,
    cohortSize: 100,
    lowSample: false,
  }));
}

function goalieMetrics(percentile: number) {
  return [
    {
      spec: GOALIE_METRICS.find((m) => m.key === 'save_pct')!,
      value: 0.918,
      display: '.918',
      percentile,
      cohortSize: 60,
      lowSample: false,
    },
  ];
}

/** The GSAx row the goalie set now leads with (2026-09-03). */
function gsaxMetrics(value: number, percentile: number) {
  return [
    {
      spec: GOALIE_METRICS.find((m) => m.key === 'gsax')!,
      value,
      display: fmtSigned1(value),
      percentile,
      cohortSize: 60,
      lowSample: false,
    },
    ...goalieMetrics(50),
  ];
}

function shot(over: Partial<DashboardShot> = {}): DashboardShot {
  const x = over.x ?? 74;
  const y = over.y ?? 0;
  return {
    game_id: 2025020001,
    event_id: 1,
    game_date: '2025-10-08',
    x,
    y,
    distance: Math.hypot(GOAL_LINE_X - x, y),
    angle: 0,
    xg: 0.25,
    is_goal: false,
    ...over,
  } as DashboardShot;
}

/**
 * Every branch of every generator, as a flat list of finished sentences.
 *
 * The skater cases walk the finishing decision table (elite/thin looks
 * crossed with hot/cold stick), the GAR driver rules in both directions, and
 * both fallbacks. The goalie cases walk all three save-rate readings and
 * the three GSAx readings that outrank them when the join is present. The
 * dashboard cases walk the three finishing phrases and both GSAx signs.
 */
function everyVerdict(): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const push = (label: string, text: string | null) => {
    if (text) out.push({ label, text });
  };

  push('elite looks / cold stick', deriveVerdict(entry(), 'F', skaterMetrics({ xg_per_60: { value: 1.4, percentile: 88 } }), -3.1, 12));
  push('elite looks / hot stick', deriveVerdict(entry(), 'F', skaterMetrics({ xg_per_60: { value: 1.4, percentile: 91 } }), 4.2, 96));
  push('thin looks / hot stick', deriveVerdict(entry(), 'F', skaterMetrics({ xg_per_60: { value: 0.4, percentile: 22 } }), 5, 94));
  push('thin looks / cold stick', deriveVerdict(entry(), 'F', skaterMetrics({ xg_per_60: { value: 0.4, percentile: 18 } }), -2.5, 8));
  for (const key of ['gar_evo', 'gar_evd', 'gar_ppo', 'gar_ppd', 'gar_pen']) {
    push(`driver ${key}`, deriveVerdict(entry(), 'D', skaterMetrics({ [key]: { value: 0.42, percentile: 91 } }), null, null));
    push(`drag ${key}`, deriveVerdict(entry(), 'F', skaterMetrics({ [key]: { value: -0.31, percentile: 6 } }), null, null));
  }
  push('total-impact fallback', deriveVerdict(entry(), 'F', skaterMetrics({ gar_per_60: { value: 0.4, percentile: 72 } }), null, null));
  push('finishing fallback', deriveVerdict(entry(), 'F', skaterMetrics({}), 2, 60));
  for (const p of [84, 50, 12]) {
    push(`goalie save rate p${p}`, deriveVerdict(entry({ is_goalie: true, gp: 40 }), 'G', goalieMetrics(p), null, null));
  }
  for (const [value, p] of [[8.2, 84], [1.2, 50], [-4.2, 12]] as Array<[number, number]>) {
    push(
      // Not prefixed `goalie GSAx`: that prefix is the DASHBOARD verdict's,
      // which the length test below exempts. This one is a card line and
      // must stay inside the tile budget.
      `card GSAx p${p}`,
      deriveVerdict(entry({ is_goalie: true, gp: 40, gsax_regressed: value, gsax_shots_faced: 1204 }), 'G', gsaxMetrics(value, p), null, null),
    );
  }

  const season = Array.from({ length: 60 }, () => shot({ x: 77, y: 1 }));
  push('shot verdict / ahead', deriveShotVerdict(summariseShots(season), 7.5));
  push('shot verdict / behind', deriveShotVerdict(summariseShots(season), -7.5));
  push('shot verdict / level', deriveShotVerdict(summariseShots(season), 0));
  push('shot verdict / no finishing', deriveShotVerdict(summariseShots(season), null));
  push('goalie GSAx positive', deriveGoalieVerdict({ shots_faced: 1204, xga: 88.4, ga: 78, raw_gsax: 10.4, regressed_gsax: 8.2 }));
  push('goalie GSAx negative', deriveGoalieVerdict({ shots_faced: 640, xga: 52.1, ga: 60, raw_gsax: -7.9, regressed_gsax: -4.2 }));

  return out;
}

// ── The rules ────────────────────────────────────────────────────────

describe('derived writeups: register conformance', () => {
  const CASES = everyVerdict();

  it('covers every branch of all three generators', () => {
    // 28 sentences (25 until the goalie GSAx branch landed on 2026-09-03).
    // A refactor that quietly collapses a branch would leave this file
    // testing fewer sentences than it claims to.
    expect(CASES.length).toBe(28);
    expect(new Set(CASES.map((c) => c.text)).size).toBe(CASES.length);
  });

  it.each(CASES.map((c) => [c.label, c.text]))('%s: no em dash', (_label, text) => {
    expect(EM_DASH.test(text as string)).toBe(false);
  });

  it.each(CASES.map((c) => [c.label, c.text]))('%s: no banned phrase', (_label, text) => {
    for (const [name, re] of BANNED_PHRASES) {
      expect(re.test(text as string), `"${name}" in: ${text}`).toBe(false);
    }
  });

  it.each(CASES.map((c) => [c.label, c.text]))('%s: no accuracy claim', (_label, text) => {
    for (const [name, re] of ACCURACY_CLAIMS) {
      expect(re.test(text as string), `"${name}" in: ${text}`).toBe(false);
    }
  });

  it.each(CASES.map((c) => [c.label, c.text]))('%s: never names the brand', (_label, text) => {
    expect(CITRUS_SOURCE.test(text as string), `brand named in: ${text}`).toBe(false);
  });

  it.each(CASES.map((c) => [c.label, c.text]))('%s: no template hole', (_label, text) => {
    expect(text as string).not.toMatch(/undefined|NaN|Infinity|null/);
  });

  it('the card verdict stays inside the tile budget', () => {
    // Only the compact card verdict is length-capped. The two dashboard hero
    // verdicts render in a tile that scrolls with the page, so they carry no
    // ceiling and deliberately say more.
    for (const c of CASES.filter((x) => !x.label.startsWith('shot verdict') && !x.label.startsWith('goalie GSAx'))) {
      expect(c.text.length, `${c.label} is ${c.text.length} chars: ${c.text}`).toBeLessThanOrEqual(
        VERDICT_MAX_CHARS,
      );
    }
  });

  it('the rules bite: a planted sentence in the old register fails each one', () => {
    // Proof the regexes do work. Without this, a typo in one of them would
    // leave a permanently-green test guarding nothing.
    const old = 'Elite looks, cold stick — 88th-percentile xG/60 and 3.1 goals under expected.';
    expect(EM_DASH.test(old)).toBe(true);
    expect(CITRUS_SOURCE.test('Citrus xG has him 3.1 goals under expected.')).toBe(true);
    expect(CITRUS_SOURCE.test(old)).toBe(false);
    expect(BANNED_PHRASES.find(([, re]) => re.test('Unlock the upside'))?.[0]).toBe('unlock');
    expect(ACCURACY_CLAIMS.find(([, re]) => re.test('the most accurate model'))?.[0]).toBe(
      'most/wildly accurate',
    );
  });
});
