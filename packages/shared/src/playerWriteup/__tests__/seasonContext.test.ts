import { describe, expect, it } from 'vitest';
import { generatePlayerWriteup, type WriteupPlayer } from '../index';
import { buildWriteupFromSources, projectionLabelFor, writeupPlayerFromIndex } from '../fromIndex';
import type { DashboardIndexEntry } from '../../types/playerDashboard';

const skater: WriteupPlayer = {
  id: 1, name: 'Sample Forward', position: 'C', statsSeason: 2025,
  stats: { gamesPlayed: 80, goals: 30, assists: 50, points: 80, shots: 240, powerPlayPoints: 20, hits: 60, blockedShots: 40, toi: '21:00', xGoals: 28 },
};

describe('source-season context in generated writeups', () => {
  it('describes completed actuals in past tense even during the next season', () => {
    const result = generatePlayerWriteup(skater, { projectionSeason: 2026 });
    expect(result.summary).toContain('generated 3 shots per game in 2025-26 and scored 30 goals');
    expect(result.summary).toContain('converting 12.5%');
    expect(result.summary).not.toMatch(/this season|is at|has put up|keeps handing/);
    expect(result.sourceContext?.actualsSeason).toBe(skater.statsSeason);
    expect(result.analysis).not.toMatch(/role is settled|Start him and forget him|current.*secure/);
    expect(result.cardNote).toBe('2025-26 · 1 P/GP');
  });

  it('does not infer this season from the date when actuals are two years old', () => {
    const result = generatePlayerWriteup({ ...skater, statsSeason: 2024 }, { projectionSeason: 2026 });
    expect(result.summary).toContain('2024-25');
    expect(result.summary).not.toContain('2025-26');
  });

  it('retains current availability, career facts and a separately dated forecast', () => {
    const result = generatePlayerWriteup({ ...skater, status: 'IR' }, {
      projectionSeason: 2026, projectionLabel: 'for 2026-27', projFp: 400, projGp: 70,
      career: { gp: 1000, goals: 400, assists: 500, points: 900, seasons: 15 },
    });
    expect(result.summary).toMatch(/injured reserve/i);
    expect(result.cardNote).toMatch(/injured|IR/i);
    expect(result.summary).toContain('2025-26');
    expect(result.summary).toContain('1,000');
    expect(result.analysis).toContain('Projects to 400 fantasy points over 70 games for 2026-27');
  });

  it('does not turn last season goalie appearances into a current starter-job claim', () => {
    const result = generatePlayerWriteup({
      id: 2, name: 'Sample Goalie', position: 'G', statsSeason: 2025,
      stats: { gamesPlayed: 50, wins: 30, losses: 15, savePct: 0.92, gaa: 2.4, goalsSavedAboveExpected: 8 },
    }, { projectionSeason: 2026 });
    expect(result.summary).toContain('made 50 appearances in 2025-26');
    expect(result.summary).toContain('winning 30');
    expect(result.analysis).toContain('do not establish his current share of starts');
    expect(result.analysis).not.toMatch(/job looks secure|confirm he's carrying/);
    expect(result.headline).toBe('Save-rate strength');
    expect(result.tags).toContainEqual({ label: '2025-26 actuals', tone: 'neutral' });
  });

  it('a zero-game historical source does not imply no games played this season', () => {
    const result = generatePlayerWriteup({ ...skater, stats: { gamesPlayed: 0 } }, { projectionSeason: 2026 });
    expect(result.summary).toBe('Sample Forward had no NHL appearances recorded in 2025-26.');
    expect(result.summary).not.toContain('yet');
    expect(result.hasEnoughData).toBe(false);
  });

  it('leaves known current-season descriptions in their current context', () => {
    const result = generatePlayerWriteup({ ...skater, statsSeason: 2026 }, { projectionSeason: 2026 });
    expect(result.summary).not.toContain('in 2025-26');
    expect(result.headline).not.toContain('2025-26');
    expect(result.analysis).not.toContain('historical baseline');
  });

  it('maps the actual source and projection target independently through server assembly', () => {
    const entry = {
      id: 1, name: 'Sample Forward', position: 'C', team: 'EDM',
      actuals_season: 2024, projection_season: 2026,
      gp: 80, goals: 30, assists: 50, points: 80, sog: 240,
    } as DashboardIndexEntry;
    expect(writeupPlayerFromIndex(entry).statsSeason).toBe(2024);
    const result = buildWriteupFromSources({ entry, index: [entry], now: new Date('2026-10-10T12:00:00Z') });
    expect(result.summary).toContain('2024-25');
  });

  it('does not assign an actual season to payloads missing source metadata', () => {
    const entry = { id: 1, name: 'Sample', position: 'C', projection_season: 2026 } as DashboardIndexEntry;
    expect(writeupPlayerFromIndex(entry).statsSeason).toBeUndefined();
  });

  it('uses a neutral datedness-unknown record without current-season or secure-role claims', () => {
    const result = generatePlayerWriteup({ ...skater, statsSeason: undefined }, { projectionSeason: 2026 });
    expect(result.summary).toContain('in the available stat record');
    expect(result.summary).not.toMatch(/this season|2025-26|2026-27/);
    expect(result.tags).toContainEqual({ label: 'Season unspecified', tone: 'neutral' });
    expect(result.cardNote).toBe('Recorded stats · 1 P/GP');
  });

  it('preserves source clocks instead of relabeling generation time as data freshness', () => {
    const entry = { id: 1, name: 'Sample Forward', position: 'C', actuals_season: 2025,
      projection_season: 2026, as_of: '2026-09-10T08:00:00Z', gp: 80, goals: 30, assists: 50, points: 80 } as DashboardIndexEntry;
    const result = buildWriteupFromSources({ entry, index: [entry], now: new Date('2026-09-12T12:00:00Z') });
    expect(result.sourceContext).toEqual({ actualsSeason: 2025, projectionSeason: 2026, indexAsOf: '2026-09-10T08:00:00Z' });
  });

  it('names the forecast target before and after its opener', () => {
    expect(projectionLabelFor(new Date('2026-09-12T12:00:00Z'), 2026)).toBe('for 2026-27');
    expect(projectionLabelFor(new Date('2026-10-12T12:00:00Z'), 2026)).toBe('for the rest of 2026-27');
  });
});
