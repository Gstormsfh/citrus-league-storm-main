import { describe, expect, it } from 'vitest';
import { heroMetricTile } from '../heroMetricTile';

describe('heroMetricTile', () => {
  it('shows GSAx for a goalie, signed, one decimal — never xG/60', () => {
    expect(heroMetricTile({ gsax_regressed: 14.71, xg_per_60: 0.9, gar_per_60: 0.4 }, true))
      .toEqual({ key: 'xg', label: 'GSAx', value: '+14.7', tone: 'orange' });
    expect(heroMetricTile({ gsax_regressed: -3.04 }, true).value).toBe('-3.0');
  });

  it('shows a dash under the GSAx label for a goalie the table does not hold', () => {
    expect(heroMetricTile({ gsax_regressed: null, xg_per_60: 0.9 }, true))
      .toEqual({ key: 'xg', label: 'GSAx', value: '–', tone: 'plain' });
    expect(heroMetricTile(null, true).label).toBe('GSAx');
  });

  it('prefers GAR/60 over xG/60 for a skater, and never shows GSAx', () => {
    expect(heroMetricTile({ gar_per_60: 0.412, xg_per_60: 1.2, gsax_regressed: 9 }, false))
      .toEqual({ key: 'xg', label: 'GAR / 60', value: '+0.41', tone: 'orange' });
    expect(heroMetricTile({ gar_per_60: null, xg_per_60: 1.234 }, false))
      .toEqual({ key: 'xg', label: 'xG / 60', value: '1.23', tone: 'orange' });
    expect(heroMetricTile({}, false)).toEqual({ key: 'xg', label: 'xG / 60', value: '–', tone: 'plain' });
  });
});
