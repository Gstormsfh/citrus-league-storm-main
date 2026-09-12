import { describe, expect, it } from 'vitest';
import { generatePlayerWriteup, type WriteupPlayer } from '../../playerWriteup';
import { editorialScoringCategories } from '../index';

const player = (stats: WriteupPlayer['stats'], name = 'Sample Forward', position = 'C'): WriteupPlayer => ({
  id: 1, name, position, statsSeason: 2025, stats,
});
const sample = { gamesPlayed: 80, goals: 35, assists: 55, points: 90, shots: 320, powerPlayPoints: 25, toi: '21:00' };
const extras = { projectionSeason: 2026 };

describe('Citrus evidence-driven editorial profiles', () => {
  it('four high-scoring forwards have materially different mechanisms without name-driven variation', () => {
    const fixtures = [
      player(sample),
      player({ ...sample, goals: 50, assists: 40, shots: 280 }),
      player({ ...sample, goals: 20, assists: 70, shots: 190 }),
      player({ ...sample, goals: 30, assists: 60, shots: 200, powerPlayPoints: 45 }),
    ];
    const out = fixtures.map(p => generatePlayerWriteup(p, extras));
    expect(out.map(w => w.headline)).toEqual(['Volume shooter', 'Goal-led scoring', 'Assist-led production', 'Power-play exposure']);
    const normalized = out.map(w => w.analysis.replace(/\d+(?:\.\d+)?/g, '#'));
    expect(new Set(normalized).size).toBe(4);
    expect(normalized[0]).toContain('Finishing can move independently');
    expect(normalized[1]).toContain('Goals drove');
    expect(normalized[2]).toContain('teammate to finish');
    expect(normalized[3]).toContain('special-teams opportunity');
    expect(generatePlayerWriteup({ ...fixtures[0], id: 97, name: 'Another Forward' }, extras).analysis).toBe(out[0].analysis);
  });

  it('recognizes a single known peripheral category without fabricating the missing one', () => {
    const out = generatePlayerWriteup(player({ gamesPlayed: 80, points: 20, goals: 5, assists: 15, hits: 300 }), extras);
    expect(out.headline).toBe('Peripheral specialist');
    expect(out.summary).toContain('3.8 hits');
    expect(out.summary).not.toMatch(/0 blocks|NaN/);
  });

  it('does not award excluded physical production in a blocks-only setup', () => {
    const p = player({ gamesPlayed: 80, goals: 5, assists: 15, points: 20, hits: 300, blockedShots: 10 });
    const withHits = generatePlayerWriteup(p, { ...extras, scoringCategories: ['hits'] });
    const blocksOnly = generatePlayerWriteup(p, { ...extras, scoringCategories: ['blocks'] });
    expect(withHits.tags).toContainEqual({ label: 'Peripheral value', tone: 'positive' });
    expect(blocksOnly.tags).not.toContainEqual({ label: 'Peripheral value', tone: 'positive' });
    expect(blocksOnly.analysis).toContain('outside the rewarded categories');
  });

  it('changes shooter advice when shots stop scoring', () => {
    const p = player(sample);
    const withShots = generatePlayerWriteup(p, { ...extras, scoringCategories: ['goals', 'shots'] });
    const goalsOnly = generatePlayerWriteup(p, { ...extras, scoringCategories: ['goals'] });
    expect(withShots.analysis).toContain('leagues counting shots');
    expect(goalsOnly.analysis).toContain('Shots are not rewarded directly');
    expect(withShots.summary).toBe(goalsOnly.summary);
  });

  it('distinguishes goalie ratios from wins scoring and never infers a secure job', () => {
    const p = player({ gamesPlayed: 50, wins: 35, losses: 10, savePct: 0.899, gaa: 3.1 }, 'Sample Goalie', 'G');
    const wins = generatePlayerWriteup(p, { ...extras, scoringCategories: ['wins'] });
    const ratios = generatePlayerWriteup(p, { ...extras, scoringCategories: ['save_pct', 'gaa'] });
    expect(wins.analysis).toContain('setup rewards wins');
    expect(ratios.analysis).toContain('wins do not add direct scoring value');
    expect(wins.analysis).not.toBe(ratios.analysis);
    for (const w of [wins, ratios]) expect(w.analysis).not.toMatch(/job looks secure|true starter|weekly starter/);
  });

  it('keeps absent appearance data unknown and rejects incomplete point rates', () => {
    const missingGp = generatePlayerWriteup(player({ points: 80 }), extras);
    expect(missingGp.summary).toContain('does not include a usable appearance count');
    expect(missingGp.summary).not.toContain('no NHL appearances');
    expect(missingGp.hasEnoughData).toBe(false);
    expect(generatePlayerWriteup(player({ gamesPlayed: 80 }), extras).hasEnoughData).toBe(false);
  });

  it('does not infer tracking, teammates, role security or inevitable regression from totals', () => {
    const w = generatePlayerWriteup(player({ ...sample, xGoals: 20 }), extras);
    expect(w.analysis).toContain('20 Citrus expected goals');
    expect(w.analysis).toContain('not proof of luck or a guaranteed reversal');
    expect(`${w.summary} ${w.analysis}`).not.toMatch(/coach trusts|top.line role|slot access|sell high|buy low|Start him and forget/);
  });

  it('uses goalie starts for forecast workload and never changes the input values', () => {
    const p = player({ gamesPlayed: 50, savePct: .92 }, 'Sample Goalie', 'G');
    const settings = Object.freeze({ ...extras, projGp: 58, projFp: 400, projectionLabel: 'for 2026-27' });
    const w = generatePlayerWriteup(p, settings);
    expect(w.analysis).toContain('400 fantasy points over 58 starts for 2026-27');
    expect(p.stats?.gamesPlayed).toBe(50);
  });

  it('extracts only configured nonzero weights and keeps no-settings unknown', () => {
    expect(editorialScoringCategories(null)).toBeNull();
    expect(editorialScoringCategories({ skater: { hits: 0, shots_on_goal: .2, goals: 4 }, goalie: { goals_against: -2 } })).toEqual(['shots', 'goals', 'goals_against']);
  });
});
