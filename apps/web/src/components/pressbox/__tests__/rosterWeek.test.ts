/**
 * The WK column and the win bar's inputs (2026-09-05). See rosterWeek.ts.
 */
import { describe, it, expect } from 'vitest';
import { weekEntries, sideOutlook } from '../rosterWeek';

const TODAY = '2026-10-01';
const proj = (player_id: number, projection_date: string, pts: number) => ({ player_id, projection_date, total_projected_points: pts, game: { status: 'scheduled' } });

describe('weekEntries', () => {
  it('before a game is played the week number is the projection and there is no trend', () => {
    const entries = weekEntries(
      [{ id: 97, isGoalie: false }],
      new Map(),
      [proj(97, '2026-10-01', 6.2), proj(97, '2026-10-03', 7.1), proj(97, '2026-10-04', 5.5)],
      TODAY,
    );
    const e = entries.get('97')!;
    expect(e.weekPoints).toBe(18.8);
    expect(e.weekTrendPct).toBeNull();
    expect(e.projRemaining).toBe(18.8);
    expect(e.gamesRemaining).toBe(3);
    expect(e.actualToDate).toBe(0);
  });

  it('after games: actual so far plus the remaining projection, trend against the played days', () => {
    // Played Mon (proj 6.0) and Tue (proj 4.0): 1G 2A = 3 + 2·2 = 7 under default scoring... scored by the calculator.
    const stats = new Map<number, Record<string, number>>([[97, { player_id: 97, goals: 1, assists: 2, shots_on_goal: 5, blocks: 0, ppp: 1, shp: 0, hits: 1, pim: 0, plus_minus: 1 }]]);
    const entries = weekEntries(
      [{ id: 97, isGoalie: false }],
      stats,
      [proj(97, '2026-09-29', 6.0), proj(97, '2026-09-30', 4.0), proj(97, '2026-10-01', 6.2), proj(97, '2026-10-03', 7.1)],
      TODAY,
    );
    const e = entries.get('97')!;
    expect(e.actualToDate).toBeGreaterThan(0);
    expect(e.projToDate).toBe(10);
    expect(e.projRemaining).toBe(13.3);
    expect(e.weekPoints).toBe(Math.round((e.actualToDate + 13.3) * 10) / 10);
    expect(e.weekTrendPct).toBe(Math.round(((e.actualToDate - 10) / 10) * 100));
    expect(e.gamesRemaining).toBe(2);
  });

  it('accepts the stats keyed as a record and a player with nothing on file', () => {
    const entries = weekEntries(
      [{ id: 1, isGoalie: true }, { id: 2, isGoalie: false }],
      { '1': { player_id: 1, wins: 1, saves: 30, goals_against: 2, shutouts: 0 } },
      [],
      TODAY,
    );
    expect(entries.get('1')!.actualToDate).toBeGreaterThan(0);
    expect(entries.get('2')).toEqual({ weekPoints: 0, weekTrendPct: null, actualToDate: 0, projToDate: 0, projRemaining: 0, gamesRemaining: 0 });
  });
});

describe('sideOutlook', () => {
  it('sums the starters only and counts their games left', () => {
    const entries = weekEntries(
      [{ id: 1, isGoalie: false }, { id: 2, isGoalie: false }, { id: 3, isGoalie: false }],
      new Map(),
      [proj(1, '2026-10-01', 5), proj(2, '2026-10-01', 4), proj(2, '2026-10-02', 4), proj(3, '2026-10-01', 9)],
      TODAY,
    );
    expect(sideOutlook([1, 2], entries)).toEqual({ expectedFinal: 13, gamesLeft: 3, banked: 0 });
    expect(sideOutlook(['3', 'nope'], entries)).toEqual({ expectedFinal: 9, gamesLeft: 1, banked: 0 });
  });
});


describe('week projections honor league scoring', () => {
  it('uses raw goals and ignores the stored default total', () => {
    const rows = [{ player_id: 97, projection_date: TODAY, total_projected_points: 999, projected_goals: 2, projected_assists: 3, game: { status: 'scheduled' } }];
    const players = [{ id: 97, isGoalie: false }];
    expect(weekEntries(players, {}, rows, TODAY, { skater: { goals: 1 } }).get('97')?.weekPoints).toBe(2);
    expect(weekEntries(players, {}, rows, TODAY, { skater: { goals: 10 } }).get('97')?.weekPoints).toBe(20);
  });
  it('does not present default totals as custom-league totals when raw stats are missing', () => {
    expect(() => weekEntries([{ id: 97, isGoalie: false }], {}, [proj(97, TODAY, 999)], TODAY, { skater: { goals: 10 } })).toThrow('Raw projections');
  });
});


describe('goalie availability in the roster week and team outlook', () => {
  const scoring = { goalie: { wins: 4, saves: 0.2, goals_against: -1, shutouts: 3 } };
  const day = (player_id: number, date: string, probability: number) => ({
    player_id, projection_date: date, total_projected_points: 999, game: { status: 'scheduled' },
    projected_wins: 0.5, projected_saves: 30, projected_goals_against: 3, projected_shutouts: 0.05,
    projected_gp: 1, projection_basis: 'conditional_on_start', expected_starts: probability,
  });
  it('splits three team games into expected starts and league-scored volume for a starter/backup pair', () => {
    const players = [{ id: 1, isGoalie: true }, { id: 2, isGoalie: true }];
    const rows = ['2026-10-01', '2026-10-03', '2026-10-05'].flatMap(date => [day(1, date, 0.8), day(2, date, 0.2)]);
    const entries = weekEntries(players, {}, rows, TODAY, scoring);
    expect(entries.get('1')?.weekPoints).toBe(12.4);
    expect(entries.get('2')?.weekPoints).toBe(3.1);
    expect(entries.get('1')?.gamesRemaining).toBeCloseTo(2.4);
    expect(entries.get('2')?.gamesRemaining).toBeCloseTo(0.6);
    expect(sideOutlook([1, 2], entries).gamesLeft).toBeCloseTo(3);
    expect(rows[0].projected_saves).toBe(30);
  });
  it('preserves a zero-start forecast and valid negative custom points without fallback', () => {
    const players = [{ id: 1, isGoalie: true }, { id: 2, isGoalie: true }];
    const entries = weekEntries(players, {}, [day(1, TODAY, 0), day(2, TODAY, 0.5)], TODAY, { goalie: { goals_against: -2 } });
    expect(entries.get('1')?.weekPoints).toBe(0);
    expect(entries.get('1')?.gamesRemaining).toBe(0);
    expect(entries.get('2')?.weekPoints).toBe(-3);
  });
  it('never treats unknown workload or missing goalie categories as a complete forecast', () => {
    const row = { ...day(1, TODAY, 0.5), projection_basis: 'unknown' };
    expect(weekEntries([{ id: 1, isGoalie: true }], {}, [row], TODAY, scoring).has('1')).toBe(false);
    expect(weekEntries([{ id: 1, isGoalie: true }], {}, [proj(1, TODAY, 999)], TODAY).has('1')).toBe(false);
  });
  it('does not apply exposure again to unconditional goalie volumes', () => {
    const row = { ...day(1, TODAY, 0.25), projection_basis: 'unconditional', projected_gp: 0.25,
      projected_wins: 0.125, projected_saves: 7.5, projected_goals_against: 0.75, projected_shutouts: 0.0125 };
    const entry = weekEntries([{ id: 1, isGoalie: true }], {}, [row], TODAY, scoring).get('1');
    expect(entry?.weekPoints).toBe(1.3);
    expect(entry?.gamesRemaining).toBe(0.25);
  });
  it('keeps banked actuals and a supported remaining forecast when only the past projection is unknown', () => {
    const past = { ...day(1, '2026-09-30', 0.5), projection_basis: 'unknown' };
    const entry = weekEntries([{ id: 1, isGoalie: true }], { '1': { saves: 10 } },
      [past, day(1, TODAY, 0.2)], TODAY, { goalie: { saves: 1 } }).get('1');
    expect(entry?.weekPoints).toBe(16);
    expect(entry?.weekTrendPct).toBeNull();
  });

  it('adds only the unplayed share after live actuals and no forecast after final', () => {
    const row = { ...day(1, TODAY, 0.2), game: { status: 'live', period: '2', period_time: '10:00' } };
    const entry = weekEntries([{ id: 1, isGoalie: true }], { '1': { saves: 4 } }, [row], TODAY, { goalie: { saves: 1 } }).get('1');
    expect(entry?.weekPoints).toBe(7);
    expect(entry?.gamesRemaining).toBeCloseTo(0.1);
    const final = weekEntries([{ id: 1, isGoalie: true }], { '1': { saves: 4 } }, [{ ...row, game: { status: 'final' } }], TODAY, { goalie: { saves: 1 } }).get('1');
    expect(final?.weekPoints).toBe(4);
    expect(final?.gamesRemaining).toBe(0);
  });
  it('withholds today when game progress is unavailable instead of double counting actuals', () => {
    const row = { ...day(1, TODAY, 0.2), game: null };
    expect(weekEntries([{ id: 1, isGoalie: true }], {}, [row], TODAY, scoring).has('1')).toBe(false);
  });

});
