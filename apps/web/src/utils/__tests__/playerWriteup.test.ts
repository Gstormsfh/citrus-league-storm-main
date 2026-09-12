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
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { getProjectionsSeason } from '@citrus/shared/constants';
import aiVoice from '@citrus/shared/constants/aiVoice.json';

const ACTUALS_LABEL = `${getProjectionsSeason()}-${String((getProjectionsSeason() + 1) % 100).padStart(2, '0')}`;

const skater = (overrides: Partial<HockeyPlayer> = {}, stats: Record<string, unknown> = {}): HockeyPlayer =>
  ({
    id: 1,
    statsSeason: getProjectionsSeason(),
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
    expect(w.summary).toMatch(/no NHL appearances recorded/i);
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

describe('generatePlayerWriteup — evidence selects the hockey profile', () => {
  it('explains shot volume and conversion while preserving the scoring rate', () => {
    const w = generatePlayerWriteup(skater());
    expect(w.headline).toBe('Volume shooter');
    expect(w.hasEnoughData).toBe(true);
    expect(w.summary).toContain('40 goals');
    expect(w.summary).toContain('16% of his shots');
    expect(w.summary).not.toContain('100 points (');
    expect(w.cardNote).toContain('1.43 P/GP');
    expect(w.summary).toContain('3.6 shots per game');
    expect(w.analysis).toMatch(/leagues counting shots/);
  });

  it('keeps part-season and full-season scoring rates separate from their totals', () => {
    const parttime = generatePlayerWriteup(skater({}, { gamesPlayed: 25, points: 30, goals: 12, assists: 18, shots: 60, powerPlayPoints: 4 }));
    const fulltime = generatePlayerWriteup(skater({}, { gamesPlayed: 82, points: 33, goals: 15, assists: 18, shots: 150, powerPlayPoints: 4 }));
    expect(parttime.cardNote).toContain('1.2 P/GP');
    expect(fulltime.cardNote).toContain('0.4 P/GP');
    expect(parttime.summary).toContain('30 points');
    expect(fulltime.summary).toContain('33 points');
    expect(parttime.cardTone).toBe('positive');
    expect(fulltime.cardTone).toBe('neutral');
  });

  it('uses the defence-slot context without inventing top-pair deployment', () => {
    const statLine = { gamesPlayed: 70, points: 45, goals: 20, assists: 25, shots: 140, powerPlayPoints: 5, toi: '23:00' };
    const d = generatePlayerWriteup(skater({ position: 'D' }, statLine));
    const f = generatePlayerWriteup(skater({ position: 'C' }, statLine));
    expect(d.headline).toBe('Scoring beyond the power play');
    expect(f.headline).toBe('Balanced scoring profile');
    expect(d.analysis).toMatch(/defence slot/);
    expect(d.summary).toContain('40 came outside the power play');
    expect(d.summary + d.analysis).not.toMatch(/40 (?:even-strength|even strength)|40.*five.on.five/);
    expect(d.summary).not.toMatch(/top.pair|coach.*trust/i);
  });

  it('keeps the shot-volume story focused without adding an unrelated minutes sentence', () => {
    const w = generatePlayerWriteup(skater());
    expect(w.tags.map(t => t.label)).toContain('Shot volume');
    expect(w.summary).toContain('3.6 shots per game');
    expect(w.summary).not.toContain('21.5 minutes per game');
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/coach.*trust|secure.*role|top.line winger/i);
  });

  it('quantifies power-play dependence without inferring a unit assignment', () => {
    const w = generatePlayerWriteup(skater({}, { gamesPlayed: 70, points: 50, goals: 20, assists: 30, powerPlayPoints: 25 }));
    expect(w.tags.find(t => t.label === 'PP-dependent')?.tone).toBe('caution');
    expect(w.summary).toContain('25 of his 50 points on the power play');
    expect(w.analysis).toMatch(/unit retention/);
    expect(w.analysis).toMatch(/Reduced special-teams time would require more scoring elsewhere/);
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/(?:plays|skates|is) on (?:the )?first.unit/i);
  });

  it('reports limited minutes without guessing a bottom-six assignment', () => {
    const w = generatePlayerWriteup(skater({}, { gamesPlayed: 40, points: 8, goals: 3, assists: 5, toi: '9:30', shots: 20, powerPlayPoints: 1 }));
    expect(w.summary).toContain('9.5 minutes per game');
    expect(w.headline).not.toMatch(/bottom.six|top.line/i);
    expect(w.summary).not.toMatch(/coach|sheltered|fourth.line/i);
  });

  it('credits hits and blocks with the limited offence tradeoff', () => {
    const w = generatePlayerWriteup(skater({}, { gamesPlayed: 70, points: 20, goals: 8, assists: 12, hits: 200, blockedShots: 90, toi: '15:00' }));
    expect(w.headline).toBe('Peripheral specialist');
    expect(w.tags.map(t => t.label)).toContain('Peripheral value');
    expect(w.analysis).toMatch(/When hits and blocks count/);
    expect(w.summary).toContain('0.29 points per game');
    expect(w.summary).toContain('2.9 hits and 1.3 blocks');
    expect(w.analysis).toContain('limited offence');
  });
});

describe('generatePlayerWriteup — goalies', () => {
  const goalie = (stats: Record<string, unknown>): HockeyPlayer =>
    ({
      id: 30, statsSeason: getProjectionsSeason(), name: 'Stuart Skinnertest', position: 'G', number: 74, starter: true, team: 'Edmonton Oilers',
      stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15, shutouts: 4, ...stats },
    }) as HockeyPlayer;

  it('reports a strong save rate without claiming a starting job', () => {
    const w = generatePlayerWriteup(goalie({}));
    expect(w.headline).toBe('Save-rate strength');
    expect(w.analysis).toMatch(/do not establish his current share of starts/);
    expect(w.summary).toContain('.925'); // not "0.925", not "92.5"
    expect(w.summary).toContain('2.35 goals-against average');
  });

  it('normalises a percentage-form save pct rather than printing nonsense', () => {
    const w = generatePlayerWriteup(goalie({ savePct: 92.5 }));
    expect(w.summary).toContain('.925');
  });

  it('calls out a sub-.900 goalie honestly', () => {
    const w = generatePlayerWriteup(goalie({ savePct: 0.881, gaa: 3.61 }));
    expect(w.headline).toBe('Wins with ratio risk');
    expect(w.cardTone).toBe('caution');
    expect(w.summary).toContain('winning 30');
    expect(w.summary).toContain('.881 save percentage');
    expect(w.analysis).toMatch(/wins chase.*save-percentage lead/);
  });

  it('reports goals saved above expected in both directions', () => {
    const good = generatePlayerWriteup(goalie({ goalsSavedAboveExpected: 12.4 }));
    expect(good.summary).toMatch(/Citrus GSAx.*12\.4 goals saved above expected/);
    const bad = generatePlayerWriteup(goalie({ goalsSavedAboveExpected: -8.2 }));
    expect(bad.summary).toMatch(/Citrus GSAx.*8\.2 goals allowed beyond expected/);
    expect(bad.analysis).toMatch(/shot-quality adjustment and the raw save rate point in different directions/);
    expect(bad.analysis).toMatch(/neither measure establishes the future crease split/);
  });

  it('will not characterise a goalie with two appearances', () => {
    const w = generatePlayerWriteup(goalie({ gamesPlayed: 2 }));
    expect(w.hasEnoughData).toBe(false);
    expect(w.headline).toMatch(/limited sample/i);
    expect(w.summary).toContain('2 appearances');
    expect(w.analysis).toMatch(/larger NHL sample.*dependable rate/i);
  });
});

describe('generatePlayerWriteup — availability outranks production', () => {
  it('leads with IR status for a star, because tonight he cannot play', () => {
    const w = generatePlayerWriteup(skater({ status: 'IR' }));
    expect(w.summary).toMatch(/^Currently on injured reserve\./);
    expect(w.tags[0]).toEqual({ label: 'Injured reserve', tone: 'caution' });
    // The underlying scouting read survives beneath the status.
    expect(w.headline).toBe(generatePlayerWriteup(skater()).headline);
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
    expect(w.cardNote).toBe(`${ACTUALS_LABEL} · 1.43 P/GP`);
    expect(w.cardTone).toBe('positive');
  });

  it('uses save percentage for goalies, in hockey notation', () => {
    const w = generatePlayerWriteup({
      id: 30, statsSeason: getProjectionsSeason(), name: 'Test Goalie', position: 'G', number: 1, starter: true, team: 'X',
      stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15 },
    } as HockeyPlayer);
    expect(w.cardNote).toBe(`${ACTUALS_LABEL} · .925 SV%`);
  });

  it('stays short enough for a truncating one-line card slot', () => {
    // Season provenance plus the rate. Cards truncate, but a note that ALWAYS
    // truncates communicates nothing.
    const d = generatePlayerWriteup(skater({ position: 'D' }, { gamesPlayed: 70, points: 60, goals: 15, assists: 45 }));
    expect(d.cardNote).toBe(`${ACTUALS_LABEL} · 0.86 P/GP`);
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
    expect(generatePlayerWriteup(skater({}, { gamesPlayed: 3 })).cardNote).toBe(`${ACTUALS_LABEL} · 3 GP`);
    expect(generatePlayerWriteup(skater({}, { gamesPlayed: 1 })).cardNote).toBe(`${ACTUALS_LABEL} · 1 GP`);
    expect(generatePlayerWriteup(skater({}, { gamesPlayed: 0 })).cardNote).toBe(`${ACTUALS_LABEL} · 0 GP`);
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

  it('quantifies finishing above xG without an automatic sell-high recommendation', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 70, goals: 30, assists: 20, points: 50, xGoals: 15 }),
    );
    expect(w.analysis).toMatch(/15 goals above the 15 Citrus expected goals estimate/);
    expect(w.analysis).toContain('15 goals above');
    expect(w.analysis).toMatch(/A repeat needs that finishing advantage or more chance creation/);
    expect(w.analysis).not.toMatch(/sell high|guaranteed (?:decline|reversal)/i);
  });

  it('quantifies finishing below xG without calling it luck or an automatic buy-low', () => {
    const w = generatePlayerWriteup(
      skater({}, { gamesPlayed: 70, goals: 8, assists: 30, points: 38, xGoals: 18 }),
    );
    expect(w.analysis).toMatch(/10 goals below the 18 Citrus expected goals estimate/);
    expect(w.analysis).toContain('10 goals below');
    expect(w.analysis).toMatch(/Better conversion is a path to more goals, not a guaranteed rebound/);
    expect(w.analysis).not.toMatch(/buy low|will bounce back/i);
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
    expect(w.cardNote).toContain('0.3 P/GP');
    expect(w.summary).toContain('18 points in 60 games');
    expect(w.analysis).toContain('7 goals and 11 assists');
    expect(w.analysis).toMatch(/roster.*need/);
    expect(w.analysis).not.toMatch(/must.start|automatic.*play/i);
  });

  it('gives goalies a workload verdict, not just a save-rate restatement', () => {
    const starter = generatePlayerWriteup({
      id: 30, statsSeason: getProjectionsSeason(), name: 'Test Goalie', position: 'G', number: 1, starter: true, team: 'X',
      stats: { gamesPlayed: 55, savePct: 0.925, gaa: 2.3, wins: 33, losses: 15 },
    } as HockeyPlayer);
    expect(starter.analysis).toMatch(/counting stats still depends on the next crease allocation/);
    expect(starter.analysis).toMatch(/do not establish his current share of starts/);

    const backup = generatePlayerWriteup({
      id: 31, statsSeason: getProjectionsSeason(), name: 'Backup Guy', position: 'G', number: 2, starter: false, team: 'X',
      stats: { gamesPlayed: 14, savePct: 0.915, gaa: 2.6, wins: 6, losses: 6 },
    } as HockeyPlayer);
    expect(backup.summary).toContain('14 appearances');
    expect(backup.analysis).toMatch(/do not establish his current share of starts/);
    expect(backup.cardNote).toContain('.915 SV%');
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
const CITRUS_SOURCE = /Citrus (?:expected goals|xG|GAR|GSAx|ROS projection)|on the Citrus board/;

/** A sentence that quotes expected goals, in either sport's shorthand. */
const QUOTES_EXPECTED_GOALS = /\bexpected\b|\bxG\b|\bGSAx\b/;

const testGoalie = (stats: Record<string, unknown> = {}, overrides: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({
    id: 30, statsSeason: getProjectionsSeason(), name: 'Stuart Skinnertest', position: 'G', number: 74, starter: true, team: 'Edmonton Oilers',
    stats: { gamesPlayed: 50, savePct: 0.925, gaa: 2.35, wins: 30, losses: 15, shutouts: 4, ...stats },
    ...overrides,
  }) as HockeyPlayer;

/**
 * Representative evidence and availability cases, as finished writeups.
 *
 * The cases cover power-play exposure, peripherals, minutes, both finishing
 * gap directions, availability wrappers, save-rate tradeoffs, both GSAx
 * signs, and thin samples. Dedicated tests above check distinct profile
 * selection and category implications.
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

  it('keeps the representative evidence and availability cases usable', () => {
    // Keep the fixture inventory stable; distinct structure is tested above.
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

  // Source attribution is evidence provenance, not a promotional accuracy claim.
  it.each(CASES.map(c => [c.label] as const))('%s: attributed model numbers', label => {
    const w = CASES.find(c => c.label === label)!.w;
    for (const sentence of `${w.summary} ${w.analysis}`.split(/(?<=[.!?])\s+/)) {
      if (/\d/.test(sentence) && QUOTES_EXPECTED_GOALS.test(sentence)) {
        expect(CITRUS_SOURCE.test(sentence), `missing source in: ${sentence}`).toBe(true);
      }
    }
  });

  it('both finishing directions and GSAx directions name their model source', () => {
    for (const label of ['finishing above his chances', 'finishing below his chances', 'goalie beating GSAx', 'goalie below GSAx']) {
      const w = CASES.find(c => c.label === label)!.w;
      const text = `${w.summary} ${w.analysis}`;
      expect(QUOTES_EXPECTED_GOALS.test(text), label).toBe(true);
      expect(CITRUS_SOURCE.test(text), label).toBe(true);
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
      id: 30, statsSeason: getProjectionsSeason(), name: 'Stuart Skinnertest', position: 'G', number: 74, starter: true, team: 'Edmonton Oilers',
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

  it('does not manufacture differences by renaming identical evidence', () => {
    const a = generatePlayerWriteup(skater({ id: 8478402, name: 'Connor McDavid' }));
    const b = generatePlayerWriteup(skater({ id: 8477492, name: 'Nathan MacKinnon' }));
    const c = generatePlayerWriteup(skater({ id: 8476453, name: 'Nikita Kucherov' }));
    const shapes = new Set([a, b, c].map((w) => w.summary.replace(/Connor McDavid|Nathan MacKinnon|Nikita Kucherov/g, 'X')));
    expect(shapes.size).toBe(1);
    expect(a.analysis).toBe(b.analysis);
    expect(b.analysis).toBe(c.analysis);
    expect(generatePlayerWriteup(skater({ id: 8478402, name: 'Connor McDavid' })).summary).toBe(a.summary);
  });

  it('never prints an em dash', () => {
    for (const w of [generatePlayerWriteup(skater()), generatePlayerWriteup(goalie()), generatePlayerWriteup(skater({}, { gamesPlayed: 3 }))]) {
      expect(`${w.headline} ${w.summary} ${w.analysis} ${w.cardNote}`).not.toContain('—');
    }
  });

  it('changes the structure and category consequence when the hockey evidence changes', () => {
    const profiles = [
      generatePlayerWriteup(skater()),
      generatePlayerWriteup(skater({}, { goals: 15, assists: 55, points: 70, shots: 100, powerPlayPoints: 10 })),
      generatePlayerWriteup(skater({}, { goals: 40, assists: 25, points: 65, shots: 220, powerPlayPoints: 10 })),
      generatePlayerWriteup(skater({}, { goals: 5, assists: 15, points: 20, hits: 220, blockedShots: 100, powerPlayPoints: 2 })),
    ];
    expect(profiles.map(w => w.headline)).toEqual(['Volume shooter', 'Assist-led production', 'Finishing and playmaking', 'Peripheral specialist']);
    expect(new Set(profiles.map(w => w.analysis)).size).toBe(4);
    expect(profiles[1].analysis).toMatch(/assists need.*little shot volume/);
    expect(profiles[2].analysis).toMatch(/same shot volume requires that conversion to hold/);
    expect(profiles[3].analysis).toMatch(/without needing a scoring night/);
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

  it('cohort reads only when notable and the projection keeps its scoring context', () => {
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
  });

  it('labels goalie projected volume as starts and preserves the supplied total', () => {
    const w = generatePlayerWriteup(testGoalie(), {
      projFp: 275.4, projGp: 52, projectionLabel: 'for 2026-27',
    });
    expect(w.analysis).toContain('Projects to 275 fantasy points over 52 starts for 2026-27.');
    expect(w.analysis).not.toContain('over 52 games');
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
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/—/);
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

  it('never writes an em dash in combined career and projection prose', () => {
    const w = generatePlayerWriteup(ovi, { age: 40, goalsBySeason: nine, xgPercentile: 92, garPercentile: 98, cohortNoun: 'forwards', cohortSize: 515, projFp: 611, projGp: 74, posRank: 'LW8', projectionLabel: 'for 2026-27' });
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/—/);
  });
});


describe('concise assessments keep evidence limits', () => {
  it('does not convert minutes, production or a finishing gap into unsupported deployment and forecasts', () => {
    const profiles = [
      generatePlayerWriteup(skater({}, { toi: '25:00', goals: 10, assists: 50, points: 60, xGoals: 30 })),
      generatePlayerWriteup(skater({ position: 'D' }, { toi: '26:00', goals: 10, assists: 55, points: 65, powerPlayPoints: 35 })),
      generatePlayerWriteup(testGoalie({ gamesPlayed: 60, savePct: .930, wins: 40 })),
    ];
    for (const w of profiles) {
      const text = `${w.summary} ${w.analysis}`;
      expect(text).not.toMatch(/(?:will|should) (?:score \d|return (?:on|by)|miss \d|play \d)/i);
      expect(text).not.toMatch(/(?:has|owns) (?:an? )?(?:undisputed|uncontested|guaranteed) (?:crease|starting role)/i);
      expect(text).not.toMatch(/(?:plays|skates|is deployed) (?:on|with) (?:the )?(?:first|top)[- ](?:line|pair|power.play unit)/i);
      expect(text).not.toMatch(/Leon Draisaitl|Mikko Rantanen|Nathan MacKinnon/);
    }
    // The cautious prose still exposes the actual finishing gap for inspection.
    expect(`${profiles[0].summary} ${profiles[0].analysis}`).toMatch(/20 goals below/);
    expect(`${profiles[0].summary} ${profiles[0].analysis}`).toMatch(/Citrus (?:expected goals|xG)/);
  });

  it('never turns current injury status into a precise return date or projected absence', () => {
    for (const status of ['IR', 'GTD', 'SUSP'] as const) {
      const w = generatePlayerWriteup(skater({ status }));
      const text = `${w.summary} ${w.analysis}`;
      expect(w.tags[0].tone).toBe('caution');
      expect(text).not.toMatch(/(?:returns?|back|cleared) (?:on|by) (?:[A-Z][a-z]+ \d|20\d{2}-)|(?:miss|out for) \d+ games/i);
      expect(w.cardTone).toBe('caution');
    }
  });
});
