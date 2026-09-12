import { describe, expect, it } from 'vitest';
import { citrusNoteContext, sourceSeasonLabel } from '../sourceSeasonContext';

describe('stored source season context', () => {
  it('uses source season independently of publication year', () => {
    expect(citrusNoteContext({ season: 2024, published_at: '2026-09-12T00:30:00Z' })).toBe('2024-25 · Published Sep 12, 2026');
  });
  it('does not guess a current season or date when metadata is missing', () => {
    expect(citrusNoteContext({})).toBe('Season unavailable · Publication date unavailable');
    expect(citrusNoteContext({ season: NaN, published_at: 'bad-date' })).toBe('Season unavailable · Publication date unavailable');
  });
  it('handles century rollover', () => {
    expect(sourceSeasonLabel(1999)).toBe('1999-00');
  });
});
