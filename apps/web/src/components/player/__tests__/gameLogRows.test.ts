import { describe, it, expect } from 'vitest';
import {
  playedRows,
  upcomingRows,
  upcomingCards,
  shortDate,
  toiLabel,
  type GameLogEntry,
  likelyRange,
} from '../gameLogRows';

/**
 * The player card's game log in the artboard's rows (2026-09-04). These
 * pin the shape the modal hands PressBoxGameLog and PressBoxUpcomingCards:
 * newest first with an AVG footer, DNP kept, the range in the tail, B2B
 * read off the schedule, and nothing invented for a game with no line.
 */

const entry = (over: Partial<GameLogEntry>): GameLogEntry => ({
  date: '2026-10-01',
  dayLabel: 'Thu',
  dateLabel: 'Oct 1',
  opponent: 'vs TOR',
  projectedPoints: 0,
  projection: null,
  isGoalie: false,
  isPast: false,
  isToday: false,
  computedConfidence: 0,
  ...over,
});

const played = (date: string, opponent: string, pts: number, s: Record<string, unknown>) =>
  entry({ date, opponent, isPast: true, actualPoints: pts, actualStats: s });

describe('playedRows', () => {
  it('lists newest first, marks the latest, and closes with the AVG footer', () => {
    const rows = playedRows(
      [
        played('2026-09-28', 'vs CGY', 6.9, { goals: 1, assists: 1, shots_on_goal: 2, plus_minus: 0, ppp: 0, hits: 1, toi_seconds: 1218 }),
        played('2026-09-30', '@ VAN', 11.6, { goals: 2, assists: 1, shots_on_goal: 6, plus_minus: 1, ppp: 2, hits: 1, toi_seconds: 1361 }),
        played('2026-10-01', 'vs TOR', 8.4, { goals: 1, assists: 2, shots_on_goal: 4, plus_minus: 2, ppp: 1, hits: 0, toi_seconds: 860 }),
      ],
      false,
    );
    expect(rows.map((r) => r.date)).toEqual(['10/1', '9/30', '9/28', 'AVG']);
    expect(rows[0].latest).toBe(true);
    expect(rows[1].latest).toBeUndefined();
    expect(rows[0].cells).toEqual([1, 2, 4, '+2', 1, 0]);
    expect(rows[0].toi).toBe('14:20');
    const avg = rows[3];
    expect(avg.summary).toBe(true);
    expect(avg.opponent).toBe('3 GP');
    expect(avg.points).toBeCloseTo((6.9 + 11.6 + 8.4) / 3, 5);
    expect(avg.cells).toEqual(['1.3', '1.3', '4.0', '+1.0', '1.0', '.7']);
  });

  it('keeps a played date with no line as DNP rather than dropping it', () => {
    const rows = playedRows(
      [
        played('2026-10-01', 'vs TOR', 8.4, { goals: 1, assists: 2, shots_on_goal: 4, plus_minus: 2, ppp: 1, hits: 0 }),
        entry({ date: '2026-10-02', opponent: '@ SEA', isPast: true }),
      ],
      false,
    );
    expect(rows[0].pointsLabel).toBe('DNP');
    expect(rows[0].cells).toEqual(['–', '–', '–', '–', '–', '–']);
    expect(rows[0].latest).toBeUndefined();
    // The first row WITH a line is the latest; the DNP does not take the wash.
    expect(rows[1].latest).toBe(true);
    // The DNP is not a game played.
    expect(rows[2].opponent).toBe('1 GP');
  });

  it('uses the goalie columns for a goalie', () => {
    const rows = playedRows(
      [played('2026-10-01', 'vs TOR', 9.5, { wins: 1, saves: 31, goals_against: 2, shutouts: 0 })],
      true,
    );
    expect(rows[0].cells).toEqual([1, 31, 2, 0]);
    expect(rows[1].cells).toEqual(['1.0', '31.0', '2.0', '.0']);
  });

  it('is empty when nothing has been played', () => {
    expect(playedRows([entry({})], false)).toEqual([]);
  });
});

describe('upcomingRows', () => {
  it('puts the projection in the points column and the range in the tail', () => {
    const rows = upcomingRows(
      [
        entry({
          date: '2026-10-03',
          opponent: '@ CGY',
          projectedPoints: 7.1,
          projection: { projected_goals: 0.42, projected_assists: 0.61, projected_sog: 3.4, projected_ppp: 0.31, projected_hits: 1.1, likely_low: 4.4, likely_high: 9.4 },
        }),
        entry({ date: '2026-10-05', opponent: 'vs SJS', isToday: true }),
      ],
      false,
    );
    expect(rows[0].points).toBe(7.1);
    expect(rows[0].cells).toEqual(['0.42', '0.61', '3.4', '0.31', '1.1']);
    expect(rows[0].toi).toBe('4.4–9.4');
    // No projection: nothing invented.
    expect(rows[1].points).toBeNull();
    expect(rows[1].cells).toEqual(['–', '–', '–', '–', '–']);
    expect(rows[1].toi).toBeNull();
    expect(rows[1].latest).toBe(true);
  });
});

describe('likelyRange', () => {
  // player_projected_stats, season 2026, measured 2026-09-05: likely_low and
  // likely_high NULL on all 66,024 rows; std dev and the 50% interval on
  // every one of them. The card had printed an empty Range for a season.
  it('uses the stored range when it exists', () => {
    expect(likelyRange({ likely_low: 4.4, likely_high: 9.4 }, 7.1)).toBe('4.4–9.4');
  });
  it('falls back to the 50% interval', () => {
    expect(likelyRange({ likely_low: null, likely_high: null, projection_ci_50_lower: 5.2, projection_ci_50_upper: 8.9 }, 7.1)).toBe('5.2–8.9');
  });
  it('falls back to mean ± 0.67σ, floored at zero', () => {
    expect(likelyRange({ projection_std_dev: 3, projection_mean: 7 }, 7)).toBe('5.0–9.0');
    expect(likelyRange({ projection_std_dev: 3, total_projected_points: 1 }, 1)).toBe('0.0–3.0');
    expect(likelyRange({ projection_std_dev: 2 }, 6)).toBe('4.7–7.3');
  });
  it('shows nothing when there is no distribution, or the band is not a band', () => {
    expect(likelyRange({}, 7.1)).toBeNull();
    expect(likelyRange({ projection_std_dev: 0, projection_mean: 7 }, 7)).toBeNull();
    expect(likelyRange({ projection_ci_50_lower: 8, projection_ci_50_upper: 8 }, 8)).toBeNull();
  });
});

describe('upcomingCards', () => {
  it('takes the next three and reads B2B off the schedule', () => {
    const cards = upcomingCards([
      played('2026-10-02', 'vs TOR', 8.4, { goals: 1 }),
      entry({ date: '2026-10-03', dayLabel: 'Sat', opponent: '@ CGY', projectedPoints: 7.1 }),
      entry({ date: '2026-10-05', dayLabel: 'Mon', opponent: 'vs SJS', projectedPoints: 7.4 }),
      entry({ date: '2026-10-07', dayLabel: 'Wed', opponent: 'vs WPG' }),
      entry({ date: '2026-10-09', dayLabel: 'Fri', opponent: '@ EDM', projectedPoints: 6 }),
    ]);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({ key: '2026-10-03', when: 'SAT 10/3', opponent: '@ CGY', note: null, noteTail: 'B2B' });
    expect(cards[1]).toEqual({ key: '2026-10-05', when: 'MON 10/5', opponent: 'vs SJS', note: null, noteTail: null });
    expect(cards[2].note).toBeNull();
  });

  it('labels a game today as TODAY', () => {
    expect(upcomingCards([entry({ isToday: true, projectedPoints: 5 })])[0].when).toBe('TODAY');
  });
});

describe('labels', () => {
  it('shortDate and toiLabel', () => {
    expect(shortDate('2026-10-01')).toBe('10/1');
    expect(toiLabel(1218)).toBe('20:18');
    expect(toiLabel(0)).toBeNull();
    expect(toiLabel(undefined)).toBeNull();
  });
});
