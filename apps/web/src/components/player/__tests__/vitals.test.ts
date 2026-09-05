import { describe, it, expect } from 'vitest';
import { ageOn, heightLabel, newestRowFor, vitalsFrom } from '../vitals';

describe('vitals', () => {
  it('ages on the birthday, not the year', () => {
    expect(ageOn('1997-01-13', new Date(2026, 8, 5))).toBe(29);
    expect(ageOn('1997-09-06', new Date(2026, 8, 5))).toBe(28);
    expect(ageOn('1997-09-05', new Date(2026, 8, 5))).toBe(29);
    expect(ageOn('nope', new Date())).toBeNull();
  });
  it('prints height in feet and inches', () => {
    expect(heightLabel(73)).toBe(`6'1"`);
    expect(heightLabel(72)).toBe(`6'0"`);
  });
  it('builds the strip in order and leaves out what it does not have', () => {
    const today = new Date(2026, 8, 5);
    expect(vitalsFrom({ player_id: 1, birthdate: '1997-01-13', height_in: 73, weight_lb: 194, shoots_catches: 'L' }, today)).toEqual([
      { label: 'AGE', value: '29' },
      { label: 'HT', value: `6'1"` },
      { label: 'WT', value: '194' },
      { label: 'SHOOTS', value: 'L' },
    ]);
    expect(vitalsFrom({ player_id: 1, height_in: 0, shoots_catches: null }, today)).toEqual([]);
    expect(vitalsFrom({ player_id: 1, shoots_catches: 'l', position_code: 'G' }, today)).toEqual([{ label: 'CATCHES', value: 'L' }]);
    expect(vitalsFrom(null)).toEqual([]);
  });
  it('takes the newest season row for the player', () => {
    const rows = [
      { player_id: 1, season: 2025, weight_lb: 190 },
      { player_id: 1, season: 2026, weight_lb: 194 },
      { player_id: 2, season: 2026, weight_lb: 200 },
    ];
    expect(newestRowFor(rows, '1')?.weight_lb).toBe(194);
    expect(newestRowFor(rows, 3)).toBeNull();
  });
});
