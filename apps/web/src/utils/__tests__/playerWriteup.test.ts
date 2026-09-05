// Player writeup contract (2026-08-25) — roster audit: "we need writeups for
// all players."
//
// The whole reason this generator is arithmetic rather than a language model
// is that a scouting line sits inches above the stat line it describes, and
// the two must never disagree. These tests are that guarantee. The most
// important cases here are the NEGATIVE ones: small samples must not be
// extrapolated, and missing data must not be narrated.

import { describe, it, expect } from 'vitest';
import {
  generatePlayerWriteup,
  parseToiToMinutes,
  normalizeSavePct,
  careerSentences,
  shortTrophy,
} from '../playerWriteup';
import type { PlayerWriteup } from '../playerWriteup';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import aiVoice from '@citrus/shared/constants/aiVoice.json';

const skater = (overrides: Partial<HockeyPlayer> = {}, stats: Record<string, unknown> = {}): HockeyPlayer =>
  ({
    id: 1,
    name: 'Connor McTest',
    position: 'C',
    number: 97,
    starter: true,
    team: 'Edmonton Oilers',
    teamAbbreviation: 'EDM',
    stats: {
      gamesPlayed: 70,
      goals: 40,
      assists: 60,
      points: 100,
      shots: 250,
      hits: 30,
      blockedShots: 20,
      powerPlayPoints: 25,
      toi: '21:30',
      ...stats,
    },
    ...overrides,
  }) as HockeyPlayer;

describe('parseToiToMinutes', () => {
  it('parses MM:SS into fractional minutes', () => {
    expect(parseToiToMinutes('21:30')).toBeCloseTo(21.5, 3);
    expect(parseToiToMinutes('9:06')).toBeCloseTo(9.1, 3);
  });

  it('returns null rather than NaN for junk, so callers can omit the sentence', () => {
    expect(parseToiToMinutes(undefined)).toBeNull();
    expect(parseToiToMinutes('')).toBeNull();
    expect(parseToiToMinutes('not-a-time')).toBeNull();
    expect(parseToiToMinutes('21:75')).toBeNull(); // 75 seconds is not a time
  });
});

describe('normalizeSavePct', () => {
  it('accepts both .915 and 91.5 and lands on the decimal form', () => {
    expect(normalizeSavePct(0.915)).toBeCloseTo(0.915, 4);
    expect(normalizeSavePct(91.5)).toBeCloseTo(0.915, 4);
  });

  it('rejects missing/zero values instead of reporting a .000 goalie', () => {
    expect(normalizeSavePct(undefined)).toBeNull();
    expect(normalizeSavePct(0)).toBeNull();
  });
});

describe('generatePlayerWriteup — small samples are never extrapolated', () => {
  it('refuses to characterise a skater under the games threshold', () => {
    const w = generatePlayerWriteup(skater({}, { gamesPlayed: 2, points: 3, goals: 2, assists: 1 }));
    expect(w.hasEnoughData).toBe(false);
    // 3 points in 2 games is 1.5 PPG — must NOT read as elite.
    expect(w.headline).not.toMatch(/star|elite|top-line/i);
    expect(w.summary).toMatch(/too small a sample/i);
  });

  it('handles a player who has not played at all without dividing by zero', () => {
    const w = generatePlayerWriteup(skater({}, { gamesPlayed: 0, points: 0, goals: 0, assists: 0 }));
    expect(w.hasEnoughData).toBe(false);
    expect(w.summary).toMatch(/hasn't played/i);
    expect(w.summary).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('never emits NaN/undefined for a completely empty stat object', () => {
    const w = generatePlayerWriteup({
      id: 9, name: 'Empty Guy', position: 'LW', number: 1, starter: false, team: 'X', stats: {},
    } as HockeyPlayer);
    expect(w.summary).not.toMatch(/NaN|Infinity|undefined|null/);
    expect(w.summary.length).toBeGreaterThan(0);
    expect(w.headline.length).toBeGreaterThan(0);
  });

  it('always returns usable prose even for a null player', () => {
    const w = generatePlayerWriteup(null);
    expect(w.summary.length).toBeGreaterThan(0);
    expect(w.hasEnoughData).toBe(false);
  });
});

describe('generatePlayerWriteup — skater banding uses rates, not totals', () => {
  it('calls a 1.43 PPG forward a star', () => {
    const w = generatePlayerWriteup(skater());
    expect(w.headline).toBe('Star forward');
    expect(w.hasEnoughData).toBe(true);
    expect(w.summary).toContain('100 points');
    expect(w.summary).toContain('1.43 per game');
  });

  it('ranks a high-rate part-season player above a low-rate full-season one', () => {
    const parttime = generatePlayerWriteup(
      skater({}, { gamesPlayed: 25, points: 30, goals: 12, assists: 18 }),
    );
    const fulltime = generatePlayerWriteup(
      skater({}, { gamesPlayed: 82, points: 33, goals: 15, assists: 18 }),
    );
    // 1.20 PPG on 30 points vs 0.40 PPG on 33 points — totals would invert this.
    expect(parttime.headline).toBe('Star forward');
    expect(fulltime.headline).toBe('Depth forward');
  });

  it('judges defencemen on their own curve, not the forward curve', () => {
    const statLine = { gamesPlayed: 70, points: 45, goals: 10, assists: 35, toi: '23:00' };
    const d = generatePlayerWriteup(skater({ position: 'D' }, statLine));
    const f = generatePlayerWriteup(skater({ position: 'C' }, statLine));
    // Same 0.64 PPG: a top-pair number for a D, middle-six for a forward.
    expect(d.headline).toBe('Top-pair contributor');
    expect(f.headline).toBe('Middle-six contributor');
  });

  it('flags heavy usage and shot volume as upside tags', () => {
    const w = generatePlayerWriteup(skater());
    const labels = w.tags.map((t) => t.label);
    expect(labels).toContain('Heavy minutes');
    expect(labels).toContain('Shot volume');
  });

  it('flags power-play dependence as a caution, with the real percentage', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 70, points: 50, goals: 20, assists: 30, powerPlayPoints: 25 }),
    );
    expect(w.tags.find((t) => t.label === 'PP-dependent')?.tone).toBe('caution');
    // Lives in the Analysis paragraph: it's a call to action, not a stat.
    expect(w.analysis).toContain('50% of his points');
  });

  it('flags thin ice time as a caution rather than staying silent', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 40, points: 8, goals: 3, assists: 5, toi: '9:30', shots: 20 }),
    );
    expect(w.tags.find((t) => t.label === 'Limited ice time')?.tone).toBe('caution');
    expect(w.headline).toBe('Bottom-six role player');
  });

  it('credits hits/blocks value for players whose case is peripherals', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 70, points: 20, goals: 8, assists: 12, hits: 200, blockedShots: 90, toi: '15:00' }),
    );
    expect(w.tags.map((t) => t.label)).toContain('Peripheral value');
  });
});

describe('generatePlayerWriteup — goalies', () => {
  const goalie = (stats: Record<string, unknown>): HockeyPlayer =>
    ({
      id: 30, name: 'Stuart Skinnertest', position: 'G', number: 74, starter: true, team: 'Edmonton Oilers',
      stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15, shutouts: 4, ...stats },
    }) as HockeyPlayer;

  it('reads an elite save rate as a starter, in hockey notation', () => {
    const w = generatePlayerWriteup(goalie({}));
    expect(w.headline).toBe('Starting-calibre goalie');
    expect(w.summary).toContain('.925'); // not "0.925", not "92.5"
    expect(w.summary).toContain('2.35 goals-against average');
  });

  it('normalises a percentage-form save pct rather than printing nonsense', () => {
    const w = generatePlayerWriteup(goalie({ savePct: 92.5 }));
    expect(w.summary).toContain('.925');
  });

  it('calls out a sub-.900 goalie honestly', () => {
    const w = generatePlayerWriteup(goalie({ savePct: 0.881, gaa: 3.61 }));
    expect(w.headline).toBe('Struggling in net');
    expect(w.tags.find((t) => t.tone === 'caution')).toBeTruthy();
  });

  it('reports goals saved above expected in both directions', () => {
    const good = generatePlayerWriteup(goalie({ goalsSavedAboveExpected: 12.4 }));
    expect(good.summary).toMatch(/He has stopped 12\.4 goals more/);
    const bad = generatePlayerWriteup(goalie({ goalsSavedAboveExpected: -8.2 }));
    expect(bad.summary).toMatch(/He has conceded 8\.2 goals more/);
    expect(bad.tags.map((t) => t.label)).toContain('Underperforming xG');
  });

  it('will not characterise a goalie with two appearances', () => {
    const w = generatePlayerWriteup(goalie({ gamesPlayed: 2 }));
    expect(w.hasEnoughData).toBe(false);
    expect(w.headline).toMatch(/not enough/i);
  });
});

describe('generatePlayerWriteup — availability outranks production', () => {
  it('leads with IR status for a star, because tonight he cannot play', () => {
    const w = generatePlayerWriteup(skater({ status: 'IR' }));
    expect(w.summary).toMatch(/^Currently on injured reserve\./);
    expect(w.tags[0]).toEqual({ label: 'Injured reserve', tone: 'caution' });
    // The underlying scouting read survives beneath the status.
    expect(w.headline).toBe('Star forward');
  });

  it('surfaces a game-time decision before the stat line', () => {
    const w = generatePlayerWriteup(skater({ status: 'GTD' }));
    expect(w.summary).toMatch(/game-time decision/i);
    expect(w.tags[0].tone).toBe('caution');
  });

  it('surfaces a suspension', () => {
    const w = generatePlayerWriteup(skater({ status: 'SUSP' }));
    expect(w.summary).toMatch(/suspended/i);
  });

  it('adds nothing for a healthy player', () => {
    const w = generatePlayerWriteup(skater({ status: null }));
    expect(w.summary).not.toMatch(/injured|suspended|game-time/i);
  });
});

describe('cardNote — the one-liner roster cards render', () => {
  it('carries the RATE, which the card stat grid (GP/G/A/SOG totals) never shows', () => {
    const w = generatePlayerWriteup(skater());
    expect(w.cardNote).toBe('Star forward · 1.43 P/GP');
    expect(w.cardTone).toBe('positive');
  });

  it('uses save percentage for goalies, in hockey notation', () => {
    const w = generatePlayerWriteup({
      id: 30, name: 'Test Goalie', position: 'G', number: 1, starter: true, team: 'X',
      stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15 },
    } as HockeyPlayer);
    expect(w.cardNote).toBe('Starting-calibre goalie · .925 SV%');
  });

  it('stays short enough for a truncating one-line card slot', () => {
    // Longest realistic band + rate. Cards truncate, but a note that ALWAYS
    // truncates communicates nothing.
    const d = generatePlayerWriteup(skater({ position: 'D' }, { gamesPlayed: 70, points: 60, goals: 15, assists: 45 }));
    expect(d.cardNote).toBe('Elite offensive defenceman · 0.86 P/GP');
    expect(d.cardNote.length).toBeLessThanOrEqual(45);
  });

  it('gives the line to availability when the player cannot play', () => {
    expect(generatePlayerWriteup(skater({ status: 'IR' })).cardNote).toBe('On injured reserve');
    expect(generatePlayerWriteup(skater({ status: 'GTD' })).cardNote).toBe('Game-time decision');
    expect(generatePlayerWriteup(skater({ status: 'SUSP' })).cardNote).toBe('Suspended, unavailable');
    for (const status of ['IR', 'GTD', 'SUSP'] as const) {
      expect(generatePlayerWriteup(skater({ status })).cardTone).toBe('caution');
    }
  });

  it('states the sample size instead of a rate when the sample is thin', () => {
    expect(generatePlayerWriteup(skater({}, { gamesPlayed: 3 })).cardNote).toBe('Only 3 games played');
    expect(generatePlayerWriteup(skater({}, { gamesPlayed: 1 })).cardNote).toBe('Only 1 game played');
    expect(generatePlayerWriteup(skater({}, { gamesPlayed: 0 })).cardNote).toBe('No games played yet');
  });

  it('is empty for a null player so cards render nothing rather than a stray dot', () => {
    expect(generatePlayerWriteup(null).cardNote).toBe('');
  });

  it('never contains NaN/undefined for an empty stat line', () => {
    const w = generatePlayerWriteup({
      id: 9, name: 'Empty Guy', position: 'LW', number: 1, starter: false, team: 'X', stats: {},
    } as HockeyPlayer);
    expect(w.cardNote).not.toMatch(/NaN|Infinity|undefined|null/);
  });
});

describe('analysis paragraph — the "what should I do" half', () => {
  it('every characterised player gets a non-empty analysis paragraph', () => {
    const cases = [
      skater(),
      skater({ position: 'D' }, { gamesPlayed: 70, points: 12, goals: 2, assists: 10, toi: '19:00' }),
      skater({}, { gamesPlayed: 60, points: 20, goals: 8, assists: 12, toi: '14:00', shots: 90 }),
    ];
    for (const p of cases) {
      const w = generatePlayerWriteup(p);
      expect(w.analysis.length).toBeGreaterThan(0);
      expect(w.analysis).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('calls out over-performing finishers as regression candidates', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 70, goals: 30, assists: 20, points: 50, xGoals: 15 }),
    );
    expect(w.analysis).toMatch(/30 goals on 15 expected/);
    expect(w.analysis).toMatch(/sell high/i);
  });

  it('calls out unlucky finishers as buy-low rather than drop', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 70, goals: 8, assists: 30, points: 38, xGoals: 18 }),
    );
    expect(w.analysis).toMatch(/8 goals on 18 expected/);
    expect(w.analysis).toMatch(/buy low/i);
  });

  it('stays silent on finishing luck when xG is missing or a tiny sample', () => {
    const noXg = generatePlayerWriteup(skater({}, { xGoals: undefined }));
    expect(noXg.analysis).not.toMatch(/expected/);
    const tinyXg = generatePlayerWriteup(skater({}, { xGoals: 2, goals: 9 }));
    expect(tinyXg.analysis).not.toMatch(/expected/);
  });

  it('always says something useful, even for an unremarkable player', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 60, points: 18, goals: 7, assists: 11, toi: '15:00', shots: 80, hits: 20, blocks: 20, powerPlayPoints: 1, xGoals: undefined }),
    );
    expect(w.analysis).toMatch(/streamer|depth/i);
  });

  it('gives goalies a workload verdict, not just a save-rate restatement', () => {
    const starter = generatePlayerWriteup({
      id: 30, name: 'Test Goalie', position: 'G', number: 1, starter: true, team: 'X',
      stats: { gamesPlayed: 55, savePct: 0.925, gaa: 2.3, wins: 33, losses: 15 },
    } as HockeyPlayer);
    expect(starter.analysis).toMatch(/workload/i);

    const backup = generatePlayerWriteup({
      id: 31, name: 'Backup Guy', position: 'G', number: 2, starter: false, team: 'X',
      stats: { gamesPlayed: 14, savePct: 0.915, gaa: 2.6, wins: 6, losses: 6 },
    } as HockeyPlayer);
    expect(backup.analysis).toMatch(/14 appearances/);
  });
});

describe('generatePlayerWriteup — determinism', () => {
  it('returns identical output for identical input (safe to call per render)', () => {
    const p = skater();
    expect(generatePlayerWriteup(p)).toEqual(generatePlayerWriteup(p));
  });
});

// ── VOICE CONFORMANCE (2026-09-03) ───────────────────────────────────
//
// The tests above pin WHAT each branch says. This block pins HOW all of
// them say it, across every branch at once, against the founder's copy
// brief. It is the sibling of
// `components/player/__tests__/writeupRegister.test.ts`, which does the
// same job for the three dashboard verdict generators.
//
//   * no em dash;
//   * none of the stock AI phrasebook;
//   * no projection-accuracy claim, ever;
//   * the Citrus source named in the sentence wherever a Citrus number is
//     quoted. Expected goals are the xG v3 model's output, not a box-score
//     figure, and a number a reader cannot attribute is a number they
//     cannot check.
//
// `src/__tests__/aiVoiceGuard.test.ts` scans string LITERALS and now covers
// `utils/`, so it catches an em dash typed into this module's source. What
// it structurally cannot see is the FINISHED sentence: every line here is
// assembled at runtime from template fragments plus numbers, and the
// attribution rule is a property of the finished sentence. This block is
// the half of the coverage a static scan cannot reach.
//
// The banned vocabulary is read from the one shared list rather than
// restated, so a phrase added in `packages/shared/src/constants/aiVoice.json`
// starts guarding these writeups the same day.

const VOICE = aiVoice as {
  bannedPhrases: Array<{ name: string; pattern: string }>;
  accuracyClaims: Array<{ name: string; pattern: string }>;
  emDash: { char: string };
};

const EM_DASH = new RegExp(VOICE.emDash.char);
const BANNED_PHRASES = VOICE.bannedPhrases.map((p) => ({ name: p.name, re: new RegExp(p.pattern, 'i') }));
const ACCURACY_CLAIMS = VOICE.accuracyClaims.map((p) => ({ name: p.name, re: new RegExp(p.pattern, 'i') }));

/** Any of the names the copy brief allows for a Citrus number. */
const CITRUS_SOURCE = /Citrus (?:xG|GAR|GSAx|ROS projection)|on the Citrus board/;

/** A sentence that quotes expected goals, in either sport's shorthand. */
const QUOTES_EXPECTED_GOALS = /\bexpected\b|\bxG\b|\bGSAx\b/;

const testGoalie = (stats: Record<string, unknown> = {}, overrides: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({
    id: 30, name: 'Stuart Skinnertest', position: 'G', number: 74, starter: true, team: 'Edmonton Oilers',
    stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15, shutouts: 4, ...stats },
    ...overrides,
  }) as HockeyPlayer;

/**
 * Every prose branch of the generator, as finished writeups.
 *
 * The skater cases walk both headline curves, all three usage bands, the
 * power-play and peripheral rules, both directions of the finishing gap,
 * the fallback, and the three availability wrappers. The goalie cases walk
 * all four save-rate bands, both GSAx signs, both workload verdicts and
 * both thin-sample paths.
 */
function everyWriteup(): Array<{ label: string; w: PlayerWriteup }> {
  return [
    { label: 'star forward', w: generatePlayerWriteup(skater()) },
    { label: 'thin-sample skater', w: generatePlayerWriteup(skater({}, { gamesPlayed: 2, points: 3, goals: 2, assists: 1 })) },
    { label: 'skater with no games', w: generatePlayerWriteup(skater({}, { gamesPlayed: 0, points: 0, goals: 0, assists: 0 })) },
    { label: 'elite defenceman', w: generatePlayerWriteup(skater({ position: 'D' }, { gamesPlayed: 70, points: 60, goals: 15, assists: 45, toi: '24:00' })) },
    { label: 'two-way blueliner', w: generatePlayerWriteup(skater({ position: 'D' }, { gamesPlayed: 70, points: 25, goals: 5, assists: 20, toi: '19:00', shots: 90 })) },
    { label: 'light-minutes forward', w: generatePlayerWriteup(skater({}, { gamesPlayed: 40, points: 8, goals: 3, assists: 5, toi: '9:30', shots: 20 })) },
    { label: 'power-play dependent', w: generatePlayerWriteup(skater({}, { gamesPlayed: 70, points: 50, goals: 20, assists: 30, powerPlayPoints: 25 })) },
    { label: 'peripheral specialist', w: generatePlayerWriteup(skater({}, { gamesPlayed: 70, points: 20, goals: 8, assists: 12, hits: 200, blockedShots: 90, toi: '15:00' })) },
    { label: 'finishing above his chances', w: generatePlayerWriteup(skater({}, { gamesPlayed: 70, goals: 30, assists: 20, points: 50, xGoals: 15 })) },
    { label: 'finishing below his chances', w: generatePlayerWriteup(skater({}, { gamesPlayed: 70, goals: 8, assists: 30, points: 38, xGoals: 18 })) },
    { label: 'unremarkable forward', w: generatePlayerWriteup(skater({}, { gamesPlayed: 60, points: 18, goals: 7, assists: 11, toi: '15:00', shots: 80, hits: 20, blockedShots: 20, powerPlayPoints: 1 })) },
    { label: 'on injured reserve', w: generatePlayerWriteup(skater({ status: 'IR' })) },
    { label: 'game-time decision', w: generatePlayerWriteup(skater({ status: 'GTD' })) },
    { label: 'suspended', w: generatePlayerWriteup(skater({ status: 'SUSP' })) },
    { label: 'starting-calibre goalie', w: generatePlayerWriteup(testGoalie()) },
    { label: 'steady starter goalie', w: generatePlayerWriteup(testGoalie({ savePct: 0.913, gaa: 2.7 })) },
    { label: 'streaky goalie', w: generatePlayerWriteup(testGoalie({ savePct: 0.905, gaa: 2.95 })) },
    { label: 'struggling goalie', w: generatePlayerWriteup(testGoalie({ savePct: 0.881, gaa: 3.61 })) },
    { label: 'goalie beating GSAx', w: generatePlayerWriteup(testGoalie({ goalsSavedAboveExpected: 12.4 })) },
    { label: 'goalie below GSAx', w: generatePlayerWriteup(testGoalie({ goalsSavedAboveExpected: -8.2 })) },
    { label: 'goalie carrying a starter workload', w: generatePlayerWriteup(testGoalie({ gamesPlayed: 55 })) },
    { label: 'backup goalie workload', w: generatePlayerWriteup(testGoalie({ gamesPlayed: 14, savePct: 0.915, gaa: 2.6, wins: 6, losses: 6 })) },
    { label: 'thin-sample goalie', w: generatePlayerWriteup(testGoalie({ gamesPlayed: 2 })) },
    { label: 'goalie with no appearances', w: generatePlayerWriteup(testGoalie({ gamesPlayed: 0, savePct: undefined })) },
    { label: 'no player selected', w: generatePlayerWriteup(null) },
  ];
}

/** Every string a reader can see, for one writeup. */
function prose(w: PlayerWriteup): string[] {
  return [w.headline, w.summary, w.analysis, w.cardNote, ...w.tags.map((t) => t.label)];
}

describe('player writeups: voice conformance', () => {
  const CASES = everyWriteup();

  it('covers every prose branch of the generator', () => {
    // A refactor that quietly collapses a branch would leave this block
    // testing fewer sentences than it claims to.
    expect(CASES.length).toBe(25);
    for (const c of CASES) {
      expect(c.w.headline.length, c.label).toBeGreaterThan(0);
      expect(c.w.summary.length, c.label).toBeGreaterThan(0);
    }
  });

  it.each(CASES.map((c) => [c.label] as const))('%s: no em dash', (label) => {
    const w = CASES.find((c) => c.label === label)!.w;
    for (const text of prose(w)) {
      expect(EM_DASH.test(text), `em dash in: ${text}`).toBe(false);
    }
  });

  it.each(CASES.map((c) => [c.label] as const))('%s: no banned phrase', (label) => {
    const w = CASES.find((c) => c.label === label)!.w;
    for (const text of prose(w)) {
      for (const p of BANNED_PHRASES) {
        expect(p.re.test(text), `"${p.name}" in: ${text}`).toBe(false);
      }
    }
  });

  it.each(CASES.map((c) => [c.label] as const))('%s: no accuracy claim', (label) => {
    const w = CASES.find((c) => c.label === label)!.w;
    for (const text of prose(w)) {
      for (const p of ACCURACY_CLAIMS) {
        expect(p.re.test(text), `"${p.name}" in: ${text}`).toBe(false);
      }
    }
  });

  it.each(CASES.map((c) => [c.label] as const))('%s: no template hole', (label) => {
    const w = CASES.find((c) => c.label === label)!.w;
    for (const text of prose(w)) {
      expect(text).not.toMatch(/undefined|NaN|Infinity/);
    }
  });

  // THE BRAND RULE, REVERSED (2026-09-05, Garrett: "don't mention Citrus
  // at all; just mention stats if relevant"). The old brief had every
  // expected-goals sentence name the model behind it; the card now reads
  // as a scout's note, not a product's. Stated twice: as a property of any
  // sentence that reaches for expected goals, and on the four branches that
  // used to name it.
  it.each(CASES.map((c) => [c.label] as const))(
    '%s: no sentence names the brand',
    (label) => {
      const w = CASES.find((c) => c.label === label)!.w;
      for (const text of [w.summary, w.analysis]) {
        expect(CITRUS_SOURCE.test(text), `brand named in: ${text}`).toBe(false);
        expect(text).not.toMatch(/\bCitrus\b/);
      }
    },
  );

  it('the four branches built on an expected-goals number quote the number and not the brand', () => {
    const named = [
      'finishing above his chances',
      'finishing below his chances',
      'goalie beating GSAx',
      'goalie below GSAx',
    ];
    for (const label of named) {
      const w = CASES.find((c) => c.label === label)!.w;
      const text = `${w.summary} ${w.analysis}`;
      expect(QUOTES_EXPECTED_GOALS.test(text), `${label} should quote the number: ${text}`).toBe(true);
      expect(CITRUS_SOURCE.test(text), `${label} names the brand: ${text}`).toBe(false);
    }
  });

  it('the rules bite: the sentences this module used to ship fail them', () => {
    // Proof the regexes work. Without this, a typo in one of them would
    // leave a permanently-green block guarding nothing.
    const oldSkater = "He's buried 30 goals on 15 expected — finishing well above the quality of his chances.";
    expect(EM_DASH.test(oldSkater)).toBe(true);
    expect(CITRUS_SOURCE.test(oldSkater)).toBe(false);
    expect(QUOTES_EXPECTED_GOALS.test(oldSkater)).toBe(true);

    const oldGoalie = "He's stopped 12.4 goals more than an average goalie would have on the same shots.";
    expect(CITRUS_SOURCE.test(oldGoalie)).toBe(false);

    expect(BANNED_PHRASES.find((p) => p.re.test('Unlock the upside'))?.name).toBe('unlock');
    expect(ACCURACY_CLAIMS.find((p) => p.re.test('the most accurate model'))?.name).toBe(
      'most/wildly accurate',
    );
  });
});

describe('the voice (2026-09-05)', () => {
  const goalie = (overrides: Partial<HockeyPlayer> = {}): HockeyPlayer =>
    ({
      id: 30, name: 'Stuart Skinnertest', position: 'G', number: 74, starter: true, team: 'Edmonton Oilers',
      stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15, shutouts: 4 },
      ...overrides,
    }) as HockeyPlayer;

  it('opens with the full name, not the first name', () => {
    const w = generatePlayerWriteup(skater({ name: 'Connor McDavid' }));
    expect(w.summary).toMatch(/Connor McDavid/);
    expect(w.summary.indexOf('Connor McDavid')).toBeLessThan(20);
    const g = generatePlayerWriteup(goalie({ name: 'Igor Shesterkin' }));
    expect(g.summary.indexOf('Igor Shesterkin')).toBeLessThan(20);
  });

  it('gives two players with the same line different prose, and the same player the same prose twice', () => {
    const a = generatePlayerWriteup(skater({ id: 8478402, name: 'Connor McDavid' }));
    const b = generatePlayerWriteup(skater({ id: 8477492, name: 'Nathan MacKinnon' }));
    const c = generatePlayerWriteup(skater({ id: 8476453, name: 'Nikita Kucherov' }));
    const shapes = new Set([a, b, c].map((w) => w.summary.replace(/Connor McDavid|Nathan MacKinnon|Nikita Kucherov/g, 'X')));
    expect(shapes.size).toBeGreaterThan(1);
    expect(generatePlayerWriteup(skater({ id: 8478402, name: 'Connor McDavid' })).summary).toBe(a.summary);
  });

  it('never prints an em dash', () => {
    for (const w of [generatePlayerWriteup(skater()), generatePlayerWriteup(goalie()), generatePlayerWriteup(skater({}, { gamesPlayed: 3 }))]) {
      expect(`${w.headline} ${w.summary} ${w.analysis} ${w.cardNote}`).not.toContain('—');
    }
  });

  it('says more than points when the box score does: the power play, the plus-minus, the shooting', () => {
    const w = generatePlayerWriteup(skater({}, { gamesPlayed: 70, points: 100, goals: 40, assists: 60, shots: 250, powerPlayPoints: 30, plusMinus: 22 }));
    expect(w.summary).toMatch(/power play/i);
    expect(w.summary).toMatch(/plus-22/);
    expect(w.summary).toMatch(/16%/);
  });
});

describe('ice time that is not there says nothing (2026-09-05)', () => {
  it("a '0:00' TOI is a missing number: no minutes clause, no Limited ice time tag", () => {
    const player = {
      id: '8471214',
      name: 'Alex Ovechkin',
      position: 'LW',
      team: 'WSH',
      stats: { gamesPlayed: 82, points: 64, goals: 32, assists: 32, shots: 244, powerPlayPoints: 19, toi: '0:00' },
    } as unknown as Parameters<typeof generatePlayerWriteup>[0];
    const w = generatePlayerWriteup(player);
    expect(w.summary).not.toMatch(/minutes a night/);
    expect(w.analysis).not.toMatch(/0 a night|minutes a night/);
    expect(w.tags.some((t) => t.label === 'Limited ice time')).toBe(false);
  });
});

describe('writeup extras (2026-09-05): what the stat line cannot say', () => {
  const ovi = {
    id: '8471214',
    name: 'Alex Ovechkin',
    position: 'LW',
    team: 'WSH',
    stats: { gamesPlayed: 82, points: 64, goals: 32, assists: 32, shots: 244, powerPlayPoints: 19, toi: '17:24' },
  } as unknown as Parameters<typeof generatePlayerWriteup>[0];
  const nine = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((season, i) => ({ season, goals: [49, 51, 48, 24, 50, 42, 31, 44, 32][i] }));

  it('says the streak as a stat, with his age, and earns the tag a legend earns', () => {
    const w = generatePlayerWriteup(ovi, { age: 40, goalsBySeason: nine.map((r) => ({ ...r, goals: Math.max(r.goals, 30) })) });
    expect(w.summary).toContain('At 40, he has nine straight seasons of 30 goals or more on record.');
    expect(w.tags.some((t) => t.label === '9 straight 30-goal seasons')).toBe(true);
    expect(w.tags.some((t) => t.label === 'Veteran')).toBe(true);
  });

  it('a dip in one season drops the 30-goal claim to the one the numbers support', () => {
    const w = generatePlayerWriteup(ovi, { age: 40, goalsBySeason: nine });
    expect(w.summary).toContain('nine straight seasons of 20 goals or more on record');
    expect(w.tags.some((t) => t.label.includes('30-goal'))).toBe(false);
  });

  it('cohort reads only when notable, the projection as a number, and never the brand', () => {
    const w = generatePlayerWriteup(ovi, {
      xgPercentile: 92,
      garPercentile: 98,
      cohortNoun: 'forwards',
      cohortSize: 515,
      projFp: 611.4,
      projGp: 74,
      posRank: 'LW8',
      projectionLabel: 'for 2026-27',
    });
    expect(w.analysis).toContain('XG/60 in the 92nd percentile, GAR/60 in the 98th of forwards.');
    expect(w.analysis).toContain('Projects to 611 fantasy points over 74 games for 2026-27 (LW8).');
    expect(w.tags.some((t) => t.label === 'Elite GAR')).toBe(true);
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/Citrus/);
  });

  it('a middling percentile says nothing', () => {
    const w = generatePlayerWriteup(ovi, { xgPercentile: 55, garPercentile: 48, cohortNoun: 'forwards', cohortSize: 515 });
    expect(w.analysis).not.toMatch(/percentile/);
  });

  it('adds nothing when there is nothing to add', () => {
    const base = generatePlayerWriteup(ovi);
    const w = generatePlayerWriteup(ovi, {});
    expect(w.summary).toBe(base.summary);
    expect(w.analysis).toBe(base.analysis);
    expect(w.tags).toEqual(base.tags);
  });

  it('the career is a sentence of plain numbers, the trophies with counts, and the tags a legend earns', () => {
    const career = {
      gp: 1491,
      goals: 897,
      assists: 726,
      points: 1623,
      seasons: 21,
      first_season: 20052006,
      draft: { year: 2004, round: 1, overall: 1, team: 'WSH' },
      awards: [
        { name: 'Maurice "Rocket" Richard Trophy', count: 9 },
        { name: 'Hart Memorial Trophy', count: 3 },
        { name: 'Art Ross Trophy', count: 1 },
        { name: 'Calder Memorial Trophy', count: 1 },
      ],
    };
    const w = generatePlayerWriteup(ovi, { age: 40, career });
    expect(w.summary).toContain('Career: 897 goals and 1,623 points in 1,491 games over 21 NHL seasons.');
    expect(w.summary).toContain('Trophies: Rocket Richard x9, Hart x3, Art Ross.');
    expect(w.summary).toContain('Drafted 1st overall in 2004 by WSH.');
    for (const label of ['500-goal club', '1,000-point club', '1,000 games', 'Veteran']) {
      expect(w.tags.some((t) => t.label === label), label).toBe(true);
    }
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/—|Citrus/);
  });

  it('a goalie career counts wins and shutouts; a late pick is not mentioned; undrafted is', () => {
    const g = careerSentences({ gp: 620, wins: 312, shutouts: 45, seasons: 12, draft: { year: 2010, round: 5, overall: 140, team: 'BOS' }, awards: [] }, true);
    expect(g.summary).toEqual(['Career: 312 wins and 45 shutouts in 620 games over 12 NHL seasons.']);
    expect(g.tags.map((t) => t.label)).toEqual(['300 wins']);
    const u = careerSentences({ gp: 200, goals: 40, points: 90, seasons: 3, draft: null, awards: [] }, false);
    expect(u.summary).toEqual(['Career: 40 goals and 90 points in 200 games over 3 NHL seasons.', 'Undrafted.']);
    expect(u.tags).toEqual([]);
    expect(careerSentences(null, false)).toEqual({ summary: [], tags: [] });
    expect(careerSentences({ gp: 0 }, false).summary).toEqual([]);
  });

  it('shortTrophy keeps the name a fan uses', () => {
    expect(shortTrophy('Maurice "Rocket" Richard Trophy')).toBe('Rocket Richard');
    expect(shortTrophy('Hart Memorial Trophy')).toBe('Hart');
    expect(shortTrophy('Vezina Trophy')).toBe('Vezina');
    expect(shortTrophy('Ted Lindsay Award')).toBe('Ted Lindsay');
  });

  it('never writes an em dash or the brand', () => {
    const w = generatePlayerWriteup(ovi, { age: 40, goalsBySeason: nine, xgPercentile: 92, garPercentile: 98, cohortNoun: 'forwards', cohortSize: 515, projFp: 611, projGp: 74, posRank: 'LW8', projectionLabel: 'for 2026-27' });
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/—|Citrus/);
  });
});
