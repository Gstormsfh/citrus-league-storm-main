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
} from '../playerWriteup';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

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
    expect(w.summary).toContain('50% of his production');
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
    expect(good.summary).toMatch(/stopped 12\.4 goals more/);
    const bad = generatePlayerWriteup(goalie({ goalsSavedAboveExpected: -8.2 }));
    expect(bad.summary).toMatch(/conceded 8\.2 goals more/);
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
    expect(generatePlayerWriteup(skater({ status: 'SUSP' })).cardNote).toBe('Suspended — unavailable');
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

describe('generatePlayerWriteup — determinism', () => {
  it('returns identical output for identical input (safe to call per render)', () => {
    const p = skater();
    expect(generatePlayerWriteup(p)).toEqual(generatePlayerWriteup(p));
  });
});
