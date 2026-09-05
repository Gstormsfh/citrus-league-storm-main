/**
 * The WK column and the win bar's inputs (2026-09-05). See rosterWeek.ts.
 */
import { describe, it, expect } from 'vitest';
import { weekEntries, sideOutlook } from '../rosterWeek';

const TODAY = '2026-10-01';
const proj = (player_id: number, projection_date: string, pts: number) => ({ player_id, projection_date, total_projected_points: pts });

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
