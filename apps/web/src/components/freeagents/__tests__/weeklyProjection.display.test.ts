import { describe, expect, it, vi } from 'vitest';
import { freeAgentMatchupWeek, weeklyExposureLabel, weeklyPointsLabel } from '../weeklyProjection';
vi.mock('@/services/ScheduleService', () => ({ ScheduleService: {} }));
import { sortByProjection } from '../freeAgentRowKit';

describe('weekly projection labels and unavailable ranking', () => {
  it('separates fractional starts from team schedule without widening the phone figure column', () => {
    const backup = { position: 'G', expectedStarts: 3 * 5 / 84, gamesThisWeek: 3 };
    expect(weeklyExposureLabel(backup)).toBe('0.2 expected starts · 3 team games');
    expect(weeklyExposureLabel(backup, true)).toBe('0.2 STARTS');
    expect(weeklyExposureLabel({ ...backup, expectedStarts: null }, true)).toBe('STARTS —');
    expect(weeklyExposureLabel({ ...backup, expectedStarts: 1.5 }, true)).toBe('1.5 STARTS');
  });
  it('retains negative and zero points and ranks missing forecasts below both', () => {
    expect(weeklyPointsLabel(null)).toBe('–');
    expect(weeklyPointsLabel(0)).toBe('0.0');
    expect(weeklyPointsLabel(-3)).toBe('-3.0');
    expect(sortByProjection([
      { full_name: 'Unknown', weeklyProjection: null },
      { full_name: 'Negative', weeklyProjection: -3 },
      { full_name: 'Zero', weeklyProjection: 0 },
    ]).map(p => p.full_name)).toEqual(['Zero', 'Negative', 'Unknown']);
  });
});

describe('shared free-agent schedule and projection window', () => {
  const first = { week_start_date: '2026-09-27', week_end_date: '2026-10-03' };
  const second = { week_start_date: '2026-10-04', week_end_date: '2026-10-10' };
  it('uses the earliest scheduled week before the opener, even in an unordered response', () => {
    expect(freeAgentMatchupWeek([second, first], '2026-09-12')).toEqual(first);
  });
  it('uses the week containing today and does not reuse an ended week', () => {
    expect(freeAgentMatchupWeek([first, second], '2026-10-06')).toEqual(second);
    expect(freeAgentMatchupWeek([first, second], '2026-10-11')).toBeUndefined();
  });
});
